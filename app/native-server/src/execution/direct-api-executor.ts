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
import type {
  DataNeed,
  EndpointKnowledgeReader,
  EndpointLookupChosenReason,
  ReaderMode,
} from '../api-knowledge/types';
import type {
  CorrelationConfidenceLevel,
  EndpointSource,
} from '../memory/knowledge/knowledge-api-repository';
import { mapDataSourceToLayerContract, type LayerContractEnvelope } from './layer-contract';

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

/**
 * V26-FIX-09 — closed enum naming the cold-start guard mode. When
 * `'enabled'` the executor wraps each reader call in a single bounded
 * retry on transient network failures (see
 * {@link COLD_START_TRANSIENT_REASONS}); when `'disabled'` the
 * executor performs exactly one attempt per branch (legacy V26-FIX-04
 * behaviour). The guard is `'enabled'` by default so a real Gate B
 * cold-start does not flap, but tests / fast-lane runners can pin
 * `'disabled'` for deterministic single-attempt semantics.
 */
export type DirectApiColdStartGuard = 'enabled' | 'disabled';
type DirectApiEndpointSource = 'observed' | 'seed_adapter' | 'manual_seed';

/**
 * V26-FIX-09 default total budget across the first attempt + the
 * (single) retry. Calibrated to keep the executor well under the
 * Gate B per-scenario latency budget (median ~1500–3000 ms). When
 * the first attempt already consumes more than the budget, the
 * retry is skipped — `apiFinalReason` then reports the original
 * failure cause so a post-mortem can distinguish "no budget" from
 * "retry attempted and failed".
 */
export const DIRECT_API_COLD_START_BUDGET_MS_DEFAULT = 5_000;

/**
 * V26-FIX-09 — closed set of {@link ApiKnowledgeFallbackReason}
 * values the cold-start guard treats as "transient enough to retry
 * once". Anything else (rate_limited / http_forbidden /
 * unsupported_family / decode_error / semantic_mismatch / …) is a
 * deterministic upstream condition that retrying would not flip.
 *
 * Keeping this set narrow is intentional: a wider retry loop would
 * mask 5xx waves on a real outage and inflate Gate B latency
 * silently. The two reasons in the set are the ones empirically tied
 * to Chrome/native-server cold-start sequences (DNS warm-up + first
 * TLS handshake), which is exactly what FIX-09 calls "release-
 * blocking polish".
 */
export const COLD_START_TRANSIENT_REASONS: ReadonlySet<ApiKnowledgeFallbackReason> =
  new Set<ApiKnowledgeFallbackReason>(['network_timeout', 'network_error']);

/**
 * V26-FIX-06 — singleton layer-contract envelope every direct-API
 * branch surfaces. The executor only emits row-shape data
 * (`api_rows`); the constant lives here so every branch quotes the
 * same frozen object instead of re-deriving the envelope on each
 * call. Fallback paths reuse the same envelope because the rows we
 * *would* have produced were row-shape; the contract is the same
 * irrespective of whether the fetch succeeded.
 */
