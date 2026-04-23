/**
 * Tabrix MKEP Experience write/execute (V24-01) — `experience_replay` v1.
 *
 * Bridged tool: re-runs a NAMED `experience_action_paths` row by
 * dispatching its recorded `step_sequence` through the existing
 * extension-side per-step pipeline (`chrome_click_element`,
 * `chrome_fill_or_select`). Does NOT plan, does NOT invent steps,
 * does NOT call back into the upstream LLM mid-replay. Bounded,
 * fail-closed.
 *
 * SoT (owner-locked 2026-04-23): `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md`.
 *
 * Module layout:
 *   - `parseExperienceReplayInput` — strict input parser, returns a
 *     normalized `ParsedExperienceReplayInput` or throws
 *     {@link ExperienceReplayInputError} (mapped to `invalid_input`).
 *   - `ReplayEngine` — per-step dispatcher. Pure dependency injection
 *     so the whole flow is testable without a browser. Holds zero
 *     module-level state; instantiated per call.
 *   - `handleExperienceReplay` — MCP {@link NativeToolHandler}.
 *     Wraps gating + parsing + engine + result serialization.
 *
 * Lane discipline: this module never imports from
 * `app/chrome-extension/.../interaction.ts`. All browser-side work
 * goes through the {@link DispatchBridgedFn} adapter, which the
 * production wiring binds to the existing `invokeExtensionCommand`
 * round-trip in `register-tools.ts`.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CAPABILITY_GATED_TOOLS,
  MAX_TABRIX_EXPERIENCE_REPLAY_PATH_ID_CHARS,
  MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET,
  MAX_TABRIX_EXPERIENCE_REPLAY_SUBSTITUTION_VALUE_CHARS,
  TABRIX_EXPERIENCE_REPLAY_ACTION_PATH_ID_PATTERN,
  TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES,
  TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS,
  TABRIX_REPLAY_PLACEHOLDERS,
  TOOL_NAMES,
  type TabrixExperienceReplayErrorBody,
  type TabrixExperienceReplayResolved,
  type TabrixExperienceReplayResult,
  type TabrixExperienceReplayStepOutcome,
  type TabrixReplayFailureCode,
  type TabrixReplayInvalidInputCode,
  type TabrixReplayPlaceholder,
} from '@tabrix/shared';
import type {
  ExperienceActionPathRow,
  ExperienceActionPathStep,
  ExperienceRepository,
} from '../memory/experience/experience-repository';
import { isCapabilityEnabled, type CapabilityEnv } from '../policy/capabilities';
import type { NativeToolHandler } from './native-tool-handlers';

/** Whitelisted underlying tool names a v1 replay may dispatch. */
export type SupportedReplayToolName = 'chrome_click_element' | 'chrome_fill_or_select';

/**
 * Adapter that fires a single underlying tool through the existing
 * extension dispatch pipeline. Production binding lives in
 * `register-tools.ts`; tests inject a stub.
 */
export type DispatchBridgedFn = (
  toolName: SupportedReplayToolName,
  args: Record<string, unknown>,
) => Promise<CallToolResult>;

/**
 * Per-step recorder hooks the engine uses to write `memory_steps`
 * rows on the wrapper-owned session. Production binding maps to
 * `SessionManager.startStep` / `completeStep`; tests inject a spy.
 *
 * The engine never opens a session — that is the wrapper's job
 * (brief §7: one Memory session per replay, prefixed task intent).
 */
export interface ReplayStepRecorder {
  /** Record the start of a replayed step. Returns the implementation-defined step id. */
  startStep(input: { toolName: SupportedReplayToolName; inputSummary: string }): string;
  /** Record a successful step terminus. */
  completeStep(stepId: string, update: { resultSummary?: string; artifactRefs?: string[] }): void;
  /** Record a failed step terminus. */
  failStep(
    stepId: string,
    update: { failureCode: TabrixReplayFailureCode; errorSummary: string },
  ): void;
}

