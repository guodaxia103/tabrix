import * as path from 'node:path';
import {
  BENCHMARK_REPORT_VERSION,
  V23_REPORT_VERSION,
  V24_REPORT_VERSION,
  summariseBenchmarkRunV25,
  type BenchmarkPairRecord,
  type BenchmarkRunInputV25WithBaseline,
  type BenchmarkSummaryV25,
  type BenchmarkToolCallRecordV25,
} from './v25-benchmark';
import type { BenchmarkSummaryV24 } from './v24-benchmark';

interface GateModuleV25 {
  BENCHMARK_REPORT_VERSION_EXPECTED: number;
  DEFAULT_BENCHMARK_GATE_THRESHOLDS_V25: {
    maxToolRetryRate: number;
    minScenarioCompletionRate: number;
    minPairCountPerKpiScenario: number;
    maxL0TokenRatio: number;
    maxL0L1TokenRatio: number;
    k3RegressionCeiling: number;
    k4RegressionCeiling: number;
    medianToolCallsRegressionCeiling: number;
    maxVisualFallbackRateAbsolute: number;
    maxJsFallbackRateAbsolute: number;
  };
  RELEASE_NOTES_PLACEHOLDER_TOKEN: string;
  evaluateBenchmarkGateV25: (summary: unknown, thresholds?: unknown) => string[];
  benchmarkGateAppliesV25: (version: string) => boolean;
  partitionGateReasons: (reasons: string[]) => { hard: string[]; soft: string[] };
  loadAndEvaluateBenchmarkReportV25: (
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

const gateModule: GateModuleV25 = require(
  path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'v25-benchmark-gate.cjs'),
);

function call(overrides: Partial<BenchmarkToolCallRecordV25> = {}): BenchmarkToolCallRecordV25 {
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

function run(
  overrides: Partial<BenchmarkRunInputV25WithBaseline> = {},
): BenchmarkRunInputV25WithBaseline {
  return {
    runId: 'run-v25-1',
    runStartedAt: '2026-04-23T00:00:00Z',
    runEndedAt: '2026-04-23T00:05:00Z',
    buildSha: 'abcd1234',
    kpiScenarioIds: [],
    toolCalls: [],
    scenarios: [],
    pairs: [],
    ...overrides,
  };
}

describe('summariseBenchmarkRunV25 — empty + carry-forward', () => {
  it('returns deterministic empty report', () => {
    const summary = summariseBenchmarkRunV25(run());
    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.totalScenarios).toBe(0);
    expect(summary.scenarioCompletionRate).toBeNull();
    expect(summary.scenarioSummaries).toEqual([]);
    expect(summary.layerMetrics.tokensSavedEstimateTotal).toBe(0);
    expect(summary.layerMetrics.l0TokenRatioMedian).toBeNull();
    expect(summary.layerMetrics.l0L1TokenRatioMedian).toBeNull();
    expect(summary.methodMetrics.k3TaskSuccessRate).toBeNull();
    expect(summary.methodMetrics.k4ToolRetryRate).toBeNull();
    expect(summary.methodMetrics.clickAttemptsPerSuccessMedian).toBeNull();
    expect(summary.methodMetrics.medianToolCallsPerScenario).toBeNull();
    expect(summary.stabilityMetrics.visualFallbackRate).toBeNull();
    expect(summary.stabilityMetrics.jsFallbackRate).toBeNull();
    expect(summary.stabilityMetrics.noObservedChangeRate).toBeNull();
    expect(summary.stabilityMetrics.replaySuccessRate).toBeNull();
    expect(summary.stabilityMetrics.replayFallbackDepthMedian).toBeNull();
    expect(summary.laneCounters.violationCount).toBe(0);
    expect(summary.comparisonToV24).toBeNull();
  });

  it('K3/K4 carry forward from v24 semantics', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        scenarios: [
          { scenarioId: 'A', completed: true },
          { scenarioId: 'B', completed: false },
        ],
        toolCalls: [
          call({ seq: 0, scenarioId: 'A', toolName: 'chrome_read_page', durationMs: 1000 }),
          call({ seq: 1, scenarioId: 'A', toolName: 'chrome_click_element', retryCount: 1 }),
          call({ seq: 2, scenarioId: 'B', toolName: 'chrome_click_element' }),
          call({ seq: 3, scenarioId: 'B', toolName: 'chrome_click_element', fallbackUsed: true }),
        ],
      }),
    );
    expect(summary.methodMetrics.k3TaskSuccessRate).toBe(0.5);
    expect(summary.methodMetrics.k4ToolRetryRate).toBe(0.25);
  });

  it('lane counters carry forward and tag violations', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, lane: 'tabrix_owned' }),
          call({ seq: 1, lane: 'cdp' }),
          call({ seq: 2, lane: 'debugger' }),
          call({ seq: 3, lane: 'unknown' }),
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
  });

  it('per-tool latency uses p50 and is sorted by toolName', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, toolName: 'chrome_read_page', durationMs: 100 }),
          call({ seq: 1, toolName: 'chrome_read_page', durationMs: 300 }),
          call({ seq: 2, toolName: 'chrome_click_element', durationMs: 200 }),
          call({ seq: 3, toolName: 'chrome_click_element', durationMs: 400 }),
        ],
      }),
    );
    expect(summary.k2PerToolLatencyMs).toEqual([
      { toolName: 'chrome_click_element', sampleCount: 2, p50Ms: 300 },
      { toolName: 'chrome_read_page', sampleCount: 2, p50Ms: 200 },
    ]);
  });

  it('is deterministic — re-running on the same input yields equal output', () => {
    const input = run({
      scenarios: [{ scenarioId: 'A', completed: true }],
      toolCalls: [
        call({ seq: 0, chosenLayer: 'L0', tokenEstimateChosen: 50, tokenEstimateFullRead: 200 }),
        call({ seq: 1, chosenLayer: 'L0+L1', tokenEstimateChosen: 80, tokenEstimateFullRead: 200 }),
      ],
    });
    const a = summariseBenchmarkRunV25(input);
    const b = summariseBenchmarkRunV25(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('summariseBenchmarkRunV25 — layerMetrics', () => {
  it('counts chosen-layer distribution and tags unknowns', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, chosenLayer: 'L0' }),
          call({ seq: 1, chosenLayer: 'L0' }),
          call({ seq: 2, chosenLayer: 'L0+L1' }),
          call({ seq: 3, chosenLayer: 'L0+L1+L2' }),
          call({ seq: 4, chosenLayer: 'L9+ZZZ' as unknown as 'L0' }),
          call({ seq: 5 }), // no chosenLayer at all → not counted
        ],
      }),
    );
    expect(summary.layerMetrics.chosenLayerDistribution).toEqual({
      L0: 2,
      'L0+L1': 1,
      'L0+L1+L2': 1,
      unknown: 1,
    });
  });

  it('counts source-route distribution against the closed enum', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, sourceRoute: 'read_page_required' }),
          call({ seq: 1, sourceRoute: 'experience_replay_skip_read' }),
          call({ seq: 2, sourceRoute: 'knowledge_supported_read' }),
          call({ seq: 3, sourceRoute: 'dispatcher_fallback_safe' }),
          call({ seq: 4, sourceRoute: 'made_up_route' as unknown as 'read_page_required' }),
        ],
      }),
    );
    expect(summary.layerMetrics.sourceRouteDistribution).toEqual({
      read_page_required: 1,
      experience_replay_skip_read: 1,
      knowledge_supported_read: 1,
      dispatcher_fallback_safe: 1,
      unknown: 1,
    });
  });

  it('records dispatch-reason distribution as an open-ended map', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, layerDispatchReason: 'experience_replay_eligible' }),
          call({ seq: 1, layerDispatchReason: 'experience_replay_eligible' }),
          call({ seq: 2, layerDispatchReason: 'details_intent_override' }),
          call({ seq: 3 }),
        ],
      }),
    );
    expect(summary.layerMetrics.dispatchReasonDistribution).toEqual({
      experience_replay_eligible: 2,
      details_intent_override: 1,
    });
  });

  it('records fallback-cause distribution only for fallback_safe route', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({
            seq: 0,
            sourceRoute: 'dispatcher_fallback_safe',
            fallbackCause: 'unknown_intent',
          }),
          call({
            seq: 1,
            sourceRoute: 'dispatcher_fallback_safe',
            fallbackCause: 'unknown_intent',
          }),
          call({
            seq: 2,
            sourceRoute: 'dispatcher_fallback_safe',
            // no fallbackCause field → counted under "unspecified"
          }),
          call({
            seq: 3,
            sourceRoute: 'read_page_required',
            // fallbackCause set on a non-fallback route should NOT count
            fallbackCause: 'should_not_count',
          }),
        ],
      }),
    );
    expect(summary.layerMetrics.fallbackCauseDistribution).toEqual({
      unknown_intent: 2,
      unspecified: 1,
    });
  });

  it('computes L0 / L0+L1 token-ratio medians from per-call ratios', () => {
    // L0 ratios: 50/200 = 0.25, 30/200 = 0.15, 80/200 = 0.4 → median 0.25
    // L0+L1 ratios: 100/200 = 0.5, 120/200 = 0.6 → median 0.55
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, chosenLayer: 'L0', tokenEstimateChosen: 50, tokenEstimateFullRead: 200 }),
          call({ seq: 1, chosenLayer: 'L0', tokenEstimateChosen: 30, tokenEstimateFullRead: 200 }),
          call({ seq: 2, chosenLayer: 'L0', tokenEstimateChosen: 80, tokenEstimateFullRead: 200 }),
          call({
            seq: 3,
            chosenLayer: 'L0+L1',
            tokenEstimateChosen: 100,
            tokenEstimateFullRead: 200,
          }),
          call({
            seq: 4,
            chosenLayer: 'L0+L1',
            tokenEstimateChosen: 120,
            tokenEstimateFullRead: 200,
          }),
        ],
      }),
    );
    expect(summary.layerMetrics.l0TokenRatioMedian).toBeCloseTo(0.25, 6);
    expect(summary.layerMetrics.l0L1TokenRatioMedian).toBeCloseTo(0.55, 6);
  });

  it('sums tokensSaved as max(0, full - chosen) per call', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, chosenLayer: 'L0', tokenEstimateChosen: 50, tokenEstimateFullRead: 200 }), // saving 150
          call({ seq: 1, chosenLayer: 'L0', tokenEstimateChosen: 250, tokenEstimateFullRead: 200 }), // negative → 0
          call({
            seq: 2,
            chosenLayer: 'L0+L1',
            tokenEstimateChosen: 80,
            tokenEstimateFullRead: 100,
          }), // saving 20
        ],
      }),
    );
    expect(summary.layerMetrics.tokensSavedEstimateTotal).toBe(170);
  });

  it('counts readPageAvoided when the runner sets it', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, readPageAvoided: true }),
          call({ seq: 1, readPageAvoided: true }),
          call({ seq: 2, readPageAvoided: false }),
          call({ seq: 3 }),
        ],
      }),
    );
    expect(summary.layerMetrics.readPageAvoidedCount).toBe(2);
  });
});

