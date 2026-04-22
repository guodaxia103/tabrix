/**
 * B-017 — GitHub-first API knowledge capture: classification + redaction.
 *
 * What these tests defend (regression hardening):
 *  - Sensitive headers (Authorization / Cookie / Set-Cookie / X-Api-Key)
 *    NEVER appear in the persisted summary; only their presence is
 *    surfaced via `hasAuth` / `hasCookie`.
 *  - Header values are NEVER stored — only header *names* (lower-cased,
 *    deduped, sorted).
 *  - Query string values are NEVER stored — only query *keys*.
 *  - Request body is reduced to top-level JSON keys (or empty when
 *    non-JSON / non-object) — no values, no echoes.
 *  - Response body is reduced to a coarse shape descriptor; raw text is
 *    not retained.
 *  - URL normalization collapses `:owner / :repo / :id` into stable
 *    templates so dedup at the repository layer is effective.
 *  - Anything outside the GitHub family (api.github.com host) is
 *    silently dropped.
 */

import {
  deriveKnowledgeFromBundle,
  deriveKnowledgeFromRequest,
  KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT,
  type CapturedNetworkRequest,
} from './api-knowledge-capture';

const CTX = {
  sessionId: 'session-aa',
  stepId: 'step-bb',
  observedAt: '2026-04-22T08:30:00.000Z',
};

const COMMON_REQ = { 'User-Agent': 'tabrix-test/1.0', Accept: 'application/json' };
const COMMON_RES = { 'Content-Type': 'application/json; charset=utf-8' };

function classified(req: CapturedNetworkRequest) {
  return deriveKnowledgeFromRequest(req, COMMON_REQ, COMMON_RES, CTX);
}

describe('classifyGitHubFamily / URL normalization', () => {
  it('classifies issues_list with stable :owner/:repo template', () => {
    const result = classified({
      url: 'https://api.github.com/repos/openai/api-test/issues?state=open&per_page=30',
      method: 'GET',
      statusCode: 200,
      responseBody: '[]',
    });
    expect(result).not.toBeNull();
    expect(result!.semanticTag).toBe('github.issues_list');
    expect(result!.urlPattern).toBe('api.github.com/repos/:owner/:repo/issues');
    expect(result!.endpointSignature).toBe('GET api.github.com/repos/:owner/:repo/issues');
    expect(result!.statusClass).toBe('2xx');
  });

  it('classifies pulls_list, workflow_runs_list, search/issues separately', () => {
    const cases: Array<{ url: string; method: string; expectedTag: string }> = [
      {
        url: 'https://api.github.com/repos/o/r/pulls?per_page=10',
        method: 'GET',
        expectedTag: 'github.pulls_list',
      },
      {
        url: 'https://api.github.com/repos/o/r/actions/runs',
        method: 'GET',
        expectedTag: 'github.workflow_runs_list',
      },
      {
        url: 'https://api.github.com/search/issues?q=in:title+repo:o/r+bug',
        method: 'GET',
        expectedTag: 'github.search_issues',
      },
      {
        url: 'https://api.github.com/repos/o/r/issues/42',
        method: 'GET',
        expectedTag: 'github.issue_detail',
      },
      {
        url: 'https://api.github.com/repos/o/r/actions/runs/123456789',
        method: 'GET',
        expectedTag: 'github.workflow_run_detail',
      },
    ];
    for (const c of cases) {
      const result = classified({ url: c.url, method: c.method, statusCode: 200 });
      expect(result).not.toBeNull();
      expect(result!.semanticTag).toBe(c.expectedTag);
    }
  });

  it('rejects non-api.github.com URLs (same-origin github.com is out-of-scope v1)', () => {
    expect(
      classified({ url: 'https://github.com/openai/api-test/issues', method: 'GET' }),
    ).toBeNull();
    expect(classified({ url: 'https://example.com/api/things', method: 'GET' })).toBeNull();
  });

  it('captures unclassified api.github.com endpoints under github.unclassified with collapsed path', () => {
    const result = classified({
      url: 'https://api.github.com/users/octocat/repos?type=all',
      method: 'GET',
      statusCode: 200,
    });
    expect(result).not.toBeNull();
    expect(result!.semanticTag).toBe('github.unclassified');
    // Deterministic collapsing keeps the signature small and stable.
    expect(result!.urlPattern.startsWith('api.github.com/')).toBe(true);
  });

  it('produces deterministic signatures (same input → same signature, no time leak)', () => {
    const a = classified({
      url: 'https://api.github.com/repos/x/y/issues?per_page=10',
      method: 'GET',
    });
    const b = classified({
      url: 'https://api.github.com/repos/x/y/issues?per_page=99&state=closed',
      method: 'GET',
    });
    expect(a!.endpointSignature).toBe(b!.endpointSignature);
  });

  it('rejects malformed URLs', () => {
    expect(classified({ url: 'not a url at all', method: 'GET' })).toBeNull();
  });
});