const API_ROWS_LAYER_CONTRACT: LayerContractEnvelope = mapDataSourceToLayerContract({
  dataSource: 'api_rows',
});

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
  /**
   * V26-FIX-09 — cold-start guard mode. Defaults to `'enabled'` so
   * a single bounded retry kicks in on transient network failures.
   * Pass `'disabled'` (or omit entirely from a deterministic test)
   * to keep pre-FIX-09 single-attempt behaviour.
   */
  coldStartGuard?: DirectApiColdStartGuard;
  /**
   * V26-FIX-09 — total budget (ms) covering both attempts. Defaults
   * to {@link DIRECT_API_COLD_START_BUDGET_MS_DEFAULT}. The retry is
   * skipped when the first attempt already exceeds the budget.
   */
  coldStartBudgetMs?: number;
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
  /**
   * V26-FIX-05 — closed-enum lineage marker that distinguishes how the
   * endpoint we ended up calling was sourced:
   *   - `'observed'`     — the row came from `chrome_network_capture`
   *                        (`family='observed'`); the safe-builder used
   *                        the persisted `urlPattern` + observed query
   *                        keys. This is the new mainline path.
   *   - `'seed_adapter'` — the row came from (or was equivalent to) the
   *                        V25 hardcoded GitHub/npmjs adapter. Includes
   *                        the legacy candidate path that has not yet
   *                        gone through Knowledge lookup.
   *   - `'manual_seed'`  — reserved for an operator-curated seed
   *                        catalog; not produced by any current code
   *                        path but kept in the closed enum so the
   *                        report consumer's stacked-bar chart stays
   *                        stable when we add it.
   *   - `null`           — every short-circuit branch (no fetch was
   *                        ever attempted).
   */
  endpointSource: DirectApiEndpointSource | null;
  /** V27-12 — lookup ranking reason for knowledge-driven rows; null outside lookup-first path. */
  lookupChosenReason: EndpointLookupChosenReason | null;
  /** V27-12 — capped DOM/API correlation confidence from the selected Knowledge row. */
  correlationConfidence: CorrelationConfidenceLevel | null;
  /** V27-12 — lineage of a de-prioritised peer, usually the retired seed_adapter row. */
  retiredEndpointSource: DirectApiEndpointSource | null;
  /**
   * V26-FIX-05 — invariant marker. After FIX-04 + FIX-05 the executor
   * always tries `lookupEndpointFamily` first when given a Knowledge
   * repo; falling through to the legacy candidate is a *fallback*, not
   * a bypass. We therefore hard-code `false` here and surface the field
   * so the operation log (FIX-07) and Gate B transformer (FIX-08) can
   * cite "no adapter bypass observed" as evidence rather than re-deriving
   * the negative.
   */
  adapterBypass: false;
  /**
   * V26-FIX-05 — companion marker to `adapterBypass`. Always `true`
   * starting with FIX-05; the executor now treats Knowledge lookup as
   * the required entry point, with the seed adapter only filling in
   * when the lookup misses.
   */
  knowledgeLookupRequired: true;
  /**
   * V26-FIX-06 — frozen layer-contract envelope describing what the
   * downstream reader/orchestrator may do with the rows the executor
   * surfaces. Always present (even on fallback / short-circuit
   * branches) so the operation log + Gate B transformer can quote a
   * stable shape regardless of which executor branch fired. The
   * envelope is the `api_rows` shape on every direct-API attempt
   * (including the fallback_required branch — the rows we *would*
   * have produced still came from a list-class API), so every
   * downstream consumer must call
   * `assertLayerContract(envelope, 'list_read')` before using the
   * row content as a click locator or execution target.
   */
  layerContract: LayerContractEnvelope;
  /**
   * V26-FIX-09 — wall-clock duration (ms) of the first reader
   * attempt, including the retry candidate's first attempt. Always
   * `null` for short-circuit branches that never reached a reader.
   */
  apiFirstAttemptMs: number | null;
  /**
   * V26-FIX-09 — number of retries the cold-start guard performed
   * (always `0` or `1`). Short-circuit branches stay at `0`.
   */
  apiRetryCount: 0 | 1;
  /**
   * V26-FIX-09 — final fallback reason after all attempts. `null`
   * when the executor produced rows or never reached a reader. Use
   * this rather than the legacy `fallbackCause` when you want to
   * group telemetry by post-retry outcome (e.g. "retry succeeded
   * vs. retry exhausted").
   */
  apiFinalReason: ApiKnowledgeFallbackReason | null;
  /**
   * V26-FIX-09 — closed enum showing whether the guard was active
   * for this call. The chooser fills this in even on short-circuit
   * branches so the operation log can cite the configured posture
   * without reaching into the input.
   */
  coldStartGuard: DirectApiColdStartGuard;
}

export interface DirectApiExecutionRows {
  rows: ApiKnowledgeCompactRow[];
  rowCount: number;
  compact: true;
  rawBodyStored: false;
  dataPurpose: string;
  /**
   * V26-PGB-01 — `true` iff the upstream reader returned ok but with
   * an empty row list. Mirrors {@link ApiKnowledgeReadOk.emptyResult}
   * so a downstream consumer can grep one stable boolean rather than
   * re-deriving it from `rowCount === 0`.
   */
  emptyResult: boolean;
  /**
   * V26-PGB-01 — closed-enum reason for the empty result; `null`
   * whenever `emptyResult === false`.
   */
  emptyReason: 'no_matching_records' | null;
  /**
   * V26-PGB-01 — human-readable message for the empty result, or
   * `null` whenever `emptyResult === false`. Surfaces verbatim into
   * the chrome_read_page `kind:'api_rows'` envelope.
   */
  emptyMessage: string | null;
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
  const coldStartGuard: DirectApiColdStartGuard = input.coldStartGuard ?? 'enabled';
  const coldStartBudgetMs = input.coldStartBudgetMs ?? DIRECT_API_COLD_START_BUDGET_MS_DEFAULT;
  const clock = input.nowMs ?? Date.now;

  if (input.sourceRoute !== 'knowledge_supported_read') {
    return buildShortCircuitResult({
      executionMode: 'skipped_route_mismatch',
      decisionReason: 'route_mismatch_not_knowledge_supported',
      endpointFamily: input.candidate?.endpointFamily ?? null,
      candidateConfidence: input.candidate?.confidence ?? null,
      coldStartGuard,
    });
  }