describe('summariseBenchmarkRunV25 — methodMetrics + stabilityMetrics', () => {
  it('clickAttemptsPerSuccessMedian only counts click steps with status=ok', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, toolName: 'chrome_click_element', status: 'ok', clickAttempts: 1 }),
          call({ seq: 1, toolName: 'chrome_click_element', status: 'ok', clickAttempts: 3 }),
          call({ seq: 2, toolName: 'chrome_click_element', status: 'ok', clickAttempts: 2 }),
          // failed click — must NOT contribute to success-only median
          call({
            seq: 3,
            toolName: 'chrome_click_element',
            status: 'failed',
            clickAttempts: 9,
          }),
          // non-click tool — ignored
          call({
            seq: 4,
            toolName: 'chrome_read_page',
            status: 'ok',
            clickAttempts: 99,
          }),
        ],
      }),
    );
    expect(summary.methodMetrics.clickAttemptsPerSuccessMedian).toBe(2);
  });

  it('medianToolCallsPerScenario is computed across declared scenarios', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        scenarios: [
          { scenarioId: 'A', completed: true },
          { scenarioId: 'B', completed: true },
          { scenarioId: 'C', completed: true },
        ],
        toolCalls: [
          call({ seq: 0, scenarioId: 'A' }),
          call({ seq: 1, scenarioId: 'A' }),
          call({ seq: 2, scenarioId: 'B' }),
          call({ seq: 3, scenarioId: 'B' }),
          call({ seq: 4, scenarioId: 'B' }),
          call({ seq: 5, scenarioId: 'C' }),
          call({ seq: 6, scenarioId: 'C' }),
          call({ seq: 7, scenarioId: 'C' }),
          call({ seq: 8, scenarioId: 'C' }),
        ],
      }),
    );
    // counts: 2, 3, 4 → median 3
    expect(summary.methodMetrics.medianToolCallsPerScenario).toBe(3);
  });

  it('visualFallbackRate / jsFallbackRate are over total tool calls', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, visualFallbackUsed: true }),
          call({ seq: 1, jsFallbackUsed: true }),
          call({ seq: 2 }),
          call({ seq: 3 }),
        ],
      }),
    );
    expect(summary.stabilityMetrics.visualFallbackRate).toBe(0.25);
    expect(summary.stabilityMetrics.jsFallbackRate).toBe(0.25);
  });

  it('noObservedChangeRate is over click calls only', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, toolName: 'chrome_click_element', noObservedChange: true }),
          call({ seq: 1, toolName: 'chrome_click_element', noObservedChange: false }),
          call({ seq: 2, toolName: 'chrome_click_element' }), // not flagged → not counted
          call({ seq: 3, toolName: 'chrome_read_page', noObservedChange: true }), // not a click → ignored
        ],
      }),
    );
    expect(summary.stabilityMetrics.noObservedChangeRate).toBeCloseTo(1 / 3, 6);
  });

  it('replaySuccessRate = ok/total over experience_replay calls', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, chooserStrategy: 'experience_replay', status: 'ok' }),
          call({ seq: 1, chooserStrategy: 'experience_replay', status: 'ok' }),
          call({ seq: 2, chooserStrategy: 'experience_replay', status: 'failed' }),
          call({ seq: 3, chooserStrategy: 'cold', status: 'ok' }),
        ],
      }),
    );
    expect(summary.stabilityMetrics.replaySuccessRate).toBeCloseTo(2 / 3, 6);
  });

  it('replayFallbackDepthMedian only includes finite, non-negative depths from replay calls', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        toolCalls: [
          call({ seq: 0, chooserStrategy: 'experience_replay', replayFallbackDepth: 0 }),
          call({ seq: 1, chooserStrategy: 'experience_replay', replayFallbackDepth: 2 }),
          call({ seq: 2, chooserStrategy: 'experience_replay', replayFallbackDepth: 1 }),
          // negative depth → ignored
          call({ seq: 3, chooserStrategy: 'experience_replay', replayFallbackDepth: -1 }),
          // non-replay → ignored even with depth
          call({ seq: 4, chooserStrategy: 'cold', replayFallbackDepth: 99 }),
        ],
      }),
    );
    expect(summary.stabilityMetrics.replayFallbackDepthMedian).toBe(1);
  });
});

