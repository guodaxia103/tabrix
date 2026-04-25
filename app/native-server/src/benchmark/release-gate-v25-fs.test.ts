/**
 * V25-05 — release-gate v25 fs-level verification.
 *
 * Mirrors `release-gate-v24-fs.test.ts` for the v25 gate. Pins the
 * full negative matrix from the V25-05 plan (see
 * `.claude/strategy/TABRIX_V2_5_P0_CHAIN_V3_1.md` §V25-05 step 2):
 *
 *   - passing report
 *   - missing report
 *   - stale report
 *   - bad report version
 *   - missing embedded baseline-comparison table
 *   - link-only table fails
 *   - bad L0 token ratio
 *   - bad correctness regression (K3 / K4)
 *   - bad median tool-call regression
 *   - bad fallback regression (visual / JS)
 *   - release notes still contain `__V25_TBD__`
 *   - cross-source guard: gate's `BENCHMARK_REPORT_VERSION_EXPECTED`
 *     stays in lockstep with the TS transformer's
 *     `BENCHMARK_REPORT_VERSION`
 *   - mutual-exclusion claim: the v25 gate does NOT apply to v2.4.x
 *     (those still route to the v24 gate)
 *
 * No real Chrome is started. Synthetic v25 summaries are produced via
 * `summariseBenchmarkRunV25` and round-tripped through the canonical
 * CJS module at `scripts/lib/v25-benchmark-gate.cjs`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BENCHMARK_REPORT_VERSION,
  summariseBenchmarkRunV25,
  type BenchmarkPairRecord,
  type BenchmarkRunInputV25WithBaseline,
  type BenchmarkSummaryV25,
  type BenchmarkToolCallRecordV25,
} from './v25-benchmark';
import type { BenchmarkSummaryV24 } from './v24-benchmark';

interface GateModuleV25 {
  BENCHMARK_REPORT_VERSION_EXPECTED: number;
  RELEASE_NOTES_PLACEHOLDER_TOKEN: string;
  loadAndEvaluateBenchmarkReportV25: (filePath: string) => {
    ok: boolean;
    reasons: string[];
    hardReasons: string[];
    softReasons: string[];
    parseError: string | null;
  };
  benchmarkGateAppliesV25: (version: string) => boolean;
  requireBaselineComparisonTableV25: (
    notesPath: string,
    benchmarkDir: string,
  ) => { ok: boolean; reasons: string[]; tablePath?: string };
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const GATE_PATH = path.resolve(REPO_ROOT, 'scripts', 'lib', 'v25-benchmark-gate.cjs');
const gateModule: GateModuleV25 = require(GATE_PATH);

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v25-gate-'));
});
afterAll(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeReport(name: string, body: unknown): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return filePath;
}

/**
 * Builds a v25 run input that produces a clean, gate-passing summary
 * when round-tripped through `summariseBenchmarkRunV25`. Mirrors the
 * `passingRunInput()` fixture inside `v25-benchmark.test.ts` so the
 * shape stays in lockstep with the transformer's own coverage.
 */
function passingRunInput(): BenchmarkRunInputV25WithBaseline {
  const toolCalls: BenchmarkToolCallRecordV25[] = [];
  const pairs: BenchmarkPairRecord[] = [];
  let seq = 0;
  for (let i = 0; i < 3; i += 1) {
    const f = seq++;
    const s = seq++;
    toolCalls.push({
      seq: f,
      scenarioId: 'KPI',
      toolName: 'chrome_read_page',
      status: 'ok',
      durationMs: 1000,
      inputTokens: 100,
      retryCount: 0,
      fallbackUsed: false,
      lane: 'tabrix_owned',
      chosenLayer: 'L0',
      sourceRoute: 'read_page_required',
      tokenEstimateChosen: 30,
      tokenEstimateFullRead: 200,
    });
    toolCalls.push({
      seq: s,
      scenarioId: 'KPI',
      toolName: 'chrome_click_element',
      status: 'ok',
      durationMs: 400,
      inputTokens: 30,
      retryCount: 0,
      fallbackUsed: false,
      lane: 'tabrix_owned',
      clickAttempts: 1,
      chooserStrategy: 'experience_replay',
    });
    pairs.push({ pairIndex: i, scenarioId: 'KPI', role: 'first_touch', toolCallSeqs: [f] });
    pairs.push({ pairIndex: i, scenarioId: 'KPI', role: 'second_touch', toolCallSeqs: [s] });
  }
  return {
    runId: 'fixture-v25-pass',
    runStartedAt: '2026-04-23T00:00:00Z',
    runEndedAt: '2026-04-23T00:05:00Z',
    buildSha: 'fixturepassv25',
    kpiScenarioIds: ['KPI'],
    toolCalls,
    scenarios: [{ scenarioId: 'KPI', completed: true }],
    pairs,
  };
}