/** Parsed-and-normalized input shape the engine consumes. */
export interface ParsedExperienceReplayInput {
  actionPathId: string;
  variableSubstitutions: Partial<Record<TabrixReplayPlaceholder, string>>;
  /** Final step ceiling after defaulting + clamping. Always in `[1, MAX_STEP_BUDGET]`. */
  maxSteps: number;
  targetTabId?: number;
}

/** Thrown by {@link parseExperienceReplayInput} when the input is malformed. */
export class ExperienceReplayInputError extends Error {
  constructor(
    public readonly code: TabrixReplayInvalidInputCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExperienceReplayInputError';
  }
}

/**
 * Strict input parser. Every branch maps to a stable
 * {@link TabrixReplayInvalidInputCode}. The MCP layer surfaces the
 * thrown error as `status: 'invalid_input'` (no Memory session opened
 * — see brief §6 / §8.2).
 */
export function parseExperienceReplayInput(raw: unknown): ParsedExperienceReplayInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExperienceReplayInputError(
      'invalid_input',
      'experience_replay expects an object input',
    );
  }
  const obj = raw as Record<string, unknown>;

  // actionPathId
  const idValue = obj.actionPathId;
  if (idValue === undefined || idValue === null || idValue === '') {
    throw new ExperienceReplayInputError(
      'missing_action_path_id',
      'experience_replay: actionPathId is required',
    );
  }
  if (typeof idValue !== 'string') {
    throw new ExperienceReplayInputError(
      'invalid_action_path_id',
      'experience_replay: actionPathId must be a string',
    );
  }
  if (idValue.length > MAX_TABRIX_EXPERIENCE_REPLAY_PATH_ID_CHARS) {
    throw new ExperienceReplayInputError(
      'invalid_action_path_id',
      `experience_replay: actionPathId exceeds ${MAX_TABRIX_EXPERIENCE_REPLAY_PATH_ID_CHARS} chars`,
    );
  }
  if (!TABRIX_EXPERIENCE_REPLAY_ACTION_PATH_ID_PATTERN.test(idValue)) {
    throw new ExperienceReplayInputError(
      'invalid_action_path_id',
      'experience_replay: actionPathId must match ^action_path_[0-9a-f]{64}$',
    );
  }

  // variableSubstitutions
  const subsValue = obj.variableSubstitutions;
  const variableSubstitutions: Partial<Record<TabrixReplayPlaceholder, string>> = {};
  if (subsValue !== undefined) {
    if (subsValue === null || typeof subsValue !== 'object' || Array.isArray(subsValue)) {
      throw new ExperienceReplayInputError(
        'invalid_variable_substitutions',
        'experience_replay: variableSubstitutions must be an object',
      );
    }
    for (const [k, v] of Object.entries(subsValue as Record<string, unknown>)) {
      if (!TABRIX_REPLAY_PLACEHOLDERS.has(k as TabrixReplayPlaceholder)) {
        throw new ExperienceReplayInputError(
          'invalid_substitution_key',
          `experience_replay: variableSubstitutions key '${k}' is not in the v1 whitelist {queryText,targetLabel}`,
        );
      }
      if (typeof v !== 'string') {
        throw new ExperienceReplayInputError(
          'invalid_substitution_value',
          `experience_replay: variableSubstitutions['${k}'] must be a string`,
        );
      }
      if (v.length > MAX_TABRIX_EXPERIENCE_REPLAY_SUBSTITUTION_VALUE_CHARS) {
        throw new ExperienceReplayInputError(
          'invalid_substitution_value',
          `experience_replay: variableSubstitutions['${k}'] exceeds ${MAX_TABRIX_EXPERIENCE_REPLAY_SUBSTITUTION_VALUE_CHARS} chars`,
        );
      }
      variableSubstitutions[k as TabrixReplayPlaceholder] = v;
    }
  }

  // maxSteps
  let maxSteps = MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET;
  if (obj.maxSteps !== undefined) {
    const m = obj.maxSteps;
    if (typeof m !== 'number' || !Number.isFinite(m) || !Number.isInteger(m)) {
      throw new ExperienceReplayInputError(
        'invalid_max_steps',
        'experience_replay: maxSteps must be a finite integer',
      );
    }
    if (m < 1) {
      throw new ExperienceReplayInputError(
        'invalid_max_steps',
        'experience_replay: maxSteps must be >= 1',
      );
    }
    maxSteps = Math.min(m, MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET);
  }

  // targetTabId
  let targetTabId: number | undefined;
  if (obj.targetTabId !== undefined) {
    const t = obj.targetTabId;
    if (typeof t !== 'number' || !Number.isFinite(t) || !Number.isInteger(t) || t < 1) {
      throw new ExperienceReplayInputError(
        'invalid_target_tab_id',
        'experience_replay: targetTabId must be a positive integer',
      );
    }
    targetTabId = t;
  }

  return { actionPathId: idValue, variableSubstitutions, maxSteps, targetTabId };
}

