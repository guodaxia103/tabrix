/**
 * V25-04 fs-level test for `scripts/release-diagnostic-v25.mjs`.
 *
 * Spawns the diagnostic CLI as a subprocess against tmpdir-written
 * fixture reports and asserts:
 *  - exit codes match the documented contract
 *  - stable counter strings show up in human text mode
 *  - --json mode emits a single-line JSON object the release lane can
 *    pipe into other tools without parsing whitespace
 *  - the script does NOT enforce gate thresholds (V25-04 forbids
 *    growing this script into a gate; that is V25-05's job)
 *  - the script REJECTS reports whose `reportVersion !== 'v25'`
 *
 * We deliberately spawn the real script (not import it) because that
 * is exactly the surface a release-lane operator uses.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BENCHMARK_REPORT_VERSION,
  summariseBenchmarkRunV25,
  type BenchmarkRunInputV25WithBaseline,
} from './v25-benchmark';

const SCRIPT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'release-diagnostic-v25.mjs',
);

function runDiagnostic(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const proc = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
  });
  return {
    status: proc.status,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? '',
  };
}

function fixtureRunInput(): BenchmarkRunInputV25WithBaseline {
  return {
    runId: 'diag-fixture-1',
    runStartedAt: '2026-04-22T00:00:00Z',
    runEndedAt: '2026-04-22T00:10:00Z',
    buildSha: 'diagfixt001',
    kpiScenarioIds: ['T5-G-GH-REPO-NAV'],
    toolCalls: [
      {
        seq: 0,
        scenarioId: 'T5-G-GH-REPO-NAV',
        toolName: 'chrome_read_page',
        status: 'ok',
        durationMs: 100,
        inputTokens: 500,
        retryCount: 0,
        fallbackUsed: false,
        lane: 'tabrix_owned',
        chosenLayer: 'L0',
        layerDispatchReason: 'task_type_summary_l0',
        sourceRoute: 'read_page_required',
        tokenEstimateChosen: 200,
        tokenEstimateFullRead: 800,
        tokensSavedEstimate: 600,
        readPageAvoided: false,
        strategy: 'experience_replay',
      },
      {
        seq: 1,
        scenarioId: 'T5-G-GH-REPO-NAV',
        toolName: 'chrome_click_element',
        status: 'ok',
        durationMs: 200,
        inputTokens: null,
        retryCount: 0,
        fallbackUsed: false,
        lane: 'tabrix_owned',
        clickAttempts: 1,
        noObservedChange: false,
        visualFallbackUsed: false,
        jsFallbackUsed: false,
      },
    ],
    scenarios: [
      {
        scenarioId: 'T5-G-GH-REPO-NAV',
        status: 'completed',
        startedAt: '2026-04-22T00:00:00Z',
        endedAt: '2026-04-22T00:10:00Z',
      },
    ],
    pairs: [
      { pairIndex: 0, scenarioId: 'T5-G-GH-REPO-NAV', role: 'v24', toolCallSeqs: [] },
      { pairIndex: 0, scenarioId: 'T5-G-GH-REPO-NAV', role: 'v25', toolCallSeqs: [0, 1] },
      { pairIndex: 1, scenarioId: 'T5-G-GH-REPO-NAV', role: 'v24', toolCallSeqs: [] },
      { pairIndex: 1, scenarioId: 'T5-G-GH-REPO-NAV', role: 'v25', toolCallSeqs: [0, 1] },
      { pairIndex: 2, scenarioId: 'T5-G-GH-REPO-NAV', role: 'v24', toolCallSeqs: [] },
      { pairIndex: 2, scenarioId: 'T5-G-GH-REPO-NAV', role: 'v25', toolCallSeqs: [0, 1] },
    ],
  };
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v25-diag-'));
});

afterAll(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeReport(name: string, body: unknown): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, JSON.stringify(body, null, 2), 'utf8');
  return filePath;
}

describe('release-diagnostic-v25', () => {
  it('--help exits 0 and prints a usage block', () => {
    const result = runDiagnostic(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/release-diagnostic-v25/i);
    expect(result.stdout).toContain('--input');
    expect(result.stdout).toContain('--json');
  });

  it('exits 2 when --input is missing', () => {
    const result = runDiagnostic([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/missing required --input/);
  });

  it('exits 3 when the report file does not exist', () => {
    const result = runDiagnostic(['--input', path.join(tmpDir, 'does-not-exist.json')]);
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/cannot read report/);
  });

  it('exits 3 when the report file is malformed JSON', () => {
    const filePath = path.join(tmpDir, 'malformed.json');
    fs.writeFileSync(filePath, '{not json', 'utf8');
    const result = runDiagnostic(['--input', filePath]);
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/not valid JSON/);
  });

  it('exits 4 when the report has a non-v25 reportVersion (e.g. v24 string pin)', () => {
    const filePath = writeReport('wrong-version.json', {
      reportVersion: 'v2.4',
      runId: 'x',
      buildSha: 'y',
    });
    const result = runDiagnostic(['--input', filePath]);
    expect(result.status).toBe(4);
    expect(result.stderr).toMatch(/expected reportVersion=1/);
  });

  it('emits a human-readable diagnostic panel for a real v25 report', () => {
    const summary = summariseBenchmarkRunV25(fixtureRunInput());
    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    const filePath = writeReport('happy.json', summary);

    const result = runDiagnostic(['--input', filePath]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const out = result.stdout;
    expect(out).toContain('Tabrix v2.5 release diagnostic');
    expect(out).toContain('runId:');
    expect(out).toContain('Layer dispatch');
    expect(out).toContain('Source route');
    expect(out).toContain('Stability');
    expect(out).toContain('Method');
    // Strict surface check: stability counter labels MUST be present
    // so the release lane operator never has to guess at field names.
    expect(out).toContain('noObservedChangeRate');
    expect(out).toContain('visualFallbackRate');
    expect(out).toContain('jsFallbackRate');
    expect(out).toContain('replaySuccessRate');
    expect(out).toContain('clickAttempts/success');
  });

  it('--json mode emits a single-line JSON object with stability + layer counters', () => {
    const summary = summariseBenchmarkRunV25(fixtureRunInput());
    const filePath = writeReport('happy-json.json', summary);

    const result = runDiagnostic(['--input', filePath, '--json']);
    expect(result.status).toBe(0);

    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]);
    expect(payload.runId).toBe('diag-fixture-1');
    expect(payload.buildSha).toBe('diagfixt001');
    expect(payload.layer).toBeDefined();
    expect(payload.layer.chosenLayerDistribution).toBeDefined();
    expect(payload.layer.sourceRouteDistribution).toBeDefined();
    expect(payload.stability).toBeDefined();
    expect(payload.stability.noObservedChangeRate ?? null).not.toBeUndefined();
    expect(payload.stability.visualFallbackRate ?? null).not.toBeUndefined();
    expect(payload.stability.jsFallbackRate ?? null).not.toBeUndefined();
    expect(payload.method).toBeDefined();
  });

  it('does NOT enforce gate thresholds (it never exits non-zero on threshold breach)', () => {
    // Construct a report whose stability metrics would fail the V25-05
    // gate (e.g. visualFallbackRate=1.0). The diagnostic must still
    // exit 0 because gate enforcement lives in V25-05, not here.
    const filePath = writeReport('worst-case.json', {
      reportVersion: BENCHMARK_REPORT_VERSION,
      runId: 'gate-bad',
      buildSha: 'gatebad001',
      totalToolCalls: 1,
      totalScenarios: 1,
      completedScenarios: 1,
      pairedRunCountMax: 0,
      stabilityMetrics: {
        noObservedChangeRate: 1,
        visualFallbackRate: 1,
        jsFallbackRate: 1,
        replaySuccessRate: 0,
        replayFallbackDepthMedian: null,
      },
      layerMetrics: {
        chosenLayerDistribution: { L0: 0, 'L0+L1': 0, 'L0+L1+L2': 1 },
        dispatchReasonDistribution: {},
        sourceRouteDistribution: {
          read_page_required: 1,
          experience_replay_skip_read: 0,
          knowledge_supported_read: 0,
          dispatcher_fallback_safe: 0,
          unknown: 0,
        },
        l0TokenRatioMedian: null,
        l0L1TokenRatioMedian: null,
        tokensSavedEstimateTotal: 0,
        readPageAvoidedCount: 0,
        fallbackCauseDistribution: {},
        strategyDistribution: {},
      },
      methodMetrics: {
        clickAttemptsPerSuccessMedian: null,
        medianToolCallsPerScenario: null,
        k3TaskSuccessRate: 0,
        k4ToolRetryRate: 1,
      },
    });

    const result = runDiagnostic(['--input', filePath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('visualFallbackRate:    100.0%');
  });
});
