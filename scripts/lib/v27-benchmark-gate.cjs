/**
 * Tabrix v2.7 benchmark gate.
 *
 * Public-safe validator for transformed V27 summaries. Raw browser
 * evidence remains outside this repository.
 */

const fs = require('node:fs');

const BENCHMARK_REPORT_VERSION_EXPECTED = 1;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function evaluateBenchmarkGateV27(summary) {
  const reasons = [];

  if (!summary || typeof summary !== 'object') {
    return ['report is not a JSON object'];
  }

  if (summary.reportVersion !== BENCHMARK_REPORT_VERSION_EXPECTED) {
    reasons.push(
      `report version mismatch: expected ${BENCHMARK_REPORT_VERSION_EXPECTED}, got ${String(summary.reportVersion)}`,
    );
  }

  if (summary.evidenceStatus !== 'pass') {
    reasons.push(`evidenceStatus must be pass, got ${String(summary.evidenceStatus)}`);
  }

  const hardFindings = Array.isArray(summary.gateFindings)
    ? summary.gateFindings.filter((finding) => finding && finding.level === 'fail')
    : [];
  if (hardFindings.length > 0) {
    reasons.push(
      `report has failing gate findings: ${hardFindings
        .map((finding) => finding.code || 'unknown')
        .join(', ')}`,
    );
  }

  if (!isFiniteNumber(summary.heavyPathCount) || summary.heavyPathCount !== 0) {
    reasons.push(`heavyPathCount must be 0, got ${String(summary.heavyPathCount)}`);
  }
  if (!isFiniteNumber(summary.sameTaskUseCount) || summary.sameTaskUseCount < 1) {
    reasons.push(`sameTaskUseCount below threshold: ${String(summary.sameTaskUseCount)}`);
  }
  if (!isFiniteNumber(summary.observedEndpointUseCount) || summary.observedEndpointUseCount < 1) {
    reasons.push(
      `observedEndpointUseCount below threshold: ${String(summary.observedEndpointUseCount)}`,
    );
  }
  if (!isFiniteNumber(summary.seedOnlyProofCount) || summary.seedOnlyProofCount !== 0) {
    reasons.push(`seedOnlyProofCount must be 0, got ${String(summary.seedOnlyProofCount)}`);
  }
  if (!isFiniteNumber(summary.privacyEvidenceCount) || summary.privacyEvidenceCount < 1) {
    reasons.push(`privacyEvidenceCount below threshold: ${String(summary.privacyEvidenceCount)}`);
  }
  if (!isFiniteNumber(summary.privacyFailureCount) || summary.privacyFailureCount !== 0) {
    reasons.push(`privacyFailureCount must be 0, got ${String(summary.privacyFailureCount)}`);
  }

  const competitor = summary.competitorDeltaDistribution || {};
  if (isFiniteNumber(competitor.behind) && competitor.behind > 0) {
    reasons.push(`competitorDeltaDistribution.behind=${competitor.behind}`);
  }

  return reasons;
}

function loadAndEvaluateBenchmarkReportV27(filePath) {
  let summary = null;
  let parseError = null;
  try {
    summary = readJson(filePath);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  const hardReasons = parseError
    ? [`unable to read benchmark report: ${parseError}`]
    : evaluateBenchmarkGateV27(summary);
  return {
    ok: hardReasons.length === 0,
    reasons: hardReasons,
    hardReasons,
    softReasons: [],
    parseError,
  };
}

module.exports = {
  BENCHMARK_REPORT_VERSION_EXPECTED,
  evaluateBenchmarkGateV27,
  loadAndEvaluateBenchmarkReportV27,
};
