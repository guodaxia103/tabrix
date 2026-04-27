/**
 * V26-FIX-04 — `buildSafeRequest` unit tests.
 *
 * Pins the builder's two branches and the safety boundary:
 *   - seed_adapter: bit-identical to the V25
 *     `buildPublicRequest` output for the same inputs (so the
 *     existing GitHub/npmjs Gate B tests stay green when the
 *     executor flips to lookup-first in FIX-04).
 *   - generic: produces an `https://<host><path>?<primary>=<value>`
 *     URL only when (a) the row has an observed primary query key
 *     and (b) the caller supplied a value for it.
 *   - GET-only; refuses identity placeholders; refuses to invent
 *     query keys.
 */

import { buildSafeRequest } from './safe-request-builder';
import type { EndpointMatch, DataNeed } from './types';
import type {
  KnowledgeApiEndpoint,
  EndpointSemanticType,
} from '../memory/knowledge/knowledge-api-repository';

type ScoredFixtureRow = KnowledgeApiEndpoint & {
  semanticType: EndpointSemanticType;
  confidence: number;
  usableForTask: boolean;
  fallbackReason: string | null;
};

function row(overrides: Partial<ScoredFixtureRow>): ScoredFixtureRow {
  return {
    endpointId: 'e-1',
    site: 'api.example.com',
    family: 'observed',
    method: 'GET',
    urlPattern: 'api.example.com/items',
    endpointSignature: 'GET api.example.com/items',
    semanticTag: null,
    statusClass: '2xx',
    requestSummary: {
      headerKeys: [],
      queryKeys: [],
      bodyKeys: [],
      hasAuth: false,
      hasCookie: false,
    },
    responseSummary: {
      contentType: 'application/json',
      sizeBytes: 1024,
      shape: { kind: 'array', itemCount: 5, sampleItemKeys: ['id', 'name'] },
    },
    sourceSessionId: null,
    sourceStepId: null,
    sourceHistoryRef: null,
    sampleCount: 1,
    firstSeenAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    semanticTypePersisted: 'list',
    queryParamsShape: null,
    responseShapeSummary: null,
    usableForTaskPersisted: true,
    noiseReason: null,
    semanticType: 'list',
    confidence: 0.8,
    usableForTask: true,
    fallbackReason: null,
    ...overrides,
  };
}

function match(overrides: Partial<ScoredFixtureRow>): EndpointMatch {
  return {
    endpoint: row(overrides),
    semanticValidation: 'pass',
    score: 0.8,
  };
}

const baseDataNeed: DataNeed = {
  intent: 'find tabrix repos',
  intentClass: 'read_only',
  semanticTypeWanted: 'search',
  urlHint: 'https://github.com/search?q=tabrix',
  pageRole: null,
};

