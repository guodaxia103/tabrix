import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import { getNativeToolHandler } from './native-tool-handlers';
import type { NativeToolHandler, NativeToolHandlerDeps } from './native-tool-handlers';
import type { ExperienceQueryService } from '../memory/experience';
import type { ExperienceActionPathRow } from '../memory/experience/experience-repository';
import type { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import type { CapabilityEnv } from '../policy/capabilities';
import type {
  DispatchBridgedFn,
  ReplayStepRecorder,
  UpdateTaskIntentFn,
} from './experience-replay';

function callTextPayload(result: CallToolResult): any {
  const text = String(result.content?.[0]?.text ?? '');
  return JSON.parse(text);
}

function makeDeps(
  overrides: Partial<{
    mode: 'disk' | 'memory' | 'off';
    enabled: boolean;
    experience: ExperienceQueryService | null;
    knowledgeApi: KnowledgeApiRepository | null;
    capabilityEnv: CapabilityEnv;
    dispatchBridged: DispatchBridgedFn;
    recorder: ReplayStepRecorder;
    updateTaskIntent: UpdateTaskIntentFn;
  }> = {},
): NativeToolHandlerDeps {
  return {
    sessionManager: {
      get experience() {
        return overrides.experience ?? null;
      },
      get knowledgeApi() {
        return overrides.knowledgeApi ?? null;
      },
      getPersistenceStatus() {
        return {
          mode: overrides.mode ?? 'disk',
          enabled: overrides.enabled ?? true,
        };
      },
    } as unknown as NativeToolHandlerDeps['sessionManager'],
    capabilityEnv: overrides.capabilityEnv,
    dispatchBridged: overrides.dispatchBridged,
    recorder: overrides.recorder,
    updateTaskIntent: overrides.updateTaskIntent,
  };
}

function getHandler(): NativeToolHandler {
  const handler = getNativeToolHandler(TOOL_NAMES.EXPERIENCE.SUGGEST_PLAN);
  if (!handler) throw new Error('experience_suggest_plan handler missing');
  return handler;
}

describe('native-tool-handlers · experience_suggest_plan', () => {
  it('registers under TOOL_NAMES.EXPERIENCE.SUGGEST_PLAN', () => {
    expect(getNativeToolHandler(TOOL_NAMES.EXPERIENCE.SUGGEST_PLAN)).toBeDefined();
  });

  it('returns a typed bad-input error when intent is missing', async () => {
    const handler = getHandler();
    const result = await handler({}, makeDeps());
    expect(result.isError).toBe(true);
    expect(callTextPayload(result)).toMatchObject({
      code: 'TABRIX_EXPERIENCE_SUGGEST_PLAN_BAD_INPUT',
    });
  });

  it('returns persistenceMode=off / status=no_match when persistence is off', async () => {
    const handler = getHandler();
    const result = await handler(
      { intent: 'open issues' },
      makeDeps({ experience: null, mode: 'off', enabled: false }),
    );
    expect(result.isError).toBe(false);
    expect(callTextPayload(result)).toEqual({
      status: 'no_match',
      plans: [],
      persistenceMode: 'off',
    });
  });

  it('forwards parsed input to ExperienceQueryService and projects rows', async () => {
    const handler = getHandler();
    const suggestActionPaths = jest.fn().mockReturnValue([
      {
        actionPathId: 'ap-1',
        pageRole: 'repo_home',
        intentSignature: 'open issues',
        stepSequence: [
          { toolName: 'chrome_click_element', status: 'completed', historyRef: 'h://a' },
        ],
        successCount: 4,
        failureCount: 1,
        lastUsedAt: '2026-04-21T10:00:00.000Z',
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-21T10:00:00.000Z',
      },
    ]);
    const fakeExperience = { suggestActionPaths } as unknown as ExperienceQueryService;

    const result = await handler(
      { intent: '  Open   Issues  ', pageRole: 'repo_home', limit: 3 },
      makeDeps({ experience: fakeExperience, mode: 'disk' }),
    );

    expect(result.isError).toBe(false);
    const body = callTextPayload(result);
    expect(body.status).toBe('ok');
    expect(body.persistenceMode).toBe('disk');
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].successRate).toBeCloseTo(0.8, 5);

    expect(suggestActionPaths).toHaveBeenCalledTimes(1);
    const args = suggestActionPaths.mock.calls[0][0];
    expect(args.intentSignature).toBe('open issues');
    expect(args.pageRole).toBe('repo_home');
    expect(args.limit).toBe(3);
  });

  it('returns no_match when query returns []', async () => {
    const handler = getHandler();
    const fakeExperience = {
      suggestActionPaths: jest.fn().mockReturnValue([]),
    } as unknown as ExperienceQueryService;

    const result = await handler(
      { intent: 'unseen intent' },
      makeDeps({ experience: fakeExperience, mode: 'memory' }),
    );

    expect(result.isError).toBe(false);
    expect(callTextPayload(result)).toEqual({
      status: 'no_match',
      plans: [],
      persistenceMode: 'memory',
    });
  });
});

