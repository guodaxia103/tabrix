/**
 * V26-FIX-01 — API Direct Execution Path.
 *
 * Pure async module. Lets `tabrix_choose_context` execute the chosen
 * read-only API endpoint inline when (a) the chooser routed to
 * `knowledge_supported_read`, (b) the resolved endpoint candidate
 * passes the high-confidence threshold, (c) the user intent is
 * read-only. The result envelope carries compact rows so an upstream
 * MCP client (Codex / Claude / Cursor) can skip the subsequent
 * `chrome_navigate` + `chrome_read_page` round-trip entirely.
 *
 * Hard contracts:
 *   1. The executor is the ONLY consumer of `readApiKnowledgeRows` from
 *      this layer; it never short-circuits the existing
 *      `chrome_read_page` shim. Failure / low-confidence / non-read-only
 *      intent collapses to `'fallback_required'` (or one of the
 *      `'skipped_*'` branches) and the upstream caller falls back to
 *      the legacy chrome_navigate → chrome_read_page → API-shim chain
 *      that is bit-identical pre-V26-FIX-01.
 *   2. `executionMode='direct_api'` is set ONLY when the API call
 *      actually returned ok. `browserNavigationSkipped=true` is the
 *      same gate. Telemetry never claims a savings we did not deliver.
 *   3. Only `GET` endpoints are eligible (mirrors the underlying
 *      `readApiKnowledgeRows` `READ_METHODS` allowlist). The executor
 *      itself does not perform any network IO that is not expressed via
 *      the injected `fetchFn` (the test seam used by every consumer).
 *   4. No raw body / cookie / auth / response snapshot is persisted.
 *      The compact rows + `ApiKnowledgeTelemetry` we surface are the
 *      same scrubbed shape the existing `chrome_read_page` API shim
 *      already returns, so no privacy boundary moves.
 *
 * V26-FIX-04 will replace the `endpointFamily` literal entry point
 * with a knowledge-driven `lookupEndpointFamily` lookup; this file is
 * the surface that flip lands behind. V26-FIX-05 will then label the
 * underlying `api-knowledge.ts` adapters as `seed_adapter` so this
 * module is the only mainline reader.
 */

import type {
  ApiKnowledgeCandidate,
  ApiKnowledgeCompactRow,
  ApiKnowledgeFallbackReason,
  ApiKnowledgeFetch,
  ApiKnowledgeReadResult,
  ApiKnowledgeTelemetry,
} from '../api/api-knowledge';
import { readApiKnowledgeRows } from '../api/api-knowledge';
import {
  KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR,
  lookupEndpointFamily,
} from '../api-knowledge/endpoint-lookup';
import { buildSafeRequest } from '../api-knowledge/safe-request-builder';
import { readKnowledgeDrivenEndpoint } from '../api-knowledge/knowledge-driven-reader';
import type { DataNeed, EndpointKnowledgeReader, ReaderMode } from '../api-knowledge/types';

/**
 * Closed enum the chooser surfaces back to telemetry / operation-log
 * (V26-FIX-07). Adding values requires extending the V3 evidence
 * contract in lockstep, so the union is intentionally narrow.
 */
export type DirectApiExecutionMode =
  | 'direct_api'
  | 'fallback_required'
  | 'skipped_low_confidence'
  | 'skipped_not_read_only'
  | 'skipped_no_candidate'
  | 'skipped_route_mismatch';

/**
 * Closed-enum decision reason (mirrors the V3 §V26-FIX-01 evidence
 * contract). Each branch in `tryDirectApiExecute` writes exactly one
 * of these values so a post-mortem can group by reason without parsing
 * free-form strings.
 */
export type DirectApiDecisionReason =
  | 'endpoint_knowledge_high_confidence'
  | 'endpoint_low_confidence'
  | 'endpoint_not_resolved'
  | 'route_mismatch_not_knowledge_supported'
  | 'intent_not_read_only'
  | `api_call_failed_${ApiKnowledgeFallbackReason}`;

/**
 * Closed enum the chooser writes onto the legacy `via_read_page`
 * snapshot. Defaults to `'via_read_page'` for every existing call site
 * so the v2.5 happy path is bit-identical pre V26-FIX-01.
 */
export type ExecutionMode = 'direct_api' | 'via_read_page';

/**
 * Read-only intent classification re-used from the V25-02 layer
 * dispatcher hint. Keeping the input enum closed (rather than relying
 * on raw user intent text) makes the gate auditable: a future intent
 * classifier change cannot accidentally widen the direct-execution
 * surface without flipping this hint.
 */