describe('redaction (defense-in-depth — these tests are P1 to never relax)', () => {
  it('NEVER stores Authorization / Cookie / Set-Cookie / x-api-key VALUES', () => {
    const result = deriveKnowledgeFromRequest(
      {
        url: 'https://api.github.com/repos/o/r/issues',
        method: 'GET',
        statusCode: 200,
        specificRequestHeaders: {
          Authorization: 'Bearer ghp_SUPERSECRETabcdefABCDEF1234567890',
          Cookie: 'session=abc123; other=def',
          'X-Api-Key': 'sk-not-real',
        },
        specificResponseHeaders: {
          'Set-Cookie': 'session=newvalue; HttpOnly',
        },
      },
      COMMON_REQ,
      COMMON_RES,
      CTX,
    );
    expect(result).not.toBeNull();
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/Bearer/i);
    expect(blob).not.toMatch(/ghp_SUPERSECRET/);
    expect(blob).not.toMatch(/SUPERSECRET/);
    expect(blob).not.toMatch(/abc123/);
    expect(blob).not.toMatch(/sk-not-real/);
    expect(blob).not.toMatch(/newvalue/);
    // But presence flags are correctly raised.
    expect(result!.requestSummary.hasAuth).toBe(true);
    expect(result!.requestSummary.hasCookie).toBe(true);
    // And the sensitive header NAMES are stripped from the persisted set
    // (we already raised the boolean — keeping the name adds no signal
    // and only widens the redaction surface).
    for (const k of result!.requestSummary.headerKeys) {
      expect(k).not.toBe('authorization');
      expect(k).not.toBe('cookie');
      expect(k).not.toBe('x-api-key');
    }
  });

  it('NEVER stores query VALUES — only query keys', () => {
    const result = deriveKnowledgeFromRequest(
      {
        url: 'https://api.github.com/search/issues?q=owner:secret+token:hunter2&per_page=99',
        method: 'GET',
        statusCode: 200,
      },
      {},
      {},
      CTX,
    );
    expect(result).not.toBeNull();
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/hunter2/);
    expect(blob).not.toMatch(/secret/);
    expect(result!.requestSummary.queryKeys).toEqual(['per_page', 'q']);
  });

  it('NEVER stores raw request body — only top-level JSON keys', () => {
    const result = deriveKnowledgeFromRequest(
      {
        url: 'https://api.github.com/repos/o/r/issues',
        method: 'POST',
        statusCode: 201,
        requestBody: JSON.stringify({
          title: 'Found a bug with token=hunter2',
          body: 'Stack: <PII>',
          labels: ['bug'],
        }),
      },
      {},
      {},
      CTX,
    );
    expect(result).not.toBeNull();
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/hunter2/);
    expect(blob).not.toMatch(/Stack:/);
    expect(result!.requestSummary.bodyKeys).toEqual(['body', 'labels', 'title']);
  });

  it('skips non-JSON request bodies entirely', () => {
    const result = deriveKnowledgeFromRequest(
      {
        url: 'https://api.github.com/repos/o/r/issues',
        method: 'POST',
        requestBody: 'plain text body, not json',
        statusCode: 200,
      },
      {},
      {},
      CTX,
    );
    expect(result!.requestSummary.bodyKeys).toEqual([]);
  });

  it('reduces JSON response array to {kind:"array", itemCount, sampleItemKeys}', () => {
    const body = JSON.stringify([
      { id: 1, number: 10, title: 'a', user: { login: 'octocat' } },
      { id: 2, number: 11, title: 'b' },
    ]);
    const result = deriveKnowledgeFromRequest(
      {
        url: 'https://api.github.com/repos/o/r/issues',
        method: 'GET',
        statusCode: 200,
        responseBody: body,
      },
      {},
      { 'Content-Type': 'application/json' },
      CTX,
    );
    expect(result!.responseSummary.shape).toEqual({
      kind: 'array',
      itemCount: 2,
      sampleItemKeys: ['id', 'number', 'title', 'user'],
    });
    expect(result!.responseSummary.sizeBytes).toBe(body.length);
    expect(result!.responseSummary.contentType).toBe('application/json');
    // The raw response text must not leak into the summary.
    expect(JSON.stringify(result!.responseSummary)).not.toMatch(/octocat/);
  });

  it('reduces JSON response object to {kind:"object", topLevelKeys}', () => {
    const result = deriveKnowledgeFromRequest(
      {
        url: 'https://api.github.com/repos/o/r/issues/42',
        method: 'GET',
        statusCode: 200,
        responseBody: JSON.stringify({
          id: 1,
          title: 'secret-title',
          body: 'should-not-appear',
        }),
      },
      {},
      { 'Content-Type': 'application/json' },
      CTX,
    );
    expect(result!.responseSummary.shape).toEqual({
      kind: 'object',
      topLevelKeys: ['body', 'id', 'title'],
    });
    expect(JSON.stringify(result!.responseSummary)).not.toMatch(/secret-title/);
    expect(JSON.stringify(result!.responseSummary)).not.toMatch(/should-not-appear/);
  });

  it('treats base64 / non-json responses as kind:"unknown"', () => {
    const r1 = deriveKnowledgeFromRequest(
      {
        url: 'https://api.github.com/repos/o/r/issues',
        method: 'GET',
        statusCode: 200,
        responseBody: 'AAAABBBB==',
        base64Encoded: true,
      },
      {},
      { 'Content-Type': 'application/octet-stream' },
      CTX,
    );
    expect(r1!.responseSummary.shape).toEqual({ kind: 'unknown' });

    const r2 = deriveKnowledgeFromRequest(
      {
        url: 'https://api.github.com/repos/o/r/issues',
        method: 'GET',
        statusCode: 200,
        responseBody: '<html>hi</html>',
      },
      {},
      { 'Content-Type': 'text/html' },
      CTX,
    );
    expect(r2!.responseSummary.shape).toEqual({ kind: 'unknown' });
  });
});