interface ReplayEngineDeps {
  experience: Pick<ExperienceRepository, 'findActionPathById'>;
  dispatch: DispatchBridgedFn;
  recorder: ReplayStepRecorder;
}

interface ReplayEngineExecutionContext {
  input: ParsedExperienceReplayInput;
}

/**
 * Pure-IO replay engine. One instance per call; no caching state is
 * held between calls. Lifecycle:
 *
 *   1. {@link execute} resolves the action path row.
 *   2. Validates row-level invariants (page role, budget,
 *      supported-step-kind, declared template fields). Any failure
 *      is `failed-precondition` and returns immediately — no steps
 *      attempted, no recorder writes.
 *   3. Walks `step_sequence` in order. For each step:
 *      a. Compute `effectiveArgs` by overlaying
 *         `variableSubstitutions[placeholder]` onto `step.args[placeholder]`
 *         for each declared `templateFields[i]`.
 *      b. `recorder.startStep(...)`.
 *      c. `dispatch(toolName, effectiveArgs)`.
 *      d. On success: `recorder.completeStep(...)`, push `ok` outcome.
 *      e. On failure: `recorder.failStep(...)`, push `failed` outcome,
 *         halt loop. (Brief §6: terminal on first per-step failure.)
 */
export class ReplayEngine {
  constructor(private readonly deps: ReplayEngineDeps) {}

