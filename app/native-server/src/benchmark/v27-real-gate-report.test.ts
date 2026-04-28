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
    expect(JSON.stringify(report).toLowerCase()).not.toContain('release ready');
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
