#!/usr/bin/env node
/**
 * Tabrix v2.3.0 benchmark CLI (V23-06).
 *
 * Reads an NDJSON tool-call log produced by a real-browser acceptance
 * run (typically by the maintainer-private acceptance lane against Chrome
 * session — see `docs/RELEASE_NOTES_v2.3.0.md` §"Maintainer command
 * list" for the producer side) and writes a deterministic v2.3.0
 * release-evidence JSON report.
 *
 * Usage:
 *   pnpm run benchmark:v23 -- --input <path-to-run.ndjson> [--out <path>] [--gate]
 *
 * Flags:
 *   --input  Required. Path to NDJSON file. The first line must parse as
 *            a "header" object: `{ kind: "header", runId, runStartedAt,
 *            runEndedAt, buildSha }`. Subsequent lines are either
 *            `{ kind: "tool_call", ... BenchmarkToolCallRecord }` or
 *            `{ kind: "scenario", ... BenchmarkScenarioRecord }`.
 *   --out    Optional. Output JSON path. Defaults to
 *            `.claude/private-docs/benchmarks/v23/<runId>.json`.
 *   --gate   Optional. When set, exit non-zero if the report fails the
 *            release gate predicate. Used by `release:check` for v2.3+.
 *
 * Why a CLI wrapper instead of putting this in `release-check`:
 *   The transformer in `app/native-server/src/benchmark/v23-benchmark.ts`
 *   is a pure function and has its own unit-test surface. Keeping IO at
 *   the script boundary keeps the transformer easy to re-use from a
 *   future MCP tool or Sidepanel surface without dragging in `node:fs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// `v23-benchmark-gate.cjs` is the canonical, fresh-checkout-safe gate
// (V23-06 closeout). CommonJS so it is reusable from Jest CJS tests
// without `--experimental-vm-modules`. Loaded here via `createRequire`
// for deterministic named destructure across Node versions.
const require = createRequire(import.meta.url);
const { evaluateBenchmarkGate } = require('./lib/v23-benchmark-gate.cjs');

const ROOT = process.cwd();

function getReleaseEvidenceDir(version) {
  const baseDir =
    process.env.TABRIX_RELEASE_EVIDENCE_DIR ||
    path.join(ROOT, '.claude', 'private-docs', 'benchmarks');
  return path.join(baseDir, version);
}

function parseArgs(argv) {
  const opts = { input: null, out: null, gate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      opts.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      opts.out = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--gate') {
      opts.gate = true;
    }
  }
  return opts;
}

function fail(message) {
  console.error(`benchmark:v23 — ${message}`);
  process.exit(1);
}

function readNdjson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`line ${idx + 1} is not valid JSON: ${err.message}`);
    }
  });
}

function shapeRecords(records) {
  if (records.length === 0) {
    throw new Error('input file is empty');
  }
  const [header, ...rest] = records;
  if (!header || header.kind !== 'header') {
    throw new Error('first line of input must be `{ kind: "header", ... }`');
  }
  const required = ['runId', 'runStartedAt', 'runEndedAt', 'buildSha'];
  for (const field of required) {
    if (typeof header[field] !== 'string') {
      throw new Error(`header is missing required string field "${field}"`);
    }
  }
  const toolCalls = [];
  const scenarios = [];
  for (const [i, record] of rest.entries()) {
    if (!record || typeof record !== 'object') {
      throw new Error(`record at line ${i + 2} is not an object`);
    }
    if (record.kind === 'tool_call') {
      const { kind: _k, ...rest2 } = record;
      toolCalls.push(rest2);
    } else if (record.kind === 'scenario') {
      const { kind: _k2, ...rest3 } = record;
      scenarios.push(rest3);
    } else {
      throw new Error(
        `record at line ${i + 2} has unknown kind="${record.kind}". Expected "tool_call" or "scenario".`,
      );
    }
  }
  return {
    runId: header.runId,
    runStartedAt: header.runStartedAt,
    runEndedAt: header.runEndedAt,
    buildSha: header.buildSha,
    toolCalls,
    scenarios,
  };
}

function ensureOutputDir(outPath) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
}

async function loadTransformer() {
  // The pure-data transformer lives in the native-server package as
  // TypeScript and is emitted to `dist/` after `pnpm -C app/native-server build`.
  // The release gate is NOT loaded from here — it lives in
  // `scripts/lib/v23-benchmark-gate.mjs` so that `release:check`
  // and `--gate` share a single source that does not depend on a
  // build artifact (V23-06 closeout fix).
  const builtPath = path.join(
    ROOT,
    'app',
    'native-server',
    'dist',
    'benchmark',
    'v23-benchmark.js',
  );
  if (!fs.existsSync(builtPath)) {
    fail(
      `native-server build artifact missing at ${builtPath}. ` +
        `Run \`pnpm -C app/native-server build\` first, then re-run benchmark:v23.`,
    );
  }
  const url = pathToFileURL(builtPath).href;
  return import(url);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input) {
    fail('--input <path-to-run.ndjson> is required.');
  }
  if (!fs.existsSync(opts.input)) {
    fail(`input file not found: ${opts.input}`);
  }

  let records;
  try {
    records = readNdjson(opts.input);
  } catch (err) {
    fail(`failed to read input: ${err.message}`);
  }

  let runInput;
  try {
    runInput = shapeRecords(records);
  } catch (err) {
    fail(`malformed input file: ${err.message}`);
  }

  const { summariseBenchmarkRun, BENCHMARK_REPORT_VERSION } = await loadTransformer();
  const summary = summariseBenchmarkRun(runInput);

  // V23-06 closeout fix: in `--gate` mode we evaluate the gate FIRST
  // and only write the report on success. Pre-fix the order was
  // write-then-gate, which left a fresh failing JSON on disk that then
  // satisfied `release:check`'s presence + recency check.
  if (opts.gate) {
    const reasons = evaluateBenchmarkGate(summary);
    if (reasons.length > 0) {
      console.error('benchmark:v23 — release gate FAILED (no report written):');
      for (const r of reasons) console.error(`  - ${r}`);
      console.error(`  runId: ${runInput.runId}`);
      console.error(`  buildSha: ${runInput.buildSha}`);
      console.error(
        `  K3 task success: ${summary.k3TaskSuccessRate ?? 'n/a'} | K4 retry: ${summary.k4ToolRetryRate ?? 'n/a'} | lane violations: ${summary.laneCounters.violationCount}`,
      );
      process.exit(2);
    }
  }

  const outPath = opts.out ?? path.join(getReleaseEvidenceDir('v23'), `${runInput.runId}.json`);
  ensureOutputDir(outPath);
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('benchmark:v23 — wrote report');
  console.log(`- runId: ${runInput.runId}`);
  console.log(`- buildSha: ${runInput.buildSha}`);
  console.log(`- reportVersion: ${BENCHMARK_REPORT_VERSION}`);
  console.log(`- totalToolCalls: ${summary.totalToolCalls}`);
  console.log(`- scenarios: ${summary.completedScenarios}/${summary.totalScenarios}`);
  console.log(
    `- K3 task success: ${summary.k3TaskSuccessRate ?? 'n/a'} | K4 retry: ${summary.k4ToolRetryRate ?? 'n/a'} | lane violations: ${summary.laneCounters.violationCount}`,
  );
  console.log(`- out: ${path.relative(ROOT, outPath)}`);

  if (opts.gate) {
    console.log('benchmark:v23 — release gate passed');
  }
}

await main();
