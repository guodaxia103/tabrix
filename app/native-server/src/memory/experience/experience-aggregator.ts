import { createHash } from 'node:crypto';
import { getTaskWeightsFor, type TabrixTaskWeights } from '@tabrix/shared';
import type { SqliteDatabase } from '../db';
import type { PageSnapshotRepository } from '../db/page-snapshot-repository';
import type { PendingAggregationSession, SessionRepository } from '../db/session-repository';
import type { StepRepository } from '../db/step-repository';
import type { ExperienceActionPathStep } from './experience-repository';
import { ExperienceRepository } from './experience-repository';
import { extractPortableReplayArgs } from '../../mcp/experience-replay-args';
import { SessionCompositeScoreWriter, projectCompositeComponents } from './composite-score';

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
 * Strict bound on captured-args size, in bytes of stringified JSON. The
 * aggregator silently skips populating `args` when a supported step
 * kind's `inputSummary` is unexpectedly large - better to fall back to
 * "row aggregated, just not replay-eligible" than to bloat the on-disk
 * Experience JSON with multi-KB fixtures.
 * 8 KB comfortably covers selector + candidateAction + value for
 * realistic GitHub interactions while bounding worst-case row size.
 */
const MAX_REPLAY_ARGS_INPUT_SUMMARY_BYTES = 8 * 1024;

/**
 * Replay-args portability: for supported step kinds
 * (`chrome_click_element` / `chrome_fill_or_select`) we lift the
 * captured tool args from `memory_steps.input_summary` onto the
 * Experience row so `experience_replay` can re-dispatch them in a fresh
 * session.
 *
 * The earlier closeout used a "parse JSON, strip a denylist of
 * session keys (today: `tabId`)" strategy. Codex's follow-up review
 * called that out as unsound: a denylist that misses any
 * per-snapshot accessibility ref (`ref`, `candidateAction.targetRef`
 * like `ref_xyz`, `candidateAction.locatorChain[*].type === 'ref'`)
 * silently leaks it into replay, which then either clicks the wrong
 * element or hits a dead handle in the new session.
 *
 * Replaced with a per-tool **portable allowlist** (single source of
 * truth: `experience-replay-args.ts::extractPortableReplayArgs`).
 * The chooser's `isReplayEligible()` calls the same helper so the
 * persisted contract and the routing gate cannot drift.
 *
 * Returns `undefined` to mean "row is NOT replay-eligible"; callers
 * MUST omit `args` entirely in that case rather than persisting an
 * empty object.
 */
function extractReplayArgs(
  toolName: string,
  inputSummary: string | undefined,
): Record<string, unknown> | undefined {
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
  // The supported-tool gate, the object-shape gate, and the
  // session-local-key strip all live in `extractPortableReplayArgs` so
  // chooser and aggregator share exactly one allowlist.
  return extractPortableReplayArgs(toolName, parsed);
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
 * These are native/internal MCP tools that read or write Experience /
 * Knowledge themselves. They legitimately emit audit-trail Memory
 * sessions, but if the aggregator turned each call into an
 * `experience_action_paths` row we would seed bogus
 * `(pageRole='unknown', intent='run mcp tool <internal-tool>')`
 * buckets every time an upstream agent invoked them — corrupting the
 * very dataset the chooser/suggester reads from. This is the v2.4.0
 * closeout review finding "Experience self-pollution".
 *
 * Sessions whose entire step list belongs to this set are marked
 * `aggregated_at` (so the pending-aggregation scan does not keep
 * re-encountering them) but skipped from upsert. Mixed sessions —
 * where any step is a real Memory-touching tool — still aggregate
 * normally; the exclusion is per-session, not per-step.
 *
 * Why a hand-maintained allowlist instead of "anything starting with
 * `experience_` / `tabrix_choose_context`": being explicit makes
 * future tool additions a deliberate choice (touch this list in the
 * same PR that adds the tool, document why) rather than an emergent
 * silent skip when someone names a new tool unfortunately. The set
 * mirrors `packages/shared/src/tools.ts` `EXPERIENCE_TOOL_NAMES` and
 * `CHOOSER_TOOL_NAMES`; if a future tool joins those, it must also
 * join this list (or an Experience-pollution test will catch it).
 */
const EXPERIENCE_AGGREGATION_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  // Read-side Experience query tool.
  'experience_suggest_plan',
  // Write-back tool: records replay outcome onto an EXISTING
  // experience_action_paths row. Aggregating its session would create
  // a parallel `(unknown, 'run mcp tool experience_score_step')` row
  // that has no relationship to the real action path being scored.
  'experience_score_step',
  // Chooser entry-point: ranks Experience candidates for the
  // upstream agent. Each invocation is a read of Experience, not a
  // candidate to learn from.
  'tabrix_choose_context',
  // Chooser outcome write-back: records which strategy the
  // caller actually used. Same self-pollution concern as the chooser
  // itself — it touches the chooser telemetry table, not real page
  // actions.
  'tabrix_choose_context_record_outcome',
]);

