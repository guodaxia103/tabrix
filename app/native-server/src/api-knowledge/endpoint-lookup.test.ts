/**
 * V26-FIX-04 — `lookupEndpointFamily` unit tests.
 *
 * Pins the closed-enum lookup contract:
 *   - returns null when the urlHint host cannot be derived
 *   - returns null when the repository has no rows for the site
 *   - returns null when no row meets the confidence floor
 *   - prefers the highest-confidence row matching the wanted
 *     semanticType, with `semanticValidation='pass'`
 *   - falls back to "any usable" with `semanticValidation='fail'`
 *     when no semantic-matching row exists
 *   - rejects `usableForTask=false` rows (mutation/asset/etc.)
 *
 * The repository fixture is structural (no SQLite) so the tests can
 * pin every score deterministically.
 */

import { lookupEndpointFamily, KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR } from './endpoint-lookup';
import type {
  KnowledgeApiEndpoint,
  EndpointSemanticType,
} from '../memory/knowledge/knowledge-api-repository';
import type { DataNeed, EndpointKnowledgeReader } from './types';

type ScoredFixtureRow = KnowledgeApiEndpoint & {
  semanticType: EndpointSemanticType;
  confidence: number;
  usableForTask: boolean;
  fallbackReason: string | null;
};

function endpoint(overrides: Partial<ScoredFixtureRow>): ScoredFixtureRow {
  return {
    endpointId: overrides.endpointId ?? 'e-1',
    site: overrides.site ?? 'api.example.com',
    family: overrides.family ?? 'observed',
    method: overrides.method ?? 'GET',
    urlPattern: overrides.urlPattern ?? 'api.example.com/items',
    endpointSignature: overrides.endpointSignature ?? 'GET api.example.com/items',
    semanticTag: overrides.semanticTag ?? null,
    statusClass: overrides.statusClass ?? '2xx',
    requestSummary: overrides.requestSummary ?? {
      headerKeys: [],
      queryKeys: [],
      bodyKeys: [],
      hasAuth: false,
      hasCookie: false,
    },
    responseSummary: overrides.responseSummary ?? {
      contentType: 'application/json',
      sizeBytes: 1024,
      shape: { kind: 'array', itemCount: 5, sampleItemKeys: ['id', 'name'] },
    },
    sourceSessionId: overrides.sourceSessionId ?? null,
    sourceStepId: overrides.sourceStepId ?? null,
    sourceHistoryRef: overrides.sourceHistoryRef ?? null,
    sampleCount: overrides.sampleCount ?? 1,
    firstSeenAt: overrides.firstSeenAt ?? '2026-01-01T00:00:00Z',
    lastSeenAt: overrides.lastSeenAt ?? '2026-01-01T00:00:00Z',
    semanticTypePersisted: overrides.semanticTypePersisted ?? overrides.semanticType ?? 'list',
    queryParamsShape: overrides.queryParamsShape ?? null,
    responseShapeSummary: overrides.responseShapeSummary ?? null,
    usableForTaskPersisted:
      overrides.usableForTaskPersisted !== undefined
        ? overrides.usableForTaskPersisted
        : (overrides.usableForTask ?? true),
    noiseReason: overrides.noiseReason ?? null,
    endpointSource:
      overrides.endpointSource ??
      (overrides.family === 'github' || overrides.family === 'npmjs' ? 'seed_adapter' : 'observed'),
    correlationConfidence: overrides.correlationConfidence ?? null,
    correlatedRegionId: overrides.correlatedRegionId ?? null,
    confidenceReason: overrides.confidenceReason ?? null,
    retirementCandidate: overrides.retirementCandidate ?? false,
    sourceLineage: overrides.sourceLineage ?? null,
    schemaVersion: overrides.schemaVersion ?? 2,
    semanticType: overrides.semanticType ?? 'list',
    confidence: overrides.confidence ?? 0.8,
    usableForTask: overrides.usableForTask ?? true,
    fallbackReason: overrides.fallbackReason ?? null,
  };
}

function makeRepo(rows: ScoredFixtureRow[]): EndpointKnowledgeReader {
  return {
    listScoredBySite(site: string) {
      const filtered = rows.filter((r) => r.site === site);
      filtered.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      });
      return filtered;
    },
  };
}

const baseDataNeed: DataNeed = {
  intent: 'find issues about login',
  intentClass: 'read_only',
  semanticTypeWanted: 'search',
  urlHint: 'https://api.example.com/items?foo=bar',
  pageRole: null,
};

