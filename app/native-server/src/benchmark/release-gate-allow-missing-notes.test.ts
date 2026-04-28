/**
 * V23-06 closeout follow-up (P1 — `--allow-missing-notes` regression).
 *
 * Bug history:
 *   `scripts/check-release-readiness.mjs` previously gated the entire
 *   v2.3.0+ benchmark content check behind
 *     `if (benchmarkGateApplies(version) && !options.allowMissingNotes)`
 *   which meant a maintainer (or CI) passing `--allow-missing-notes`
 *   silently bypassed the K3 / K4 / lane-integrity / reportVersion /
 *   empty-scenarios checks. The flag's intended scope is the release
 *   NOTES file fallback (notes file missing → fall back to CHANGELOG.md);
 *   it is NOT a release-gate escape hatch.
 *
 * This test spawns the actual `check-release-readiness.mjs` script
 * against a synthetic v2.3.0 fixture repo (so we exercise the real wiring
 * end-to-end, not just a refactored predicate). The fixture has:
 *   - a failing benchmark report on disk under the private evidence directory
 *     (lane-integrity violation injected — same shape of failure
 *     `benchmark-v23.mjs --gate` would block on)
 *   - NO release notes file
 *   - a CHANGELOG.md so the notes-fallback under `--allow-missing-notes`
 *     succeeds (otherwise the run could fail for the WRONG reason)
 *
 * Claim: the spawn must exit non-zero AND stderr must mention the
 * v2.3.0+ release-gate failure, even with `--allow-missing-notes`.
 *
 * We deliberately spawn the script (rather than refactoring the
 * predicate into an exported pure function and asserting on it) because
 * the bug was wiring-level: the fix is a 1-line guard removal in the
 * script's top-level imperative flow. A pure-function unit test would
 * pass even if someone re-introduced the `!options.allowMissingNotes`
 * conjunction. End-to-end spawn is the deterministic guard.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { summariseBenchmarkRun, type BenchmarkRunInput } from './v23-benchmark';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'check-release-readiness.mjs');
const FIXTURE_VERSION = '2.3.0';

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-release-gate-amn-'));
  scaffoldFixture(fixtureRoot, FIXTURE_VERSION);
  writeFailingBenchmarkReport(fixtureRoot);
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

  // No RELEASE_NOTES_v2.3.0.md on purpose — that is the trigger for
  // `--allow-missing-notes` fallback, and pre-fix it ALSO short-circuited
  // the benchmark gate. CHANGELOG.md is present so the notes-fallback
  // path succeeds; otherwise the run could fail for the wrong reason.
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog (fixture)\n', 'utf8');
}

function writeFailingBenchmarkReport(root: string): void {
  const baseInput: BenchmarkRunInput = {
    runId: 'fixture-amn-fail',
    runStartedAt: '2026-04-22T00:00:00Z',
    runEndedAt: '2026-04-22T00:05:00Z',
    buildSha: 'amnfix',
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
    ],
    scenarios: [{ scenarioId: 'T5-G-GH-REPO-NAV', completed: true }],
  };
  const summary = summariseBenchmarkRun(baseInput);
  // Inject lane-integrity violation: same shape of failure that
  // `benchmark-v23.mjs --gate` would block on.
  summary.laneCounters = {
    tabrixOwnedCount: 1,
    cdpCount: 1,
    debuggerCount: 0,
    unknownCount: 0,
    violationCount: 1,
  };

  const benchmarkDir = path.join(root, '.claude', 'private-docs', 'benchmarks', 'v23');
  fs.mkdirSync(benchmarkDir, { recursive: true });
  fs.writeFileSync(
    path.join(benchmarkDir, 'fixture-amn-fail.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
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

describe('release-check `--allow-missing-notes` does NOT bypass v2.3.0+ benchmark gate', () => {
  it('exits non-zero with a benchmark-gate failure even when --allow-missing-notes is set', () => {
    const result = runReleaseCheck(['--allow-missing-notes']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('v2.3.0+ release gate');
    expect(result.stderr).toContain('failed gate');
    expect(result.stderr).toContain('lane-integrity');
  });

  it('also fails (same gate) without --allow-missing-notes — control case', () => {
    // Without the escape hatch, the run still fails. Two failure
    // reasons stack: the missing release notes file AND the gate.
    // We assert on the gate failure to make sure the gate path is
    // exercised in both modes.
    const result = runReleaseCheck([]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('v2.3.0+ release gate');
    expect(result.stderr).toContain('failed gate');
  });
});
