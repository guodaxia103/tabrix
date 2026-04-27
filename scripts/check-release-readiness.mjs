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
// V24-05: independent v2.4.0+ gate. The two gates are version-
// mutually-exclusive: when `benchmarkGateAppliesV24` is true (v2.4.0+)
// the script runs ONLY the v24 gate (v23 is skipped); for v2.3.0..
// v2.3.x the script runs ONLY the v23 gate. v2.2.x and below skip
// both. Order matters because `benchmarkGateApplies` from the v23
// module also returns true for v2.4.0+ (it covers "v2.3.0+"); we
// explicitly preempt with the v24 branch when applicable so the v23
// content gate never double-runs against a v24-shaped report.
const {
  benchmarkGateAppliesV24,
  loadAndEvaluateBenchmarkReportV24,
  requireBaselineComparisonTable,
} = require('./lib/v24-benchmark-gate.cjs');
// V25-05: independent v2.5.0+ gate. Same mutual-exclusion shape as v24
// preempts v23: when `benchmarkGateAppliesV25` is true (v2.5.0+) the
// script runs ONLY the v25 gate. v2.4.x routes to the v24 branch only;
// v2.3.x routes to the v23 branch only. Order matters because the v23
// helper `benchmarkGateApplies` returns true for v2.3.0+ (it has no
// upper bound) and the v24 helper `benchmarkGateAppliesV24` returns
// true for v2.4.0+ (also no upper bound) — the if/else if/else if
// chain below preempts in version-descending order so each tag uses
// exactly one gate, never two.
const {
  benchmarkGateAppliesV25,
  loadAndEvaluateBenchmarkReportV25,
  requireBaselineComparisonTableV25,
} = require('./lib/v25-benchmark-gate.cjs');
const {
  benchmarkGateAppliesV26,
  loadAndEvaluateBenchmarkReportV26,
  requireReleaseNotesSummaryV26,
} = require('./lib/v26-benchmark-gate.cjs');

const ROOT = process.cwd();

