import {
  BENCHMARK_REPORT_VERSION,
  V23_REPORT_VERSION,
  V24_REPORT_VERSION,
  V25_REPORT_VERSION,
  summariseBenchmarkRunV26,
  type BenchmarkRunInputV26,
  type BenchmarkToolCallRecordV26,
} from './v26-benchmark';
import {
  V26_GATE_A_GITHUB_SEARCH_SCENARIO_ID,
  V26_GATE_A_NPMJS_SEARCH_SCENARIO_ID,
  v26SearchListFastPathFixture,
} from './v26-search-list-fast-path-fixture';

function call(overrides: Partial<BenchmarkToolCallRecordV26> = {}): BenchmarkToolCallRecordV26 {
  return {
    seq: 0,
    scenarioId: 'T5-G-GH-REPO-NAV',
    toolName: 'chrome_click_element',
    status: 'ok',
    durationMs: 100,
    inputTokens: null,
    retryCount: 0,
    fallbackUsed: false,
    lane: 'tabrix_owned',
    startedAt: '2026-04-23T00:00:00.000Z',
    endedAt: '2026-04-23T00:00:00.100Z',
    component: 'mcp_tool',
    failureCode: null,
    waitedMs: 0,
    chosenSource: 'dom_json',
    ...overrides,
  };
}

function run(overrides: Partial<BenchmarkRunInputV26> = {}): BenchmarkRunInputV26 {
  return {
    runId: 'run-v26-1',
    runStartedAt: '2026-04-23T00:00:00Z',
    runEndedAt: '2026-04-23T00:05:00Z',
    buildSha: 'abcd1234',
    kpiScenarioIds: [],
    toolCalls: [],
    scenarios: [],
    pairs: [],
    ...overrides,
  };
}

describe('v26 benchmark transformer — version drift guard', () => {
  it('keeps independent report versions for v23/v24/v25/v26', () => {
    expect(BENCHMARK_REPORT_VERSION).toBe(1);
    expect(V23_REPORT_VERSION).toBe(1);
    expect(V24_REPORT_VERSION).toBe(1);
    expect(V25_REPORT_VERSION).toBe(1);
  });
});

describe('summariseBenchmarkRunV26 — empty input', () => {
  it('returns deterministic empty report (all aggregates null/empty)', () => {
    const summary = summariseBenchmarkRunV26(run());
    expect(summary.reportVersion).toBe(BENCHMARK_REPORT_VERSION);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.perTaskDurationMs).toEqual([]);
    expect(summary.perToolDurationMs).toEqual([]);
    expect(summary.unknownComponentRatio).toBeNull();
    expect(summary.totalWaitedMs).toBeNull();
    expect(summary.transformerWarnings).toEqual([]);
    expect(summary.componentDistribution).toEqual({
      mcp_tool: 0,
      native_handler: 0,
      extension_bridge: 0,
      page_snapshot: 0,
      unknown: 0,
    });
    expect(summary.failureCodeDistribution).toEqual({});
    expect(summary.chosenSourceDistribution).toEqual({
      experience_replay: 0,
      api_list: 0,
      api_detail: 0,
      markdown: 0,
      dom_json: 0,
      unknown: 0,
    });
    expect(summary.endpointSourceDistribution).toEqual({
      observed: 0,
      seed_adapter: 0,
      manual_seed: 0,
      unknown: 0,
    });
    // V26-FIX-08 — empty input produces empty per-scenario latency
    // and a `null` direct-api ratio (so legacy v25 NDJSON does not
    // pollute the ratio with a 0/0).
    expect(summary.perScenarioLatency).toEqual([]);
    expect(summary.directApiPathRatio).toBeNull();
    expect(summary.foregroundObserveCount).toBe(0);
    // v25 surface is fully populated even when v26 input is empty.
    expect(summary.v25Summary.reportVersion).toBe(1);
    expect(summary.v25Summary.totalToolCalls).toBe(0);
  });
});

