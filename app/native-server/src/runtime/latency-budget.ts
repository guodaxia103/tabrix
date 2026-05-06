/**
 * Tabrix latency / budget constants.
 *
 * SoT: `.claude/strategy/TABRIX_V2_7_CONTRACT_V1_zh.md` §5.
 *
 * The constants in this module are pinned by `latency-budget.test.ts`
 * as a snapshot. Bumping any value MUST happen in the same commit as
 * the product task that justifies it.
 *
 * Some constants are reported by deterministic tests, while the
 * real-browser gates consume the same values as acceptance evidence.
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

/** Default total wait budget per executable budget. */
export const WAIT_MS_BUDGET_DEFAULT = 8000 as const;

/** Default total retry budget per executable budget. */
export const RETRY_COUNT_BUDGET_DEFAULT = 2 as const;

/**
 * Closed-enum complexity-kind tuples that v2.7 treats as "heavy"
 * route transitions (where the executable budget should switch to
 * the alternate fallback chain instead of retrying the same path).
 *
 * Each tuple is `[fromComplexityKind, toComplexityKind]`. The list is
 * pinned by the snapshot test; adding a tuple MUST cite the product
 * reason in the commit body so a "heavy" reclassification has a paper trail.
 *
 * The list is declared centrally so runtime and benchmark code do not
 * re-define the contract.
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
