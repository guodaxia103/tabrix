/**
 * Tabrix v2.7 benchmark transformer (V27-15).
 *
 * Pure additive wrapper over v26. It consumes v27 runtime evidence
 * fields without changing the v26 release contract.
 */

import {
  summariseBenchmarkRunV26,
  type BenchmarkCompetitorDeltaV26,
  type BenchmarkRunInputV26,
  type BenchmarkSummaryV26,
  type BenchmarkToolCallRecordV26,
} from './v26-benchmark';

export const BENCHMARK_REPORT_VERSION = 1 as const;

export interface BenchmarkToolCallRecordV27 extends BenchmarkToolCallRecordV26 {
  heavyPath?: boolean | null;
  sameTaskLiveObservedUseCount?: number | null;
  nonSeedObservedEndpointUsedCount?: number | null;
  seedOnlyProof?: boolean | null;
  privacyCheck?: 'passed' | 'failed' | string | null;
  relevanceCheck?: 'passed' | 'failed' | string | null;
}

export interface BenchmarkRunInputV27 extends BenchmarkRunInputV26 {
  toolCalls: BenchmarkToolCallRecordV27[];
}

export type BenchmarkEvidenceStatusV27 = 'pass' | 'fail';

export type BenchmarkGateFindingCodeV27 =
  | 'heavy_path_observed'
  | 'same_task_use_missing'
  | 'observed_endpoint_missing'
  | 'seed_only_proof'
  | 'privacy_evidence_missing'
  | 'privacy_failure_observed'
  | 'competitor_speed_behind';

export interface BenchmarkGateFindingV27 {
  level: 'fail';
  code: BenchmarkGateFindingCodeV27;
  detail: string;
}

export interface BenchmarkCompetitorDeltaDistributionV27 {
  speed_lead: number;
  near: number;
  behind: number;
  blocked: number;
  resilience_win: number;
  not_compared: number;
}

export interface BenchmarkSummaryV27 {
  reportVersion: typeof BENCHMARK_REPORT_VERSION;
  v26Summary: BenchmarkSummaryV26;
  totalToolCalls: number;
  heavyPathCount: number;
  sameTaskUseCount: number;
  observedEndpointUseCount: number;
  seedOnlyProofCount: number;
  privacyEvidenceCount: number;
  privacyFailureCount: number;
  relevanceFailureCount: number;
  competitorDeltaDistribution: BenchmarkCompetitorDeltaDistributionV27;
  evidenceStatus: BenchmarkEvidenceStatusV27;
  gateFindings: BenchmarkGateFindingV27[];
}

export function summariseBenchmarkRunV27(input: BenchmarkRunInputV27): BenchmarkSummaryV27 {
  const toolCalls = input.toolCalls ?? [];
  const v26Summary = summariseBenchmarkRunV26(input);

  let heavyPathCount = 0;
  let sameTaskUseCount = 0;
  let observedEndpointUseCount = 0;
  let seedOnlyProofCount = 0;
  let privacyEvidenceCount = 0;
  let privacyFailureCount = 0;
  let relevanceFailureCount = 0;

  for (const call of toolCalls) {
    if (call.heavyPath === true) heavyPathCount += 1;
    sameTaskUseCount += nonNegativeInteger(call.sameTaskLiveObservedUseCount);
    observedEndpointUseCount += nonNegativeInteger(call.nonSeedObservedEndpointUsedCount);
    if (call.seedOnlyProof === true) seedOnlyProofCount += 1;
    if (call.privacyCheck === 'passed' || call.privacyCheck === 'failed') {
      privacyEvidenceCount += 1;
      if (call.privacyCheck === 'failed') privacyFailureCount += 1;
    }
    if (call.relevanceCheck === 'failed') relevanceFailureCount += 1;
  }

  const competitorDeltaDistribution = mapCompetitorDeltaDistribution(
    v26Summary.competitorDeltaDistribution,
  );
  const gateFindings = buildGateFindings({
    heavyPathCount,
    sameTaskUseCount,
    observedEndpointUseCount,
    seedOnlyProofCount,
    privacyEvidenceCount,
    privacyFailureCount,
    competitorBehindCount: competitorDeltaDistribution.behind,
  });

  return {
    reportVersion: BENCHMARK_REPORT_VERSION,
    v26Summary,
    totalToolCalls: toolCalls.length,
    heavyPathCount,
    sameTaskUseCount,
    observedEndpointUseCount,
    seedOnlyProofCount,
    privacyEvidenceCount,
    privacyFailureCount,
    relevanceFailureCount,
    competitorDeltaDistribution,
    evidenceStatus: gateFindings.length === 0 ? 'pass' : 'fail',
    gateFindings,
  };
}

function buildGateFindings(input: {
  heavyPathCount: number;
  sameTaskUseCount: number;
  observedEndpointUseCount: number;
  seedOnlyProofCount: number;
  privacyEvidenceCount: number;
  privacyFailureCount: number;
  competitorBehindCount: number;
}): BenchmarkGateFindingV27[] {
  const findings: BenchmarkGateFindingV27[] = [];
  if (input.heavyPathCount > 0) {
    findings.push({
      level: 'fail',
      code: 'heavy_path_observed',
      detail: `heavyPathCount=${input.heavyPathCount}`,
    });
  }
  if (input.sameTaskUseCount === 0) {
    findings.push({
      level: 'fail',
      code: 'same_task_use_missing',
      detail: 'No same-task live observed API reuse evidence was present.',
    });
  }
  if (input.observedEndpointUseCount === 0) {
    findings.push({
      level: 'fail',
      code: 'observed_endpoint_missing',
      detail: 'No non-seed observed endpoint reuse evidence was present.',
    });
  }
  if (input.seedOnlyProofCount > 0) {
    findings.push({
      level: 'fail',
      code: 'seed_only_proof',
      detail: `seedOnlyProofCount=${input.seedOnlyProofCount}`,
    });
  }
  if (input.privacyEvidenceCount === 0) {
    findings.push({
      level: 'fail',
      code: 'privacy_evidence_missing',
      detail: 'No privacyCheck evidence was present.',
    });
  }
  if (input.privacyFailureCount > 0) {
    findings.push({
      level: 'fail',
      code: 'privacy_failure_observed',
      detail: `privacyFailureCount=${input.privacyFailureCount}`,
    });
  }
  if (input.competitorBehindCount > 0) {
    findings.push({
      level: 'fail',
      code: 'competitor_speed_behind',
      detail: `competitorDeltaDistribution.behind=${input.competitorBehindCount}`,
    });
  }
  return findings;
}

function mapCompetitorDeltaDistribution(
  v26: Record<BenchmarkCompetitorDeltaV26, number>,
): BenchmarkCompetitorDeltaDistributionV27 {
  return {
    speed_lead: v26.lead ?? 0,
    near: v26.near ?? 0,
    behind: v26.behind ?? 0,
    blocked: v26.blocked ?? 0,
    resilience_win: v26.resilience_win ?? 0,
    not_compared: v26.not_compared ?? 0,
  };
}

function nonNegativeInteger(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value as number));
}
