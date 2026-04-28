/**
 * V25-05 — `--allow-missing-notes` regression for the v2.5.0+ branch.
 *
 * Same shape as the V24-05 test (`release-gate-v24-allow-missing-notes.test.ts`),
 * scoped to the v25 branch of `scripts/check-release-readiness.mjs`.
 * The escape-hatch `--allow-missing-notes` is a notes-fallback escape
 * hatch only; it MUST NOT bypass the v25 benchmark content gate, the
 * baseline-comparison-table embed requirement, or the
 * `__V25_TBD__` placeholder rejection.
 *
 * Fixture shape:
 *   - Synthetic v2.5.0 fixture repo (versioned package.json files +
 *     CHANGELOG.md as the notes fallback target).
 *   - A FAILING benchmark report under the private evidence directory
 *     (lane-integrity violation).
 *   - A baseline comparison file present under
 *     v25-vs-v24-baseline-*.md evidence table.
 *   - CHANGELOG.md does NOT embed the comparison table.
 *
 * Two assertions:
 *   1. Spawn `check-release-readiness.mjs --tag v2.5.0 --allow-missing-notes` →
 *      exit non-zero AND stderr mentions the v2.5.0+ release-gate
 *      lane failure. Proves the escape hatch does not skip the gate.
 *   2. Same spawn without `--allow-missing-notes` → also fails (the
 *      release notes file is missing too) → control case.
 *
 * NOTE: this file does NOT bump any production package.json version
 * — the fixture lives under tmpDir for the duration of the test only.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  summariseBenchmarkRunV25,
  type BenchmarkPairRecord,
  type BenchmarkRunInputV25WithBaseline,
  type BenchmarkToolCallRecordV25,
} from './v25-benchmark';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'check-release-readiness.mjs');
const FIXTURE_VERSION = '2.5.0';

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-release-gate-v25-amn-'));
  scaffoldFixture(fixtureRoot, FIXTURE_VERSION);
  writeFailingBenchmarkReport(fixtureRoot);
  writeBaselineTable(fixtureRoot);
});

afterAll(() => {
  if (fixtureRoot && fs.existsSync(fixtureRoot)) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function scaffoldFixture(root: string, version: string): void {
  const writeJson = (rel: string, body: unknown) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  };

  writeJson('package.json', { name: 'tabrix-fixture', private: true, version });
  writeJson('app/native-server/package.json', {
    name: '@tabrix/tabrix',
    version,
    dependencies: { '@tabrix/shared': `^${version}` },
  });
  writeJson('app/chrome-extension/package.json', { name: '@tabrix/extension', version });
  writeJson('packages/shared/package.json', { name: '@tabrix/shared', version });

  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog (fixture)\n', 'utf8');
}

function buildPassingRunInput(): BenchmarkRunInputV25WithBaseline {
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
    runId: 'fixture-v25-amn-fail',
    runStartedAt: '2026-04-23T00:00:00Z',
    runEndedAt: '2026-04-23T00:05:00Z',
    buildSha: 'amnfix25',
    kpiScenarioIds: ['KPI'],
    toolCalls,
    scenarios: [{ scenarioId: 'KPI', completed: true }],
    pairs,
  };
}

function writeFailingBenchmarkReport(root: string): void {
  const summary = summariseBenchmarkRunV25(buildPassingRunInput());
  // Inject lane-integrity violation: identical shape of failure that
  // `benchmark-v25.mjs --gate` would block on.
  summary.laneCounters = {
    tabrixOwnedCount: 5,
    cdpCount: 1,
    debuggerCount: 0,
    unknownCount: 0,
    violationCount: 1,
  };
  const benchmarkDir = path.join(root, '.claude', 'private-docs', 'benchmarks', 'v25');
  fs.mkdirSync(benchmarkDir, { recursive: true });
  fs.writeFileSync(
    path.join(benchmarkDir, 'fixture-v25-amn-fail.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
}

function writeBaselineTable(root: string): void {
  const benchmarkDir = path.join(root, '.claude', 'private-docs', 'benchmarks', 'v25');
  fs.mkdirSync(benchmarkDir, { recursive: true });
  fs.writeFileSync(
    path.join(benchmarkDir, 'v25-vs-v24-baseline-2026-04-23.md'),
    [
      '# v2.5.0 vs v2.4.0 baseline comparison (fixture)',
      '',
      '| metric | v2.4 baseline | v2.5 median | delta | direction |',
      '| --- | --- | --- | --- | --- |',
      '| K3 task success | 1.0 | 1.0 | 0.0 | flat |',
      '',
    ].join('\n'),
    'utf8',
  );
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runReleaseCheck(extraArgs: string[]): SpawnResult {
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, '--tag', `v${FIXTURE_VERSION}`, ...extraArgs],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '' },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('release-check `--allow-missing-notes` does NOT bypass v2.5.0+ benchmark gate', () => {
  it('exits non-zero with a v2.5.0+ benchmark-gate failure even when --allow-missing-notes is set', () => {
    const result = runReleaseCheck(['--allow-missing-notes']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('v2.5.0+ release gate');
    expect(result.stderr).toContain('failed gate');
    expect(result.stderr).toContain('lane-integrity');
  });

  it('also fails (same gate) without --allow-missing-notes — control case', () => {
    const result = runReleaseCheck([]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('v2.5.0+ release gate');
    expect(result.stderr).toContain('failed gate');
  });
});
