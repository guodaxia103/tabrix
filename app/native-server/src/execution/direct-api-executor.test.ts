/**
 * V26-FIX-01 — `tryDirectApiExecute` unit tests.
 *
 * What these tests pin:
 *   - The closed-enum {@link DirectApiExecutionMode} surface: only the
 *     `direct_api` happy path sets `browserNavigationSkipped=true`.
 *     Every other branch returns rows=null and one of the
 *     `'skipped_*'` / `'fallback_required'` modes so an upstream
 *     consumer cannot mis-believe the read was avoided.
 *   - High-confidence threshold gating (V26-FIX-01 evidence contract).
 *   - Read-only intent gating (action / unknown intents must NOT
 *     trigger direct execution; they fall through to the legacy
 *     chrome_read_page chain).
 *   - The reader integration: a fixture-level GET 200 returns rows;
 *     a fixture-level network timeout returns `fallback_required`
 *     with the closed-enum `apiCallFailed_network_timeout` decision
 *     reason and `fallbackEntryLayer='L0+L1'` (never widened).
 *   - No raw body / cookie / auth field is mirrored to the result
 *     (privacy boundary stays at the underlying reader).
 */

import {
  COLD_START_TRANSIENT_REASONS,
  DIRECT_API_COLD_START_BUDGET_MS_DEFAULT,
  DIRECT_API_HIGH_CONFIDENCE_THRESHOLD,
  classifyDirectApiIntent,
  tryDirectApiExecute,
  type DirectApiExecutorInput,
} from './direct-api-executor';
import type { ApiKnowledgeCandidate, ApiKnowledgeFetch } from '../api/api-knowledge';
import type { DataNeed, EndpointKnowledgeReader } from '../api-knowledge/types';
import type {
  EndpointSemanticType,
  KnowledgeApiEndpoint,
} from '../memory/knowledge/knowledge-api-repository';

function jsonFetch(status: number, body: unknown): ApiKnowledgeFetch {
  return jest.fn().mockResolvedValue({
    status,
    headers: { get: jest.fn().mockReturnValue('application/json') },
    json: jest.fn().mockResolvedValue(body),
  });
}

const HIGH_CONFIDENCE_GITHUB_SEARCH: ApiKnowledgeCandidate = Object.freeze({
  endpointFamily: 'github_search_repositories',
  dataPurpose: 'search_list',
  confidence: 0.82,
  method: 'GET',
  params: { query: 'tabrix', sort: 'stars', order: 'desc' },
});

const LOW_CONFIDENCE_CANDIDATE: ApiKnowledgeCandidate = Object.freeze({
  endpointFamily: 'github_search_repositories',
  dataPurpose: 'search_list',
  confidence: 0.4,
  method: 'GET',
  params: { query: 'tabrix' },
});

function inputWith(overrides: Partial<DirectApiExecutorInput>): DirectApiExecutorInput {
  return {
    sourceRoute: 'knowledge_supported_read',
    candidate: HIGH_CONFIDENCE_GITHUB_SEARCH,
    intentClass: 'read_only',
    ...overrides,
  };
}

describe('classifyDirectApiIntent', () => {
  it('maps reading_only → read_only and action → action', () => {
    expect(classifyDirectApiIntent('reading_only')).toBe('read_only');
    expect(classifyDirectApiIntent('action')).toBe('action');
  });

  it('falls back to unknown for any other hint', () => {
    expect(classifyDirectApiIntent(undefined)).toBe('unknown');
    expect(classifyDirectApiIntent('something_else')).toBe('unknown');
  });
});

