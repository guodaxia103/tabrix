import {
  deriveLiveObservedApiDataFromBundle,
  type DeriveLiveObservedApiDataInput,
} from './live-observed-data';

function run(
  input: Partial<DeriveLiveObservedApiDataInput> & {
    bundle: DeriveLiveObservedApiDataInput['bundle'];
  },
) {
  return deriveLiveObservedApiDataFromBundle({
    ctx: {
      sessionId: 's_test',
      stepId: 'step_test',
      observedAt: '2026-04-28T10:00:00.000Z',
    },
    upsertedBySignature: new Map(),
    ...input,
  });
}

function observedSearchRequest(url: string) {
  return {
    url,
    method: 'GET',
    type: 'xmlhttprequest',
    statusCode: 200,
    mimeType: 'application/json',
    specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
    responseBody: JSON.stringify({
      items: [
        { title: 'row1', score: 1 },
        { title: 'row2', score: 2 },
      ],
    }),
  };
}

function signatureFor(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `GET ${url.hostname.toLowerCase()}${url.pathname}`;
}

function upsertState(
  rawUrl: string,
  correlationConfidence: 'unknown_candidate' | 'low_confidence' | 'high_confidence' | null,
  correlatedRegionId: string | null,
) {
  return new Map([
    [
      signatureFor(rawUrl),
      {
        endpointId: 'endpoint_1',
        knowledgeUpserted: true,
        correlationConfidence,
        correlatedRegionId,
      },
    ],
  ]);
}