  public async execute(input: ParsedExperienceReplayInput): Promise<TabrixExperienceReplayResult> {
    const ctx: ReplayEngineExecutionContext = { input };

    const row = this.deps.experience.findActionPathById(input.actionPathId);
    if (!row) {
      return failedPrecondition(
        'unknown_action_path',
        `actionPathId not found: ${input.actionPathId}`,
      );
    }

    const preconditionCheck = checkRowPreconditions(row, ctx);
    if (preconditionCheck) {
      return preconditionCheck;
    }

    const stepsToRun = row.stepSequence;
    const evidenceRefs: TabrixExperienceReplayStepOutcome[] = [];
    const appliedSubstitutionKeys = new Set<TabrixReplayPlaceholder>();

    for (let i = 0; i < stepsToRun.length; i += 1) {
      const recorded = stepsToRun[i];
      const subResult = applySubstitutions(recorded, input.variableSubstitutions);
      if (subResult.kind === 'precondition_error') {
        // Declared placeholder but the caller did not supply a value
        // (or the recorded args lack the placeholder key). Brief §6
        // classifies this as a `failed-precondition` even though we
        // already started walking the step list — no steps have run
        // through `dispatch` yet, so we report it without opening
        // recorder entries. (`evidenceRefs` is left empty — it
        // describes _attempted_ steps.)
        return failedPrecondition(subResult.failureCode, subResult.message);
      }

      for (const k of subResult.appliedKeys) appliedSubstitutionKeys.add(k);
      const tool = recorded.toolName as SupportedReplayToolName;
      const effectiveArgs = withTargetTab(subResult.args, input.targetTabId);
      const stepIndex = i;
      const stepId = this.deps.recorder.startStep({
        toolName: tool,
        inputSummary: safeStringify(effectiveArgs),
      });

      let result: CallToolResult;
      try {
        result = await this.deps.dispatch(tool, effectiveArgs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.deps.recorder.failStep(stepId, {
          failureCode: 'step_target_not_found',
          errorSummary: message,
        });
        evidenceRefs.push({
          stepIndex,
          toolName: tool,
          status: 'failed',
          historyRef: null,
          failureCode: 'step_target_not_found',
        });
        // Terminal: brief §6 forbids retry / re-locator / re-plan.
        return {
          status: stepIndex === 0 ? 'failed' : 'partial',
          replayId: undefined,
          evidenceRefs,
          resolved: buildResolved(row, appliedSubstitutionKeys),
        };
      }

      if (result.isError) {
        const failureCode = inferStepFailureCode(result);
        this.deps.recorder.failStep(stepId, {
          failureCode,
          errorSummary: extractErrorSummary(result),
        });
        evidenceRefs.push({
          stepIndex,
          toolName: tool,
          status: 'failed',
          historyRef: null,
          failureCode,
        });
        return {
          status: stepIndex === 0 ? 'failed' : 'partial',
          replayId: undefined,
          evidenceRefs,
          resolved: buildResolved(row, appliedSubstitutionKeys),
        };
      }

      const historyRef = extractHistoryRef(result);
      this.deps.recorder.completeStep(stepId, {
        resultSummary: extractResultSummary(result),
        artifactRefs: historyRef ? [historyRef] : undefined,
      });
      evidenceRefs.push({
        stepIndex,
        toolName: tool,
        status: 'ok',
        historyRef,
      });
    }

    return {
      status: 'ok',
      replayId: undefined,
      evidenceRefs,
      resolved: buildResolved(row, appliedSubstitutionKeys),
    };
  }
}

function checkRowPreconditions(
  row: ExperienceActionPathRow,
  ctx: ReplayEngineExecutionContext,
): TabrixExperienceReplayResult | null {
  // GitHub-only page role. Brief §2 item 6.
  if (!TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES.has(row.pageRole)) {
    return failedPrecondition(
      'non_github_pageRole',
      `experience_replay v1 supports GitHub pageRoles only; got '${row.pageRole}'`,
    );
  }

  // Step budget. Brief §3.1 / §6.
  if (row.stepSequence.length > ctx.input.maxSteps) {
    return failedPrecondition(
      'step_budget_exceeded',
      `experience_replay: recorded plan has ${row.stepSequence.length} steps, exceeds maxSteps=${ctx.input.maxSteps}`,
    );
  }
  if (row.stepSequence.length === 0) {
    // An empty plan cannot be replayed — treat as unsupported shape.
    return failedPrecondition(
      'unsupported_step_kind',
      'experience_replay: recorded step_sequence is empty',
    );
  }

  // Supported step kinds only. Brief §2 item 2.
  for (const step of row.stepSequence) {
    if (!TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS.has(step.toolName)) {
      return failedPrecondition(
        'unsupported_step_kind',
        `experience_replay: step toolName '${step.toolName}' is not in v1 supported set {chrome_click_element,chrome_fill_or_select}`,
      );
    }
  }

  return null;
}

interface SubstitutionAppliedOk {
  kind: 'ok';
  args: Record<string, unknown>;
  appliedKeys: TabrixReplayPlaceholder[];
}

interface SubstitutionAppliedError {
  kind: 'precondition_error';
  failureCode: 'template_field_missing' | 'unsupported_step_kind';
  message: string;
}

function applySubstitutions(
  step: ExperienceActionPathStep,
  substitutions: Partial<Record<TabrixReplayPlaceholder, string>>,
): SubstitutionAppliedOk | SubstitutionAppliedError {
  // Defensive guard: chooser-side `isReplayEligible()` already
  // refuses to route rows whose steps lack `args`, so in steady
  // state we should never reach this branch from the chooser.
  // Direct callers of `experience_replay` (operator opt-in path)
  // can still hit it; we fail-closed rather than guessing - brief
  // §2 item 3.
  //
  // V24-01 closeout: the aggregator now populates `args` for the
  // v1 supported step kinds (see
  // `experience-aggregator.ts::extractReplayArgs`). `templateFields`
  // capture-side write path remains deferred to V24-02+, so until
  // then `templates.length === 0` always holds and this engine just
  // re-dispatches the recorded args verbatim.
  if (!step.args) {
    return {
      kind: 'precondition_error',
      // Re-using `unsupported_step_kind` keeps the closed enum tight;
      // semantically the row is "structurally unreplayable".
      failureCode: 'unsupported_step_kind',
      message: `experience_replay: step '${step.toolName}' has no recorded args (row is not replay-eligible)`,
    };
  }

  // Without templateFields → verbatim. Brief §5.
  const templates = step.templateFields ?? [];
  if (templates.length === 0) {
    return { kind: 'ok', args: { ...step.args }, appliedKeys: [] };
  }

  const out: Record<string, unknown> = { ...step.args };
  const applied: TabrixReplayPlaceholder[] = [];
  for (const key of templates) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) {
      return {
        kind: 'precondition_error',
        failureCode: 'template_field_missing',
        message: `experience_replay: step '${step.toolName}' declares templateField '${key}' but recorded args lacks the matching key`,
      };
    }
    const supplied = substitutions[key];
    if (supplied === undefined) {
      return {
        kind: 'precondition_error',
        failureCode: 'template_field_missing',
        message: `experience_replay: step '${step.toolName}' declares templateField '${key}' but variableSubstitutions does not supply it`,
      };
    }
    out[key] = supplied;
    applied.push(key);
  }
  return { kind: 'ok', args: out, appliedKeys: applied };
}