describe('summariseBenchmarkRunV26 — single record happy path', () => {
  it('aggregates one fully-populated record into all v26 buckets', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [call({ durationMs: 250, waitedMs: 75, chosenSource: 'experience_replay' })],
        scenarios: [{ scenarioId: 'T5-G-GH-REPO-NAV', completed: true }],
      }),
    );
    expect(summary.totalToolCalls).toBe(1);
    expect(summary.unknownComponentRatio).toBe(0);
    expect(summary.componentDistribution.mcp_tool).toBe(1);
    expect(summary.perTaskDurationMs).toEqual([
      { key: 'T5-G-GH-REPO-NAV', count: 1, sumMs: 250, p50Ms: 250, p95Ms: 250 },
    ]);
    expect(summary.perToolDurationMs).toEqual([
      { key: 'chrome_click_element', count: 1, sumMs: 250, p50Ms: 250, p95Ms: 250 },
    ]);
    expect(summary.totalWaitedMs).toBe(75);
    expect(summary.chosenSourceDistribution.experience_replay).toBe(1);
    expect(summary.transformerWarnings).toEqual([]);
  });

  it('aggregates explicit operation-log evidence into a write rate', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, operationLogWritten: true }),
          call({ seq: 1, operationLogWritten: true }),
          call({ seq: 2, operationLogWritten: false }),
          call({ seq: 3, operationLogWritten: null }),
        ],
      }),
    );
    expect(summary.operationLogWriteRate).toBeCloseTo(2 / 3);
  });
});

describe('summariseBenchmarkRunV26 — fail-shape contract', () => {
  it('flags negative durationMs as malformed_duration and excludes from latency aggregates', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, durationMs: 100 }),
          call({ seq: 1, durationMs: -42, toolName: 'chrome_navigate' }),
        ],
        scenarios: [{ scenarioId: 'T5-G-GH-REPO-NAV', completed: true }],
      }),
    );
    expect(summary.totalToolCalls).toBe(2);
    // chrome_navigate should be absent from perToolDurationMs because
    // its only sample was malformed.
    expect(summary.perToolDurationMs.map((b) => b.key)).toEqual(['chrome_click_element']);
    expect(summary.perToolDurationMs[0].count).toBe(1);
    expect(summary.transformerWarnings).toContainEqual(
      expect.objectContaining({
        code: 'malformed_duration',
        seq: 1,
        toolName: 'chrome_navigate',
      }),
    );
  });

  it('flags missing timestamps but still aggregates latency from durationMs', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [call({ seq: 7, startedAt: undefined, endedAt: undefined, durationMs: 50 })],
      }),
    );
    expect(summary.perToolDurationMs[0].sumMs).toBe(50);
    expect(summary.transformerWarnings).toContainEqual(
      expect.objectContaining({ code: 'missing_timestamps', seq: 7 }),
    );
  });

  it('does not warn when only one of startedAt/endedAt is present', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 7, startedAt: '2026-04-23T00:00:00Z', endedAt: undefined }),
          call({ seq: 8, startedAt: undefined, endedAt: '2026-04-23T00:00:00.100Z' }),
        ],
      }),
    );
    expect(summary.transformerWarnings).toEqual([]);
  });
});

describe('summariseBenchmarkRunV26 — component bucketing', () => {
  it('mixes known and unknown components into componentDistribution', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, component: 'mcp_tool' }),
          call({ seq: 1, component: 'native_handler' }),
          call({ seq: 2, component: 'extension_bridge' }),
          call({ seq: 3, component: 'page_snapshot' }),
          call({ seq: 4, component: undefined }),
          call({ seq: 5, component: 'bogus_component' }),
        ],
      }),
    );
    expect(summary.componentDistribution).toEqual({
      mcp_tool: 1,
      native_handler: 1,
      extension_bridge: 1,
      page_snapshot: 1,
      unknown: 2,
    });
    expect(summary.unknownComponentRatio).toBeCloseTo(2 / 6);
    // Only `bogus_component` (seq=5) generates an `invalid_component`
    // warning — `undefined` is normal for legacy v25 NDJSON.
    const invalidComponentWarnings = summary.transformerWarnings.filter(
      (w) => w.code === 'invalid_component',
    );
    expect(invalidComponentWarnings).toHaveLength(1);
    expect(invalidComponentWarnings[0].seq).toBe(5);
  });

  it('reaches unknownComponentRatio = 1 when no record sets a component', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [call({ seq: 0, component: undefined }), call({ seq: 1, component: undefined })],
      }),
    );
    expect(summary.unknownComponentRatio).toBe(1);
    expect(summary.componentDistribution.unknown).toBe(2);
  });
});

