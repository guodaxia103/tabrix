import {
  classifyApiKnowledgeMetadata,
  readApiKnowledgeEndpointPlan,
  readApiKnowledgeRows,
  readApiKnowledgeRowsForIntent,
  resolveApiKnowledgeCandidate,
  type ApiKnowledgeFetch,
} from './api-knowledge';

function jsonFetch(status: number, body: unknown): ApiKnowledgeFetch {
  return jest.fn().mockResolvedValue({
    status,
    headers: { get: jest.fn().mockReturnValue('application/json') },
    json: jest.fn().mockResolvedValue(body),
  });
}

afterEach(() => {
  jest.useRealTimers();
});

describe('V26-07 API Knowledge substrate', () => {
  it('classifies GitHub seed endpoint metadata without retaining raw query or secrets', () => {
    const metadata = classifyApiKnowledgeMetadata({
      url: 'https://api.github.com/search/repositories?q=secret-token-value&per_page=10',
      method: 'GET',
      status: 200,
      timingMs: 42,
      sizeBytes: 512,
      contentType: 'application/json; charset=utf-8',
    });

    expect(metadata).toMatchObject({
      host: 'api.github.com',
      pathPattern: '/search/repositories',
      method: 'GET',
      statusClass: '2xx',
      sizeClass: 'small',
      contentType: 'application/json',
      endpointFamily: 'github_search_repositories',
      dataPurpose: 'search_list',
      readAllowed: true,
    });
    expect(JSON.stringify(metadata)).not.toContain('secret-token-value');
    expect(JSON.stringify(metadata)).not.toContain('per_page');
  });

  it('classifies GitHub issues, workflow runs, and npmjs search seed families', () => {
    expect(
      classifyApiKnowledgeMetadata({
        url: 'https://api.github.com/repos/octocat/hello-world/issues?state=open',
        method: 'HEAD',
      }),
    ).toMatchObject({
      endpointFamily: 'github_issues_list',
      dataPurpose: 'issue_list',
      pathPattern: '/repos/:owner/:repo/issues',
      readAllowed: true,
    });

    expect(
      classifyApiKnowledgeMetadata({
        url: 'https://api.github.com/repos/octocat/hello-world/actions/runs?per_page=1',
        method: 'GET',
      }),
    ).toMatchObject({
      endpointFamily: 'github_workflow_runs_list',
      dataPurpose: 'workflow_runs_list',
      pathPattern: '/repos/:owner/:repo/actions/runs',
      readAllowed: true,
    });

    expect(
      classifyApiKnowledgeMetadata({
        url: 'https://registry.npmjs.org/-/v1/search?text=react',
        method: 'GET',
      }),
    ).toMatchObject({
      endpointFamily: 'npmjs_search_packages',
      dataPurpose: 'package_search',
      pathPattern: '/-/v1/search',
      readAllowed: true,
    });
  });

  it('returns fallback_required for unsupported site families', async () => {
    const result = await readApiKnowledgeRowsForIntent({
      intent: 'search products',
      url: 'https://example.com/search?q=widget',
      fetchFn: jest.fn(),
    });

    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'unsupported_site_family',
      fallbackEntryLayer: 'L0+L1',
      telemetry: {
        reason: 'unsupported_site_family',
        readAllowed: false,
        fallbackEntryLayer: 'L0+L1',
      },
    });
  });

  it('denies non-read methods before making a public request', async () => {
    const fetchFn = jest.fn();
    const result = await readApiKnowledgeRows({
      endpointFamily: 'github_search_repositories',
      method: 'POST',
      params: { query: 'tabrix' },
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'method_denied',
      fallbackEntryLayer: 'L0+L1',
      telemetry: { readAllowed: false },
    });
  });

  it('does not return empty api_rows for HEAD on the on-demand reader path', async () => {
    const fetchFn = jest.fn();
    const result = await readApiKnowledgeRows({
      endpointFamily: 'github_search_repositories',
      method: 'HEAD',
      params: { query: 'tabrix' },
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'method_denied',
      fallbackEntryLayer: 'L0+L1',
    });
  });

  it('surfaces 403 and rate limit as observable fallback results', async () => {
    await expect(
      readApiKnowledgeRows({
        endpointFamily: 'github_search_repositories',
        method: 'GET',
        params: { query: 'tabrix' },
        fetchFn: jsonFetch(403, { message: 'forbidden' }),
      }),
    ).resolves.toMatchObject({
      status: 'fallback_required',
      reason: 'http_forbidden',
      telemetry: { status: 403 },
    });

    await expect(
      readApiKnowledgeRows({
        endpointFamily: 'github_search_repositories',
        method: 'GET',
        params: { query: 'tabrix' },
        fetchFn: jsonFetch(429, { message: 'rate limited' }),
      }),
    ).resolves.toMatchObject({
      status: 'fallback_required',
      reason: 'rate_limited',
      telemetry: { status: 429 },
    });
  });

  it('endpoint read plan rejects semantic mismatches before fetch and falls back to L0+L1', async () => {
    const fetchFn = jest.fn();
    const result = await readApiKnowledgeEndpointPlan({
      endpointFamily: 'github_search_repositories',
      dataPurpose: 'issue_list',
      method: 'GET',
      params: { query: 'tabrix' },
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'semantic_mismatch',
      fallbackEntryLayer: 'L0+L1',
      telemetry: {
        reason: 'semantic_mismatch',
        readAllowed: false,
        fallbackEntryLayer: 'L0+L1',
      },
    });
  });

  it('endpoint read plan delegates semantically equivalent GET plans to compact api_rows', async () => {
    const fetchFn = jsonFetch(200, {
      items: [
        {
          name: 'tabrix',
          full_name: 'guodaxia103/tabrix',
          stargazers_count: 10,
          html_url: 'https://github.com/guodaxia103/tabrix',
        },
      ],
    });
    const result = await readApiKnowledgeEndpointPlan({
      endpointFamily: 'github_search_repositories',
      dataPurpose: 'search_list',
      method: 'GET',
      params: { query: 'tabrix' },
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'ok',
      kind: 'api_rows',
      endpointFamily: 'github_search_repositories',
      dataPurpose: 'search_list',
      rowCount: 1,
      rawBodyStored: false,
    });
  });

  it('times out a never-resolving public API fetch and falls back to compact DOM', async () => {
    jest.useFakeTimers();
    let now = 0;
    let signal: AbortSignal | undefined;
    const fetchFn: ApiKnowledgeFetch = jest.fn((_url, init) => {
      signal = init?.signal;
      return new Promise<never>(() => undefined);
    });

    const pending = readApiKnowledgeRows({
      endpointFamily: 'github_search_repositories',
      method: 'GET',
      params: { query: 'tabrix' },
      fetchFn,
      nowMs: () => now,
    });

    now = 2500;
    await jest.advanceTimersByTimeAsync(2500);
    const result = await pending;

    expect(signal?.aborted).toBe(true);
    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'network_timeout',
      fallbackEntryLayer: 'L0+L1',
      telemetry: {
        reason: 'network_timeout',
        fallbackEntryLayer: 'L0+L1',
      },
    });
    expect(result.telemetry.waitedMs).toBeGreaterThanOrEqual(2500);
  });

  it('returns compact GitHub rows without raw response body fields', async () => {
    const result = await readApiKnowledgeRows({
      endpointFamily: 'github_search_repositories',
      method: 'GET',
      params: { query: 'tabrix' },
      fetchFn: jsonFetch(200, {
        items: [
          {
            name: 'tabrix',
            full_name: 'guodaxia103/tabrix',
            description: 'Browser MCP',
            language: 'TypeScript',
            stargazers_count: 12,
            html_url: 'https://github.com/guodaxia103/tabrix',
            token: 'SHOULD_NOT_LEAK',
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'ok',
      kind: 'api_rows',
      endpointFamily: 'github_search_repositories',
      compact: true,
      rawBodyStored: false,
      rowCount: 1,
      rows: [
        {
          name: 'tabrix',
          fullName: 'guodaxia103/tabrix',
          description: 'Browser MCP',
          language: 'TypeScript',
          stars: 12,
          url: 'https://github.com/guodaxia103/tabrix',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('SHOULD_NOT_LEAK');
  });

  it('returns compact npmjs rows from the public search endpoint', async () => {
    const result = await readApiKnowledgeRows({
      endpointFamily: 'npmjs_search_packages',
      method: 'GET',
      params: { query: 'typescript' },
      fetchFn: jsonFetch(200, {
        objects: [
          {
            package: {
              name: 'typescript',
              version: '5.9.3',
              description: 'TypeScript is a language for application scale JavaScript.',
              links: { npm: 'https://www.npmjs.com/package/typescript' },
            },
            score: { detail: { quality: 0.95 } },
            raw: 'SHOULD_NOT_LEAK',
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'ok',
      kind: 'api_rows',
      endpointFamily: 'npmjs_search_packages',
      dataPurpose: 'package_search',
      rawBodyStored: false,
      rows: [
        {
          name: 'typescript',
          version: '5.9.3',
          quality: 0.95,
          url: 'https://www.npmjs.com/package/typescript',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('SHOULD_NOT_LEAK');
  });

  it('resolves supported search/list candidates without changing the public site-family contract', () => {
    expect(
      resolveApiKnowledgeCandidate({
        intent: 'inspect issues',
        url: 'https://github.com/octocat/hello-world/issues',
        pageRole: 'issues_list',
      }),
    ).toMatchObject({
      endpointFamily: 'github_issues_list',
      params: { owner: 'octocat', repo: 'hello-world', state: 'open' },
    });

    expect(
      resolveApiKnowledgeCandidate({
        intent: '搜索 GitHub issues，列出前10条 issue',
        url: 'https://github.com/search?q=AI%20assistant&type=issues',
        pageRole: 'issues_list',
      }),
    ).toBeNull();

    expect(
      resolveApiKnowledgeCandidate({
        intent: 'search npm package zod',
        url: 'https://www.npmjs.com/search?q=zod',
      }),
    ).toMatchObject({
      endpointFamily: 'npmjs_search_packages',
      dataPurpose: 'package_search',
    });
  });

  it('resolves Chinese natural-language search/list intents for GitHub and npmjs tasks', () => {
    expect(
      resolveApiKnowledgeCandidate({
        intent: '搜索 GitHub 上 AI助手 相关热门项目，列出前10个',
        url: 'https://github.com/search',
      }),
    ).toMatchObject({
      endpointFamily: 'github_search_repositories',
      dataPurpose: 'search_list',
      params: { query: 'AI助手', sort: 'stars', order: 'desc' },
    });

    expect(
      resolveApiKnowledgeCandidate({
        intent: '搜索 npm 上 browser automation 相关包，列出前10个',
        url: 'https://www.npmjs.com/search',
      }),
    ).toMatchObject({
      endpointFamily: 'npmjs_search_packages',
      dataPurpose: 'package_search',
      params: { query: 'browser automation' },
    });
  });

  it('resolves GitHub Actions read-only tasks to workflow runs rows', () => {
    expect(
      resolveApiKnowledgeCandidate({
        intent: '读取 GitHub Actions 最近一次工作流运行的名称、状态、分支、触发时间',
        url: 'https://github.com/guodaxia103/tabrix/actions',
        pageRole: 'actions_detail',
      }),
    ).toMatchObject({
      endpointFamily: 'github_workflow_runs_list',
      dataPurpose: 'workflow_runs_list',
      params: { owner: 'guodaxia103', repo: 'tabrix' },
    });
  });

  it('does not add GitHub hot-search sort params for ordinary search intent', () => {
    expect(
      resolveApiKnowledgeCandidate({
        intent: '搜索 GitHub 上 AI助手 相关项目，列出前10个',
        url: 'https://github.com/search',
      }),
    ).toMatchObject({
      endpointFamily: 'github_search_repositories',
      params: { query: 'AI助手' },
    });
    expect(
      resolveApiKnowledgeCandidate({
        intent: '搜索 GitHub 上 AI助手 相关项目，列出前10个',
        url: 'https://github.com/search',
      })?.params,
    ).not.toMatchObject({ sort: expect.any(String), order: expect.any(String) });
  });

  it('builds GitHub hot-search URL with stars sorting only when candidate params request it', async () => {
    const fetchFn = jsonFetch(200, { items: [] });
    await readApiKnowledgeRows({
      endpointFamily: 'github_search_repositories',
      method: 'GET',
      params: { query: 'AI助手', sort: 'stars', order: 'desc' },
      fetchFn,
    });

    const url = new URL((fetchFn as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('q')).toBe('AI助手');
    expect(url.searchParams.get('sort')).toBe('stars');
    expect(url.searchParams.get('order')).toBe('desc');
  });

  it('builds ordinary GitHub search URL without sort/order params', async () => {
    const fetchFn = jsonFetch(200, { items: [] });
    await readApiKnowledgeRows({
      endpointFamily: 'github_search_repositories',
      method: 'GET',
      params: { query: 'AI助手' },
      fetchFn,
    });

    const url = new URL((fetchFn as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('q')).toBe('AI助手');
    expect(url.searchParams.has('sort')).toBe(false);
    expect(url.searchParams.has('order')).toBe(false);
  });

  it('routes GitHub issue lists through search/issues instead of the core REST issues endpoint', async () => {
    const fetchFn = jsonFetch(200, { items: [] });
    await readApiKnowledgeRows({
      endpointFamily: 'github_issues_list',
      method: 'GET',
      params: { owner: 'octocat', repo: 'hello-world', state: 'open' },
      fetchFn,
    });

    const url = new URL((fetchFn as jest.Mock).mock.calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://api.github.com/search/issues');
    expect(url.searchParams.get('q')).toBe('repo:octocat/hello-world is:issue state:open');
    expect(url.searchParams.get('sort')).toBe('created');
    expect(url.searchParams.get('order')).toBe('desc');
    expect(url.searchParams.get('per_page')).toBe('10');
  });

  it('compacts GitHub issue search results from the items envelope', async () => {
    const result = await readApiKnowledgeRows({
      endpointFamily: 'github_issues_list',
      method: 'GET',
      params: { owner: 'octocat', repo: 'hello-world' },
      fetchFn: jsonFetch(200, {
        items: [
          {
            number: 42,
            title: 'Crash on startup',
            state: 'open',
            labels: [{ name: 'bug' }],
            html_url: 'https://github.com/octocat/hello-world/issues/42',
            raw: 'SHOULD_NOT_LEAK',
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'ok',
      kind: 'api_rows',
      endpointFamily: 'github_issues_list',
      dataPurpose: 'issue_list',
      rowCount: 1,
      rawBodyStored: false,
      rows: [
        {
          number: 42,
          title: 'Crash on startup',
          state: 'open',
          labels: 'bug',
          url: 'https://github.com/octocat/hello-world/issues/42',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('SHOULD_NOT_LEAK');
  });

  it('returns compact GitHub workflow run rows without raw response body fields', async () => {
    const result = await readApiKnowledgeRows({
      endpointFamily: 'github_workflow_runs_list',
      method: 'GET',
      params: { owner: 'guodaxia103', repo: 'tabrix' },
      fetchFn: jsonFetch(200, {
        workflow_runs: [
          {
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
            head_branch: 'main',
            event: 'push',
            display_title: 'Release polish',
            created_at: '2026-04-27T00:00:00Z',
            html_url: 'https://github.com/guodaxia103/tabrix/actions/runs/1',
            raw: 'SHOULD_NOT_LEAK',
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'ok',
      kind: 'api_rows',
      endpointFamily: 'github_workflow_runs_list',
      dataPurpose: 'workflow_runs_list',
      rowCount: 1,
      rawBodyStored: false,
      rows: [
        {
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          branch: 'main',
          event: 'push',
          title: 'Release polish',
          createdAt: '2026-04-27T00:00:00Z',
          url: 'https://github.com/guodaxia103/tabrix/actions/runs/1',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('SHOULD_NOT_LEAK');
  });
});
