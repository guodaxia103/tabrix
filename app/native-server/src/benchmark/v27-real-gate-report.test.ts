import { buildPublicSafeV27GateReport } from './v27-real-gate-report';

describe('buildPublicSafeV27GateReport — V27-16', () => {
  it('builds a PASS report from fixture-neutral public-safe sections', () => {
    const report = buildPublicSafeV27GateReport({
      runId: 'fixture-run',
      generatedAt: '2026-04-28T00:00:00.000Z',
      sections: [
        {
          id: 'api_success',
          status: 'PASS',
          summary: 'API success path produced compact rows.',
          evidence: { rowCount: 2, source: 'observed' },
        },
        {
          id: 'privacy_evidence',
          status: 'PASS',
          summary: 'Privacy evidence was present and passed.',
          evidence: { privacyCheck: 'passed' },
        },
      ],
    });

    expect(report.overallStatus).toBe('PASS');
    expect(report.releaseReadiness).toBe('not_assessed');
    expect(report.realPlatformGate).toBeNull();
    expect(report.competitorDeltaGate).toBeNull();
    expect(JSON.stringify(report).toLowerCase()).not.toContain('release ready');
  });

  it('adds public-safe real platform gate counters without release readiness', () => {
    const report = buildPublicSafeV27GateReport({
      runId: 'fixture-real-platform',
      generatedAt: '2026-04-29T00:00:00.000Z',
      realPlatformGate: {
        xhsSearchTop10RowsPass: 'BLOCKED',
        githubSearchRowsPass: 'PASS',
        douyinSearchRowsPass: 'not_run',
        domRegionRowsUsedCount: 2,
        apiRowsUsedCount: 1,
        failureReasonDistribution: {
          dom_region_rows_unavailable: 1,
          'api timeout fallback': 2,
        },
        sensitivePersistedCount: 0,
      },
      sections: [
        {
          id: 'real_platform_gate',
          status: 'BLOCKED',
          summary: 'Public-safe counters only; release readiness is not assessed.',
        },
      ],
    });

    expect(report.overallStatus).toBe('BLOCKED');
    expect(report.releaseReadiness).toBe('not_assessed');
    expect(report.realPlatformGate).toEqual({
      scope: 'public_safe_real_platform_gate',
      xhsSearchTop10RowsPass: 'BLOCKED',
      githubSearchRowsPass: 'PASS',
      douyinSearchRowsPass: 'not_run',
      domRegionRowsUsedCount: 2,
      apiRowsUsedCount: 1,
      failureReasonDistribution: {
        dom_region_rows_unavailable: 1,
        api_timeout_fallback: 2,
      },
      sensitivePersistedCount: 0,
    });
  });

  it('adds public-safe competitor delta evidence with closed conclusions', () => {
    const report = buildPublicSafeV27GateReport({
      runId: 'fixture-competitor',
      generatedAt: '2026-04-29T00:00:00.000Z',
      competitorDeltaGate: {
        competitorDelta: 'quality_win',
        qualityDelta: 0.25,
        latencyDelta: -120.12345,
        refCoverageDelta: 0.4,
        blockedReason: null,
      },
      sections: [
        {
          id: 'competitor_delta_gate',
          status: 'PASS',
          summary: 'Closed enum competitor delta only.',
        },
      ],
    });

    expect(report.overallStatus).toBe('PASS');
    expect(report.competitorDeltaGate).toEqual({
      scope: 'public_safe_competitor_delta_gate',
      competitorDelta: 'quality_win',
      qualityDelta: 0.25,
      latencyDelta: -120.123,
      refCoverageDelta: 0.4,
      blockedReason: null,
    });
  });

  it('keeps blocked competitor reasons short and public-safe', () => {
    const report = buildPublicSafeV27GateReport({
      runId: 'fixture-competitor-blocked',
      generatedAt: '2026-04-29T00:00:00.000Z',
      competitorDeltaGate: {
        competitorDelta: 'blocked',
        qualityDelta: 0,
        latencyDelta: 0,
        refCoverageDelta: 0,
        blockedReason: 'login state missing / private scenario unavailable',
      },
      sections: [
        {
          id: 'competitor_delta_gate',
          status: 'BLOCKED',
          summary: 'Competitor evidence unavailable.',
        },
      ],
    });

    expect(report.overallStatus).toBe('BLOCKED');
    expect(report.competitorDeltaGate?.blockedReason).toBe(
      'login_state_missing___private_scenario_unavailable',
    );
  });

  it('derives FAIL and BLOCKED without collapsing them into release readiness', () => {
    const fail = buildPublicSafeV27GateReport({
      runId: 'fixture-fail',
      generatedAt: '2026-04-28T00:00:00.000Z',
      sections: [{ id: 'benchmark_gate', status: 'FAIL', summary: 'Benchmark gate failed.' }],
    });
    expect(fail.overallStatus).toBe('FAIL');

    const blocked = buildPublicSafeV27GateReport({
      runId: 'fixture-blocked',
      generatedAt: '2026-04-28T00:00:00.000Z',
      sections: [
        { id: 'api_timeout_fallback', status: 'BLOCKED', summary: 'Evidence was unavailable.' },
        { id: 'benchmark_gate', status: 'FAIL', summary: 'Benchmark gate failed.' },
      ],
    });
    expect(blocked.overallStatus).toBe('BLOCKED');
    expect(blocked.releaseReadiness).toBe('not_assessed');
  });

  it('rejects raw urls, query strings, and sensitive values in evidence', () => {
    expect(() =>
      buildPublicSafeV27GateReport({
        runId: 'fixture-unsafe',
        generatedAt: '2026-04-28T00:00:00.000Z',
        sections: [
          {
            id: 'api_success',
            status: 'PASS',
            summary: 'Unsafe raw evidence.',
            evidence: {
              url: 'https://example.test/search?q=private',
              token: '0123456789abcdef0123456789abcdef',
            },
          },
        ],
      }),
    ).toThrow(/unsafe evidence/);
  });
});