function withTargetTab(
  args: Record<string, unknown>,
  targetTabId: number | undefined,
): Record<string, unknown> {
  if (targetTabId === undefined) return args;
  // Only inject if the underlying tool's args do not already pin a
  // tab — never override the recorder's intent.
  if (Object.prototype.hasOwnProperty.call(args, 'tabId')) return args;
  return { ...args, tabId: targetTabId };
}

function buildResolved(
  row: ExperienceActionPathRow,
  appliedKeys: Set<TabrixReplayPlaceholder>,
): TabrixExperienceReplayResolved {
  return {
    actionPathId: row.actionPathId,
    pageRole: row.pageRole,
    intentSignature: row.intentSignature,
    appliedSubstitutionKeys: Array.from(appliedKeys),
  };
}

function failedPrecondition(
  code: TabrixReplayFailureCode,
  message: string,
): TabrixExperienceReplayResult {
  return {
    status: 'failed-precondition',
    evidenceRefs: [],
    error: { code, message } satisfies TabrixExperienceReplayErrorBody,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserialisable]';
  }
}

function extractFirstTextContent(result: CallToolResult): string | null {
  const first = result.content?.[0];
  if (first && first.type === 'text' && typeof first.text === 'string') {
    return first.text;
  }
  return null;
}

function extractErrorSummary(result: CallToolResult): string {
  const text = extractFirstTextContent(result);
  if (!text) return 'unknown step failure';
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Non-JSON error text — return as-is, capped.
  }
  return text.slice(0, 512);
}

function extractResultSummary(result: CallToolResult): string | undefined {
  const text = extractFirstTextContent(result);
  if (!text) return undefined;
  return text.length <= 512 ? text : `${text.slice(0, 509)}...`;
}

function extractHistoryRef(result: CallToolResult): string | null {
  const text = extractFirstTextContent(result);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { historyRef?: unknown; history_ref?: unknown };
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.historyRef === 'string' && parsed.historyRef.length > 0) {
        return parsed.historyRef;
      }
      if (typeof parsed.history_ref === 'string' && parsed.history_ref.length > 0) {
        return parsed.history_ref;
      }
    }
  } catch {
    // Non-JSON content — no history ref to extract.
  }
  return null;
}

