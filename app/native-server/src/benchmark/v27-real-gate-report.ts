/**
 * V27-16 public-safe real gate report schema.
 *
 * This is a deterministic report builder for owner-lane evidence
 * summaries. It does not run real-browser acceptance and it does not
 * claim release readiness.
 */

import { findSensitivePaths } from '../runtime/privacy-gate';

export type V27GateStatus = 'PASS' | 'FAIL' | 'BLOCKED';

export type V27GateSectionId =
  | 'api_success'
  | 'api_timeout_fallback'
  | 'semantic_mismatch_fallback'
  | 'api_unavailable_fallback'
  | 'real_platform_gate'
  | 'competitor_delta_gate'
  | 'privacy_evidence'
  | 'benchmark_gate';

export interface V27GateSectionInput {
  id: V27GateSectionId;
  status: V27GateStatus;
  summary: string;
  evidence?: Record<string, string | number | boolean | null>;
}

export interface V27PublicSafeGateReportInput {
  runId: string;
  generatedAt: string;
  sections: V27GateSectionInput[];
  realPlatformGate?: V27RealPlatformGateEvidenceInput | null;
  competitorDeltaGate?: V27CompetitorDeltaGateEvidenceInput | null;
}

export type V27RowsPassStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'not_run';

export interface V27RealPlatformGateEvidenceInput {
  xhsSearchTop10RowsPass: V27RowsPassStatus;
  githubSearchRowsPass: V27RowsPassStatus;
  douyinSearchRowsPass: V27RowsPassStatus;
  domRegionRowsUsedCount: number;
  apiRowsUsedCount: number;
  failureReasonDistribution: Record<string, number>;
  sensitivePersistedCount: number;
}

export type V27CompetitorDeltaConclusion =
  | 'speed_lead'
  | 'near'
  | 'behind'
  | 'resilience_win'
  | 'quality_win'
  | 'quality_loss'
  | 'blocked'
  | 'baseline_missing';

export interface V27CompetitorDeltaGateEvidenceInput {
  competitorDelta: V27CompetitorDeltaConclusion;
  qualityDelta: number;
  latencyDelta: number;
  refCoverageDelta: number;
  blockedReason: string | null;
}

export interface V27PublicSafeGateReportSection extends V27GateSectionInput {
  evidence: Record<string, string | number | boolean | null>;
}

export interface V27PublicSafeGateReport {
  schemaVersion: 1;
  scope: 'public_safe_v27_gate_report';
  runId: string;
  generatedAt: string;
  overallStatus: V27GateStatus;
  releaseReadiness: 'not_assessed';
  realPlatformGate: V27RealPlatformGateEvidence | null;
  competitorDeltaGate: V27CompetitorDeltaGateEvidence | null;
  sections: V27PublicSafeGateReportSection[];
}

export interface V27RealPlatformGateEvidence extends V27RealPlatformGateEvidenceInput {
  scope: 'public_safe_real_platform_gate';
}

export interface V27CompetitorDeltaGateEvidence extends V27CompetitorDeltaGateEvidenceInput {
  scope: 'public_safe_competitor_delta_gate';
}

export function buildPublicSafeV27GateReport(
  input: V27PublicSafeGateReportInput,
): V27PublicSafeGateReport {
  const sections = input.sections.map((section) => ({
    id: section.id,
    status: section.status,
    summary: section.summary.trim(),
    evidence: { ...(section.evidence ?? {}) },
  }));
  const report: V27PublicSafeGateReport = {
    schemaVersion: 1,
    scope: 'public_safe_v27_gate_report',
    runId: input.runId.trim(),
    generatedAt: input.generatedAt.trim(),
    overallStatus: deriveOverallStatus(sections),
    releaseReadiness: 'not_assessed',
    realPlatformGate: input.realPlatformGate
      ? normalizeRealPlatformGate(input.realPlatformGate)
      : null,
    competitorDeltaGate: input.competitorDeltaGate
      ? normalizeCompetitorDeltaGate(input.competitorDeltaGate)
      : null,
    sections,
  };
  assertPublicSafe(report);
  return report;
}

const COMPETITOR_DELTA_VALUES: ReadonlySet<V27CompetitorDeltaConclusion> = new Set([
  'speed_lead',
  'near',
  'behind',
  'resilience_win',
  'quality_win',
  'quality_loss',
  'blocked',
  'baseline_missing',
]);