function readJson(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function getReleaseEvidenceDir(version) {
  const baseDir =
    process.env.TABRIX_RELEASE_EVIDENCE_DIR ||
    path.join(ROOT, '.claude', 'private-docs', 'benchmarks');
  return path.join(baseDir, version);
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
if (benchmarkGateAppliesV26(nativePkg.version)) {
  const benchmarkDir = getReleaseEvidenceDir('v26');
  if (!fs.existsSync(benchmarkDir)) {
    errors.push(
      `v2.6.0+ release gate: missing benchmark directory ${path.relative(ROOT, benchmarkDir)}. ` +
        `Run the maintainer-private Gate B real-browser acceptance first; raw evidence stays under TABRIX_RELEASE_EVIDENCE_DIR or .claude/private-docs/benchmarks.`,
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
        `v2.6.0+ release gate: no benchmark reports under ${path.relative(ROOT, benchmarkDir)}. ` +
          `Copy the transformed Gate B report into the private release-evidence directory first.`,
      );
    } else {
      const newest = reports[0];
      const ageDays = (Date.now() - newest.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > BENCHMARK_REPORT_MAX_AGE_DAYS) {
        errors.push(
          `v2.6.0+ release gate: newest benchmark report ${newest.name} is ${ageDays.toFixed(1)} days old (max ${BENCHMARK_REPORT_MAX_AGE_DAYS}). ` +
            `Re-run maintainer-private Gate B real-browser acceptance.`,
        );
      }

      const gateResult = loadAndEvaluateBenchmarkReportV26(newest.fullPath);
      for (const reason of gateResult.hardReasons || []) {
        errors.push(
          `v2.6.0+ release gate: benchmark report ${newest.name} failed gate — ${reason}`,
        );
      }

      if (selectedNotesFile && fileExists(selectedNotesFile)) {
        const notesResult = requireReleaseNotesSummaryV26(path.join(ROOT, selectedNotesFile));
        for (const reason of notesResult.reasons || []) {
          errors.push(`v2.6.0+ release gate: ${reason}`);
        }
      } else {
        errors.push(
          `v2.6.0+ release gate: cannot verify release notes summary because no notes file is available.`,
        );
      }
    }
  }
} else if (benchmarkGateAppliesV25(nativePkg.version)) {
  // V25-05: v2.5.0+ release gate. Same shape as the v2.4 branch —
  // presence + recency + hard content gate via the canonical CJS
  // module and baseline-comparison table embed in the notes. Raw
  // benchmark reports are maintainer-private evidence and are not
  // committed under public docs.
  // `--allow-missing-notes` deliberately does NOT bypass the content
  // gate, the baseline-comparison-table embed, or the
  // `__V25_TBD__` placeholder rejection (mirrors V23-06 / V24-05
  // closeouts).
  const benchmarkDir = getReleaseEvidenceDir('v25');
  if (!fs.existsSync(benchmarkDir)) {
    errors.push(
      `v2.5.0+ release gate: missing benchmark directory ${path.relative(ROOT, benchmarkDir)}. ` +
        `Run \`pnpm run benchmark:v25 -- --input <run.ndjson> --gate\` first; raw evidence stays under TABRIX_RELEASE_EVIDENCE_DIR or .claude/private-docs/benchmarks.`,
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
        `v2.5.0+ release gate: no benchmark reports under ${path.relative(ROOT, benchmarkDir)}. ` +
          `Run \`pnpm run benchmark:v25 -- --input <run.ndjson> --gate\` first.`,
      );
    } else {
      const newest = reports[0];
      const ageDays = (Date.now() - newest.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > BENCHMARK_REPORT_MAX_AGE_DAYS) {
        errors.push(
          `v2.5.0+ release gate: newest benchmark report ${newest.name} is ${ageDays.toFixed(1)} days old (max ${BENCHMARK_REPORT_MAX_AGE_DAYS}). ` +
            `Re-run \`pnpm run benchmark:v25 -- --input <run.ndjson> --gate\`.`,
        );
      }

      const gateResult = loadAndEvaluateBenchmarkReportV25(newest.fullPath);
      for (const reason of gateResult.hardReasons || []) {
        errors.push(
          `v2.5.0+ release gate: benchmark report ${newest.name} failed gate — ${reason}`,
        );
      }
      for (const reason of gateResult.softReasons || []) {
        warnings.push(
          `v2.5.0+ release gate: benchmark report ${newest.name} ${reason}`,
        );
      }

      // Baseline comparison table + `__V25_TBD__` placeholder
      // rejection — both implemented inside `requireBaselineComparisonTableV25`.
      // The v25 canonical header is `metric | v2.4 baseline | v2.5
      // median | delta | direction` (vs the v24 gate's v2.3-baseline
      // header). `--allow-missing-notes` does NOT bypass either check.
      if (selectedNotesFile && fileExists(selectedNotesFile)) {
        const tableResult = requireBaselineComparisonTableV25(
          path.join(ROOT, selectedNotesFile),
          benchmarkDir,
        );
        for (const reason of tableResult.reasons || []) {
          errors.push(`v2.5.0+ release gate: ${reason}`);
        }
      } else {
        errors.push(
          `v2.5.0+ release gate: cannot verify baseline comparison table embed because no notes file is available.`,
        );
      }

    }
  }
} else if (benchmarkGateAppliesV24(nativePkg.version)) {
  const benchmarkDir = getReleaseEvidenceDir('v24');
  if (!fs.existsSync(benchmarkDir)) {
    errors.push(
      `v2.4.0+ release gate: missing benchmark directory ${path.relative(ROOT, benchmarkDir)}. ` +
        `Run \`pnpm run benchmark:v24 -- --input <run.ndjson> --gate\` first; raw evidence stays under TABRIX_RELEASE_EVIDENCE_DIR or .claude/private-docs/benchmarks.`,
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
        `v2.4.0+ release gate: no benchmark reports under ${path.relative(ROOT, benchmarkDir)}. ` +
          `Run \`pnpm run benchmark:v24 -- --input <run.ndjson> --gate\` first.`,
      );
    } else {
      const newest = reports[0];
      const ageDays = (Date.now() - newest.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > BENCHMARK_REPORT_MAX_AGE_DAYS) {
        errors.push(
          `v2.4.0+ release gate: newest benchmark report ${newest.name} is ${ageDays.toFixed(1)} days old (max ${BENCHMARK_REPORT_MAX_AGE_DAYS}). ` +
            `Re-run \`pnpm run benchmark:v24 -- --input <run.ndjson> --gate\`.`,
        );
      }

      // Hard content gate: parse the newest report and run the same
      // predicate `benchmark-v24.mjs --gate` would run. WARN-prefixed
      // reasons are evidence-only (K5..K8 guidance) and surface as
      // warnings, not errors.
      const gateResult = loadAndEvaluateBenchmarkReportV24(newest.fullPath);
      for (const reason of gateResult.hardReasons || []) {
        errors.push(
          `v2.4.0+ release gate: benchmark report ${newest.name} failed gate — ${reason}`,
        );
      }
      for (const reason of gateResult.softReasons || []) {
        warnings.push(
          `v2.4.0+ release gate: benchmark report ${newest.name} ${reason}`,
        );
      }

      // Baseline comparison table is a HARD requirement. The release
      // notes file (or the CHANGELOG fallback selected above) MUST
      // INLINE the canonical baseline-comparison table — header
      // (`metric | v2.3.0 baseline | v2.4.0 median | delta | direction`)
      // + markdown separator + at least one body row. v2.4.0 closeout
      // review-fix (finding 3): a bare reference to a separate
      // benchmark comparison file is no longer sufficient; the
      // table itself must be in the notes so reviewers do not have to
      // chase a separate file. `--allow-missing-notes` only opens the
      // notes-fallback path (handled in the release-notes block above);
      // it does NOT bypass this content check (mirrors the V23-06
      // closeout).
      if (selectedNotesFile && fileExists(selectedNotesFile)) {
        const tableResult = requireBaselineComparisonTable(
          path.join(ROOT, selectedNotesFile),
          benchmarkDir,
        );
        for (const reason of tableResult.reasons || []) {
          errors.push(`v2.4.0+ release gate: ${reason}`);
        }
      } else {
        errors.push(
          `v2.4.0+ release gate: cannot verify baseline comparison table embed because no notes file is available.`,
        );
      }

    }
  }
} else if (benchmarkGateApplies(nativePkg.version)) {
  const benchmarkDir = getReleaseEvidenceDir('v23');
  if (!fs.existsSync(benchmarkDir)) {
    errors.push(
      `v2.3.0+ release gate: missing benchmark directory ${path.relative(ROOT, benchmarkDir)}. ` +
        `Run \`pnpm run benchmark:v23 -- --input <run.ndjson> --gate\` first; raw evidence stays under TABRIX_RELEASE_EVIDENCE_DIR or .claude/private-docs/benchmarks.`,
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