/**
 * Coarse mapping from the bridged tool's failure shape to a
 * {@link TabrixReplayFailureCode}. v1 keeps this conservative: any
 * unknown failure defaults to `step_target_not_found` (the most
 * common cause in production), so the closed enum is honoured.
 *
 * V24-03 will refine this per-tool with the verifier-red /
 * dialog-intercepted / navigation-drift signals once the underlying
 * tools surface them in the response payload.
 */
function inferStepFailureCode(result: CallToolResult): TabrixReplayFailureCode {
  const text = extractFirstTextContent(result);
  if (!text) return 'step_target_not_found';
  try {
    const parsed = JSON.parse(text) as { code?: unknown; failureCode?: unknown };
    const candidate =
      (typeof parsed?.failureCode === 'string' && parsed.failureCode) ||
      (typeof parsed?.code === 'string' && parsed.code) ||
      '';
    const lower = candidate.toLowerCase();
    if (lower.includes('verifier')) return 'step_verifier_red';
    if (lower.includes('dialog')) return 'step_dialog_intercepted';
    if (lower.includes('navigation') || lower.includes('drift')) return 'step_navigation_drift';
    if (lower.includes('substitut')) return 'substitution_invalid';
  } catch {
    // Non-JSON — fall through to the default.
  }
  return 'step_target_not_found';
}

// ---------------------------------------------------------------------------
// MCP handler
// ---------------------------------------------------------------------------

/**
 * Tags the wrapper-owned session as a replay session. The aggregator
 * special-case keys off the `'experience_replay:'` task-intent prefix
 * (brief §7 / plan §"Aggregator special-case"); without this hook the
 * delta would be projected to a brand-new bucket instead of compounded
 * onto the original {@link ExperienceActionPathRow}.
 */
export type UpdateTaskIntentFn = (intent: string) => void;

/**
 * Production deps the wrapper (`register-tools.ts`) injects into the
 * native handler. Optional fields keep existing handler tests
 * (which ignore them) source-compatible.
 *
 * `dispatchBridged`, `recorder`, and `updateTaskIntent` are required
 * at runtime; the handler returns an internal-error envelope if the
 * wrapper failed to inject them (defensive — should be unreachable
 * in practice).
 */
export interface ExperienceReplayHandlerDeps {
  experience: Pick<ExperienceRepository, 'findActionPathById'> | null;
  dispatchBridged?: DispatchBridgedFn;
  recorder?: ReplayStepRecorder;
  updateTaskIntent?: UpdateTaskIntentFn;
  capabilityEnv?: CapabilityEnv;
  /** Memory persistence mode; replay refuses to run when `'off'` (no audit trail possible). */
  persistenceMode?: 'disk' | 'memory' | 'off';
}

/** Brief §7 / aggregator-special-case prefix. Kept here as the single source. */
export const REPLAY_SESSION_TASK_INTENT_PREFIX = 'experience_replay:';
/** Sentinel used when the input is rejected before we resolve a real id. */
export const REPLAY_INVALID_INTENT_TAG = `${REPLAY_SESSION_TASK_INTENT_PREFIX}invalid`;

const REQUIRED_CAPABILITY = CAPABILITY_GATED_TOOLS.get(TOOL_NAMES.EXPERIENCE.REPLAY);

/**
 * MCP handler. The conventional `NativeToolHandler` shape only carries
 * a sessionManager + capabilityEnv; this typed handler is invoked
 * through `invokeReplayHandler` from the wrapper, which threads the
 * extra deps in.
 */