describe('V26-FIX-04 buildSafeRequest — seed_adapter branch', () => {
  it('builds a github_search_repositories URL identical to V25 builder', () => {
    const m = match({
      site: 'api.github.com',
      urlPattern: 'api.github.com/search/repositories',
      family: 'github',
      semanticType: 'search',
    });
    const plan = buildSafeRequest(m, {
      ...baseDataNeed,
      params: { query: 'tabrix', sort: 'stars', order: 'desc' },
    });
    expect(plan).not.toBeNull();
    expect(plan!.builderHint).toBe('seed_adapter');
    expect(plan!.dataPurpose).toBe('search_list');
    expect(plan!.url).toContain('https://api.github.com/search/repositories');
    expect(plan!.url).toContain('q=tabrix');
    expect(plan!.url).toContain('sort=stars');
    expect(plan!.url).toContain('order=desc');
    expect(plan!.url).toContain('per_page=10');
    expect(plan!.requestShapeUsed).toEqual(['order', 'per_page', 'q', 'sort']);
  });

  it('builds a github_issues_list URL through search/issues when owner/repo are supplied', () => {
    const m = match({
      site: 'api.github.com',
      urlPattern: 'api.github.com/repos/:owner/:repo/issues',
      family: 'github',
      semanticType: 'list',
    });
    const plan = buildSafeRequest(m, {
      ...baseDataNeed,
      semanticTypeWanted: 'list',
      params: { owner: 'tabrix', repo: 'tabrix' },
    });
    expect(plan).not.toBeNull();
    expect(plan!.builderHint).toBe('seed_adapter');
    expect(plan!.dataPurpose).toBe('issue_list');
    const url = new URL(plan!.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://api.github.com/search/issues');
    expect(url.searchParams.get('q')).toBe('repo:tabrix/tabrix is:issue state:open');
    expect(url.searchParams.get('sort')).toBe('created');
    expect(url.searchParams.get('order')).toBe('desc');
    expect(url.searchParams.get('per_page')).toBe('10');
    expect(plan!.requestShapeUsed).toEqual(['order', 'per_page', 'q', 'sort']);
  });

  it('keeps additional issue search terms in the search/issues query', () => {
    const m = match({
      site: 'api.github.com',
      urlPattern: 'api.github.com/repos/:owner/:repo/issues',
      family: 'github',
      semanticType: 'list',
    });
    const plan = buildSafeRequest(m, {
      ...baseDataNeed,
      semanticTypeWanted: 'list',
      params: {
        owner: 'guodaxia103',
        repo: 'tabrix',
        query: '__tabrix_pgb_02_no_match__',
      },
    });
    expect(plan).not.toBeNull();
    const url = new URL(plan!.url);
    expect(url.searchParams.get('q')).toBe(
      'repo:guodaxia103/tabrix is:issue state:open __tabrix_pgb_02_no_match__',
    );
    expect(plan!.requestShapeUsed).toEqual(['order', 'per_page', 'q', 'query', 'sort']);
  });

  it('refuses github_issues_list when owner/repo missing', () => {
    const m = match({
      site: 'api.github.com',
      urlPattern: 'api.github.com/repos/:owner/:repo/issues',
      family: 'github',
      semanticType: 'list',
    });
    const plan = buildSafeRequest(m, { ...baseDataNeed, params: {} });
    expect(plan).toBeNull();
  });

  it('builds a github_workflow_runs_list URL when owner/repo are supplied', () => {
    const m = match({
      site: 'api.github.com',
      urlPattern: 'api.github.com/repos/:owner/:repo/actions/runs',
      family: 'github',
      semanticType: 'list',
    });
    const plan = buildSafeRequest(m, {
      ...baseDataNeed,
      semanticTypeWanted: 'list',
      params: { owner: 'guodaxia103', repo: 'tabrix', limit: 1 },
    });
    expect(plan).not.toBeNull();
    expect(plan!.builderHint).toBe('seed_adapter');
    expect(plan!.dataPurpose).toBe('workflow_runs_list');
    expect(plan!.url).toBe(
      'https://api.github.com/repos/guodaxia103/tabrix/actions/runs?per_page=1',
    );
    expect(plan!.requestShapeUsed).toEqual(['per_page']);
  });

  it('defaults github_workflow_runs_list to three rows for fast actions detail reads', () => {
    const m = match({
      site: 'api.github.com',
      urlPattern: 'api.github.com/repos/:owner/:repo/actions/runs',
      family: 'github',
      semanticType: 'list',
    });
    const plan = buildSafeRequest(m, {
      ...baseDataNeed,
      semanticTypeWanted: 'list',
      params: { owner: 'guodaxia103', repo: 'tabrix' },
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toBe(
      'https://api.github.com/repos/guodaxia103/tabrix/actions/runs?per_page=3',
    );
  });

  it('builds an npmjs_search_packages URL', () => {
    const m = match({
      site: 'registry.npmjs.org',
      urlPattern: 'registry.npmjs.org/-/v1/search',
      family: 'npmjs',
      semanticType: 'search',
    });
    const plan = buildSafeRequest(m, {
      ...baseDataNeed,
      params: { query: 'react', limit: 5 },
    });
    expect(plan).not.toBeNull();
    expect(plan!.builderHint).toBe('seed_adapter');
    expect(plan!.dataPurpose).toBe('package_search');
    expect(plan!.url).toBe('https://registry.npmjs.org/-/v1/search?text=react&size=5');
    expect(plan!.requestShapeUsed).toEqual(['size', 'text']);
  });

  it('clamps limit to MAX_LIMIT=10', () => {
    const m = match({
      site: 'registry.npmjs.org',
      urlPattern: 'registry.npmjs.org/-/v1/search',
      family: 'npmjs',
      semanticType: 'search',
    });
    const plan = buildSafeRequest(m, {
      ...baseDataNeed,
      params: { query: 'react', limit: 9999 },
    });
    expect(plan!.url).toContain('size=10');
  });
});

describe('V26-FIX-04 buildSafeRequest — generic branch', () => {
  it('builds a generic URL using the observed primary query key', () => {
    const m = match({
      site: 'hn.algolia.com',
      urlPattern: 'hn.algolia.com/api/v1/search',
      family: 'observed',
      semanticType: 'search',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['hitsPerPage', 'page', 'query'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, {
      intent: 'search hn',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://news.ycombinator.com/',
      pageRole: null,
      params: { query: 'tabrix' },
    });
    expect(plan).not.toBeNull();
    expect(plan!.builderHint).toBe('generic');
    expect(plan!.dataPurpose).toBe('observed_search');
    expect(plan!.url).toBe('https://hn.algolia.com/api/v1/search?query=tabrix&hitsPerPage=10');
    expect(plan!.requestShapeUsed).toEqual(['hitsPerPage', 'query']);
  });

  it('emits a limit key when the row observed one', () => {
    const m = match({
      site: 'hn.algolia.com',
      urlPattern: 'hn.algolia.com/api/v1/search',
      family: 'observed',
      semanticType: 'search',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['hitsPerPage', 'q'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, {
      intent: 'search hn',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://hn.algolia.com/',
      pageRole: null,
      params: { query: 'tabrix', limit: 7 },
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toContain('q=tabrix');
    expect(plan!.url).toContain('hitsPerPage=7');
    expect(plan!.requestShapeUsed).toEqual(['hitsPerPage', 'q']);
  });

  it('handles wikipedia REST search as a non-platform fixture', () => {
    const m = match({
      site: 'en.wikipedia.org',
      urlPattern: 'en.wikipedia.org/w/rest.php/v1/search/page',
      family: 'observed',
      semanticType: 'search',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['limit', 'q'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, {
      intent: 'search wikipedia',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://en.wikipedia.org/',
      pageRole: null,
      params: { query: 'einstein', limit: 3 },
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toBe('https://en.wikipedia.org/w/rest.php/v1/search/page?q=einstein&limit=3');
  });

  it('refuses to ship a URL with literal :placeholder segments', () => {
    const m = match({
      urlPattern: 'api.unknown.com/users/:user/items',
      family: 'observed',
      semanticType: 'list',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['q'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, { ...baseDataNeed, params: { query: 'foo' } });
    expect(plan).toBeNull();
  });

  it('refuses when caller asks for search but supplies no value', () => {
    const m = match({
      urlPattern: 'api.example.com/items',
      family: 'observed',
      semanticType: 'search',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['q'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, { ...baseDataNeed, params: {} });
    expect(plan).toBeNull();
  });

  it('refuses POST/non-GET methods even with seed urlPattern', () => {
    const m = match({
      site: 'api.github.com',
      urlPattern: 'api.github.com/search/repositories',
      method: 'POST',
      family: 'github',
      semanticType: 'search',
    });
    const plan = buildSafeRequest(m, { ...baseDataNeed, params: { query: 'tabrix' } });
    expect(plan).toBeNull();
  });

  it('refuses generic build when no observed query keys exist and a value is supplied', () => {
    const m = match({
      urlPattern: 'api.example.com/items',
      family: 'observed',
      semanticType: 'list',
      requestSummary: {
        headerKeys: [],
        queryKeys: [],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, {
      intent: 'list items',
      intentClass: 'read_only',
      semanticTypeWanted: null,
      urlHint: 'https://api.example.com/',
      pageRole: null,
      params: { query: 'foo' },
    });
    expect(plan).toBeNull();
  });
});
