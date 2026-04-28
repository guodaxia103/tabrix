/**
 * V26 release gate — GitHub Actions fresh-checkout regression.
 *
 * v2.6 real-browser Gate B evidence is maintainer-private. The local
 * owner-lane `release:check` must keep requiring the private transformed
 * report, but GitHub Actions cannot read `.claude/private-docs` from a
 * fresh checkout. In Actions we therefore validate the committed public
 * release notes summary instead of failing on a missing private evidence
 * directory.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'check-release-readiness.mjs');
const FIXTURE_VERSION = '2.6.0';

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-release-gate-v26-ci-'));
  scaffoldFixture(fixtureRoot, FIXTURE_VERSION);
});

afterEach(() => {
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
  writeReleaseNotes(root, releaseNotesBody());
}

function writeReleaseNotes(root: string, text: string): void {
  const notesPath = path.join(root, 'docs', `RELEASE_NOTES_v${FIXTURE_VERSION}.md`);
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  fs.writeFileSync(notesPath, text, 'utf8');
}

function releaseNotesBody(): string {
  return [
    '# Tabrix v2.6.0 Release Notes',
    '',
    'Gate B strict PASS.',
    '',
    'Endpoint source lineage includes observed, seed_adapter, manual_seed, and unknown.',
    '',
    'Broader arbitrary-site observed-endpoint reuse remains v2.7 scope.',
    '',
  ].join('\n');
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runReleaseCheck(env: NodeJS.ProcessEnv = {}): SpawnResult {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--tag', `v${FIXTURE_VERSION}`], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '', ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('release-check v2.6 GitHub Actions fresh checkout', () => {
  it('accepts public release notes summary in GitHub Actions when private evidence is absent', () => {
    const result = runReleaseCheck({ GITHUB_ACTIONS: 'true' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('release readiness check passed');
    expect(result.stdout).toContain('validating public release notes summary only');
  });

  it('keeps local owner-lane release gate strict when private evidence is absent', () => {
    const result = runReleaseCheck({ GITHUB_ACTIONS: '' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing benchmark directory');
  });

  it('still rejects weak release notes in GitHub Actions fresh checkout mode', () => {
    writeReleaseNotes(fixtureRoot, '# Tabrix v2.6.0\n\nTBD\n');
    const result = runReleaseCheck({ GITHUB_ACTIONS: 'true' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('release notes still contain draft/TBD/do-not-ship language');
    expect(result.stderr).toContain(
      'release notes must include public-safe Gate B strict PASS summary',
    );
  });
});
