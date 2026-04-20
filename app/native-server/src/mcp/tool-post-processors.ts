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

export interface ToolPostProcessorContext {
  toolName: string;
  rawResult: CallToolResult;
  stepId: string;
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
 * Registry. Keep keys narrow — unrelated tools pay zero cost.
 */
export const TOOL_POST_PROCESSORS: Partial<Record<string, ToolPostProcessor>> = {
  chrome_read_page: chromeReadPagePostProcessor,
};

export function runPostProcessor(ctx: ToolPostProcessorContext): ToolPostProcessorResult {
  const processor = TOOL_POST_PROCESSORS[ctx.toolName];
  if (!processor) {
    return { rawResult: ctx.rawResult, extraArtifactRefs: [] };
  }
  return processor(ctx);
}
