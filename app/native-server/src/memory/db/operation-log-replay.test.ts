/**
 * V26-PGB-05 — unit tests for the read-only operation-chain replay
 * summary helper. Verifies that the helper can explain "API success
 * vs API empty vs API fallback" from a single sessionId, never
 * mutates its input, and degrades gracefully when the reader returns
 * an empty list.
 */
import {
  NOT_APPLICABLE,
  makeOperationLogMetadataDefaults,
  type OperationLogMetadata,
} from './operation-log-metadata';
import type { OperationMemoryLog } from './operation-memory-log-repository';
import {
  buildOperationLogReviewReport,
  renderOperationChainSummary,
  summariseOperationChain,
  type OperationLogReplayReader,
} from './operation-log-replay';

function makeMetadata(overrides: Partial<OperationLogMetadata> = {}): OperationLogMetadata {
  return { ...makeOperationLogMetadataDefaults(), ...overrides };
}

function makeLog(overrides: Partial<OperationMemoryLog>): OperationMemoryLog {
  return {
    operationLogId: overrides.operationLogId ?? 'log-x',
    taskId: overrides.taskId ?? 'task-1',
    sessionId: overrides.sessionId ?? 'session-1',
    stepId: overrides.stepId ?? 'step-1',
    toolName: overrides.toolName ?? 'chrome_read_page',
    urlPattern: overrides.urlPattern ?? null,
    pageRole: overrides.pageRole ?? null,
    requestedLayer: overrides.requestedLayer ?? null,
    selectedDataSource: overrides.selectedDataSource ?? null,
    sourceRoute: overrides.sourceRoute ?? null,
    decisionReason: overrides.decisionReason ?? null,
    resultKind: overrides.resultKind ?? null,
    durationMs: overrides.durationMs ?? null,
    success: overrides.success ?? true,
    fallbackUsed: overrides.fallbackUsed ?? null,
    errorCode: overrides.errorCode ?? null,
    readCount: overrides.readCount ?? null,
    tokensSaved: overrides.tokensSaved ?? null,
    tabHygiene: overrides.tabHygiene ?? null,
    metadata: overrides.metadata ?? makeMetadata(),
    createdAt: overrides.createdAt ?? '2026-04-27T00:00:00.000Z',
  };
}

function makeReader(logs: OperationMemoryLog[]): OperationLogReplayReader {
  return {
    listBySession: (sessionId) => logs.filter((log) => log.sessionId === sessionId),
  };
}