describe('summariseBenchmarkRunV26 — per-tool and per-task latency', () => {
  it('produces sorted per-tool latency with p50/p95 across multiple tools', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, toolName: 'chrome_click_element', durationMs: 100 }),
          call({ seq: 1, toolName: 'chrome_click_element', durationMs: 300 }),
          call({ seq: 2, toolName: 'chrome_click_element', durationMs: 500 }),
          call({ seq: 3, toolName: 'chrome_navigate', durationMs: 80 }),
        ],
      }),
    );
    // Sorted ascending by toolName.
    expect(summary.perToolDurationMs.map((b) => b.key)).toEqual([
      'chrome_click_element',
      'chrome_navigate',
    ]);
    const click = summary.perToolDurationMs[0];
    expect(click.count).toBe(3);
    expect(click.sumMs).toBe(900);
    expect(click.p50Ms).toBe(300);
    expect(click.p95Ms).toBe(500);
  });

  it('produces sorted per-task latency keyed by scenarioId', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, scenarioId: 'T-B', durationMs: 100 }),
          call({ seq: 1, scenarioId: 'T-A', durationMs: 200 }),
          call({ seq: 2, scenarioId: 'T-A', durationMs: 400 }),
        ],
      }),
    );
    expect(summary.perTaskDurationMs.map((b) => b.key)).toEqual(['T-A', 'T-B']);
    expect(summary.perTaskDurationMs[0].count).toBe(2);
    expect(summary.perTaskDurationMs[0].p50Ms).toBe(300);
  });
});

describe('summariseBenchmarkRunV26 — failure & wait aggregation', () => {
  it('accumulates failureCode distribution and totalWaitedMs', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, status: 'failed', failureCode: 'verifier_timeout', waitedMs: 50 }),
          call({ seq: 1, status: 'failed', failureCode: 'verifier_timeout', waitedMs: 25 }),
          call({ seq: 2, status: 'failed', failureCode: 'bridge_disconnect', waitedMs: 10 }),
          call({ seq: 3, failureCode: null, waitedMs: null }),
        ],
      }),
    );
    expect(summary.failureCodeDistribution).toEqual({
      verifier_timeout: 2,
      bridge_disconnect: 1,
    });
    expect(summary.totalWaitedMs).toBe(85);
  });
});

describe('summariseBenchmarkRunV26 — chosenSource distribution', () => {
  it('counts known sources and buckets unknown values', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, chosenSource: 'experience_replay' }),
          call({ seq: 1, chosenSource: 'api_list' }),
          call({ seq: 2, chosenSource: 'api_detail' }),
          call({ seq: 3, chosenSource: 'markdown' }),
          call({ seq: 4, chosenSource: 'dom_json' }),
          call({ seq: 5, chosenSource: 'mystery_source' }),
          call({ seq: 6, chosenSource: undefined }),
        ],
      }),
    );
    expect(summary.chosenSourceDistribution).toEqual({
      experience_replay: 1,
      api_list: 1,
      api_detail: 1,
      markdown: 1,
      dom_json: 1,
      unknown: 1,
    });
    const invalid = summary.transformerWarnings.filter((w) => w.code === 'invalid_chosen_source');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].seq).toBe(5);
  });
});

describe('summariseBenchmarkRunV26 — endpointSource distribution (V26-FIX-05)', () => {
  it('counts observed/seed_adapter/manual_seed values and buckets unknown values', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({
            seq: 0,
            toolName: 'chrome_read_page',
            kind: 'api_rows',
            chosenSource: 'api_list',
            endpointSource: 'observed',
          }),
          call({
            seq: 1,
            toolName: 'chrome_read_page',
            kind: 'api_rows',
            chosenSource: 'api_list',
            endpointSource: 'seed_adapter',
          }),
          call({
            seq: 2,
            toolName: 'chrome_read_page',
            kind: 'api_rows',
            chosenSource: 'api_list',
            endpointSource: 'manual_seed',
          }),
          call({ seq: 3, endpointSource: 'mystery_lineage' }),
          // Calls without endpointSource (legacy v25 NDJSON) are NOT
          // counted into `unknown` — the bucket is reserved for
          // explicit-but-invalid values, mirroring chosenSource.
          call({ seq: 4, endpointSource: undefined }),
          call({ seq: 5, endpointSource: null }),
        ],
      }),
    );
    expect(summary.endpointSourceDistribution).toEqual({
      observed: 1,
      seed_adapter: 1,
      manual_seed: 1,
      unknown: 1,
    });
    const invalid = summary.transformerWarnings.filter((w) => w.code === 'invalid_endpoint_source');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].seq).toBe(3);
  });

  it('does not warn for legacy v25 records that omit endpointSource', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, endpointSource: undefined }),
          call({ seq: 1, endpointSource: null }),
        ],
      }),
    );
    expect(
      summary.transformerWarnings.filter((w) => w.code === 'invalid_endpoint_source'),
    ).toHaveLength(0);
  });

  it('aggregates an observed-endpoint fixture path distinctly from seed_adapter', () => {
    // observed-only fixture — every API row was emitted by the FIX-03
    // network-observe classifier (e.g. hackernews search). The
    // transformer must NOT bucket these into seed_adapter even when
    // the dispatcherInputSource is api_knowledge.
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({
            seq: 0,
            toolName: 'chrome_read_page',
            kind: 'api_rows',
            chosenSource: 'api_list',
            sourceKind: 'api_list',
            sourceRoute: 'knowledge_supported_read',
            dispatcherInputSource: 'api_knowledge',
            endpointSource: 'observed',
            readPageAvoided: true,
            tokensSavedEstimate: 200,
          }),
          call({
            seq: 1,
            toolName: 'chrome_read_page',
            kind: 'api_rows',
            chosenSource: 'api_list',
            sourceKind: 'api_list',
            sourceRoute: 'knowledge_supported_read',
            dispatcherInputSource: 'api_knowledge',
            endpointSource: 'observed',
            readPageAvoided: true,
            tokensSavedEstimate: 250,
          }),
        ],
      }),
    );
    expect(summary.endpointSourceDistribution.observed).toBe(2);
    expect(summary.endpointSourceDistribution.seed_adapter).toBe(0);
    expect(summary.endpointSourceDistribution.manual_seed).toBe(0);
    expect(summary.endpointSourceDistribution.unknown).toBe(0);
  });
});

