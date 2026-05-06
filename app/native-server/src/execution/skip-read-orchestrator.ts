/**
 * Skip-Read Execution Orchestrator.
 *
 * Pure module. Converts a {@link LayerSourceRoute} (already decided
 * upstream by `dispatchLayer` and recorded into the task session context by
 * `choose_context`) into an explicit skip-or-fallback execution plan for the
 * `chrome_read_page` hot path.
 *
 * Hard contracts (per session corrections #2/#3/#4):
 *
 *   1. The orchestrator NEVER manufactures a synthetic
 *      `chrome_read_page` compact payload. A `skip` result returns an
 *      explicit `{ readPageAvoided, sourceKind, sourceRoute,
 *      tokensSavedEstimate, fallbackUsed, fallbackEntryLayer }`
 *      structure. Only the DOM fallback path (driven by the caller)
 *      yields a real layered `read_page` payload.
 *
 *   2. The orchestrator CANNOT infer a sourceRoute on its own. It
 *      consumes a decision that `choose_context` has explicitly written into
 *      the {@link TaskSessionContext}. Absent a recorded decision, the caller
 *      MUST keep the legacy pathway (forward to `chrome_read_page`).
 *
 *   3. `experience_replay_skip_read` only resolves to `action='skip'`
 *      when the recorded choose_context decision attached an
 *      executable replay candidate that ALSO passed the policy /
 *      portable-args gate. Any missing field collapses to
 *      `action='fallback_required'` with a precise `fallbackCause`.
 *
 *   4. `api_list` / `api_detail` are capability-gated. Until the API
 *      capability layer is available, every API-class route resolves to
 *      `action='fallback_required'` with cause `'api_layer_not_available'`.
 *
 *   5. The fallback layer is ALWAYS `'L0' | 'L0+L1'` — never
 *      `'L0+L1+L2'`. This holds even when the upstream dispatcher
 *      asked for full layers. V4.1 §0.1 + §6: a skipped read must
 *      not silently widen back to a full DOM read on failure.
 *
 *   6. The orchestrator is fail-soft. Any unrecognised or absent
 *      input falls through to `action='forward'` so the legacy happy path is
 *      preserved when in doubt.
 *
 * No IO. No clock. No process.env reads. State lives only in the
 * caller-supplied {@link SkipReadPlanInput.taskCtx} snapshot.
 */

import type { LayerSourceRoute, ReadPageRequestedLayer } from '@tabrix/shared';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Closed enum of execution sources the orchestrator can route a read
 * to. Mirrors the V4.1 §3.1 source taxonomy plus `dom_json` for
 * "fall through to a real `chrome_read_page` call".
 *
 * Keep in sync with `BenchmarkChosenSource` in
 * `app/native-server/src/benchmark/v26-benchmark.ts` so benchmark emitters can
 * attach the `chosenSource` field directly off this value.
 */
export type SkipReadSourceKind = 'experience_replay' | 'api_list' | 'api_detail' | 'dom_json';

export type DataSourceRouterChosenSource =
  | 'experience_replay'
  | 'api_list'
  | 'api_detail'
  | 'dom_region_rows'
  | 'markdown'
  | 'dom_json';

export interface DataSourceRouterFallbackPlanSnapshot {
  dataSource: 'dom_json';
  entryLayer: 'L0' | 'L0+L1';
  reason: string;
}

/**
 * Closed enum of fallback paths the orchestrator may demand when
 * `action !== 'skip'`. `'none'` is reserved for `action='skip'`
 * itself (no fallback was needed).
 *
 * `'dom_compact'` and `'dom_full'` both imply the caller MUST
 * forward to the actual `chrome_read_page` bridge call; the only
 * difference is the suggested layer envelope.
 */
export type SkipReadFallbackUsed = 'none' | 'dom_compact' | 'dom_full';

/**
 * Closed enum of reasons the orchestrator chose `'fallback_required'`
 * over `'skip'`. Surfaced in telemetry so an operator can tell apart
 * "we tried but the API capability layer is off" from "we tried but
 * no replay candidate matched". Empty string for non-fallback
 * actions.
 */
export type SkipReadFallbackCause =
  | ''
  | 'api_layer_not_available'
  | 'replay_candidate_missing'
  | 'replay_policy_denied'
  | 'replay_portable_args_missing'
  | 'budget_exhausted'
  | 'unknown_source_route';

export type SkipReadAction = 'skip' | 'fallback_required' | 'forward';

