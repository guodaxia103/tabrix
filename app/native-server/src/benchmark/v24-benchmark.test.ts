import * as path from 'node:path';
import {
  BENCHMARK_REPORT_VERSION,
  V23_REPORT_VERSION,
  summariseBenchmarkRunV24,
  type BenchmarkPairRecord,
  type BenchmarkRunInputV24,
  type BenchmarkSummaryV24,
  type BenchmarkToolCallRecordV24,
} from './v24-benchmark';

interface GateModuleV24 {
  BENCHMARK_REPORT_VERSION_EXPECTED: number;
  DEFAULT_BENCHMARK_GATE_THRESHOLDS_V24: {
    maxToolRetryRate: number;
    minScenarioCompletionRate: number;
    minPairCountPerKpiScenario: number;
    warnMinK5SecondTouchSpeedup: number;
    warnMinK6ReplaySuccessRate: number;
    warnMaxK7ReplayFallbackRate: number;
    warnMaxK8TokenSavingRatio: number;
  };
  evaluateBenchmarkGateV24: (summary: unknown, thresholds?: unknown) => string[];
  benchmarkGateAppliesV24: (version: string) => boolean;
  partitionGateReasons: (reasons: string[]) => { hard: string[]; soft: string[] };
  loadAndEvaluateBenchmarkReportV24: (
    filePath: string,
    thresholds?: unknown,
  ) => {
    ok: boolean;
    reasons: string[];
    hardReasons: string[];
    softReasons: string[];
    parseError: string | null;
    summary?: unknown;
  };
}

const gateModule: GateModuleV24 = require(
  path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'v24-benchmark-gate.cjs'),
);

function call(overrides: Partial<BenchmarkToolCallRecordV24> = {}): BenchmarkToolCallRecordV24 {
  return {
    seq: 0,
    scenarioId: 'T5-G-GH-REPO-NAV',
    toolName: 'chrome_click_element',
    status: 'ok',
    durationMs: 100,
    inputTokens: null,
    retryCount: 0,
    fallbackUsed: false,
    lane: 'tabrix_owned',
    ...overrides,
  };
}

function pair(overrides: Partial<BenchmarkPairRecord>): BenchmarkPairRecord {
  return {
    pairIndex: 0,
    scenarioId: 'T5-G-GH-REPO-NAV',
    role: 'first_touch',
    toolCallSeqs: [],
    ...overrides,
  };
}

function run(overrides: Partial<BenchmarkRunInputV24> = {}): BenchmarkRunInputV24 {
  return {
    runId: 'run-v24-1',
    runStartedAt: '2026-04-22T00:00:00Z',
    runEndedAt: '2026-04-22T00:05:00Z',
    buildSha: 'abcd1234',
    kpiScenarioIds: [],
    toolCalls: [],
    scenarios: [],
    pairs: [],
    ...overrides,
  };
}