/**
 * Wrapper-owned sessions opened by `experience_replay` tag their
 * `task.intent` with this prefix followed by the original `actionPathId`
 * they replayed. The aggregator's special-case keys off the prefix to
 * compound the success/failure delta back onto the original
 * `experience_action_paths` row instead of seeding a new bucket.
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
  // Session-end composite score writer. Isolation-aware:
  // a SQLite failure during composite write does NOT prevent
  // `aggregated_at` from being marked (that lock belongs to idempotent
  // aggregation, not to composite-score retry). The writer logs a
  // structured warning row instead.
  private readonly compositeScoreWriter: SessionCompositeScoreWriter;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly sessions: SessionRepository,
    private readonly steps: StepRepository,
    private readonly snapshots: PageSnapshotRepository,
    private readonly experience: ExperienceRepository = new ExperienceRepository(db),
  ) {
    this.compositeScoreWriter = new SessionCompositeScoreWriter({
      repository: this.experience,
    });
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

      // Native/internal Experience- and chooser-facing MCP tools (see
      // `EXPERIENCE_AGGREGATION_EXCLUDED_TOOLS` above) keep their
      // Memory session for audit purposes but must not feed back into
      // Experience itself. Sessions whose ENTIRE step list is in the
      // exclusion set get marked aggregated — both completed AND
      // failed sessions, so a failure of `experience_score_step`
      // doesn't leak in via `failure_count++` either — and skipped
      // from upsert. Mixed sessions (any step is a real tool) still
      // aggregate via the normal path below.
      if (isExcludedFromAggregation(sessionSteps)) {
        this.sessions.markAggregated(session.sessionId, markTime);
        continue;
      }

      // Replay-session special-case. Sessions whose task.intent carries
      // the `experience_replay:` prefix re-run an
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
        const replayLastUsedAt = session.endedAt ?? session.startedAt;
        this.upsertAndMarkTxn({
          actionPathId: replayedActionPathId,
          pageRole: original.pageRole,
          intentSignature: original.intentSignature,
          stepSequence: original.stepSequence,
          successDelta,
          failureDelta,
          lastUsedAt: replayLastUsedAt,
          nowIso: markTime,
          sessionId: session.sessionId,
        });
        // Session-end composite score for the replay
        // session. Written OUTSIDE the upsertAndMarkTxn transaction
        // because failure here MUST NOT roll back `aggregated_at`
        // (per the isolation policy: aggregated_at belongs to
        // idempotent aggregation, not to composite-score retry).
        // The writer swallows SQLite errors and logs a structured
        // warning row instead. Components are projected from session
        // step counts; a richer projection (token-saving, real
        // benchmark elapsed) lands with benchmark wiring.
        const replaySteps = sessionSteps;
        const successSteps = replaySteps.filter((step) => step.status === 'completed').length;
        const failureSteps = replaySteps.length - successSteps;
        const components = projectCompositeComponents({
          successCount: successSteps,
          failureCount: failureSteps,
        });
        const weights: TabrixTaskWeights = getTaskWeightsFor('github', original.pageRole);
        this.compositeScoreWriter.write({
          sessionId: session.sessionId,
          actionPathId: replayedActionPathId,
          components,
          weights,
          lastReplayAt: replayLastUsedAt,
          nowIso: markTime,
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
