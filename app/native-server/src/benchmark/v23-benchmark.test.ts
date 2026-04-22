import {
  BENCHMARK_REPORT_VERSION,
  DEFAULT_BENCHMARK_GATE_THRESHOLDS,
  evaluateBenchmarkGate,
  summariseBenchmarkRun,
  type BenchmarkRunInput,
  type BenchmarkSummary,
  type BenchmarkToolCallRecord,
} from './v23-benchmark';

function call(overrides: Partial<BenchmarkToolCallRecord> = {}): BenchmarkToolCallRecord {
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

function run(overrides: Partial<BenchmarkRunInput> = {}): BenchmarkRunInput {
  return {
    runId: 'run-1',
    runStartedAt: '2026-04-22T00:00:00Z',
    runEndedAt: '2026-04-22T00:05:00Z',
    buildSha: 'abcd1234',
    toolCalls: [],
    scenarios: [],
    ...overrides,
  };
}

describe('summariseBenchmarkRun (V23-06)', () => {
  it('returns deterministic empty report for an empty run', () => {
    const summary = summariseBenchmarkRun(run());
    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.totalScenarios).toBe(0);
    expect(summary.completedScenarios).toBe(0);
    expect(summary.scenarioCompletionRate).toBeNull();
    expect(summary.k1MeanInputTokensPerTask).toBeNull();
    expect(summary.k2PerToolLatencyMs).toEqual([]);
    expect(summary.k3TaskSuccessRate).toBeNull();
    expect(summary.k4ToolRetryRate).toBeNull();
    expect(summary.k4FallbackRate).toBeNull();
    expect(summary.readPageProbeCount).toBe(0);
    expect(summary.laneCounters.violationCount).toBe(0);
    expect(summary.meanClickAttemptsPerStep).toBeNull();
  });

  it('computes K1 as token-sum / scenario-count, ignoring null token records', () => {
    const summary = summariseBenchmarkRun(
      run({
        scenarios: [
          { scenarioId: 'A', completed: true },
          { scenarioId: 'B', completed: true },
        ],
        toolCalls: [
          call({ inputTokens: 100 }),
          call({ inputTokens: 200 }),
          call({ inputTokens: null }),
        ],
      }),
    );
    expect(summary.k1MeanInputTokensPerTask).toBe(150);
  });

  it('K1 is null when no scenarios even if tokens are present', () => {
    const summary = summariseBenchmarkRun(
      run({
        scenarios: [],
        toolCalls: [call({ inputTokens: 100 })],
      }),
    );
    expect(summary.k1MeanInputTokensPerTask).toBeNull();
  });

  it('K2 p50 is per-tool, only counts ok calls, sorted by tool name', () => {
    const summary = summariseBenchmarkRun(
      run({
        toolCalls: [
          call({ toolName: 'chrome_read_page', durationMs: 1000 }),
          call({ toolName: 'chrome_read_page', durationMs: 3000 }),
          call({ toolName: 'chrome_read_page', durationMs: 2000 }),
          call({ toolName: 'chrome_click_element', durationMs: 500 }),
          call({ toolName: 'chrome_click_element', durationMs: 700 }),
          call({ toolName: 'chrome_click_element', durationMs: 9999, status: 'failed' }),
        ],
      }),
    );
    expect(summary.k2PerToolLatencyMs).toEqual([
      { toolName: 'chrome_click_element', sampleCount: 2, p50Ms: 600 },
      { toolName: 'chrome_read_page', sampleCount: 3, p50Ms: 2000 },
    ]);
  });

  it('K3 mirrors scenario completion rate', () => {
    const summary = summariseBenchmarkRun(
      run({
        scenarios: [
          { scenarioId: 'A', completed: true },
          { scenarioId: 'B', completed: true },
          { scenarioId: 'C', completed: false },
          { scenarioId: 'D', completed: true },
        ],
      }),
    );
    expect(summary.k3TaskSuccessRate).toBe(0.75);
    expect(summary.scenarioCompletionRate).toBe(0.75);
  });

  it('K4 separates retry rate from fallback rate', () => {
    const summary = summariseBenchmarkRun(
      run({
        toolCalls: [
          call({ retryCount: 0, fallbackUsed: false }),
          call({ retryCount: 1, fallbackUsed: false }),
          call({ retryCount: 0, fallbackUsed: true }),
          call({ retryCount: 2, fallbackUsed: true }),
        ],
      }),
    );
    expect(summary.k4ToolRetryRate).toBe(0.5);
    expect(summary.k4FallbackRate).toBe(0.5);
  });

  it('counts read_page probes', () => {
    const summary = summariseBenchmarkRun(
      run({
        toolCalls: [
          call({ toolName: 'chrome_read_page' }),
          call({ toolName: 'chrome_read_page', status: 'failed' }),
          call({ toolName: 'chrome_click_element' }),
        ],
      }),
    );
    expect(summary.readPageProbeCount).toBe(2);
  });

  it('separates lane buckets and reports cdp+debugger as violations', () => {
    const summary = summariseBenchmarkRun(
      run({
        toolCalls: [
          call({ lane: 'tabrix_owned' }),
          call({ lane: 'tabrix_owned' }),
          call({ lane: 'cdp' }),
          call({ lane: 'debugger' }),
          call({ lane: 'unknown' }),
        ],
      }),
    );
    expect(summary.laneCounters).toEqual({
      tabrixOwnedCount: 2,
      cdpCount: 1,
      debuggerCount: 1,
      unknownCount: 1,
      violationCount: 2,
    });
  });

  it('mean click attempts per step ignores non-click calls and missing values', () => {
    const summary = summariseBenchmarkRun(
      run({
        toolCalls: [
          call({ toolName: 'chrome_click_element', clickAttempts: 1 }),
          call({ toolName: 'chrome_click_element', clickAttempts: 3 }),
          call({ toolName: 'chrome_click_element' }),
          call({ toolName: 'chrome_read_page', clickAttempts: 99 }),
        ],
      }),
    );
    expect(summary.meanClickAttemptsPerStep).toBe(2);
  });

  it('rejects negative or NaN retryCount values silently (treated as 0)', () => {
    const summary = summariseBenchmarkRun(
      run({
        toolCalls: [call({ retryCount: -3 }), call({ retryCount: Number.NaN })],
      }),
    );
    expect(summary.k4ToolRetryRate).toBe(0);
  });

  it('is deterministic — re-running on the same input yields equal output', () => {
    const input = run({
      scenarios: [{ scenarioId: 'A', completed: true }],
      toolCalls: [call({ inputTokens: 50 }), call({ inputTokens: 100 })],
    });
    const a = summariseBenchmarkRun(input);
    const b = summariseBenchmarkRun(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('evaluateBenchmarkGate (V23-06 release gate)', () => {
  function summary(overrides: Partial<BenchmarkSummary> = {}): BenchmarkSummary {
    return {
      reportVersion: BENCHMARK_REPORT_VERSION,
      runId: 'run-1',
      runStartedAt: '2026-04-22T00:00:00Z',
      runEndedAt: '2026-04-22T00:05:00Z',
      buildSha: 'abcd1234',
      totalToolCalls: 10,
      scenarioCompletionRate: 0.9,
      totalScenarios: 5,
      completedScenarios: 5,
      k1MeanInputTokensPerTask: 1000,
      k2PerToolLatencyMs: [],
      k3TaskSuccessRate: 0.9,
      k4ToolRetryRate: 0.05,
      k4FallbackRate: 0.0,
      readPageProbeCount: 5,
      laneCounters: {
        tabrixOwnedCount: 10,
        cdpCount: 0,
        debuggerCount: 0,
        unknownCount: 0,
        violationCount: 0,
      },
      meanClickAttemptsPerStep: 1,
      ...overrides,
    };
  }

  it('passes a clean summary', () => {
    expect(evaluateBenchmarkGate(summary())).toEqual([]);
  });

  it('blocks on lane-integrity violations', () => {
    const reasons = evaluateBenchmarkGate(
      summary({
        laneCounters: {
          tabrixOwnedCount: 9,
          cdpCount: 1,
          debuggerCount: 0,
          unknownCount: 0,
          violationCount: 1,
        },
      }),
    );
    expect(reasons.some((r) => r.includes('lane-integrity'))).toBe(true);
  });

  it('blocks when K3 below threshold', () => {
    const reasons = evaluateBenchmarkGate(
      summary({ k3TaskSuccessRate: 0.5, scenarioCompletionRate: 0.5 }),
    );
    expect(reasons.some((r) => r.includes('K3'))).toBe(true);
  });

  it('blocks when K4 retry rate too high', () => {
    const reasons = evaluateBenchmarkGate(summary({ k4ToolRetryRate: 0.5 }));
    expect(reasons.some((r) => r.includes('K4'))).toBe(true);
  });

  it('blocks an empty run', () => {
    const reasons = evaluateBenchmarkGate(
      summary({ totalScenarios: 0, completedScenarios: 0, scenarioCompletionRate: null }),
    );
    expect(reasons.some((r) => r.includes('no scenarios'))).toBe(true);
  });

  it('respects custom thresholds', () => {
    const stricter = { ...DEFAULT_BENCHMARK_GATE_THRESHOLDS, maxToolRetryRate: 0.01 };
    const reasons = evaluateBenchmarkGate(summary({ k4ToolRetryRate: 0.05 }), stricter);
    expect(reasons.some((r) => r.includes('K4'))).toBe(true);
  });
});