describe('summariseOperationChain — V26-PGB-05', () => {
  it('classifies an api_rows success step as api_success', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-success',
        selectedDataSource: 'api_rows',
        sourceRoute: 'api_knowledge',
        decisionReason: 'api_knowledge_candidate_available',
        resultKind: 'api_rows',
        durationMs: 120,
        success: true,
        metadata: makeMetadata({ emptyResult: 'false', routerDecision: 'api_rows' }),
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.stepCount).toBe(1);
    expect(summary.totalDurationMs).toBe(120);
    expect(summary.steps[0]).toMatchObject({
      ordinal: 1,
      toolName: 'chrome_read_page',
      selectedDataSource: 'api_rows',
      sourceRoute: 'api_knowledge',
      decisionReason: 'api_knowledge_candidate_available',
      fallbackCause: null,
      emptyResult: 'false',
      durationMs: 120,
      success: true,
      routeOutcome: 'api_success',
    });
    expect(summary.routeOutcomeDistribution.api_success).toBe(1);
    expect(summary.routeOutcomeDistribution.api_empty).toBe(0);
    expect(summary.coverage.explainedSteps).toBe(1);
  });

  it('classifies an api_rows empty step as api_empty and surfaces the marker', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-empty',
        selectedDataSource: 'api_rows',
        sourceRoute: 'api_knowledge',
        decisionReason: 'api_knowledge_candidate_available',
        resultKind: 'api_rows',
        durationMs: 90,
        success: true,
        metadata: makeMetadata({ emptyResult: 'true', routerDecision: 'api_rows' }),
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0].routeOutcome).toBe('api_empty');
    expect(summary.steps[0].emptyResult).toBe('true');
    expect(summary.routeOutcomeDistribution.api_empty).toBe(1);
  });

  it('classifies a read_page_fallback step as api_fallback and surfaces fallbackCause', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-fallback',
        selectedDataSource: 'dom_json',
        sourceRoute: 'dom_json',
        decisionReason: 'api_knowledge_403_fallback',
        resultKind: 'read_page_fallback',
        durationMs: 320,
        success: true,
        fallbackUsed: 'api_knowledge_403',
        metadata: makeMetadata({
          emptyResult: NOT_APPLICABLE,
          fallbackPlan: 'api_knowledge_403',
          routerDecision: 'dom_json',
        }),
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0]).toMatchObject({
      routeOutcome: 'api_fallback',
      fallbackCause: 'api_knowledge_403',
      emptyResult: null,
    });
    expect(summary.routeOutcomeDistribution.api_fallback).toBe(1);
  });

  it('aggregates a three-step chain (success, empty, fallback) under one sessionId', () => {
    const reader = makeReader([
      makeLog({
        stepId: 's1',
        selectedDataSource: 'api_rows',
        resultKind: 'api_rows',
        durationMs: 100,
        metadata: makeMetadata({ emptyResult: 'false' }),
      }),
      makeLog({
        stepId: 's2',
        selectedDataSource: 'api_rows',
        resultKind: 'api_rows',
        durationMs: 80,
        metadata: makeMetadata({ emptyResult: 'true' }),
      }),
      makeLog({
        stepId: 's3',
        selectedDataSource: 'dom_json',
        resultKind: 'read_page_fallback',
        durationMs: 200,
        fallbackUsed: 'api_knowledge_timeout',
        metadata: makeMetadata({
          fallbackPlan: 'api_knowledge_timeout',
          emptyResult: NOT_APPLICABLE,
        }),
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.stepCount).toBe(3);
    expect(summary.totalDurationMs).toBe(380);
    expect(summary.routeOutcomeDistribution).toMatchObject({
      api_success: 1,
      api_empty: 1,
      api_fallback: 1,
      dom_region_rows_success: 0,
      read_page: 0,
      tool_call: 0,
    });
    const outcomes = summary.steps.map((s) => s.routeOutcome);
    expect(outcomes).toEqual(['api_success', 'api_empty', 'api_fallback']);
  });

  it('returns an empty summary with all-zero distribution when the session has no rows', () => {
    const reader = makeReader([]);
    const summary = summariseOperationChain(reader, 'missing-session');
    expect(summary.stepCount).toBe(0);
    expect(summary.totalDurationMs).toBe(0);
    expect(summary.steps).toEqual([]);
    for (const value of Object.values(summary.routeOutcomeDistribution)) {
      expect(value).toBe(0);
    }
  });

  it('treats fallbackUsed="none" and fallbackPlan="not_applicable" as no fallback', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-none',
        selectedDataSource: 'api_rows',
        resultKind: 'api_rows',
        fallbackUsed: 'none',
        metadata: makeMetadata({ fallbackPlan: NOT_APPLICABLE, emptyResult: 'false' }),
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0].fallbackCause).toBeNull();
    expect(summary.steps[0].routeOutcome).toBe('api_success');
  });

  it('classifies a navigate / capture style tool call as tool_call', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-nav',
        toolName: 'chrome_navigate',
        selectedDataSource: null,
        resultKind: null,
        metadata: makeMetadata({ emptyResult: NOT_APPLICABLE }),
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0].routeOutcome).toBe('tool_call');
    expect(summary.routeOutcomeDistribution.tool_call).toBe(1);
    expect(summary.steps[0].coverage).toBe('legacy_default');
    expect(summary.coverage.legacyDefaultSteps).toBe(1);
  });

  it('surfaces V27-13 explainability evidence and coverage', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-v27',
        selectedDataSource: 'api_rows',
        sourceRoute: 'knowledge_supported_read',
        decisionReason: 'endpoint_knowledge_high_confidence',
        resultKind: 'api_rows',
        metadata: makeMetadata({
          emptyResult: 'false',
          executionMode: 'direct_api',
          readerMode: 'knowledge_driven',
          endpointSource: 'observed',
          lookupChosenReason: 'observed_preferred_over_seed_adapter',
          correlationConfidence: 'low_confidence',
          retiredEndpointSource: 'seed_adapter',
          semanticValidation: 'pass',
          layerContractReason: 'api_rows_are_list_fields_not_locator_authority',
          fallbackEntryLayer: 'none',
          apiFinalReason: 'none',
          privacyCheck: 'passed',
          relevanceCheck: 'passed',
        }),
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0]).toMatchObject({
      routeOutcome: 'api_success',
      coverage: 'explained',
      evidence: {
        executionMode: 'direct_api',
        readerMode: 'knowledge_driven',
        endpointSource: 'observed',
        lookupChosenReason: 'observed_preferred_over_seed_adapter',
        retiredEndpointSource: 'seed_adapter',
        privacyCheck: 'passed',
        relevanceCheck: 'passed',
      },
    });
    expect(summary.coverage).toMatchObject({
      explainedSteps: 1,
      partialSteps: 0,
      legacyDefaultSteps: 0,
      failureSteps: 0,
    });
  });

  it('keeps failed API rows classified as api_failure instead of success', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-failed-api',
        selectedDataSource: 'api_rows',
        sourceRoute: 'knowledge_supported_read',
        decisionReason: 'api_call_failed_semantic_mismatch',
        resultKind: 'api_rows',
        success: false,
        metadata: makeMetadata({
          emptyResult: NOT_APPLICABLE,
          executionMode: 'fallback_required',
          endpointSource: 'observed',
          apiFinalReason: 'semantic_mismatch',
          fallbackEntryLayer: 'L0+L1',
        }),
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0]).toMatchObject({
      routeOutcome: 'api_failure',
      success: false,
      coverage: 'explained',
    });
    expect(summary.routeOutcomeDistribution.api_failure).toBe(1);
    expect(summary.coverage.failureSteps).toBe(1);
  });

  it('classifies DOM region rows and surfaces API/DOM decision evidence', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-dom-rows',
        selectedDataSource: 'dom_region_rows',
        sourceRoute: 'knowledge_supported_read',
        decisionReason: 'api_rows_rejected_semantic_mismatch_dom_rows',
        resultKind: 'dom_region_rows',
        success: true,
        metadata: makeMetadata({
          routerDecision: 'dom_region_rows',
          visibleRegionRowsUsed: 'true',
          visibleRegionRowCount: '10',
          visibleRegionRowsRejectedReason: 'none',
          apiRowsUnavailableReason: 'semantic_mismatch',
          dataSourceDecisionReason: 'api_rows_rejected_semantic_mismatch_dom_rows',
          targetRefCoverageRate: '0.99',
          regionQualityScore: '0.82',
          rejectedRegionReasonDistribution: '{"footer_like_region":2}',
          privacyCheck: 'passed',
          relevanceCheck: 'passed',
        }),
      }),
    ]);

    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0]).toMatchObject({
      routeOutcome: 'dom_region_rows_success',
      success: true,
      coverage: 'explained',
      evidence: {
        visibleRegionRowsUsed: 'true',
        visibleRegionRowCount: '10',
        visibleRegionRowsRejectedReason: 'none',
        apiRowsUnavailableReason: 'semantic_mismatch',
        dataSourceDecisionReason: 'api_rows_rejected_semantic_mismatch_dom_rows',
        targetRefCoverageRate: '0.99',
        regionQualityScore: '0.82',
        rejectedRegionReasonDistribution: '{"footer_like_region":2}',
      },
    });
    expect(summary.routeOutcomeDistribution.dom_region_rows_success).toBe(1);
  });

  it('surfaces controlled CDP evidence from operation metadata', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-cdp-rows',
        selectedDataSource: 'cdp_enhanced_api_rows',
        sourceRoute: 'knowledge_supported_read',
        decisionReason: 'live_observed_current_task_api_data',
        resultKind: 'cdp_enhanced_api_rows',
        success: true,
        metadata: makeMetadata({
          routerDecision: 'cdp_enhanced_api_rows',
          endpointSource: 'observed',
          privacyCheck: 'passed',
          relevanceCheck: 'passed',
          observationMode: 'cdp_enhanced',
          cdpUsed: 'true',
          cdpReason: 'need_response_body',
          cdpAttachDurationMs: '25',
          cdpDetachSuccess: 'true',
          debuggerConflict: 'false',
          responseBodySource: 'debugger_api',
          bodyCompacted: 'true',
        }),
      }),
    ]);

    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0]).toMatchObject({
      routeOutcome: 'api_success',
      success: true,
      coverage: 'explained',
      evidence: {
        observationMode: 'cdp_enhanced',
        cdpUsed: 'true',
        cdpReason: 'need_response_body',
        cdpAttachDurationMs: '25',
        cdpDetachSuccess: 'true',
        debuggerConflict: 'false',
        responseBodySource: 'debugger_api',
        bodyCompacted: 'true',
      },
    });
  });

  it('keeps DOM rows unavailable paths classified as failure', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'step-dom-rows-failed',
        selectedDataSource: 'dom_region_rows',
        resultKind: 'dom_region_rows',
        success: false,
        metadata: makeMetadata({
          visibleRegionRowsUsed: 'false',
          visibleRegionRowCount: '0',
          visibleRegionRowsRejectedReason: 'dom_region_rows_unavailable',
          apiRowsUnavailableReason: 'timeout',
        }),
      }),
    ]);

    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.steps[0].routeOutcome).toBe('dom_region_rows_failure');
    expect(summary.coverage.failureSteps).toBe(1);
    expect(summary.routeOutcomeDistribution.dom_region_rows_failure).toBe(1);
  });
});