export type DirectApiIntentClass = 'read_only' | 'action' | 'unknown';

/**
 * V26-FIX-01 confidence threshold. Calibrated from the existing
 * candidates in `resolveApiKnowledgeCandidate`:
 *   - `github_issues_list`           = 0.86
 *   - `github_search_repositories`   = 0.82
 *   - `npmjs_search_packages`        = 0.80
 * All three exceed 0.7, future low-confidence (e.g. heuristic-only)
 * candidates remain below it and route through the legacy
 * `chrome_read_page` shim. The threshold is exported so tests can
 * pin its value rather than re-deriving it from the candidate table.
 */
export const DIRECT_API_HIGH_CONFIDENCE_THRESHOLD = 0.7;

export interface DirectApiExecutorInput {
  /**
   * Closed-enum routing instruction the chooser already produced.
   * Non `'knowledge_supported_read'` routes short-circuit to
   * `executionMode='skipped_route_mismatch'` immediately.
   */
  sourceRoute: string;
  /** Read-only candidate previously resolved by the chooser. */
  candidate: ApiKnowledgeCandidate | null;
  intentClass: DirectApiIntentClass;
  /** Optional fetch override. When omitted falls through to the underlying default in `readApiKnowledgeRows`. */
  fetchFn?: ApiKnowledgeFetch;
  /** Optional clock override. */
  nowMs?: () => number;
  /** Optional row cap forwarded to the underlying reader. */
  limit?: number;
  /** Optional confidence threshold override (defaults to {@link DIRECT_API_HIGH_CONFIDENCE_THRESHOLD}). */
  confidenceThreshold?: number;
  /**
   * V26-FIX-04 — when both `dataNeed` and `knowledgeRepo` are
   * supplied, the executor first tries a Knowledge-driven lookup
   * (`lookupEndpointFamily` + `buildSafeRequest`) before falling
   * back to the legacy `candidate` path. When either is missing
   * (e.g. the caller did not load Memory yet) the executor behaves
   * exactly like pre-FIX-04. This is the FIX-04 entry point.
   */
  dataNeed?: DataNeed | null;
  knowledgeRepo?: EndpointKnowledgeReader | null;
}

export interface DirectApiExecutionTelemetry {
  /** Final closed-enum decision the executor reached. */
  executionMode: DirectApiExecutionMode;
  decisionReason: DirectApiDecisionReason;
  /** True iff `executionMode === 'direct_api'`. */
  browserNavigationSkipped: boolean;
  /** True iff `executionMode === 'direct_api'`. Mirrors `browserNavigationSkipped` for the chrome_read_page contract. */
  readPageAvoided: boolean;
  /** Endpoint family the executor (would have) called; null when no candidate was eligible. */
  endpointFamily: string | null;
  /** Confidence score the executor saw on the candidate; null when the candidate was missing. */
  candidateConfidence: number | null;
  /** Underlying API telemetry from the reader; null when no fetch was attempted. */
  apiTelemetry: ApiKnowledgeTelemetry | null;
  /** Closed enum of reader fallback causes; null on the success path. */
  fallbackCause: ApiKnowledgeFallbackReason | null;
  /** Suggested entry layer when `fallback_required`; null otherwise. */
  fallbackEntryLayer: 'L0+L1' | null;
  /**
   * V26-FIX-04 — closed enum identifying which entry path the
   * executor actually took. `'knowledge_driven'` when the
   * lookup-first path produced the result; `'legacy_candidate'` when
   * the executor fell through to the V25 hardcoded candidate; `null`
   * for short-circuit branches that never reached either.
   */
  readerMode: ReaderMode | null;
  /** V26-FIX-04 — Knowledge endpoint id of the looked-up row; null when not knowledge-driven. */
  knowledgeEndpointId: string | null;
  /** V26-FIX-04 — `<host><path>` pattern of the looked-up endpoint; null when not knowledge-driven. */
  endpointPattern: string | null;
  /** V26-FIX-04 — closed-enum semantic type of the looked-up endpoint; null when not knowledge-driven. */
  endpointSemanticType: string | null;
  /** V26-FIX-04 — sorted list of query keys the safe builder emitted; null when not knowledge-driven. */
  requestShapeUsed: ReadonlyArray<string> | null;
  /** V26-FIX-04 — `'pass' | 'fail'` semantic-validation outcome; null when not knowledge-driven. */
  semanticValidation: 'pass' | 'fail' | null;
}