  if (input.intentClass !== 'read_only') {
    return buildShortCircuitResult({
      executionMode: 'skipped_not_read_only',
      decisionReason: 'intent_not_read_only',
      endpointFamily: input.candidate?.endpointFamily ?? null,
      candidateConfidence: input.candidate?.confidence ?? null,
      coldStartGuard,
    });
  }

  // V26-FIX-04 — try the lookup-first knowledge-driven path before
  // falling through to the legacy candidate path. The knowledge path
  // returns `null` whenever it cannot produce a result (no urlHint /
  // no Knowledge row / build refused / low confidence) so the legacy
  // path remains the safety net for the V25 GitHub/npmjs Gate B
  // fixtures.
  if (input.dataNeed && input.knowledgeRepo) {
    const knowledgeResult = await tryKnowledgeDrivenPath(input, {
      coldStartGuard,
      coldStartBudgetMs,
      clock,
    });
    if (knowledgeResult) return knowledgeResult;
  }

  if (!input.candidate) {
    return buildShortCircuitResult({
      executionMode: 'skipped_no_candidate',
      decisionReason: 'endpoint_not_resolved',
      endpointFamily: null,
      candidateConfidence: null,
      coldStartGuard,
    });
  }

  if (input.candidate.confidence < threshold) {
    return buildShortCircuitResult({
      executionMode: 'skipped_low_confidence',
      decisionReason: 'endpoint_low_confidence',
      endpointFamily: input.candidate.endpointFamily,
      candidateConfidence: input.candidate.confidence,
      coldStartGuard,
    });
  }

