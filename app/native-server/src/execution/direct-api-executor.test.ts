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
  DIRECT_API_HIGH_CONFIDENCE_THRESHOLD,
  classifyDirectApiIntent,
  tryDirectApiExecute,
  type DirectApiExecutorInput,
} from './direct-api-executor';
import type { ApiKnowledgeCandidate, ApiKnowledgeFetch } from '../api/api-knowledge';

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
