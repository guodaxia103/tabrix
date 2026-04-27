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
  analyzeKnowledgeCaptureBundle,
  classifyCapturedRequestNoise,
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

  it('filters private browser stats instead of storing it as unclassified knowledge', () => {
    const result = classified({
      url: 'https://api.github.com/_private/browser/stats?token=hunter2',
      method: 'GET',
      statusCode: 200,
      mimeType: 'application/json',
      responseBody: '{}',
    });
    expect(result).toBeNull();
    expect(
      classifyCapturedRequestNoise({
        url: 'https://api.github.com/_private/browser/stats?token=secret',
        method: 'GET',
      }),
    ).toBe('private');
  });

  describe('collapseUnknownPath identity normalization (A2)', () => {
    // The unclassified path collapser must NOT echo back per-tenant
    // identity segments (usernames, org slugs, owner/repo). These would
    // bloat dedup space and (later) leak identity into Stage 4a
    // experience export. See `collapseUnknownPath` for the exact rules.

    it('normalizes /users/<name>/... → /users/:user/...', () => {
      const a = classified({
        url: 'https://api.github.com/users/octocat/repos',
        method: 'GET',
        statusCode: 200,
      });
      const b = classified({
        url: 'https://api.github.com/users/torvalds/repos',
        method: 'GET',
        statusCode: 200,
      });
      expect(a!.urlPattern).toBe('api.github.com/users/:user/repos');
      expect(b!.urlPattern).toBe(a!.urlPattern);
      expect(a!.endpointSignature).toBe(b!.endpointSignature);
    });

    it('normalizes /orgs/<name>/... → /orgs/:org/...', () => {
      const result = classified({
        url: 'https://api.github.com/orgs/openai/teams',
        method: 'GET',
        statusCode: 200,
      });
      expect(result!.urlPattern).toBe('api.github.com/orgs/:org/teams');
    });

    it('normalizes unmatched /repos/<owner>/<repo>/... → /repos/:owner/:repo/...', () => {
      // `/repos/o/r/branches` is not in GITHUB_API_RULES, so it falls
      // through to collapseUnknownPath. The owner / repo segments
      // must NOT survive verbatim.
      const a = classified({
        url: 'https://api.github.com/repos/foo/bar/branches',
        method: 'GET',
        statusCode: 200,
      });
      const b = classified({
        url: 'https://api.github.com/repos/openai/api-test/branches',
        method: 'GET',
        statusCode: 200,
      });
      expect(a!.semanticTag).toBe('github.unclassified');
      expect(a!.urlPattern).toBe('api.github.com/repos/:owner/:repo/branches');
      expect(b!.urlPattern).toBe(a!.urlPattern);
      expect(a!.endpointSignature).toBe(b!.endpointSignature);
    });

    it('still collapses numeric ids (no regression)', () => {
      const result = classified({
        url: 'https://api.github.com/repos/foo/bar/check-suites/9876543210',
        method: 'GET',
        statusCode: 200,
      });
      expect(result!.urlPattern).toBe('api.github.com/repos/:owner/:repo/check-suites/:id');
    });

    it('still collapses long opaque slugs (no regression)', () => {
      const result = classified({
        url: 'https://api.github.com/repos/foo/bar/git/blobs/abc1234567890DEFGHIJKLMNOPQR',
        method: 'GET',
        statusCode: 200,
      });
      expect(result!.urlPattern).toBe('api.github.com/repos/:owner/:repo/git/blobs/:slug');
    });

    it('keeps dedup signature stable across different identities', () => {
      const a = classified({
        url: 'https://api.github.com/users/alice/gists',
        method: 'GET',
        statusCode: 200,
      });
      const b = classified({
        url: 'https://api.github.com/users/bob/gists',
        method: 'GET',
        statusCode: 200,
      });
      const c = classified({
        url: 'https://api.github.com/users/carol/gists?since=2026-01-01',
        method: 'GET',
        statusCode: 200,
      });
      expect(a!.endpointSignature).toBe(b!.endpointSignature);
      expect(a!.endpointSignature).toBe(c!.endpointSignature);
    });

    it('does not normalize non-identity-prefixed paths beyond numeric/slug rules', () => {
      const result = classified({
        url: 'https://api.github.com/notifications',
        method: 'GET',
        statusCode: 200,
      });
      expect(result!.urlPattern).toBe('api.github.com/notifications');
    });
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

  it('V26-FIX-03 — derives generic family rows for non-GitHub usable JSON GETs', () => {
    const out = deriveKnowledgeFromBundle(
      {
        requests: [
          // Hacker News API — no curated family adapter exists. Pre-FIX-03
          // this row would be silently dropped; FIX-03 must persist it
          // under family='observed' with classifier-derived semantic_type.
          {
            url: 'https://hacker-news.firebaseio.com/v0/item/12345.json',
            method: 'GET',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
          },
          // Generic JSON pagination endpoint on an arbitrary host.
          {
            url: 'https://api.example.test/v1/articles?page=2&per_page=20',
            method: 'GET',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
          },
        ],
      },
      CTX,
    );
    expect(out).toHaveLength(2);
    const [hn, generic] = out;
    expect(hn.family).toBe('observed');
    expect(hn.site).toBe('hacker-news.firebaseio.com');
    expect(hn.semanticType).toBe('detail');
    expect(hn.usableForTask).toBe(true);
    expect(hn.noiseReason).toBeNull();
    expect(generic.family).toBe('observed');
    expect(generic.site).toBe('api.example.test');
    expect(generic.semanticType).toBe('pagination');
    expect(generic.usableForTask).toBe(true);
    expect(generic.queryParamsShape).toBe('page,per_page');
    expect(typeof generic.responseShapeSummary).toBe('string');
  });

  it('V26-FIX-03 — also writes classifier fields for GitHub family rows', () => {
    const out = deriveKnowledgeFromBundle(
      {
        requests: [
          {
            url: 'https://api.github.com/search/repositories?q=tabrix&sort=stars',
            method: 'GET',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
          },
        ],
      },
      CTX,
    );
    expect(out).toHaveLength(1);
    const [row] = out;
    expect(row.family).toBe('github');
    expect(row.semanticTag).toBe('github.search_repositories');
    // FIX-03: persisted classifier output is present alongside the
    // GitHub semantic_tag and matches the closed enum.
    expect(row.semanticType).toBe('search');
    expect(row.usableForTask).toBe(true);
    expect(row.queryParamsShape).toBe('q,sort');
  });

  it('returns endpoint candidate diagnostics without raw query values', () => {
    const analysis = analyzeKnowledgeCaptureBundle(
      {
        requests: [
          {
            url: 'https://api.github.com/search/repositories?q=&sort=&order=',
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
          },
          {
            url: 'https://api.github.com/_private/browser/stats?token=',
            method: 'GET',
            statusCode: 200,
            mimeType: 'application/json',
          },
          {
            url: 'https://static.example.test/logo.png',
            method: 'GET',
            type: 'image',
            statusCode: 200,
            mimeType: 'image/png',
          },
        ],
      },
      CTX,
    );

    expect(analysis.upserts.map((row) => row.semanticTag)).toEqual(['github.search_repositories']);
    expect(analysis.diagnostics).toMatchObject({
      totalRequests: 3,
      usableCandidateCount: 1,
      upsertCandidateCount: 1,
      reason: 'usable_endpoint_found',
    });
    expect(analysis.diagnostics.filteredCounts).toMatchObject({
      usable: 1,
      private: 1,
      asset: 1,
    });
    expect(JSON.stringify(analysis)).not.toMatch(/hunter2|secret/);
  });
});