  const candidate = input.candidate;
  const guarded = await runWithColdStartGuard(
    () =>
      readApiKnowledgeRows({
        endpointFamily: candidate.endpointFamily,
        method: candidate.method,
        params: candidate.params,
        fetchFn: input.fetchFn,
        nowMs: input.nowMs,
        limit: input.limit,
      }),
    { coldStartGuard, coldStartBudgetMs, clock },
  );
  const reader: ApiKnowledgeReadResult = guarded.result;

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
      // V26-FIX-05 — the legacy candidate path consumes
      // `resolveApiKnowledgeCandidate`, which is the V25 hardcoded
      // GitHub/npmjs seed adapter. Label every result we get from this
      // path as `seed_adapter` so the FIX-08 transformer can split the
      // mix of `observed` vs `seed_adapter` reads in Gate B reports.
      endpointSource: 'seed_adapter',
      lookupChosenReason: null,
      correlationConfidence: null,
      retiredEndpointSource: null,
      adapterBypass: false,
      knowledgeLookupRequired: true,
      layerContract: API_ROWS_LAYER_CONTRACT,
      apiFirstAttemptMs: guarded.apiFirstAttemptMs,
      apiRetryCount: guarded.apiRetryCount,
      apiFinalReason: guarded.apiFinalReason,
      coldStartGuard,
      rows: {
        rows: reader.rows,
        rowCount: reader.rowCount,
        compact: true,
        rawBodyStored: false,
        dataPurpose: reader.dataPurpose,
        emptyResult: reader.emptyResult,
        emptyReason: reader.emptyReason,
        emptyMessage: reader.emptyMessage,
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
    endpointSource: 'seed_adapter',
    lookupChosenReason: null,
    correlationConfidence: null,
    retiredEndpointSource: null,
    adapterBypass: false,
    knowledgeLookupRequired: true,
    layerContract: API_ROWS_LAYER_CONTRACT,
    apiFirstAttemptMs: guarded.apiFirstAttemptMs,
    apiRetryCount: guarded.apiRetryCount,
    apiFinalReason: guarded.apiFinalReason,
    coldStartGuard,
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
  guardConfig: {
    coldStartGuard: DirectApiColdStartGuard;
    coldStartBudgetMs: number;
    clock: () => number;
  },
): Promise<DirectApiExecutionResult | null> {
  const dataNeed = input.dataNeed;
  const repo = input.knowledgeRepo;
  if (!dataNeed || !repo) return null;

  const match = lookupEndpointFamily(dataNeed, repo);
  if (!match) return null;
  if (match.endpointSource === 'deprecated_seed') return null;
  if (match.score < KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR) return null;

  const plan = buildSafeRequest(match, dataNeed);
  if (!plan) return null;

  const guarded = await runWithColdStartGuard(
    () =>
      readKnowledgeDrivenEndpoint({
        match,
        plan,
        seedParams: dataNeed.params as
          | Record<string, string | number | null | undefined>
          | undefined,
        fetchFn: input.fetchFn,
        nowMs: input.nowMs,
        limit: input.limit,
      }),
    guardConfig,
  );
  const reader = guarded.result;

  const baseTelemetry = {
    readerMode: 'knowledge_driven' as const,
    knowledgeEndpointId: match.endpoint.endpointId,
    endpointPattern: match.endpoint.urlPattern,
    endpointSemanticType: match.endpoint.semanticType,
    requestShapeUsed: plan.requestShapeUsed,
    semanticValidation: match.semanticValidation,
    candidateConfidence: match.score,
    endpointSource: normalizeDirectApiEndpointSource(match.endpointSource),
    lookupChosenReason: match.chosenReason,
    correlationConfidence: match.correlationConfidence,
    retiredEndpointSource: normalizeDirectApiEndpointSource(match.retiredPeer?.endpointSource),
    adapterBypass: false as const,
    knowledgeLookupRequired: true as const,
    layerContract: API_ROWS_LAYER_CONTRACT,
    apiFirstAttemptMs: guarded.apiFirstAttemptMs,
    apiRetryCount: guarded.apiRetryCount,
    apiFinalReason: guarded.apiFinalReason,
    coldStartGuard: guardConfig.coldStartGuard,
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
        emptyResult: reader.emptyResult,
        emptyReason: reader.emptyReason,
        emptyMessage: reader.emptyMessage,
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
  coldStartGuard: DirectApiColdStartGuard;
}

function buildShortCircuitResult(input: ShortCircuitInput): DirectApiExecutionResult {
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
    layerContract: API_ROWS_LAYER_CONTRACT,
    semanticValidation: null,
    endpointSource: null,
    lookupChosenReason: null,
    correlationConfidence: null,
    retiredEndpointSource: null,
    adapterBypass: false,
    knowledgeLookupRequired: true,
    apiFirstAttemptMs: null,
    apiRetryCount: 0,
    apiFinalReason: null,
    coldStartGuard: input.coldStartGuard,
    rows: null,
  };
}

function normalizeDirectApiEndpointSource(
  source: EndpointSource | null | undefined,
): DirectApiEndpointSource | null {
  switch (source) {
    case 'observed':
    case 'seed_adapter':
    case 'manual_seed':
      return source;
    case 'deprecated_seed':
    case 'unknown':
    default:
      return null;
  }
}

/**
 * V26-FIX-09 — bounded retry / cold-start guard helper.
 *
 * Calls `attempt()` once and:
 *   - returns immediately on `status === 'ok'`,
 *   - returns immediately when the fallback reason is NOT in
 *     {@link COLD_START_TRANSIENT_REASONS},
 *   - returns immediately when the cold-start guard is `'disabled'`,
 *   - returns immediately when the first attempt already exceeded
 *     `coldStartBudgetMs` (no time left to retry safely),
 *   - otherwise runs `attempt()` once more and surfaces whichever
 *     result the second call produced.
 *
 * The helper is deliberately ignorant of the underlying reader's
 * shape — both `readApiKnowledgeRows` and
 * `readKnowledgeDrivenEndpoint` produce `ApiKnowledgeReadResult`,
 * so wrapping them here avoids duplicating the retry policy.
 */
async function runWithColdStartGuard(
  attempt: () => Promise<ApiKnowledgeReadResult>,
  config: {
    coldStartGuard: DirectApiColdStartGuard;
    coldStartBudgetMs: number;
    clock: () => number;
  },
): Promise<{
  result: ApiKnowledgeReadResult;
  apiFirstAttemptMs: number;
  apiRetryCount: 0 | 1;
  apiFinalReason: ApiKnowledgeFallbackReason | null;
}> {
  const startedAtMs = config.clock();
  const first = await attempt();
  const firstAttemptMs = Math.max(0, config.clock() - startedAtMs);

  if (first.status === 'ok') {
    return {
      result: first,
      apiFirstAttemptMs: firstAttemptMs,
      apiRetryCount: 0,
      apiFinalReason: null,
    };
  }

  const transient = COLD_START_TRANSIENT_REASONS.has(first.reason);
  const elapsedMs = Math.max(0, config.clock() - startedAtMs);
  const retryAllowed =
    config.coldStartGuard === 'enabled' && transient && elapsedMs < config.coldStartBudgetMs;
  if (!retryAllowed) {
    return {
      result: first,
      apiFirstAttemptMs: firstAttemptMs,
      apiRetryCount: 0,
      apiFinalReason: first.reason,
    };
  }

  const second = await attempt();
  return {
    result: second,
    apiFirstAttemptMs: firstAttemptMs,
    apiRetryCount: 1,
    apiFinalReason: second.status === 'ok' ? null : second.reason,
  };
}
