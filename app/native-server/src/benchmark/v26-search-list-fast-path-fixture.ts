import type { BenchmarkRunInputV26, BenchmarkToolCallRecordV26 } from './v26-benchmark';

export const V26_GATE_A_GITHUB_SEARCH_SCENARIO_ID = 'V26-GATE-A-GITHUB-SEARCH-01';
export const V26_GATE_A_NPMJS_SEARCH_SCENARIO_ID = 'V26-GATE-A-NPMJS-SEARCH-01';

function apiRowsCall(
  seq: number,
  scenarioId: string,
  apiFamily: string,
  tokenEstimateChosen: number,
  tokenEstimateFullRead: number,
): BenchmarkToolCallRecordV26 {
  const tokensSavedEstimateTotal = tokenEstimateFullRead - tokenEstimateChosen;
  return {
    seq,
    scenarioId,
    toolName: 'chrome_read_page',
    status: 'ok',
    durationMs: 40 + seq,
    inputTokens: null,
    retryCount: 0,
    fallbackUsed: false,
    lane: 'tabrix_owned',
    startedAt: `2026-04-24T00:00:0${seq}.000Z`,
    endedAt: `2026-04-24T00:00:0${seq}.040Z`,
    component: 'native_handler',
    failureCode: null,
    waitedMs: 0,
    chosenLayer: 'L0',
    layerDispatchReason: 'knowledge_supports_summary',
    sourceRoute: 'knowledge_supported_read',
    chosenSource: 'api_list',
    sourceKind: 'api_list',
    dispatcherInputSource: 'api_knowledge',
    readPageAvoided: true,
    tokenEstimateChosen,
    tokenEstimateFullRead,
    apiFamily,
    apiTelemetry: {
      endpointFamily: apiFamily,
      status: 'ok',
      reason: 'api_rows',
      waitedMs: 0,
    },
    kind: 'api_rows',
    taskTotals: {
      readPageAvoidedCount: seq + 1,
      tokensSavedEstimateTotal,
    },
  };
}

export function v26SearchListFastPathFixture(): BenchmarkRunInputV26 {
  return {
    runId: 'fixture-v26-search-list-fast-path',
    runStartedAt: '2026-04-24T00:00:00.000Z',
    runEndedAt: '2026-04-24T00:00:05.000Z',
    buildSha: 'fixture',
    evidenceKind: 'fixture',
    kpiScenarioIds: [V26_GATE_A_GITHUB_SEARCH_SCENARIO_ID, V26_GATE_A_NPMJS_SEARCH_SCENARIO_ID],
    toolCalls: [
      apiRowsCall(0, V26_GATE_A_GITHUB_SEARCH_SCENARIO_ID, 'github_search_repositories', 140, 1400),
      apiRowsCall(1, V26_GATE_A_NPMJS_SEARCH_SCENARIO_ID, 'npmjs_search_packages', 120, 1200),
    ],
    scenarios: [
      { scenarioId: V26_GATE_A_GITHUB_SEARCH_SCENARIO_ID, completed: true },
      { scenarioId: V26_GATE_A_NPMJS_SEARCH_SCENARIO_ID, completed: true },
    ],
    pairs: [],
    tabHygiene: {
      primaryTabId: 101,
      baselineTabIds: [101],
      observedTabIds: [101],
      openedTabIds: [],
      closedTabIds: [],
      maxConcurrentTabs: 1,
      samePrimaryTabNavigations: 2,
      expectedPrimaryTabNavigations: 2,
      allowsNewTabScenarioIds: [],
      violations: [],
    },
  };
}