describe('V26-FIX-04 lookupEndpointFamily', () => {
  it('returns null when urlHint is missing', () => {
    const repo = makeRepo([endpoint({})]);
    const match = lookupEndpointFamily({ ...baseDataNeed, urlHint: null }, repo);
    expect(match).toBeNull();
  });

  it('returns null when urlHint cannot be parsed', () => {
    const repo = makeRepo([endpoint({})]);
    const match = lookupEndpointFamily({ ...baseDataNeed, urlHint: 'not a url' }, repo);
    expect(match).toBeNull();
  });

  it('returns null when no rows exist for the host', () => {
    const repo = makeRepo([endpoint({ site: 'other.example.com' })]);
    const match = lookupEndpointFamily(baseDataNeed, repo);
    expect(match).toBeNull();
  });

  it('returns null when only un-usable rows exist', () => {
    const repo = makeRepo([
      endpoint({
        usableForTask: false,
        fallbackReason: 'noise_endpoint',
        semanticType: 'analytics',
      }),
    ]);
    const match = lookupEndpointFamily(baseDataNeed, repo);
    expect(match).toBeNull();
  });

  it('returns null when the best row is below the confidence floor', () => {
    expect(KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR).toBe(0.7);
    const repo = makeRepo([
      endpoint({ confidence: 0.5, semanticType: 'search' }),
      endpoint({ endpointId: 'e-2', confidence: 0.6, semanticType: 'list' }),
    ]);
    const match = lookupEndpointFamily(baseDataNeed, repo);
    expect(match).toBeNull();
  });

  it('prefers the highest-confidence row matching the wanted semanticType (pass)', () => {
    const repo = makeRepo([
      endpoint({ endpointId: 'list-row', confidence: 0.85, semanticType: 'list' }),
      endpoint({ endpointId: 'search-row', confidence: 0.78, semanticType: 'search' }),
    ]);
    const match = lookupEndpointFamily({ ...baseDataNeed, semanticTypeWanted: 'search' }, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('search-row');
    expect(match!.semanticValidation).toBe('pass');
    expect(match!.score).toBe(0.78);
  });

  it('falls back to any usable row when no semanticType match exists (fail)', () => {
    const repo = makeRepo([
      endpoint({ endpointId: 'list-row', confidence: 0.9, semanticType: 'list' }),
    ]);
    const match = lookupEndpointFamily({ ...baseDataNeed, semanticTypeWanted: 'detail' }, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('list-row');
    expect(match!.semanticValidation).toBe('fail');
    // 0.9 - 0.05 penalty = 0.85
    expect(match!.score).toBeCloseTo(0.85);
  });

  it('treats null semanticTypeWanted as "any usable"', () => {
    const repo = makeRepo([
      endpoint({ endpointId: 'detail-row', confidence: 0.9, semanticType: 'detail' }),
      endpoint({ endpointId: 'list-row', confidence: 0.85, semanticType: 'list' }),
    ]);
    const match = lookupEndpointFamily({ ...baseDataNeed, semanticTypeWanted: null }, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('detail-row');
    expect(match!.semanticValidation).toBe('pass');
  });

  it('breaks ties on sampleCount when confidence is equal', () => {
    const repo = makeRepo([
      endpoint({ endpointId: 'fewer', confidence: 0.85, semanticType: 'list', sampleCount: 1 }),
      endpoint({ endpointId: 'more', confidence: 0.85, semanticType: 'list', sampleCount: 5 }),
    ]);
    const match = lookupEndpointFamily({ ...baseDataNeed, semanticTypeWanted: 'list' }, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('more');
  });

  it('rejects mutation rows even if confidence is high', () => {
    const repo = makeRepo([
      endpoint({
        confidence: 0.95,
        semanticType: 'mutation',
        method: 'POST',
        usableForTask: false,
        fallbackReason: 'non_read_method',
      }),
    ]);
    const match = lookupEndpointFamily({ ...baseDataNeed, semanticTypeWanted: null }, repo);
    expect(match).toBeNull();
  });

  it('handles a non-platform host (e.g. wikipedia REST search)', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'wp',
        site: 'en.wikipedia.org',
        urlPattern: 'en.wikipedia.org/w/rest.php/v1/search/page',
        family: 'observed',
        confidence: 0.82,
        semanticType: 'search',
      }),
    ]);
    const match = lookupEndpointFamily(
      {
        ...baseDataNeed,
        urlHint: 'https://en.wikipedia.org/wiki/Albert_Einstein',
        semanticTypeWanted: 'search',
      },
      repo,
    );
    expect(match).not.toBeNull();
    expect(match!.endpoint.site).toBe('en.wikipedia.org');
    expect(match!.semanticValidation).toBe('pass');
  });
});

