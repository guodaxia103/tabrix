#!/usr/bin/env node
/**
 * V25-04 — Tabrix v2.5 release diagnostic CLI.
 *
 * Reads a v2.5 benchmark JSON report (the deterministic output of
 * `scripts/benchmark-v25.mjs`) and prints a small, plain-text panel of
 * the stability counters the maintainer needs to triage a v2.5 release
 * candidate. This is purposefully NOT a new public capability — it is
 * a release-evidence helper, scoped to read-only filesystem access and
 * stdout output.
 *
 * Usage:
 *   node scripts/release-diagnostic-v25.mjs --input <path>
 *   node scripts/release-diagnostic-v25.mjs --input <path> --json
 *   node scripts/release-diagnostic-v25.mjs --help
 *
 * Flags:
 *   --input  Required. Path to a v2.5 benchmark report JSON.
 *   --json   Optional. Emit the same diagnostic panel as a single-line
 *            JSON object on stdout instead of human-readable text.
 *   --help   Print usage and exit 0.
 *
 * Exit codes:
 *   0 on success
 *   2 on missing/invalid arguments
 *   3 on unreadable / malformed report file
 *   4 on report version mismatch
 *
 * Why a separate script (instead of a `benchmark-v25.mjs` flag): the
 * V25-01 CLI is the canonical transformer. Diagnostics are a release-
 * lane concern — keeping them in their own file means the transformer
 * does not grow new responsibilities and a future Codex release lane
 * can run the diagnostic against any historical report on disk without
 * regenerating it.
 *
 * Scope (what this script will NOT do):
 *   - It does not enforce gate thresholds; that is V25-05's job
 *     (`scripts/lib/v25-benchmark-gate.cjs`).
 *   - It does not extend the click verifier surface or write a recovery
 *     catalog. V25-04 explicitly forbids both.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The v25 transformer pins `reportVersion = 1` (numeric, see
 * `app/native-server/src/benchmark/v25-benchmark.ts::BENCHMARK_REPORT_VERSION`).
 * V25 reports are also distinguishable from v24 reports because the v24
 * transformer writes `reportVersion = "v2.4"` (string). The diagnostic
 * accepts the canonical numeric `1` and rejects every other shape so a
 * v23/v24 file can never silently be summarised under a v25 banner.
 */
const EXPECTED_REPORT_VERSION = 1;

function parseArgs(argv) {
  const out = { input: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--input') {
      out.input = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith('--input=')) {
      out.input = arg.slice('--input='.length);
      continue;
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/release-diagnostic-v25.mjs --input <path> [--json]',
      '',
      'Reads a v2.5 benchmark report and prints stability counters.',
      '',
      'Flags:',
      '  --input <path>  Required. Path to v2.5 benchmark report JSON.',
      '  --json          Emit a single-line JSON object instead of text.',
      '  --help, -h      Show this message and exit.',
      '',
      'Exit codes:',
      '  0 success | 2 bad args | 3 bad file | 4 wrong report version',
      '',
    ].join('\n'),
  );
}

function fail(code, message) {
  process.stderr.write(`release-diagnostic-v25: ${message}\n`);
  process.exit(code);
}

function readReport(inputPath) {
  const absolute = resolve(process.cwd(), inputPath);
  let raw;
  try {
    raw = readFileSync(absolute, 'utf8');
  } catch (err) {
    fail(3, `cannot read report at ${absolute}: ${(err && err.message) || err}`);
    return undefined;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(3, `report is not valid JSON: ${(err && err.message) || err}`);
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(3, 'report root must be a JSON object');
    return undefined;
  }
  if (parsed.reportVersion !== EXPECTED_REPORT_VERSION) {
    fail(
      4,
      `expected reportVersion=${EXPECTED_REPORT_VERSION} (v25 numeric pin), saw ${JSON.stringify(parsed.reportVersion)}`,
    );
    return undefined;
  }
  return parsed;
}