describe('summariseBenchmarkRunV26 — back-compat with v25 NDJSON', () => {
  it('parses v25-only records without v26 fields and treats them as unknown', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          // Legacy v25 record: no startedAt/endedAt/component/failureCode/waitedMs/chosenSource.
          {
            seq: 0,
            scenarioId: 'T-LEGACY',
            toolName: 'chrome_click_element',
            status: 'ok',
            durationMs: 100,
            inputTokens: null,
            retryCount: 0,
            fallbackUsed: false,
            lane: 'tabrix_owned',
          },
        ],
      }),
    );
    expect(summary.totalToolCalls).toBe(1);
    expect(summary.componentDistribution.unknown).toBe(1);
    expect(summary.unknownComponentRatio).toBe(1);
    // v25 surface still works — back-compat carry-forward.
    expect(summary.v25Summary.totalToolCalls).toBe(1);
    expect(summary.perToolDurationMs[0].sumMs).toBe(100);
    // Missing-timestamps warning is expected for the legacy record.
    expect(summary.transformerWarnings).toContainEqual(
      expect.objectContaining({ code: 'missing_timestamps', seq: 0 }),
    );
  });
});

describe('summariseBenchmarkRunV26 — determinism', () => {
  it('produces identical output for re-runs with the same input', () => {
    const input = run({
      toolCalls: [
        call({ seq: 0, durationMs: 100 }),
        call({ seq: 1, durationMs: 200 }),
        call({ seq: 2, durationMs: -1 }),
        call({ seq: 3, component: 'bogus' }),
      ],
      scenarios: [{ scenarioId: 'T5-G-GH-REPO-NAV', completed: true }],
    });
    const a = summariseBenchmarkRunV26(input);
    const b = summariseBenchmarkRunV26(input);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    // Warnings are sorted deterministically by (code, seq).
    const warningPairs = a.transformerWarnings.map((w) => [w.code, w.seq ?? -1]);
    const sortedPairs = [...warningPairs].sort((x, y) => {
      const c = String(x[0]).localeCompare(String(y[0]));
      if (c !== 0) return c;
      return Number(x[1]) - Number(y[1]);
    });
    expect(warningPairs).toEqual(sortedPairs);
  });
});

describe('summariseBenchmarkRunV26 — v25 surface preservation', () => {
  it('does not alter v25 summary fields when the v26 input is the same shape as v25 input', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({
            seq: 0,
            chosenLayer: 'L0',
            tokenEstimateChosen: 100,
            tokenEstimateFullRead: 1000,
            sourceRoute: 'experience_replay_skip_read',
            readPageAvoided: true,
          }),
        ],
        scenarios: [{ scenarioId: 'T5-G-GH-REPO-NAV', completed: true }],
      }),
    );
    expect(summary.v25Summary.layerMetrics.chosenLayerDistribution.L0).toBe(1);
    expect(summary.v25Summary.layerMetrics.l0TokenRatioMedian).toBeCloseTo(0.1);
    expect(summary.v25Summary.layerMetrics.tokensSavedEstimateTotal).toBe(900);
    expect(summary.v25Summary.layerMetrics.readPageAvoidedCount).toBe(1);
    expect(
      summary.v25Summary.layerMetrics.sourceRouteDistribution.experience_replay_skip_read,
    ).toBe(1);
  });
});

