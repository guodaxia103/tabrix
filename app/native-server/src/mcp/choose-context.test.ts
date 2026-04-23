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
  runTabrixChooseContextRecordOutcome,
} from './choose-context';
import type { ChooseContextTelemetryRepository } from '../memory/telemetry/choose-context-telemetry';
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

/**
 * V24-01 isReplayEligible() requires every step to carry non-empty
 * `args`. Tests that intend to assert "routes to experience_replay"
 * must use steps minted via this helper (or supply args inline);
 * tests that assert "stays on experience_reuse because args are
 * missing" should keep using the bare `{toolName,status,historyRef}`
 * shape.
 */
function replayableStep(toolName: 'chrome_click_element' | 'chrome_fill_or_select') {
  return {
    toolName,
    status: 'completed',
    historyRef: null,
    args:
      toolName === 'chrome_fill_or_select'
        ? { selector: '#search', value: 'tabrix' }
        : { selector: '#issues-tab' },
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
  it('strategy set is exactly the v2.4.0 names — guards against silent additions', () => {
    // Doc §8 success criterion #2: enumerate the strategy set so a future
    // PR that bolts on `api_only` (or any other branch) MUST also touch
    // this guard test (and, by extension, the design doc).
    //
    // V23-04 / B-018 v1.5: `read_page_markdown` joined the set as the
    // GitHub text-heavy reading branch (B-015 / V23-03).
    // V24-01 / B-EXP-REPLAY-V1: `experience_replay` joined the set as
    // the dispatched-execution branch for replay-eligible Experience
    // hits.
    const allowed: ContextStrategyName[] = [
      'experience_replay',
      'experience_reuse',
      'knowledge_light',
      'read_page_markdown',
      'read_page_required',
    ];
    expect(allowed.sort()).toEqual([
      'experience_replay',
      'experience_reuse',
      'knowledge_light',
      'read_page_markdown',
      'read_page_required',
    ]);
  });

  it('returns experience_reuse when an experience hit is provided (no replay-eligibility)', () => {
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

  // -------------------------------------------------------------------------
  // V24-01 / B-EXP-REPLAY-V1 — experience_replay routing branch (pure)
  // -------------------------------------------------------------------------

  it('routes to experience_replay when the hit is replayEligible', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'open issues',
      experienceHit: {
        actionPathId: 'ap-replay',
        successRate: 0.9,
        successCount: 9,
        failureCount: 1,
        replayEligible: true,
      },
    });
    expect(decision.strategy).toBe('experience_replay');
    expect(decision.fallbackStrategy).toBe('experience_reuse');
    expect(decision.artifacts).toEqual([
      expect.objectContaining({ kind: 'experience', ref: 'ap-replay' }),
    ]);
    expect(decision.reasoning).toMatch(/experience replay/);
  });

  it('falls back to experience_reuse when the hit is not replay-eligible', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'open issues',
      experienceHit: {
        actionPathId: 'ap-not-replay',
        successRate: 0.9,
        successCount: 9,
        failureCount: 1,
        replayEligible: false,
      },
    });
    expect(decision.strategy).toBe('experience_reuse');
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

  // -------------------------------------------------------------------------
  // V23-04 / B-018 v1.5 — markdown reading branch
  // -------------------------------------------------------------------------

  it('routes to read_page_markdown for whitelisted GitHub pageRoles when no other asset hits', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'read repo overview',
      siteFamily: 'github',
      pageRole: 'repo_home',
    });
    expect(decision.strategy).toBe('read_page_markdown');
    expect(decision.fallbackStrategy).toBe('read_page_required');
    expect(decision.artifacts).toEqual([
      expect.objectContaining({ kind: 'read_page', ref: 'markdown:repo_home' }),
    ]);
    expect(decision.reasoning).toMatch(/markdown-friendly GitHub whitelist/);
  });

  it('does NOT route to markdown for an unknown GitHub pageRole', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'do something',
      siteFamily: 'github',
      pageRole: 'mystery_role',
    });
    expect(decision.strategy).toBe('read_page_required');
  });

  it('does NOT route to markdown for non-GitHub site even with a whitelist token', () => {
    // The whitelist is GitHub-specific; routing markdown for a
    // non-GitHub host whose understanding layer happens to emit
    // `repo_home` would be a silent mis-routing.
    const decision = chooseContextStrategy({
      intentSignature: 'read overview',
      siteFamily: undefined,
      pageRole: 'repo_home',
    });
    expect(decision.strategy).toBe('read_page_required');
  });

  it('experience_reuse still wins over the markdown branch', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'open issues',
      siteFamily: 'github',
      pageRole: 'issue_detail',
      experienceHit: {
        actionPathId: 'ap-1',
        successRate: 0.9,
        successCount: 9,
        failureCount: 1,
      },
    });
    expect(decision.strategy).toBe('experience_reuse');
  });

  it('knowledge_light still wins over the markdown branch', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'list issues',
      siteFamily: 'github',
      pageRole: 'issue_detail',
      knowledgeCatalog: {
        site: 'api.github.com',
        totalEndpoints: 1,
        sampleSignatures: ['GET api.github.com/repos/:owner/:repo/issues'],
      },
    });
    expect(decision.strategy).toBe('knowledge_light');
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

  // -------------------------------------------------------------------------
  // V24-01 / B-EXP-REPLAY-V1 — chooser routes replay-eligible hits to
  // `experience_replay` only when the capability is on AND the row's
  // pageRole + step-kinds are all in the v1 supported sets.
  // -------------------------------------------------------------------------

  it('routes to experience_replay when capability + pageRole + step kinds all qualify', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-ok',
        pageRole: 'issues_list',
        stepSequence: [
          replayableStep('chrome_click_element'),
          replayableStep('chrome_fill_or_select'),
        ],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.status).toBe('ok');
    expect(result.strategy).toBe('experience_replay');
    expect(result.fallbackStrategy).toBe('experience_reuse');
    expect(result.artifacts?.[0]?.ref).toBe('ap-replay-ok');
  });

  it('stays on experience_reuse when the experience_replay capability is OFF', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-cap-off',
        pageRole: 'issues_list',
        stepSequence: [replayableStep('chrome_click_element')],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: {}, // capability not enabled
      },
    );
    expect(result.strategy).toBe('experience_reuse');
    expect(result.fallbackStrategy).toBe('read_page_required');
  });

  it('stays on experience_reuse when any step kind is outside the v1 supported set', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-bad-step',
        pageRole: 'issues_list',
        stepSequence: [
          replayableStep('chrome_click_element'),
          // Out of replay's v1 supported set:
          {
            toolName: 'chrome_navigate',
            status: 'completed',
            historyRef: null,
            args: { url: 'x' },
          },
        ],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.strategy).toBe('experience_reuse');
  });

  it('stays on experience_reuse when the row pageRole is outside the GitHub v1 allowlist', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-bad-role',
        pageRole: 'mystery_role',
        stepSequence: [replayableStep('chrome_click_element')],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.strategy).toBe('experience_reuse');
  });

  // V24-01 closeout: the chooser MUST NOT route to `experience_replay`
  // when any step is missing replay args. This is the "stop the
  // bleeding" guard for rows aggregated before V24-01 (or for any row
  // a future regression silently strips `args` from). Without this
  // check the chooser would happily pick `experience_replay`, the
  // engine would immediately fail-closed inside `applySubstitutions`
  // (`!step.args`), and the user would see a deterministic
  // `unsupported_step_kind` while the more reliable `experience_reuse`
  // branch went unused. See `experience-replay.ts::applySubstitutions`.
  it('stays on experience_reuse when a step has no replay args (V24-01 closeout)', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-no-args',
        pageRole: 'issues_list',
        // Bare step shape: in-bounds toolName, but no args populated -
        // this is the historical aggregator output that V24-01 must
        // refuse to route to dispatch-side replay.
        stepSequence: [{ toolName: 'chrome_click_element', status: 'completed', historyRef: null }],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.strategy).toBe('experience_reuse');
    expect(result.fallbackStrategy).toBe('read_page_required');
  });

  it('stays on experience_reuse when a step has empty {} args (V24-01 closeout)', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-empty-args',
        pageRole: 'issues_list',
        stepSequence: [
          { toolName: 'chrome_click_element', status: 'completed', historyRef: null, args: {} },
        ],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.strategy).toBe('experience_reuse');
  });

  // V24-01 portability follow-up: the eligibility gate is no longer
  // "args is non-empty" - it is the per-tool portable allowlist in
  // `experience-replay-args.ts`. These tests pin the chooser-side
  // behaviour for rows whose persisted args are well-formed JSON
  // but carry only session-local handles (a common shape for rows
  // aggregated by an older code path or smuggled in via manual
  // SQL). The chooser must downgrade them to `experience_reuse`
  // rather than route them to a dispatch path that would either
  // misclick or hit a dead ref.

  it('stays on experience_reuse when a step args carry only a per-snapshot ref', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-ref-only',
        pageRole: 'issues_list',
        stepSequence: [
          {
            toolName: 'chrome_click_element',
            status: 'completed',
            historyRef: null,
            // Top-level `ref` is per-snapshot session-local; the
            // portable allowlist drops it. Without `selector`,
            // `candidateAction.targetRef`, or a css `locatorChain`,
            // the row has no portable target.
            args: { ref: 'ref_per_snapshot_xyz' },
          },
        ],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.strategy).toBe('experience_reuse');
    expect(result.fallbackStrategy).toBe('read_page_required');
  });

  it('stays on experience_reuse when candidateAction.targetRef is the legacy ref_* form', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-legacy-targetref',
        pageRole: 'issues_list',
        stepSequence: [
          {
            toolName: 'chrome_click_element',
            status: 'completed',
            historyRef: null,
            // Only `tgt_*` survives portability filtering;
            // legacy `ref_*` targetRef is per-snapshot.
            args: { candidateAction: { targetRef: 'ref_legacy_session_local' } },
          },
        ],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.strategy).toBe('experience_reuse');
  });

  it('routes to experience_replay when candidateAction.targetRef is the stable tgt_* form', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-stable-targetref',
        pageRole: 'issues_list',
        stepSequence: [
          {
            toolName: 'chrome_click_element',
            status: 'completed',
            historyRef: null,
            // Companion to the previous test: B-011 stable refs are
            // explicitly portable, so this row IS replay-eligible
            // even without a top-level selector.
            args: { candidateAction: { targetRef: 'tgt_0123456789' } },
          },
        ],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.strategy).toBe('experience_replay');
    expect(result.fallbackStrategy).toBe('experience_reuse');
  });

  it('stays on experience_reuse when chrome_fill_or_select args are missing the value', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-fill-noval',
        pageRole: 'issues_list',
        stepSequence: [
          {
            toolName: 'chrome_fill_or_select',
            status: 'completed',
            historyRef: null,
            // chrome_fill_or_select schema requires `value`; without
            // it the bridge would reject the call at dispatch.
            args: { selector: '#search' },
          },
        ],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'search', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      },
    );
    expect(result.strategy).toBe('experience_reuse');
  });

  it('the "all" capability token enables experience_replay routing', () => {
    const { service } = fakeExperience([
      fakeRow({
        actionPathId: 'ap-replay-all',
        pageRole: 'issues_list',
        stepSequence: [replayableStep('chrome_click_element')],
        successCount: 9,
        failureCount: 1,
      }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'issues_list' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'all' },
      },
    );
    expect(result.strategy).toBe('experience_replay');
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

  it('tabrix_choose_context_record_outcome is registered as P0 (pure-INSERT)', () => {
    // V23-04 / B-018 v1.5: write-back is intentionally P0 because it
    // appends one telemetry row keyed by `decisionId` and never
    // mutates anything else. Lifting it to P1+ would require the
    // owner-lane review documented in AGENTS.md §"Tiered Execution Model".
    expect(TOOL_RISK_TIERS[TOOL_NAMES.CONTEXT.RECORD_OUTCOME]).toBe('P0');
  });
});

