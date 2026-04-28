/**
 * V27-06 — Endpoint Candidate Classifier v2 tests.
 *
 * These tests are the load-bearing proof for the brief's three sub-
 * requirements (noise filter / shape summariser / semantic typer) and
 * for the privacy invariant (no value, no header value, no raw
 * query value, no cookie/Authorization). They run pure: no IO, no
 * Date.now(), no env reads.
 *
 * Cross-cite: when adding a fixture here, please mirror the v1
 * counterpart in `network-observe-classifier.test.ts` if it changes
 * the underlying v1 verdict — the two layers must never disagree on
 * the row-level `kind` of the same body.
 */

import { classifyEndpointCandidate, type EndpointShapeSummary } from './network-observe-classifier';
import {
  deriveEndpointCandidateFromRequest,
  deriveEndpointCandidatesFromBundle,
  summarizeEndpointShapeFromCapturedRequest,
  type CapturedNetworkBundle,
  type CapturedNetworkRequest,
} from './api-knowledge-capture';

const EMPTY_HEADERS: Record<string, string> = {};

function shape(partial: Partial<EndpointShapeSummary> = {}): EndpointShapeSummary {
  return {
    kind: 'object',
    topLevelKeys: [],
    rowCount: null,
    sampleItemKeys: [],
    fieldTypes: {},
    sizeClass: 'small',
    contentTypeBucket: 'json',
    available: true,
    ...partial,
  };
}

describe('classifyEndpointCandidate — V27-06 noise filter', () => {
  it('folds favicon paths into noise / noise_favicon', () => {
    const r = classifyEndpointCandidate({
      url: 'https://example.test/favicon.ico',
      method: 'GET',
      mimeType: 'image/x-icon',
    });
    expect(r.semanticType).toBe('noise');
    expect(r.noiseReason).toBe('noise_favicon');
  });

  it('folds source maps into noise / noise_source_map', () => {
    const r = classifyEndpointCandidate({
      url: 'https://cdn.example.test/app.js.map',
      method: 'GET',
      mimeType: 'application/json',
    });
    // v1 catches `.map` via ASSET_EXT_RE → asset; v2 lifts the
    // explicit reason so V27-08 retirement logic can cite it.
    expect(r.semanticType).toBe('noise');
    expect(r.noiseReason).toMatch(/^(noise_source_map|asset_resource)$/);
  });

  it('folds asset/analytics/auth/private/telemetry into one noise bucket', () => {
    const cases: Array<{ url: string; type?: string; mimeType?: string }> = [
      { url: 'https://example.test/app.css', type: 'stylesheet', mimeType: 'text/css' },
      { url: 'https://www.google-analytics.com/collect?v=1' },
      { url: 'https://example.test/oauth/authorize' },
      { url: 'https://example.test/_private/internal/users' },
      { url: 'https://example.test/api/v1/telemetry' },
    ];
    for (const c of cases) {
      const r = classifyEndpointCandidate({
        url: c.url,
        method: 'GET',
        type: c.type,
        mimeType: c.mimeType,
      });
      expect(r.semanticType).toBe('noise');
      expect(r.noiseReason).toBeTruthy();
    }
  });

  it('does not let `_private/browser/stats` into a high-value candidate', () => {
    const r = classifyEndpointCandidate({
      url: 'https://example.test/_private/browser/stats?session=abc',
      method: 'GET',
      mimeType: 'application/json',
    });
    expect(r.semanticType).toBe('noise');
    expect(['private_path', 'telemetry_path']).toContain(r.noiseReason);
  });
});