/**
 * Execution snapshot from `choose_context`. The orchestrator
 * is the only consumer. The caller is responsible for producing
 * `replayCandidate` and `apiCapability` from authoritative sources
 * (Experience repository / capability allowlist) before
 * writing the decision into the task context — the orchestrator does
 * not rewalk those sources.
 */
export interface ChooseContextDecisionSnapshot {
  sourceRoute: LayerSourceRoute;
  chosenLayer: ReadPageRequestedLayer;
  /**
   * Best-effort token cost of a full DOM read at this layer; used to
   * compute `tokensSavedEstimate` when a skip happens. 0 means the
   * dispatcher did not have a byte-length estimate and the saved
   * estimate is also 0 (honest budget — never invent savings we
   * cannot ground in input data).
   */
  fullReadTokenEstimate: number;
  /**
   * Set ONLY when `sourceRoute === 'experience_replay_skip_read'`
   * AND the chooser confirmed an executable candidate existed at
   * decision time. The orchestrator double-checks the policy /
   * portable-args bits below; both must be `true` for `action='skip'`.
   */
  replayCandidate?: {
    actionPathId: string;
    /** True iff portable args resolution succeeded. */
    portableArgsOk: boolean;
    /** True iff policy / capability gates passed. */
    policyOk: boolean;
  } | null;
  /**
   * Set only once `knowledge_call_api` is wired. Until then the chooser leaves
   * it `false` / unset and the orchestrator forces
   * `'fallback_required' / 'api_layer_not_available'` on every
   * `api_list` / `api_detail` route.
   */
  apiCapability?: {
    available: boolean;
    /** Endpoint family, e.g. `'github_search_repositories'`. */
    family: string;
    /** API data purpose from the internal reader. */
    dataPurpose?: string;
    /** Redacted request params for the internal reader. */
    params?: Record<string, string>;
  } | null;
  chosenSource?: DataSourceRouterChosenSource;
  dataSource?: DataSourceRouterChosenSource;
  decisionReason?: string;
  dispatcherInputSource?: string;
  fallbackPlan?: DataSourceRouterFallbackPlanSnapshot;
  /**
   * Closed-enum execution mode the chooser already resolved (NOT a
   * re-runnable hint). `'direct_api'` means
   * `tabrix_choose_context` itself fetched the API rows inline;
   * downstream `chrome_read_page` (if it still fires) MUST treat
   * the read as already satisfied. `'via_read_page'` (default for
   * every legacy call site) means the chooser left execution to the
   * existing chrome_read_page shim path. The orchestrator only
   * forwards this onto the {@link SkipReadPlan} so the operation-log
   * / telemetry side can write a single closed-enum value rather than
   * re-deriving the mode from row counts.
   */
  executionMode?: 'direct_api' | 'via_read_page';
  /**
   * Cached direct-API rows the chooser produced inline.
   * Present iff `executionMode === 'direct_api'` AND the chooser's
   * direct-api-executor returned `executionMode='direct_api'`.
   * Downstream `chrome_read_page` (if it still fires) MUST consume
   * these rows verbatim instead of re-issuing a network fetch — that
   * keeps one user-visible task to one API round-trip, not two. The
   * orchestrator does not inspect this
   * field; it is the read-side shim's responsibility to short-circuit
   * its `requiresApiCall` branch when this is set.
   */
  directApiResult?: {
    endpointFamily: string;
    dataPurpose: string;
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    /** Always `true` — direct-api-executor never persists raw bodies. */
    compact: true;
    /** Always `false` — direct-api-executor never persists raw bodies. */
    rawBodyStored: false;
    /**
     * `true` iff the upstream reader returned ok with an empty row list.
     * Threaded verbatim from the executor so the chrome_read_page shim can
     * mark the cached envelope as "verified empty" without re-issuing the
     * network fetch.
     */
    emptyResult: boolean;
    /** Closed-enum reason; `null` on the non-empty path. */
    emptyReason: 'no_matching_records' | null;
    /** Human-readable message; `null` on the non-empty path. */
    emptyMessage: string | null;
    /**
     * Closed-enum lineage marker carried verbatim from the executor.
     * Surfaced here so the read-side shim can pipe it onto the
     * `chrome_read_page` `kind:'api_rows'` envelope without re-deriving it
     * from the endpoint-family string. `null` on every short-circuit branch
     * where no reader was reached.
     */
    endpointSource: 'observed' | 'seed_adapter' | 'manual_seed' | null;
    /** Underlying API telemetry forwarded from the reader. */
    telemetry: {
      endpointFamily?: string;
      method: string;
      reason: string;
      status: number | null;
      waitedMs: number;
      readAllowed: boolean;
      fallbackEntryLayer: 'L0+L1' | 'none';
    };
  } | null;
}