const COMPETITOR_BLOCKED_REASON_VALUES: ReadonlySet<string> = new Set([
  'blocked',
  'owner_lane_not_run',
  'private_scenario_unavailable',
  'login_state_missing___private_scenario_unavailable',
  'competitor_baseline_missing',
  'runtime_log_unavailable',
]);

function normalizeCompetitorDeltaGate(
  input: V27CompetitorDeltaGateEvidenceInput,
): V27CompetitorDeltaGateEvidence {
  const competitorDelta = COMPETITOR_DELTA_VALUES.has(input.competitorDelta)
    ? input.competitorDelta
    : 'baseline_missing';
  return {
    scope: 'public_safe_competitor_delta_gate',
    competitorDelta,
    qualityDelta: finiteNumber(input.qualityDelta),
    latencyDelta: finiteNumber(input.latencyDelta),
    refCoverageDelta: finiteNumber(input.refCoverageDelta),
    blockedReason:
      competitorDelta === 'blocked' || input.blockedReason
        ? normalizeReason(input.blockedReason)
        : null,
  };
}

function normalizeRealPlatformGate(
  input: V27RealPlatformGateEvidenceInput,
): V27RealPlatformGateEvidence {
  return {
    scope: 'public_safe_real_platform_gate',
    xhsSearchTop10RowsPass: normalizeRowsPass(input.xhsSearchTop10RowsPass),
    githubSearchRowsPass: normalizeRowsPass(input.githubSearchRowsPass),
    douyinSearchRowsPass: normalizeRowsPass(input.douyinSearchRowsPass),
    domRegionRowsUsedCount: nonNegativeInteger(input.domRegionRowsUsedCount),
    apiRowsUsedCount: nonNegativeInteger(input.apiRowsUsedCount),
    failureReasonDistribution: normalizeDistribution(input.failureReasonDistribution),
    sensitivePersistedCount: nonNegativeInteger(input.sensitivePersistedCount),
  };
}

function normalizeRowsPass(value: V27RowsPassStatus): V27RowsPassStatus {
  return ['PASS', 'FAIL', 'BLOCKED', 'not_run'].includes(value) ? value : 'not_run';
}

function normalizeDistribution(input: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    const safeKey = key
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]/g, '_')
      .slice(0, 80);
    if (!safeKey) continue;
    result[safeKey] = nonNegativeInteger(value);
  }
  return result;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function finiteNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(3));
}

function normalizeReason(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const safeReason = trimmed.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
  return COMPETITOR_BLOCKED_REASON_VALUES.has(safeReason) ? safeReason : 'blocked';
}

function deriveOverallStatus(sections: readonly V27PublicSafeGateReportSection[]): V27GateStatus {
  if (sections.some((section) => section.status === 'BLOCKED')) return 'BLOCKED';
  if (sections.some((section) => section.status === 'FAIL')) return 'FAIL';
  return 'PASS';
}

function assertPublicSafe(report: V27PublicSafeGateReport): void {
  const leaks = findSensitivePaths(report).filter((leak) => !isAllowedClosedEnumLeak(report, leak));
  if (leaks.length > 0) {
    const summary = leaks.map((leak) => `${leak.path}:${leak.reason}`).join(', ');
    throw new Error(`V27 public gate report contains unsafe evidence: ${summary}`);
  }
  const blob = JSON.stringify(report).toLowerCase();
  if (blob.includes('release ready') || blob.includes('release-ready')) {
    throw new Error('V27 public gate report must not claim release readiness.');
  }
}

function isAllowedClosedEnumLeak(
  report: V27PublicSafeGateReport,
  leak: { path: string; reason: string },
): boolean {
  if (leak.reason !== 'sensitive_value_shape') return false;
  if (
    leak.path === 'realPlatformGate.scope' &&
    report.realPlatformGate?.scope === 'public_safe_real_platform_gate'
  ) {
    return true;
  }
  if (
    leak.path === 'competitorDeltaGate.scope' &&
    report.competitorDeltaGate?.scope === 'public_safe_competitor_delta_gate'
  ) {
    return true;
  }
  if (
    leak.path === 'competitorDeltaGate.blockedReason' &&
    typeof report.competitorDeltaGate?.blockedReason === 'string' &&
    COMPETITOR_BLOCKED_REASON_VALUES.has(report.competitorDeltaGate.blockedReason)
  ) {
    return true;
  }
  return false;
}
