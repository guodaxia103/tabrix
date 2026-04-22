import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// `v23-benchmark-gate.cjs` is intentionally CommonJS so the same module
// can be consumed by Jest tests AND by these ESM scripts. ESM-of-CJS
// named-import detection is fragile across Node versions; using
// `createRequire` keeps the destructure deterministic.
const require = createRequire(import.meta.url);
const { benchmarkGateApplies, loadAndEvaluateBenchmarkReport } = require(
  './lib/v23-benchmark-gate.cjs',
);

const ROOT = process.cwd();

function readJson(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function parseArgs(argv) {
  const options = {
    tag: process.env.RELEASE_TAG || '',
    allowMissingNotes: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tag' && argv[i + 1]) {
      options.tag = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--allow-missing-notes') {
      options.allowMissingNotes = true;
    }
  }

  return options;
}

function normalizeTagVersion(tag) {
  if (!tag) return '';
  if (tag.startsWith('tabrix-v')) return tag.slice('tabrix-v'.length);
  if (tag.startsWith('v')) return tag.slice(1);
  return null;
}

function appendGitHubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  fs.appendFileSync(outputFile, `${name}=${value}\n`, 'utf8');
}

function findWorkspaceProtocolDeps(dependencies = {}) {
  return Object.entries(dependencies)
    .filter(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))
    .map(([name, version]) => `${name}@${version}`);
}

