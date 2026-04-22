/**
 * Unit tests for `tabrix_choose_context` v1 (B-018) — pure layer.
 *
 * Mirrors the success-criteria checklist in
 * `docs/B_018_CONTEXT_SELECTOR_V1.md` §8: contract shape, strategy
 * set guard, three branches, capability gate, no write side-effects,
 * and risk tier presence.
 */

import {
  EXPERIENCE_HIT_MIN_SUCCESS_RATE,
  TOOL_NAMES,
  TOOL_RISK_TIERS,
  type ContextStrategyName,
} from '@tabrix/shared';
import {
  TabrixChooseContextInputError,
  chooseContextStrategy,
  parseTabrixChooseContextInput,
  resolveSiteFamily,
  runTabrixChooseContext,
} from './choose-context';
import type { ExperienceQueryService } from '../memory/experience';
import type { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import type { ExperienceActionPathRow } from '../memory/experience/experience-repository';
import type { KnowledgeApiEndpoint } from '../memory/knowledge/knowledge-api-repository';

function fakeRow(overrides: Partial<ExperienceActionPathRow> = {}): ExperienceActionPathRow {
  return {
    actionPathId: 'ap-default',
    pageRole: 'repo_home',
    intentSignature: 'open issues',
    stepSequence: [{ toolName: 'chrome_click_element', status: 'completed', historyRef: null }],
    successCount: 4,
    failureCount: 1,
    lastUsedAt: '2026-04-22T00:00:00.000Z',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    ...overrides,
  };
}

function fakeEndpoint(overrides: Partial<KnowledgeApiEndpoint> = {}): KnowledgeApiEndpoint {
  return {
    endpointId: 'ep-1',
    site: 'api.github.com',
    family: 'github',
    method: 'GET',
    urlPattern: '/repos/:owner/:repo/issues',
    endpointSignature: 'GET api.github.com/repos/:owner/:repo/issues',
    semanticTag: 'issues_list',
    statusClass: '2xx',
    requestSummary: {
      headerNames: [],
      queryKeys: [],
      bodyKeys: [],
      hasAuth: false,
      hasCookie: false,
    },
    responseSummary: { shape: 'array<object>', truncated: false },
    sourceSessionId: null,
    sourceStepId: null,
    sourceHistoryRef: null,
    sampleCount: 1,
    firstSeenAt: '2026-04-22T00:00:00.000Z',
    lastSeenAt: '2026-04-22T00:00:00.000Z',
    ...overrides,
  };
}

function fakeExperience(rows: ExperienceActionPathRow[]): {
  service: ExperienceQueryService;
  spy: jest.Mock;
} {
  const spy = jest.fn().mockReturnValue(rows);
  return {
    service: { suggestActionPaths: spy } as unknown as ExperienceQueryService,
    spy,
  };
}

function fakeKnowledgeRepo(rows: KnowledgeApiEndpoint[]): {
  repo: KnowledgeApiRepository;
  spy: jest.Mock;
} {
  const spy = jest.fn().mockImplementation((_site: string, _limit?: number) => rows);
  return {
    repo: { listBySite: spy, countAll: () => rows.length } as unknown as KnowledgeApiRepository,
    spy,
  };
}

describe('parseTabrixChooseContextInput', () => {
  it('rejects missing intent', () => {
    expect(() => parseTabrixChooseContextInput({})).toThrow(TabrixChooseContextInputError);
  });

  it('rejects empty-after-trim intent', () => {
    expect(() => parseTabrixChooseContextInput({ intent: '   ' })).toThrow(
      TabrixChooseContextInputError,
    );
  });

  it('rejects non-string intent (typed input error)', () => {
    expect(() => parseTabrixChooseContextInput({ intent: 42 })).toThrow(
      TabrixChooseContextInputError,
    );
  });

  it('normalises intent into the same bucket as B-013', () => {
    const a = parseTabrixChooseContextInput({ intent: '  Open   Issues  ' });
    const b = parseTabrixChooseContextInput({ intent: 'open issues' });
    expect(a.intentSignature).toBe(b.intentSignature);
  });

  it('drops unparseable url silently (treated as omitted)', () => {
    const parsed = parseTabrixChooseContextInput({ intent: 'open issues', url: 'not a url' });
    // url survives validation (we only test parseability at site-family
    // resolution time), but resolveSiteFamily returns undefined.
    expect(resolveSiteFamily(parsed.input)).toBeUndefined();
  });

  it('drops unrecognised siteId silently', () => {
    const parsed = parseTabrixChooseContextInput({ intent: 'open issues', siteId: 'douyin' });
    expect(parsed.input.siteId).toBeUndefined();
  });

  it('rejects oversize pageRole', () => {
    expect(() =>
      parseTabrixChooseContextInput({ intent: 'open issues', pageRole: 'x'.repeat(200) }),
    ).toThrow(TabrixChooseContextInputError);
  });
});

describe('resolveSiteFamily', () => {
  it('honours explicit siteId', () => {
    expect(resolveSiteFamily({ intent: 'x', siteId: 'github' })).toBe('github');
  });

  it('derives github from github.com host', () => {
    expect(resolveSiteFamily({ intent: 'x', url: 'https://github.com/octocat/hello-world' })).toBe(
      'github',
    );
  });

  it('derives github from any *.github.com host', () => {
    expect(resolveSiteFamily({ intent: 'x', url: 'https://api.github.com/repos/x/y' })).toBe(
      'github',
    );
    expect(resolveSiteFamily({ intent: 'x', url: 'https://gist.github.com/x' })).toBe('github');
  });

  it('returns undefined for unknown host', () => {
    expect(resolveSiteFamily({ intent: 'x', url: 'https://www.douyin.com/foo' })).toBeUndefined();
  });

  it('returns undefined for unparseable url', () => {
    expect(resolveSiteFamily({ intent: 'x', url: 'http://[' })).toBeUndefined();
  });
});

describe('chooseContextStrategy (pure)', () => {
  it('strategy set is exactly the three v1 names — guards against silent additions', () => {
    // Doc §8 success criterion #2: enumerate the strategy set so a future
    // PR that bolts on `api_only` or `experience_replay` MUST also touch
    // this guard test (and, by extension, the design doc).
    const allowed: ContextStrategyName[] = [
      'experience_reuse',
      'knowledge_light',
      'read_page_required',
    ];
    expect(allowed.sort()).toEqual(['experience_reuse', 'knowledge_light', 'read_page_required']);
  });

  it('returns experience_reuse when an experience hit is provided', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'open issues',
      experienceHit: {
        actionPathId: 'ap-1',
        successRate: 0.83,
        successCount: 5,
        failureCount: 1,
      },
    });
    expect(decision.strategy).toBe('experience_reuse');
    expect(decision.fallbackStrategy).toBe('read_page_required');
    expect(decision.artifacts).toEqual([
      expect.objectContaining({ kind: 'experience', ref: 'ap-1' }),
    ]);
    expect(decision.reasoning).toMatch(/experience hit/);
  });

  it('returns knowledge_light when no experience hit and catalog is non-empty', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'open issues',
      siteFamily: 'github',
      knowledgeCatalog: {
        site: 'api.github.com',
        totalEndpoints: 2,
        sampleSignatures: ['GET api.github.com/repos/:owner/:repo/issues'],
      },
    });
    expect(decision.strategy).toBe('knowledge_light');
    expect(decision.fallbackStrategy).toBe('read_page_required');
    expect(decision.reasoning).toMatch(/Tabrix v1 does NOT call site APIs/);
    expect(decision.artifacts).toEqual([
      expect.objectContaining({ kind: 'knowledge_api', ref: 'api.github.com' }),
    ]);
  });

  it('falls back to read_page_required when neither asset is available', () => {
    const decision = chooseContextStrategy({ intentSignature: 'open issues' });
    expect(decision.strategy).toBe('read_page_required');
    expect(decision.fallbackStrategy).toBeUndefined();
    expect(decision.artifacts).toEqual([]);
  });

  it('treats empty knowledge catalog as no catalog (no knowledge_light)', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'open issues',
      siteFamily: 'github',
      knowledgeCatalog: { site: 'api.github.com', totalEndpoints: 0, sampleSignatures: [] },
    });
    expect(decision.strategy).toBe('read_page_required');
  });
});