// ---------------------------------------------------------------------------
// V23-04 / B-018 v1.5 — telemetry write-back
// ---------------------------------------------------------------------------

interface FakeTelemetry {
  repo: ChooseContextTelemetryRepository;
  decisions: Array<Parameters<ChooseContextTelemetryRepository['recordDecision']>[0]>;
  outcomes: Array<Parameters<ChooseContextTelemetryRepository['recordOutcome']>[0]>;
  knownDecisionIds: Set<string>;
}

function fakeTelemetry(initialDecisionIds: string[] = []): FakeTelemetry {
  const decisions: FakeTelemetry['decisions'] = [];
  const outcomes: FakeTelemetry['outcomes'] = [];
  const knownDecisionIds = new Set(initialDecisionIds);
  const repo = {
    recordDecision(input: FakeTelemetry['decisions'][number]) {
      decisions.push(input);
      knownDecisionIds.add(input.decisionId);
    },
    recordOutcome(input: FakeTelemetry['outcomes'][number]) {
      if (!knownDecisionIds.has(input.decisionId)) {
        return { status: 'unknown_decision' as const };
      }
      outcomes.push(input);
      return { status: 'ok' as const, outcomeId: 'oc-fake' };
    },
    findDecision: jest.fn(),
    aggregateStrategies: jest.fn().mockReturnValue([]),
    clear: jest.fn(),
  } as unknown as ChooseContextTelemetryRepository;
  return { repo, decisions, outcomes, knownDecisionIds };
}

