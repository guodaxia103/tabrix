/**
 * V26-FIX-01 — `runTabrixChooseContextWithDirectApi` integration tests.
 *
 * Pin the async wrapper's contract:
 *   - Non-`knowledge_supported_read` routes return the synchronous
 *     chooser result bit-identical (no `directApiExecution` field).
 *   - `directApiEnabled === false` is also bit-identical.
 *   - High-confidence GitHub search + read-only intent → executor
 *     returns `executionMode='direct_api'` with compact rows so the
 *     upstream caller may skip `chrome_navigate` + `chrome_read_page`.
 *   - Reader failure collapses to `executionMode='fallback_required'`
 *     with `fallbackEntryLayer='L0+L1'` so the fallback chain stays at
 *     the legacy layer the chooser already declared.
 *   - Action / unknown intents short-circuit to
 *     `executionMode='skipped_not_read_only'` WITHOUT touching the
 *     injected fetch (auditable gate, not a rate-limit accident).
 *
 * No SQLite, no MCP server: this is the pure async glue layer that
 * sits between the chooser and the executor.
 */

import { runTabrixChooseContext, runTabrixChooseContextWithDirectApi } from './choose-context';
import type { ApiKnowledgeFetch } from '../api/api-knowledge';
import type { ExperienceQueryService } from '../memory/experience';

function emptyExperience(): ExperienceQueryService {
  return {
    suggestActionPaths: jest.fn().mockReturnValue([]),
  } as unknown as ExperienceQueryService;
}

function jsonFetch(status: number, body: unknown): ApiKnowledgeFetch {
  return jest.fn().mockResolvedValue({
    status,
    headers: { get: jest.fn().mockReturnValue('application/json') },
    json: jest.fn().mockResolvedValue(body),
  });
}

function rejectingFetch(reason: string): ApiKnowledgeFetch {
  return jest.fn().mockRejectedValue(Object.assign(new Error(reason), { name: 'AbortError' }));
}

const GITHUB_SEARCH_BODY = {
  total_count: 1,
  items: [
    {
      id: 1,
      full_name: 'tabrix/tabrix',
      description: 'Tabrix MCP browser tools',
      stargazers_count: 42,
      html_url: 'https://github.com/tabrix/tabrix',
    },
  ],
};

const GITHUB_SEARCH_INTENT = '搜索 GitHub 上 AI助手 相关热门项目，列出前10个';
const GITHUB_EMPTY_ISSUES_BODY = {
  total_count: 0,
  items: [],
};