/**
 * Read-only snapshot of {@link TaskSessionContext} fields the
 * orchestrator inspects. Passed in directly so the orchestrator
 * stays pure (no instance dependency) and tests do not need to
 * stand up a full `TaskSessionContext`.
 */
export interface TaskCtxSnapshot {
  readPageCount: number;
  readBudget: number;
  lastReadLayer: ReadPageRequestedLayer | null;
  currentUrl: string | null;
}

export interface SkipReadPlanInput {
  decision: ChooseContextDecisionSnapshot;
  taskCtx: TaskCtxSnapshot;
}

export interface SkipReadPlan {
  action: SkipReadAction;
  /** True only when `action === 'skip'`. */
  readPageAvoided: boolean;
  /** Source attributed to the (possibly avoided) read. */
  sourceKind: SkipReadSourceKind;
  /**
   * The dispatcher-decided source route the orchestrator consumed.
   * Echoed back so telemetry consumers do not have to re-correlate
   * the decision and the orchestrator output.
   */
  sourceRoute: LayerSourceRoute;
  /** Token cost the skip avoided. `0` for non-skip actions. */
  tokensSavedEstimate: number;
  /**
   * Which DOM fallback path the caller MUST take when
   * `action !== 'skip'`. `'none'` only when `action === 'skip'`.
   */
  fallbackUsed: SkipReadFallbackUsed;
  /**
   * Layer the caller MUST request when it forwards to
   * `chrome_read_page`. Always `'L0'` or `'L0+L1'` — the
   * orchestrator never authorises `'L0+L1+L2'` regardless of what
   * the dispatcher chose. V4.1 §0.1 hard rule.
   */
  fallbackEntryLayer: 'L0' | 'L0+L1';
  /** `''` when `action !== 'fallback_required'`. */
  fallbackCause: SkipReadFallbackCause;
  /** True when `'skip'` requires a `knowledge_call_api` invocation. */
  requiresApiCall: boolean;
  /**
   * True when `'skip'` requires the experience replay engine.
   */
  requiresExperienceReplay: boolean;
  /**
   * Diagnostic — surfaced into telemetry / smoke output. Always
   * non-empty so operators can tell which branch fired without
   * cross-referencing the source route enum.
   */
  diagnostic: string;
  /**
   * Closed-enum execution mode echoed from the recorded
   * `ChooseContextDecisionSnapshot`. `'via_read_page'` is the default;
   * `'direct_api'` surfaces only when the chooser already executed the API
   * inline AND the upstream caller still chose to send `chrome_read_page` (in
   * which case the shim must short-circuit because the rows are already on
   * the wire). The orchestrator never DECIDES this mode: it copies what the
   * chooser wrote.
   */
  executionMode: 'direct_api' | 'via_read_page';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a recorded `choose_context` decision + task-context
 * snapshot into a skip-or-forward plan.
 *
 * Decision tree (top-to-bottom; first match wins):
 *
 *   1. Budget exhausted (`readPageCount >= readBudget`) →
 *      `forward` + `'budget_exhausted'`. The downstream
 *      `shouldAllowReadPage` gate will turn the forward into a
 *      structured warning; the orchestrator does not duplicate
 *      that gate's response shape.
 *
 *   2. `'experience_replay_skip_read'`:
 *      a. No `replayCandidate` recorded → `'fallback_required'`
 *         + `'replay_candidate_missing'`.
 *      b. `policyOk === false`              → `'fallback_required'`
 *         + `'replay_policy_denied'`.
 *      c. `portableArgsOk === false`         → `'fallback_required'`
 *         + `'replay_portable_args_missing'`.
 *      d. All gates pass                    → `'skip'` via
 *         `experience_replay`.
 *
 *   3. `'knowledge_supported_read'`:
 *      a. `apiCapability.available === true` → `'skip'` via
 *         `api_list`.
 *      b. otherwise                         → `'fallback_required'`
 *         + `'api_layer_not_available'`.
 *
 *   4. `'read_page_required'` /
 *      `'dispatcher_fallback_safe'`         → `'forward'` via
 *      `dom_json`.
 *
 *   5. Anything else                         → `'forward'` via
 *      `dom_json` + diagnostic
 *      `'unknown_source_route'`.
 */
export function planSkipRead(input: SkipReadPlanInput): SkipReadPlan {
  const { decision, taskCtx } = input;
  const fallbackEntryLayer = clampFallbackLayer(decision.chosenLayer);
  const executionMode = pickExecutionMode(decision);

  if (taskCtx.readPageCount >= taskCtx.readBudget) {
    return forwardPlan({
      sourceRoute: decision.sourceRoute,
      fallbackEntryLayer,
      action: 'forward',
      diagnostic: `forward: read budget already exhausted (${taskCtx.readPageCount}/${taskCtx.readBudget})`,
      fallbackCause: 'budget_exhausted',
      executionMode,
    });
  }

  switch (decision.sourceRoute) {
    case 'experience_replay_skip_read':
      return planExperienceReplay(decision, fallbackEntryLayer, executionMode);

    case 'knowledge_supported_read':
      return planKnowledgeBacked(decision, fallbackEntryLayer, executionMode);

    case 'read_page_required':
      return forwardPlan({
        sourceRoute: decision.sourceRoute,
        fallbackEntryLayer,
        action: 'forward',
        diagnostic: 'forward: dispatcher requires a real chrome_read_page call',
        fallbackCause: '',
        executionMode,
      });

    case 'dispatcher_fallback_safe':
      return forwardPlan({
        sourceRoute: decision.sourceRoute,
        fallbackEntryLayer,
        action: 'forward',
        diagnostic: 'forward: dispatcher returned the fail-safe row',
        fallbackCause: '',
        executionMode,
      });

    default:
      // Defensive: the LayerSourceRoute enum is closed today, but a future
      // source-route migration will pass through here before the switch is
      // updated. We keep the legacy happy path intact.
      return forwardPlan({
        sourceRoute: decision.sourceRoute,
        fallbackEntryLayer,
        action: 'forward',
        diagnostic: `forward: unknown sourceRoute '${String(decision.sourceRoute)}'`,
        fallbackCause: 'unknown_source_route',
        executionMode,
      });
  }
}

/**
 * Stricter follow-up plan when a `'skip'` execution path failed at
 * runtime (replay verifier rejected, API call returned 5xx, etc.).
 *
 * Hard rule (V4.1 §0.1 / session correction #2): the failure
 * fallback NEVER widens to `'L0+L1+L2'`. We always re-enter at
 * `'L0+L1'` so the cost cap survives a runaway escalation loop.
 *
 * The returned plan is a `'forward'` against `dom_json` with a
 * diagnostic that pins the original failure reason; the caller is
 * expected to consume `fallbackEntryLayer` when forwarding.
 */
export function escalateAfterSkipFailure(
  plan: SkipReadPlan,
  reason:
    | 'replay_verifier_failed'
    | 'replay_engine_unavailable'
    | 'api_call_failed'
    | 'api_rate_limited',
): SkipReadPlan {
  return {
    action: 'forward',
    readPageAvoided: false,
    sourceKind: 'dom_json',
    sourceRoute: plan.sourceRoute,
    tokensSavedEstimate: 0,
    fallbackUsed: 'dom_compact',
    // Hard cap: never escalate to L0+L1+L2 even if dispatcher would.
    fallbackEntryLayer: 'L0+L1',
    fallbackCause: '',
    requiresApiCall: false,
    requiresExperienceReplay: false,
    diagnostic: `escalate: skip path failed (${reason}); forwarding to chrome_read_page at L0+L1 (never L0+L1+L2)`,
    executionMode: plan.executionMode,
  };
}

// ---------------------------------------------------------------------------
// Internal — branch helpers
// ---------------------------------------------------------------------------

function planExperienceReplay(
  decision: ChooseContextDecisionSnapshot,
  fallbackEntryLayer: 'L0' | 'L0+L1',
  executionMode: 'direct_api' | 'via_read_page',
): SkipReadPlan {
  const candidate = decision.replayCandidate;
  if (!candidate) {
    return {
      action: 'fallback_required',
      readPageAvoided: false,
      sourceKind: 'dom_json',
      sourceRoute: decision.sourceRoute,
      tokensSavedEstimate: 0,
      fallbackUsed: 'dom_compact',
      fallbackEntryLayer,
      fallbackCause: 'replay_candidate_missing',
      requiresApiCall: false,
      requiresExperienceReplay: false,
      diagnostic:
        'fallback_required: experience_replay_skip_read recorded but no executable replay candidate was attached to the choose_context decision',
      executionMode,
    };
  }
  if (!candidate.policyOk) {
    return {
      action: 'fallback_required',
      readPageAvoided: false,
      sourceKind: 'dom_json',
      sourceRoute: decision.sourceRoute,
      tokensSavedEstimate: 0,
      fallbackUsed: 'dom_compact',
      fallbackEntryLayer,
      fallbackCause: 'replay_policy_denied',
      requiresApiCall: false,
      requiresExperienceReplay: false,
      diagnostic: `fallback_required: replay candidate ${candidate.actionPathId} blocked by policy/capability gate`,
      executionMode,
    };
  }
  if (!candidate.portableArgsOk) {
    return {
      action: 'fallback_required',
      readPageAvoided: false,
      sourceKind: 'dom_json',
      sourceRoute: decision.sourceRoute,
      tokensSavedEstimate: 0,
      fallbackUsed: 'dom_compact',
      fallbackEntryLayer,
      fallbackCause: 'replay_portable_args_missing',
      requiresApiCall: false,
      requiresExperienceReplay: false,
      diagnostic: `fallback_required: replay candidate ${candidate.actionPathId} missing stable portable args`,
      executionMode,
    };
  }
  return {
    action: 'skip',
    readPageAvoided: true,
    sourceKind: 'experience_replay',
    sourceRoute: decision.sourceRoute,
    tokensSavedEstimate: clampTokens(decision.fullReadTokenEstimate),
    fallbackUsed: 'none',
    fallbackEntryLayer,
    fallbackCause: '',
    requiresApiCall: false,
    requiresExperienceReplay: true,
    diagnostic: `skip: replay candidate ${candidate.actionPathId} eligible (policy + portable args ok)`,
    executionMode,
  };
}

function planKnowledgeBacked(
  decision: ChooseContextDecisionSnapshot,
  fallbackEntryLayer: 'L0' | 'L0+L1',
  executionMode: 'direct_api' | 'via_read_page',
): SkipReadPlan {
  const cap = decision.apiCapability;
  if (!cap || cap.available !== true) {
    return {
      action: 'fallback_required',
      readPageAvoided: false,
      sourceKind: 'dom_json',
      sourceRoute: decision.sourceRoute,
      tokensSavedEstimate: 0,
      fallbackUsed: 'dom_compact',
      fallbackEntryLayer,
      fallbackCause: 'api_layer_not_available',
      requiresApiCall: false,
      requiresExperienceReplay: false,
      diagnostic:
        'fallback_required: knowledge_supported_read recorded but knowledge_call_api capability is not yet wired',
      executionMode,
    };
  }
  return {
    action: 'skip',
    readPageAvoided: true,
    sourceKind: 'api_list',
    sourceRoute: decision.sourceRoute,
    tokensSavedEstimate: clampTokens(decision.fullReadTokenEstimate),
    fallbackUsed: 'none',
    fallbackEntryLayer,
    fallbackCause: '',
    requiresApiCall: true,
    requiresExperienceReplay: false,
    diagnostic: `skip: knowledge_call_api family ${cap.family} available; bypassing chrome_read_page`,
    executionMode,
  };
}

function forwardPlan(args: {
  sourceRoute: LayerSourceRoute;
  fallbackEntryLayer: 'L0' | 'L0+L1';
  action: 'forward';
  diagnostic: string;
  fallbackCause: SkipReadFallbackCause;
  executionMode: 'direct_api' | 'via_read_page';
}): SkipReadPlan {
  return {
    action: 'forward',
    readPageAvoided: false,
    sourceKind: 'dom_json',
    sourceRoute: args.sourceRoute,
    tokensSavedEstimate: 0,
    fallbackUsed: 'dom_compact',
    fallbackEntryLayer: args.fallbackEntryLayer,
    fallbackCause: args.fallbackCause,
    requiresApiCall: false,
    requiresExperienceReplay: false,
    diagnostic: args.diagnostic,
    executionMode: args.executionMode,
  };
}

/**
 * Pick the executionMode the chooser already wrote onto the decision,
 * defaulting to `'via_read_page'` for callers that did not execute the API
 * inline. Only the direct-execute branch sets `'direct_api'`.
 */
function pickExecutionMode(
  decision: ChooseContextDecisionSnapshot,
): 'direct_api' | 'via_read_page' {
  return decision.executionMode === 'direct_api' ? 'direct_api' : 'via_read_page';
}

/**
 * Hard cap on the layer we authorise for any DOM fallback. The
 * dispatcher may have decided `'L0+L1+L2'` is "right" for the page,
 * but a skip-failure or capability-gap fallback MUST NOT silently
 * widen to L2.
 */
function clampFallbackLayer(chosen: ReadPageRequestedLayer): 'L0' | 'L0+L1' {
  return chosen === 'L0' ? 'L0' : 'L0+L1';
}

function clampTokens(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
