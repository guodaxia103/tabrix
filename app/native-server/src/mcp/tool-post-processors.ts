/**
 * Tool post-processor registry — Memory Phase 0.2.
 *
 * A post-processor runs **after** a successful `invokeExtensionCommand`
 * call and **before** `normalizeToolCallResult` + `completeStep` in
 * `handleToolCall`. It can:
 *
 * 1. Mutate (a clone of) the raw `CallToolResult` to inject Memory
 *    metadata (e.g. a `historyRef` returned to the MCP client).
 * 2. Produce additional `artifactRefs` that are persisted onto the
 *    owning `ExecutionStep`.
 *
 * Design contract:
 * - **Isolation**: each post-processor wraps its work in `try/catch`
 *   and returns `{ rawResult: inputResult, extraArtifactRefs: [] }`
 *   on any failure. The main tool-result path must never be blocked
 *   by Memory bookkeeping.
 * - **No allocation cost** when no processor is registered for a
 *   given tool name — `runPostProcessor` short-circuits.
 * - Post-processors are intentionally tool-name-scoped so non-read
 *   tools (Phase 0.2 only touches `chrome_read_page`) pay zero
 *   overhead.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SessionManager } from '../execution/session-manager';
import { ACTION_KIND_BY_TOOL } from '../memory/action-service';

export interface ToolPostProcessorContext {
  toolName: string;
  rawResult: CallToolResult;
  stepId: string;
  /**
   * Added in Phase 0.3 so action post-processors can scope
   * pre-snapshot lookups to the current session without a second
   * round-trip through `memory_steps`.
   */
  sessionId: string;
  sessionManager: SessionManager;
  args: unknown;
}

export interface ToolPostProcessorResult {
  rawResult: CallToolResult;
  extraArtifactRefs: string[];
}

export type ToolPostProcessor = (ctx: ToolPostProcessorContext) => ToolPostProcessorResult;

function cloneCallToolResult(result: CallToolResult): CallToolResult {
  return {
    ...result,
    content: result.content
      ? (result.content.map((block) => ({ ...block })) as CallToolResult['content'])
      : result.content,
  };
}

function pickTabIdFromArgs(args: unknown): number | null {
  if (!args || typeof args !== 'object') return null;
  const tabId = (args as { tabId?: unknown }).tabId;
  return typeof tabId === 'number' && Number.isFinite(tabId) ? tabId : null;
}

export const chromeReadPagePostProcessor: ToolPostProcessor = (ctx) => {
  const empty: ToolPostProcessorResult = {
    rawResult: ctx.rawResult,
    extraArtifactRefs: [],
  };
  try {
    const service = ctx.sessionManager.pageSnapshots;
    if (!service) return empty;

    const record = service.recordFromReadPageResult({
      stepId: ctx.stepId,
      tabId: pickTabIdFromArgs(ctx.args),
      rawResult: ctx.rawResult,
    });
    if (!record) return empty;

    const cloned = cloneCallToolResult(ctx.rawResult);
    const first = cloned.content?.[0];
    if (first && first.type === 'text' && typeof first.text === 'string') {
      try {
        const parsed = JSON.parse(first.text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          (parsed as Record<string, unknown>).historyRef = record.historyRef;
          (cloned.content as Array<{ type: string; text: string }>)[0] = {
            ...first,
            text: JSON.stringify(parsed),
          };
        }
      } catch {
        // Body is not JSON (or is non-object). We still produced a
        // snapshot row and an artifactRef, just skip the inline
        // `historyRef` injection.
      }
    }

    return {
      rawResult: cloned,
      extraArtifactRefs: [record.historyRef],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`[tabrix/memory] chrome_read_page post-processor failed: ${message}`);
    return empty;
  }
};

/**
 * Phase 0.3 — a single generic processor handles all four DOM action
 * tools (click / fill / navigate / keyboard). The per-kind branch
 * logic lives inside {@link ActionService.recordFromToolCall} via
 * {@link ACTION_KIND_BY_TOOL}; this processor is thin glue:
 *
 * 1. Bail early if Memory persistence is off.
 * 2. Persist the action row (synchronous write-through).
 * 3. Inject `historyRef` into the JSON body when the extension
 *    returned a JSON text payload, falling back to "only an
 *    artifactRef" when the body is non-JSON (hard failures return
 *    plain-text error messages via `createErrorResponse`).
 *
 * Failure in any step degrades gracefully — the original result and
 * an empty `extraArtifactRefs` are returned.
 */
export const chromeActionPostProcessor: ToolPostProcessor = (ctx) => {
  const empty: ToolPostProcessorResult = {
    rawResult: ctx.rawResult,
    extraArtifactRefs: [],
  };
  try {
    const service = ctx.sessionManager.actions;
    if (!service) return empty;

    const record = service.recordFromToolCall({
      stepId: ctx.stepId,
      sessionId: ctx.sessionId,
      toolName: ctx.toolName,
      args: ctx.args,
      rawResult: ctx.rawResult,
    });
    if (!record) return empty;

    const cloned = cloneCallToolResult(ctx.rawResult);
    const first = cloned.content?.[0];
    if (first && first.type === 'text' && typeof first.text === 'string') {
      try {
        const parsed = JSON.parse(first.text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          (parsed as Record<string, unknown>).historyRef = record.historyRef;
          (cloned.content as Array<{ type: string; text: string }>)[0] = {
            ...first,
            text: JSON.stringify(parsed),
          };
        }
      } catch {
        // Non-JSON body (typical of `isError: true` plain-text
        // failures). We still recorded the row and return the
        // artifactRef; skip inline injection.
      }
    }

    return {
      rawResult: cloned,
      extraArtifactRefs: [record.historyRef],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`[tabrix/memory] chrome_action post-processor failed: ${message}`);
    return empty;
  }
};

/**
 * Registry. Keep keys narrow — unrelated tools pay zero cost.
 */
export const TOOL_POST_PROCESSORS: Partial<Record<string, ToolPostProcessor>> = {
  chrome_read_page: chromeReadPagePostProcessor,
  // Phase 0.3: four DOM action tools share the same processor;
  // `ACTION_KIND_BY_TOOL` keeps the mapping in one place.
  ...Object.fromEntries(
    Object.keys(ACTION_KIND_BY_TOOL).map((toolName) => [toolName, chromeActionPostProcessor]),
  ),
};

export function runPostProcessor(ctx: ToolPostProcessorContext): ToolPostProcessorResult {
  const processor = TOOL_POST_PROCESSORS[ctx.toolName];
  if (!processor) {
    return { rawResult: ctx.rawResult, extraArtifactRefs: [] };
  }
  return processor(ctx);
}