describe('v26 search/list fast-path fixture', () => {
  it('keeps Gate A API search scenario ids visible and avoids DOM read_page records', () => {
    const summary = summariseBenchmarkRunV26(v26SearchListFastPathFixture());

    expect(summary.v25Summary.scenarioSummaries.map((s) => s.scenarioId).sort()).toEqual([
      V26_GATE_A_GITHUB_SEARCH_SCENARIO_ID,
      V26_GATE_A_NPMJS_SEARCH_SCENARIO_ID,
    ]);
    expect(summary.chosenSourceDistribution.api_list).toBe(2);
    expect(summary.v25Summary.layerMetrics.readPageAvoidedCount).toBe(2);
    expect(summary.v25Summary.layerMetrics.tokensSavedEstimateTotal).toBeGreaterThan(0);
    expect(summary.v25Summary.layerMetrics.sourceRouteDistribution.knowledge_supported_read).toBe(
      2,
    );
  });

  it('emits Gate A summary fields without presenting the fixture as real benchmark evidence', () => {
    const summary = summariseBenchmarkRunV26(v26SearchListFastPathFixture());

    expect(summary.evidenceKind).toBe('fixture');
    expect(summary.evidenceStatus).toBe('pass');
    expect(summary.evidenceFindings).toEqual([]);
    expect(summary.readPageAvoidedCount).toBe(2);
    expect(summary.tokensSavedEstimateTotal).toBe(2340);
    expect(summary.layerDistribution.L0).toBe(2);
    expect(summary.dispatcherInputSourceDistribution).toEqual({ api_knowledge: 2 });
    expect(summary.apiKnowledgeHitRate).toBe(1);
    expect(summary.fallbackDistribution).toEqual({});
    expect(summary.medianDuration).toBe(40.5);
    expect(summary.readPageCount).toBe(0);
    expect(summary.primaryTabReuseRate).toBe(1);
    expect(summary.maxConcurrentBenchmarkTabs).toBe(1);
  });
});

describe('summariseBenchmarkRunV26 — layer evidence closeout metrics', () => {
  it('consumes V26-03 skip-read taskTotals even when token estimates are absent', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({
            toolName: 'chrome_read_page',
            kind: 'read_page_skipped',
            chosenSource: 'experience_replay',
            sourceKind: 'experience_replay',
            readPageAvoided: true,
            tokenEstimateChosen: undefined,
            tokenEstimateFullRead: undefined,
            taskTotals: {
              readPageAvoidedCount: 1,
              tokensSavedEstimateTotal: 900,
            },
          }),
        ],
      }),
    );

    expect(summary.readPageAvoidedCount).toBe(1);
    expect(summary.tokensSavedEstimateTotal).toBe(900);
  });

  it('consumes top-level api_rows tokensSavedEstimate from real NDJSON payloads', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({
            toolName: 'chrome_read_page',
            kind: 'api_rows',
            chosenSource: 'api_list',
            sourceKind: 'api_list',
            sourceRoute: 'knowledge_supported_read',
            dispatcherInputSource: 'api_knowledge',
            apiFamily: 'github_search_repositories',
            apiTelemetry: {
              endpointFamily: 'github_search_repositories',
              status: 'ok',
              reason: 'api_rows',
              httpStatus: 200,
              fallbackEntryLayer: 'none',
            },
            readPageAvoided: true,
            tokenEstimateChosen: undefined,
            tokenEstimateFullRead: undefined,
            tokensSavedEstimate: 321,
          }),
        ],
      }),
    );

    expect(summary.readPageAvoidedCount).toBe(1);
    expect(summary.tokensSavedEstimateTotal).toBe(321);
    expect(summary.evidenceFindings.map((finding) => finding.code)).not.toContain(
      'tokens_saved_zero',
    );
  });

  it('consumes V26-07 API fallback telemetry and still counts the DOM read_page fallback', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({
            toolName: 'chrome_read_page',
            kind: 'read_page_api_fallback',
            chosenSource: 'dom_json',
            dispatcherInputSource: 'api_knowledge',
            apiFamily: 'github_search_repositories',
            apiTelemetry: {
              endpointFamily: 'github_search_repositories',
              status: 'fallback',
              reason: 'rate_limited',
              httpStatus: 403,
              fallbackEntryLayer: 'L0+L1',
            },
            readPageAvoided: false,
          }),
        ],
      }),
    );

    expect(summary.apiKnowledgeHitRate).toBe(0);
    expect(summary.fallbackDistribution).toEqual({ rate_limited: 1 });
    expect(summary.readPageCount).toBe(1);
    expect(summary.dispatcherInputSourceDistribution).toEqual({ api_knowledge: 1 });
  });

  it('fails loudly when V26 API/read avoidance/token-saving evidence is missing or zero', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [call({ toolName: 'chrome_read_page', chosenSource: 'dom_json' })],
      }),
    );

    expect(summary.evidenceStatus).toBe('fail');
    expect(summary.evidenceFindings.map((finding) => finding.code)).toEqual([
      'missing_v26_api_evidence',
      'read_page_avoided_zero',
      'tokens_saved_zero',
      'tab_hygiene_missing',
      'dispatcher_input_source_missing',
      // V26-FIX-08 — observed scenario without a configured latency
      // budget surfaces as `'warn'` (anti-silent rule). The
      // dominant fail-level findings still drive evidenceStatus to
      // `'fail'`, but the warning is preserved for visibility.
      'latency_gate_warning',
    ]);
    expect(summary.readPageAvoidedCount).toBe(0);
    expect(summary.tokensSavedEstimateTotal).toBe(0);
  });
});

