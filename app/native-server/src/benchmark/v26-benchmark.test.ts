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
});
