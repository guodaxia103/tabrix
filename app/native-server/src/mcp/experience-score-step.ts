/**
 * Tabrix MKEP Experience write-back layer (V24-02) — `experience_score_step`
 * native MCP handler.
 *
 * SoT: `.claude/TABRIX_V2_4_0_PLAN.md` §V24-02.
 *
 * Module shape mirrors {@link ../mcp/experience-replay} so the
 * write/execute (V24-01) and write-back (V24-02) sides of the
 * Experience pipeline read the same way:
 *
 *   - `parseExperienceScoreStepInput` — strict input parser, returns a
 *     normalized {@link ParsedExperienceScoreStepInput} or throws
 *     {@link ExperienceScoreStepInputError} (mapped to
 *     `status: 'invalid_input'`).
 *   - `handleExperienceScoreStep` — MCP {@link NativeToolHandler}.
 *     Wraps capability gate + persistence gate + parsing + write-back
 *     dispatch.
 *
 * Failure mode is "isolation + structured warning" per the
 * V24-02 policy: SQLite write-back exceptions never propagate out of
 * the handler — they are absorbed into a row in
 * `experience_writeback_warnings` and the call returns
 * `status: 'isolated'`. The replay user path (V24-01) MUST never be
 * stalled by a write-back I/O failure.
 *
 * Capability gating: this tool re-uses the `experience_replay`
 * capability key (registered as such in
 * `@tabrix/shared::CAPABILITY_GATED_TOOLS`). The plan §1.1 mandates
 * one capability for the whole replay/score-step write-back family.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CAPABILITY_GATED_TOOLS,
  CLICK_OBSERVED_OUTCOMES,
  MAX_TABRIX_EXPERIENCE_SCORE_STEP_EVIDENCE_CODE_CHARS,
  MAX_TABRIX_EXPERIENCE_SCORE_STEP_EVIDENCE_MESSAGE_CHARS,
  MAX_TABRIX_EXPERIENCE_SCORE_STEP_PATH_ID_CHARS,
  MAX_TABRIX_EXPERIENCE_SCORE_STEP_REF_CHARS,
  MAX_TABRIX_EXPERIENCE_SCORE_STEP_STEP_INDEX,
  TABRIX_EXPERIENCE_SCORE_STEP_ACTION_PATH_ID_PATTERN,
  TOOL_NAMES,
  isClickSuccessOutcome,
  type ClickObservedOutcome,
  type TabrixExperienceScoreStepErrorBody,
  type TabrixExperienceScoreStepInvalidInputCode,
  type TabrixExperienceScoreStepResult,
} from '@tabrix/shared';
import type {
  ExperienceRepository,
  RecordReplayStepOutcomeInput,
} from '../memory/experience/experience-repository';
import { isCapabilityEnabled, type CapabilityEnv } from '../policy/capabilities';
import type { NativeToolHandler } from './native-tool-handlers';

// ---------------------------------------------------------------------------
// Defensive constants
// ---------------------------------------------------------------------------

/**
 * `CLICK_OBSERVED_OUTCOMES` is exported from `@tabrix/shared` as a
 * readonly tuple (see `click.ts`); we rebuild a `Set` for O(1)
 * membership at the parser hot path. (Set construction once at module
 * load; the tuple is small so the trade-off is intentionally trivial.)
 */
const CLICK_OBSERVED_OUTCOMES_SET = new Set<ClickObservedOutcome>(CLICK_OBSERVED_OUTCOMES);

/** Brief §V24-02 §parser. Stable parser-error codes. */
export class ExperienceScoreStepInputError extends Error {
  constructor(
    public readonly code: TabrixExperienceScoreStepInvalidInputCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExperienceScoreStepInputError';
  }
}

/**
 * Parsed-and-normalized input the handler consumes. `evidence` is
 * collapsed to plain optional strings so the persistence layer does
 * not need a second normalisation pass.
 */
export interface ParsedExperienceScoreStepInput {
  actionPathId: string;
  stepIndex: number;
  observedOutcome: ClickObservedOutcome;
  historyRef?: string;
  replayId?: string;
  evidenceCode?: string;
  evidenceMessage?: string;
}

/**
 * Strict input parser. Mirrors `parseExperienceReplayInput`'s shape:
 * every branch maps to a stable
 * {@link TabrixExperienceScoreStepInvalidInputCode}.
 */