function safeRatio(value) {
  if (value === null || value === undefined) return 'n/a';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(1)}%`;
}

function safeMedian(value) {
  if (value === null || value === undefined) return 'n/a';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(3);
}

function buildDiagnostic(report) {
  const layer = report.layerMetrics ?? {};
  const stability = report.stabilityMetrics ?? {};
  const method = report.methodMetrics ?? {};
  const chosenLayer = layer.chosenLayerDistribution ?? {};
  const sourceRoute = layer.sourceRouteDistribution ?? {};

  return {
    runId: report.runId ?? null,
    buildSha: report.buildSha ?? null,
    totalToolCalls: report.totalToolCalls ?? 0,
    totalScenarios: report.totalScenarios ?? 0,
    completedScenarios: report.completedScenarios ?? 0,
    pairedRunCountMax: report.pairedRunCountMax ?? 0,
    layer: {
      chosenLayerDistribution: chosenLayer,
      sourceRouteDistribution: sourceRoute,
      l0TokenRatioMedian: layer.l0TokenRatioMedian ?? null,
      l0L1TokenRatioMedian: layer.l0L1TokenRatioMedian ?? null,
      tokensSavedEstimateTotal: layer.tokensSavedEstimateTotal ?? 0,
      readPageAvoidedCount: layer.readPageAvoidedCount ?? 0,
    },
    stability: {
      noObservedChangeRate: stability.noObservedChangeRate ?? null,
      visualFallbackRate: stability.visualFallbackRate ?? null,
      jsFallbackRate: stability.jsFallbackRate ?? null,
      replaySuccessRate: stability.replaySuccessRate ?? null,
      replayFallbackDepthMedian: stability.replayFallbackDepthMedian ?? null,
    },
    method: {
      clickAttemptsPerSuccessMedian: method.clickAttemptsPerSuccessMedian ?? null,
      medianToolCallsPerScenario: method.medianToolCallsPerScenario ?? null,
      k3TaskSuccessRate: method.k3TaskSuccessRate ?? null,
      k4ToolRetryRate: method.k4ToolRetryRate ?? null,
    },
  };
}

function printText(diagnostic) {
  const lines = [];
  lines.push('Tabrix v2.5 release diagnostic');
  lines.push('--------------------------------');
  lines.push(`runId:               ${diagnostic.runId ?? 'n/a'}`);
  lines.push(`buildSha:            ${diagnostic.buildSha ?? 'n/a'}`);
  lines.push(`totalToolCalls:      ${diagnostic.totalToolCalls}`);
  lines.push(
    `scenarios completed: ${diagnostic.completedScenarios}/${diagnostic.totalScenarios}`,
  );
  lines.push(`pairedRunCountMax:   ${diagnostic.pairedRunCountMax}`);
  lines.push('');
  lines.push('Layer dispatch');
  lines.push(`  chosenLayer L0:        ${diagnostic.layer.chosenLayerDistribution.L0 ?? 0}`);
  lines.push(
    `  chosenLayer L0+L1:     ${diagnostic.layer.chosenLayerDistribution['L0+L1'] ?? 0}`,
  );
  lines.push(
    `  chosenLayer L0+L1+L2:  ${diagnostic.layer.chosenLayerDistribution['L0+L1+L2'] ?? 0}`,
  );
  lines.push(
    `  l0   token ratio (med): ${safeMedian(diagnostic.layer.l0TokenRatioMedian)}`,
  );
  lines.push(
    `  l0+l1 token ratio (med): ${safeMedian(diagnostic.layer.l0L1TokenRatioMedian)}`,
  );
  lines.push(`  tokens saved (sum):    ${diagnostic.layer.tokensSavedEstimateTotal}`);
  lines.push(`  readPage avoided:      ${diagnostic.layer.readPageAvoidedCount}`);
  lines.push('');
  lines.push('Source route');
  for (const [key, value] of Object.entries(diagnostic.layer.sourceRouteDistribution)) {
    lines.push(`  ${key.padEnd(34)} ${value}`);
  }
  lines.push('');
  lines.push('Stability');
  lines.push(
    `  noObservedChangeRate:  ${safeRatio(diagnostic.stability.noObservedChangeRate)}`,
  );
  lines.push(
    `  visualFallbackRate:    ${safeRatio(diagnostic.stability.visualFallbackRate)}`,
  );
  lines.push(`  jsFallbackRate:        ${safeRatio(diagnostic.stability.jsFallbackRate)}`);
  lines.push(
    `  replaySuccessRate:     ${safeRatio(diagnostic.stability.replaySuccessRate)}`,
  );
  lines.push(
    `  replayFallback depth:  ${safeMedian(diagnostic.stability.replayFallbackDepthMedian)}`,
  );
  lines.push('');
  lines.push('Method');
  lines.push(
    `  clickAttempts/success: ${safeMedian(diagnostic.method.clickAttemptsPerSuccessMedian)}`,
  );
  lines.push(
    `  toolCalls/scenario:    ${safeMedian(diagnostic.method.medianToolCallsPerScenario)}`,
  );
  lines.push(`  K3 task success:       ${safeRatio(diagnostic.method.k3TaskSuccessRate)}`);
  lines.push(`  K4 tool retry rate:    ${safeRatio(diagnostic.method.k4ToolRetryRate)}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.input) {
    fail(2, 'missing required --input <path>');
    return;
  }
  const report = readReport(args.input);
  if (!report) return;
  const diagnostic = buildDiagnostic(report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
  } else {
    printText(diagnostic);
  }
}

main();
