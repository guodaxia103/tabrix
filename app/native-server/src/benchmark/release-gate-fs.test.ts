/**
 * V23-06 closeout deterministic verification (P1-1).
 *
 * Proves the three claims the closeout brief requires:
 *   1. A FAILING benchmark report on disk → gate reports failure for v2.3.0+.
 *   2. A PASSING benchmark report on disk → gate reports pass for v2.3.0+.
 *   3. The gate does NOT apply to v2.2.0, so the v2.2.x release-check
 *      path is unchanged.
 *
 * Implementation note: we intentionally do NOT spawn `release:check`
 * itself here, because that script reads the real `package.json` files
 * at the repo root (resolving the live version), and faking a v2.3.0
 * checkout would require mutating the working tree — which the brief
 * explicitly forbids. Instead, we test the SAME `loadAndEvaluateBenchmarkReport`
 * helper that `check-release-readiness.mjs` calls, against real fixture
 * JSON files written to a temp directory. The integration in
 * `check-release-readiness.mjs` is a one-liner around this helper, so
 * exercising the helper is the deterministic proof.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BENCHMARK_REPORT_VERSION,
  summariseBenchmarkRun,
  type BenchmarkRunInput,
} from './v23-benchmark';

interface GateModule {
  loadAndEvaluateBenchmarkReport: (filePath: string) => {
    ok: boolean;
    reasons: string[];
    parseError: string | null;
  };
  benchmarkGateApplies: (version: string) => boolean;
}

const gateModule: GateModule = require(
  path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'v23-benchmark-gate.cjs'),
);
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v23-gate-'));
});

afterAll(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function passingRunInput(): BenchmarkRunInput {
  return {
    runId: 'fixture-pass',
    runStartedAt: '2026-04-22T00:00:00Z',
    runEndedAt: '2026-04-22T00:05:00Z',
    buildSha: 'fixturepass',
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
      },
    ],
    scenarios: [
      { scenarioId: 'T5-G-GH-REPO-NAV', completed: true },
      { scenarioId: 'T5-G-GH-ISSUE-OPEN', completed: true },
    ],
  };
}

function writeReport(name: string, body: unknown): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return filePath;
}

describe('release gate deterministic verification (V23-06 closeout P1-1)', () => {
  it('claim 1: a FAILING report (lane violation) is rejected by the gate', () => {
    // Build a passing report, then mutate it to inject a CDP lane
    // call so the lane-integrity invariant fails. Mirrors what would
    // happen if a real run accidentally fell back to a CDP path.
    const summary = summariseBenchmarkRun(passingRunInput());
    summary.laneCounters = {
      tabrixOwnedCount: 1,
      cdpCount: 1,
      debuggerCount: 0,
      unknownCount: 0,
      violationCount: 1,
    };
    const filePath = writeReport('fail-lane.json', summary);

    const result = gateModule.loadAndEvaluateBenchmarkReport(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('lane-integrity'))).toBe(true);
  });

  it('claim 1b: a FAILING report (K3 below threshold) is rejected by the gate', () => {
    const summary = summariseBenchmarkRun(passingRunInput());
    summary.k3TaskSuccessRate = 0.5;
    summary.scenarioCompletionRate = 0.5;
    const filePath = writeReport('fail-k3.json', summary);

    const result = gateModule.loadAndEvaluateBenchmarkReport(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('K3'))).toBe(true);
  });

  it('claim 1c: a FAILING report (K4 retry rate too high) is rejected by the gate', () => {
    const summary = summariseBenchmarkRun(passingRunInput());
    summary.k4ToolRetryRate = 0.8;
    const filePath = writeReport('fail-k4.json', summary);

    const result = gateModule.loadAndEvaluateBenchmarkReport(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('K4'))).toBe(true);
  });

  it('claim 1d: an empty-scenarios report is rejected by the gate', () => {
    const summary = summariseBenchmarkRun({
      ...passingRunInput(),
      scenarios: [],
    });
    const filePath = writeReport('fail-empty.json', summary);

    const result = gateModule.loadAndEvaluateBenchmarkReport(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('no scenarios'))).toBe(true);
  });

  it('claim 1e: a report-version drift is rejected by the gate', () => {
    const summary = summariseBenchmarkRun(passingRunInput());
    (summary as { reportVersion: number }).reportVersion = 999;
    const filePath = writeReport('fail-version.json', summary);

    const result = gateModule.loadAndEvaluateBenchmarkReport(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('report version mismatch'))).toBe(true);
  });

  it('claim 1f: a malformed JSON file is rejected (cannot smuggle in via filename)', () => {
    const filePath = path.join(tmpDir, 'fail-malformed.json');
    fs.writeFileSync(filePath, 'this is not { valid json', 'utf8');
    const result = gateModule.loadAndEvaluateBenchmarkReport(filePath);
    expect(result.ok).toBe(false);
    expect(result.parseError).not.toBeNull();
  });

  it('claim 2: a PASSING report is accepted by the gate', () => {
    const summary = summariseBenchmarkRun(passingRunInput());
    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    expect(summary.laneCounters.violationCount).toBe(0);
    const filePath = writeReport('pass.json', summary);

    const result = gateModule.loadAndEvaluateBenchmarkReport(filePath);
    expect(result.parseError).toBeNull();
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('claim 3: v2.2.x release-check path is unchanged (gate does not apply)', () => {
    expect(gateModule.benchmarkGateApplies('2.2.0')).toBe(false);
    expect(gateModule.benchmarkGateApplies('2.2.5')).toBe(false);
    // The v2.3.0+ path is the one that opts into the new content
    // gate, so this proves the closeout fix is bounded to v2.3.0+.
    expect(gateModule.benchmarkGateApplies('2.3.0')).toBe(true);
  });
});
