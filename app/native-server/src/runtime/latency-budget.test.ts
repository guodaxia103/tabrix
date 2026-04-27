/**
 * V27-00 — snapshot test pinning the v2.7 latency-budget constants.
 *
 * Goal: any future bump must be a deliberate edit. The diff in this test
 * file IS the audit trail (along with the v2.7 task id in the commit body).
 */
import {
  HEAVY_PATH_SEQUENCES,
  OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT,
  READ_PAGE_AVOIDANCE_TARGET,
  RETRY_COUNT_BUDGET_DEFAULT,
  WAIT_MS_BUDGET_DEFAULT,
  getLatencyBudgetSnapshot,
} from './latency-budget';

describe('V27-00 latency-budget snapshot', () => {
  it('pins the per-event observer-overhead budget', () => {
    expect(OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT).toBe(5);
  });

  it('pins the read-page avoidance Gate-B target', () => {
    expect(READ_PAGE_AVOIDANCE_TARGET).toBe(0.3);
  });

  it('pins the executable-budget defaults', () => {
    expect(WAIT_MS_BUDGET_DEFAULT).toBe(8000);
    expect(RETRY_COUNT_BUDGET_DEFAULT).toBe(2);
  });

  it('pins the heavy-path sequences', () => {
    expect(HEAVY_PATH_SEQUENCES).toEqual([
      ['document', 'transactional'],
      ['list_or_search', 'document'],
      ['simple', 'complex_app'],
      ['list_or_search', 'complex_app'],
    ]);
  });

  it('exposes a fresh snapshot object on each call', () => {
    const a = getLatencyBudgetSnapshot();
    const b = getLatencyBudgetSnapshot();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(a).toEqual({
      observerOverheadBudgetMsPerEvent: 5,
      readPageAvoidanceTarget: 0.3,
      waitMsBudgetDefault: 8000,
      retryCountBudgetDefault: 2,
      heavyPathSequences: HEAVY_PATH_SEQUENCES,
    });
  });
});
