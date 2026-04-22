import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import { getNativeToolHandler } from './native-tool-handlers';
import type { NativeToolHandler, NativeToolHandlerDeps } from './native-tool-handlers';
import type { ExperienceQueryService } from '../memory/experience';

function callTextPayload(result: CallToolResult): any {
  const text = String(result.content?.[0]?.text ?? '');
  return JSON.parse(text);
}

function makeDeps(
  overrides: Partial<{
    mode: 'disk' | 'memory' | 'off';
    enabled: boolean;
    experience: ExperienceQueryService | null;
  }> = {},
): NativeToolHandlerDeps {
  return {
    sessionManager: {
      get experience() {
        return overrides.experience ?? null;
      },
      getPersistenceStatus() {
        return {
          mode: overrides.mode ?? 'disk',
          enabled: overrides.enabled ?? true,
        };
      },
    } as unknown as NativeToolHandlerDeps['sessionManager'],
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
