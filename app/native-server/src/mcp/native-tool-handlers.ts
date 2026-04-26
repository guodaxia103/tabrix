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
import { getCurrentCapabilityEnv, type CapabilityEnv } from '../policy/capabilities';
import type { SessionManager } from '../execution/session-manager';
import type { TaskSessionContext } from '../execution/task-session-context';
import type { ChooseContextDecisionSnapshot } from '../execution/skip-read-orchestrator';
import type { LayerSourceRoute, TabrixChooseContextResult } from '@tabrix/shared';
import { resolveApiKnowledgeCandidate } from '../api/api-knowledge';
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
  /**
   * V26-03 (B-026): the externally-keyed `TaskSessionContext` the
   * dispatcher resolved for this tool call. Wired exclusively for
   * `tabrix_choose_context` so its decision (sourceRoute / chosenLayer
   * / token estimate / replay candidate / API capability) lands in
   * the SAME context the `chrome_read_page` shim later peeks via
   * `peekChooseContextDecision`. Other handlers ignore the field.
   *
   * `null` when the wrapper resolved no context (tools outside the
   * auto-key set without an explicit `taskSessionId`). The chooser
   * handler treats that as "no context to write to" and leaves the
   * skip-read execution loop dormant — same as the v2.5 happy path.
   */
  taskContext?: TaskSessionContext | null;
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
  // V26-03 (B-026): close the skip-read execution loop. When the
  // wrapper provided a `TaskSessionContext` AND the chooser produced
  // an actionable layer-dispatch result, write the decision into
  // the context BEFORE we return. The next `chrome_read_page` call
  // on the same key reads it via `peekChooseContextDecision` and
  // the orchestrator decides skip vs forward vs fallback. Hard
  // rules (session corrections #2/#3/#4):
  //   * `noteUrlChange` runs FIRST so a chooser call against a
  //     different page than the one currently held in the context
  //     wipes the prior decision (per task-session-context tests).
  //   * Only `experience_replay_skip_read` may attach a real
  //     `replayCandidate`; every other route stores `null` so the
  //     orchestrator's gates fire honestly (`replay_candidate_missing`).
  //   * `apiCapability` is attached only when V26-07 can resolve a
  //     real read-only API candidate for the `knowledge_supported_read`
  //     route — never fake `available: true`.
  if (deps.taskContext && result.status === 'ok') {
    persistChooseContextDecision(args, result, deps.taskContext);
  }
  return jsonResult(result, result.status === 'invalid_input');
};

/**
 * V26-03 (B-026) — translate the chooser result + raw args into a
 * {@link ChooseContextDecisionSnapshot} and write it onto the live
 * `TaskSessionContext`. Pure-ish: only side-effect is the two
 * setters on the context. Skips the write when `chosenLayer` /
 * `sourceRoute` are absent (would mean the chooser hit a
 * pre-V25-02 path that has no layer dispatch attached — extremely
 * unlikely on the production code path, but the sentinel keeps the
 * read-side `planSkipRead` happy because it would otherwise see
 * `undefined` fields and force `'forward'`).
 */
function persistChooseContextDecision(
  rawArgs: unknown,
  result: TabrixChooseContextResult,
  taskContext: TaskSessionContext,
): void {
  if (!result.chosenLayer || !result.sourceRoute) return;

  const argsObj =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  const url = typeof argsObj.url === 'string' && argsObj.url.length > 0 ? argsObj.url : null;
  const pageRole =
    typeof argsObj.pageRole === 'string' && argsObj.pageRole.length > 0
      ? argsObj.pageRole
      : (result.resolved?.pageRole ?? null);

  // Always sync the URL/pageRole first. If they changed since the
  // prior read on this context, `noteUrlChange` clears `lastReadLayer`
  // / `targetRefsSeen` AND any prior chooser decision so the snapshot
  // we are about to write is the only authority. Idempotent same-page
  // calls are a no-op so a chooser that re-runs on the SAME page does
  // not clobber its own decision.
  taskContext.noteUrlChange(url, pageRole);

  const sourceRoute = result.sourceRoute as LayerSourceRoute;

  // Replay candidate is attached ONLY on the
  // `experience_replay_skip_read` route AND when the chooser surfaced
  // an `experience` / `experience_ranked` artifact. Replay eligibility
  // is gated upstream (`rankExperienceCandidates.topReplayEligible`)
  // by capability + step kinds + page role + threshold + portability;
  // by the time the chooser picks `experience_replay`, those gates
  // already passed for the top candidate, so the snapshot reports
  // `policyOk: true` / `portableArgsOk: true`.
  let replayCandidate: ChooseContextDecisionSnapshot['replayCandidate'] = null;
  if (sourceRoute === 'experience_replay_skip_read') {
    const experienceArtifact = result.artifacts?.find(
      (artifact) => artifact.kind === 'experience' || artifact.kind === 'experience_ranked',
    );
    const actionPathId = experienceArtifact?.ref;
    if (typeof actionPathId === 'string' && actionPathId.length > 0) {
      replayCandidate = { actionPathId, portableArgsOk: true, policyOk: true };
    }
    // No artifact / empty ref → leave `replayCandidate = null`. The
    // orchestrator turns that into `'fallback_required' /
    // 'replay_candidate_missing'` per session correction #4.
  }

  let apiCapability: ChooseContextDecisionSnapshot['apiCapability'] = null;
  if (sourceRoute === 'knowledge_supported_read') {
    const candidate = resolveApiKnowledgeCandidate({
      intent: typeof argsObj.intent === 'string' ? argsObj.intent : '',
      url: url ?? undefined,
      pageRole: pageRole ?? undefined,
    });
    if (candidate) {
      apiCapability = {
        available: true,
        family: candidate.endpointFamily,
        dataPurpose: candidate.dataPurpose,
        params: candidate.params,
      };
    }
  }

  const snapshot: ChooseContextDecisionSnapshot = {
    sourceRoute,
    chosenLayer: result.chosenLayer,
    fullReadTokenEstimate:
      typeof result.tokenEstimateFullRead === 'number' &&
      Number.isFinite(result.tokenEstimateFullRead) &&
      result.tokenEstimateFullRead > 0
        ? Math.floor(result.tokenEstimateFullRead)
        : 0,
    replayCandidate,
    apiCapability,
  };
  taskContext.noteChooseContextDecision(snapshot);
}

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
    capabilityEnv: getCurrentCapabilityEnv(),
  });
}
