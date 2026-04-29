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
import { TOOL_NAMES } from '@tabrix/shared';
import type { SessionManager } from '../execution/session-manager';
import type {
  TaskSessionContext,
  TaskVisibleRegionRow,
  TaskVisibleRegionRowsData,
} from '../execution/task-session-context';
import { deriveLiveObservedApiDataFromBundle } from '../api-knowledge/live-observed-data';
import { ACTION_KIND_BY_TOOL } from '../memory/action-service';
import {
  analyzeKnowledgeCaptureBundle,
  type CapturedNetworkBundle,
} from '../memory/knowledge/api-knowledge-capture';
import { getCurrentCapabilityEnv, isCapabilityEnabled } from '../policy/capabilities';

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
  taskContext?: TaskSessionContext | null;
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

function readVisibleRegionRowsFromResult(result: CallToolResult): TaskVisibleRegionRowsData | null {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(first.text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const visible = (parsed as { visibleRegionRows?: unknown }).visibleRegionRows;
  if (!visible || typeof visible !== 'object' || Array.isArray(visible)) return null;
  const obj = visible as Record<string, unknown>;
  if (obj.sourceDataSource !== 'dom_region_rows') return null;
  const rawRows = Array.isArray(obj.rows) ? obj.rows : [];
  const rows: TaskVisibleRegionRow[] = rawRows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      rowId: typeof row.rowId === 'string' ? row.rowId : undefined,
      title: typeof row.title === 'string' ? row.title : '',
      primaryText: typeof row.primaryText === 'string' ? row.primaryText : null,
      secondaryText: typeof row.secondaryText === 'string' ? row.secondaryText : null,
      summary: typeof row.summary === 'string' ? row.summary : null,
      metaText: typeof row.metaText === 'string' ? row.metaText : null,
      interactionText: typeof row.interactionText === 'string' ? row.interactionText : null,
      visibleTextFields: Array.isArray(row.visibleTextFields)
        ? row.visibleTextFields.filter((item): item is string => typeof item === 'string')
        : undefined,
      targetRef: typeof row.targetRef === 'string' ? row.targetRef : null,
      targetRefCoverageRate:
        typeof row.targetRefCoverageRate === 'number' && Number.isFinite(row.targetRefCoverageRate)
          ? row.targetRefCoverageRate
          : null,
      boundingBox: parseVisibleBoundingBox(row.boundingBox),
      regionId: typeof row.regionId === 'string' ? row.regionId : undefined,
      sourceRegion: typeof row.sourceRegion === 'string' ? row.sourceRegion : 'viewport',
      confidence:
        typeof row.confidence === 'number' && Number.isFinite(row.confidence) ? row.confidence : 0,
      qualityReasons: Array.isArray(row.qualityReasons)
        ? row.qualityReasons.filter((item): item is string => typeof item === 'string')
        : undefined,
    }))
    .filter((row) => row.title.length > 0);
  const rowCount =
    typeof obj.rowCount === 'number' && Number.isFinite(obj.rowCount)
      ? Math.max(0, Math.floor(obj.rowCount))
      : rows.length;
  const confidence =
    typeof obj.rowExtractionConfidence === 'number' && Number.isFinite(obj.rowExtractionConfidence)
      ? obj.rowExtractionConfidence
      : rows.length > 0
        ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
        : 0;
  const rejectedReason =
    typeof obj.visibleRegionRowsRejectedReason === 'string'
      ? obj.visibleRegionRowsRejectedReason
      : null;
  return {
    sourceDataSource: 'dom_region_rows',
    rows,
    rowCount,
    available: obj.visibleRegionRowsUsed === true && rowCount > 0 && rows.length > 0,
    confidence,
    targetRefCoverageRate:
      typeof obj.targetRefCoverageRate === 'number' && Number.isFinite(obj.targetRefCoverageRate)
        ? obj.targetRefCoverageRate
        : null,
    regionQualityScore:
      typeof obj.regionQualityScore === 'number' && Number.isFinite(obj.regionQualityScore)
        ? obj.regionQualityScore
        : null,
    rejectedReason,
    visibleRegionRowsUsed: obj.visibleRegionRowsUsed === true,
    visibleRegionRowsRejectedReason: rejectedReason,
    sourceRegion: typeof obj.sourceRegion === 'string' ? obj.sourceRegion : 'viewport',
    rowExtractionConfidence: confidence,
    cardExtractorUsed: obj.cardExtractorUsed === true,
    cardPatternConfidence:
      typeof obj.cardPatternConfidence === 'number' && Number.isFinite(obj.cardPatternConfidence)
        ? obj.cardPatternConfidence
        : 0,
    cardRowsCount:
      typeof obj.cardRowsCount === 'number' && Number.isFinite(obj.cardRowsCount)
        ? Math.max(0, Math.floor(obj.cardRowsCount))
        : rowCount,
    rowOrder: 'visual_order',
    visibleDomRowsCandidateCount: readNonNegativeInteger(obj.visibleDomRowsCandidateCount),
    visibleDomRowsSelectedCount: readNonNegativeInteger(obj.visibleDomRowsSelectedCount),
    lowValueRegionRejectedCount: readNonNegativeInteger(obj.lowValueRegionRejectedCount),
    footerLikeRejectedCount: readNonNegativeInteger(obj.footerLikeRejectedCount),
    navigationLikeRejectedCount: readNonNegativeInteger(obj.navigationLikeRejectedCount),
    targetRefCoverageRejectedCount: readNonNegativeInteger(obj.targetRefCoverageRejectedCount),
    rejectedRegionReasonDistribution: readNumberRecord(obj.rejectedRegionReasonDistribution),
  };
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

function readNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = Math.max(0, Math.floor(raw));
  }
  return out;
}

function parseVisibleBoundingBox(value: unknown): TaskVisibleRegionRow['boundingBox'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  return {
    x: typeof obj.x === 'number' && Number.isFinite(obj.x) ? obj.x : null,
    y: typeof obj.y === 'number' && Number.isFinite(obj.y) ? obj.y : null,
    width: typeof obj.width === 'number' && Number.isFinite(obj.width) ? obj.width : null,
    height: typeof obj.height === 'number' && Number.isFinite(obj.height) ? obj.height : null,
  };
}

export const chromeReadPagePostProcessor: ToolPostProcessor = (ctx) => {
  const empty: ToolPostProcessorResult = {
    rawResult: ctx.rawResult,
    extraArtifactRefs: [],
  };
  try {
    ctx.taskContext?.noteVisibleRegionRows(readVisibleRegionRowsFromResult(ctx.rawResult));
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
 * B-017 — chrome_network_capture post-processor.
 *
 * Runs only when:
 *   1. The `api_knowledge` capability is enabled
 *      (`TABRIX_POLICY_CAPABILITIES=api_knowledge` or `=all`),
 *   2. Memory persistence is on (KnowledgeApiRepository is wired),
 *   3. The tool result is a JSON body containing a `requests` array
 *      (only `action: "stop"` produces this; `action: "start"` is a
 *      noop here).
 *
 * On every successful classification, the redacted endpoint metadata is
 * upserted into `knowledge_api_endpoints` (dedup by `(site, signature)`).
 * The MCP response itself is **never mutated** — Knowledge capture is
 * an invisible side-effect; failures degrade silently like every other
 * post-processor in this file.
 */
export const chromeNetworkCapturePostProcessor: ToolPostProcessor = (ctx) => {
  const empty: ToolPostProcessorResult = {
    rawResult: ctx.rawResult,
    extraArtifactRefs: [],
  };
  try {
    if (!isCapabilityEnabled('api_knowledge', getCurrentCapabilityEnv())) return empty;
    const repo = ctx.sessionManager.knowledgeApi;
    if (!repo) return empty;

    const first = ctx.rawResult.content?.[0];
    if (!first || first.type !== 'text' || typeof first.text !== 'string') return empty;
    let parsed: unknown;
    try {
      parsed = JSON.parse(first.text);
    } catch {
      return empty;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    const bundle = parsed as CapturedNetworkBundle;
    if (!Array.isArray(bundle.requests) || bundle.requests.length === 0) return empty;

    const observedAt = new Date().toISOString();
    const analysis = analyzeKnowledgeCaptureBundle(bundle, {
      sessionId: ctx.sessionId ?? null,
      stepId: ctx.stepId ?? null,
      observedAt,
    });
    const upsertedBySignature = new Map<
      string,
      {
        endpointId: string | null;
        knowledgeUpserted: boolean;
        correlationConfidence: 'unknown_candidate' | 'low_confidence' | 'high_confidence' | null;
        correlatedRegionId: string | null;
      }
    >();
    for (const input of analysis.upserts) {
      try {
        const endpoint = repo.upsert(input);
        upsertedBySignature.set(input.endpointSignature, {
          endpointId: endpoint.endpointId,
          knowledgeUpserted: true,
          correlationConfidence: endpoint.correlationConfidence,
          correlatedRegionId: endpoint.correlatedRegionId,
        });
      } catch (innerError) {
        const message = innerError instanceof Error ? innerError.message : String(innerError);

        console.warn(
          `[tabrix/knowledge] api_knowledge upsert failed for ${input.endpointSignature}: ${message}`,
        );
        upsertedBySignature.set(input.endpointSignature, {
          endpointId: null,
          knowledgeUpserted: false,
          correlationConfidence: null,
          correlatedRegionId: null,
        });
      }
    }
    if (ctx.taskContext) {
      const decision = ctx.taskContext.peekChooseContextDecision();
      const live = deriveLiveObservedApiDataFromBundle({
        bundle,
        ctx: {
          sessionId: ctx.sessionId ?? null,
          stepId: ctx.stepId ?? null,
          observedAt,
        },
        upsertedBySignature,
        selectorContext: {
          currentPageUrl: ctx.taskContext.currentUrl,
          pageRole: ctx.taskContext.pageRole,
          expectedTaskQueryKeys: decision?.apiCapability?.params
            ? Object.keys(decision.apiCapability.params)
            : [],
        },
      });
      ctx.taskContext.noteLiveObservedApiData(live.selected, live.rejected);
    }
    return empty;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`[tabrix/knowledge] chrome_network_capture post-processor failed: ${message}`);
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
  // B-017: API Knowledge capture (capability-gated, no MCP surface
  // change). Keyed off the canonical tool name so legacy aliases
  // (`chrome_network_capture_stop`) are intentionally not hooked.
  [TOOL_NAMES.BROWSER.NETWORK_CAPTURE]: chromeNetworkCapturePostProcessor,
};

export function runPostProcessor(ctx: ToolPostProcessorContext): ToolPostProcessorResult {
  const processor = TOOL_POST_PROCESSORS[ctx.toolName];
  if (!processor) {
    return { rawResult: ctx.rawResult, extraArtifactRefs: [] };
  }
  return processor(ctx);
}