describe('native-tool-handlers · tabrix_choose_context (B-018 v1)', () => {
  function getChooseHandler(): NativeToolHandler {
    const handler = getNativeToolHandler(TOOL_NAMES.CONTEXT.CHOOSE);
    if (!handler) throw new Error('tabrix_choose_context handler missing');
    return handler;
  }

  it('registers under TOOL_NAMES.CONTEXT.CHOOSE', () => {
    expect(getNativeToolHandler(TOOL_NAMES.CONTEXT.CHOOSE)).toBeDefined();
  });

  it('returns invalid_input with isError=true when intent is missing', async () => {
    const handler = getChooseHandler();
    const result = await handler({}, makeDeps());
    expect(result.isError).toBe(true);
    expect(callTextPayload(result)).toMatchObject({
      status: 'invalid_input',
      error: { code: 'TABRIX_CHOOSE_CONTEXT_BAD_INPUT' },
    });
  });

  it('falls back to read_page_required when nothing is wired', async () => {
    const handler = getChooseHandler();
    const result = await handler({ intent: 'open issues' }, makeDeps());
    expect(result.isError).toBe(false);
    expect(callTextPayload(result)).toMatchObject({
      status: 'ok',
      strategy: 'read_page_required',
      artifacts: [],
    });
  });

  it('routes to experience_reuse when the experience query returns a winning plan', async () => {
    const handler = getChooseHandler();
    const fakeExperience = {
      suggestActionPaths: jest.fn().mockReturnValue([
        {
          actionPathId: 'ap-experience',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [],
          successCount: 8,
          failureCount: 2,
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-22T00:00:00.000Z',
        },
      ]),
    } as unknown as ExperienceQueryService;

    const result = await handler(
      { intent: 'open issues', pageRole: 'repo_home' },
      makeDeps({ experience: fakeExperience }),
    );
    expect(result.isError).toBe(false);
    const body = callTextPayload(result);
    expect(body.strategy).toBe('experience_reuse');
    expect(body.fallbackStrategy).toBe('read_page_required');
    // V24-03 promoted the chooser artifact to the `experience_ranked`
    // shape whenever any Experience row surfaces — even when the
    // chooser ultimately picks `experience_reuse`. The legacy `kind:
    // 'experience'` shape is now reserved for the (vanishing) corner
    // case where ranking returned zero candidates but the legacy
    // `experienceHit` projection kept one in scope; on this test
    // fixture the row IS the top-1 ranked candidate.
    expect(body.artifacts[0]).toMatchObject({
      kind: 'experience_ranked',
      ref: 'ap-experience',
    });
  });

  it('routes to knowledge_light only when capability is enabled and repo non-empty', async () => {
    const handler = getChooseHandler();
    const fakeExperience = {
      suggestActionPaths: jest.fn().mockReturnValue([]),
    } as unknown as ExperienceQueryService;
    const listBySite = jest.fn().mockReturnValue([
      {
        endpointId: 'ep-1',
        site: 'api.github.com',
        family: 'github',
        method: 'GET',
        urlPattern: '/repos/:owner/:repo/issues',
        endpointSignature: 'GET api.github.com/repos/:owner/:repo/issues',
        semanticTag: null,
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
      },
    ]);
    const knowledgeApi = { listBySite } as unknown as KnowledgeApiRepository;

    const enabledResult = await handler(
      { intent: 'open issues', url: 'https://github.com/octocat/hello' },
      makeDeps({
        experience: fakeExperience,
        knowledgeApi,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
      }),
    );
    const enabledBody = callTextPayload(enabledResult);
    expect(enabledBody.strategy).toBe('knowledge_light');
    expect(listBySite).toHaveBeenCalledTimes(1);

    listBySite.mockClear();
    const disabledResult = await handler(
      { intent: 'open issues', url: 'https://github.com/octocat/hello' },
      makeDeps({
        experience: fakeExperience,
        knowledgeApi,
        // capabilityEnv left undefined → must be treated as default-deny.
      }),
    );
    const disabledBody = callTextPayload(disabledResult);
    expect(disabledBody.strategy).toBe('read_page_required');
    expect(listBySite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// V24-01: experience_replay handler dispatch wiring
// ---------------------------------------------------------------------------

describe('native-tool-handlers · experience_replay (V24-01)', () => {
  const VALID_ID = 'action_path_' + 'a'.repeat(64);

  function getReplayHandler(): NativeToolHandler {
    const handler = getNativeToolHandler(TOOL_NAMES.EXPERIENCE.REPLAY);
    if (!handler) throw new Error('experience_replay handler missing');
    return handler;
  }

  function buildReplayableRow(): ExperienceActionPathRow {
    return {
      actionPathId: VALID_ID,
      pageRole: 'issues_list',
      intentSignature: 'open repo issues tab',
      stepSequence: [
        {
          toolName: 'chrome_click_element',
          status: 'ok',
          historyRef: 'h1',
          args: { selector: '.issues-tab' },
        },
      ],
      successCount: 1,
      failureCount: 0,
      lastUsedAt: '2026-04-22T00:00:00.000Z',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
  }

  function makeRecorderSpy(): ReplayStepRecorder & {
    readonly starts: number;
    readonly completes: number;
    readonly fails: number;
  } {
    const state = { starts: 0, completes: 0, fails: 0 };
    return {
      startStep: () => {
        state.starts += 1;
        return `step-${state.starts}`;
      },
      completeStep: () => {
        state.completes += 1;
      },
      failStep: () => {
        state.fails += 1;
      },
      get starts() {
        return state.starts;
      },
      get completes() {
        return state.completes;
      },
      get fails() {
        return state.fails;
      },
    };
  }

  it('registers under TOOL_NAMES.EXPERIENCE.REPLAY', () => {
    expect(getNativeToolHandler(TOOL_NAMES.EXPERIENCE.REPLAY)).toBeDefined();
  });

  it('returns denied/capability_off when capability env is empty (default-deny)', async () => {
    const handler = getReplayHandler();
    const result = await handler({ actionPathId: VALID_ID }, makeDeps());
    expect(result.isError).toBe(true);
    const body = callTextPayload(result);
    expect(body.status).toBe('denied');
    expect(body.error?.code).toBe('capability_off');
  });

  it('returns failed-precondition/unknown_action_path when persistence is off', async () => {
    const handler = getReplayHandler();
    const result = await handler(
      { actionPathId: VALID_ID },
      makeDeps({
        mode: 'off',
        enabled: false,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      }),
    );
    expect(result.isError).toBe(true);
    const body = callTextPayload(result);
    expect(body.status).toBe('failed-precondition');
    expect(body.error?.code).toBe('unknown_action_path');
  });

  it('end-to-end: replays a single click step with capability + bridge wired up', async () => {
    const handler = getReplayHandler();
    const fakeExperience = {
      findActionPathById: jest.fn().mockReturnValue(buildReplayableRow()),
      suggestActionPaths: jest.fn(),
    } as unknown as ExperienceQueryService;
    const recorder = makeRecorderSpy();
    const dispatchBridged: DispatchBridgedFn = jest.fn(async () => ({
      content: [{ type: 'text' as const, text: '{"ok":true,"historyRef":"h_live_1"}' }],
      isError: false,
    }));
    const updateTaskIntent = jest.fn();

    const result = await handler(
      { actionPathId: VALID_ID },
      makeDeps({
        experience: fakeExperience,
        capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
        recorder,
        dispatchBridged,
        updateTaskIntent,
      }),
    );

    expect(result.isError).toBe(false);
    const body = callTextPayload(result);
    expect(body.status).toBe('ok');
    expect(body.evidenceRefs).toHaveLength(1);
    expect(body.evidenceRefs[0]).toMatchObject({
      stepIndex: 0,
      toolName: 'chrome_click_element',
      status: 'ok',
      historyRef: 'h_live_1',
    });
    expect(dispatchBridged).toHaveBeenCalledTimes(1);
    expect(recorder.starts).toBe(1);
    expect(recorder.completes).toBe(1);
    expect(recorder.fails).toBe(0);
    expect(updateTaskIntent).toHaveBeenCalledWith(`experience_replay:${VALID_ID}`);
  });
});