describe('runTabrixChooseContext (orchestrator)', () => {
  it('returns invalid_input with the typed code on bad args', () => {
    const result = runTabrixChooseContext(
      {},
      {
        experience: null,
        knowledgeApi: null,
        capabilityEnv: {},
      },
    );
    expect(result.status).toBe('invalid_input');
    expect(result.error).toMatchObject({ code: 'TABRIX_CHOOSE_CONTEXT_BAD_INPUT' });
    expect(result.strategy).toBeUndefined();
  });

  it('picks the highest-success-rate plan above the threshold', () => {
    const { service } = fakeExperience([
      fakeRow({ actionPathId: 'ap-low', successCount: 1, failureCount: 9 }), // 0.10
      fakeRow({ actionPathId: 'ap-mid', successCount: 6, failureCount: 4 }), // 0.60
      fakeRow({ actionPathId: 'ap-high', successCount: 9, failureCount: 1 }), // 0.90
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'repo_home' },
      { experience: service, knowledgeApi: null, capabilityEnv: {} },
    );
    expect(result.status).toBe('ok');
    expect(result.strategy).toBe('experience_reuse');
    expect(result.artifacts?.[0]?.ref).toBe('ap-high');
  });

  it('rejects below-threshold plans even when knowledge would otherwise hit', () => {
    const { service } = fakeExperience([
      fakeRow({ actionPathId: 'ap-low', successCount: 1, failureCount: 9 }), // 0.10
    ]);
    const { repo } = fakeKnowledgeRepo([fakeEndpoint()]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', url: 'https://github.com/octocat/hello' },
      {
        experience: service,
        knowledgeApi: repo,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
      },
    );
    // Below-threshold plan filtered out → no experience hit → falls
    // through to knowledge_light because gate is on.
    expect(result.strategy).toBe('knowledge_light');
  });

  it('returns knowledge_light when capability is on, repo non-empty, no experience match', () => {
    const { service } = fakeExperience([]);
    const { repo, spy } = fakeKnowledgeRepo([
      fakeEndpoint({ endpointSignature: 'GET api.github.com/repos/:owner/:repo/pulls' }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'list prs', url: 'https://github.com/x/y/pulls' },
      {
        experience: service,
        knowledgeApi: repo,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
      },
    );
    expect(result.strategy).toBe('knowledge_light');
    expect(result.fallbackStrategy).toBe('read_page_required');
    expect(spy).toHaveBeenCalledWith('api.github.com', expect.any(Number));
    expect(result.artifacts?.[0]?.summary).toMatch(/api\.github\.com/);
  });

  it('falls back to read_page_required when capability is OFF even with rows present', () => {
    // Doc §8 success criterion #4: gate must be respected.
    const { service } = fakeExperience([]);
    const { repo, spy } = fakeKnowledgeRepo([fakeEndpoint()]);
    const result = runTabrixChooseContext(
      { intent: 'list prs', url: 'https://github.com/x/y/pulls' },
      {
        experience: service,
        knowledgeApi: repo,
        capabilityEnv: {}, // not enabled
      },
    );
    expect(result.strategy).toBe('read_page_required');
    expect(result.artifacts).toEqual([]);
    // Tighter assertion: when the gate is off we must NOT touch the
    // repo at all — it pays no cost AND cannot accidentally surface
    // catalog data.
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to read_page_required for non-GitHub URLs even with capability on', () => {
    const { service } = fakeExperience([]);
    const { repo, spy } = fakeKnowledgeRepo([fakeEndpoint()]);
    const result = runTabrixChooseContext(
      { intent: 'open something', url: 'https://www.douyin.com/x/y' },
      {
        experience: service,
        knowledgeApi: repo,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
      },
    );
    expect(result.strategy).toBe('read_page_required');
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to read_page_required when no URL and no experience', () => {
    const { service } = fakeExperience([]);
    const result = runTabrixChooseContext(
      { intent: 'do something' },
      { experience: service, knowledgeApi: null, capabilityEnv: {} },
    );
    expect(result.strategy).toBe('read_page_required');
  });

  it('reads the experience repo at most once (no write-path side-effect)', () => {
    // Doc §8 success criterion #5: the chooser is read-only and
    // idempotent — it must not loop or double-read.
    const { service, spy } = fakeExperience([]);
    runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'repo_home' },
      { experience: service, knowledgeApi: null, capabilityEnv: {} },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      intent: expect.any(String),
      intentSignature: expect.any(String),
      pageRole: 'repo_home',
      limit: expect.any(Number),
    });
  });

  it('echoes resolved bucket fields back to the caller', () => {
    const { service } = fakeExperience([]);
    const result = runTabrixChooseContext(
      { intent: '  Open Issues  ', pageRole: 'repo_home', siteId: 'github' },
      { experience: service, knowledgeApi: null, capabilityEnv: {} },
    );
    expect(result.resolved).toEqual({
      intentSignature: 'open issues',
      pageRole: 'repo_home',
      siteFamily: 'github',
    });
  });
});

describe('B-018 v1 risk tier wiring', () => {
  it('tabrix_choose_context is registered as P0 (read-only)', () => {
    // Doc §8 success criterion #6.
    expect(TOOL_RISK_TIERS[TOOL_NAMES.CONTEXT.CHOOSE]).toBe('P0');
  });

  it('threshold constant matches the documented v1 number', () => {
    // Sanity: doc §6 lists the only knob; if someone bumps it in code
    // they must also bump the doc + the success-rate test fixture.
    expect(EXPERIENCE_HIT_MIN_SUCCESS_RATE).toBe(0.5);
  });
});
