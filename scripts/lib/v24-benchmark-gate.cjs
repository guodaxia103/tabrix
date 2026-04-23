/**
 * Tabrix v2.4.0 release gate — canonical, fresh-checkout-safe source.
 *
 * Independent module from `v23-benchmark-gate.cjs`: the v23 gate is
 * the v2.3.0 ship contract and must remain untouched (its
 * report-version is still `1`, its semantics are still K3/K4/lane).
 * This file owns the v2.4.0 gate and applies ONLY to v2.4.0+ tags
 * (`benchmarkGateAppliesV24`).
 *
 * Hard invariants (v2.4 release blockers):
 *   - reportVersion === BENCHMARK_REPORT_VERSION_EXPECTED (= 1).
 *   - laneCounters present, internally consistent, no violations.
 *   - K3 task success rate ≥ 0.85 (mirrors v23).
 *   - K4 tool retry rate ≤ 0.10 (mirrors v23).
 *   - At least one scenario.
 *   - Every KPI scenario has `pairCount >= 3`. KPI scenarios are
 *     declared by the runner via the report's `kpiScenarioIds[]`.
 *     Empty list means "every scenario is KPI-graded".
 *
 * Soft invariants (evidence-only, surfaced as `WARN:` reasons):
 *   - K5 second-touch speedup median guidance: ≥ 1.50.
 *   - K6 replay success rate median guidance: ≥ 0.80.
 *   - K7 replay fallback rate median guidance: ≤ 0.20.
 *   - K8 token saving ratio median guidance: ≤ 0.40 (lower is
 *     better — ratio of second-touch tokens to first-touch tokens).
 *
 * Why soft for K5..K8: the v2.4.0 plan defers K8-driven token-cache
 * work (V24-04) to v2.5 unless real-MCP measurement shows K8 < 0.40.
 * Failing the gate on K5..K8 in v2.4 would force the maintainer to
 * either ship without evidence or block on V24-04. Instead we emit
 * `WARN:`-prefixed reasons that the release notes can cite without
 * the gate refusing the report.
 *
 * Module format: CommonJS (`.cjs`). Same rationale as
 * `v23-benchmark-gate.cjs`.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * MUST equal `BENCHMARK_REPORT_VERSION` in
 * `app/native-server/src/benchmark/v24-benchmark.ts`. The cross-source
 * equality is enforced by `v24-benchmark.test.ts`.
 */
const BENCHMARK_REPORT_VERSION_EXPECTED = 1;

const DEFAULT_BENCHMARK_GATE_THRESHOLDS_V24 = Object.freeze({
  /** Hard: maximum allowed tool retry rate (K4a). PRD §K4. */
  maxToolRetryRate: 0.1,
  /** Hard: minimum scenario completion rate (K3). PRD §K3. */
  minScenarioCompletionRate: 0.85,
  /** Hard: minimum complete pairs per KPI scenario. */
  minPairCountPerKpiScenario: 3,
  /** Soft (WARN): K5 second-touch speedup floor. */
  warnMinK5SecondTouchSpeedup: 1.5,
  /** Soft (WARN): K6 replay success rate floor. */
  warnMinK6ReplaySuccessRate: 0.8,
  /** Soft (WARN): K7 replay fallback rate ceiling. */
  warnMaxK7ReplayFallbackRate: 0.2,
  /** Soft (WARN): K8 token saving ratio ceiling. Below this triggers V24-04 defer-decision per plan §6.4. */
  warnMaxK8TokenSavingRatio: 0.4,
});

const KNOWN_LANES = new Set(['tabrix_owned', 'cdp', 'debugger', 'unknown']);

function evaluateBenchmarkGateV24(summary, thresholds = DEFAULT_BENCHMARK_GATE_THRESHOLDS_V24) {
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

  const pairs = Array.isArray(summary.pairs) ? summary.pairs : [];
  const pairsByScenario = new Map();
  for (const block of pairs) {
    if (block && typeof block.scenarioId === 'string' && block.aggregate) {
      pairsByScenario.set(block.scenarioId, block);
    }
  }

  const declaredKpiIds = Array.isArray(summary.kpiScenarioIds) ? summary.kpiScenarioIds : [];
  const effectiveKpiIds = declaredKpiIds.length > 0
    ? declaredKpiIds
    : pairs.map((block) => (block && block.scenarioId) || '').filter((id) => id.length > 0);

  for (const scenarioId of effectiveKpiIds) {
    const block = pairsByScenario.get(scenarioId);
    if (!block) {
      reasons.push(
        `KPI scenario "${scenarioId}" missing pairs block — runner did not emit any pair bindings for it`,
      );
      continue;
    }
    const pairCount = Number(block.aggregate.pairCount);
    if (!Number.isFinite(pairCount) || pairCount < thresholds.minPairCountPerKpiScenario) {
      reasons.push(
        `KPI scenario "${scenarioId}" has pairCount=${pairCount} below required ${thresholds.minPairCountPerKpiScenario}`,
      );
    }
  }

  const k5 = summary.k5SecondTouchSpeedup;
  if (
    typeof k5 === 'number' &&
    Number.isFinite(k5) &&
    k5 < thresholds.warnMinK5SecondTouchSpeedup
  ) {
    reasons.push(
      `WARN: K5 second-touch speedup median ${k5.toFixed(3)} below guidance ${thresholds.warnMinK5SecondTouchSpeedup}`,
    );
  }

  const k6 = summary.k6ReplaySuccessRate;
  if (
    typeof k6 === 'number' &&
    Number.isFinite(k6) &&
    k6 < thresholds.warnMinK6ReplaySuccessRate
  ) {
    reasons.push(
      `WARN: K6 replay success rate median ${k6.toFixed(3)} below guidance ${thresholds.warnMinK6ReplaySuccessRate}`,
    );
  }

  const k7 = summary.k7ReplayFallbackRate;
  if (
    typeof k7 === 'number' &&
    Number.isFinite(k7) &&
    k7 > thresholds.warnMaxK7ReplayFallbackRate
  ) {
    reasons.push(
      `WARN: K7 replay fallback rate median ${k7.toFixed(3)} above guidance ${thresholds.warnMaxK7ReplayFallbackRate}`,
    );
  }

  const k8 = summary.k8TokenSavingRatio;
  if (
    typeof k8 === 'number' &&
    Number.isFinite(k8) &&
    k8 > thresholds.warnMaxK8TokenSavingRatio
  ) {
    reasons.push(
      `WARN: K8 token saving ratio median ${k8.toFixed(3)} above guidance ${thresholds.warnMaxK8TokenSavingRatio}`,
    );
  }

  return reasons;
}