/**
 * Builds a baseline v24 summary the v25 transformer can attach via
 * `comparisonBaselineV24`. Synthetic — the values are chosen so the
 * delta math keeps the v25 passing fixture inside the regression
 * ceilings (K3 delta = 0, K4 delta = 0, click attempts delta ≤ 0,
 * fallback deltas ≤ 0).
 */
function passingV24Baseline(): BenchmarkSummaryV24 {
  return {
    reportVersion: 1,
    runId: 'baseline-v24',
    runStartedAt: '2026-04-22T00:00:00Z',
    runEndedAt: '2026-04-22T00:05:00Z',
    buildSha: 'baselinev24',
    totalToolCalls: 6,
    totalScenarios: 1,
    completedScenarios: 1,
    scenarioCompletionRate: 1,
    k1MeanInputTokens: 100,
    k2PerToolLatencyMs: [],
    k3TaskSuccessRate: 1,
    k4ToolRetryRate: 0,
    k4FallbackRate: 0,
    k5SecondTouchSpeedupMedian: 1,
    k6ReplaySuccessRate: 1,
    k7ReplayFallbackRate: 0,
    k8TokenSavingRatio: 0,
    scenarioCompletion: { completed: 1, total: 1 },
    scenarioCompletionPerScenario: [],
    scenarioCompletionPerScenarioMap: {},
    scenarioCompletionRatePerScenario: {},
    laneCounters: {
      tabrixOwnedCount: 6,
      cdpCount: 0,
      debuggerCount: 0,
      unknownCount: 0,
      violationCount: 0,
    },
    pairs: [],
    perToolMeanInputTokens: [],
    medianToolCallsPerScenario: 2,
    meanClickAttemptsPerStep: 1,
    chooserStrategyDistribution: {
      experience_replay: 0,
      experience_reuse: 0,
      knowledge_light: 0,
      read_page_required: 0,
      unknown: 0,
    },
    replayEligibilityDistribution: {
      experience_replay: 0,
      experience_reuse: 0,
      knowledge_light: 0,
      read_page_required: 0,
      unknown: 0,
    },
    replayEligibilityBlockedBy: {},
    kpiScenarioIds: ['KPI'],
    pairCountMax: 3,
  } as unknown as BenchmarkSummaryV24;
}

