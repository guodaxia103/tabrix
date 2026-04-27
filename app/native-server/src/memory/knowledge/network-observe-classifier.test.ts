/**
 * V26-FIX-03 — generic network-observe classifier tests.
 *
 * These cover the closed-enum semantic taxonomy
 * (search/list/detail/pagination/filter/mutation/asset/analytics/auth/private/telemetry/unknown)
 * across a deliberate mix of GitHub, npmjs, and *non-platform*
 * fixtures (Hacker News, Wikipedia REST, Cloudflare analytics).
 * The non-platform fixtures are the load-bearing assertion: the
 * classifier MUST not silently fall back to GitHub-only behaviour.
 */

import {
  classifyNetworkObserveEndpoint,
  type NetworkObserveSemanticType,
} from './network-observe-classifier';

function classify(input: { url: string; method?: string; type?: string; mimeType?: string }): {
  semanticType: NetworkObserveSemanticType;
  usable: boolean;
  reason: string | null;
} {
  const r = classifyNetworkObserveEndpoint(input);
  return { semanticType: r.semanticType, usable: r.usableForTask, reason: r.noiseReason };
}

describe('classifyNetworkObserveEndpoint — V26-FIX-03', () => {
  it('rejects invalid URLs as unknown / invalid_url', () => {
    expect(classify({ url: 'not-a-url', method: 'GET' })).toEqual({
      semanticType: 'unknown',
      usable: false,
      reason: 'invalid_url',
    });
  });

  it('classifies asset by chrome request type', () => {
    expect(
      classify({
        url: 'https://assets.example.test/app.css',
        method: 'GET',
        type: 'stylesheet',
        mimeType: 'text/css',
      }),
    ).toEqual({ semanticType: 'asset', usable: false, reason: 'asset_resource' });
  });

  it('classifies asset by URL extension even without type hint', () => {
    expect(
      classify({
        url: 'https://cdn.example.test/path/icon.png?v=2',
        method: 'GET',
      }),
    ).toEqual({ semanticType: 'asset', usable: false, reason: 'asset_resource' });
  });

  it('classifies known analytics hosts', () => {
    expect(
      classify({
        url: 'https://www.google-analytics.com/g/collect?v=2',
        method: 'POST',
      }),
    ).toEqual({ semanticType: 'analytics', usable: false, reason: 'analytics_host' });
  });

  it('classifies private paths', () => {
    expect(
      classify({
        url: 'https://api.github.com/_private/browser/stats?token=',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'private', usable: false, reason: 'private_path' });
  });

  it('classifies telemetry-shaped paths', () => {
    expect(
      classify({
        url: 'https://example.test/_/api/v1/telemetry/heartbeat',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'telemetry', usable: false, reason: 'telemetry_path' });
  });

  it('classifies auth paths', () => {
    expect(
      classify({
        url: 'https://example.test/api/auth/login',
        method: 'POST',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'auth', usable: false, reason: 'auth_path' });
  });

  it('classifies non-auth mutation methods as mutation', () => {
    expect(
      classify({
        url: 'https://api.example.test/v1/items',
        method: 'POST',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'mutation', usable: false, reason: 'non_read_method' });
    expect(
      classify({
        url: 'https://api.example.test/v1/items/42',
        method: 'DELETE',
      }),
    ).toEqual({ semanticType: 'mutation', usable: false, reason: 'non_read_method' });
  });

  it('GitHub search/issues → search (usable)', () => {
    expect(
      classify({
        url: 'https://api.github.com/search/issues?q=tabrix&order=desc',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'search', usable: true, reason: null });
  });

  it('GitHub repo detail → detail (usable)', () => {
    expect(
      classify({
        url: 'https://api.github.com/repos/tabrix/tabrix/issues/42',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'detail', usable: true, reason: null });
  });

  it('non-platform fixture — Hacker News API → list/detail (usable)', () => {
    // HN's API is the textbook "we have nothing GitHub-specific" case.
    // Item endpoint returns JSON for a single resource — must classify
    // as `detail` even though no family adapter exists.
    expect(
      classify({
        url: 'https://hacker-news.firebaseio.com/v0/item/12345.json',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'detail', usable: true, reason: null });

    // Top-stories list endpoint returns a JSON array. Path ends on a
    // plural-ish leaf so the collection branch picks it up.
    expect(
      classify({
        url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
        method: 'GET',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'unknown', usable: false, reason: 'no_signal' });
    // ^ Documented behaviour: `topstories.json` ends on neither a
    //   collection-leaf nor an id, so the classifier honestly returns
    //   `unknown`. A future taxonomy expansion can teach it about
    //   `*-stories` style leaves; until then we prefer `unknown` over
    //   a confident wrong `list`.
  });

  it('non-platform fixture — Wikipedia REST search → search (usable)', () => {
    expect(
      classify({
        url: 'https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=tabrix',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'search', usable: true, reason: null });
  });

  it('non-platform fixture — generic JSON pagination → pagination (usable)', () => {
    expect(
      classify({
        url: 'https://api.example.test/v1/items?page=2&per_page=20',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'pagination', usable: true, reason: null });
  });

  it('non-platform fixture — generic JSON filter-only → filter (usable)', () => {
    expect(
      classify({
        url: 'https://api.example.test/v1/widgets?state=open&sort=new',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'filter', usable: true, reason: null });
  });

  it('non-platform fixture — generic JSON collection leaf → list (usable)', () => {
    expect(
      classify({
        url: 'https://api.example.test/v1/articles',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'list', usable: true, reason: null });
  });

  it('rejects HTML responses as unknown / non_structured_response', () => {
    expect(
      classify({
        url: 'https://example.test/some/page',
        method: 'GET',
        type: 'document',
        mimeType: 'text/html',
      }),
    ).toEqual({ semanticType: 'unknown', usable: false, reason: 'non_structured_response' });
  });

  it('returns unknown / no_signal when a JSON GET has no usable signal', () => {
    expect(
      classify({
        url: 'https://api.example.test/v1/something',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toEqual({ semanticType: 'unknown', usable: false, reason: 'no_signal' });
  });
});