describe('summariseBenchmarkRunV25 — pairedRunCount + KPI rollup', () => {
  it('pairedRunCount counts only complete (first+second) pairs per scenario', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        kpiScenarioIds: ['S1'],
        scenarios: [{ scenarioId: 'S1', completed: true }],
        toolCalls: [call({ seq: 0, scenarioId: 'S1' }), call({ seq: 1, scenarioId: 'S1' })],
        pairs: [
          // pair 0 has both touches → counts
          pair({ pairIndex: 0, scenarioId: 'S1', role: 'first_touch', toolCallSeqs: [0] }),
          pair({ pairIndex: 0, scenarioId: 'S1', role: 'second_touch', toolCallSeqs: [1] }),
          // pair 1 only has first_touch → does not count
          pair({ pairIndex: 1, scenarioId: 'S1', role: 'first_touch', toolCallSeqs: [0] }),
          // pair 2 has both → counts
          pair({ pairIndex: 2, scenarioId: 'S1', role: 'first_touch', toolCallSeqs: [0] }),
          pair({ pairIndex: 2, scenarioId: 'S1', role: 'second_touch', toolCallSeqs: [1] }),
        ],
      }),
    );
    expect(summary.scenarioSummaries).toEqual([
      { scenarioId: 'S1', toolCallCount: 2, completed: true, pairedRunCount: 2 },
    ]);
    expect(summary.pairedRunCountMax).toBe(2);
  });

  it('scenarioSummaries surface pair-only scenarios so the gate can reject missing rows', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        kpiScenarioIds: ['S1', 'S2'],
        scenarios: [{ scenarioId: 'S1', completed: true }],
        toolCalls: [],
        pairs: [
          pair({ pairIndex: 0, scenarioId: 'S2', role: 'first_touch', toolCallSeqs: [] }),
          pair({ pairIndex: 0, scenarioId: 'S2', role: 'second_touch', toolCallSeqs: [] }),
        ],
      }),
    );
    const ids = summary.scenarioSummaries.map((s) => s.scenarioId).sort();
    expect(ids).toEqual(['S1', 'S2']);
    const s2 = summary.scenarioSummaries.find((s) => s.scenarioId === 'S2');
    expect(s2?.pairedRunCount).toBe(1);
    expect(s2?.completed).toBe(false);
  });
});

