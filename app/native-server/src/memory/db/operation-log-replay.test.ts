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