export interface DirectApiExecutionRows {
  rows: ApiKnowledgeCompactRow[];
  rowCount: number;
  compact: true;
  rawBodyStored: false;
  dataPurpose: string;
}

export interface DirectApiExecutionResult extends DirectApiExecutionTelemetry {
  /** Rows are present ONLY on the `direct_api` happy path. */
  rows: DirectApiExecutionRows | null;
}

/**
 * Map a user-intent hint into the read-only / action / unknown bucket
 * the executor accepts. Mirrors `deriveTaskTypeForLayerDispatch`
 * (`reading_only` ↔ `read_only`) so the gate aligns with the V25-02
 * Strategy Table without re-implementing the keyword scan.
 */
export function classifyDirectApiIntent(taskTypeHint: string | undefined): DirectApiIntentClass {
  switch (taskTypeHint) {
    case 'reading_only':
      return 'read_only';
    case 'action':
      return 'action';
    default:
      return 'unknown';
  }
}

/**
 * Execute the chosen API endpoint inline. Returns a closed-shape
 * result object regardless of branch — a `'direct_api'` happy path
 * carries `rows` + `executionMode='direct_api'`; everything else
 * collapses to one of the closed `'skipped_*'` / `'fallback_required'`
 * branches with `rows: null` so the caller can fall back to the
 * legacy chrome_read_page path.
 *
 * The function is deliberately small + pure-IO: it owns no state
 * beyond the input, and never reads `process.env` or the system clock
 * directly.
 */
export async function tryDirectApiExecute(
  input: DirectApiExecutorInput,
): Promise<DirectApiExecutionResult> {
  const threshold = input.confidenceThreshold ?? DIRECT_API_HIGH_CONFIDENCE_THRESHOLD;

  if (input.sourceRoute !== 'knowledge_supported_read') {
    return short({
      executionMode: 'skipped_route_mismatch',
      decisionReason: 'route_mismatch_not_knowledge_supported',
      endpointFamily: input.candidate?.endpointFamily ?? null,
      candidateConfidence: input.candidate?.confidence ?? null,
    });
  }

  if (input.intentClass !== 'read_only') {
    return short({
      executionMode: 'skipped_not_read_only',
      decisionReason: 'intent_not_read_only',
      endpointFamily: input.candidate?.endpointFamily ?? null,
      candidateConfidence: input.candidate?.confidence ?? null,
    });
  }

  // V26-FIX-04 — try the lookup-first knowledge-driven path before
  // falling through to the legacy candidate path. The knowledge path
  // returns `null` whenever it cannot produce a result (no urlHint /
  // no Knowledge row / build refused / low confidence) so the legacy
  // path remains the safety net for the V25 GitHub/npmjs Gate B
  // fixtures.
  if (input.dataNeed && input.knowledgeRepo) {
    const knowledgeResult = await tryKnowledgeDrivenPath(input);
    if (knowledgeResult) return knowledgeResult;
  }

  if (!input.candidate) {
    return short({
      executionMode: 'skipped_no_candidate',
      decisionReason: 'endpoint_not_resolved',
      endpointFamily: null,
      candidateConfidence: null,
    });
  }

  if (input.candidate.confidence < threshold) {
    return short({
      executionMode: 'skipped_low_confidence',
      decisionReason: 'endpoint_low_confidence',
      endpointFamily: input.candidate.endpointFamily,
      candidateConfidence: input.candidate.confidence,
    });
  }

  const reader: ApiKnowledgeReadResult = await readApiKnowledgeRows({
    endpointFamily: input.candidate.endpointFamily,
    method: input.candidate.method,
    params: input.candidate.params,
    fetchFn: input.fetchFn,
    nowMs: input.nowMs,
    limit: input.limit,
  });

  if (reader.status === 'ok') {
    return {
      executionMode: 'direct_api',
      decisionReason: 'endpoint_knowledge_high_confidence',
      browserNavigationSkipped: true,
      readPageAvoided: true,
      endpointFamily: reader.endpointFamily,
      candidateConfidence: input.candidate.confidence,
      apiTelemetry: reader.telemetry,
      fallbackCause: null,
      fallbackEntryLayer: null,
      readerMode: 'legacy_candidate',
      knowledgeEndpointId: null,
      endpointPattern: null,
      endpointSemanticType: null,
      requestShapeUsed: null,
      semanticValidation: null,
      rows: {
        rows: reader.rows,
        rowCount: reader.rowCount,
        compact: true,
        rawBodyStored: false,
        dataPurpose: reader.dataPurpose,
      },
    };
  }

  return {
    executionMode: 'fallback_required',
    decisionReason: `api_call_failed_${reader.reason}` as DirectApiDecisionReason,
    browserNavigationSkipped: false,
    readPageAvoided: false,
    endpointFamily: reader.endpointFamily ?? input.candidate.endpointFamily,
    candidateConfidence: input.candidate.confidence,
    apiTelemetry: reader.telemetry,
    fallbackCause: reader.reason,
    fallbackEntryLayer: reader.fallbackEntryLayer,
    readerMode: 'legacy_candidate',
    knowledgeEndpointId: null,
    endpointPattern: null,
    endpointSemanticType: null,
    requestShapeUsed: null,
    semanticValidation: null,
    rows: null,
  };
}

