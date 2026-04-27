/**
 * V27-02 — synthetic observer-overhead micro-bench.
 *
 * The real `observerOverheadWithinBudget` Gate evidence requires a live
 * browser session and is owner-lane (SoT §7.1). This test only checks
 * the in-process collector's per-event cost stays well below the
 * V27-00 budget on a synthetic workload, which catches an obvious O(n²)
 * regression without claiming the Gate verdict.
 *
 * The threshold is intentionally generous so flakey CI hardware does
 * not cause spurious failures; the goal is to detect order-of-magnitude
 * drift, not microsecond precision.
 */

import { OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT } from './latency-budget';
import { createFactCollector } from './v27-fact-collector';
import type { BrowserFactSnapshotEnvelope } from '@tabrix/shared';

function makeEnvelope(seq: number): BrowserFactSnapshotEnvelope {
  return {
    factSnapshotId: `snap-${seq % 32}`,
    observedAtMs: seq,
    payload: {
      eventKind: 'network_request',
      fact: {
        method: 'GET',
        host: 'example.test',
        pathPattern: '/api/items',
        queryKeys: ['page'],
        status: 200,
        resourceType: 'xmlhttprequest',
        contentType: 'application/json',
        sizeClass: 'small',
        timingMs: 42,
        noiseClass: 'usable',
        observedAtMs: seq,
      },
      tabId: seq % 8,
      urlPattern: 'example.test/api/items',
      sessionId: `sess-${seq % 4}`,
    },
  };
}

describe('v27-fact-collector — synthetic per-event overhead', () => {
  it('stays within an order of magnitude of the V27-00 budget', () => {
    const collector = createFactCollector({ now: () => 0 });
    const N = 1_000;

    // Warmup so a JIT cold start does not skew the average.
    for (let i = 0; i < 100; i++) {
      collector.ingestFactObservation(makeEnvelope(i));
    }

    const start = performance.now();
    for (let i = 0; i < N; i++) {
      collector.ingestFactObservation(makeEnvelope(i + 1_000));
    }
    const elapsed = performance.now() - start;
    const perEventMs = elapsed / N;

    // Budget is 5 ms/event; we expect well under that on any modern
    // machine, but allow 10x headroom so noisy CI does not flake. If
    // this ever fires, profile before raising the multiplier.
    expect(OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT).toBeGreaterThan(0);
    expect(perEventMs).toBeLessThan(OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT * 10);
  });
});
