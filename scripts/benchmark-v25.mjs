#!/usr/bin/env node
/**
 * Tabrix v2.5 benchmark CLI (V25-01).
 *
 * Reads an NDJSON tool-call log produced by a real-browser acceptance
 * run (the same producer pattern as v24 but with the v25 layer-dispatch
 * and stability fields) and writes a deterministic v2.5
 * release-evidence JSON report.
 *
 * Usage:
 *   pnpm run benchmark:v25 -- --input <run.ndjson>
 *                              [--out <path>]
 *                              [--gate]
 *                              [--baseline-v24 <v24-report.json>]
 *                              [--kpi <id> --kpi <id> ...]
 *
 * Flags:
 *   --input         Required. Path to NDJSON file. The first line must
 *                   be `{ kind: "header", runId, runStartedAt,
 *                     runEndedAt, buildSha, kpiScenarioIds?: string[] }`.
 *                   Subsequent lines are `{ kind: "tool_call", ... }`,
 *                   `{ kind: "scenario", ... }`, or
 *                   `{ kind: "pair", pairIndex, scenarioId, role,
 *                      toolCallSeqs: number[] }`.
 *   --out           Optional. Output JSON path. Defaults to
 *                   `docs/benchmarks/v25/<runId>.json`.
 *   --gate          Optional. Exit non-zero on HARD gate failure; the
 *                   report is NOT written on hard fail (gate-then-write).
 *   --baseline-v24  Optional. Path to a v2.4.0 benchmark report JSON.
 *                   When set, the CLI populates the report's
 *                   `comparisonToV24` block AND emits a markdown
 *                   comparison table to
 *                   `docs/benchmarks/v25/v25-vs-v24-baseline-<date>.md`
 *                   so the maintainer can paste it into the release
 *                   notes.
 *   --kpi           Optional. Add a KPI scenario id; flag may be
 *                   repeated. These IDs are merged with the NDJSON
 *                   header's `kpiScenarioIds`.
 *
 * Why a v25-specific CLI rather than extending v24: the v24 CLI is the
 * v2.4.0 ship contract. Modifying it risks regressing the v2.4.0
 * release gate. The v25 CLI is additive; the v24 CLI is unchanged.
 *
 * V25-01 scope: this CLI ships with the gate library
 * (`scripts/lib/v25-benchmark-gate.cjs`) ready, but
 * `scripts/check-release-readiness.mjs` is NOT yet wired to it. That
 * wiring is V25-05's job.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  evaluateBenchmarkGateV25,
  partitionGateReasons,
} = require('./lib/v25-benchmark-gate.cjs');

const ROOT = process.cwd();

function parseArgs(argv) {
  const opts = {
    input: null,
    out: null,
    gate: false,
    baselineV24: null,
    kpi: [],
    help: false,
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
    if (arg === '--baseline-v24' && argv[i + 1]) {
      opts.baselineV24 = argv[i + 1];
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
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
    [
      'benchmark:v25 — v2.5 release-evidence transformer',
      '',
      'Usage:',
      '  node scripts/benchmark-v25.mjs --input <run.ndjson>',
      '                                   [--out <path>]',
      '                                   [--gate]',
      '                                   [--baseline-v24 <v24-report.json>]',
      '                                   [--kpi <id> ...]',
      '',
      'See script header for full documentation.',
      '',
    ].join('\n'),
  );
}

function fail(message) {
  console.error(`benchmark:v25 — ${message}`);
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
    'v25-benchmark.js',
  );
  if (!fs.existsSync(builtPath)) {
    fail(
      `native-server build artifact missing at ${builtPath}. ` +
        `Run \`pnpm -C app/native-server build\` first, then re-run benchmark:v25.`,
    );
  }
  const url = pathToFileURL(builtPath).href;
  return import(url);
}

function fmt(value, opts = {}) {
  if (!Number.isFinite(value)) return 'n/a';
  return value.toFixed(opts.fractionDigits ?? 3);
}

function emitBaselineComparisonTable(summary, baseline, baselinePath) {
  const rows = [];
  rows.push(['K3 task success rate', baseline.k3TaskSuccessRate, summary.methodMetrics.k3TaskSuccessRate, {}]);
  rows.push(['K4 tool retry rate', baseline.k4ToolRetryRate, summary.methodMetrics.k4ToolRetryRate, { lowerBetter: true }]);
  rows.push(['median tool calls per scenario', baseline.medianToolCallsPerScenario ?? null, summary.methodMetrics.medianToolCallsPerScenario, { lowerBetter: true }]);
  rows.push(['click attempts per success (median)', baseline.meanClickAttemptsPerStep ?? null, summary.methodMetrics.clickAttemptsPerSuccessMedian, { lowerBetter: true }]);
  rows.push(['visual fallback rate', baseline.visualFallbackRate ?? null, summary.stabilityMetrics.visualFallbackRate, { lowerBetter: true }]);
  rows.push(['JS fallback rate', baseline.jsFallbackRate ?? null, summary.stabilityMetrics.jsFallbackRate, { lowerBetter: true }]);
  rows.push(['L0 token-ratio median (chosen/full)', null, summary.layerMetrics.l0TokenRatioMedian, { lowerBetter: true }]);
  rows.push(['L0+L1 token-ratio median', null, summary.layerMetrics.l0L1TokenRatioMedian, { lowerBetter: true }]);
  rows.push(['tokens saved (estimate, total)', null, summary.layerMetrics.tokensSavedEstimateTotal, {}]);

  const lines = [];
  lines.push('# v2.5 vs v2.4 baseline comparison');
  lines.push('');
  lines.push(`- v2.4 baseline report: \`${path.relative(ROOT, baselinePath)}\``);
  lines.push(`- v2.5 run: \`${summary.runId}\` (build \`${summary.buildSha}\`)`);
  lines.push(`- generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| metric | v2.4 baseline | v2.5 median | delta | direction |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [name, base, current, opts] of rows) {
    const baseStr = base === null || base === undefined ? 'n/a' : fmt(base);
    const currStr = current === null || current === undefined ? 'n/a' : fmt(current);
    let deltaStr = '—';
    let direction = '—';
    if (Number.isFinite(base) && Number.isFinite(current)) {
      const delta = current - base;
      deltaStr = delta.toFixed(3);
      if (Math.abs(delta) < 1e-6) direction = 'flat';
      else if (opts && opts.lowerBetter) direction = delta < 0 ? 'better' : 'worse';
      else direction = delta > 0 ? 'better' : 'worse';
    }
    lines.push(`| ${name} | ${baseStr} | ${currStr} | ${deltaStr} | ${direction} |`);
  }
  lines.push('');
  lines.push(
    '> NOTE: layer-ratio and tokens-saved rows have no v2.4 baseline (those metrics are new in v2.5).',
  );
  lines.push('');

  const baselineDir = path.join(ROOT, 'docs', 'benchmarks', 'v25');
  fs.mkdirSync(baselineDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const tablePath = path.join(baselineDir, `v25-vs-v24-baseline-${date}.md`);
  fs.writeFileSync(tablePath, lines.join('\n'), 'utf8');
  return tablePath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  if (!opts.input) {
    fail('--input <path-to-run.ndjson> is required (use --help for usage).');
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

  let baselineSummary = null;
  if (opts.baselineV24) {
    if (!fs.existsSync(opts.baselineV24)) {
      fail(`baseline-v24 file not found: ${opts.baselineV24}`);
    }
    try {
      baselineSummary = JSON.parse(fs.readFileSync(opts.baselineV24, 'utf8'));
    } catch (err) {
      fail(`baseline-v24 file is not valid JSON: ${err.message}`);
    }
  }

  const { summariseBenchmarkRunV25, BENCHMARK_REPORT_VERSION } = await loadTransformer();
  const summary = summariseBenchmarkRunV25({
    ...runInput,
    comparisonBaselineV24: baselineSummary,
  });

  const allReasons = evaluateBenchmarkGateV25(summary);
  const { hard, soft } = partitionGateReasons(allReasons);

  if (opts.gate && hard.length > 0) {
    console.error('benchmark:v25 — release gate FAILED (no report written):');
    for (const r of hard) console.error(`  - ${r}`);
    if (soft.length > 0) {
      console.error('benchmark:v25 — additional WARN reasons:');
      for (const r of soft) console.error(`  - ${r}`);
    }
    console.error(`  runId: ${runInput.runId}`);
    console.error(`  buildSha: ${runInput.buildSha}`);
    process.exit(2);
  }

  const outPath =
    opts.out ?? path.join(ROOT, 'docs', 'benchmarks', 'v25', `${runInput.runId}.json`);
  ensureOutputDir(outPath);
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  let baselineTablePath = null;
  if (opts.baselineV24 && baselineSummary) {
    try {
      baselineTablePath = emitBaselineComparisonTable(summary, baselineSummary, opts.baselineV24);
    } catch (err) {
      fail(`failed to emit baseline comparison: ${err.message}`);
    }
  }

  console.log('benchmark:v25 — wrote report');
  console.log(`- runId: ${runInput.runId}`);
  console.log(`- buildSha: ${runInput.buildSha}`);
  console.log(`- reportVersion: ${BENCHMARK_REPORT_VERSION}`);
  console.log(`- totalToolCalls: ${summary.totalToolCalls}`);
  console.log(`- scenarios: ${summary.completedScenarios}/${summary.totalScenarios}`);
  console.log(
    `- K3 task success: ${summary.methodMetrics.k3TaskSuccessRate ?? 'n/a'} | K4 retry: ${summary.methodMetrics.k4ToolRetryRate ?? 'n/a'} | lane violations: ${summary.laneCounters.violationCount}`,
  );
  console.log(
    `- L0 token ratio: ${summary.layerMetrics.l0TokenRatioMedian ?? 'n/a'} | L0+L1 token ratio: ${summary.layerMetrics.l0L1TokenRatioMedian ?? 'n/a'} | tokens saved (total est): ${summary.layerMetrics.tokensSavedEstimateTotal}`,
  );
  console.log(
    `- visual fallback: ${summary.stabilityMetrics.visualFallbackRate ?? 'n/a'} | js fallback: ${summary.stabilityMetrics.jsFallbackRate ?? 'n/a'} | replay success: ${summary.stabilityMetrics.replaySuccessRate ?? 'n/a'}`,
  );
  console.log(`- out: ${path.relative(ROOT, outPath)}`);
  if (baselineTablePath) {
    console.log(`- baseline comparison: ${path.relative(ROOT, baselineTablePath)}`);
  }

  if (soft.length > 0) {
    console.error('benchmark:v25 — WARN reasons (evidence-only, not blocking):');
    for (const r of soft) console.error(`  - ${r}`);
  }

  if (opts.gate) {
    console.log('benchmark:v25 — release gate hard-passed' + (soft.length > 0 ? ' (with WARNs)' : ''));
  }
}

await main();