export function parseExperienceScoreStepInput(raw: unknown): ParsedExperienceScoreStepInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExperienceScoreStepInputError(
      'invalid_input',
      'experience_score_step expects an object input',
    );
  }
  const inputObject = raw as Record<string, unknown>;

  // actionPathId
  const idValue = inputObject.actionPathId;
  if (idValue === undefined || idValue === null || idValue === '') {
    throw new ExperienceScoreStepInputError(
      'missing_action_path_id',
      'experience_score_step: actionPathId is required',
    );
  }
  if (typeof idValue !== 'string') {
    throw new ExperienceScoreStepInputError(
      'invalid_action_path_id',
      'experience_score_step: actionPathId must be a string',
    );
  }
  if (idValue.length > MAX_TABRIX_EXPERIENCE_SCORE_STEP_PATH_ID_CHARS) {
    throw new ExperienceScoreStepInputError(
      'invalid_action_path_id',
      `experience_score_step: actionPathId exceeds ${MAX_TABRIX_EXPERIENCE_SCORE_STEP_PATH_ID_CHARS} chars`,
    );
  }
  if (!TABRIX_EXPERIENCE_SCORE_STEP_ACTION_PATH_ID_PATTERN.test(idValue)) {
    throw new ExperienceScoreStepInputError(
      'invalid_action_path_id',
      'experience_score_step: actionPathId must match ^action_path_[0-9a-f]{64}$',
    );
  }

  // stepIndex
  if (inputObject.stepIndex === undefined || inputObject.stepIndex === null) {
    throw new ExperienceScoreStepInputError(
      'missing_step_index',
      'experience_score_step: stepIndex is required',
    );
  }
  const stepIndexRaw = inputObject.stepIndex;
  if (
    typeof stepIndexRaw !== 'number' ||
    !Number.isFinite(stepIndexRaw) ||
    !Number.isInteger(stepIndexRaw)
  ) {
    throw new ExperienceScoreStepInputError(
      'invalid_step_index',
      'experience_score_step: stepIndex must be a finite integer',
    );
  }
  if (stepIndexRaw < 0 || stepIndexRaw > MAX_TABRIX_EXPERIENCE_SCORE_STEP_STEP_INDEX) {
    throw new ExperienceScoreStepInputError(
      'invalid_step_index',
      `experience_score_step: stepIndex must be in [0, ${MAX_TABRIX_EXPERIENCE_SCORE_STEP_STEP_INDEX}]`,
    );
  }

  // observedOutcome
  if (inputObject.observedOutcome === undefined || inputObject.observedOutcome === null) {
    throw new ExperienceScoreStepInputError(
      'missing_observed_outcome',
      'experience_score_step: observedOutcome is required',
    );
  }
  if (typeof inputObject.observedOutcome !== 'string') {
    throw new ExperienceScoreStepInputError(
      'invalid_observed_outcome',
      'experience_score_step: observedOutcome must be a string',
    );
  }
  if (!CLICK_OBSERVED_OUTCOMES_SET.has(inputObject.observedOutcome as ClickObservedOutcome)) {
    throw new ExperienceScoreStepInputError(
      'invalid_observed_outcome',
      `experience_score_step: observedOutcome '${inputObject.observedOutcome}' is not in the ClickObservedOutcome enum`,
    );
  }
  const observedOutcome = inputObject.observedOutcome as ClickObservedOutcome;

  // historyRef (optional)
  let historyRef: string | undefined;
  if (
    inputObject.historyRef !== undefined &&
    inputObject.historyRef !== null &&
    inputObject.historyRef !== ''
  ) {
    if (typeof inputObject.historyRef !== 'string') {
      throw new ExperienceScoreStepInputError(
        'invalid_history_ref',
        'experience_score_step: historyRef must be a string',
      );
    }
    if (inputObject.historyRef.length > MAX_TABRIX_EXPERIENCE_SCORE_STEP_REF_CHARS) {
      throw new ExperienceScoreStepInputError(
        'invalid_history_ref',
        `experience_score_step: historyRef exceeds ${MAX_TABRIX_EXPERIENCE_SCORE_STEP_REF_CHARS} chars`,
      );
    }
    historyRef = inputObject.historyRef;
  }

  // replayId (optional)
  let replayId: string | undefined;
  if (
    inputObject.replayId !== undefined &&
    inputObject.replayId !== null &&
    inputObject.replayId !== ''
  ) {
    if (typeof inputObject.replayId !== 'string') {
      throw new ExperienceScoreStepInputError(
        'invalid_replay_id',
        'experience_score_step: replayId must be a string',
      );
    }
    if (inputObject.replayId.length > MAX_TABRIX_EXPERIENCE_SCORE_STEP_REF_CHARS) {
      throw new ExperienceScoreStepInputError(
        'invalid_replay_id',
        `experience_score_step: replayId exceeds ${MAX_TABRIX_EXPERIENCE_SCORE_STEP_REF_CHARS} chars`,
      );
    }
    replayId = inputObject.replayId;
  }

  // evidence (optional)
  let evidenceCode: string | undefined;
  let evidenceMessage: string | undefined;
  if (inputObject.evidence !== undefined && inputObject.evidence !== null) {
    if (typeof inputObject.evidence !== 'object' || Array.isArray(inputObject.evidence)) {
      throw new ExperienceScoreStepInputError(
        'invalid_evidence',
        'experience_score_step: evidence must be an object',
      );
    }
    const ev = inputObject.evidence as Record<string, unknown>;
    if (ev.code !== undefined && ev.code !== null && ev.code !== '') {
      if (typeof ev.code !== 'string') {
        throw new ExperienceScoreStepInputError(
          'invalid_evidence',
          'experience_score_step: evidence.code must be a string',
        );
      }
      if (ev.code.length > MAX_TABRIX_EXPERIENCE_SCORE_STEP_EVIDENCE_CODE_CHARS) {
        throw new ExperienceScoreStepInputError(
          'invalid_evidence',
          `experience_score_step: evidence.code exceeds ${MAX_TABRIX_EXPERIENCE_SCORE_STEP_EVIDENCE_CODE_CHARS} chars`,
        );
      }
      evidenceCode = ev.code;
    }
    if (ev.message !== undefined && ev.message !== null && ev.message !== '') {
      if (typeof ev.message !== 'string') {
        throw new ExperienceScoreStepInputError(
          'invalid_evidence',
          'experience_score_step: evidence.message must be a string',
        );
      }
      if (ev.message.length > MAX_TABRIX_EXPERIENCE_SCORE_STEP_EVIDENCE_MESSAGE_CHARS) {
        throw new ExperienceScoreStepInputError(
          'invalid_evidence',
          `experience_score_step: evidence.message exceeds ${MAX_TABRIX_EXPERIENCE_SCORE_STEP_EVIDENCE_MESSAGE_CHARS} chars`,
        );
      }
      evidenceMessage = ev.message;
    }
  }

  return {
    actionPathId: idValue,
    stepIndex: stepIndexRaw,
    observedOutcome,
    historyRef,
    replayId,
    evidenceCode,
    evidenceMessage,
  };
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

