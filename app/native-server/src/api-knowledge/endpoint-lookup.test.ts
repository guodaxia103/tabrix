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