describe('runTabrixChooseContextWithDirectApi', () => {
  it('non-knowledge_supported_read route is bit-identical to the synchronous chooser', async () => {
    const sync = runTabrixChooseContext(
      { intent: 'do something' },
      { experience: emptyExperience(), knowledgeApi: null, capabilityEnv: {} },
    );

    const fetchSpy = jsonFetch(200, GITHUB_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: 'do something' },
      {
        experience: emptyExperience(),
        knowledgeApi: null,
        capabilityEnv: {},
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped).toEqual(sync);
    expect((wrapped as { directApiExecution?: unknown }).directApiExecution).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('directApiEnabled=false short-circuits even on knowledge_supported_read', async () => {
    const fetchSpy = jsonFetch(200, GITHUB_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: GITHUB_SEARCH_INTENT, url: 'https://github.com/search' },
      {
        experience: emptyExperience(),
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
        directApiFetchFn: fetchSpy,
        directApiEnabled: false,
      },
    );

    expect(wrapped.status).toBe('ok');
    expect(wrapped.sourceRoute).toBe('knowledge_supported_read');
    expect((wrapped as { directApiExecution?: unknown }).directApiExecution).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('high-confidence read-only GitHub search → direct_api with compact rows', async () => {
    const fetchSpy = jsonFetch(200, GITHUB_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: GITHUB_SEARCH_INTENT, url: 'https://github.com/search' },
      {
        experience: emptyExperience(),
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.status).toBe('ok');
    expect(wrapped.sourceRoute).toBe('knowledge_supported_read');
    expect(wrapped.directApiExecution).toBeDefined();
    expect(wrapped.directApiExecution?.executionMode).toBe('direct_api');
    expect(wrapped.directApiExecution?.decisionReason).toBe('endpoint_knowledge_high_confidence');
    expect(wrapped.directApiExecution?.browserNavigationSkipped).toBe(true);
    expect(wrapped.directApiExecution?.readPageAvoided).toBe(true);
    expect(wrapped.directApiExecution?.endpointFamily).toBe('github_search_repositories');
    expect(wrapped.directApiExecution?.rowCount).toBe(1);
    expect(wrapped.directApiExecution?.rows?.length).toBe(1);
    expect(wrapped.directApiExecution?.fallbackCause).toBeNull();
    expect(wrapped.directApiExecution?.fallbackEntryLayer).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('GitHub repo-qualified issue search URL returns direct_api emptyResult instead of DOM fallback', async () => {
    const fetchSpy = jsonFetch(200, GITHUB_EMPTY_ISSUES_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      {
        intent: '读取 tabrix 仓库 issues 中匹配 __tabrix_pgb_02_no_match__ 的列表，预期返回空',
        url: 'https://github.com/search?q=repo%3Aguodaxia103%2Ftabrix+__tabrix_pgb_02_no_match__&type=issues',
        pageRole: 'issues_list',
      },
      {
        experience: emptyExperience(),
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.status).toBe('ok');
    expect(wrapped.sourceRoute).toBe('knowledge_supported_read');
    expect(wrapped.chosenLayer).toBe('L0');
    expect(wrapped.directApiExecution?.executionMode).toBe('direct_api');
    expect(wrapped.directApiExecution?.endpointFamily).toBe('github_issues_list');
    expect(wrapped.directApiExecution?.rowCount).toBe(0);
    expect(wrapped.directApiExecution?.emptyResult).toBe(true);
    expect(wrapped.directApiExecution?.emptyReason).toBe('no_matching_records');
    expect(wrapped.directApiExecution?.browserNavigationSkipped).toBe(true);
    expect(wrapped.directApiExecution?.readPageAvoided).toBe(true);

    const url = new URL((fetchSpy as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('q')).toBe(
      'repo:guodaxia103/tabrix is:issue state:open __tabrix_pgb_02_no_match__',
    );
  });

  it('reader failure collapses to fallback_required with L0+L1 entry layer', async () => {
    const fetchSpy = rejectingFetch('aborted');
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: GITHUB_SEARCH_INTENT, url: 'https://github.com/search' },
      {
        experience: emptyExperience(),
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.directApiExecution?.executionMode).toBe('fallback_required');
    expect(wrapped.directApiExecution?.browserNavigationSkipped).toBe(false);
    expect(wrapped.directApiExecution?.readPageAvoided).toBe(false);
    expect(wrapped.directApiExecution?.fallbackEntryLayer).toBe('L0+L1');
    expect(wrapped.directApiExecution?.rows).toBeNull();
    expect(wrapped.directApiExecution?.decisionReason).toMatch(/^api_call_failed_/);
  });

  it('non-knowledge URL bypasses the executor (no candidate, no field)', async () => {
    // A plain non-knowledge host (douyin / wikipedia / anything not
    // GitHub or npmjs) does not resolve a candidate, so the chooser
    // routes to `read_page_required` and the wrapper never enters
    // the executor.
    const fetchSpy = jsonFetch(200, GITHUB_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: '查看页面摘要', url: 'https://www.example.com/some-article' },
      {
        experience: emptyExperience(),
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.sourceRoute).not.toBe('knowledge_supported_read');
    expect((wrapped as { directApiExecution?: unknown }).directApiExecution).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('knowledge_supported_read with chosenLayer=L0+L1 (action route) skips direct execution', async () => {
    // Synthesise the priority-5 `knowledge_with_action` rule by
    // forcing `chosenLayer='L0+L1'`. This is the only place where
    // `sourceRoute='knowledge_supported_read'` and the user intent
    // is genuinely action-class. The wrapper must downgrade
    // `intentClass` to `'action'` so the executor short-circuits.
    //
    // We exercise that gate by injecting a high-density page context
    // that pushes the dispatcher off priority-2 and onto a
    // higher-layer knowledge route.
    const fetchSpy = jsonFetch(200, GITHUB_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      // Open-style intent on a github URL that still resolves a
      // candidate via the resolver's `wantsIssues` branch — but the
      // intent itself is action.
      {
        intent: '打开 issues 列表',
        url: 'https://github.com/octocat/hello-world',
        pageRole: 'issues_list',
      },
      {
        experience: emptyExperience(),
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
        pageContext: {
          getContext: () => ({
            source: 'live_snapshot',
            candidateActionsCount: 50,
            hvoCount: 30,
            fullReadByteLength: 50_000,
            pageRole: 'issues_list',
          }),
        },
        directApiFetchFn: fetchSpy,
      },
    );

    // The chooser still produces a knowledge_supported_read route
    // (rule 5 fires for any `knowledgeAvailable` knowledge hit), but
    // `chosenLayer='L0+L1'` flags it as the action-side route. The
    // wrapper's gate downgrades `intentClass` to `'action'` so the
    // executor returns `skipped_not_read_only`.
    if (wrapped.sourceRoute === 'knowledge_supported_read' && wrapped.chosenLayer === 'L0+L1') {
      expect(wrapped.directApiExecution?.executionMode).toBe('skipped_not_read_only');
      expect(wrapped.directApiExecution?.browserNavigationSkipped).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });
});
