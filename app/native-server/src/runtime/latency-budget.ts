/**
 * V27-00 — Tabrix v2.7 Latency / Budget constants.
 *
 * SoT: `.claude/strategy/TABRIX_V2_7_CONTRACT_V1_zh.md` §5.
 *
 * The constants in this module are pinned by `latency-budget.test.ts`
 * as a snapshot. Bumping any value MUST happen in the same commit as
 * the v2.7 task that justifies it (commit body MUST cite the v2.7 task
 * id, e.g. `V27-04`).
 *
 * v2.7 Batch A only declares these constants. Wiring them onto the
 * production execution path lands in:
 *   - V27-02 (`OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT`) — synthetic
 *     micro-bench; not a runtime gate yet.
 *   - V27-15 (`WAIT_MS_BUDGET_DEFAULT`, `RETRY_COUNT_BUDGET_DEFAULT`,
 *     `HEAVY_PATH_SEQUENCES`) — executable budget loop.
 *   - Owner-lane Gate B (`READ_PAGE_AVOIDANCE_TARGET`) — real-browser
 *     evidence only; this batch does not self-certify.
 */

/**
 * Synthetic per-event observer-overhead ceiling (milliseconds). v2.7
 * runs a micro-bench over a fixed-size synthetic event stream and the
 * average per-event cost MUST be <= this constant. NOT a runtime gate.
 */
export const OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT = 5 as const;

/**
 * Owner-lane Gate B target: fraction of simple-page tasks where the
 * production path skips `chrome_read_page` entirely (because the
 * profiler / router selected an alternative). Reported, not enforced
 * by Batch A.
 */
export const READ_PAGE_AVOIDANCE_TARGET = 0.3 as const;

/** Default total wait budget per executable budget (V27-15). */
export const WAIT_MS_BUDGET_DEFAULT = 8000 as const;

/** Default total retry budget per executable budget (V27-15). */
export const RETRY_COUNT_BUDGET_DEFAULT = 2 as const;

/**
 * Closed-enum complexity-kind tuples that v2.7 treats as "heavy"
 * route transitions (where the executable budget should switch to
 * the alternate fallback chain instead of retrying the same path).
 *
 * Each tuple is `[fromComplexityKind, toComplexityKind]`. The list is
 * pinned by the snapshot test; adding a tuple MUST cite the v2.7 task
 * id in the commit body so a "heavy" reclassification has a paper trail.
 *
 * v2.7 Batch A does NOT consult this list on the production path; it is
 * declared so V27-15 can pull it without re-defining the contract.
 */
export const HEAVY_PATH_SEQUENCES = [
  ['document', 'transactional'],
  ['list_or_search', 'document'],
  ['simple', 'complex_app'],
  ['list_or_search', 'complex_app'],
] as const satisfies ReadonlyArray<readonly [string, string]>;

export type LatencyBudgetSnapshot = {
  observerOverheadBudgetMsPerEvent: typeof OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT;
  readPageAvoidanceTarget: typeof READ_PAGE_AVOIDANCE_TARGET;
  waitMsBudgetDefault: typeof WAIT_MS_BUDGET_DEFAULT;
  retryCountBudgetDefault: typeof RETRY_COUNT_BUDGET_DEFAULT;
  heavyPathSequences: typeof HEAVY_PATH_SEQUENCES;
};

/**
 * Snapshot factory used by `latency-budget.test.ts`. Returns a fresh
 * object each call so callers cannot mutate the constants by reference.
 */
export function getLatencyBudgetSnapshot(): LatencyBudgetSnapshot {
  return {
    observerOverheadBudgetMsPerEvent: OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT,
    readPageAvoidanceTarget: READ_PAGE_AVOIDANCE_TARGET,
    waitMsBudgetDefault: WAIT_MS_BUDGET_DEFAULT,
    retryCountBudgetDefault: RETRY_COUNT_BUDGET_DEFAULT,
    heavyPathSequences: HEAVY_PATH_SEQUENCES,
  };
}