describe('live-observed-data selector', () => {
  it('metadata-only capture does not produce live observed rows', () => {
    const out = run({
      bundle: {
        requests: [
          {
            url: 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1',
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
      },
    });
    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'response_summary_unavailable',
    });
  });

  it('browser-context safe response summary produces current-task rows without responseBody', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items?keyword=&page=';
    const out = run({
      bundle: {
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            requestTime: 2000,
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                { title: 'compact result one', likeCount: 3 },
                { title: 'compact result two', likeCount: 5 },
              ],
              rowCount: 2,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['likeCount', 'title'],
              taskQueryValueMatched: true,
              samplerArmedAt: 1000,
              capturedAt: 2100,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
      },
    });
    const blob = JSON.stringify(out);

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_rows',
      rowCount: 2,
      liveObservedEndpointId: null,
      responseSummarySource: 'browser_context_summary',
      rawBodyPersisted: false,
      capturedAfterArm: true,
      bridgePath: 'main_world_to_content_to_native',
      pageRegion: 'task_query_network',
    });
    expect(blob).not.toMatch(/"responseBody"/);
    expect(blob).not.toContain('desk');
  });

  it('rejects browser-context summary rows that still contain sensitive fields', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items?keyword=';
    const out = run({
      bundle: {
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            requestTime: 2000,
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                {
                  title: 'compact result one',
                  token: '0123456789abcdef0123456789abcdef',
                },
              ],
              rowCount: 1,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['title', 'token'],
              taskQueryValueMatched: true,
              samplerArmedAt: 1000,
              capturedAt: 2100,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
      },
    });
    const blob = JSON.stringify(out);

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'sensitive_row_content',
      privacyCheck: 'failed',
      responseSummarySource: 'browser_context_summary',
    });
    expect(blob).not.toContain('0123456789abcdef0123456789abcdef');
  });

  it('safe response summary before arm is rejected', () => {
    const out = run({
      bundle: {
        requests: [
          {
            url: 'https://api.neutral-social.example.test/v1/search/items?keyword=',
            method: 'GET',
            type: 'xmlhttprequest',
            requestTime: 900,
            statusCode: 200,
            mimeType: 'application/json',
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [{ title: 'late' }],
              rowCount: 1,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['title'],
              taskQueryValueMatched: true,
              samplerArmedAt: 1000,
              capturedAt: 1100,
            },
          },
        ],
      },
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      fallbackCause: 'response_before_sampler_arm',
      responseSummarySource: 'browser_context_summary',
      fallbackUsed: true,
    });
  });

  it('uncorrelated response-body candidate is rejected with relevance evidence', () => {
    const out = run({
      bundle: {
        requests: [
          {
            url: 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1',
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
            responseBody: JSON.stringify({
              items: [{ title: 'feed1' }, { title: 'feed2' }],
            }),
          },
        ],
      },
    });
    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'dom_region_correlation_missing',
      pageRegion: 'current_page_network',
    });
  });

  it('correlated CDP enhanced response body can produce compact rows with controlled evidence', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpReason: 'need_response_body',
        cdpAttachDurationMs: 25,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        fallbackCause: null,
        requests: [observedSearchRequest(requestUrl)],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword', 'page'],
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      observationMode: 'cdp_enhanced',
      selectedDataSource: 'cdp_enhanced_api_rows',
      cdpUsed: true,
      cdpReason: 'need_response_body',
      cdpAttachDurationMs: 25,
      cdpDetachSuccess: true,
      debuggerConflict: false,
      responseBodySource: 'debugger_api',
      rawBodyPersisted: false,
      bodyCompacted: true,
      fallbackCause: null,
      fallbackUsed: false,
      rowCount: 2,
    });
    expect(JSON.stringify(out.selected[0])).not.toMatch(/"responseBody"/);
  });

  it('rejects CDP enhanced rows when detach did not succeed', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpReason: 'need_response_body',
        cdpAttachDurationMs: 25,
        cdpDetachSuccess: false,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        fallbackCause: 'cdp_detach_failed',
        requests: [observedSearchRequest(requestUrl)],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword', 'page'],
      },
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      observationMode: 'cdp_enhanced',
      cdpUsed: true,
      cdpDetachSuccess: false,
      fallbackCause: 'cdp_detach_failed',
      fallbackUsed: true,
    });
  });

  it('correlated safe response body can produce compact rows', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: {
        requests: [observedSearchRequest(requestUrl)],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword', 'page'],
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_rows',
      rowCount: 2,
      emptyResult: false,
      pageRegion: 'task_query_network',
      rawBodyStored: false,
      privacyCheck: 'passed',
      fallbackCause: null,
      fallbackUsed: false,
    });
    expect(out.selected[0].pageRegion).not.toBe('current_page_network');
    expect(JSON.stringify(out.selected[0])).not.toMatch(/"responseBody"/);
  });

  it('rejects debugger response-body rows with sensitive value shapes before output', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: {
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
            responseBody: JSON.stringify({
              items: [
                {
                  title: 'feed1',
                  ownerEmail: 'person@example.test',
                },
              ],
            }),
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword', 'page'],
      },
    });
    const blob = JSON.stringify(out);

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'sensitive_row_content',
      privacyCheck: 'failed',
    });
    expect(blob).not.toContain('person@example.test');
  });

  it('low confidence DOM correlation is rejected', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      upsertedBySignature: upsertState(requestUrl, 'low_confidence', 'search_results'),
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'low_correlation_confidence',
      pageRegion: 'search_results',
    });
  });

  it('high confidence DOM correlation can pass without query value', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      upsertedBySignature: upsertState(requestUrl, 'high_confidence', 'search_results'),
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_rows',
      pageRegion: 'search_results',
      rowCount: 2,
    });
    expect(out.selected[0].pageRegion).not.toBe('current_page_network');
  });

  it('same query keys but different query values are rejected without leaking values', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=chair&page=1';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword'],
      },
    });
    const blob = JSON.stringify(out);

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'task_query_value_unproven',
      pageRegion: 'current_page_network',
    });
    expect(blob).not.toContain('desk');
    expect(blob).not.toContain('chair');
  });

  it('matching query value can pass task-query relevance', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword'],
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_rows',
      pageRegion: 'task_query_network',
      rowCount: 2,
    });
  });

  it('path-only search/list similarity is not enough', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search',
        expectedTaskQueryKeys: ['keyword'],
      },
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'task_query_value_unproven',
      pageRegion: 'current_page_network',
    });
  });
});
