/**
 * Native-handled MCP tools.
 *
 * Most Tabrix MCP tools delegate to the Chrome extension because they
 * touch the browser. Tools registered here are the exception: their
 * data lives entirely in the native-server (SQLite Memory/Experience
 * tables) and routing them through the extension would just add a
 * round-trip and a failure mode.
 *
 * Routing contract for `register-tools.ts`:
 *   1. After the tool passes `filterToolsByEnvironment` and
 *      `isToolAllowedByPolicy`, look it up in `nativeToolHandlers`.
 *   2. If a handler exists, call it instead of `invokeExtensionCommand`.
 *      The handler is responsible for returning a `CallToolResult`.
 *   3. The wrapper still records `step.completeStep` /
 *      `session.finishSession` based on whether the result was an error.
 *
 * The handlers themselves are pure functions of `(args, deps)` — `deps`
 * is injected so tests can supply a stub `SessionManager` without
 * touching the singleton.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES, type ExperienceSuggestPlanResult } from '@tabrix/shared';
import { sessionManager as defaultSessionManager } from '../execution/session-manager';
import {
  ExperienceSuggestPlanInputError,
  buildSuggestPlanResult,
  parseExperienceSuggestPlanInput,
} from '../memory/experience';
import { runTabrixChooseContext } from './choose-context';
import type { CapabilityEnv } from '../policy/capabilities';
import type { SessionManager } from '../execution/session-manager';

export interface NativeToolHandlerDeps {
  sessionManager: Pick<SessionManager, 'experience' | 'getPersistenceStatus' | 'knowledgeApi'>;
  /**
   * Capability allowlist source. Optional so existing handler tests
   * (which only need `sessionManager`) keep compiling; missing means
   * "no capabilities enabled" — i.e. the safest default.
   */
  capabilityEnv?: CapabilityEnv;
}

export type NativeToolHandler = (
  args: unknown,
  deps: NativeToolHandlerDeps,
) => Promise<CallToolResult> | CallToolResult;

function jsonResult(payload: unknown, isError: boolean): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload),
      },
    ],
    isError,
  };
}

function badInputResult(error: ExperienceSuggestPlanInputError): CallToolResult {
  return jsonResult(
    {
      code: error.code,
      message: error.message,
    },
    true,
  );
}

function experienceUnavailableResult(): CallToolResult {
  // We deliberately return a successful tool call with `status: 'no_match'`
  // and `persistenceMode: 'off'` rather than `isError: true`. The caller
  // can branch on `persistenceMode` to decide whether to retry later or
  // proceed without prior experience; treating Memory-disabled as a hard
  // tool error would force every upstream agent to special-case it.
  const result: ExperienceSuggestPlanResult = {
    status: 'no_match',
    plans: [],
    persistenceMode: 'off',
  };
  return jsonResult(result, false);
}

const handleExperienceSuggestPlan: NativeToolHandler = (args, deps) => {
  let parsed;
  try {
    parsed = parseExperienceSuggestPlanInput(args);
  } catch (error) {
    if (error instanceof ExperienceSuggestPlanInputError) {
      return badInputResult(error);
    }
    throw error;
  }

  const experience = deps.sessionManager.experience;
  const { mode } = deps.sessionManager.getPersistenceStatus();
  if (!experience || mode === 'off') {
    return experienceUnavailableResult();
  }

  const rows = experience.suggestActionPaths(parsed);
  return jsonResult(buildSuggestPlanResult(rows, mode), false);
};

const handleTabrixChooseContext: NativeToolHandler = (args, deps) => {
  const result = runTabrixChooseContext(args, {
    experience: deps.sessionManager.experience,
    knowledgeApi: deps.sessionManager.knowledgeApi,
    capabilityEnv: deps.capabilityEnv ?? {},
  });
  return jsonResult(result, result.status === 'invalid_input');
};

const NATIVE_HANDLERS: ReadonlyMap<string, NativeToolHandler> = new Map([
  [TOOL_NAMES.EXPERIENCE.SUGGEST_PLAN, handleExperienceSuggestPlan],
  [TOOL_NAMES.CONTEXT.CHOOSE, handleTabrixChooseContext],
]);

export function getNativeToolHandler(toolName: string): NativeToolHandler | undefined {
  return NATIVE_HANDLERS.get(toolName);
}

/**
 * Convenience wrapper for `register-tools.ts`. Resolves the default
 * sessionManager singleton at call time so callers do not need to
 * pass it through.
 */
export async function invokeNativeToolHandler(
  toolName: string,
  args: unknown,
): Promise<CallToolResult | undefined> {
  const handler = getNativeToolHandler(toolName);
  if (!handler) return undefined;
  return await handler(args, {
    sessionManager: defaultSessionManager,
    capabilityEnv: {
      TABRIX_POLICY_CAPABILITIES: process.env.TABRIX_POLICY_CAPABILITIES,
    },
  });
}