describe('renderOperationChainSummary — V26-PGB-05', () => {
  it('renders the closed-vocab table without leaking raw URLs or bodies', () => {
    const reader = makeReader([
      makeLog({
        stepId: 'render-1',
        selectedDataSource: 'api_rows',
        sourceRoute: 'api_knowledge',
        decisionReason: 'api_knowledge_candidate_available',
        resultKind: 'api_rows',
        durationMs: 110,
        urlPattern: 'https://api.example.com/items?secret=should-not-leak',
        metadata: makeMetadata({ emptyResult: 'true' }),
      }),
    ]);
    const text = renderOperationChainSummary(summariseOperationChain(reader, 'session-1'));
    expect(text).toContain('sessionId=session-1');
    expect(text).toContain('api_empty');
    expect(text).toContain('api_knowledge_candidate_available');
    expect(text).not.toContain('secret=should-not-leak');
  });
});

describe('buildOperationLogReviewReport — V27-14', () => {
  it('builds a read-only timeline, slow-step list, fallback tree, and gate summary', () => {
    const logs = [
      makeLog({
        stepId: 'fast-api',
        selectedDataSource: 'api_rows',
        sourceRoute: 'knowledge_supported_read',
        decisionReason: 'endpoint_knowledge_high_confidence',
        resultKind: 'api_rows',
        durationMs: 120,
        metadata: makeMetadata({
          emptyResult: 'false',
          executionMode: 'direct_api',
          endpointSource: 'observed',
          privacyCheck: 'passed',
          relevanceCheck: 'passed',
        }),
      }),
      makeLog({
        stepId: 'slow-fallback',
        selectedDataSource: 'dom_json',
        sourceRoute: 'knowledge_supported_read',
        decisionReason: 'task_query_value_unproven',
        resultKind: 'read_page_fallback',
        durationMs: 2_500,
        fallbackUsed: 'task_query_value_unproven',
        metadata: makeMetadata({
          fallbackPlan: 'task_query_value_unproven',
          privacyCheck: 'passed',
          relevanceCheck: 'failed',
        }),
      }),
    ];
    const summary = summariseOperationChain(makeReader(logs), 'session-1');
    const report = buildOperationLogReviewReport(summary, { slowStepThresholdMs: 1_000 });

    expect(report.sessionId).toBe('session-1');
    expect(report.timeline.map((step) => step.stepId)).toEqual(['fast-api', 'slow-fallback']);
    expect(report.slowSteps.map((step) => step.stepId)).toEqual(['slow-fallback']);
    expect(report.fallbackTree).toEqual([
      { cause: 'task_query_value_unproven', count: 1, stepIds: ['slow-fallback'] },
    ]);
    expect(report.dataSourceDistribution).toEqual({ api_rows: 1, dom_json: 1 });
    expect(report.privacyRelevanceSummary).toEqual({
      privacyPassed: 2,
      privacyFailed: 0,
      relevancePassed: 1,
      relevanceFailed: 1,
      unknown: 0,
    });
    expect(report.routeOutcomeDistribution.api_success).toBe(1);
    expect(report.routeOutcomeDistribution.api_fallback).toBe(1);
  });
});

