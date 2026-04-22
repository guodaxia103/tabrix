import { createHash } from 'node:crypto';
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

function toStepSequence(
  steps: ReturnType<StepRepository['listBySession']>,
): ExperienceActionPathStep[] {
  return steps.map((step) => ({
    toolName: step.toolName,
    status: step.status,
    historyRef: pickFirstHistoryRef(step.artifactRefs),
  }));
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
