/**
 * Tabrix v2.6 release gate — canonical, fresh-checkout-safe source.
 *
 * v2.6 uses the v26 benchmark transformer and the maintainer-private
 * Gate B real-browser runner. Raw evidence stays outside the public
 * repo; this module only validates the transformed summary/report that
 * the release owner places under TABRIX_RELEASE_EVIDENCE_DIR or
 * `.claude/private-docs/benchmarks/v26`.
 */

const fs = require('node:fs');

const BENCHMARK_REPORT_VERSION_EXPECTED = 1;
const RELEASE_NOTES_PLACEHOLDER_TOKEN = '__V26_TBD__';

const DEFAULT_BENCHMARK_GATE_THRESHOLDS_V26 = Object.freeze({
  minApiKnowledgeHitRate: 0.01,
  minReadPageAvoidedCount: 1,
  minTokensSavedEstimateTotal: 1,
  minOperationLogWriteRate: 0.95,
  minPrimaryTabReuseRate: 0.95,
  maxConcurrentBenchmarkTabs: 2,
  maxCompetitorBehindCount: 0,
  maxLatencyGateFailCount: 0,
});

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version || ''));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersion(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return Number.NaN;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

function benchmarkGateAppliesV26(version) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  return compareVersion(version, '2.6.0') >= 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function metric(summary, key) {
  if (summary && isFiniteNumber(summary[key])) return summary[key];
  const nested = summary?.metrics;
  if (nested && isFiniteNumber(nested[key])) return nested[key];
  const gateMetrics = summary?.gate?.metrics;
  if (gateMetrics && isFiniteNumber(gateMetrics[key])) return gateMetrics[key];
  return null;
}

function distributionCount(summary, distKey, bucket) {
  const dist =
    summary?.[distKey] ??
    summary?.metrics?.[distKey] ??
    summary?.gate?.metrics?.[distKey] ??
    {};
  const value = dist?.[bucket];
  return isFiniteNumber(value) ? value : 0;
}

function evaluateBenchmarkGateV26(
  summary,
  thresholds = DEFAULT_BENCHMARK_GATE_THRESHOLDS_V26,
) {
  const reasons = [];

  if (!summary || typeof summary !== 'object') {
    return ['report is not a JSON object'];
  }

  if (summary.reportVersion !== BENCHMARK_REPORT_VERSION_EXPECTED) {
    reasons.push(
      `report version mismatch: expected ${BENCHMARK_REPORT_VERSION_EXPECTED}, got ${String(summary.reportVersion)}`,
    );
  }

  if (summary.evidenceKind !== 'real_mcp') {
    reasons.push(`evidenceKind must be real_mcp, got ${String(summary.evidenceKind)}`);
  }

  if (summary.evidenceStatus !== 'pass') {
    reasons.push(`evidenceStatus must be pass, got ${String(summary.evidenceStatus)}`);
  }

  const evidenceFindings = Array.isArray(summary.evidenceFindings)
    ? summary.evidenceFindings
    : [];
  const hardFindings = evidenceFindings.filter((finding) => finding?.level === 'fail');
  if (hardFindings.length > 0) {
    reasons.push(
      `report has failing evidence findings: ${hardFindings
        .map((finding) => finding.code || 'unknown')
        .join(', ')}`,
    );
  }

  const totalScenarios = Number(summary?.v25Summary?.totalScenarios ?? summary.totalScenarios);
  if (!Number.isFinite(totalScenarios) || totalScenarios <= 0) {
    reasons.push('no scenarios in run — release evidence is empty');
  }

  const apiKnowledgeHitRate = metric(summary, 'apiKnowledgeHitRate');
  if (
    !isFiniteNumber(apiKnowledgeHitRate) ||
    apiKnowledgeHitRate < thresholds.minApiKnowledgeHitRate
  ) {
    reasons.push(
      `apiKnowledgeHitRate ${String(apiKnowledgeHitRate)} below threshold ${thresholds.minApiKnowledgeHitRate}`,
    );
  }

  const readPageAvoidedCount = metric(summary, 'readPageAvoidedCount');
  if (
    !isFiniteNumber(readPageAvoidedCount) ||
    readPageAvoidedCount < thresholds.minReadPageAvoidedCount
  ) {
    reasons.push(
      `readPageAvoidedCount ${String(readPageAvoidedCount)} below threshold ${thresholds.minReadPageAvoidedCount}`,
    );
  }

  const tokensSavedEstimateTotal = metric(summary, 'tokensSavedEstimateTotal');
  if (
    !isFiniteNumber(tokensSavedEstimateTotal) ||
    tokensSavedEstimateTotal < thresholds.minTokensSavedEstimateTotal
  ) {
    reasons.push(
      `tokensSavedEstimateTotal ${String(tokensSavedEstimateTotal)} below threshold ${thresholds.minTokensSavedEstimateTotal}`,
    );
  }

  const operationLogWriteRate = metric(summary, 'operationLogWriteRate');
  if (
    !isFiniteNumber(operationLogWriteRate) ||
    operationLogWriteRate < thresholds.minOperationLogWriteRate
  ) {
    reasons.push(
      `operationLogWriteRate ${String(operationLogWriteRate)} below threshold ${thresholds.minOperationLogWriteRate}`,
    );
  }

  const primaryTabReuseRate = metric(summary, 'primaryTabReuseRate');
  if (
    !isFiniteNumber(primaryTabReuseRate) ||
    primaryTabReuseRate < thresholds.minPrimaryTabReuseRate
  ) {
    reasons.push(
      `primaryTabReuseRate ${String(primaryTabReuseRate)} below threshold ${thresholds.minPrimaryTabReuseRate}`,
    );
  }

  const maxConcurrentBenchmarkTabs = metric(summary, 'maxConcurrentBenchmarkTabs');
  if (
    !isFiniteNumber(maxConcurrentBenchmarkTabs) ||
    maxConcurrentBenchmarkTabs > thresholds.maxConcurrentBenchmarkTabs
  ) {
    reasons.push(
      `maxConcurrentBenchmarkTabs ${String(maxConcurrentBenchmarkTabs)} above ceiling ${thresholds.maxConcurrentBenchmarkTabs}`,
    );
  }

  const competitorBehindCount = distributionCount(
    summary,
    'competitorDeltaDistribution',
    'behind',
  );
  if (competitorBehindCount > thresholds.maxCompetitorBehindCount) {
    reasons.push(`competitorDeltaDistribution.behind=${competitorBehindCount}`);
  }

  const perScenarioLatency = Array.isArray(summary.perScenarioLatency)
    ? summary.perScenarioLatency
    : Array.isArray(summary?.metrics?.perScenarioLatency)
      ? summary.metrics.perScenarioLatency
      : [];
  const failedLatency = perScenarioLatency.filter(
    (entry) => entry?.latencyGateStatus === 'fail',
  );
  if (failedLatency.length > thresholds.maxLatencyGateFailCount) {
    reasons.push(
      `latency gate failed for scenarios: ${failedLatency
        .map((entry) => entry.scenarioId || 'unknown')
        .join(', ')}`,
    );
  }

  return reasons;
}

function loadAndEvaluateBenchmarkReportV26(filePath) {
  let summary = null;
  let parseError = null;
  try {
    summary = readJson(filePath);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const hardReasons = parseError
    ? [`unable to read benchmark report: ${parseError}`]
    : evaluateBenchmarkGateV26(summary);
  return {
    ok: hardReasons.length === 0,
    reasons: hardReasons,
    hardReasons,
    softReasons: [],
    parseError,
  };
}

function requireReleaseNotesSummaryV26(notesPath) {
  const reasons = [];
  let text = '';
  try {
    text = fs.readFileSync(notesPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      reasons: [`unable to read release notes: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (text.includes(RELEASE_NOTES_PLACEHOLDER_TOKEN)) {
    reasons.push(`release notes still contain ${RELEASE_NOTES_PLACEHOLDER_TOKEN}`);
  }
  if (/\bDRAFT\b|Status:\s*Draft|TBD|DO NOT/i.test(text)) {
    reasons.push('release notes still contain draft/TBD/do-not-ship language');
  }
  if (!/Gate B strict PASS/i.test(text)) {
    reasons.push('release notes must include public-safe Gate B strict PASS summary');
  }
  if (!/seed_adapter/i.test(text)) {
    reasons.push('release notes must disclose seed_adapter transitional source lineage');
  }
  if (!/v2\.7/i.test(text)) {
    reasons.push('release notes must state broader observed-endpoint reuse remains v2.7 scope');
  }

  return { ok: reasons.length === 0, reasons };
}

module.exports = {
  BENCHMARK_REPORT_VERSION_EXPECTED,
  DEFAULT_BENCHMARK_GATE_THRESHOLDS_V26,
  RELEASE_NOTES_PLACEHOLDER_TOKEN,
  benchmarkGateAppliesV26,
  evaluateBenchmarkGateV26,
  loadAndEvaluateBenchmarkReportV26,
  requireReleaseNotesSummaryV26,
};