describe('classifyEndpointCandidate — V27-06 semantic typer', () => {
  it('classifies search GETs as search', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/search?q=tabrix',
      method: 'GET',
      mimeType: 'application/json',
    });
    expect(r.semanticType).toBe('search');
  });

  it('classifies list GETs as list', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items',
      method: 'GET',
      mimeType: 'application/json',
    });
    expect(r.semanticType).toBe('list');
  });

  it('classifies single-resource detail GETs as detail', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items/12345',
      method: 'GET',
      mimeType: 'application/json',
    });
    expect(r.semanticType).toBe('detail');
  });

  it('classifies pagination GETs as pagination', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items?page=3&per_page=20',
      method: 'GET',
      mimeType: 'application/json',
    });
    expect(r.semanticType).toBe('pagination');
  });

  it('classifies filter GETs as filter', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items?state=open&sort=updated',
      method: 'GET',
      mimeType: 'application/json',
    });
    expect(r.semanticType).toBe('filter');
  });

  it('classifies HTML responses as document even on a search-y URL', () => {
    const r = classifyEndpointCandidate({
      url: 'https://example.test/search?q=tabrix',
      method: 'GET',
      mimeType: 'text/html',
    });
    expect(r.semanticType).toBe('document');
    expect(r.noiseReason).toBe('document_response');
  });

  it('classifies 4xx responses as error', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items?q=tabrix',
      method: 'GET',
      mimeType: 'application/json',
      status: 404,
    });
    expect(r.semanticType).toBe('error');
    expect(r.noiseReason).toBe('status_4xx');
  });

  it('classifies 5xx responses as error', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items',
      method: 'GET',
      mimeType: 'application/json',
      status: 502,
    });
    expect(r.semanticType).toBe('error');
    expect(r.noiseReason).toBe('status_5xx');
  });

  it('classifies envelope-empty bodies as empty (read-shaped only)', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items?q=missing',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
      shape: shape({
        kind: 'object',
        topLevelKeys: ['items', 'total_count'],
        fieldTypes: { items: 'array', total_count: 'number' },
        rowCount: 0,
      }),
    });
    expect(r.semanticType).toBe('empty');
    expect(r.noiseReason).toBe('empty_response');
  });

  it('classifies bare empty array as empty for a list-shaped URL', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
      shape: shape({ kind: 'array', rowCount: 0 }),
    });
    expect(r.semanticType).toBe('empty');
  });

  it('does NOT classify an empty body on a no-signal URL as empty', () => {
    const r = classifyEndpointCandidate({
      url: 'https://example.test/random',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
      shape: shape({ kind: 'array', rowCount: 0 }),
    });
    // No signal at all → unknown_candidate, not empty.
    expect(r.semanticType).toBe('unknown_candidate');
  });

  it('falls back to unknown_candidate when nothing matches', () => {
    const r = classifyEndpointCandidate({
      url: 'https://example.test/random/x',
      method: 'GET',
      mimeType: 'application/json',
    });
    expect(r.semanticType).toBe('unknown_candidate');
  });

  it('records evidenceLevel=metadata_only when no shape was provided', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items?q=tabrix',
      method: 'GET',
      mimeType: 'application/json',
    });
    expect(r.evidenceLevel).toBe('metadata_only');
  });

  it('records evidenceLevel=shape_evidenced when a body was summarised', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items?q=tabrix',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
      shape: shape({
        kind: 'object',
        topLevelKeys: ['items'],
        fieldTypes: { items: 'array' },
        rowCount: 3,
      }),
    });
    expect(r.evidenceLevel).toBe('shape_evidenced');
  });

  it('keeps confidence ≤ 0.85 (single-session ceiling)', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.example.test/v1/items?q=tabrix',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
      shape: shape({
        kind: 'array',
        rowCount: 25,
        sampleItemKeys: ['id', 'name'],
      }),
    });
    expect(r.confidence).toBeLessThanOrEqual(0.85);
  });
});

describe('classifyEndpointCandidate — GitHub public fixture', () => {
  it('classifies api.github.com/search/issues as search', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.github.com/search/issues?q=is%3Aissue+repo%3Aowner%2Frepo&per_page=10',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
      shape: shape({
        kind: 'object',
        topLevelKeys: ['items', 'total_count', 'incomplete_results'],
        fieldTypes: { items: 'array', total_count: 'number', incomplete_results: 'boolean' },
        rowCount: 10,
      }),
    });
    expect(r.semanticType).toBe('search');
    expect(r.evidenceLevel).toBe('shape_evidenced');
  });

  it('classifies api.github.com/repos/:owner/:repo/issues/:n as detail', () => {
    const r = classifyEndpointCandidate({
      url: 'https://api.github.com/repos/owner/repo/issues/42',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
    });
    expect(r.semanticType).toBe('detail');
  });
});