describe('summariseBenchmarkRunV26 — V26-FIX-08 latency gate', () => {
  it('emits pass when median is at or below the configured budget', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, scenarioId: 'T-FAST', durationMs: 100 }),
          call({ seq: 1, scenarioId: 'T-FAST', durationMs: 200 }),
          call({ seq: 2, scenarioId: 'T-FAST', durationMs: 300 }),
        ],
        latencyBudgetsMs: { 'T-FAST': 250 },
      }),
    );
    const fast = summary.perScenarioLatency.find((entry) => entry.scenarioId === 'T-FAST');
    expect(fast).toBeDefined();
    expect(fast?.medianMs).toBe(200);
    expect(fast?.minMs).toBe(100);
    expect(fast?.maxMs).toBe(300);
    expect(fast?.budgetMs).toBe(250);
    expect(fast?.latencyGateStatus).toBe('pass');
    expect(
      summary.evidenceFindings.find((finding) => finding.code === 'latency_gate_failed'),
    ).toBeUndefined();
  });

  it('emits warn when the median is over budget but under the 1.25x fail multiplier', () => {
    // 300 ms / 250 ms budget = 1.20x → warn (over budget, under 1.25x).
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, scenarioId: 'T-EDGE', durationMs: 250 }),
          call({ seq: 1, scenarioId: 'T-EDGE', durationMs: 300 }),
          call({ seq: 2, scenarioId: 'T-EDGE', durationMs: 350 }),
        ],
        latencyBudgetsMs: { 'T-EDGE': 250 },
      }),
    );
    const edge = summary.perScenarioLatency.find((entry) => entry.scenarioId === 'T-EDGE');
    expect(edge?.medianMs).toBe(300);
    expect(edge?.latencyGateStatus).toBe('warn');
    const warning = summary.evidenceFindings.find(
      (finding) => finding.code === 'latency_gate_warning',
    );
    expect(warning).toBeDefined();
    expect(warning?.level).toBe('warn');
    expect(warning?.detail).toContain('T-EDGE');
  });

  it('emits fail when the median exceeds 1.25x the budget and surfaces a fail-level finding', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, scenarioId: 'T-SLOW', durationMs: 800 }),
          call({ seq: 1, scenarioId: 'T-SLOW', durationMs: 1200 }),
          call({ seq: 2, scenarioId: 'T-SLOW', durationMs: 1600 }),
        ],
        latencyBudgetsMs: { 'T-SLOW': 500 },
      }),
    );
    const slow = summary.perScenarioLatency.find((entry) => entry.scenarioId === 'T-SLOW');
    expect(slow?.medianMs).toBe(1200);
    expect(slow?.latencyGateStatus).toBe('fail');
    const failing = summary.evidenceFindings.find(
      (finding) => finding.code === 'latency_gate_failed',
    );
    expect(failing).toBeDefined();
    expect(failing?.level).toBe('fail');
    expect(failing?.detail).toContain('T-SLOW');
    // V26-FIX-08 anti-silent rule: a failed scenario flips
    // evidenceStatus to 'fail' so any consumer that already gates on
    // evidenceStatus refuses to ship.
    expect(summary.evidenceStatus).toBe('fail');
  });

  it('emits warn (never silent pass) when no budget is configured for an observed scenario', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, scenarioId: 'T-UNCONFIGURED', durationMs: 100 }),
          call({ seq: 1, scenarioId: 'T-UNCONFIGURED', durationMs: 100 }),
        ],
      }),
    );
    const entry = summary.perScenarioLatency.find((item) => item.scenarioId === 'T-UNCONFIGURED');
    expect(entry?.budgetMs).toBeNull();
    expect(entry?.latencyGateStatus).toBe('warn');
  });

  it('emits warn (never silent pass) when a budgeted scenario has no observed median', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [],
        latencyBudgetsMs: { 'T-NO-DATA': 500 },
      }),
    );
    const entry = summary.perScenarioLatency.find((item) => item.scenarioId === 'T-NO-DATA');
    expect(entry).toBeDefined();
    expect(entry?.count).toBe(0);
    expect(entry?.medianMs).toBeNull();
    expect(entry?.latencyGateStatus).toBe('warn');
  });

  it('rejects non-finite or non-positive budgets and treats them as missing', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [call({ seq: 0, scenarioId: 'T-BAD-BUDGET', durationMs: 100 })],
        latencyBudgetsMs: { 'T-BAD-BUDGET': 0 },
      }),
    );
    const entry = summary.perScenarioLatency.find((item) => item.scenarioId === 'T-BAD-BUDGET');
    expect(entry?.budgetMs).toBeNull();
    expect(entry?.latencyGateStatus).toBe('warn');
  });
});