/**
 * Production deps the wrapper (`register-tools.ts`) injects into the
 * native handler. Optional fields keep existing handler tests
 * source-compatible.
 *
 * `experience` is required at runtime; the handler returns
 * `status: 'invalid_input'` with code `'invalid_input'` if the
 * wrapper failed to inject it (defensive — should be unreachable in
 * practice).
 *
 * `now` is injectable so tests can pin a deterministic timestamp.
 * Production passes `() => new Date().toISOString()`.
 */
export interface ExperienceScoreStepHandlerDeps {
  experience: Pick<
    ExperienceRepository,
    'recordReplayStepOutcome' | 'recordWritebackWarning'
  > | null;
  capabilityEnv?: CapabilityEnv;
  /** Memory persistence mode; the tool refuses to run when `'off'` (no row to update). */
  persistenceMode?: 'disk' | 'memory' | 'off';
  /** Test seam for deterministic timestamps. */
  now?: () => string;
}

const REQUIRED_CAPABILITY = CAPABILITY_GATED_TOOLS.get(TOOL_NAMES.EXPERIENCE.SCORE_STEP);

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Build a stable warning id without bringing in `node:crypto`. The
 * surrounding `experience_writeback_warnings` row is append-only and
 * indexed by (created_at, warning_id); collision risk is bounded by
 * the entropy of `Math.random` + ms timestamp, which is sufficient
 * for an isolation marker (NOT a security artefact).
 */