describe('summarizeEndpointShapeFromCapturedRequest — privacy / shape extraction', () => {
  it('returns metadata-only summary when responseBody is undefined', () => {
    const req: CapturedNetworkRequest = {
      url: 'https://api.example.test/v1/items?q=tabrix',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
    };
    const s = summarizeEndpointShapeFromCapturedRequest(req, EMPTY_HEADERS);
    expect(s.available).toBe(false);
    expect(s.kind).toBe('unknown');
    expect(s.contentTypeBucket).toBe('json');
    expect(s.topLevelKeys).toEqual([]);
    expect(s.fieldTypes).toEqual({});
  });

  it('returns metadata-only summary when responseBody is base64 encoded', () => {
    const req: CapturedNetworkRequest = {
      url: 'https://api.example.test/binary',
      method: 'GET',
      mimeType: 'application/octet-stream',
      responseBody: 'AAECAwQFBg==',
      base64Encoded: true,
    };
    const s = summarizeEndpointShapeFromCapturedRequest(req, EMPTY_HEADERS);
    expect(s.available).toBe(false);
    expect(s.contentTypeBucket).toBe('binary');
  });

  it('extracts top-level keys, field types, and rowCount from object envelope', () => {
    const req: CapturedNetworkRequest = {
      url: 'https://api.example.test/v1/items',
      method: 'GET',
      mimeType: 'application/json',
      responseBody: JSON.stringify({
        items: [
          { id: 1, name: 'alice@example.test' },
          { id: 2, name: 'bob@example.test' },
        ],
        total_count: 2,
        page: 1,
      }),
    };
    const s = summarizeEndpointShapeFromCapturedRequest(req, EMPTY_HEADERS);
    expect(s.available).toBe(true);
    expect(s.kind).toBe('object');
    expect(new Set(s.topLevelKeys)).toEqual(new Set(['items', 'total_count', 'page']));
    expect(s.fieldTypes.items).toBe('array');
    expect(s.fieldTypes.total_count).toBe('number');
    expect(s.fieldTypes.page).toBe('number');
    expect(s.rowCount).toBe(2);
  });

  it('extracts rowCount from a bare array', () => {
    const req: CapturedNetworkRequest = {
      url: 'https://api.example.test/v1/items',
      method: 'GET',
      mimeType: 'application/json',
      responseBody: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]),
    };
    const s = summarizeEndpointShapeFromCapturedRequest(req, EMPTY_HEADERS);
    expect(s.kind).toBe('array');
    expect(s.rowCount).toBe(3);
    expect(s.sampleItemKeys).toContain('id');
  });

  it('classifies size buckets', () => {
    expect(
      summarizeEndpointShapeFromCapturedRequest(
        { url: 'https://x.test/a', method: 'GET', mimeType: 'application/json', responseBody: '' },
        EMPTY_HEADERS,
      ).sizeClass,
    ).toBe('empty');
    expect(
      summarizeEndpointShapeFromCapturedRequest(
        {
          url: 'https://x.test/a',
          method: 'GET',
          mimeType: 'application/json',
          responseBody: 'a'.repeat(1024),
        },
        EMPTY_HEADERS,
      ).sizeClass,
    ).toBe('small');
    expect(
      summarizeEndpointShapeFromCapturedRequest(
        {
          url: 'https://x.test/a',
          method: 'GET',
          mimeType: 'application/json',
          responseBody: 'a'.repeat(10 * 1024),
        },
        EMPTY_HEADERS,
      ).sizeClass,
    ).toBe('medium');
    expect(
      summarizeEndpointShapeFromCapturedRequest(
        {
          url: 'https://x.test/a',
          method: 'GET',
          mimeType: 'application/json',
          responseBody: 'a'.repeat(200 * 1024),
        },
        EMPTY_HEADERS,
      ).sizeClass,
    ).toBe('large');
  });

  it('NEVER persists raw values from response body — only types and key names', () => {
    const sensitive = JSON.stringify({
      items: [{ email: 'leak@example.test', token: 'sk_live_AAAAAAAAAAAAAAAAAAAA' }],
      cursor: 'eyJpZCI6MTIz',
    });
    const req: CapturedNetworkRequest = {
      url: 'https://api.example.test/v1/items',
      method: 'GET',
      mimeType: 'application/json',
      responseBody: sensitive,
    };
    const s = summarizeEndpointShapeFromCapturedRequest(req, EMPTY_HEADERS);
    const serialised = JSON.stringify(s);
    expect(serialised).not.toContain('leak@example.test');
    expect(serialised).not.toContain('sk_live_');
    expect(serialised).not.toContain('eyJpZCI6MTIz');
    // But the *key names* are allowed.
    expect(s.fieldTypes.cursor).toBe('string');
  });

  it('NEVER persists raw query values, even when summarising shape', () => {
    const req: CapturedNetworkRequest = {
      url: 'https://api.example.test/v1/items?q=secret-search-term&token=AAAAAAAAAAAAAAAA',
      method: 'GET',
      mimeType: 'application/json',
      responseBody: JSON.stringify({ items: [] }),
    };
    const s = summarizeEndpointShapeFromCapturedRequest(req, EMPTY_HEADERS);
    const serialised = JSON.stringify(s);
    expect(serialised).not.toContain('secret-search-term');
    expect(serialised).not.toContain('AAAAAAAAAAAAAAAA');
  });

  it('NEVER persists Authorization or Cookie header values, even if leaked into responseHeaders', () => {
    const req: CapturedNetworkRequest = {
      url: 'https://api.example.test/v1/items',
      method: 'GET',
      mimeType: 'application/json',
      responseBody: JSON.stringify({ items: [] }),
      specificResponseHeaders: {
        'content-type': 'application/json',
        authorization: 'Bearer LEAK_TOKEN_VALUE',
        cookie: 'session=LEAK_COOKIE_VALUE',
      },
    };
    const s = summarizeEndpointShapeFromCapturedRequest(req, EMPTY_HEADERS);
    const serialised = JSON.stringify(s);
    expect(serialised).not.toContain('LEAK_TOKEN_VALUE');
    expect(serialised).not.toContain('LEAK_COOKIE_VALUE');
  });
});