describe('release-gate v25 — fs-anchored content checks (V25-05 negative matrix)', () => {
  it('cross-source-version guard: .cjs gate matches TS transformer', () => {
    expect(gateModule.BENCHMARK_REPORT_VERSION_EXPECTED).toBe(BENCHMARK_REPORT_VERSION);
  });

  it('mutual-exclusion: v25 gate does NOT apply to v2.4.x (those still use v24)', () => {
    expect(gateModule.benchmarkGateAppliesV25('2.4.0')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV25('2.4.5')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV25('2.5.0')).toBe(true);
    expect(gateModule.benchmarkGateAppliesV25('2.5.4')).toBe(true);
    expect(gateModule.benchmarkGateAppliesV25('3.0.0')).toBe(true);
    expect(gateModule.benchmarkGateAppliesV25('1.0.0')).toBe(false);
  });

  it('passing v25 report is accepted (clean fixture)', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    const filePath = writeReport('pass.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.parseError).toBeNull();
    expect(result.hardReasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('missing report file is rejected (parseError surfaces, ok=false)', () => {
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(
      path.join(tmpDir, 'does-not-exist.json'),
    );
    expect(result.ok).toBe(false);
    expect(result.parseError).not.toBeNull();
  });

  it('malformed JSON is rejected', () => {
    const filePath = path.join(tmpDir, 'malformed.json');
    fs.writeFileSync(filePath, '{ not valid json', 'utf8');
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.parseError).not.toBeNull();
  });

  it('bad report version (drift) is rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    (summary as { reportVersion: number }).reportVersion = 999;
    const filePath = writeReport('bad-version.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('report version mismatch'))).toBe(true);
  });

  it('lane-integrity violation is rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.laneCounters = {
      tabrixOwnedCount: 5,
      cdpCount: 1,
      debuggerCount: 0,
      unknownCount: 0,
      violationCount: 1,
    };
    const filePath = writeReport('bad-lane.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('lane-integrity'))).toBe(true);
  });

  it('K3 below threshold is rejected (correctness regression)', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.methodMetrics.k3TaskSuccessRate = 0.5;
    const filePath = writeReport('bad-k3.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('K3'))).toBe(true);
  });

  it('K4 above threshold is rejected (correctness regression)', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.methodMetrics.k4ToolRetryRate = 0.5;
    const filePath = writeReport('bad-k4.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('K4'))).toBe(true);
  });

  it('empty scenarios is rejected', () => {
    // Build a summary then strip scenarios — `totalScenarios` becomes 0
    // and the gate's "no scenarios" hard reason fires.
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.totalScenarios = 0;
    summary.scenarioSummaries = [];
    const filePath = writeReport('bad-empty.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('no scenarios'))).toBe(true);
  });

  it('KPI scenario with pairedRunCount<3 is rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    const kpi = summary.scenarioSummaries.find((s) => s.scenarioId === 'KPI');
    if (!kpi) throw new Error('fixture missing KPI scenario summary');
    kpi.pairedRunCount = 2;
    const filePath = writeReport('bad-paircount.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('pairedRunCount=2'))).toBe(true);
  });

  it('L0 token-ratio median above ceiling is rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.layerMetrics.l0TokenRatioMedian = 0.99;
    const filePath = writeReport('bad-l0-ratio.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('L0 token-ratio'))).toBe(true);
  });

  it('L0+L1 token-ratio median above ceiling is rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.layerMetrics.l0L1TokenRatioMedian = 0.99;
    const filePath = writeReport('bad-l0l1-ratio.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('L0+L1 token-ratio'))).toBe(true);
  });

  it('source-route "unknown" bucket non-empty is rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.layerMetrics.sourceRouteDistribution.unknown = 2;
    const filePath = writeReport('bad-route.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('sourceRoute "unknown"'))).toBe(true);
  });

  it('chosenLayer "unknown" bucket non-empty is rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.layerMetrics.chosenLayerDistribution.unknown = 1;
    const filePath = writeReport('bad-layer.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('chosenLayer "unknown"'))).toBe(true);
  });

  it('bad correctness regression vs baseline (K3 delta below ceiling) is rejected', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      comparisonBaselineV24: passingV24Baseline(),
    });
    if (!summary.comparisonToV24) throw new Error('expected comparisonToV24 to be present');
    summary.comparisonToV24.deltas.k3TaskSuccessRate = -0.5; // -0.5 < -0.02 ceiling
    const filePath = writeReport('regress-k3.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('K3 regressed'))).toBe(true);
  });

  it('bad K4 regression vs baseline is rejected', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      comparisonBaselineV24: passingV24Baseline(),
    });
    if (!summary.comparisonToV24) throw new Error('expected comparisonToV24 to be present');
    summary.comparisonToV24.deltas.k4ToolRetryRate = 0.5; // > +0.01 ceiling
    const filePath = writeReport('regress-k4.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('K4 regressed'))).toBe(true);
  });

  it('bad median tool-call regression vs baseline is rejected', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      comparisonBaselineV24: passingV24Baseline(),
    });
    if (!summary.comparisonToV24) throw new Error('expected comparisonToV24 to be present');
    summary.comparisonToV24.deltas.medianToolCallsPerScenario = 5; // any positive delta is too many
    const filePath = writeReport('regress-tool-calls.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('median tool calls'))).toBe(true);
  });

  it('bad click-attempts regression vs baseline is rejected', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      comparisonBaselineV24: passingV24Baseline(),
    });
    if (!summary.comparisonToV24) throw new Error('expected comparisonToV24 to be present');
    summary.comparisonToV24.deltas.clickAttemptsPerSuccess = 1.5; // worse than v24
    const filePath = writeReport('regress-click-attempts.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('click attempts per success'))).toBe(true);
  });

  it('bad visual-fallback regression vs baseline is rejected (above absolute floor too)', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      comparisonBaselineV24: passingV24Baseline(),
    });
    if (!summary.comparisonToV24) throw new Error('expected comparisonToV24 to be present');
    summary.comparisonToV24.deltas.visualFallbackRate = 0.5;
    summary.stabilityMetrics.visualFallbackRate = 0.9; // > absolute 0.05 floor
    const filePath = writeReport('regress-visual.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('visual fallback rate'))).toBe(true);
  });

  it('bad JS-fallback regression vs baseline is rejected (above absolute floor too)', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      comparisonBaselineV24: passingV24Baseline(),
    });
    if (!summary.comparisonToV24) throw new Error('expected comparisonToV24 to be present');
    summary.comparisonToV24.deltas.jsFallbackRate = 0.5;
    summary.stabilityMetrics.jsFallbackRate = 0.9;
    const filePath = writeReport('regress-js.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('JS fallback rate'))).toBe(true);
  });

  it('no-baseline path: visual-fallback above absolute floor is still rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput()); // no baseline
    summary.stabilityMetrics.visualFallbackRate = 0.6;
    const filePath = writeReport('no-baseline-bad-visual.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('absolute ceiling'))).toBe(true);
  });

  it('no-baseline path: JS-fallback above absolute floor is still rejected', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    summary.stabilityMetrics.jsFallbackRate = 0.6;
    const filePath = writeReport('no-baseline-bad-js.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('absolute ceiling'))).toBe(true);
  });

  it('tab hygiene: passing report round-trips through JSON (V25-05 closeout)', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      tabHygiene: {
        primaryTabId: 42,
        baselineTabIds: [1],
        observedTabIds: [1, 42],
        openedTabIds: [42],
        closedTabIds: [],
        maxConcurrentTabs: 2,
        samePrimaryTabNavigations: 8,
        expectedPrimaryTabNavigations: 8,
        violations: [],
      },
    });
    expect(summary.tabHygiene?.primaryTabReuseRate).toBe(1);
    const filePath = writeReport('hygiene-pass.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.parseError).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.hardReasons).toEqual([]);
  });

  it('tab hygiene: primaryTabReuseRate < 0.95 is rejected after round-trip', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      tabHygiene: {
        primaryTabId: 42,
        baselineTabIds: [1],
        observedTabIds: [1, 42, 99],
        openedTabIds: [42, 99],
        closedTabIds: [],
        maxConcurrentTabs: 2,
        samePrimaryTabNavigations: 5,
        expectedPrimaryTabNavigations: 10,
        violations: [],
      },
    });
    const filePath = writeReport('hygiene-bad-reuse.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('primaryTabReuseRate'))).toBe(true);
  });

  it('tab hygiene: maxConcurrentTabs > 2 is rejected after round-trip', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      tabHygiene: {
        primaryTabId: 42,
        baselineTabIds: [1],
        observedTabIds: [1, 42, 50, 60, 70],
        openedTabIds: [42, 50, 60, 70],
        closedTabIds: [],
        maxConcurrentTabs: 5,
        samePrimaryTabNavigations: 10,
        expectedPrimaryTabNavigations: 10,
        violations: [],
      },
    });
    const filePath = writeReport('hygiene-bad-concurrent.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('maxConcurrentTabs'))).toBe(true);
  });

  it('tab hygiene: any violation entry rejects the report', () => {
    const summary = summariseBenchmarkRunV25({
      ...passingRunInput(),
      tabHygiene: {
        primaryTabId: 42,
        baselineTabIds: [],
        observedTabIds: [42, 99],
        openedTabIds: [42, 99],
        closedTabIds: [],
        maxConcurrentTabs: 2,
        samePrimaryTabNavigations: 9,
        expectedPrimaryTabNavigations: 10,
        violations: [{ scenarioId: 'GH-LEAK', kind: 'unexpected_new_tab', detail: 'tabId=99' }],
      },
    });
    const filePath = writeReport('hygiene-violation.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('tabHygieneViolations'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('unexpected_new_tab=1'))).toBe(true);
  });

  it('tab hygiene: report without tabHygiene block is tolerated (legacy NDJSON)', () => {
    const summary = summariseBenchmarkRunV25(passingRunInput());
    expect(summary.tabHygiene).toBeNull();
    const filePath = writeReport('hygiene-absent.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(filePath);
    expect(result.ok).toBe(true);
    expect(result.reasons.some((r) => r.includes('primaryTabReuseRate'))).toBe(false);
    expect(result.reasons.some((r) => r.includes('tabHygiene'))).toBe(false);
  });
});

