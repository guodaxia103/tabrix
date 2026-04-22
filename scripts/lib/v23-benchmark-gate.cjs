/**
 * Tabrix v2.3.0 release gate — canonical, fresh-checkout-safe source.
 *
 * Before V23-06 closeout this lived in
 * `app/native-server/src/benchmark/v23-benchmark.ts` and was imported
 * via the built `dist/` artifact. That made `release:check` and
 * `benchmark-v23.mjs --gate` depend on a prior `pnpm -C app/native-server build`,
 * which is fragile in CI / fresh-checkout. The closeout fix lifts the
 * pure gate logic out so:
 *
 *   - `scripts/check-release-readiness.mjs` can read a v2.3.0+ benchmark
 *     report and validate its CONTENT (not just presence + recency).
 *   - `scripts/benchmark-v23.mjs --gate` shares the same predicate and
 *     no longer needs the gate wired through the TS build.
 *
 * Single source of truth: this file. The TS transformer imports nothing
 * from here (it never needed the gate at runtime); a Jest test asserts
 * `BENCHMARK_REPORT_VERSION_EXPECTED` here matches `BENCHMARK_REPORT_VERSION`
 * exported from the TS transformer, so a future contributor cannot bump
 * the report shape on one side without also touching the gate.
 *
 * Module format: CommonJS (`.cjs`). This is intentional. CommonJS lets:
 *   1. Jest (CJS environment) `require()` it directly without
 *      `--experimental-vm-modules`.
 *   2. The ESM scripts `benchmark-v23.mjs` and `check-release-readiness.mjs`
 *      `import` it via Node's built-in ESM-of-CJS interop.
 * The IO surface is intentionally narrow (one fs-aware helper at the
 * bottom).
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * MUST equal `BENCHMARK_REPORT_VERSION` in
 * `app/native-server/src/benchmark/v23-benchmark.ts`. The cross-source
 * equality is enforced by `v23-benchmark.test.ts`.
 */
const BENCHMARK_REPORT_VERSION_EXPECTED = 1;

const DEFAULT_BENCHMARK_GATE_THRESHOLDS = Object.freeze({
  /** Maximum allowed tool retry rate (K4a). PRD §K4. */
  maxToolRetryRate: 0.1,
  /** Minimum scenario completion rate (K3). PRD §K3. */
  minScenarioCompletionRate: 0.85,
});

/**
 * Hard release-gate predicate. Returns the list of human-readable reasons
 * the report is not ship-grade for v2.3.0. An empty array means
 * "ship-grade".
 *
 * Mirrors the original TS `evaluateBenchmarkGate` semantics 1:1; the TS
 * implementation has been removed in favor of this module.
 */
function evaluateBenchmarkGate(summary, thresholds = DEFAULT_BENCHMARK_GATE_THRESHOLDS) {
  const reasons = [];

  if (!summary || typeof summary !== 'object') {
    return ['report is not a JSON object'];
  }

  const reportVersion = summary.reportVersion;
  if (reportVersion !== BENCHMARK_REPORT_VERSION_EXPECTED) {
    reasons.push(
      `report version mismatch: expected ${BENCHMARK_REPORT_VERSION_EXPECTED}, got ${String(reportVersion)}`,
    );
  }

  const totalScenarios = Number(summary.totalScenarios);
  if (!Number.isFinite(totalScenarios) || totalScenarios <= 0) {
    reasons.push('no scenarios in run — release evidence is empty');
  }

  const laneCounters = summary.laneCounters;
  if (!laneCounters || typeof laneCounters !== 'object') {
    reasons.push('laneCounters block missing from report');
  } else {
    const cdpCount = Number(laneCounters.cdpCount) || 0;
    const debuggerCount = Number(laneCounters.debuggerCount) || 0;
    const violationCount = Number(laneCounters.violationCount);
    const computedViolations = cdpCount + debuggerCount;
    if (Number.isFinite(violationCount) && violationCount !== computedViolations) {
      reasons.push(
        `lane counters self-inconsistent: violationCount=${violationCount} but cdp+debugger=${computedViolations}`,
      );
    }
    const effectiveViolations = Number.isFinite(violationCount)
      ? violationCount
      : computedViolations;
    if (effectiveViolations > 0) {
      reasons.push(
        `lane-integrity violations present: cdp=${cdpCount}, debugger=${debuggerCount}`,
      );
    }
  }

  const k3 = summary.k3TaskSuccessRate;
  if (
    typeof k3 === 'number' &&
    Number.isFinite(k3) &&
    k3 < thresholds.minScenarioCompletionRate
  ) {
    reasons.push(
      `K3 task success rate ${k3.toFixed(3)} below threshold ${thresholds.minScenarioCompletionRate}`,
    );
  }

  const k4 = summary.k4ToolRetryRate;
  if (
    typeof k4 === 'number' &&
    Number.isFinite(k4) &&
    k4 > thresholds.maxToolRetryRate
  ) {
    reasons.push(
      `K4 tool retry rate ${k4.toFixed(3)} above threshold ${thresholds.maxToolRetryRate}`,
    );
  }

  return reasons;
}

/**
 * Parse "X.Y.Z..." into `{ major, minor, patch }`. Returns `null` if the
 * string does not start with a semver prefix.
 */
function parseSemverPrefix(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Whether the benchmark gate applies to a given semver. v2.3.0+ → true.
 * v2.2.x and below → false. Invalid semver → false (caller should
 * already have errored on the version).
 */
function benchmarkGateApplies(version) {
  const semver = parseSemverPrefix(version);
  if (!semver) return false;
  if (semver.major > 2) return true;
  if (semver.major < 2) return false;
  return semver.minor >= 3;
}

/**
 * Fs-aware helper used by `check-release-readiness.mjs`. Reads + parses
 * + validates the benchmark report at `filePath` and returns:
 *
 *   {
 *     ok: boolean,            // true iff parse succeeded AND gate passed
 *     reasons: string[],      // gate reasons (empty when ok=true)
 *     parseError: string|null // populated when the file cannot be read or JSON-parsed
 *   }
 *
 * A malformed or unreadable file is treated as a gate failure (ok=false,
 * reasons contains the parse error). This keeps the calling script
 * simple: it just appends `reasons` to its `errors[]` collector.
 */
function loadAndEvaluateBenchmarkReport(filePath, thresholds) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const msg = `cannot read benchmark report ${filePath}: ${err && err.message ? err.message : String(err)}`;
    return { ok: false, reasons: [msg], parseError: msg };
  }

  let summary;
  try {
    summary = JSON.parse(raw);
  } catch (err) {
    const msg = `benchmark report ${path.basename(filePath)} is not valid JSON: ${err && err.message ? err.message : String(err)}`;
    return { ok: false, reasons: [msg], parseError: msg };
  }

  const reasons = evaluateBenchmarkGate(summary, thresholds);
  return { ok: reasons.length === 0, reasons, parseError: null };
}

module.exports = {
  BENCHMARK_REPORT_VERSION_EXPECTED,
  DEFAULT_BENCHMARK_GATE_THRESHOLDS,
  evaluateBenchmarkGate,
  parseSemverPrefix,
  benchmarkGateApplies,
  loadAndEvaluateBenchmarkReport,
};