describe('summariseBenchmarkRunV25 — comparisonToV24', () => {
  function fakeBaseline(overrides: Partial<BenchmarkSummaryV24> = {}): BenchmarkSummaryV24 {
    return {
      reportVersion: 1,
      runId: 'baseline-v24',
      runStartedAt: '2026-04-01T00:00:00Z',
      runEndedAt: '2026-04-01T00:05:00Z',
      buildSha: 'baseline24',
      totalToolCalls: 10,
      scenarioCompletionRate: 0.9,
      totalScenarios: 5,
      completedScenarios: 4,
      kpiScenarioIds: [],
      k1MeanInputTokensPerTask: 100,
      k2PerToolLatencyMs: [],
      k3TaskSuccessRate: 0.9,
      k4ToolRetryRate: 0.05,
      k4FallbackRate: 0.1,
      readPageProbeCount: 5,
      laneCounters: {
        tabrixOwnedCount: 10,
        cdpCount: 0,
        debuggerCount: 0,
        unknownCount: 0,
        violationCount: 0,
      },
      meanClickAttemptsPerStep: 1.5,
      pairs: [],
      k5SecondTouchSpeedup: 2,
      k6ReplaySuccessRate: 0.8,
      k7ReplayFallbackRate: 0.1,
      k8TokenSavingRatio: 0.5,
      replayEligibilityDistribution: {
        experience_replay: 0,
        experience_reuse: 0,
        knowledge_light: 0,
        read_page_required: 0,
        read_page_markdown: 0,
        cold: 0,
        unknown: 0,
      },
      replayEligibilityBlockedBy: {
        capability_off: 0,
        unsupported_step_kind: 0,
        non_portable_args: 0,
        non_github_pageRole: 0,
        below_threshold: 0,
        stale_locator: 0,
        none: 0,
        unknown: 0,
      },
      ...overrides,
    };
  }

  it('emits null when no baseline is supplied', () => {
    const summary = summariseBenchmarkRunV25(
      run({ scenarios: [{ scenarioId: 'A', completed: true }] }),
    );
    expect(summary.comparisonToV24).toBeNull();
  });

  it('computes signed deltas vs baseline (v25 - v24)', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        scenarios: [
          { scenarioId: 'A', completed: true },
          { scenarioId: 'B', completed: true },
        ],
        toolCalls: [
          call({
            seq: 0,
            scenarioId: 'A',
            toolName: 'chrome_click_element',
            status: 'ok',
            clickAttempts: 1,
          }),
          call({
            seq: 1,
            scenarioId: 'B',
            toolName: 'chrome_click_element',
            status: 'ok',
            clickAttempts: 1,
          }),
        ],
        comparisonBaselineV24: fakeBaseline({
          k3TaskSuccessRate: 0.9,
          k4ToolRetryRate: 0.05,
          meanClickAttemptsPerStep: 1.5,
        }),
      }),
    );
    expect(summary.comparisonToV24).not.toBeNull();
    const cmp = summary.comparisonToV24!;
    expect(cmp.baselineRunId).toBe('baseline-v24');
    // v25 K3 = 1.0 (both completed), baseline 0.9 → +0.1
    expect(cmp.deltas.k3TaskSuccessRate).toBeCloseTo(0.1, 6);
    // v25 K4 = 0, baseline 0.05 → -0.05
    expect(cmp.deltas.k4ToolRetryRate).toBeCloseTo(-0.05, 6);
    // v25 click attempts = 1, baseline 1.5 → -0.5
    expect(cmp.deltas.clickAttemptsPerSuccess).toBeCloseTo(-0.5, 6);
  });

  it('returns null deltas where the baseline did not measure the metric', () => {
    const summary = summariseBenchmarkRunV25(
      run({
        scenarios: [{ scenarioId: 'A', completed: true }],
        toolCalls: [
          call({
            seq: 0,
            scenarioId: 'A',
            toolName: 'chrome_click_element',
            status: 'ok',
            clickAttempts: 2,
          }),
        ],
        comparisonBaselineV24: fakeBaseline({
          meanClickAttemptsPerStep: null as unknown as number,
        }),
      }),
    );
    expect(summary.comparisonToV24!.deltas.clickAttemptsPerSuccess).toBeNull();
    // v24 schema does not carry visual/JS fallback rates → null.
    expect(summary.comparisonToV24!.deltas.visualFallbackRate).toBeNull();
    expect(summary.comparisonToV24!.deltas.jsFallbackRate).toBeNull();
  });
});