/** Soft reasons begin with "WARN:" — used by the gate-then-write path to allow ship under WARN-only. */
function partitionGateReasons(reasons) {
  const hard = [];
  const soft = [];
  for (const reason of reasons) {
    if (reason.startsWith('WARN:')) soft.push(reason);
    else hard.push(reason);
  }
  return { hard, soft };
}

function parseSemverPrefix(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Whether the v24 gate applies to a given semver. v2.4.0+ → true.
 * v2.3.x and below → false (those use the v23 gate).
 */
function benchmarkGateAppliesV24(version) {
  const semver = parseSemverPrefix(version);
  if (!semver) return false;
  if (semver.major > 2) return true;
  if (semver.major < 2) return false;
  return semver.minor >= 4;
}

function loadAndEvaluateBenchmarkReportV24(filePath, thresholds) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const msg = `cannot read benchmark report ${filePath}: ${err && err.message ? err.message : String(err)}`;
    return { ok: false, reasons: [msg], parseError: msg, hardReasons: [msg], softReasons: [] };
  }

  let summary;
  try {
    summary = JSON.parse(raw);
  } catch (err) {
    const msg = `benchmark report ${path.basename(filePath)} is not valid JSON: ${err && err.message ? err.message : String(err)}`;
    return { ok: false, reasons: [msg], parseError: msg, hardReasons: [msg], softReasons: [] };
  }

  const reasons = evaluateBenchmarkGateV24(summary, thresholds);
  const { hard, soft } = partitionGateReasons(reasons);
  return {
    ok: hard.length === 0,
    reasons,
    hardReasons: hard,
    softReasons: soft,
    parseError: null,
    summary,
  };
}

/**
 * Locate the most recent baseline-comparison markdown table under
 * `benchmarkDir` and verify it exists. The table file naming convention
 * is `v24-vs-v23-baseline-<date>.md`. Returns:
 *   { ok: boolean, reason?: string, tablePath?: string }
 */
function findBaselineComparisonTable(benchmarkDir) {
  if (!fs.existsSync(benchmarkDir)) {
    return { ok: false, reason: `baseline directory missing: ${benchmarkDir}` };
  }
  const candidates = fs
    .readdirSync(benchmarkDir)
    .filter((name) => /^v24-vs-v23-baseline-.*\.md$/.test(name))
    .map((name) => {
      const full = path.join(benchmarkDir, name);
      const stat = fs.statSync(full);
      return { name, full, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: `no v24-vs-v23-baseline-*.md file found in ${benchmarkDir}`,
    };
  }
  return { ok: true, tablePath: candidates[0].full };
}

/**
 * Verify that the release notes file embeds the v24-vs-v23 baseline
 * comparison table. The embed contract is loose by design (a maintainer
 * can paste the table inline OR link to it), so we accept either:
 *   - The notes file contains the canonical column header
 *     `metric | v2.3.0 baseline | v2.4.0 median | delta | direction`
 *     (case-sensitive, whitespace-tolerant), OR
 *   - The notes file references the table file path under
 *     `docs/benchmarks/v24/`.
 */
function requireBaselineComparisonTable(notesPath, benchmarkDir) {
  const tableResult = findBaselineComparisonTable(benchmarkDir);
  if (!tableResult.ok) {
    return { ok: false, reasons: [tableResult.reason] };
  }
  if (!notesPath || !fs.existsSync(notesPath)) {
    return {
      ok: false,
      reasons: [`release notes file missing: ${notesPath}`],
      tablePath: tableResult.tablePath,
    };
  }
  const notes = fs.readFileSync(notesPath, 'utf8');
  const headerRegex =
    /metric\s*\|\s*v2\.3\.0\s+baseline\s*\|\s*v2\.4\.0\s+median\s*\|\s*delta\s*\|\s*direction/i;
  const hasHeader = headerRegex.test(notes);
  const hasFileLink = notes.includes('docs/benchmarks/v24/');
  if (!hasHeader && !hasFileLink) {
    return {
      ok: false,
      reasons: [
        `release notes ${path.basename(notesPath)} does not embed the v24-vs-v23 baseline comparison table ` +
          `(expected header "metric | v2.3.0 baseline | v2.4.0 median | delta | direction" or a docs/benchmarks/v24/ reference)`,
      ],
      tablePath: tableResult.tablePath,
    };
  }
  return { ok: true, reasons: [], tablePath: tableResult.tablePath };
}

module.exports = {
  BENCHMARK_REPORT_VERSION_EXPECTED,
  DEFAULT_BENCHMARK_GATE_THRESHOLDS_V24,
  KNOWN_LANES,
  evaluateBenchmarkGateV24,
  partitionGateReasons,
  parseSemverPrefix,
  benchmarkGateAppliesV24,
  loadAndEvaluateBenchmarkReportV24,
  findBaselineComparisonTable,
  requireBaselineComparisonTable,
};