describe('summariseBenchmarkRunV26 — V26-FIX-08 competitor delta', () => {
  it('marks lead/near/behind based on the ±10% threshold around competitor median', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, scenarioId: 'T-LEAD', durationMs: 100 }),
          call({ seq: 1, scenarioId: 'T-NEAR', durationMs: 100 }),
          call({ seq: 2, scenarioId: 'T-BEHIND', durationMs: 100 }),
        ],
        competitorBaselines: {
          'T-LEAD': { medianMs: 200 }, // 100 / 200 = 0.5 < 0.9 → lead
          'T-NEAR': { medianMs: 100 }, // 100 / 100 = 1.0 → near
          'T-BEHIND': { medianMs: 50 }, // 100 / 50 = 2.0 > 1.1 → behind
        },
      }),
    );
    const byId = (id: string) =>
      summary.perScenarioLatency.find((entry) => entry.scenarioId === id);
    expect(byId('T-LEAD')?.competitorDelta).toBe('lead');
    expect(byId('T-LEAD')?.competitorMedianMs).toBe(200);
    expect(byId('T-NEAR')?.competitorDelta).toBe('near');
    expect(byId('T-BEHIND')?.competitorDelta).toBe('behind');
  });

  it('emits resilience_win for npmjs Cloudflare-style scenarios and skips speed comparison', () => {
    // Even though Tabrix is "slower" by latency, the scenario is
    // judged on resilience (we got through where the competitor was
    // blocked), so the delta is `'resilience_win'` regardless of
    // observed/competitor medians.
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, scenarioId: 'T-NPMJS-CLOUDFLARE', durationMs: 5000 }),
          call({ seq: 1, scenarioId: 'T-NPMJS-CLOUDFLARE', durationMs: 6000 }),
        ],
        competitorBaselines: {
          'T-NPMJS-CLOUDFLARE': { medianMs: 1000, mode: 'resilience_win' },
        },
      }),
    );
    const entry = summary.perScenarioLatency.find(
      (item) => item.scenarioId === 'T-NPMJS-CLOUDFLARE',
    );
    expect(entry?.competitorDelta).toBe('resilience_win');
    expect(entry?.competitorMedianMs).toBe(1000);
  });

  it('emits not_compared when no competitor baseline is provided', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [call({ seq: 0, scenarioId: 'T-SOLO', durationMs: 100 })],
      }),
    );
    const entry = summary.perScenarioLatency.find((item) => item.scenarioId === 'T-SOLO');
    expect(entry?.competitorDelta).toBe('not_compared');
    expect(entry?.competitorMedianMs).toBeNull();
  });

  it('emits blocked when competitor baseline is configured but the comparison is impossible', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [],
        competitorBaselines: {
          'T-NO-OBSERVATION': { medianMs: 1000 },
          'T-NEGATIVE-COMP': { medianMs: -1 },
        },
      }),
    );
    const noObs = summary.perScenarioLatency.find((item) => item.scenarioId === 'T-NO-OBSERVATION');
    const neg = summary.perScenarioLatency.find((item) => item.scenarioId === 'T-NEGATIVE-COMP');
    expect(noObs?.competitorDelta).toBe('blocked');
    expect(neg?.competitorDelta).toBe('blocked');
  });
});

