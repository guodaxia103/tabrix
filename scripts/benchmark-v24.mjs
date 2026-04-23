#!/usr/bin/env node
/**
 * Tabrix v2.4.0 benchmark CLI (V24-05).
 *
 * Reads an NDJSON tool-call log produced by a real-browser acceptance
 * run (the same producer pattern as v23 but with two new record kinds:
 * `pair` and v24 metadata-rich `tool_call`) and writes a deterministic
 * v2.4.0 release-evidence JSON report.
 *
 * Usage:
 *   pnpm run benchmark:v24 -- --input <run.ndjson>
 *                              [--out <path>]
 *                              [--gate]
 *                              [--baseline <v23-report.json>]
 *                              [--kpi <id> --kpi <id> ...]
 *
 * Flags:
 *   --input     Required. Path to NDJSON file. The first line must be
 *               `{ kind: "header", runId, runStartedAt, runEndedAt,
 *                 buildSha, kpiScenarioIds?: string[] }`. Subsequent
 *               lines are `{ kind: "tool_call", ... }`,
 *               `{ kind: "scenario", ... }`, or
 *               `{ kind: "pair", pairIndex, scenarioId, role,
 *                  toolCallSeqs: number[] }`.
 *   --out       Optional. Output JSON path. Defaults to
 *               `docs/benchmarks/v24/<runId>.json`.
 *   --gate      Optional. When set, exit non-zero on HARD gate
 *               failure; the report is NOT written on hard fail
 *               (gate-then-write). WARN-only failures still write
 *               the report and exit zero, but print the WARN list to
 *               stderr.
 *   --baseline  Optional. Path to a v2.3.0 benchmark report JSON. When
 *               set, the CLI emits a markdown comparison table to
 *               `docs/benchmarks/v24/v24-vs-v23-baseline-<date>.md`
 *               so the maintainer can paste it into the release notes.
 *   --kpi       Optional. Add a KPI scenario id; flag may be repeated.
 *               These IDs are merged with the NDJSON header's
 *               `kpiScenarioIds` (CLI flags ADD to the header list).
 *
 * Why a v24-specific CLI rather than extending v23: the v23 CLI is the
 * v2.3.0 ship contract. Modifying it risks regressing the v2.3.0
 * release gate. The v24 CLI is additive; the v23 CLI is unchanged.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  evaluateBenchmarkGateV24,
  partitionGateReasons,
} = require('./lib/v24-benchmark-gate.cjs');

const ROOT = process.cwd();

function parseArgs(argv) {
  const opts = {
    input: null,
    out: null,
    gate: false,
    baseline: null,
    kpi: [],
  };
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
    if (arg === '--baseline' && argv[i + 1]) {
      opts.baseline = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--kpi' && argv[i + 1]) {
      opts.kpi.push(argv[i + 1]);
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
  console.error(`benchmark:v24 — ${message}`);
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

function shapeRecords(records, extraKpiIds) {
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
  const headerKpiIds = Array.isArray(header.kpiScenarioIds) ? header.kpiScenarioIds : [];
  const kpiScenarioIds = [...new Set([...headerKpiIds, ...extraKpiIds])];

  const toolCalls = [];
  const scenarios = [];
  const pairs = [];
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
    } else if (record.kind === 'pair') {
      const { kind: _k3, ...rest4 } = record;
      if (typeof rest4.scenarioId !== 'string') {
        throw new Error(`pair record at line ${i + 2} missing scenarioId`);
      }
      if (rest4.role !== 'first_touch' && rest4.role !== 'second_touch') {
        throw new Error(
          `pair record at line ${i + 2} has invalid role "${rest4.role}" (expected first_touch|second_touch)`,
        );
      }
      if (!Number.isInteger(rest4.pairIndex) || rest4.pairIndex < 0) {
        throw new Error(`pair record at line ${i + 2} missing/invalid pairIndex`);
      }
      if (!Array.isArray(rest4.toolCallSeqs)) {
        throw new Error(`pair record at line ${i + 2} missing toolCallSeqs[]`);
      }
      pairs.push(rest4);
    } else {
      throw new Error(
        `record at line ${i + 2} has unknown kind="${record.kind}". Expected "tool_call" | "scenario" | "pair".`,
      );
    }
  }
  return {
    runId: header.runId,
    runStartedAt: header.runStartedAt,
    runEndedAt: header.runEndedAt,
    buildSha: header.buildSha,
    kpiScenarioIds,
    toolCalls,
    scenarios,
    pairs,
  };
}

function ensureOutputDir(outPath) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
}

async function loadTransformer() {
  const builtPath = path.join(
    ROOT,
    'app',
    'native-server',
    'dist',
    'benchmark',
    'v24-benchmark.js',
  );
  if (!fs.existsSync(builtPath)) {
    fail(
      `native-server build artifact missing at ${builtPath}. ` +
        `Run \`pnpm -C app/native-server build\` first, then re-run benchmark:v24.`,
    );
  }
  const url = pathToFileURL(builtPath).href;
  return import(url);
}

function formatDelta(v23, v24, opts) {
  if (typeof v23 !== 'number' || typeof v24 !== 'number') return { delta: '—', direction: '—' };
  const delta = v24 - v23;
  let direction = 'flat';
  if (Math.abs(delta) < (opts && opts.epsilon ? opts.epsilon : 1e-6)) direction = 'flat';
  else if (opts && opts.lowerBetter) direction = delta < 0 ? 'better' : 'worse';
  else direction = delta > 0 ? 'better' : 'worse';
  return { delta: delta.toFixed(3), direction };
}

function emitBaselineComparison(summary, baselinePath) {
  const baselineRaw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const rows = [];
  rows.push(['K1 mean input tokens', baselineRaw.k1MeanInputTokensPerTask, summary.k1MeanInputTokensPerTask, { lowerBetter: true }]);
  rows.push(['K3 task success', baselineRaw.k3TaskSuccessRate, summary.k3TaskSuccessRate, {}]);
  rows.push(['K4 retry rate', baselineRaw.k4ToolRetryRate, summary.k4ToolRetryRate, { lowerBetter: true }]);
  rows.push(['K4 fallback rate', baselineRaw.k4FallbackRate, summary.k4FallbackRate, { lowerBetter: true }]);
  rows.push(['K5 second-touch speedup (median)', null, summary.k5SecondTouchSpeedup, {}]);
  rows.push(['K6 replay success rate (median)', null, summary.k6ReplaySuccessRate, {}]);
  rows.push(['K7 replay fallback rate (median)', null, summary.k7ReplayFallbackRate, { lowerBetter: true }]);
  // v2.4.0 closeout: K8 = (first - second) / first, HIGHER is better.
  rows.push(['K8 token saving ratio (median)', null, summary.k8TokenSavingRatio, {}]);

  const lines = [];
  lines.push('# v2.4.0 vs v2.3.0 baseline comparison');
  lines.push('');
  lines.push(`- v2.3.0 baseline report: \`${path.relative(ROOT, baselinePath)}\``);
  lines.push(`- v2.4.0 run: \`${summary.runId}\` (build \`${summary.buildSha}\`)`);
  lines.push(`- generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| metric | v2.3.0 baseline | v2.4.0 median | delta | direction |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [name, v23, v24, opts] of rows) {
    const v23s = typeof v23 === 'number' ? v23.toFixed(3) : 'n/a';
    const v24s = typeof v24 === 'number' ? v24.toFixed(3) : 'n/a';
    const { delta, direction } = formatDelta(v23, v24, opts || {});
    lines.push(`| ${name} | ${v23s} | ${v24s} | ${delta} | ${direction} |`);
  }
  lines.push('');
  lines.push('> NOTE: K5..K8 are evidence-only in v2.4 (gate emits `WARN:` reasons rather than hard-fail). v23 baseline does not measure them.');
  lines.push('');

  const baselineDir = path.join(ROOT, 'docs', 'benchmarks', 'v24');
  fs.mkdirSync(baselineDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const tablePath = path.join(baselineDir, `v24-vs-v23-baseline-${date}.md`);
  fs.writeFileSync(tablePath, lines.join('\n'), 'utf8');
  return tablePath;
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
    runInput = shapeRecords(records, opts.kpi);
  } catch (err) {
    fail(`malformed input file: ${err.message}`);
  }

  const { summariseBenchmarkRunV24, BENCHMARK_REPORT_VERSION } = await loadTransformer();
  const summary = summariseBenchmarkRunV24(runInput);

  // gate-then-write: in `--gate` mode we evaluate the gate FIRST and
  // only write the report on hard-pass. WARN reasons still allow the
  // write but are surfaced on stderr. Pre-fix patterns of write-then-
  // gate would leave a fresh failing JSON on disk that then satisfied
  // a presence + recency check.
  const allReasons = evaluateBenchmarkGateV24(summary);
  const { hard, soft } = partitionGateReasons(allReasons);

  if (opts.gate && hard.length > 0) {
    console.error('benchmark:v24 — release gate FAILED (no report written):');
    for (const r of hard) console.error(`  - ${r}`);
    if (soft.length > 0) {
      console.error('benchmark:v24 — additional WARN reasons:');
      for (const r of soft) console.error(`  - ${r}`);
    }
    console.error(`  runId: ${runInput.runId}`);
    console.error(`  buildSha: ${runInput.buildSha}`);
    process.exit(2);
  }

  const outPath =
    opts.out ?? path.join(ROOT, 'docs', 'benchmarks', 'v24', `${runInput.runId}.json`);
  ensureOutputDir(outPath);
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  let baselineTablePath = null;
  if (opts.baseline) {
    if (!fs.existsSync(opts.baseline)) {
      fail(`baseline file not found: ${opts.baseline}`);
    }
    try {
      baselineTablePath = emitBaselineComparison(summary, opts.baseline);
    } catch (err) {
      fail(`failed to emit baseline comparison: ${err.message}`);
    }
  }

  console.log('benchmark:v24 — wrote report');
  console.log(`- runId: ${runInput.runId}`);
  console.log(`- buildSha: ${runInput.buildSha}`);
  console.log(`- reportVersion: ${BENCHMARK_REPORT_VERSION}`);
  console.log(`- totalToolCalls: ${summary.totalToolCalls}`);
  console.log(`- scenarios: ${summary.completedScenarios}/${summary.totalScenarios}`);
  console.log(
    `- K3 task success: ${summary.k3TaskSuccessRate ?? 'n/a'} | K4 retry: ${summary.k4ToolRetryRate ?? 'n/a'} | lane violations: ${summary.laneCounters.violationCount}`,
  );
  console.log(
    `- K5 speedup: ${summary.k5SecondTouchSpeedup ?? 'n/a'} | K6 replay-ok: ${summary.k6ReplaySuccessRate ?? 'n/a'} | K7 fallback: ${summary.k7ReplayFallbackRate ?? 'n/a'} | K8 token-save: ${summary.k8TokenSavingRatio ?? 'n/a'}`,
  );
  console.log(`- out: ${path.relative(ROOT, outPath)}`);
  if (baselineTablePath) {
    console.log(`- baseline comparison: ${path.relative(ROOT, baselineTablePath)}`);
  }

  if (soft.length > 0) {
    console.error('benchmark:v24 — WARN reasons (evidence-only, not blocking):');
    for (const r of soft) console.error(`  - ${r}`);
  }

  if (opts.gate) {
    console.log('benchmark:v24 — release gate hard-passed' + (soft.length > 0 ? ' (with WARNs)' : ''));
  }
}

await main();
