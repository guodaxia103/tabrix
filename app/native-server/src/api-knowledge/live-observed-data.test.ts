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
      fallbackCause: 'metadata_only_capture',
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

  it('correlated safe response body can produce compact rows', () => {
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
              items: [
                { title: 'row1', score: 1 },
                { title: 'row2', score: 2 },
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
    expect(JSON.stringify(out.selected[0])).not.toContain('responseBody');
  });
});
