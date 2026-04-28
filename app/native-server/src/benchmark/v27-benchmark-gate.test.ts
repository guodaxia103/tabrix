const { BENCHMARK_REPORT_VERSION_EXPECTED, evaluateBenchmarkGateV27 } =
  require('../../../../scripts/lib/v27-benchmark-gate.cjs') as {
    BENCHMARK_REPORT_VERSION_EXPECTED: number;
    evaluateBenchmarkGateV27: (summary: unknown) => string[];
  };

function passingSummary() {
  return {
    reportVersion: BENCHMARK_REPORT_VERSION_EXPECTED,
    evidenceStatus: 'pass',
    gateFindings: [],
    heavyPathCount: 0,
    sameTaskUseCount: 1,
    observedEndpointUseCount: 1,
    seedOnlyProofCount: 0,
    privacyEvidenceCount: 1,
    privacyFailureCount: 0,
    competitorDeltaDistribution: { behind: 0 },
  };
}

describe('v27 benchmark gate', () => {
  it('accepts a public-safe pass-shaped V27 report', () => {
    expect(evaluateBenchmarkGateV27(passingSummary())).toEqual([]);
  });

  it('rejects heavy path, seed-only proof, missing privacy evidence, and behind delta', () => {
    const reasons = evaluateBenchmarkGateV27({
      ...passingSummary(),
      evidenceStatus: 'fail',
      gateFindings: [{ level: 'fail', code: 'heavy_path_observed' }],
      heavyPathCount: 1,
      sameTaskUseCount: 0,
      observedEndpointUseCount: 0,
      seedOnlyProofCount: 1,
      privacyEvidenceCount: 0,
      privacyFailureCount: 1,
      competitorDeltaDistribution: { behind: 1 },
    });

    expect(reasons.join('\n')).toContain('heavyPathCount must be 0');
    expect(reasons.join('\n')).toContain('sameTaskUseCount below threshold');
    expect(reasons.join('\n')).toContain('observedEndpointUseCount below threshold');
    expect(reasons.join('\n')).toContain('seedOnlyProofCount must be 0');
    expect(reasons.join('\n')).toContain('privacyEvidenceCount below threshold');
    expect(reasons.join('\n')).toContain('privacyFailureCount must be 0');
    expect(reasons.join('\n')).toContain('competitorDeltaDistribution.behind=1');
  });
});
