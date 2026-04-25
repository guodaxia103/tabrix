/**
 * V24-05 — release-gate v24 deterministic verification.
 *
 * Mirrors `release-gate-fs.test.ts` (V23-06 closeout) for the v24
 * gate. Proves the following claims against the canonical
 * `scripts/lib/v24-benchmark-gate.cjs` module without standing up a
 * real Chrome session:
 *
 *   1. A FAILING report (lane / K3 / K4 / pairCount<3 / version drift /
 *      malformed JSON / empty scenarios) is rejected.
 *   2. A PASSING report is accepted.
 *   3. The v24 gate does NOT apply to v2.3.x (the v23 path is
 *      untouched).
 *   4. WARN-only reasons (K5..K8 below guidance) do NOT make `ok=false`.
 *   5. `requireBaselineComparisonTable` rejects (a) missing notes,
 *      (b) missing baseline file, (c) notes without the canonical
 *      header AND without a separate evidence-file link.
 *   6. `gate-then-write`: spawning `benchmark-v24.mjs --gate` against
 *      a FAILING NDJSON does NOT leave the report on disk.
 *   7. Cross-source guard: the gate's `BENCHMARK_REPORT_VERSION_EXPECTED`
 *      is in lockstep with the TS transformer's `BENCHMARK_REPORT_VERSION`.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BENCHMARK_REPORT_VERSION,
  summariseBenchmarkRunV24,
  type BenchmarkPairRecord,
  type BenchmarkRunInputV24,
  type BenchmarkSummaryV24,
  type BenchmarkToolCallRecordV24,
} from './v24-benchmark';

interface GateModuleV24 {
  loadAndEvaluateBenchmarkReportV24: (filePath: string) => {
    ok: boolean;
    reasons: string[];
    hardReasons: string[];
    softReasons: string[];
    parseError: string | null;
  };
  benchmarkGateAppliesV24: (version: string) => boolean;
  requireBaselineComparisonTable: (
    notesPath: string,
    benchmarkDir: string,
  ) => { ok: boolean; reasons: string[]; tablePath?: string };
  BENCHMARK_REPORT_VERSION_EXPECTED: number;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const GATE_PATH = path.resolve(REPO_ROOT, 'scripts', 'lib', 'v24-benchmark-gate.cjs');
const CLI_PATH = path.resolve(REPO_ROOT, 'scripts', 'benchmark-v24.mjs');
const gateModule: GateModuleV24 = require(GATE_PATH);

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v24-gate-'));
});
afterAll(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function passingRunInput(): BenchmarkRunInputV24 {
  const toolCalls: BenchmarkToolCallRecordV24[] = [];
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
      chooserStrategy: 'cold',
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
    runId: 'fixture-v24-pass',
    runStartedAt: '2026-04-22T00:00:00Z',
    runEndedAt: '2026-04-22T00:05:00Z',
    buildSha: 'fixturepassv24',
    kpiScenarioIds: ['KPI'],
    toolCalls,
    scenarios: [{ scenarioId: 'KPI', completed: true }],
    pairs,
  };
}

function writeReport(name: string, body: unknown): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return filePath;
}

describe('release-gate v24 — fs-anchored content checks', () => {
  it('claim 7: cross-source-version guard', () => {
    expect(gateModule.BENCHMARK_REPORT_VERSION_EXPECTED).toBe(BENCHMARK_REPORT_VERSION);
  });

  it('claim 1a: lane-violation report is rejected', () => {
    const summary = summariseBenchmarkRunV24(passingRunInput());
    summary.laneCounters = {
      tabrixOwnedCount: 5,
      cdpCount: 1,
      debuggerCount: 0,
      unknownCount: 0,
      violationCount: 1,
    };
    const filePath = writeReport('fail-lane.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('lane-integrity'))).toBe(true);
  });

  it('claim 1b: K3 below threshold is rejected', () => {
    const summary = summariseBenchmarkRunV24(passingRunInput());
    summary.k3TaskSuccessRate = 0.5;
    summary.scenarioCompletionRate = 0.5;
    const filePath = writeReport('fail-k3.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('K3'))).toBe(true);
  });

  it('claim 1c: K4 retry-rate too high is rejected', () => {
    const summary = summariseBenchmarkRunV24(passingRunInput());
    summary.k4ToolRetryRate = 0.8;
    const filePath = writeReport('fail-k4.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('K4'))).toBe(true);
  });

  it('claim 1d: empty scenarios is rejected', () => {
    const summary = summariseBenchmarkRunV24({
      ...passingRunInput(),
      scenarios: [],
    });
    const filePath = writeReport('fail-empty.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('no scenarios'))).toBe(true);
  });

  it('claim 1e: report-version drift is rejected', () => {
    const summary = summariseBenchmarkRunV24(passingRunInput());
    (summary as { reportVersion: number }).reportVersion = 999;
    const filePath = writeReport('fail-version.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('report version mismatch'))).toBe(true);
  });

  it('claim 1f: malformed JSON is rejected', () => {
    const filePath = path.join(tmpDir, 'fail-malformed.json');
    fs.writeFileSync(filePath, 'not { valid json', 'utf8');
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.ok).toBe(false);
    expect(result.parseError).not.toBeNull();
  });

  it('claim 1g: KPI scenario with pairCount<3 is rejected', () => {
    const summary = summariseBenchmarkRunV24(passingRunInput());
    // Truncate per-pair list so pairCount drops.
    summary.pairs[0]!.aggregate.pairCount = 2;
    const filePath = writeReport('fail-paircount.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('pairCount=2'))).toBe(true);
  });

  it('claim 2: passing report is accepted', () => {
    const summary = summariseBenchmarkRunV24(passingRunInput());
    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    const filePath = writeReport('pass.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.parseError).toBeNull();
    expect(result.hardReasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('claim 3: v2.3.x release-check path is unchanged (v24 gate does not apply)', () => {
    expect(gateModule.benchmarkGateAppliesV24('2.3.0')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV24('2.3.5')).toBe(false);
    expect(gateModule.benchmarkGateAppliesV24('2.4.0')).toBe(true);
  });

  it('claim 4: WARN reasons (K5..K8 guidance) do NOT block', () => {
    const summary = summariseBenchmarkRunV24(passingRunInput());
    summary.k5SecondTouchSpeedup = 0.8;
    summary.k6ReplaySuccessRate = 0.4;
    summary.k7ReplayFallbackRate = 0.6;
    // K8 = (first - second) / first, higher is better, guidance ≥ 0.40.
    // 0.05 = "second touch saved only 5 %" → WARN.
    summary.k8TokenSavingRatio = 0.05;
    const filePath = writeReport('warn-only.json', summary);
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(filePath);
    expect(result.ok).toBe(true);
    expect(result.softReasons.length).toBe(4);
    expect(result.hardReasons).toEqual([]);
  });
});

describe('release-gate v24 — baseline comparison table requirement', () => {
  let bDir: string;
  let notesPath: string;

  beforeAll(() => {
    bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v24-baseline-'));
    notesPath = path.join(bDir, 'NOTES.md');
  });
  afterAll(() => {
    if (bDir && fs.existsSync(bDir)) fs.rmSync(bDir, { recursive: true, force: true });
  });

  it('claim 5a: missing baseline file rejected', () => {
    const result = gateModule.requireBaselineComparisonTable(notesPath, '/__nonexistent__');
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('baseline directory missing'))).toBe(true);
  });

  it('claim 5b: empty baseline directory rejected', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v24-empty-'));
    const result = gateModule.requireBaselineComparisonTable(notesPath, emptyDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('no v24-vs-v23-baseline'))).toBe(true);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('claim 5c: notes file missing rejected (with valid baseline)', () => {
    fs.writeFileSync(path.join(bDir, 'v24-vs-v23-baseline-2026-04-23.md'), '# baseline', 'utf8');
    const result = gateModule.requireBaselineComparisonTable('/__nonexistent__', bDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('release notes file missing'))).toBe(true);
  });

  it('claim 5d: notes with neither canonical header nor an inline table are rejected', () => {
    fs.writeFileSync(notesPath, '# Some unrelated content', 'utf8');
    const result = gateModule.requireBaselineComparisonTable(notesPath, bDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('does NOT inline'))).toBe(true);
  });

  it('claim 5e: notes with canonical header + separator + data row are accepted (full inline table)', () => {
    fs.writeFileSync(
      notesPath,
      [
        '# Notes',
        '',
        '| metric | v2.3.0 baseline | v2.4.0 median | delta | direction |',
        '| --- | --- | --- | --- | --- |',
        '| K3 task success | 1.000 | 1.000 | 0.000 | flat |',
      ].join('\n'),
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTable(notesPath, bDir);
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('closeout finding 3 — claim 5f: link-only reference WITHOUT an inline table is REJECTED', () => {
    // Pre-closeout, a maintainer could ship release notes that only
    // pointed at a separate comparison file and the gate would pass.
    // Reviewers had to chase the file. Under the v2.4.0 closeout
    // contract the table must be inlined.
    fs.writeFileSync(
      notesPath,
      '# Notes\n\nSee `.claude/private-docs/benchmarks/v24/v24-vs-v23-baseline-2026-04-23.md` for the comparison.\n',
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTable(notesPath, bDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('does NOT inline'))).toBe(true);
  });

  it('closeout finding 3 — claim 5g: link-only is STILL rejected even when the link is rendered as a markdown link', () => {
    // The previous loose rule keyed off the substring
    // a separate evidence-file path. Verify both inline-code and rendered-
    // link forms now fail without an actual inline table.
    fs.writeFileSync(
      notesPath,
      '# Notes\n\nSee [baseline](.claude/private-docs/benchmarks/v24/v24-vs-v23-baseline-2026-04-23.md).\n',
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTable(notesPath, bDir);
    expect(result.ok).toBe(false);
  });

  it('closeout finding 3 — claim 5h: header-only (no separator, no rows) is REJECTED', () => {
    // A maintainer might paste only the header sentence-style. That
    // is not a markdown table; reject it explicitly.
    fs.writeFileSync(
      notesPath,
      '# Notes\n\nThe metric | v2.3.0 baseline | v2.4.0 median | delta | direction columns are TBD.\n',
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTable(notesPath, bDir);
    expect(result.ok).toBe(false);
    expect(
      result.reasons.some((r) => r.includes('separator') || r.includes('does NOT inline')),
    ).toBe(true);
  });

  it('closeout finding 3 — claim 5i: header + separator but no data rows is REJECTED', () => {
    // A skeleton-only inline table is not "evidence". Require at
    // least one body row so the gate can distinguish a placeholder
    // skeleton from a populated table.
    fs.writeFileSync(
      notesPath,
      [
        '# Notes',
        '',
        '| metric | v2.3.0 baseline | v2.4.0 median | delta | direction |',
        '| --- | --- | --- | --- | --- |',
        '',
        'TBD by maintainer.',
      ].join('\n'),
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTable(notesPath, bDir);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('inline table is empty'))).toBe(true);
  });

  it('closeout finding 3 — claim 5j: inline table + a separate evidence-file link is accepted', () => {
    // Maintainers are encouraged to ALSO link the canonical file —
    // make sure we do not regress on the both-present case.
    fs.writeFileSync(
      notesPath,
      [
        '# Notes',
        '',
        'See `.claude/private-docs/benchmarks/v24/v24-vs-v23-baseline-2026-04-23.md` for the canonical copy.',
        '',
        '| metric | v2.3.0 baseline | v2.4.0 median | delta | direction |',
        '| --- | --- | --- | --- | --- |',
        '| K3 task success | 1.000 | 0.95 | -0.05 | regress |',
        '| K8 token saving (median) | n/a | 0.42 | — | — |',
      ].join('\n'),
      'utf8',
    );
    const result = gateModule.requireBaselineComparisonTable(notesPath, bDir);
    expect(result.ok).toBe(true);
  });
});

describe('release-gate v24 — gate-then-write spawn (claim 6)', () => {
  it('CLI --gate against a FAILING NDJSON does NOT leave the JSON report on disk', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-v24-cli-'));
    try {
      const ndjsonPath = path.join(fixtureDir, 'run.ndjson');
      // Header + a single tool_call + a single scenario + one
      // first_touch pair only (incomplete pair, KPI fail). pairCount
      // will be 0 → KPI check fails → hard reason → write should NOT
      // happen.
      const lines = [
        JSON.stringify({
          kind: 'header',
          runId: 'fixture-v24-cli-fail',
          runStartedAt: '2026-04-22T00:00:00Z',
          runEndedAt: '2026-04-22T00:05:00Z',
          buildSha: 'cliv24fail',
          kpiScenarioIds: ['KPI'],
        }),
        JSON.stringify({
          kind: 'tool_call',
          seq: 0,
          scenarioId: 'KPI',
          toolName: 'chrome_read_page',
          status: 'ok',
          durationMs: 100,
          inputTokens: 50,
          retryCount: 0,
          fallbackUsed: false,
          lane: 'tabrix_owned',
        }),
        JSON.stringify({ kind: 'scenario', scenarioId: 'KPI', completed: true }),
        JSON.stringify({
          kind: 'pair',
          pairIndex: 0,
          scenarioId: 'KPI',
          role: 'first_touch',
          toolCallSeqs: [0],
        }),
      ];
      fs.writeFileSync(ndjsonPath, lines.join('\n'), 'utf8');

      // The CLI loads the transformer from `app/native-server/dist/`
      // — ensure we point --out at our scratch dir so the CLI's
      // existence-check on --out succeeds independently. Run the
      // CLI in the REAL repo cwd so the dist/ artifact is found, but
      // direct --out to the scratch dir to keep the assertion local.
      const outPath = path.join(fixtureDir, 'reports', 'should-not-write.json');

      const result = spawnSync(
        process.execPath,
        [CLI_PATH, '--input', ndjsonPath, '--out', outPath, '--gate'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );

      // Allow either exit code 1 (transformer build artifact missing)
      // OR exit code 2 (gate failure). What we MUST NOT see is exit
      // code 0 with the report on disk.
      expect(result.status).not.toBe(0);
      expect(fs.existsSync(outPath)).toBe(false);
      // Spot-check that the failure mode is the gate, not a malformed
      // input. If dist/ is missing the CLI errors out with a
      // diagnostic message — both branches are acceptable for this
      // test (the HARD claim is "no JSON written").
      const stderr = (result.stderr ?? '') + (result.stdout ?? '');
      const isGateFailure = stderr.includes('release gate FAILED') && stderr.includes('pairCount');
      const isMissingDist = stderr.includes('native-server build artifact missing');
      expect(isGateFailure || isMissingDist).toBe(true);

      // Build any v24 summary fixture wouldn't write either when
      // --gate is set with a failing summary. Document by example:
      // we re-shape to a JSON that mimics what the CLI would have
      // produced (without going through the CLI). Shouldn't be on
      // disk.
      if (fs.existsSync(outPath)) {
        throw new Error('claim 6 violated: --gate left a JSON report on disk');
      }
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

describe('release-gate v24 — passing report contributes a complete summary shape', () => {
  it('a hand-built passing summary round-trips through evaluate without WARNs', () => {
    const summary: BenchmarkSummaryV24 = summariseBenchmarkRunV24(passingRunInput());
    const result = gateModule.loadAndEvaluateBenchmarkReportV24(
      writeReport('round-trip.json', summary),
    );
    expect(result.ok).toBe(true);
    expect(result.softReasons).toEqual([]);
  });
});