function newWarningId(): string {
  return `warn_score_step_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// MCP handler
// ---------------------------------------------------------------------------

/**
 * Pure-result handler. The native wrapper serialises the result into
 * a {@link CallToolResult} via {@link serializeScoreStepResult}.
 */
export async function handleExperienceScoreStep(
  rawArgs: unknown,
  deps: ExperienceScoreStepHandlerDeps,
): Promise<TabrixExperienceScoreStepResult> {
  // 1. Capability gate (defense-in-depth — the wrapper should already
  //    have short-circuited; if we are reached, return the same
  //    payload shape so behaviour is consistent with experience_replay).
  if (REQUIRED_CAPABILITY && !isCapabilityEnabled(REQUIRED_CAPABILITY, deps.capabilityEnv ?? {})) {
    return {
      status: 'denied',
      error: {
        code: 'capability_off',
        message: `experience_score_step capability is not enabled (set TABRIX_POLICY_CAPABILITIES=${REQUIRED_CAPABILITY} or =all)`,
      } satisfies TabrixExperienceScoreStepErrorBody,
    };
  }

  // 2. Persistence required: the tool's whole purpose is to UPDATE
  //    `experience_action_paths`. With persistence off there is no
  //    row to touch, so we refuse with a clear message rather than
  //    silently no-oping.
  if (deps.persistenceMode === 'off' || !deps.experience) {
    return {
      status: 'invalid_input',
      error: {
        code: 'invalid_input',
        message: 'experience_score_step: Memory persistence is disabled; nothing to write',
      },
    };
  }

  // 3. Parse input.
  let parsed: ParsedExperienceScoreStepInput;
  try {
    parsed = parseExperienceScoreStepInput(rawArgs);
  } catch (err) {
    if (err instanceof ExperienceScoreStepInputError) {
      return {
        status: 'invalid_input',
        error: { code: err.code, message: err.message },
      };
    }
    throw err;
  }

  // 4. Dispatch the write-back, isolating SQLite I/O failures into a
  //    structured warning row. The aggregator counter delta is
  //    decided inside `recordReplayStepOutcome` (single source of
  //    truth for the `ClickObservedOutcome → success/failure` rule).
  const nowIso = (deps.now ?? defaultNow)();
  const writeInput: RecordReplayStepOutcomeInput = {
    actionPathId: parsed.actionPathId,
    stepIndex: parsed.stepIndex,
    observedOutcome: parsed.observedOutcome,
    nowIso,
  };
  try {
    const result = deps.experience.recordReplayStepOutcome(writeInput);
    if (result.status === 'no_match') {
      return {
        status: 'no_match',
        actionPathId: parsed.actionPathId,
        stepIndex: parsed.stepIndex,
        observedOutcome: parsed.observedOutcome,
      };
    }
    return {
      status: 'ok',
      actionPathId: parsed.actionPathId,
      stepIndex: parsed.stepIndex,
      observedOutcome: parsed.observedOutcome,
      lastReplayAt: nowIso,
      lastReplayStatus: result.lastReplayStatus,
      delta: { successDelta: result.successDelta, failureDelta: result.failureDelta },
    };
  } catch (err) {
    // Isolation rule: never propagate. Build a structured warning
    // row and return `'isolated'` so the caller (replay engine /
    // upstream agent) can keep moving. We swallow the inner
    // `recordWritebackWarning` failure too — at that point even the
    // warning row could not land, but throwing would defeat the
    // whole purpose of the isolation contract.
    const warningId = newWarningId();
    const message = err instanceof Error ? err.message : String(err);
    const status = isClickSuccessOutcome(parsed.observedOutcome) ? 'ok' : 'failed';
    try {
      deps.experience.recordWritebackWarning({
        warningId,
        source: 'experience_score_step',
        actionPathId: parsed.actionPathId,
        stepIndex: parsed.stepIndex,
        sessionId: null,
        replayId: parsed.replayId ?? null,
        observedOutcome: parsed.observedOutcome,
        errorCode: 'score_step_write_failed',
        errorMessage: message.slice(0, 512),
        payloadBlob: JSON.stringify({
          historyRef: parsed.historyRef ?? null,
          evidenceCode: parsed.evidenceCode ?? null,
          evidenceMessage: parsed.evidenceMessage ?? null,
        }),
        createdAt: nowIso,
      });
    } catch {
      // Even the warning row failed to land. Stay silent — the only
      // recovery path is the operator-side telemetry the warning sink
      // (production wires up a logger) hooks. The replay user path
      // MUST keep moving.
    }
    return {
      status: 'isolated',
      actionPathId: parsed.actionPathId,
      stepIndex: parsed.stepIndex,
      observedOutcome: parsed.observedOutcome,
      lastReplayAt: nowIso,
      lastReplayStatus: status,
      warningId,
      error: {
        code: 'score_step_write_failed',
        message: message.slice(0, 512),
      },
    };
  }
}

/** Wraps a {@link TabrixExperienceScoreStepResult} as an MCP {@link CallToolResult}. */
export function serializeScoreStepResult(result: TabrixExperienceScoreStepResult): CallToolResult {
  // `'isolated'` is intentionally a NON-error from the protocol's
  // perspective: the call's contract is "write-back attempt
  // completed, isolation row written when needed". Only hard caller
  // errors (`invalid_input`, `denied`) flip `isError`.
  const isError = result.status === 'invalid_input' || result.status === 'denied';
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    isError,
  };
}

/**
 * Adapter to slot {@link handleExperienceScoreStep} into the existing
 * {@link NativeToolHandler} contract. The wrapper passes the extra
 * deps in via `(deps as ExperienceScoreStepHandlerDeps)` after
 * attaching `experience` / `persistenceMode`.
 */
export const experienceScoreStepNativeHandler: NativeToolHandler = async (args, deps) => {
  const ext = deps as unknown as ExperienceScoreStepHandlerDeps;
  const result = await handleExperienceScoreStep(args, ext);
  return serializeScoreStepResult(result);
};
