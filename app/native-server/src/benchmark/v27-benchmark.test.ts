import {
  BENCHMARK_REPORT_VERSION,
  summariseBenchmarkRunV27,
  type BenchmarkRunInputV27,
  type BenchmarkToolCallRecordV27,
} from './v27-benchmark';

function call(overrides: Partial<BenchmarkToolCallRecordV27> = {}): BenchmarkToolCallRecordV27 {
  return {
    seq: 0,
    scenarioId: 'S-FAST',
    toolName: 'chrome_read_page',
    status: 'ok',
    durationMs: 100,
    inputTokens: null,
    retryCount: 0,
    fallbackUsed: false,
    lane: 'tabrix_owned',
    startedAt: '2026-04-28T00:00:00.000Z',
    endedAt: '2026-04-28T00:00:00.100Z',
    component: 'mcp_tool',
    chosenSource: 'api_list',
    kind: 'api_rows',
    sourceKind: 'api_list',
    sourceRoute: 'knowledge_supported_read',
    dispatcherInputSource: 'api_knowledge',
    endpointSource: 'observed',
    executionMode: 'direct_api',
    readPageAvoided: true,
    tokensSavedEstimate: 100,
    operationLogWritten: true,
    sameTaskLiveObservedUseCount: 1,
    nonSeedObservedEndpointUsedCount: 1,
    privacyCheck: 'passed',
    relevanceCheck: 'passed',
    ...overrides,
  };
}

function run(overrides: Partial<BenchmarkRunInputV27> = {}): BenchmarkRunInputV27 {
  return {
    runId: 'run-v27',
    runStartedAt: '2026-04-28T00:00:00Z',
    runEndedAt: '2026-04-28T00:01:00Z',
    buildSha: 'fixture',
    kpiScenarioIds: [],
    toolCalls: [call()],
    scenarios: [{ scenarioId: 'S-FAST', completed: true }],
    pairs: [],
    evidenceKind: 'fixture',
    competitorBaselines: {
      'S-FAST': { medianMs: 200, mode: 'speed' },
    },
    ...overrides,
  };
}

describe('summariseBenchmarkRunV27 — V27-15 gate evidence', () => {
  it('passes when heavy path is absent and observed/privacy evidence is present', () => {
    const summary = summariseBenchmarkRunV27(run());

    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    expect(summary.heavyPathCount).toBe(0);
    expect(summary.sameTaskUseCount).toBe(1);
    expect(summary.observedEndpointUseCount).toBe(1);
    expect(summary.privacyEvidenceCount).toBe(1);
    expect(summary.privacyFailureCount).toBe(0);
    expect(summary.competitorDeltaDistribution.speed_lead).toBe(1);
    expect(summary.competitorDeltaDistribution.resilience_win).toBe(0);
    expect(summary.evidenceStatus).toBe('pass');
    expect(summary.gateFindings).toEqual([]);
  });

  it('fails heavy path, missing same-task use, missing observed use, and seed-only proof', () => {
    const summary = summariseBenchmarkRunV27(
      run({
        toolCalls: [
          call({
            heavyPath: true,
            sameTaskLiveObservedUseCount: 0,
            nonSeedObservedEndpointUsedCount: 0,
            seedOnlyProof: true,
            endpointSource: 'seed_adapter',
          }),
        ],
      }),
    );

    expect(summary.evidenceStatus).toBe('fail');
    expect(summary.gateFindings.map((finding) => finding.code)).toEqual([
      'heavy_path_observed',
      'same_task_use_missing',
      'observed_endpoint_missing',
      'seed_only_proof',
    ]);
  });

  it('fails when privacy evidence is missing or failed', () => {
    const missing = summariseBenchmarkRunV27(
      run({ toolCalls: [call({ privacyCheck: undefined })] }),
    );
    expect(missing.gateFindings.map((finding) => finding.code)).toContain(
      'privacy_evidence_missing',
    );

    const failed = summariseBenchmarkRunV27(run({ toolCalls: [call({ privacyCheck: 'failed' })] }));
    expect(failed.gateFindings.map((finding) => finding.code)).toContain(
      'privacy_failure_observed',
    );
  });

  it('keeps speed_lead separate from resilience_win', () => {
    const summary = summariseBenchmarkRunV27(
      run({
        toolCalls: [
          call({ seq: 0, scenarioId: 'S-LEAD', durationMs: 100 }),
          call({ seq: 1, scenarioId: 'S-RES', durationMs: 1000 }),
        ],
        competitorBaselines: {
          'S-LEAD': { medianMs: 300, mode: 'speed' },
          'S-RES': { medianMs: 100, mode: 'resilience_win' },
        },
      }),
    );

    expect(summary.competitorDeltaDistribution.speed_lead).toBe(1);
    expect(summary.competitorDeltaDistribution.resilience_win).toBe(1);
    expect(summary.gateFindings.map((finding) => finding.code)).not.toContain(
      'competitor_speed_behind',
    );
  });

  it('fails when competitor speed delta is behind', () => {
    const summary = summariseBenchmarkRunV27(
      run({
        toolCalls: [call({ scenarioId: 'S-BEHIND', durationMs: 300 })],
        competitorBaselines: {
          'S-BEHIND': { medianMs: 100, mode: 'speed' },
        },
      }),
    );

    expect(summary.competitorDeltaDistribution.behind).toBe(1);
    expect(summary.gateFindings.map((finding) => finding.code)).toContain(
      'competitor_speed_behind',
    );
  });
});