describe('summariseBenchmarkRunV24 — v23 carryover (V24-05)', () => {
  it('returns deterministic empty report', () => {
    const summary = summariseBenchmarkRunV24(run());
    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.totalScenarios).toBe(0);
    expect(summary.k1MeanInputTokensPerTask).toBeNull();
    expect(summary.k2PerToolLatencyMs).toEqual([]);
    expect(summary.k3TaskSuccessRate).toBeNull();
    expect(summary.k4ToolRetryRate).toBeNull();
    expect(summary.k4FallbackRate).toBeNull();
    expect(summary.readPageProbeCount).toBe(0);
    expect(summary.laneCounters.violationCount).toBe(0);
    expect(summary.meanClickAttemptsPerStep).toBeNull();
    expect(summary.pairs).toEqual([]);
    expect(summary.k5SecondTouchSpeedup).toBeNull();
    expect(summary.k6ReplaySuccessRate).toBeNull();
    expect(summary.k7ReplayFallbackRate).toBeNull();
    expect(summary.k8TokenSavingRatio).toBeNull();
    expect(summary.replayEligibilityDistribution.experience_replay).toBe(0);
    expect(summary.replayEligibilityDistribution.unknown).toBe(0);
  });

  it('K1/K2/K3/K4 carry forward from v23 semantics', () => {
    const summary = summariseBenchmarkRunV24(
      run({
        scenarios: [
          { scenarioId: 'A', completed: true },
          { scenarioId: 'B', completed: false },
        ],
        toolCalls: [
          call({ seq: 0, toolName: 'chrome_read_page', durationMs: 1000, inputTokens: 100 }),
          call({ seq: 1, toolName: 'chrome_read_page', durationMs: 3000, inputTokens: 300 }),
          call({ seq: 2, toolName: 'chrome_click_element', durationMs: 500, retryCount: 1 }),
          call({ seq: 3, toolName: 'chrome_click_element', durationMs: 700, fallbackUsed: true }),
        ],
      }),
    );
    expect(summary.k1MeanInputTokensPerTask).toBe(200);
    expect(summary.k2PerToolLatencyMs).toEqual([
      { toolName: 'chrome_click_element', sampleCount: 2, p50Ms: 600 },
      { toolName: 'chrome_read_page', sampleCount: 2, p50Ms: 2000 },
    ]);
    expect(summary.k3TaskSuccessRate).toBe(0.5);
    expect(summary.k4ToolRetryRate).toBe(0.25);
    expect(summary.k4FallbackRate).toBe(0.25);
  });

  it('lane and click-attempts buckets carry forward', () => {
    const summary = summariseBenchmarkRunV24(
      run({
        toolCalls: [
          call({
            seq: 0,
            lane: 'tabrix_owned',
            toolName: 'chrome_click_element',
            clickAttempts: 1,
          }),
          call({ seq: 1, lane: 'cdp', toolName: 'chrome_click_element', clickAttempts: 3 }),
          call({ seq: 2, lane: 'debugger', toolName: 'chrome_read_page' }),
          call({ seq: 3, lane: 'unknown', toolName: 'chrome_read_page' }),
        ],
      }),
    );
    expect(summary.laneCounters).toEqual({
      tabrixOwnedCount: 1,
      cdpCount: 1,
      debuggerCount: 1,
      unknownCount: 1,
      violationCount: 2,
    });
    expect(summary.meanClickAttemptsPerStep).toBe(2);
    expect(summary.readPageProbeCount).toBe(2);
  });

  it('is deterministic — re-running on the same input yields equal output', () => {
    const input = run({
      scenarios: [{ scenarioId: 'A', completed: true }],
      toolCalls: [call({ seq: 0, inputTokens: 50 }), call({ seq: 1, inputTokens: 100 })],
    });
    const a = summariseBenchmarkRunV24(input);
    const b = summariseBenchmarkRunV24(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('summariseBenchmarkRunV24 — pair-aware K5..K8', () => {
  function pairRun(): BenchmarkRunInputV24 {
    // 3 complete pairs for scenario "S1":
    //   pair 0: first 1000ms / second 500ms (speedup 2.0)
    //   pair 1: first 800ms  / second 200ms (speedup 4.0)
    //   pair 2: first 600ms  / second 300ms (speedup 2.0)
    // pair 0 second-touch: replay (ok) + fallback => K6 = 1/1, K7 = 1/2
    // pair 1 second-touch: replay (failed) + replay (ok) => K6 = 1/2, K7 = 0/2
    // pair 2 second-touch: 2 replays (ok) => K6 = 2/2, K7 = 0/2
    // tokens: pair 0: 100→40 = 0.4 ; pair 1: 200→60 = 0.3 ; pair 2: 300→150 = 0.5
    const calls: BenchmarkToolCallRecordV24[] = [];
    let seq = 0;
    function add(o: Partial<BenchmarkToolCallRecordV24>): number {
      const c = call({ seq, scenarioId: 'S1', ...o });
      calls.push(c);
      return seq++;
    }
    const f0 = add({ durationMs: 1000, inputTokens: 100, chooserStrategy: 'cold' });
    const s0a = add({
      durationMs: 300,
      inputTokens: 20,
      chooserStrategy: 'experience_replay',
      status: 'ok',
    });
    const s0b = add({
      durationMs: 200,
      inputTokens: 20,
      chooserStrategy: 'experience_reuse',
      fallbackUsed: true,
    });
    const f1 = add({ durationMs: 800, inputTokens: 200, chooserStrategy: 'cold' });
    const s1a = add({
      durationMs: 100,
      inputTokens: 30,
      chooserStrategy: 'experience_replay',
      status: 'failed',
    });
    const s1b = add({
      durationMs: 100,
      inputTokens: 30,
      chooserStrategy: 'experience_replay',
      status: 'ok',
    });
    const f2 = add({ durationMs: 600, inputTokens: 300, chooserStrategy: 'cold' });
    const s2a = add({
      durationMs: 150,
      inputTokens: 75,
      chooserStrategy: 'experience_replay',
      status: 'ok',
    });
    const s2b = add({
      durationMs: 150,
      inputTokens: 75,
      chooserStrategy: 'experience_replay',
      status: 'ok',
    });

    const pairs: BenchmarkPairRecord[] = [
      pair({ pairIndex: 0, scenarioId: 'S1', role: 'first_touch', toolCallSeqs: [f0] }),
      pair({ pairIndex: 0, scenarioId: 'S1', role: 'second_touch', toolCallSeqs: [s0a, s0b] }),
      pair({ pairIndex: 1, scenarioId: 'S1', role: 'first_touch', toolCallSeqs: [f1] }),
      pair({ pairIndex: 1, scenarioId: 'S1', role: 'second_touch', toolCallSeqs: [s1a, s1b] }),
      pair({ pairIndex: 2, scenarioId: 'S1', role: 'first_touch', toolCallSeqs: [f2] }),
      pair({ pairIndex: 2, scenarioId: 'S1', role: 'second_touch', toolCallSeqs: [s2a, s2b] }),
    ];

    return run({
      kpiScenarioIds: ['S1'],
      scenarios: [{ scenarioId: 'S1', completed: true }],
      toolCalls: calls,
      pairs,
    });
  }

  it('computes K5 median across pairs (1000/500=2, 800/200=4, 600/300=2 → median 2)', () => {
    const summary = summariseBenchmarkRunV24(pairRun());
    expect(summary.k5SecondTouchSpeedup).toBe(2);
  });

  it('per-scenario K5 aggregate exposes median, min, max, and stddev', () => {
    const summary = summariseBenchmarkRunV24(pairRun());
    expect(summary.pairs).toHaveLength(1);
    const block = summary.pairs[0]!;
    expect(block.aggregate.pairCount).toBe(3);
    expect(block.aggregate.k5SecondTouchSpeedupMedian).toBe(2);
    expect(block.aggregate.k5SecondTouchSpeedupMin).toBe(2);
    expect(block.aggregate.k5SecondTouchSpeedupMax).toBe(4);
    expect(block.aggregate.k5SecondTouchSpeedupStddev).toBeGreaterThan(0);
  });

  it('K6 replay success rate median = median(1/1, 1/2, 2/2) = 1', () => {
    const summary = summariseBenchmarkRunV24(pairRun());
    // values: 1.0, 0.5, 1.0 → median 1.0
    expect(summary.k6ReplaySuccessRate).toBe(1);
  });

  it('K7 fallback rate median = median(0.5, 0, 0) = 0', () => {
    const summary = summariseBenchmarkRunV24(pairRun());
    expect(summary.k7ReplayFallbackRate).toBe(0);
  });

  it('K8 token saving ratio median = median(0.4, 0.3, 0.5) = 0.4', () => {
    const summary = summariseBenchmarkRunV24(pairRun());
    expect(summary.k8TokenSavingRatio).toBeCloseTo(0.4, 6);
  });

  it('replay eligibility distribution counts strategies and unknowns', () => {
    const summary = summariseBenchmarkRunV24(pairRun());
    // first-touch x3: cold ; second-touch: 1 reuse + 5 replay
    expect(summary.replayEligibilityDistribution.cold).toBe(3);
    expect(summary.replayEligibilityDistribution.experience_replay).toBe(5);
    expect(summary.replayEligibilityDistribution.experience_reuse).toBe(1);
    expect(summary.replayEligibilityDistribution.unknown).toBe(0);
  });

  it('marks incomplete pairs (missing role) and excludes them from K5..K8', () => {
    // Only first_touch present → pair is incomplete and contributes no K5..K8 sample.
    const summary = summariseBenchmarkRunV24(
      run({
        kpiScenarioIds: ['S1'],
        scenarios: [{ scenarioId: 'S1', completed: true }],
        toolCalls: [call({ seq: 0, scenarioId: 'S1', durationMs: 1000, inputTokens: 100 })],
        pairs: [pair({ pairIndex: 0, scenarioId: 'S1', role: 'first_touch', toolCallSeqs: [0] })],
      }),
    );
    const block = summary.pairs[0]!;
    expect(block.aggregate.pairCount).toBe(0);
    expect(block.aggregate.incompletePairs).toBe(1);
    expect(summary.k5SecondTouchSpeedup).toBeNull();
  });

  it('handles K8 = null when first-touch tokens were not measurable', () => {
    const summary = summariseBenchmarkRunV24(
      run({
        kpiScenarioIds: ['S1'],
        scenarios: [{ scenarioId: 'S1', completed: true }],
        toolCalls: [
          call({ seq: 0, scenarioId: 'S1', durationMs: 1000, inputTokens: null }),
          call({ seq: 1, scenarioId: 'S1', durationMs: 500, inputTokens: 50 }),
        ],
        pairs: [
          pair({ pairIndex: 0, scenarioId: 'S1', role: 'first_touch', toolCallSeqs: [0] }),
          pair({ pairIndex: 0, scenarioId: 'S1', role: 'second_touch', toolCallSeqs: [1] }),
        ],
      }),
    );
    expect(summary.k5SecondTouchSpeedup).toBe(2);
    expect(summary.k8TokenSavingRatio).toBeNull();
  });
});

describe('evaluateBenchmarkGateV24', () => {
  function passingPairRun(): BenchmarkRunInputV24 {
    const toolCalls: BenchmarkToolCallRecordV24[] = [];
    const pairs: BenchmarkPairRecord[] = [];
    let seq = 0;
    for (let i = 0; i < 3; i += 1) {
      const f = seq++;
      const s = seq++;
      toolCalls.push(
        call({
          seq: f,
          scenarioId: 'KPI',
          durationMs: 1000,
          inputTokens: 100,
          chooserStrategy: 'cold',
        }),
      );
      toolCalls.push(
        call({
          seq: s,
          scenarioId: 'KPI',
          durationMs: 400,
          inputTokens: 30,
          chooserStrategy: 'experience_replay',
          status: 'ok',
        }),
      );
      pairs.push(pair({ pairIndex: i, scenarioId: 'KPI', role: 'first_touch', toolCallSeqs: [f] }));
      pairs.push(
        pair({ pairIndex: i, scenarioId: 'KPI', role: 'second_touch', toolCallSeqs: [s] }),
      );
    }
    return run({
      kpiScenarioIds: ['KPI'],
      scenarios: [{ scenarioId: 'KPI', completed: true }],
      toolCalls,
      pairs,
    });
  }

  it('cross-source-version guard: .cjs gate version matches TS transformer', () => {
    expect(gateModule.BENCHMARK_REPORT_VERSION_EXPECTED).toBe(BENCHMARK_REPORT_VERSION);
  });

  it('passes a clean pair-aware summary', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    const hard = reasons.filter((r) => !r.startsWith('WARN:'));
    expect(hard).toEqual([]);
  });

  it('blocks on lane-integrity violations', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    summary.laneCounters = {
      tabrixOwnedCount: 0,
      cdpCount: 1,
      debuggerCount: 0,
      unknownCount: 0,
      violationCount: 1,
    };
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    expect(reasons.some((r) => r.includes('lane-integrity'))).toBe(true);
  });

  it('blocks on K3 below threshold', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    summary.k3TaskSuccessRate = 0.5;
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    expect(reasons.some((r) => r.includes('K3'))).toBe(true);
  });

  it('blocks on K4 retry rate too high', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    summary.k4ToolRetryRate = 0.8;
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    expect(reasons.some((r) => r.includes('K4'))).toBe(true);
  });

  it('blocks on empty scenarios', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    summary.totalScenarios = 0;
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    expect(reasons.some((r) => r.includes('no scenarios'))).toBe(true);
  });

  it('blocks on KPI scenario with pairCount < 3', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    // Drop one pair so pairCount becomes 2.
    summary.pairs[0]!.aggregate.pairCount = 2;
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    expect(reasons.some((r) => r.includes('pairCount=2'))).toBe(true);
  });

  it('blocks on KPI scenario missing entirely from pairs block', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    (summary as BenchmarkSummaryV24).kpiScenarioIds = ['MISSING'];
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    expect(reasons.some((r) => r.includes('KPI scenario "MISSING" missing pairs block'))).toBe(
      true,
    );
  });

  it('blocks on report-version drift', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    (summary as { reportVersion: number }).reportVersion = 999;
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    expect(reasons.some((r) => r.includes('report version mismatch'))).toBe(true);
  });

  it('K5..K8 below guidance emit WARN: reasons but do NOT make hard fail', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun());
    summary.k5SecondTouchSpeedup = 1.0;
    summary.k6ReplaySuccessRate = 0.5;
    summary.k7ReplayFallbackRate = 0.5;
    summary.k8TokenSavingRatio = 0.9;
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    const { hard, soft } = gateModule.partitionGateReasons(reasons);
    expect(hard).toEqual([]);
    expect(soft.some((r) => r.includes('K5'))).toBe(true);
    expect(soft.some((r) => r.includes('K6'))).toBe(true);
    expect(soft.some((r) => r.includes('K7'))).toBe(true);
    expect(soft.some((r) => r.includes('K8'))).toBe(true);
  });

  it('blocks on non-object input (defensive)', () => {
    expect(gateModule.evaluateBenchmarkGateV24(null)).toEqual(['report is not a JSON object']);
    expect(gateModule.evaluateBenchmarkGateV24('not-a-summary')).toEqual([
      'report is not a JSON object',
    ]);
  });

  it('blocks when laneCounters block is missing', () => {
    const summary = summariseBenchmarkRunV24(passingPairRun()) as Partial<BenchmarkSummaryV24>;
    delete (summary as { laneCounters?: unknown }).laneCounters;
    const reasons = gateModule.evaluateBenchmarkGateV24(summary);
    expect(reasons.some((r) => r.includes('laneCounters block missing'))).toBe(true);
  });
});

describe('benchmarkGateAppliesV24', () => {
  it('returns true for v2.4.0 and above', () => {
    expect(gateModule.benchmarkGateAppliesV24('2.4.0')).toBe(true);
    expect(gateModule.benchmarkGateAppliesV24('2.4.1')).toBe(true);
    expect(gateModule.benchmarkGateAppliesV24('2.5.0')).toBe(true);
    expect(gateModule.benchmarkGateAppliesV24('3.0.0')).toBe(true);
  });

  it('returns false for v2.3.x and below (v23 path retains those)', () => {
    expect(gateModule.benchmarkGateAppliesV24('2.3.0')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV24('2.3.5')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV24('2.2.0')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV24('1.99.99')).toBe(false);
  });

  it('returns false for malformed version strings', () => {
    expect(gateModule.benchmarkGateAppliesV24('')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV24('not-a-version')).toBe(false);
  });

  it('control case: v23 transformer report version is unchanged at 1', () => {
    // Defensive cross-check: the v23 schema must not silently move
    // when the v24 schema lands. If a future contributor bumps v23 they
    // need to also touch v23's gate test.
    expect(V23_REPORT_VERSION).toBe(1);
  });
});