describe('deriveEndpointCandidatesFromBundle — bundle path', () => {
  it('produces candidates per request and respects the per-batch cap', () => {
    const requests: CapturedNetworkRequest[] = [];
    for (let i = 0; i < 60; i += 1) {
      requests.push({
        url: `https://api.example.test/v1/items?id=${i}`,
        method: 'GET',
        mimeType: 'application/json',
        status: 200,
        responseBody: JSON.stringify({ id: i }),
      });
    }
    const bundle: CapturedNetworkBundle = { requests };
    const out = deriveEndpointCandidatesFromBundle(bundle);
    // KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT = 50
    expect(out.length).toBe(50);
    for (const c of out) {
      expect(c.semanticType).toBeDefined();
    }
  });

  it('returns an empty array for an empty bundle', () => {
    expect(deriveEndpointCandidatesFromBundle({ requests: [] })).toEqual([]);
    expect(deriveEndpointCandidatesFromBundle({})).toEqual([]);
  });

  it('classifies a successful real-shape response into a usable candidate', () => {
    const req: CapturedNetworkRequest = {
      url: 'https://api.example.test/v1/items?q=tabrix',
      method: 'GET',
      mimeType: 'application/json',
      status: 200,
      responseBody: JSON.stringify({ items: [{ id: 1 }, { id: 2 }], total_count: 2 }),
    };
    const c = deriveEndpointCandidateFromRequest(req, EMPTY_HEADERS);
    expect(c).not.toBeNull();
    expect(c!.semanticType).toBe('search');
    expect(c!.evidenceLevel).toBe('shape_evidenced');
    expect(c!.shape?.rowCount).toBe(2);
  });
});
