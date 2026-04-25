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
import { runTabrixChooseContext, runTabrixChooseContextRecordOutcome } from './choose-context';
import { createLivePageContextProvider } from './page-context-provider';
import type { CapabilityEnv } from '../policy/capabilities';
import type { SessionManager } from '../execution/session-manager';
import {
  experienceReplayNativeHandler,
  type DispatchBridgedFn,
  type ReplayOutcomeWriter,
  type ReplayStepRecorder,
  type UpdateTaskIntentFn,
} from './experience-replay';
import { experienceScoreStepNativeHandler } from './experience-score-step';

export interface NativeToolHandlerDeps {
  sessionManager: Pick<
    SessionManager,
    | 'experience'
    | 'getPersistenceStatus'
    | 'knowledgeApi'
    | 'chooseContextTelemetry'
    | 'pageSnapshots'
  >;
  /**
   * Capability allowlist source. Optional so existing handler tests
   * (which only need `sessionManager`) keep compiling; missing means
   * "no capabilities enabled" — i.e. the safest default.
   */
  capabilityEnv?: CapabilityEnv;
  /**
   * V24-01: bridge into the existing extension-side dispatch path
   * (`invokeExtensionCommand('call_tool', …)`). Required at runtime
   * for `experience_replay`; other handlers ignore it. Optional so
   * pre-existing handler tests (and the SUGGEST_PLAN / CONTEXT
   * handlers themselves) stay source-compatible.
   */
  dispatchBridged?: DispatchBridgedFn;
  /**
   * V24-01: per-step `memory_steps` recorder bound to the wrapper's
   * current session. Required for `experience_replay`.
   */
  recorder?: ReplayStepRecorder;
  /**
   * V24-01: callback to re-tag the wrapper-owned session's
   * `task.intent` with the `experience_replay:<id>` prefix. Required
   * for `experience_replay` so the aggregator's brief §7 special-case
   * triggers.
   */
  updateTaskIntent?: UpdateTaskIntentFn;
  /**
   * V24-02: per-step write-back hook used by the replay engine.
   * Optional so existing handler tests stay source-compatible.
   */
  outcomeWriter?: ReplayOutcomeWriter;
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
  // V26-04 (B-027): wire the live page context provider so the
  // dispatcher receives real candidateActions / HVO counts instead
  // of the v25 hard-coded zeros. When persistence is off
  // `pageSnapshots` is `null` and the provider returns
  // `fallback_zero` with cause `persistence_off` — honest telemetry,
  // same numerical dispatcher input the chooser used to ship.
  const pageContext = createLivePageContextProvider(deps.sessionManager.pageSnapshots ?? null);
  const result = runTabrixChooseContext(args, {
    experience: deps.sessionManager.experience,
    knowledgeApi: deps.sessionManager.knowledgeApi,
    capabilityEnv: deps.capabilityEnv ?? {},
    telemetry: deps.sessionManager.chooseContextTelemetry,
    pageContext,
  });
  return jsonResult(result, result.status === 'invalid_input');
};

const handleTabrixChooseContextRecordOutcome: NativeToolHandler = (args, deps) => {
  const result = runTabrixChooseContextRecordOutcome(args, {
    telemetry: deps.sessionManager.chooseContextTelemetry,
  });
  // Only `invalid_input` is a structural error; `unknown_decision` is
  // a legitimate response the caller can branch on.
  return jsonResult(result, result.status === 'invalid_input');
};

/**
 * V24-01 adapter. Reshapes the experience-replay handler's typed deps
 * (`ExperienceReplayHandlerDeps`) into the generic
 * {@link NativeToolHandlerDeps} contract so it slots into the
 * existing dispatch table without leaking replay-specific types
 * upward. The replay handler itself uses a structural cast back to
 * its real deps shape.
 */
const handleExperienceReplayBridged: NativeToolHandler = async (args, deps) => {
  // The replay handler reaches into `deps` via a structural cast and
  // pulls out `experience` / `dispatchBridged` / `recorder` /
  // `updateTaskIntent` / `capabilityEnv` / `persistenceMode` itself.
  // We just need to supply `experience` (the read-only Experience
  // façade) and the persistence mode here; the wrapper
  // (`register-tools.ts`) supplies the rest.
  const persistenceMode = deps.sessionManager.getPersistenceStatus().mode;
  const reshaped = {
    ...deps,
    experience: deps.sessionManager.experience,
    persistenceMode,
  } as unknown as Parameters<typeof experienceReplayNativeHandler>[1];
  return await experienceReplayNativeHandler(args, reshaped);
};

/**
 * V24-02 adapter. Same plumbing as `handleExperienceReplayBridged` —
 * the score-step handler reads `experience` (write-back capable) and
 * `persistenceMode` from `deps` via a structural cast. No bridge /
 * recorder / intent re-tagger needed: the tool only writes to
 * SQLite, never to the extension-side dispatch path.
 */
const handleExperienceScoreStepBridged: NativeToolHandler = async (args, deps) => {
  const persistenceMode = deps.sessionManager.getPersistenceStatus().mode;
  const reshaped = {
    ...deps,
    experience: deps.sessionManager.experience,
    persistenceMode,
  } as unknown as Parameters<typeof experienceScoreStepNativeHandler>[1];
  return await experienceScoreStepNativeHandler(args, reshaped);
};

const NATIVE_HANDLERS: ReadonlyMap<string, NativeToolHandler> = new Map([
  [TOOL_NAMES.EXPERIENCE.SUGGEST_PLAN, handleExperienceSuggestPlan],
  [TOOL_NAMES.EXPERIENCE.REPLAY, handleExperienceReplayBridged],
  [TOOL_NAMES.EXPERIENCE.SCORE_STEP, handleExperienceScoreStepBridged],
  [TOOL_NAMES.CONTEXT.CHOOSE, handleTabrixChooseContext],
  [TOOL_NAMES.CONTEXT.RECORD_OUTCOME, handleTabrixChooseContextRecordOutcome],
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
