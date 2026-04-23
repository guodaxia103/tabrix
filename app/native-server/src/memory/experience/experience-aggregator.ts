import { createHash } from 'node:crypto';
import { TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS } from '@tabrix/shared';
import type { SqliteDatabase } from '../db';
import type { PageSnapshotRepository } from '../db/page-snapshot-repository';
import type { PendingAggregationSession, SessionRepository } from '../db/session-repository';
import type { StepRepository } from '../db/step-repository';
import type { ExperienceActionPathStep } from './experience-repository';
import { ExperienceRepository } from './experience-repository';

export interface ExperienceAggregationResult {
  scanned: number;
  projected: number;
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ');
}

export function normalizeIntentSignature(intent: string): string {
  return collapseSpaces(
    String(intent || '')
      .trim()
      .toLowerCase(),
  );
}

export function buildActionPathId(pageRole: string, intentSignature: string): string {
  const digest = createHash('sha256').update(`${pageRole}\n${intentSignature}`).digest('hex');
  return `action_path_${digest}`;
}

function pickFirstHistoryRef(artifactRefs: string[]): string | null {
  for (const ref of artifactRefs) {
    if (typeof ref === 'string' && ref.trim().length > 0) {
      return ref;
    }
  }
  return null;
}

/**
 * V24-01 closeout (replay closure): which top-level keys in a captured
 * `inputSummary` are session-local and MUST be stripped before we
 * persist them onto an `experience_action_paths` row.
 *
 * - `tabId`: bound to the recorder's browser session. Replaying that
 *   number against a future session would either hit a dead tab or,
 *   worse, the wrong tab. The replay engine's `withTargetTab` injects
 *   the operator-supplied `targetTabId` whenever `args.tabId` is
 *   absent (see `experience-replay.ts::withTargetTab`), so omitting
 *   it here is exactly what the engine expects.
 *
 * Anything else (selector, candidateAction, targetRef, value, ...) is
 * preserved verbatim. `value` may carry user-typed text and is the
 * same data already on disk in `memory_steps.input_summary`; the
 * future capture-side PR (V24-02+) will introduce `templateFields` so
 * the operator can re-parameterise such values at replay time.
 */
const NON_PORTABLE_REPLAY_ARG_KEYS: ReadonlySet<string> = new Set(['tabId']);

/**
 * V24-01 closeout: strict bound on captured-args size, in bytes of
 * stringified JSON. The aggregator silently skips populating `args`
 * when a supported step kind's `inputSummary` is unexpectedly large -
 * better to fall back to "row aggregated, just not replay-eligible"
 * than to bloat the on-disk Experience JSON with multi-KB fixtures.
 * 8 KB comfortably covers selector + candidateAction + value for
 * realistic GitHub interactions while bounding worst-case row size.
 */
const MAX_REPLAY_ARGS_INPUT_SUMMARY_BYTES = 8 * 1024;

/**
 * V24-01 closeout (replay closure): for the v1 supported step kinds
 * (`chrome_click_element` / `chrome_fill_or_select`) we lift the
 * captured tool args from `memory_steps.input_summary` onto the
 * Experience row so `experience_replay` can re-dispatch verbatim.
 *
 * Everything else returns `undefined`, preserving the historical
 * `{toolName, status, historyRef}` shape and matching the
 * fail-closed behaviour `experience-replay.ts::applySubstitutions`
 * relies on for non-replayable rows.
 */
function extractReplayArgs(
  toolName: string,
  inputSummary: string | undefined,
): Record<string, unknown> | undefined {
  if (!TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS.has(toolName)) {
    return undefined;
  }
  if (typeof inputSummary !== 'string' || inputSummary.length === 0) {
    return undefined;
  }
  if (inputSummary.length > MAX_REPLAY_ARGS_INPUT_SUMMARY_BYTES) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputSummary);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (NON_PORTABLE_REPLAY_ARG_KEYS.has(key)) continue;
    out[key] = value;
  }
  // After stripping non-portable keys (e.g. `tabId`) there may be
  // nothing left worth replaying — surface that as "no args" rather
  // than persisting an empty object that the chooser would still
  // refuse via `isReplayEligible()`.
  if (Object.keys(out).length === 0) return undefined;
  return out;
}

function toStepSequence(
  steps: ReturnType<StepRepository['listBySession']>,
): ExperienceActionPathStep[] {
  return steps.map((step) => {
    const out: ExperienceActionPathStep = {
      toolName: step.toolName,
      status: step.status,
      historyRef: pickFirstHistoryRef(step.artifactRefs),
    };
    const args = extractReplayArgs(step.toolName, step.inputSummary);
    if (args) out.args = args;
    return out;
  });
}

/**
 * Tools whose Memory sessions must NOT be projected into Experience.
 *
 * These are read-side native MCP tools that query Experience itself
 * (B-013). They legitimately produce audit-trail Memory sessions, but
 * if the aggregator turned each call into an `experience_action_paths`
 * row we would seed bogus `(pageRole='unknown', intent='run mcp tool
 * experience_suggest_plan')` buckets every time an upstream agent asks
 * for suggestions — corrupting the very dataset the suggestions are
 * read from.
 *
 * Sessions whose entire step list belongs to this set are marked
 * `aggregated_at` (so the pending-aggregation scan does not keep
 * re-encountering them) but skipped from upsert.
 */
const EXPERIENCE_AGGREGATION_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  'experience_suggest_plan',
]);