describe('deriveKnowledgeFromBundle', () => {
  it('returns empty when no requests', () => {
    expect(deriveKnowledgeFromBundle({ requests: [] }, CTX)).toEqual([]);
    expect(deriveKnowledgeFromBundle({}, CTX)).toEqual([]);
  });

  it('skips non-github requests but keeps github ones in original order', () => {
    const out = deriveKnowledgeFromBundle(
      {
        requests: [
          { url: 'https://example.com/one', method: 'GET' },
          { url: 'https://api.github.com/repos/o/r/issues', method: 'GET' },
          { url: 'https://example.com/two', method: 'GET' },
          { url: 'https://api.github.com/repos/o/r/pulls', method: 'GET' },
        ],
      },
      CTX,
    );
    expect(out.map((e) => e.semanticTag)).toEqual(['github.issues_list', 'github.pulls_list']);
  });

  it('respects KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT cap', () => {
    const requests: CapturedNetworkRequest[] = [];
    for (let i = 0; i < KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT + 25; i++) {
      requests.push({
        url: `https://api.github.com/repos/o${i}/r${i}/issues`,
        method: 'GET',
        statusCode: 200,
      });
    }
    const out = deriveKnowledgeFromBundle({ requests }, CTX);
    expect(out).toHaveLength(KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT);
  });
});
