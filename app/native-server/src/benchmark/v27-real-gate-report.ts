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
  sections: V27PublicSafeGateReportSection[];
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
    sections,
  };
  assertPublicSafe(report);
  return report;
}

function deriveOverallStatus(sections: readonly V27PublicSafeGateReportSection[]): V27GateStatus {
  if (sections.some((section) => section.status === 'BLOCKED')) return 'BLOCKED';
  if (sections.some((section) => section.status === 'FAIL')) return 'FAIL';
  return 'PASS';
}

function assertPublicSafe(report: V27PublicSafeGateReport): void {
  const leaks = findSensitivePaths(report);
  if (leaks.length > 0) {
    const summary = leaks.map((leak) => `${leak.path}:${leak.reason}`).join(', ');
    throw new Error(`V27 public gate report contains unsafe evidence: ${summary}`);
  }
  const blob = JSON.stringify(report).toLowerCase();
  if (blob.includes('release ready') || blob.includes('release-ready')) {
    throw new Error('V27 public gate report must not claim release readiness.');
  }
}