/**
 * V24-01 (brief §7): wrapper-owned sessions opened by `experience_replay`
 * tag their `task.intent` with this prefix followed by the original
 * `actionPathId` they replayed. The aggregator's special-case keys off
 * the prefix to compound the success/failure delta back onto the
 * original `experience_action_paths` row instead of seeding a new
 * bucket.
 *
 * The sentinel suffix `'invalid'` (`experience_replay:invalid`) is
 * emitted by the handler when input parsing fails before a real id is
 * resolved; the aggregator treats it the same as a stale id (mark
 * aggregated, do not insert).
 */
const REPLAY_SESSION_TASK_INTENT_PREFIX = 'experience_replay:';

function isExcludedFromAggregation(steps: ReturnType<StepRepository['listBySession']>): boolean {
  if (steps.length === 0) return false;
  return steps.every((step) => EXPERIENCE_AGGREGATION_EXCLUDED_TOOLS.has(step.toolName));
}

function toCounterDelta(status: PendingAggregationSession['status']): {
  successDelta: number;
  failureDelta: number;
} {
  if (status === 'completed') {
    return { successDelta: 1, failureDelta: 0 };
  }
  return { successDelta: 0, failureDelta: 1 };
}

export class ExperienceAggregator {
  private readonly upsertAndMarkTxn;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly sessions: SessionRepository,
    private readonly steps: StepRepository,
    private readonly snapshots: PageSnapshotRepository,
    private readonly experience: ExperienceRepository = new ExperienceRepository(db),
  ) {
    this.upsertAndMarkTxn = this.db.transaction(
      (input: {
        actionPathId: string;
        pageRole: string;
        intentSignature: string;
        stepSequence: ExperienceActionPathStep[];
        successDelta: number;
        failureDelta: number;
        lastUsedAt: string;
        nowIso: string;
        sessionId: string;
      }) => {
        this.experience.upsertActionPath({
          actionPathId: input.actionPathId,
          pageRole: input.pageRole,
          intentSignature: input.intentSignature,
          stepSequence: input.stepSequence,
          successDelta: input.successDelta,
          failureDelta: input.failureDelta,
          lastUsedAt: input.lastUsedAt,
          createdAt: input.nowIso,
          updatedAt: input.nowIso,
        });
        const marked = this.sessions.markAggregated(input.sessionId, input.nowIso);
        if (marked !== 1) {
          throw new Error(`session ${input.sessionId} was already aggregated`);
        }
      },
    );
  }

  public projectPendingSessions(nowIso?: string): ExperienceAggregationResult {
    const pending = this.sessions.listPendingAggregationSessions();
    let projected = 0;

    for (const session of pending) {
      const sessionSteps = this.steps.listBySession(session.sessionId);
      const markTime = nowIso ?? new Date().toISOString();

      // B-013 P1 fix: read-side Experience MCP tools (e.g.
      // `experience_suggest_plan`) keep their Memory session for audit
      // purposes but must not feed back into Experience itself. Mark
      // them aggregated so the pending-scan moves on, then continue.
      if (isExcludedFromAggregation(sessionSteps)) {
        this.sessions.markAggregated(session.sessionId, markTime);
        continue;
      }

      // V24-01 (brief §7): replay-session special-case. Sessions whose
      // task.intent carries the `experience_replay:` prefix re-run an
      // existing `experience_action_paths` row; their success/failure
      // delta must compound onto the ORIGINAL row instead of seeding
      // a new `(pageRole=…, intent='replay')` bucket. The original
      // `step_sequence` is preserved verbatim — the replayed steps
      // already live as their own `memory_steps` rows under this
      // session for audit purposes (brief §7 last paragraph), but the
      // canonical `step_sequence` on the row stays the recorder-side
      // truth (otherwise replay would slowly drift the row away from
      // its original shape).
      if (session.taskIntent.startsWith(REPLAY_SESSION_TASK_INTENT_PREFIX)) {
        const replayedActionPathId = session.taskIntent.slice(
          REPLAY_SESSION_TASK_INTENT_PREFIX.length,
        );
        const original = this.experience.findActionPathById(replayedActionPathId);
        // Stale id (row deleted between replay and aggregator pass)
        // OR the sentinel `experience_replay:invalid` written by the
        // handler when input parsing failed: mark aggregated and
        // skip rather than corrupting unrelated rows.
        if (!original) {
          this.sessions.markAggregated(session.sessionId, markTime);
          continue;
        }
        const { successDelta, failureDelta } = toCounterDelta(session.status);
        this.upsertAndMarkTxn({
          actionPathId: replayedActionPathId,
          pageRole: original.pageRole,
          intentSignature: original.intentSignature,
          stepSequence: original.stepSequence,
          successDelta,
          failureDelta,
          lastUsedAt: session.endedAt ?? session.startedAt,
          nowIso: markTime,
          sessionId: session.sessionId,
        });
        projected += 1;
        continue;
      }

      const intentSignature = normalizeIntentSignature(session.taskIntent);
      const pageRole = this.snapshots.findLatestPageRoleForSession(session.sessionId) ?? 'unknown';
      const stepSequence = toStepSequence(sessionSteps);
      const { successDelta, failureDelta } = toCounterDelta(session.status);
      const actionPathId = buildActionPathId(pageRole, intentSignature);
      const sessionLastUsedAt = session.endedAt ?? session.startedAt;

      this.upsertAndMarkTxn({
        actionPathId,
        pageRole,
        intentSignature,
        stepSequence,
        successDelta,
        failureDelta,
        lastUsedAt: sessionLastUsedAt,
        nowIso: markTime,
        sessionId: session.sessionId,
      });
      projected += 1;
    }

    return { scanned: pending.length, projected };
  }
}