describe('release-gate v25 — baseline-comparison-table requirement (release-notes-side checks)', () => {
  let bDir: string;
  let notesPath: string;

  beforeAll(() => {
    bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v25-baseline-'));
    notesPath = path.join(bDir, 'NOTES.md');
  });
  afterAll(() => {
    if (bDir && fs.existsSync(bDir)) fs.rmSync(bDir, { recursive: true, force: true });
  });

  it('missing baseline directory is rejected', () => {
    const result = gateModule.requireBaselineComparisonTableV25(notesPath, '/__nonexistent__');
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('baseline directory missing'))).toBe(true);
  });

  it('empty baseline directory (no v25-vs-v24-baseline-*.md) is rejected', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v25-empty-'));
    const result = gateModule.requireBaselineComparisonTableV25(notesPath, emptyDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('no v25-vs-v24-baseline'))).toBe(true);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('notes-file missing is rejected (with valid baseline)', () => {
    fs.writeFileSync(path.join(bDir, 'v25-vs-v24-baseline-2026-04-23.md'), '# baseline', 'utf8');
    const result = gateModule.requireBaselineComparisonTableV25('/__nonexistent__', bDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('release notes file missing'))).toBe(true);
  });

  it('notes WITHOUT canonical inline header is rejected (link-only is NOT enough)', () => {
    fs.writeFileSync(
      notesPath,
      '# Notes\n\nSee `.claude/private-docs/benchmarks/v25/v25-vs-v24-baseline-2026-04-23.md`.\n',
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTableV25(notesPath, bDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('does NOT inline'))).toBe(true);
  });

  it('header + separator but no body row is rejected (skeleton-only)', () => {
    fs.writeFileSync(
      notesPath,
      [
        '# Notes',
        '',
        '| metric | v2.4 baseline | v2.5 median | delta | direction |',
        '| --- | --- | --- | --- | --- |',
        '',
        'TBD by maintainer.',
      ].join('\n'),
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTableV25(notesPath, bDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('inline table is empty'))).toBe(true);
  });

  it('full inline table (header + separator + ≥1 body row) is accepted', () => {
    fs.writeFileSync(
      notesPath,
      [
        '# Notes',
        '',
        '| metric | v2.4 baseline | v2.5 median | delta | direction |',
        '| --- | --- | --- | --- | --- |',
        '| K3 task success | 1.000 | 1.000 | 0.000 | flat |',
      ].join('\n'),
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTableV25(notesPath, bDir);
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('release notes still containing `__V25_TBD__` is rejected EVEN WITH a valid table', () => {
    fs.writeFileSync(
      notesPath,
      [
        '# Notes',
        '',
        '| metric | v2.4 baseline | v2.5 median | delta | direction |',
        '| --- | --- | --- | --- | --- |',
        '| K3 task success | 1.000 | __V25_TBD__ | __V25_TBD__ | __V25_TBD__ |',
      ].join('\n'),
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTableV25(notesPath, bDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes(gateModule.RELEASE_NOTES_PLACEHOLDER_TOKEN))).toBe(
      true,
    );
  });
});

describe('release-gate v25 — passing report contributes a complete summary shape', () => {
  it('a hand-built passing summary round-trips through evaluate without WARNs', () => {
    const summary: BenchmarkSummaryV25 = summariseBenchmarkRunV25(passingRunInput());
    const result = gateModule.loadAndEvaluateBenchmarkReportV25(
      writeReport('round-trip.json', summary),
    );
    expect(result.ok).toBe(true);
    expect(result.softReasons).toEqual([]);
  });
});