export async function handleExperienceReplay(
  rawArgs: unknown,
  deps: ExperienceReplayHandlerDeps,
): Promise<TabrixExperienceReplayResult> {
  // 1. Capability gate (defense-in-depth — wrapper should already
  //    have short-circuited; if we are reached, return the same
  //    payload shape so behaviour is consistent).
  if (REQUIRED_CAPABILITY && !isCapabilityEnabled(REQUIRED_CAPABILITY, deps.capabilityEnv ?? {})) {
    return {
      status: 'denied',
      evidenceRefs: [],
      error: {
        code: 'capability_off',
        message: `experience_replay capability is not enabled (set TABRIX_POLICY_CAPABILITIES=${REQUIRED_CAPABILITY} or =all)`,
      },
    };
  }

  // 2. Persistence required: replay's audit trail lives in
  //    memory_sessions / memory_steps. With persistence off we
  //    cannot write the per-step rows the brief mandates.
  if (deps.persistenceMode === 'off' || !deps.experience) {
    return {
      status: 'failed-precondition',
      evidenceRefs: [],
      error: {
        code: 'unknown_action_path',
        message: 'experience_replay: Memory persistence is disabled; no action paths available',
      },
    };
  }

  // 3. Parse input.
  let parsed: ParsedExperienceReplayInput;
  try {
    parsed = parseExperienceReplayInput(rawArgs);
  } catch (err) {
    if (err instanceof ExperienceReplayInputError) {
      // Tag the wrapper-owned session as an invalid replay so the
      // aggregator's special-case (brief §7) treats it as a stale id
      // and skips bucketing — instead of seeding a `intent='run mcp
      // tool experience_replay'` row.
      try {
        deps.updateTaskIntent?.(REPLAY_INVALID_INTENT_TAG);
      } catch {
        // Updating intent is best-effort; never let it mask the
        // real `invalid_input` response.
      }
      return {
        status: 'invalid_input',
        evidenceRefs: [],
        error: { code: err.code, message: err.message },
      };
    }
    throw err;
  }

  // 4. Wrapper missing the bridge / recorder → return an unmistakable
  //    structured error (this is a programmer error, not a user one).
  if (!deps.dispatchBridged || !deps.recorder) {
    return {
      status: 'failed-precondition',
      evidenceRefs: [],
      error: {
        code: 'unknown_action_path',
        message:
          'experience_replay: internal wiring is missing (dispatchBridged or recorder not injected)',
      },
    };
  }

  // 5. Tag the wrapper session BEFORE we walk the steps. Even if the
  //    engine returns `failed-precondition` (unknown row, unsupported
  //    step kind, ...), the aggregator's stale-id branch will mark
  //    the session aggregated-without-projecting (plan: "stale id; do
  //    not corrupt other rows"). This is correct: a precondition fail
  //    is still a replay attempt, not a fresh experience to bucket.
  try {
    deps.updateTaskIntent?.(`${REPLAY_SESSION_TASK_INTENT_PREFIX}${parsed.actionPathId}`);
  } catch {
    // Best-effort.
  }

  // 6. Engine.
  const engine = new ReplayEngine({
    experience: deps.experience,
    dispatch: deps.dispatchBridged,
    recorder: deps.recorder,
  });
  return await engine.execute(parsed);
}

/** Wraps a {@link TabrixExperienceReplayResult} as an MCP {@link CallToolResult}. */
export function serializeReplayResult(result: TabrixExperienceReplayResult): CallToolResult {
  // Brief §6: failed / partial / failed-precondition / invalid_input /
  // denied are all logical errors from the caller's perspective. Mark
  // them as `isError: true` so MCP clients handling tool failures see
  // the result as a non-success.
  const isError = result.status !== 'ok';
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    isError,
  };
}

/**
 * Adapter to slot {@link handleExperienceReplay} into the existing
 * {@link NativeToolHandler} contract. The wrapper passes the extra
 * deps in via `(deps as ExperienceReplayHandlerDeps)` after attaching
 * `experience` / `dispatchBridged` / `recorder` / `persistenceMode`.
 */
export const experienceReplayNativeHandler: NativeToolHandler = async (args, deps) => {
  // Reach through to the extended deps shape.
  const ext = deps as unknown as ExperienceReplayHandlerDeps;
  const result = await handleExperienceReplay(args, ext);
  return serializeReplayResult(result);
};