// ---------------------------------------------------------------------
// V27-08 — observed-vs-seed_adapter retirement.
//
// Brief: "如果同一 site family 的 observed endpoint 在多个
// session/sample 中稳定命中，且 fallback rate 低，observed 应优先于
// seed_adapter." Plus: seed_adapter rows are NEVER deleted; the
// retirement is only a re-ranking + lineage marker so a downstream
// report can tell which lineage is winning.
// ---------------------------------------------------------------------
describe('V27-08 lookupEndpointFamily — observed-vs-seed_adapter retirement', () => {
  const githubDataNeed: DataNeed = {
    intent: 'search github repositories',
    intentClass: 'read_only',
    semanticTypeWanted: 'search',
    urlHint: 'https://api.github.com/search/repositories?q=tabrix',
    pageRole: null,
  };

  it('observed peer with sampleCount ≥ 2 retires the seed_adapter peer', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'seed-row',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'seed_adapter',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.85,
        sampleCount: 1,
      }),
      endpoint({
        endpointId: 'observed-row',
        site: 'api.github.com',
        family: 'observed',
        endpointSource: 'observed',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.82,
        sampleCount: 4,
      }),
    ]);
    const match = lookupEndpointFamily(githubDataNeed, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('observed-row');
    expect(match!.endpointSource).toBe('observed');
    expect(match!.chosenReason).toBe('observed_preferred_over_seed_adapter');
    expect(match!.retiredPeer).not.toBeNull();
    expect(match!.retiredPeer!.endpointSource).toBe('seed_adapter');
    expect(match!.retiredPeer!.endpointSignature).toBe('GET api.github.com/search/repositories');
    expect(match!.retiredPeer!.confidence).toBeCloseTo(0.85);
    expect(match!.retiredPeer!.sampleCount).toBe(1);
  });

  it('observed peer with sampleCount = 1 does NOT retire the seed_adapter peer', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'seed-row',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'seed_adapter',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.85,
        sampleCount: 5,
      }),
      endpoint({
        endpointId: 'observed-row',
        site: 'api.github.com',
        family: 'observed',
        endpointSource: 'observed',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.82,
        sampleCount: 1,
      }),
    ]);
    const match = lookupEndpointFamily(githubDataNeed, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('seed-row');
    expect(match!.endpointSource).toBe('seed_adapter');
    expect(match!.chosenReason).toBe('seed_adapter_fallback');
    expect(match!.retiredPeer).toBeNull();
  });

  it('observed peer below confidence floor does NOT retire the seed_adapter peer', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'seed-row',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'seed_adapter',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.9,
        sampleCount: 3,
      }),
      endpoint({
        endpointId: 'observed-row',
        site: 'api.github.com',
        family: 'observed',
        endpointSource: 'observed',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.65,
        sampleCount: 5,
      }),
    ]);
    const match = lookupEndpointFamily(githubDataNeed, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('seed-row');
    expect(match!.endpointSource).toBe('seed_adapter');
    expect(match!.chosenReason).toBe('seed_adapter_fallback');
    expect(match!.retiredPeer).toBeNull();
  });

  it('different semantic types between observed and seed_adapter do not trigger retirement', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'seed-row',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'seed_adapter',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.8,
        sampleCount: 2,
      }),
      endpoint({
        endpointId: 'observed-list',
        site: 'api.github.com',
        family: 'observed',
        endpointSource: 'observed',
        urlPattern: 'api.github.com/repos/:owner/:repo/issues',
        endpointSignature: 'GET api.github.com/repos/:owner/:repo/issues',
        semanticType: 'list',
        confidence: 0.95,
        sampleCount: 10,
      }),
    ]);
    const match = lookupEndpointFamily({ ...githubDataNeed, semanticTypeWanted: 'search' }, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('seed-row');
    expect(match!.chosenReason).toBe('seed_adapter_fallback');
    expect(match!.retiredPeer).toBeNull();
  });

  it('observed-only site reports observed_only_match (no seed peer)', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'wikipedia-search',
        site: 'en.wikipedia.org',
        family: 'observed',
        endpointSource: 'observed',
        urlPattern: 'en.wikipedia.org/w/rest.php/v1/search/page',
        endpointSignature: 'GET en.wikipedia.org/w/rest.php/v1/search/page',
        semanticType: 'search',
        confidence: 0.82,
        sampleCount: 4,
      }),
    ]);
    const match = lookupEndpointFamily(
      {
        ...baseDataNeed,
        urlHint: 'https://en.wikipedia.org/wiki/Albert_Einstein',
        semanticTypeWanted: 'search',
      },
      repo,
    );
    expect(match).not.toBeNull();
    expect(match!.endpointSource).toBe('observed');
    expect(match!.chosenReason).toBe('observed_only_match');
    expect(match!.retiredPeer).toBeNull();
  });

  it('legacy row (no endpointSource set, family=observed) still looks up correctly', () => {
    // Reproduce a legacy row by overriding the back-derivation: the
    // fixture builder defaults endpointSource to a value derived from
    // `family`, so a legacy row coming straight from the v1 capture
    // path would surface as `observed`. We assert the lookup still
    // returns it without crashing on the now-required v2 fields.
    const repo = makeRepo([
      endpoint({
        endpointId: 'legacy-observed',
        site: 'en.wikipedia.org',
        family: 'observed',
        endpointSource: 'observed',
        sourceLineage: null,
        correlationConfidence: null,
        schemaVersion: 1,
        urlPattern: 'en.wikipedia.org/w/rest.php/v1/search/page',
        endpointSignature: 'GET en.wikipedia.org/w/rest.php/v1/search/page',
        semanticType: 'search',
        confidence: 0.82,
        sampleCount: 1,
      }),
    ]);
    const match = lookupEndpointFamily(
      {
        ...baseDataNeed,
        urlHint: 'https://en.wikipedia.org/wiki/Albert_Einstein',
        semanticTypeWanted: 'search',
      },
      repo,
    );
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('legacy-observed');
    expect(match!.correlationConfidence).toBeNull();
    expect(match!.endpointSource).toBe('observed');
  });

  it('caps any high_confidence correlation back to low_confidence (single-session invariant)', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'observed-row',
        site: 'api.github.com',
        family: 'observed',
        endpointSource: 'observed',
        // Hypothetical mis-write at the row level — we still cap.
        correlationConfidence: 'high_confidence',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.85,
        sampleCount: 4,
      }),
    ]);
    const match = lookupEndpointFamily(githubDataNeed, repo);
    expect(match).not.toBeNull();
    expect(match!.correlationConfidence).toBe('low_confidence');
  });

  it('seed_adapter winning when no observed peer exists reports seed_adapter_fallback', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'seed-only',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'seed_adapter',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.85,
      }),
    ]);
    const match = lookupEndpointFamily(githubDataNeed, repo);
    expect(match).not.toBeNull();
    expect(match!.endpointSource).toBe('seed_adapter');
    expect(match!.chosenReason).toBe('seed_adapter_fallback');
    expect(match!.retiredPeer).toBeNull();
  });

  it('deprecated_seed-only rows are not executable lookup matches', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'deprecated-only',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'deprecated_seed',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.95,
        sampleCount: 10,
      }),
    ]);
    expect(lookupEndpointFamily(githubDataNeed, repo)).toBeNull();
  });

  it('deprecated_seed does not compete when a qualifying observed row exists', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'deprecated-seed',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'deprecated_seed',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.99,
        sampleCount: 10,
      }),
      endpoint({
        endpointId: 'observed-row',
        site: 'api.github.com',
        family: 'observed',
        endpointSource: 'observed',
        urlPattern: 'api.github.com/search/code',
        endpointSignature: 'GET api.github.com/search/code',
        semanticType: 'search',
        confidence: 0.82,
        sampleCount: 2,
      }),
    ]);
    const match = lookupEndpointFamily(githubDataNeed, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('observed-row');
    expect(match!.endpointSource).toBe('observed');
    expect(match!.retiredPeer).toBeNull();
  });

  it('active seed_adapter remains compatible when deprecated_seed is also present', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'deprecated-seed',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'deprecated_seed',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.99,
        sampleCount: 10,
      }),
      endpoint({
        endpointId: 'active-seed',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'seed_adapter',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.8,
        sampleCount: 1,
      }),
    ]);
    const match = lookupEndpointFamily(githubDataNeed, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('active-seed');
    expect(match!.endpointSource).toBe('seed_adapter');
    expect(match!.retiredPeer).toBeNull();
  });

  it('deprecated_seed never appears as retiredPeer when observed retires an active seed', () => {
    const repo = makeRepo([
      endpoint({
        endpointId: 'deprecated-seed',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'deprecated_seed',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.99,
        sampleCount: 10,
      }),
      endpoint({
        endpointId: 'active-seed',
        site: 'api.github.com',
        family: 'github',
        endpointSource: 'seed_adapter',
        urlPattern: 'api.github.com/search/repositories',
        endpointSignature: 'GET api.github.com/search/repositories',
        semanticType: 'search',
        confidence: 0.8,
        sampleCount: 1,
      }),
      endpoint({
        endpointId: 'observed-row',
        site: 'api.github.com',
        family: 'observed',
        endpointSource: 'observed',
        urlPattern: 'api.github.com/search/code',
        endpointSignature: 'GET api.github.com/search/code',
        semanticType: 'search',
        confidence: 0.82,
        sampleCount: 2,
      }),
    ]);
    const match = lookupEndpointFamily(githubDataNeed, repo);
    expect(match).not.toBeNull();
    expect(match!.endpoint.endpointId).toBe('observed-row');
    expect(match!.retiredPeer?.endpointSource).toBe('seed_adapter');
    expect(match!.retiredPeer?.endpointSource).not.toBe('deprecated_seed');
  });
});