/**
 * V27-00 — invariant: a v2.6-shape operation log replays unchanged under
 * the v2.7 metadata extension. v2.6 callers only stamped the FIX-07 +
 * PGB-01 keys; v2.7 added 10 more (lifecycleState, factSnapshotId, …).
 * `buildOperationLogMetadata` defaults missing keys to `'not_applicable'`,
 * so a v2.6 row must replay with all v2.7 keys rendered as the sentinel.
 */
describe('summariseOperationChain — V27-00 v2.6 NDJSON replay invariant', () => {
  it('replays a v2.6-only metadata blob without v2.7 keys present', () => {
    const v26OnlyMetadata = {
      ...makeMetadata({
        emptyResult: 'false',
        decisionReason: 'api_knowledge_candidate_available',
        routerDecision: 'api_rows',
      }),
    } as OperationLogMetadata;
    const reader = makeReader([
      makeLog({
        stepId: 'v26-step',
        selectedDataSource: 'api_rows',
        sourceRoute: 'api_knowledge',
        decisionReason: 'api_knowledge_candidate_available',
        resultKind: 'api_rows',
        durationMs: 105,
        success: true,
        metadata: v26OnlyMetadata,
      }),
    ]);
    const summary = summariseOperationChain(reader, 'session-1');
    expect(summary.stepCount).toBe(1);
    expect(summary.steps[0].routeOutcome).toBe('api_success');
    const v27SentinelKeys: ReadonlyArray<keyof OperationLogMetadata> = [
      'lifecycleState',
      'lifecycleConfidence',
      'actionOutcome',
      'outcomeConfidence',
      'contextInvalidationReason',
      'readinessState',
      'complexityKind',
      'factSnapshotId',
      'observerOverhead',
      'decisionRuleId',
      'responseSummarySource',
      'capturedAfterArm',
      'bridgePath',
      'executionMode',
      'readerMode',
      'endpointSource',
      'lookupChosenReason',
      'correlationConfidence',
      'retiredEndpointSource',
      'semanticValidation',
      'layerContractReason',
      'fallbackEntryLayer',
      'apiFinalReason',
      'privacyCheck',
      'relevanceCheck',
      'observationMode',
      'cdpUsed',
      'cdpReason',
      'cdpAttachDurationMs',
      'cdpDetachSuccess',
      'debuggerConflict',
      'responseBodySource',
      'bodyCompacted',
      'visibleRegionRowsUsed',
      'visibleRegionRowCount',
      'visibleRegionRowsRejectedReason',
      'apiRowsUnavailableReason',
      'dataSourceDecisionReason',
      'targetRefCoverageRate',
      'regionQualityScore',
      'rejectedRegionReasonDistribution',
    ];
    for (const key of v27SentinelKeys) {
      expect(v26OnlyMetadata[key]).toBe(NOT_APPLICABLE);
    }
    const text = renderOperationChainSummary(summary);
    expect(text).toContain('api_success');
  });
});