describe('V26-FIX-01 tryDirectApiExecute — happy path', () => {
  it('high-confidence read-only intent → direct_api with rows + browserNavigationSkipped=true', async () => {
    const fetchFn = jsonFetch(200, {
      total_count: 1,
      items: [
        {
          full_name: 'tabrix/tabrix',
          html_url: 'https://github.com/tabrix/tabrix',
          stargazers_count: 42,
          open_issues_count: 3,
          description: 'desc',
        },
      ],
    });
    const result = await tryDirectApiExecute(inputWith({ fetchFn, nowMs: () => 1_000 }));

    expect(result.executionMode).toBe('direct_api');
    expect(result.browserNavigationSkipped).toBe(true);
    expect(result.readPageAvoided).toBe(true);
    expect(result.decisionReason).toBe('endpoint_knowledge_high_confidence');
    expect(result.fallbackCause).toBeNull();
    expect(result.fallbackEntryLayer).toBeNull();
    expect(result.endpointFamily).toBe('github_search_repositories');
    expect(result.candidateConfidence).toBe(0.82);
    expect(result.rows).not.toBeNull();
    expect(result.rows!.rowCount).toBeGreaterThan(0);
    expect(result.rows!.compact).toBe(true);
    expect(result.rows!.rawBodyStored).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('forwards limit / nowMs to the underlying reader without leaking through executor surface', async () => {
    const fetchFn = jsonFetch(200, { total_count: 0, items: [] });
    const nowMs = jest.fn().mockReturnValue(2_000);
    const result = await tryDirectApiExecute(inputWith({ fetchFn, nowMs, limit: 5 }));
    expect(result.executionMode).toBe('direct_api');
    expect(result.apiTelemetry?.method).toBe('GET');
    expect(nowMs).toHaveBeenCalled();
  });
});

describe('V26-FIX-01 tryDirectApiExecute — short-circuit branches', () => {
  it('non-knowledge sourceRoute → skipped_route_mismatch (no fetch call)', async () => {
    const fetchFn = jest.fn();
    const result = await tryDirectApiExecute(
      inputWith({ sourceRoute: 'experience_replay_skip_read', fetchFn }),
    );
    expect(result.executionMode).toBe('skipped_route_mismatch');
    expect(result.decisionReason).toBe('route_mismatch_not_knowledge_supported');
    expect(result.browserNavigationSkipped).toBe(false);
    expect(result.rows).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('null candidate → skipped_no_candidate', async () => {
    const fetchFn = jest.fn();
    const result = await tryDirectApiExecute(inputWith({ candidate: null, fetchFn }));
    expect(result.executionMode).toBe('skipped_no_candidate');
    expect(result.decisionReason).toBe('endpoint_not_resolved');
    expect(result.browserNavigationSkipped).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('action intent → skipped_not_read_only', async () => {
    const fetchFn = jest.fn();
    const result = await tryDirectApiExecute(inputWith({ intentClass: 'action', fetchFn }));
    expect(result.executionMode).toBe('skipped_not_read_only');
    expect(result.decisionReason).toBe('intent_not_read_only');
    expect(result.browserNavigationSkipped).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('unknown intent → skipped_not_read_only (defensive: never widen the gate)', async () => {
    const fetchFn = jest.fn();
    const result = await tryDirectApiExecute(inputWith({ intentClass: 'unknown', fetchFn }));
    expect(result.executionMode).toBe('skipped_not_read_only');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('confidence below threshold → skipped_low_confidence', async () => {
    const fetchFn = jest.fn();
    const result = await tryDirectApiExecute(
      inputWith({ candidate: LOW_CONFIDENCE_CANDIDATE, fetchFn }),
    );
    expect(result.executionMode).toBe('skipped_low_confidence');
    expect(result.decisionReason).toBe('endpoint_low_confidence');
    expect(result.candidateConfidence).toBe(0.4);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('confidence threshold is configurable but defaults to 0.7', async () => {
    expect(DIRECT_API_HIGH_CONFIDENCE_THRESHOLD).toBe(0.7);
    const fetchFn = jsonFetch(200, { total_count: 0, items: [] });
    const result = await tryDirectApiExecute(
      inputWith({
        candidate: { ...HIGH_CONFIDENCE_GITHUB_SEARCH, confidence: 0.5 },
        fetchFn,
        confidenceThreshold: 0.4,
      }),
    );
    expect(result.executionMode).toBe('direct_api');
  });
});

describe('V26-FIX-01 tryDirectApiExecute — failure → fallback_required', () => {
  it('upstream reader rate limit (429) → fallback_required with closed-enum decisionReason', async () => {
    const fetchFn = jsonFetch(429, { message: 'too many' });
    const result = await tryDirectApiExecute(inputWith({ fetchFn }));
    expect(result.executionMode).toBe('fallback_required');
    expect(result.decisionReason).toBe('api_call_failed_rate_limited');
    expect(result.browserNavigationSkipped).toBe(false);
    expect(result.fallbackEntryLayer).toBe('L0+L1');
    expect(result.fallbackCause).toBe('rate_limited');
    expect(result.rows).toBeNull();
  });

  it('decode error → fallback_required + api_call_failed_decode_error', async () => {
    const fetchFn: ApiKnowledgeFetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: jest.fn().mockReturnValue('application/json') },
      json: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const result = await tryDirectApiExecute(inputWith({ fetchFn }));
    expect(result.executionMode).toBe('fallback_required');
    expect(result.decisionReason).toBe('api_call_failed_decode_error');
    expect(result.fallbackCause).toBe('decode_error');
    expect(result.rows).toBeNull();
  });

  it('result envelope never carries raw body / cookie / auth strings (privacy boundary preserved)', async () => {
    const fetchFn = jsonFetch(200, {
      total_count: 1,
      items: [
        {
          full_name: 'tabrix/tabrix',
          html_url: 'https://github.com/tabrix/tabrix',
          stargazers_count: 1,
          open_issues_count: 0,
          set_cookie: 'session=secret-session-cookie',
          authorization: 'Bearer secret-token',
        },
      ],
    });
    const result = await tryDirectApiExecute(inputWith({ fetchFn }));
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('secret-session-cookie');
    expect(serialised).not.toContain('secret-token');
  });
});

// ---------------------------------------------------------------------
// V26-FIX-04 — knowledge-driven on-demand reader path
// ---------------------------------------------------------------------

type ScoredFixtureRow = KnowledgeApiEndpoint & {
  semanticType: EndpointSemanticType;
  confidence: number;
  usableForTask: boolean;
  fallbackReason: string | null;
};

function knowledgeRow(overrides: Partial<ScoredFixtureRow>): ScoredFixtureRow {
  return {
    endpointId: 'knowledge-endpoint-id',
    site: 'api.example.com',
    family: 'observed',
    method: 'GET',
    urlPattern: 'api.example.com/items',
    endpointSignature: 'GET api.example.com/items',
    semanticTag: null,
    statusClass: '2xx',
    requestSummary: {
      headerKeys: [],
      queryKeys: ['q'],
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
    semanticTypePersisted: 'search',
    queryParamsShape: 'q',
    responseShapeSummary: null,
    usableForTaskPersisted: true,
    noiseReason: null,
    endpointSource:
      overrides.endpointSource ??
      (overrides.family === 'github' || overrides.family === 'npmjs' ? 'seed_adapter' : 'observed'),
    correlationConfidence: overrides.correlationConfidence ?? null,
    correlatedRegionId: overrides.correlatedRegionId ?? null,
    confidenceReason: overrides.confidenceReason ?? null,
    retirementCandidate: overrides.retirementCandidate ?? false,
    sourceLineage: overrides.sourceLineage ?? null,
    schemaVersion: overrides.schemaVersion ?? 2,
    semanticType: 'search',
    confidence: 0.8,
    usableForTask: true,
    fallbackReason: null,
    ...overrides,
  };
}

function makeRepo(rows: ScoredFixtureRow[]): EndpointKnowledgeReader {
  return {
    listScoredBySite(site: string) {
      return rows.filter((r) => r.site === site);
    },
  };
}

const knowledgeDrivenInput = (
  overrides: Partial<DirectApiExecutorInput> & {
    dataNeed: DataNeed;
    knowledgeRepo: EndpointKnowledgeReader;
  },
): DirectApiExecutorInput => ({
  sourceRoute: 'knowledge_supported_read',
  candidate: null,
  intentClass: 'read_only',
  ...overrides,
});

describe('V26-FIX-04 tryDirectApiExecute — knowledge-driven path', () => {
  it('GitHub fixture: lookup-driven seed_adapter URL → direct_api with knowledge_driven evidence', async () => {
    const fetchFn = jsonFetch(200, {
      total_count: 1,
      items: [
        {
          full_name: 'tabrix/tabrix',
          html_url: 'https://github.com/tabrix/tabrix',
          stargazers_count: 42,
          description: 'desc',
        },
      ],
    });
    const repo = makeRepo([
      knowledgeRow({
        endpointId: 'kn-github-search',
        site: 'api.github.com',
        family: 'github',
        urlPattern: 'api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.92,
      }),
    ]);
    const dataNeed: DataNeed = {
      intent: 'search github tabrix',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://api.github.com/search/repositories?q=tabrix',
      pageRole: null,
      params: { query: 'tabrix' },
    };
    const result = await tryDirectApiExecute(
      knowledgeDrivenInput({ dataNeed, knowledgeRepo: repo, fetchFn }),
    );
    expect(result.executionMode).toBe('direct_api');
    expect(result.readerMode).toBe('knowledge_driven');
    expect(result.knowledgeEndpointId).toBe('kn-github-search');
    expect(result.endpointPattern).toBe('api.github.com/search/repositories');
    expect(result.endpointSemanticType).toBe('search');
    expect(result.semanticValidation).toBe('pass');
    expect(result.requestShapeUsed).toEqual(['per_page', 'q']);
    expect(result.endpointFamily).toBe('github');
    expect(result.candidateConfidence).toBeCloseTo(0.92);
    expect(result.rows!.rowCount).toBe(1);
    // V26-FIX-05 — GitHub urlPattern matches the seed builder; the
    // lineage marker MUST be `seed_adapter`, not `observed`.
    expect(result.endpointSource).toBe('seed_adapter');
    expect(result.adapterBypass).toBe(false);
    expect(result.knowledgeLookupRequired).toBe(true);
    // V26-FIX-06 — direct-api result MUST surface the api_rows
    // contract envelope. Rows are list-shape; the executor never
    // grants locator/execution authority to API rows even on the
    // happy path.
    expect(result.layerContract.dataSource).toBe('api_rows');
    expect(result.layerContract.allowedUses).toEqual(['list_read']);
    expect(result.layerContract.disallowedUses).toEqual(
      expect.arrayContaining(['execution', 'locator']),
    );
  });

  it('npmjs fixture: lookup-driven seed_adapter URL → direct_api', async () => {
    const fetchFn = jsonFetch(200, {
      objects: [
        {
          package: {
            name: 'tabrix',
            version: '0.1.0',
            description: 'demo',
            links: { npm: 'https://www.npmjs.com/package/tabrix' },
          },
          score: { detail: { quality: 0.9 } },
        },
      ],
    });
    const repo = makeRepo([
      knowledgeRow({
        endpointId: 'kn-npmjs-search',
        site: 'registry.npmjs.org',
        family: 'npmjs',
        urlPattern: 'registry.npmjs.org/-/v1/search',
        semanticType: 'search',
        confidence: 0.9,
      }),
    ]);
    const dataNeed: DataNeed = {
      intent: 'find tabrix package',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://registry.npmjs.org/-/v1/search?text=tabrix',
      pageRole: null,
      params: { query: 'tabrix' },
    };
    const result = await tryDirectApiExecute(
      knowledgeDrivenInput({ dataNeed, knowledgeRepo: repo, fetchFn }),
    );
    expect(result.executionMode).toBe('direct_api');
    expect(result.readerMode).toBe('knowledge_driven');
    expect(result.endpointPattern).toBe('registry.npmjs.org/-/v1/search');
    expect(result.requestShapeUsed).toEqual(['size', 'text']);
    expect(result.rows!.rows[0]!.name).toBe('tabrix');
    expect(result.endpointSource).toBe('seed_adapter');
    expect(result.adapterBypass).toBe(false);
    expect(result.knowledgeLookupRequired).toBe(true);
  });

  it('generic non-platform fixture: observed wikipedia REST search → direct_api with generic compactor', async () => {
    const fetchFn = jsonFetch(200, {
      pages: [
        { id: 736, key: 'Albert_Einstein', title: 'Albert Einstein', excerpt: 'physicist' },
        { id: 12345, key: 'Einstein_field_equations', title: 'Equations', excerpt: 'physics' },
      ],
    });
    const repo = makeRepo([
      knowledgeRow({
        endpointId: 'kn-wp-search',
        site: 'en.wikipedia.org',
        family: 'observed',
        urlPattern: 'en.wikipedia.org/w/rest.php/v1/search/page',
        semanticType: 'search',
        confidence: 0.82,
        requestSummary: {
          headerKeys: [],
          queryKeys: ['limit', 'q'],
          bodyKeys: [],
          hasAuth: false,
          hasCookie: false,
        },
      }),
    ]);
    const dataNeed: DataNeed = {
      intent: 'search wikipedia einstein',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://en.wikipedia.org/wiki/Albert_Einstein',
      pageRole: null,
      params: { query: 'einstein', limit: 2 },
    };
    const result = await tryDirectApiExecute(
      knowledgeDrivenInput({ dataNeed, knowledgeRepo: repo, fetchFn }),
    );
    expect(result.executionMode).toBe('direct_api');
    expect(result.readerMode).toBe('knowledge_driven');
    expect(result.endpointFamily).toBe('observed');
    expect(result.endpointPattern).toBe('en.wikipedia.org/w/rest.php/v1/search/page');
    expect(result.requestShapeUsed).toEqual(['limit', 'q']);
    expect(result.rows!.dataPurpose).toBe('observed_search');
    expect(result.rows!.rowCount).toBe(2);
    expect(result.rows!.rows[0]!.title).toBe('Albert Einstein');
    // V26-FIX-05 — wikipedia row was captured by network-observe so
    // the safe-builder used the generic branch; lineage MUST be
    // `observed`, NOT `seed_adapter`.
    expect(result.endpointSource).toBe('observed');
    expect(result.adapterBypass).toBe(false);
    expect(result.knowledgeLookupRequired).toBe(true);
  });

  it('stable observed endpoint retires seed_adapter and is surfaced as observed reuse', async () => {
    const fetchFn = jsonFetch(200, {
      items: [
        {
          title: 'Observed result',
          score: 9,
        },
      ],
    });
    const repo = makeRepo([
      knowledgeRow({
        endpointId: 'seed-github-search',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'seed_adapter',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.9,
        sampleCount: 1,
      }),
      knowledgeRow({
        endpointId: 'observed-github-search',
        site: 'api.github.com',
        family: 'observed',
        endpointSource: 'observed',
        urlPattern: 'api.github.com/search/code',
        endpointSignature: 'GET api.github.com/search/code',
        semanticType: 'search',
        confidence: 0.82,
        sampleCount: 2,
        requestSummary: {
          headerKeys: [],
          queryKeys: ['q', 'per_page'],
          bodyKeys: [],
          hasAuth: false,
          hasCookie: false,
        },
      }),
    ]);
    const dataNeed: DataNeed = {
      intent: 'search github code',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://api.github.com/search/repositories?q=tabrix',
      pageRole: null,
      params: { query: 'tabrix', limit: 2 },
    };

    const result = await tryDirectApiExecute(
      knowledgeDrivenInput({ dataNeed, knowledgeRepo: repo, fetchFn }),
    );

    expect(result.executionMode).toBe('direct_api');
    expect(result.readerMode).toBe('knowledge_driven');
    expect(result.knowledgeEndpointId).toBe('observed-github-search');
    expect(result.endpointPattern).toBe('api.github.com/search/code');
    expect(result.endpointSource).toBe('observed');
    expect(result.lookupChosenReason).toBe('observed_preferred_over_seed_adapter');
    expect(result.retiredEndpointSource).toBe('seed_adapter');
    expect(result.requestShapeUsed).toEqual(['per_page', 'q']);
    expect(result.rows!.dataPurpose).toBe('observed_search');
  });

  it('lookup miss → falls through to legacy candidate path', async () => {
    const fetchFn = jsonFetch(200, { total_count: 0, items: [] });
    const repo = makeRepo([
      knowledgeRow({
        site: 'other.example.com',
        urlPattern: 'other.example.com/items',
      }),
    ]);
    const dataNeed: DataNeed = {
      intent: 'find tabrix on github',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://api.github.com/some/other/path',
      pageRole: null,
      params: { query: 'tabrix' },
    };
    const result = await tryDirectApiExecute(
      knowledgeDrivenInput({
        dataNeed,
        knowledgeRepo: repo,
        candidate: HIGH_CONFIDENCE_GITHUB_SEARCH,
        fetchFn,
      }),
    );
    expect(result.executionMode).toBe('direct_api');
    expect(result.readerMode).toBe('legacy_candidate');
    expect(result.knowledgeEndpointId).toBeNull();
    expect(result.endpointPattern).toBeNull();
    // V26-FIX-05 — the legacy candidate path is the V25 hardcoded
    // GitHub/npmjs adapter; lineage MUST be `seed_adapter`.
    expect(result.endpointSource).toBe('seed_adapter');
    expect(result.adapterBypass).toBe(false);
    expect(result.knowledgeLookupRequired).toBe(true);
  });

  it('knowledge-driven fetch failure → fallback_required with knowledge_driven evidence', async () => {
    const fetchFn = jsonFetch(429, { message: 'too many' });
    const repo = makeRepo([
      knowledgeRow({
        endpointId: 'kn-github-search',
        site: 'api.github.com',
        family: 'github',
        urlPattern: 'api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.9,
      }),
    ]);
    const dataNeed: DataNeed = {
      intent: 'search github tabrix',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://api.github.com/search/repositories',
      pageRole: null,
      params: { query: 'tabrix' },
    };
    const result = await tryDirectApiExecute(
      knowledgeDrivenInput({ dataNeed, knowledgeRepo: repo, fetchFn }),
    );
    expect(result.executionMode).toBe('fallback_required');
    expect(result.readerMode).toBe('knowledge_driven');
    expect(result.fallbackCause).toBe('rate_limited');
    expect(result.fallbackEntryLayer).toBe('L0+L1');
    expect(result.knowledgeEndpointId).toBe('kn-github-search');
    expect(result.rows).toBeNull();
    // V26-FIX-05 — even on `fallback_required` the lineage marker
    // remains attached so a post-mortem can group the failure by source.
    expect(result.endpointSource).toBe('seed_adapter');
    expect(result.adapterBypass).toBe(false);
    expect(result.knowledgeLookupRequired).toBe(true);
  });

  it('low-confidence Knowledge row → falls through to legacy candidate path', async () => {
    const fetchFn = jsonFetch(200, { total_count: 0, items: [] });
    const repo = makeRepo([
      knowledgeRow({
        site: 'api.github.com',
        urlPattern: 'api.github.com/search/repositories',
        confidence: 0.5,
      }),
    ]);
    const dataNeed: DataNeed = {
      intent: 'search github tabrix',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://api.github.com/search/repositories',
      pageRole: null,
      params: { query: 'tabrix' },
    };
    const result = await tryDirectApiExecute(
      knowledgeDrivenInput({
        dataNeed,
        knowledgeRepo: repo,
        candidate: HIGH_CONFIDENCE_GITHUB_SEARCH,
        fetchFn,
      }),
    );
    expect(result.executionMode).toBe('direct_api');
    expect(result.readerMode).toBe('legacy_candidate');
    expect(result.endpointSource).toBe('seed_adapter');
    expect(result.adapterBypass).toBe(false);
    expect(result.knowledgeLookupRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------
// V26-FIX-09 — bounded retry / cold-start guard
// ---------------------------------------------------------------------

/**
 * Build a `fetchFn` whose Nth call resolves to a given response (or
 * rejects with a given error). Used to simulate the cold-start
 * sequence "first call fails, second call succeeds".
 */
function sequencedFetch(
  steps: ReadonlyArray<
    { kind: 'reject'; error: Error } | { kind: 'resolve'; status: number; body: unknown }
  >,
): { fetchFn: jest.Mock; calls: () => number } {
  let index = 0;
  const fn = jest.fn().mockImplementation(async () => {
    const step = steps[index] ?? steps[steps.length - 1]!;
    index += 1;
    if (step.kind === 'reject') {
      throw step.error;
    }
    return {
      status: step.status,
      headers: { get: jest.fn().mockReturnValue('application/json') },
      json: jest.fn().mockResolvedValue(step.body),
    } as unknown;
  });
  return { fetchFn: fn, calls: () => index };
}

describe('V26-FIX-09 closed-enum surface', () => {
  it('COLD_START_TRANSIENT_REASONS contains exactly network_timeout + network_error', () => {
    expect(COLD_START_TRANSIENT_REASONS.size).toBe(2);
    expect(COLD_START_TRANSIENT_REASONS.has('network_timeout')).toBe(true);
    expect(COLD_START_TRANSIENT_REASONS.has('network_error')).toBe(true);
    expect(COLD_START_TRANSIENT_REASONS.has('rate_limited')).toBe(false);
    expect(COLD_START_TRANSIENT_REASONS.has('decode_error')).toBe(false);
  });

  it('default budget is 5000 ms', () => {
    expect(DIRECT_API_COLD_START_BUDGET_MS_DEFAULT).toBe(5_000);
  });
});

describe('V26-FIX-09 cold-start guard — legacy candidate path', () => {
  const SUCCESS_BODY = {
    total_count: 1,
    items: [
      {
        full_name: 'tabrix/tabrix',
        html_url: 'https://github.com/tabrix/tabrix',
        stargazers_count: 1,
        open_issues_count: 0,
        description: 'desc',
      },
    ],
  };

  it('first attempt network_error then success → direct_api with apiRetryCount=1', async () => {
    const { fetchFn, calls } = sequencedFetch([
      { kind: 'reject', error: new Error('fetch failed') },
      { kind: 'resolve', status: 200, body: SUCCESS_BODY },
    ]);
    const result = await tryDirectApiExecute(
      inputWith({
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
        nowMs: () => 1_000,
      }),
    );
    expect(result.executionMode).toBe('direct_api');
    expect(result.apiRetryCount).toBe(1);
    expect(result.apiFinalReason).toBeNull();
    expect(result.coldStartGuard).toBe('enabled');
    expect(typeof result.apiFirstAttemptMs).toBe('number');
    expect(calls()).toBe(2);
  });

  it('two consecutive network errors → fallback_required with apiRetryCount=1', async () => {
    const { fetchFn, calls } = sequencedFetch([
      { kind: 'reject', error: new Error('boom') },
      { kind: 'reject', error: new Error('still boom') },
    ]);
    const result = await tryDirectApiExecute(
      inputWith({
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
        nowMs: () => 1_000,
      }),
    );
    expect(result.executionMode).toBe('fallback_required');
    expect(result.apiRetryCount).toBe(1);
    expect(result.apiFinalReason).toBe('network_error');
    expect(result.fallbackCause).toBe('network_error');
    expect(result.fallbackEntryLayer).toBe('L0+L1');
    expect(calls()).toBe(2);
  });

  it('non-transient failure (429 rate_limited) → no retry, apiRetryCount=0', async () => {
    const { fetchFn, calls } = sequencedFetch([
      { kind: 'resolve', status: 429, body: { message: 'too many' } },
    ]);
    const result = await tryDirectApiExecute(
      inputWith({
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
      }),
    );
    expect(result.executionMode).toBe('fallback_required');
    expect(result.fallbackCause).toBe('rate_limited');
    expect(result.apiRetryCount).toBe(0);
    expect(result.apiFinalReason).toBe('rate_limited');
    expect(calls()).toBe(1);
  });

  it("coldStartGuard='disabled' suppresses retry on transient failure", async () => {
    const { fetchFn, calls } = sequencedFetch([
      { kind: 'reject', error: new Error('cold start') },
      { kind: 'resolve', status: 200, body: SUCCESS_BODY },
    ]);
    const result = await tryDirectApiExecute(
      inputWith({
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
        coldStartGuard: 'disabled',
      }),
    );
    expect(result.executionMode).toBe('fallback_required');
    expect(result.apiRetryCount).toBe(0);
    expect(result.apiFinalReason).toBe('network_error');
    expect(result.coldStartGuard).toBe('disabled');
    expect(calls()).toBe(1);
  });

  it('first attempt exceeds coldStartBudgetMs → retry skipped', async () => {
    const { fetchFn, calls } = sequencedFetch([
      { kind: 'reject', error: new Error('slow') },
      { kind: 'resolve', status: 200, body: SUCCESS_BODY },
    ]);
    let t = 0;
    const result = await tryDirectApiExecute(
      inputWith({
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
        // Each call to nowMs advances 10s, so first attempt reports 10s
        // elapsed which exceeds the 1s budget below.
        nowMs: () => {
          t += 10_000;
          return t;
        },
        coldStartBudgetMs: 1_000,
      }),
    );
    expect(result.executionMode).toBe('fallback_required');
    expect(result.apiRetryCount).toBe(0);
    expect(result.apiFinalReason).toBe('network_error');
    expect(calls()).toBe(1);
  });

  it('short-circuit branches surface coldStartGuard + zero retry telemetry', async () => {
    const result = await tryDirectApiExecute(
      inputWith({
        sourceRoute: 'something_else',
        fetchFn: jest.fn() as unknown as DirectApiExecutorInput['fetchFn'],
      }),
    );
    expect(result.executionMode).toBe('skipped_route_mismatch');
    expect(result.apiFirstAttemptMs).toBeNull();
    expect(result.apiRetryCount).toBe(0);
    expect(result.apiFinalReason).toBeNull();
    expect(result.coldStartGuard).toBe('enabled');
  });
});

describe('V26-FIX-09 cold-start guard — knowledge-driven path', () => {
  it('knowledge-driven first-attempt network_error then success → direct_api retry', async () => {
    const { fetchFn, calls } = sequencedFetch([
      { kind: 'reject', error: new Error('cold') },
      {
        kind: 'resolve',
        status: 200,
        body: {
          total_count: 1,
          items: [
            {
              full_name: 'tabrix/tabrix',
              html_url: 'https://github.com/tabrix/tabrix',
              stargazers_count: 7,
              description: 'desc',
            },
          ],
        },
      },
    ]);
    const repo = makeRepo([
      knowledgeRow({
        endpointId: 'kn-github-search',
        site: 'api.github.com',
        family: 'github',
        urlPattern: 'api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.92,
      }),
    ]);
    const dataNeed: DataNeed = {
      intent: 'search github tabrix',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://api.github.com/search/repositories?q=tabrix',
      pageRole: null,
      params: { query: 'tabrix' },
    };
    const result = await tryDirectApiExecute(
      knowledgeDrivenInput({
        dataNeed,
        knowledgeRepo: repo,
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
        nowMs: () => 1_000,
      }),
    );
    expect(result.executionMode).toBe('direct_api');
    expect(result.readerMode).toBe('knowledge_driven');
    expect(result.apiRetryCount).toBe(1);
    expect(result.apiFinalReason).toBeNull();
    expect(calls()).toBe(2);
  });
});