describe('summariseBenchmarkRunV26 — V26-FIX-08 directApiPathRatio + foregroundObserveCount', () => {
  it('computes directApiPathRatio over records that set executionMode and ignores legacy records', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, executionMode: 'direct_api' }),
          call({ seq: 1, executionMode: 'direct_api' }),
          call({ seq: 2, executionMode: 'via_read_page' }),
          call({ seq: 3, executionMode: 'via_read_page' }),
          // Legacy / unrecognised values are NOT counted in either
          // numerator or denominator, so missing telemetry never
          // silently inflates the ratio.
          call({ seq: 4, executionMode: undefined }),
          call({ seq: 5, executionMode: 'mystery_mode' }),
        ],
      }),
    );
    expect(summary.directApiPathRatio).toBeCloseTo(0.5);
    const invalid = summary.transformerWarnings.filter(
      (warning) => warning.code === 'invalid_execution_mode',
    );
    expect(invalid).toHaveLength(1);
    expect(invalid[0].seq).toBe(5);
  });

  it('returns null directApiPathRatio when no record sets executionMode', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [call({ seq: 0 }), call({ seq: 1 })],
      }),
    );
    expect(summary.directApiPathRatio).toBeNull();
  });

  it('counts foregroundObserveCount and warns on invalid observeMode values', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          call({ seq: 0, observeMode: 'foreground' }),
          call({ seq: 1, observeMode: 'foreground' }),
          call({ seq: 2, observeMode: 'background' }),
          call({ seq: 3, observeMode: 'disabled' }),
          call({ seq: 4, observeMode: undefined }),
          call({ seq: 5, observeMode: 'mystery_mode' }),
        ],
      }),
    );
    expect(summary.foregroundObserveCount).toBe(2);
    const invalid = summary.transformerWarnings.filter(
      (warning) => warning.code === 'invalid_observe_mode',
    );
    expect(invalid).toHaveLength(1);
    expect(invalid[0].seq).toBe(5);
  });
});

describe('summariseBenchmarkRunV26 — V26-FIX-08 fixture coverage (pass / boundary / fail)', () => {
  it('produces deterministic per-scenario verdicts across pass/boundary/fail in one run', () => {
    const summary = summariseBenchmarkRunV26(
      run({
        toolCalls: [
          // Pass scenario.
          call({ seq: 0, scenarioId: 'T-A-PASS', durationMs: 100, executionMode: 'direct_api' }),
          call({ seq: 1, scenarioId: 'T-A-PASS', durationMs: 200, executionMode: 'direct_api' }),
          call({ seq: 2, scenarioId: 'T-A-PASS', durationMs: 300, executionMode: 'direct_api' }),
          // Boundary scenario (over budget but under 1.25x).
          call({
            seq: 3,
            scenarioId: 'T-B-BOUNDARY',
            durationMs: 260,
            executionMode: 'via_read_page',
          }),
          call({
            seq: 4,
            scenarioId: 'T-B-BOUNDARY',
            durationMs: 280,
            executionMode: 'via_read_page',
          }),
          call({
            seq: 5,
            scenarioId: 'T-B-BOUNDARY',
            durationMs: 290,
            executionMode: 'via_read_page',
          }),
          // Fail scenario.
          call({ seq: 6, scenarioId: 'T-C-FAIL', durationMs: 1500, executionMode: 'direct_api' }),
          call({ seq: 7, scenarioId: 'T-C-FAIL', durationMs: 1600, executionMode: 'direct_api' }),
          call({ seq: 8, scenarioId: 'T-C-FAIL', durationMs: 1700, executionMode: 'direct_api' }),
          // Resilience-win scenario (Cloudflare-style; latency irrelevant).
          call({
            seq: 9,
            scenarioId: 'T-D-RESILIENCE',
            durationMs: 5000,
            executionMode: 'direct_api',
          }),
        ],
        latencyBudgetsMs: {
          'T-A-PASS': 250,
          'T-B-BOUNDARY': 250,
          'T-C-FAIL': 500,
          'T-D-RESILIENCE': 500,
        },
        competitorBaselines: {
          'T-A-PASS': { medianMs: 250 },
          'T-B-BOUNDARY': { medianMs: 200 },
          'T-C-FAIL': { medianMs: 600 },
          'T-D-RESILIENCE': { medianMs: 1000, mode: 'resilience_win' },
        },
      }),
    );
    expect(summary.perScenarioLatency.map((entry) => entry.scenarioId)).toEqual([
      'T-A-PASS',
      'T-B-BOUNDARY',
      'T-C-FAIL',
      'T-D-RESILIENCE',
    ]);
    const byId = (id: string) =>
      summary.perScenarioLatency.find((entry) => entry.scenarioId === id);
    expect(byId('T-A-PASS')?.latencyGateStatus).toBe('pass');
    expect(byId('T-B-BOUNDARY')?.latencyGateStatus).toBe('warn');
    expect(byId('T-C-FAIL')?.latencyGateStatus).toBe('fail');
    expect(byId('T-D-RESILIENCE')?.competitorDelta).toBe('resilience_win');
    expect(summary.evidenceStatus).toBe('fail');
    expect(summary.directApiPathRatio).toBeCloseTo(7 / 10);
  });
});