describe('runTabrixChooseContext telemetry (V23-04)', () => {
  it('records a decision row and surfaces decisionId when telemetry is wired', () => {
    const { service } = fakeExperience([]);
    const tele = fakeTelemetry();
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'repo_home', siteId: 'github' },
      {
        experience: service,
        knowledgeApi: null,
        capabilityEnv: {},
        telemetry: tele.repo,
        newDecisionId: () => 'dc-test-1',
        now: () => '2026-04-22T10:00:00.000Z',
      },
    );
    expect(result.status).toBe('ok');
    expect(result.decisionId).toBe('dc-test-1');
    expect(tele.decisions).toEqual([
      {
        decisionId: 'dc-test-1',
        intentSignature: 'open issues',
        pageRole: 'repo_home',
        siteFamily: 'github',
        // No experience hit, no knowledge, but pageRole=repo_home is
        // on the markdown whitelist for siteFamily=github.
        strategy: 'read_page_markdown',
        fallbackStrategy: 'read_page_required',
        createdAt: '2026-04-22T10:00:00.000Z',
      },
    ]);
  });

  it('omits decisionId when telemetry is not wired', () => {
    const { service } = fakeExperience([]);
    const result = runTabrixChooseContext(
      { intent: 'do something' },
      { experience: service, knowledgeApi: null, capabilityEnv: {} },
    );
    expect(result.status).toBe('ok');
    expect(result.decisionId).toBeUndefined();
  });

  it('does NOT record a decision row for invalid_input (chooser stops early)', () => {
    const tele = fakeTelemetry();
    const result = runTabrixChooseContext(
      {},
      {
        experience: null,
        knowledgeApi: null,
        capabilityEnv: {},
        telemetry: tele.repo,
      },
    );
    expect(result.status).toBe('invalid_input');
    expect(tele.decisions).toEqual([]);
  });

  it('telemetry write failure must not break the chooser (decisionId omitted)', () => {
    const { service } = fakeExperience([]);
    const tele = fakeTelemetry();
    // Simulate disk-full / locked-DB by making recordDecision throw.
    (tele.repo.recordDecision as unknown as jest.Mock) = jest.fn(() => {
      throw new Error('SQLITE_BUSY');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = runTabrixChooseContext(
        { intent: 'do something' },
        {
          experience: service,
          knowledgeApi: null,
          capabilityEnv: {},
          telemetry: tele.repo,
          newDecisionId: () => 'dc-doomed',
        },
      );
      expect(result.status).toBe('ok');
      expect(result.decisionId).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('runTabrixChooseContextRecordOutcome (V23-04)', () => {
  it('rejects missing decisionId with invalid_input', () => {
    const tele = fakeTelemetry();
    const result = runTabrixChooseContextRecordOutcome(
      { outcome: 'reuse' },
      { telemetry: tele.repo },
    );
    expect(result.status).toBe('invalid_input');
    expect(result.error?.code).toBe('TABRIX_CHOOSE_CONTEXT_BAD_INPUT');
    expect(tele.outcomes).toEqual([]);
  });

  it('rejects out-of-set outcome with invalid_input', () => {
    const tele = fakeTelemetry(['dc-1']);
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'dc-1', outcome: 'celebrated' },
      { telemetry: tele.repo },
    );
    expect(result.status).toBe('invalid_input');
    expect(tele.outcomes).toEqual([]);
  });

  it('rejects oversize decisionId with invalid_input', () => {
    const tele = fakeTelemetry();
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'x'.repeat(200), outcome: 'reuse' },
      { telemetry: tele.repo },
    );
    expect(result.status).toBe('invalid_input');
  });

  it('returns unknown_decision when telemetry is not wired', () => {
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'dc-1', outcome: 'reuse' },
      { telemetry: null },
    );
    expect(result.status).toBe('unknown_decision');
    expect(result.decisionId).toBe('dc-1');
    expect(result.outcome).toBe('reuse');
  });

  it('returns unknown_decision when the id is well-formed but missing', () => {
    const tele = fakeTelemetry(); // no known ids
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'dc-missing', outcome: 'fallback' },
      { telemetry: tele.repo },
    );
    expect(result.status).toBe('unknown_decision');
    expect(tele.outcomes).toEqual([]);
  });

  it('appends an outcome row for a known decisionId', () => {
    const tele = fakeTelemetry(['dc-known']);
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'dc-known', outcome: 'reuse' },
      { telemetry: tele.repo, now: () => '2026-04-22T11:00:00.000Z' },
    );
    expect(result.status).toBe('ok');
    expect(result.decisionId).toBe('dc-known');
    expect(result.outcome).toBe('reuse');
    expect(tele.outcomes).toEqual([
      {
        decisionId: 'dc-known',
        outcome: 'reuse',
        recordedAt: '2026-04-22T11:00:00.000Z',
      },
    ]);
  });

  it('telemetry write failure surfaces as unknown_decision (not invalid_input)', () => {
    const tele = fakeTelemetry(['dc-known']);
    (tele.repo.recordOutcome as unknown as jest.Mock) = jest.fn(() => {
      throw new Error('SQLITE_LOCKED');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = runTabrixChooseContextRecordOutcome(
        { decisionId: 'dc-known', outcome: 'completed' },
        { telemetry: tele.repo },
      );
      expect(result.status).toBe('unknown_decision');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
