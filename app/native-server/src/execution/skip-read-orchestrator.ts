/**
 * V26-03 (B-026) — Skip-Read Execution Orchestrator.
 *
 * Pure module. Converts a {@link LayerSourceRoute} (already decided
 * upstream by V26-04 `dispatchLayer` and recorded into the task
 * session context by `choose_context`) into an explicit skip-or-fall
 * back execution plan for the `chrome_read_page` hot path.
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
 *      consumes a decision that `choose_context` (V26-04) has
 *      explicitly written into the {@link TaskSessionContext}. Absent
 *      a recorded decision the caller MUST keep the legacy v2.5
 *      pathway (forward to `chrome_read_page`).
 *
 *   3. `experience_replay_skip_read` only resolves to `action='skip'`
 *      when the recorded choose_context decision attached an
 *      executable replay candidate that ALSO passed the policy /
 *      portable-args gate. Any missing field collapses to
 *      `action='fallback_required'` with a precise `fallbackCause`.
 *
 *   4. `api_list` / `api_detail` are not yet first-class enum members
 *      of {@link LayerSourceRoute}; V26-08 will land that migration.
 *      Until V26-07/08 wire the API capability layer, every API-class
 *      route resolves to `action='fallback_required'` with cause
 *      `'api_layer_not_available'`.
 *
 *   5. The fallback layer is ALWAYS `'L0' | 'L0+L1'` — never
 *      `'L0+L1+L2'`. This holds even when the upstream dispatcher
 *      asked for full layers. V4.1 §0.1 + §6: a skipped read must
 *      not silently widen back to a full DOM read on failure.
 *
 *   6. The orchestrator is fail-soft. Any unrecognised or absent
 *      input falls through to `action='forward'` so the v2.5 happy
 *      path is preserved bit-identical when in doubt.
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
 * `app/native-server/src/benchmark/v26-benchmark.ts` so V26-06's
 * NDJSON emitter can attach the `chosenSource` field directly off
 * this value.
 */
export type SkipReadSourceKind = 'experience_replay' | 'api_list' | 'api_detail' | 'dom_json';

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
 * Execution snapshot from `choose_context` (V26-04). The orchestrator
 * is the only consumer. The caller is responsible for producing
 * `replayCandidate` and `apiCapability` from authoritative sources
 * (Experience repository / V26-07 capability allowlist) before
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
    /** True iff portable args resolution succeeded (V25-04). */
    portableArgsOk: boolean;
    /** True iff policy / capability gates passed (V25-04). */
    policyOk: boolean;
  } | null;
  /**
   * Set ONLY by V26-08 once `knowledge_call_api` is wired. Until
   * then the chooser leaves it `false` / unset and the orchestrator
   * forces `'fallback_required' / 'api_layer_not_available'` on every
   * `api_list` / `api_detail` route.
   */
  apiCapability?: {
    available: boolean;
    /** Endpoint family, e.g. `'github_search_repositories'`. */
    family: string;
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
   * V26-09 will consume this signal to start a replay run.
   */
  requiresExperienceReplay: boolean;
  /**
   * Diagnostic — surfaced into telemetry / smoke output. Always
   * non-empty so operators can tell which branch fired without
   * cross-referencing the source route enum.
   */
  diagnostic: string;
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
 *         `api_list` (V26-08 wires this).
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

  if (taskCtx.readPageCount >= taskCtx.readBudget) {
    return forwardPlan({
      sourceRoute: decision.sourceRoute,
      fallbackEntryLayer,
      action: 'forward',
      diagnostic: `forward: read budget already exhausted (${taskCtx.readPageCount}/${taskCtx.readBudget})`,
      fallbackCause: 'budget_exhausted',
    });
  }

  switch (decision.sourceRoute) {
    case 'experience_replay_skip_read':
      return planExperienceReplay(decision, fallbackEntryLayer);

    case 'knowledge_supported_read':
      return planKnowledgeBacked(decision, fallbackEntryLayer);

    case 'read_page_required':
      return forwardPlan({
        sourceRoute: decision.sourceRoute,
        fallbackEntryLayer,
        action: 'forward',
        diagnostic: 'forward: dispatcher requires a real chrome_read_page call',
        fallbackCause: '',
      });

    case 'dispatcher_fallback_safe':
      return forwardPlan({
        sourceRoute: decision.sourceRoute,
        fallbackEntryLayer,
        action: 'forward',
        diagnostic: 'forward: dispatcher returned the fail-safe row',
        fallbackCause: '',
      });

    default:
      // Defensive — the LayerSourceRoute enum is closed today, but a
      // future migration (V26-08 promoting `api_list` to first-class)
      // will pass through here before the switch is updated. We keep
      // the v2.5 happy path bit-identical.
      return forwardPlan({
        sourceRoute: decision.sourceRoute,
        fallbackEntryLayer,
        action: 'forward',
        diagnostic: `forward: unknown sourceRoute '${String(decision.sourceRoute)}'`,
        fallbackCause: 'unknown_source_route',
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
  };
}

// ---------------------------------------------------------------------------
// Internal — branch helpers
// ---------------------------------------------------------------------------

function planExperienceReplay(
  decision: ChooseContextDecisionSnapshot,
  fallbackEntryLayer: 'L0' | 'L0+L1',
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
  };
}

function planKnowledgeBacked(
  decision: ChooseContextDecisionSnapshot,
  fallbackEntryLayer: 'L0' | 'L0+L1',
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
        'fallback_required: knowledge_supported_read recorded but knowledge_call_api capability is not yet wired (V26-07/08)',
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
  };
}

function forwardPlan(args: {
  sourceRoute: LayerSourceRoute;
  fallbackEntryLayer: 'L0' | 'L0+L1';
  action: 'forward';
  diagnostic: string;
  fallbackCause: SkipReadFallbackCause;
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
  };
}

/**
 * Hard cap on the layer we authorise for any DOM fallback. The
 * dispatcher may have decided `'L0+L1+L2'` is "right" for the page,
 * but a skip-failure or capability-gap fallback MUST NOT silently
 * widen to L2 — that is the exact regression V26-03 exists to
 * prevent. V4.1 §0.1.
 */
function clampFallbackLayer(chosen: ReadPageRequestedLayer): 'L0' | 'L0+L1' {
  return chosen === 'L0' ? 'L0' : 'L0+L1';
}

function clampTokens(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