/**
 * V26-FIX-04 — knowledge-driven entry path. Returns `null` when the
 * caller's {@link DataNeed} cannot be resolved against the
 * Knowledge repository; the executor then falls through to the
 * pre-FIX-04 legacy candidate path. Returns a fully-formed
 * `DirectApiExecutionResult` whenever the lookup hits with high
 * confidence — even when the underlying fetch fails (in which case
 * the result is `executionMode='fallback_required'` with the
 * knowledge-driven evidence still attached).
 */
async function tryKnowledgeDrivenPath(
  input: DirectApiExecutorInput,
): Promise<DirectApiExecutionResult | null> {
  const dataNeed = input.dataNeed;
  const repo = input.knowledgeRepo;
  if (!dataNeed || !repo) return null;

  const match = lookupEndpointFamily(dataNeed, repo);
  if (!match) return null;
  if (match.score < KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR) return null;

  const plan = buildSafeRequest(match, dataNeed);
  if (!plan) return null;

  const reader = await readKnowledgeDrivenEndpoint({
    match,
    plan,
    seedParams: dataNeed.params as Record<string, string | number | null | undefined> | undefined,
    fetchFn: input.fetchFn,
    nowMs: input.nowMs,
    limit: input.limit,
  });

  const baseTelemetry = {
    readerMode: 'knowledge_driven' as const,
    knowledgeEndpointId: match.endpoint.endpointId,
    endpointPattern: match.endpoint.urlPattern,
    endpointSemanticType: match.endpoint.semanticType,
    requestShapeUsed: plan.requestShapeUsed,
    semanticValidation: match.semanticValidation,
    candidateConfidence: match.score,
  };

  if (reader.status === 'ok') {
    return {
      executionMode: 'direct_api',
      decisionReason: 'endpoint_knowledge_high_confidence',
      browserNavigationSkipped: true,
      readPageAvoided: true,
      endpointFamily: match.endpoint.family,
      apiTelemetry: reader.telemetry,
      fallbackCause: null,
      fallbackEntryLayer: null,
      ...baseTelemetry,
      rows: {
        rows: reader.rows,
        rowCount: reader.rowCount,
        compact: true,
        rawBodyStored: false,
        dataPurpose: plan.dataPurpose,
      },
    };
  }

  return {
    executionMode: 'fallback_required',
    decisionReason: `api_call_failed_${reader.reason}` as DirectApiDecisionReason,
    browserNavigationSkipped: false,
    readPageAvoided: false,
    endpointFamily: match.endpoint.family,
    apiTelemetry: reader.telemetry,
    fallbackCause: reader.reason,
    fallbackEntryLayer: reader.fallbackEntryLayer,
    ...baseTelemetry,
    rows: null,
  };
}

interface ShortCircuitInput {
  executionMode: Exclude<DirectApiExecutionMode, 'direct_api' | 'fallback_required'>;
  decisionReason: DirectApiDecisionReason;
  endpointFamily: string | null;
  candidateConfidence: number | null;
}

function short(input: ShortCircuitInput): DirectApiExecutionResult {
  return {
    executionMode: input.executionMode,
    decisionReason: input.decisionReason,
    browserNavigationSkipped: false,
    readPageAvoided: false,
    endpointFamily: input.endpointFamily,
    candidateConfidence: input.candidateConfidence,
    apiTelemetry: null,
    fallbackCause: null,
    fallbackEntryLayer: null,
    readerMode: null,
    knowledgeEndpointId: null,
    endpointPattern: null,
    endpointSemanticType: null,
    requestShapeUsed: null,
    semanticValidation: null,
    rows: null,
  };
}