describe('evaluateBenchmarkGateV25', () => {
  function passingRunInput(): BenchmarkRunInputV25WithBaseline {
    const toolCalls: BenchmarkToolCallRecordV25[] = [];
    const pairs: BenchmarkPairRecord[] = [];
    let seq = 0;
    for (let i = 0; i < 3; i += 1) {
      const f = seq++;
      const s = seq++;
      toolCalls.push(
        call({
          seq: f,
          scenarioId: 'KPI',
          toolName: 'chrome_read_page',
          status: 'ok',
          chosenLayer: 'L0',
          sourceRoute: 'read_page_required',
          tokenEstimateChosen: 30,
          tokenEstimateFullRead: 200,
        }),
      );
      toolCalls.push(
        call({
          seq: s,
          scenarioId: 'KPI',
          toolName: 'chrome_click_element',
          status: 'ok',
          clickAttempts: 1,
          chooserStrategy: 'experience_replay',
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

  it('passes a clean v25 summary', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    const { hard } = gateModule.partitionGateReasons(reasons);
    expect(hard).toEqual([]);
  });

  it('blocks on lane-integrity violations', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.laneCounters = {
      tabrixOwnedCount: 0,
      cdpCount: 1,
      debuggerCount: 0,
      unknownCount: 0,
      violationCount: 1,
    };
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('lane-integrity'))).toBe(true);
  });

  it('blocks on K3 below threshold', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.methodMetrics.k3TaskSuccessRate = 0.5;
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('K3'))).toBe(true);
  });

  it('blocks on K4 retry rate too high', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.methodMetrics.k4ToolRetryRate = 0.8;
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('K4'))).toBe(true);
  });

  it('blocks on empty scenarios', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    (summary as { totalScenarios: number }).totalScenarios = 0;
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('no scenarios'))).toBe(true);
  });

  it('blocks on KPI scenario with pairedRunCount < 3', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.scenarioSummaries[0]!.pairedRunCount = 2;
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('pairedRunCount=2'))).toBe(true);
  });

  it('blocks on KPI scenario missing entirely from scenarioSummaries', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    (summary as BenchmarkSummaryV25).kpiScenarioIds = ['MISSING'];
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(
      reasons.some((r) => r.includes('KPI scenario "MISSING" missing scenarioSummaries')),
    ).toBe(true);
  });

  it('blocks on report-version drift', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    (summary as { reportVersion: number }).reportVersion = 999;
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('report version mismatch'))).toBe(true);
  });

  it('blocks on L0 token-ratio above ceiling', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.layerMetrics.l0TokenRatioMedian = 0.5; // above 0.35 ceiling
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('L0 token-ratio'))).toBe(true);
  });

  it('blocks on L0+L1 token-ratio above ceiling', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.layerMetrics.l0L1TokenRatioMedian = 0.7; // above 0.6 ceiling
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('L0+L1 token-ratio'))).toBe(true);
  });

  it('blocks on unknown sourceRoute or chosenLayer entries', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.layerMetrics.sourceRouteDistribution.unknown = 1;
    summary.layerMetrics.chosenLayerDistribution.unknown = 2;
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('sourceRoute "unknown"'))).toBe(true);
    expect(reasons.some((r) => r.includes('chosenLayer "unknown"'))).toBe(true);
  });

  it('blocks on K3 regression vs baseline', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.comparisonToV24 = {
      baselineRunId: 'b',
      baselineBuildSha: 'b',
      baselineReportVersion: 1,
      deltas: {
        k3TaskSuccessRate: -0.05, // dropped 5 % vs baseline → ceiling 0.02
        k4ToolRetryRate: 0,
        medianToolCallsPerScenario: 0,
        clickAttemptsPerSuccess: 0,
        visualFallbackRate: 0,
        jsFallbackRate: 0,
      },
    };
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('K3 regressed'))).toBe(true);
  });

  it('blocks on K4 retry-rate regression vs baseline', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.comparisonToV24 = {
      baselineRunId: 'b',
      baselineBuildSha: 'b',
      baselineReportVersion: 1,
      deltas: {
        k3TaskSuccessRate: 0,
        k4ToolRetryRate: 0.05, // ceiling 0.01
        medianToolCallsPerScenario: 0,
        clickAttemptsPerSuccess: 0,
        visualFallbackRate: 0,
        jsFallbackRate: 0,
      },
    };
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('K4 regressed'))).toBe(true);
  });

  it('blocks on median tool-call regression vs baseline', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.comparisonToV24 = {
      baselineRunId: 'b',
      baselineBuildSha: 'b',
      baselineReportVersion: 1,
      deltas: {
        k3TaskSuccessRate: 0,
        k4ToolRetryRate: 0,
        medianToolCallsPerScenario: 1, // ceiling 0
        clickAttemptsPerSuccess: 0,
        visualFallbackRate: 0,
        jsFallbackRate: 0,
      },
    };
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('median tool calls per scenario regressed'))).toBe(true);
  });

  it('blocks on click-attempts regression vs baseline', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.comparisonToV24 = {
      baselineRunId: 'b',
      baselineBuildSha: 'b',
      baselineReportVersion: 1,
      deltas: {
        k3TaskSuccessRate: 0,
        k4ToolRetryRate: 0,
        medianToolCallsPerScenario: 0,
        clickAttemptsPerSuccess: 0.5,
        visualFallbackRate: 0,
        jsFallbackRate: 0,
      },
    };
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('click attempts per success regressed'))).toBe(true);
  });

  it('blocks on visual fallback regression that breaks the absolute ceiling', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.stabilityMetrics.visualFallbackRate = 0.2; // > 0.05 absolute ceiling
    summary.comparisonToV24 = {
      baselineRunId: 'b',
      baselineBuildSha: 'b',
      baselineReportVersion: 1,
      deltas: {
        k3TaskSuccessRate: 0,
        k4ToolRetryRate: 0,
        medianToolCallsPerScenario: 0,
        clickAttemptsPerSuccess: 0,
        visualFallbackRate: 0.05, // > 0 → triggers absolute-floor check
        jsFallbackRate: 0,
      },
    };
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('visual fallback rate'))).toBe(true);
  });

  it('blocks on JS fallback regression that breaks the absolute ceiling', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.stabilityMetrics.jsFallbackRate = 0.1; // > 0.02 absolute ceiling
    summary.comparisonToV24 = {
      baselineRunId: 'b',
      baselineBuildSha: 'b',
      baselineReportVersion: 1,
      deltas: {
        k3TaskSuccessRate: 0,
        k4ToolRetryRate: 0,
        medianToolCallsPerScenario: 0,
        clickAttemptsPerSuccess: 0,
        visualFallbackRate: 0,
        jsFallbackRate: 0.05,
      },
    };
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('JS fallback rate'))).toBe(true);
  });

  it('without baseline still applies the absolute fallback-rate ceilings', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.stabilityMetrics.visualFallbackRate = 0.2;
    summary.stabilityMetrics.jsFallbackRate = 0.1;
    summary.comparisonToV24 = null;
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('visual fallback rate'))).toBe(true);
    expect(reasons.some((r) => r.includes('JS fallback rate'))).toBe(true);
  });

  it('blocks on non-object input (defensive)', () => {
    expect(gateModule.evaluateBenchmarkGateV25(null)).toEqual(['report is not a JSON object']);
    expect(gateModule.evaluateBenchmarkGateV25('not-a-summary')).toEqual([
      'report is not a JSON object',
    ]);
  });

  it('blocks when laneCounters block is missing', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput()) as Partial<BenchmarkSummaryV25>;
    delete (summary as { laneCounters?: unknown }).laneCounters;
    const reasons = gateModule.evaluateBenchmarkGateV25(summary);
    expect(reasons.some((r) => r.includes('laneCounters block missing'))).toBe(true);
  });
});

describe('benchmarkGateAppliesV25', () => {
  it('returns true for v2.5.0 and above', () => {
    expect(gateModule.benchmarkGateAppliesV25('2.5.0')).toBe(true);
    expect(gateModule.benchmarkGateAppliesV25('2.6.0')).toBe(true);
    expect(gateModule.benchmarkGateAppliesV25('3.0.0')).toBe(true);
  });

  it('returns false for v2.4.x and below (v23/v24 paths retain those)', () => {
    expect(gateModule.benchmarkGateAppliesV25('2.4.0')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV25('2.4.5')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV25('2.3.0')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV25('1.99.99')).toBe(false);
  });

  it('returns false for malformed version strings', () => {
    expect(gateModule.benchmarkGateAppliesV25('')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV25('not-a-version')).toBe(false);
  });

  it('control case: v23/v24 transformer report versions are unchanged at 1', () => {
    expect(V23_REPORT_VERSION).toBe(1);
    expect(V24_REPORT_VERSION).toBe(1);
  });
});
