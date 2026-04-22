import * as path from 'node:path';
import {
  BENCHMARK_REPORT_VERSION,
  summariseBenchmarkRun,
  type BenchmarkRunInput,
  type BenchmarkSummary,
  type BenchmarkToolCallRecord,
} from './v23-benchmark';

// V23-06 closeout: the gate predicate moved to a fresh-checkout-safe
// CommonJS module at `scripts/lib/v23-benchmark-gate.cjs` so that
// release-check no longer depends on the native-server `dist/` build.
// CommonJS lets Jest `require()` the same module the ESM scripts
// `import` via `createRequire`, with no `--experimental-vm-modules`
// needed. Single source of truth.
interface GateModule {
  BENCHMARK_REPORT_VERSION_EXPECTED: number;
  DEFAULT_BENCHMARK_GATE_THRESHOLDS: {
    maxToolRetryRate: number;
    minScenarioCompletionRate: number;
  };
  evaluateBenchmarkGate: (
    summary: unknown,
    thresholds?: { maxToolRetryRate: number; minScenarioCompletionRate: number },
  ) => string[];
  benchmarkGateApplies: (version: string) => boolean;
  parseSemverPrefix: (version: string) => { major: number; minor: number; patch: number } | null;
  loadAndEvaluateBenchmarkReport: (
    filePath: string,
    thresholds?: { maxToolRetryRate: number; minScenarioCompletionRate: number },
  ) => { ok: boolean; reasons: string[]; parseError: string | null };
}

const gateModule: GateModule = require(
  path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'v23-benchmark-gate.cjs'),
);

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

describe('evaluateBenchmarkGate (V23-06 release gate, canonical .mjs)', () => {
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

  it('cross-source-version guard: .mjs gate version matches TS transformer', () => {
    expect(gateModule.BENCHMARK_REPORT_VERSION_EXPECTED).toBe(BENCHMARK_REPORT_VERSION);
  });

  it('passes a clean summary', () => {
    expect(gateModule.evaluateBenchmarkGate(summary())).toEqual([]);
  });

  it('blocks on lane-integrity violations', () => {
    const reasons = gateModule.evaluateBenchmarkGate(
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
    const reasons = gateModule.evaluateBenchmarkGate(
      summary({ k3TaskSuccessRate: 0.5, scenarioCompletionRate: 0.5 }),
    );
    expect(reasons.some((r) => r.includes('K3'))).toBe(true);
  });

  it('blocks when K4 retry rate too high', () => {
    const reasons = gateModule.evaluateBenchmarkGate(summary({ k4ToolRetryRate: 0.5 }));
    expect(reasons.some((r) => r.includes('K4'))).toBe(true);
  });

  it('blocks an empty run', () => {
    const reasons = gateModule.evaluateBenchmarkGate(
      summary({ totalScenarios: 0, completedScenarios: 0, scenarioCompletionRate: null }),
    );
    expect(reasons.some((r) => r.includes('no scenarios'))).toBe(true);
  });

  it('respects custom thresholds', () => {
    const stricter = {
      ...gateModule.DEFAULT_BENCHMARK_GATE_THRESHOLDS,
      maxToolRetryRate: 0.01,
    };
    const reasons = gateModule.evaluateBenchmarkGate(summary({ k4ToolRetryRate: 0.05 }), stricter);
    expect(reasons.some((r) => r.includes('K4'))).toBe(true);
  });

  it('blocks on non-object input (defensive)', () => {
    expect(gateModule.evaluateBenchmarkGate(null)).toEqual(['report is not a JSON object']);
    expect(gateModule.evaluateBenchmarkGate('not-a-summary')).toEqual([
      'report is not a JSON object',
    ]);
  });

  it('blocks when laneCounters block is missing', () => {
    const broken = summary();
    delete (broken as { laneCounters?: unknown }).laneCounters;
    const reasons = gateModule.evaluateBenchmarkGate(broken);
    expect(reasons.some((r) => r.includes('laneCounters block missing'))).toBe(true);
  });

  it('blocks on report-version drift', () => {
    const reasons = gateModule.evaluateBenchmarkGate(
      summary({ reportVersion: 999 as unknown as typeof BENCHMARK_REPORT_VERSION }),
    );
    expect(reasons.some((r) => r.includes('report version mismatch'))).toBe(true);
  });

  it('flags self-inconsistent lane counters (violationCount lies)', () => {
    const reasons = gateModule.evaluateBenchmarkGate(
      summary({
        laneCounters: {
          tabrixOwnedCount: 8,
          cdpCount: 1,
          debuggerCount: 1,
          unknownCount: 0,
          // claims zero violations but cdp+debugger=2
          violationCount: 0,
        },
      }),
    );
    expect(reasons.some((r) => r.includes('lane counters self-inconsistent'))).toBe(true);
  });
});

describe('benchmarkGateApplies (V23-06 release gate scope)', () => {
  it('returns true for v2.3.0 and above', () => {
    expect(gateModule.benchmarkGateApplies('2.3.0')).toBe(true);
    expect(gateModule.benchmarkGateApplies('2.3.5')).toBe(true);
    expect(gateModule.benchmarkGateApplies('2.4.0')).toBe(true);
    expect(gateModule.benchmarkGateApplies('3.0.0')).toBe(true);
  });

  it('returns false for v2.2.x and below', () => {
    expect(gateModule.benchmarkGateApplies('2.2.0')).toBe(false);
    expect(gateModule.benchmarkGateApplies('2.2.5')).toBe(false);
    expect(gateModule.benchmarkGateApplies('2.0.0')).toBe(false);
    expect(gateModule.benchmarkGateApplies('1.99.99')).toBe(false);
  });

  it('returns false for malformed version strings', () => {
    expect(gateModule.benchmarkGateApplies('')).toBe(false);
    expect(gateModule.benchmarkGateApplies('not-a-version')).toBe(false);
  });

  it('parseSemverPrefix matches benchmarkGateApplies', () => {
    expect(gateModule.parseSemverPrefix('2.3.0')).toEqual({ major: 2, minor: 3, patch: 0 });
    expect(gateModule.parseSemverPrefix('2.3.0-rc.1')).toEqual({
      major: 2,
      minor: 3,
      patch: 0,
    });
    expect(gateModule.parseSemverPrefix('garbage')).toBeNull();
  });
});