function fail(errors) {
  console.error('release readiness check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const options = parseArgs(process.argv.slice(2));

const rootPkg = readJson('package.json');
const nativePkg = readJson(path.join('app', 'native-server', 'package.json'));
const extensionPkg = readJson(path.join('app', 'chrome-extension', 'package.json'));
const sharedPkg = readJson(path.join('packages', 'shared', 'package.json'));
const wasmSimdPkg = readJson(path.join('packages', 'wasm-simd', 'package.json'));

const errors = [];
const warnings = [];

if (!rootPkg.private) {
  errors.push('Root package must remain private=true.');
}

if (nativePkg.name !== '@tabrix/tabrix') {
  errors.push(`Unexpected native package name: ${nativePkg.name}`);
}

if (sharedPkg.name !== '@tabrix/shared') {
  errors.push(`Unexpected shared package name: ${sharedPkg.name}`);
}

const workspaceProtocolDeps = findWorkspaceProtocolDeps(nativePkg.dependencies);
if (workspaceProtocolDeps.length > 0) {
  errors.push(
    `Native package has workspace protocol dependencies, which break npm installs: ${workspaceProtocolDeps.join(', ')}`,
  );
}

if (rootPkg.version !== nativePkg.version) {
  errors.push(
    `Version mismatch: root=${rootPkg.version}, native=${nativePkg.version}. Keep root in sync with release version.`,
  );
}

if (extensionPkg.version !== nativePkg.version) {
  errors.push(
    `Version mismatch: extension=${extensionPkg.version}, native=${nativePkg.version}. Keep user-facing packages aligned.`,
  );
}

if (sharedPkg.version !== nativePkg.version) {
  errors.push(
    `Version mismatch: shared=${sharedPkg.version}, native=${nativePkg.version}. Keep core packages aligned.`,
  );
}

if (wasmSimdPkg.version !== nativePkg.version) {
  errors.push(
    `Version mismatch: wasm-simd=${wasmSimdPkg.version}, native=${nativePkg.version}. Keep workspace packages aligned.`,
  );
}

const nativeSharedDep = nativePkg.dependencies?.['@tabrix/shared'];
const expectedNativeSharedDep = `^${sharedPkg.version}`;
if (nativeSharedDep !== expectedNativeSharedDep) {
  errors.push(
    `Native dependency mismatch: @tabrix/shared=${nativeSharedDep ?? '(missing)'}, expected ${expectedNativeSharedDep}.`,
  );
}

let resolvedTag = options.tag || `v${nativePkg.version}`;
const normalizedTagVersion = normalizeTagVersion(resolvedTag);
if (normalizedTagVersion == null) {
  errors.push(`Invalid tag format: ${resolvedTag}. Use vX.Y.Z or tabrix-vX.Y.Z.`);
} else if (normalizedTagVersion !== nativePkg.version) {
  errors.push(
    `Tag/version mismatch: tag=${normalizedTagVersion}, native=${nativePkg.version}.`,
  );
}

const releaseNotesFile = `docs/RELEASE_NOTES_v${nativePkg.version}.md`;
const fallbackNotesFile = 'CHANGELOG.md';
let selectedNotesFile = releaseNotesFile;

if (!fileExists(releaseNotesFile)) {
  if (options.allowMissingNotes) {
    if (fileExists(fallbackNotesFile)) {
      selectedNotesFile = fallbackNotesFile;
      warnings.push(
        `Release notes file missing (${releaseNotesFile}); fallback to ${fallbackNotesFile}.`,
      );
    } else {
      errors.push(
        `Missing release notes file (${releaseNotesFile}) and fallback changelog (${fallbackNotesFile}).`,
      );
    }
  } else {
    errors.push(
      `Missing release notes file: ${releaseNotesFile}. Create it before publishing.`,
    );
  }
}

// V23-06 release gate: v2.3.0+ tags must ship a real-browser benchmark
// report that PASSES the same predicate `pnpm run benchmark:v23 -- --gate`
// uses. Pre-closeout this check only validated presence + recency, which
// meant a failing benchmark could leak through the gate as long as its
// JSON file was on disk and recent. Closeout fix: load the report,
// validate report-version + lane integrity + K3/K4 thresholds + non-empty
// scenarios via the canonical predicate from
// `scripts/lib/v23-benchmark-gate.mjs`. Single source of truth — the
// `benchmark-v23.mjs --gate` invocation reads from the same module.
const BENCHMARK_REPORT_MAX_AGE_DAYS = 7;

// `--allow-missing-notes` deliberately does NOT short-circuit this block:
// it is a release-NOTES escape hatch (handled at the release-notes block
// above, which falls back to CHANGELOG.md), not a release-GATE escape
// hatch. Letting it skip the benchmark content gate would re-open the
// exact bypass V23-06 closed: a tag could ship with a failing benchmark
// report just by passing `--allow-missing-notes`. The soft warning at
// the bottom of this block is already self-guarded on `selectedNotesFile`
// existing, so it stays harmless under `--allow-missing-notes`.
if (benchmarkGateApplies(nativePkg.version)) {
  const benchmarkDir = path.join(ROOT, 'docs', 'benchmarks', 'v23');
  if (!fs.existsSync(benchmarkDir)) {
    errors.push(
      `v2.3.0+ release gate: missing benchmark directory ${path.relative(ROOT, benchmarkDir)}. ` +
        `Run \`pnpm run benchmark:v23 -- --input <run.ndjson> --gate\` first; see docs/RELEASE_NOTES_v${nativePkg.version}.md "Maintainer command list".`,
    );
  } else {
    const reports = fs
      .readdirSync(benchmarkDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const fullPath = path.join(benchmarkDir, name);
        const stat = fs.statSync(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (reports.length === 0) {
      errors.push(
        `v2.3.0+ release gate: no benchmark reports under ${path.relative(ROOT, benchmarkDir)}. ` +
          `Run \`pnpm run benchmark:v23 -- --input <run.ndjson> --gate\` first.`,
      );
    } else {
      const newest = reports[0];
      const ageDays = (Date.now() - newest.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > BENCHMARK_REPORT_MAX_AGE_DAYS) {
        errors.push(
          `v2.3.0+ release gate: newest benchmark report ${newest.name} is ${ageDays.toFixed(1)} days old (max ${BENCHMARK_REPORT_MAX_AGE_DAYS}). ` +
            `Re-run \`pnpm run benchmark:v23 -- --input <run.ndjson> --gate\`.`,
        );
      }

      // Hard content gate: parse the newest report and run the same
      // predicate `benchmark-v23.mjs --gate` would run. A failing
      // report cannot slip past release-check just because the file
      // is on disk and recent.
      const gateResult = loadAndEvaluateBenchmarkReport(newest.fullPath);
      if (!gateResult.ok) {
        for (const reason of gateResult.reasons) {
          errors.push(
            `v2.3.0+ release gate: benchmark report ${newest.name} failed gate — ${reason}`,
          );
        }
      }

      // Soft assertion: release notes should reference some benchmark
      // report (commit SHA or filename).
      if (fileExists(selectedNotesFile)) {
        const notes = fs.readFileSync(path.join(ROOT, selectedNotesFile), 'utf8');
        if (!notes.includes('benchmarks/v23')) {
          warnings.push(
            `Release notes ${selectedNotesFile} do not reference any \`docs/benchmarks/v23/\` report. ` +
              `Recommend pointing readers at the specific report committed for this tag.`,
          );
        }
      }
    }
  }
}

if (errors.length > 0) fail(errors);

console.log('release readiness check passed');
console.log(`- tag: ${resolvedTag}`);
console.log(`- package: ${nativePkg.name}`);
console.log(`- version: ${nativePkg.version}`);
console.log(`- notes_file: ${selectedNotesFile}`);
if (warnings.length > 0) {
  for (const warning of warnings) console.log(`- warning: ${warning}`);
}

appendGitHubOutput('tag', resolvedTag);
appendGitHubOutput('package_name', nativePkg.name);
appendGitHubOutput('version', nativePkg.version);
appendGitHubOutput('notes_file', selectedNotesFile);
appendGitHubOutput('shared_package_name', sharedPkg.name);
appendGitHubOutput('shared_version', sharedPkg.version);
