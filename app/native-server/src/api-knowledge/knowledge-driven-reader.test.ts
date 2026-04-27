/**
 * V26-PGB-01 — focused tests for the generic observed-endpoint
 * branch of `readKnowledgeDrivenEndpoint`.
 *
 * The seed-family branch already has full coverage via
 * `api-knowledge.test.ts`; here we only verify the generic branch
 * carries the same `emptyResult` envelope so observed endpoints —
 * the v2.6 mainline — never silently surface `rowCount:0` without
 * the closed empty-result evidence.
 */
import { readKnowledgeDrivenEndpoint } from './knowledge-driven-reader';
import type { EndpointMatch, SafeRequestPlan } from './types';

function makeMatch(): EndpointMatch {
  return {
    endpoint: {
      endpointId: 'observed-endpoint-1',
      site: 'api.example.com',
      family: 'observed',
      method: 'GET',
      urlPattern: 'api.example.com/v1/widgets',
      endpointSignature: 'GET api.example.com/v1/widgets',
      semanticTag: null,
      statusClass: '2xx',
      requestSummary: { params: [], headers: [] },
      responseSummary: { contentType: 'application/json' },
      sourceSessionId: null,
      sourceStepId: null,
      sourceHistoryRef: null,
      sampleCount: 1,
      firstSeenAt: '2026-04-27T00:00:00Z',
      lastSeenAt: '2026-04-27T00:00:00Z',
      semanticTypePersisted: 'list',
      queryParamsShape: null,
      responseShapeSummary: null,
      usableForTaskPersisted: true,
      noiseReason: null,
      semanticType: 'list',
      confidence: 0.9,
    },
    score: 0.9,
    semanticValidation: 'pass',
  } as unknown as EndpointMatch;
}

function makePlan(overrides?: Partial<SafeRequestPlan>): SafeRequestPlan {
  return {
    url: 'https://api.example.com/v1/widgets',
    method: 'GET',
    dataPurpose: 'observed_list',
    builderHint: 'generic',
    requestShapeUsed: [],
    ...overrides,
  } as SafeRequestPlan;
}

function jsonFetchOnce(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    status,
    headers: { get: jest.fn().mockReturnValue('application/json') },
    json: jest.fn().mockResolvedValue(body),
  });
}

describe('V26-PGB-01 knowledge-driven-reader emptyResult', () => {
  it('marks an observed endpoint that returned [] as a verified empty result', async () => {
    const result = await readKnowledgeDrivenEndpoint({
      match: makeMatch(),
      plan: makePlan(),
      fetchFn: jsonFetchOnce(200, []),
    });

    expect(result).toMatchObject({
      status: 'ok',
      kind: 'api_rows',
      rowCount: 0,
      emptyResult: true,
      emptyReason: 'no_matching_records',
    });
    expect((result as { emptyMessage?: string }).emptyMessage).toMatch(/no records/i);
  });

  it('marks an observed endpoint with rows as emptyResult=false', async () => {
    const result = await readKnowledgeDrivenEndpoint({
      match: makeMatch(),
      plan: makePlan(),
      fetchFn: jsonFetchOnce(200, [{ id: 1, name: 'widget-a' }]),
    });

    expect(result).toMatchObject({
      status: 'ok',
      kind: 'api_rows',
      rowCount: 1,
      emptyResult: false,
      emptyReason: null,
      emptyMessage: null,
    });
  });

  it('does not flip emptyResult on a 403 fallback', async () => {
    const result = await readKnowledgeDrivenEndpoint({
      match: makeMatch(),
      plan: makePlan(),
      fetchFn: jsonFetchOnce(403, { message: 'denied' }),
    });

    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'http_forbidden',
    });
    expect((result as { emptyResult?: unknown }).emptyResult).toBeUndefined();
  });
});
