import type { SqliteDatabase } from '../db';
import type {
  ClickObservedOutcome,
  TabrixExperienceScoreStepStatus,
  TabrixReplayPlaceholder,
} from '@tabrix/shared';
import { isClickSuccessOutcome } from '@tabrix/shared';

export interface ExperienceActionPathStep {
  toolName: string;
  status: string;
  historyRef: string | null;
  /**
   * Captured tool-call args lifted from
   * `memory_steps.input_summary` for the v1 replay-supported step
   * kinds (`chrome_click_element` / `chrome_fill_or_select`).
   *
   * Population is performed by the aggregator
   * (`experience-aggregator.ts::extractReplayArgs`) and is gated by
   * the per-tool **portable allowlist** in
   * `mcp/experience-replay-args.ts::extractPortableReplayArgs`:
   * - only the v1 supported step kinds get args populated; every
   *   other step kind keeps the historical `{toolName,status,historyRef}`
   *   shape and the chooser refuses to route the row to
   *   `experience_replay` (`isReplayEligible()`),
   * - session-local handles are dropped: top-level `tabId` /
   *   `windowId` / `frameId` (the replay engine's `withTargetTab`
   *   re-injects the operator-supplied `targetTabId`), top-level
   *   `ref` and viewport `coordinates` (per-snapshot, not
   *   replayable across sessions),
   * - `candidateAction.targetRef` is kept ONLY when it carries the
   *   `tgt_*` stable-target-ref prefix (`STABLE_TARGET_REF_PREFIX`);
   *   legacy per-snapshot `ref_xyz` values are dropped,
   * - `candidateAction.locatorChain` keeps only `type === 'css'`
   *   entries; `type === 'ref'` items are dropped for the same
   *   reason, and
   * - extremely large captures are skipped to bound on-disk JSON.
   *
   * When absent the chooser refuses to route the row in the first
   * place (`isReplayEligible()` returns false); as defense in depth
   * the replay engine itself also fails the step closed
   * (`applySubstitutions()` returns `failureCode:
   * 'unsupported_step_kind'` with message "row is not
   * replay-eligible") so a direct caller of `experience_replay`
   * cannot bypass the gate either.
   */
  args?: Record<string, unknown>;
  /**
   * Forward-compatible {@link TabrixReplayPlaceholder} keys
   * the upstream caller is allowed to substitute into this step's
   * `args` at replay time. Brief §5 / §10 item 5.
   *
   * - Empty or absent → the step is non-templatable; replay uses
   *   captured `args` verbatim.
   * - Each placeholder key MUST be present as a top-level key in
   *   `args` (the engine substitutes `args[key]` from
   *   `variableSubstitutions[key]`); a declared placeholder without
   *   a matching `args` key OR a missing `variableSubstitutions[key]`
   *   is `failed-precondition / template_field_missing`.
   */
  templateFields?: TabrixReplayPlaceholder[];
}

export interface ExperienceActionPathRow {
  actionPathId: string;
  pageRole: string;
  intentSignature: string;
  stepSequence: ExperienceActionPathStep[];
  successCount: number;
  failureCount: number;
  lastUsedAt?: string;
  /** Last replay write-back timestamp. */
  lastReplayAt?: string;
  /** Last `ClickObservedOutcome` recorded against this row. */
  lastReplayOutcome?: ClickObservedOutcome;
  /** Projected status (success vs failure) for the last replay. */
  lastReplayStatus?: TabrixExperienceScoreStepStatus;
  /** Recency-decayed composite score (chooser ranking input). */
  compositeScoreDecayed?: number;
  createdAt: string;
  updatedAt: string;
}

interface ExperienceActionPathDbRow {
  action_path_id: string;
  page_role: string;
  intent_signature: string;
  step_sequence: string;
  success_count: number;
  failure_count: number;
  last_used_at: string | null;
  last_replay_at: string | null;
  last_replay_outcome: string | null;
  last_replay_status: string | null;
  composite_score_decayed: number | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertActionPathInput {
  actionPathId: string;
  pageRole: string;
  intentSignature: string;
  stepSequence: ExperienceActionPathStep[];
  successDelta: number;
  failureDelta: number;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
}

function parseStepSequence(raw: string): ExperienceActionPathStep[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const stepRecord = item as {
          toolName?: unknown;
          status?: unknown;
          historyRef?: unknown;
          args?: unknown;
          templateFields?: unknown;
        };
        const out: ExperienceActionPathStep = {
          toolName: String(stepRecord.toolName ?? ''),
          status: String(stepRecord.status ?? ''),
          historyRef:
            typeof stepRecord.historyRef === 'string' && stepRecord.historyRef.length > 0
              ? stepRecord.historyRef
              : null,
        };
        // Forward-compatible preservation of `args` / `templateFields`
        // when an existing row already carries them. Today the
        // aggregator does NOT write them; this read-side branch only
        // matters once a future capture-side PR starts populating them.
        if (
          stepRecord.args &&
          typeof stepRecord.args === 'object' &&
          !Array.isArray(stepRecord.args)
        ) {
          out.args = stepRecord.args as Record<string, unknown>;
        }
        if (Array.isArray(stepRecord.templateFields)) {
          const seen: TabrixReplayPlaceholder[] = [];
          for (const k of stepRecord.templateFields) {
            if (k === 'queryText' || k === 'targetLabel') {
              if (!seen.includes(k)) seen.push(k);
            }
          }
          if (seen.length > 0) out.templateFields = seen;
        }
        return out;
      });
  } catch {
    return [];
  }
}

export interface SuggestActionPathsInput {
  intentSignature: string;
  pageRole?: string;
  limit: number;
}

/**
 * Per-step replay outcome write-back input. Counter delta
 * is derived from {@link ClickObservedOutcome} via
 * `isClickSuccessOutcome`; the caller does NOT pre-compute it so
 * the projection rule lives in exactly one place.
 */
export interface RecordReplayStepOutcomeInput {
  actionPathId: string;
  stepIndex: number;
  observedOutcome: ClickObservedOutcome;
  /** ISO 8601 — used for `last_replay_at` AND `updated_at`. */
  nowIso: string;
}

export interface RecordReplayStepOutcomeResult {
  status: 'ok' | 'no_match';
  successDelta: number;
  failureDelta: number;
  lastReplayStatus: TabrixExperienceScoreStepStatus;
}

/** Composite-score writers. Pure data, no business logic. */
export interface UpdateActionPathCompositeScoreInput {
  actionPathId: string;
  compositeScoreDecayed: number;
  nowIso: string;
}

export interface UpdateMemorySessionCompositeScoreInput {
  sessionId: string;
  compositeScoreRaw: number;
  components: Record<string, number>;
}

/** Isolation-warning writer (append-only). */
export interface RecordWritebackWarningInput {
  warningId: string;
  source: 'experience_score_step' | 'session_composite_score';
  actionPathId: string | null;
  stepIndex: number | null;
  sessionId: string | null;
  replayId: string | null;
  observedOutcome: string | null;
  errorCode: string;
  errorMessage: string;
  payloadBlob: string | null;
  createdAt: string;
}

export class ExperienceRepository {
  private readonly upsertStmt;
  private readonly listStmt;
  private readonly findByIdStmt;
  private readonly suggestStmt;
  private readonly suggestForRoleStmt;
  private readonly clearStmt;
  // Write-back prepared statements. Each is single-purpose; isolation is
  // intentional so a future refactor can re-target one without
  // touching the legacy aggregator path.
  private readonly recordReplayStepOutcomeStmt;
  private readonly updateActionPathCompositeStmt;
  private readonly updateMemorySessionCompositeStmt;
  private readonly insertWritebackWarningStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.upsertStmt = db.prepare(
      `INSERT INTO experience_action_paths
        (action_path_id, page_role, intent_signature, step_sequence, success_count, failure_count, last_used_at, created_at, updated_at)
       VALUES
        (@action_path_id, @page_role, @intent_signature, @step_sequence, @success_count, @failure_count, @last_used_at, @created_at, @updated_at)
       ON CONFLICT(action_path_id) DO UPDATE SET
         page_role = excluded.page_role,
         intent_signature = excluded.intent_signature,
         success_count = experience_action_paths.success_count + excluded.success_count,
         failure_count = experience_action_paths.failure_count + excluded.failure_count,
         step_sequence = CASE
           WHEN experience_action_paths.last_used_at IS NULL THEN excluded.step_sequence
           WHEN excluded.last_used_at IS NULL THEN experience_action_paths.step_sequence
           WHEN excluded.last_used_at >= experience_action_paths.last_used_at THEN excluded.step_sequence
           ELSE experience_action_paths.step_sequence
         END,
         last_used_at = CASE
           WHEN experience_action_paths.last_used_at IS NULL THEN excluded.last_used_at
           WHEN excluded.last_used_at IS NULL THEN experience_action_paths.last_used_at
           WHEN excluded.last_used_at >= experience_action_paths.last_used_at THEN excluded.last_used_at
           ELSE experience_action_paths.last_used_at
         END,
         updated_at = CASE
           WHEN experience_action_paths.last_used_at IS NULL THEN excluded.updated_at
           WHEN excluded.last_used_at IS NULL THEN experience_action_paths.updated_at
           WHEN excluded.last_used_at >= experience_action_paths.last_used_at THEN excluded.updated_at
           ELSE experience_action_paths.updated_at
         END`,
    );
    this.listStmt = db.prepare(
      `SELECT action_path_id,
              page_role,
              intent_signature,
              step_sequence,
              success_count,
              failure_count,
              last_used_at,
              last_replay_at,
              last_replay_outcome,
              last_replay_status,
              composite_score_decayed,
              created_at,
              updated_at
         FROM experience_action_paths
        ORDER BY page_role ASC, intent_signature ASC`,
    );
    // Targeted point-lookup used by:
    //   1. The aggregator's replay-session special-case
    //      (`experience-aggregator.ts`) — projects success/failure
    //      deltas back to the ORIGINAL action-path row instead of
    //      creating a new bucket keyed by the synthesised
    //      `experience_replay:` task intent.
    //   2. The `experience_replay` MCP handler — locates the row to
    //      replay before opening the Memory session.
    // SoT: `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` §7.
    this.findByIdStmt = db.prepare(
      `SELECT action_path_id,
              page_role,
              intent_signature,
              step_sequence,
              success_count,
              failure_count,
              last_used_at,
              last_replay_at,
              last_replay_outcome,
              last_replay_status,
              composite_score_decayed,
              created_at,
              updated_at
         FROM experience_action_paths
        WHERE action_path_id = ?`,
    );
    // Read-only lookup for `experience_suggest_plan`.
    //
    // Sort key invariants:
    //   1. `success_count DESC` — pick the candidate with the most past wins first.
    //   2. `(failure_count - success_count) ASC` — among ties, prefer paths whose
    //      net-success-margin is highest (i.e. fewer failures relative to wins).
    //   3. `last_used_at DESC NULLS LAST` — fresher paths break further ties.
    //   4. `intent_signature ASC, action_path_id ASC` — fully deterministic order
    //      so unit tests do not rely on SQLite's row-storage order.
    //
    // Two prepared statements: with and without a `page_role` filter. `?` bind
    // params are positional so callers cannot accidentally inject a `pageRole`
    // when none was requested.
    this.suggestStmt = db.prepare(
      `SELECT action_path_id,
              page_role,
              intent_signature,
              step_sequence,
              success_count,
              failure_count,
              last_used_at,
              last_replay_at,
              last_replay_outcome,
              last_replay_status,
              composite_score_decayed,
              created_at,
              updated_at
         FROM experience_action_paths
        WHERE intent_signature = ?
        ORDER BY success_count DESC,
                 (failure_count - success_count) ASC,
                 (last_used_at IS NULL) ASC,
                 last_used_at DESC,
                 intent_signature ASC,
                 action_path_id ASC
        LIMIT ?`,
    );
    this.suggestForRoleStmt = db.prepare(
      `SELECT action_path_id,
              page_role,
              intent_signature,
              step_sequence,
              success_count,
              failure_count,
              last_used_at,
              last_replay_at,
              last_replay_outcome,
              last_replay_status,
              composite_score_decayed,
              created_at,
              updated_at
         FROM experience_action_paths
        WHERE intent_signature = ?
          AND page_role = ?
        ORDER BY success_count DESC,
                 (failure_count - success_count) ASC,
                 (last_used_at IS NULL) ASC,
                 last_used_at DESC,
                 intent_signature ASC,
                 action_path_id ASC
        LIMIT ?`,
    );
    this.clearStmt = db.prepare('DELETE FROM experience_action_paths');

    // Replay outcome write-back. UPDATE-only so the row
    // must exist (caller distinguishes `'no_match'` via `changes`).
    // Counter delta is decided by the caller (`isClickSuccessOutcome`
    // projection) and applied in a single UPDATE so the read-side
    // never observes a partial update.
    this.recordReplayStepOutcomeStmt = db.prepare(
      `UPDATE experience_action_paths
          SET success_count       = success_count + @success_delta,
              failure_count       = failure_count + @failure_delta,
              last_replay_at      = @last_replay_at,
              last_replay_outcome = @observed_outcome,
              last_replay_status  = @last_replay_status,
              last_used_at        = CASE
                WHEN last_used_at IS NULL THEN @last_replay_at
                WHEN @last_replay_at >= last_used_at THEN @last_replay_at
                ELSE last_used_at
              END,
              updated_at          = @last_replay_at
        WHERE action_path_id = @action_path_id`,
    );
    this.updateActionPathCompositeStmt = db.prepare(
      `UPDATE experience_action_paths
          SET composite_score_decayed = @composite_score_decayed,
              updated_at              = @now_iso
        WHERE action_path_id = @action_path_id`,
    );
    this.updateMemorySessionCompositeStmt = db.prepare(
      `UPDATE memory_sessions
          SET composite_score_raw = @composite_score_raw,
              components_blob     = @components_blob
        WHERE session_id = @session_id`,
    );
    this.insertWritebackWarningStmt = db.prepare(
      `INSERT INTO experience_writeback_warnings
        (warning_id, source, action_path_id, step_index, session_id, replay_id,
         observed_outcome, error_code, error_message, payload_blob, created_at)
       VALUES
        (@warning_id, @source, @action_path_id, @step_index, @session_id, @replay_id,
         @observed_outcome, @error_code, @error_message, @payload_blob, @created_at)`,
    );
  }

  public upsertActionPath(input: UpsertActionPathInput): void {
    this.upsertStmt.run({
      action_path_id: input.actionPathId,
      page_role: input.pageRole,
      intent_signature: input.intentSignature,
      step_sequence: JSON.stringify(input.stepSequence),
      success_count: input.successDelta,
      failure_count: input.failureDelta,
      last_used_at: input.lastUsedAt,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
    });
  }

  public listActionPaths(): ExperienceActionPathRow[] {
    const rows = this.listStmt.all() as ExperienceActionPathDbRow[];
    return rows.map(rowToActionPath);
  }

  /**
   * Targeted point-lookup by `actionPathId`.
   *
   * Returns the matching row's full {@link ExperienceActionPathRow}
   * shape, or `undefined` if no row matches. Single-row query: deletes
   * between the caller's `actionPathId` capture and this lookup return
   * `undefined` (NOT throw), so the replay-session aggregator can mark
   * the orphan replay session aggregated without corrupting unrelated
   * rows.
   *
   * NB: callers MUST treat `undefined` as "stale id" — the brief
   * (`docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` §7) explicitly chooses
   * mark-aggregated-and-skip over upserting an empty row.
   */
  public findActionPathById(actionPathId: string): ExperienceActionPathRow | undefined {
    const row = this.findByIdStmt.get(actionPathId) as ExperienceActionPathDbRow | undefined;
    return row ? rowToActionPath(row) : undefined;
  }

  /**
   * Read-only lookup for `experience_suggest_plan`.
   *
   * Returns up to `input.limit` action paths matching `input.intentSignature`,
   * optionally constrained to `input.pageRole`. The sort order is defined and
   * documented on the prepared statements in the constructor.
   *
   * `limit` is treated as a hard ceiling and clamped to `[1, +∞)`; callers
   * are expected to clamp to the public DTO maximum
   * (`MAX_EXPERIENCE_SUGGEST_PLAN_LIMIT`) before calling.
   */
  public suggestActionPaths(input: SuggestActionPathsInput): ExperienceActionPathRow[] {
    const safeLimit = Math.max(1, Math.floor(input.limit));
    const rows =
      input.pageRole !== undefined
        ? (this.suggestForRoleStmt.all(
            input.intentSignature,
            input.pageRole,
            safeLimit,
          ) as ExperienceActionPathDbRow[])
        : (this.suggestStmt.all(input.intentSignature, safeLimit) as ExperienceActionPathDbRow[]);
    return rows.map(rowToActionPath);
  }

  public clear(): void {
    this.clearStmt.run();
  }

  /**
   * Record one replay step outcome. Returns:
   *   - `{status: 'no_match'}` if the row does not exist (caller
   *     should treat as race-with-deletion, NOT as failure);
   *   - `{status: 'ok'}` with the applied delta otherwise.
   *
   * The outcome→delta projection lives here (single source of truth)
   * so any future caller — `experience_score_step` MCP handler, the
   * replay engine's per-step hook, a future scripted backfill — uses
   * the exact same mapping.
   *
   * Re-throws SQLite errors (write-side I/O failure). The handler is
   * responsible for catching them and writing
   * `experience_writeback_warnings` (isolation rule).
   */
  public recordReplayStepOutcome(
    input: RecordReplayStepOutcomeInput,
  ): RecordReplayStepOutcomeResult {
    const isSuccess = isClickSuccessOutcome(input.observedOutcome);
    const successDelta = isSuccess ? 1 : 0;
    const failureDelta = isSuccess ? 0 : 1;
    const lastReplayStatus: TabrixExperienceScoreStepStatus = isSuccess ? 'ok' : 'failed';
    const result = this.recordReplayStepOutcomeStmt.run({
      action_path_id: input.actionPathId,
      success_delta: successDelta,
      failure_delta: failureDelta,
      last_replay_at: input.nowIso,
      observed_outcome: input.observedOutcome,
      last_replay_status: lastReplayStatus,
    });
    // `changes` is `0` when the WHERE clause matched no row.
    if ((result.changes ?? 0) === 0) {
      return { status: 'no_match', successDelta: 0, failureDelta: 0, lastReplayStatus };
    }
    return { status: 'ok', successDelta, failureDelta, lastReplayStatus };
  }

  /**
   * Write the pre-computed decayed composite score onto the
   * action-path row. Pure UPDATE; missing row is silently a no-op
   * (caller decides whether that is meaningful — usually it means a
   * race with deletion).
   */
  public updateCompositeScoreForActionPath(input: UpdateActionPathCompositeScoreInput): void {
    this.updateActionPathCompositeStmt.run({
      action_path_id: input.actionPathId,
      composite_score_decayed: input.compositeScoreDecayed,
      now_iso: input.nowIso,
    });
  }

  /**
   * Write the raw composite score and its component
   * breakdown onto the originating Memory session row.
   */
  public updateMemorySessionCompositeScore(input: UpdateMemorySessionCompositeScoreInput): void {
    this.updateMemorySessionCompositeStmt.run({
      session_id: input.sessionId,
      composite_score_raw: input.compositeScoreRaw,
      components_blob: JSON.stringify(input.components),
    });
  }

  /**
   * Append-only isolation telemetry. Used by the
   * `experience_score_step` handler when the per-step UPDATE throws,
   * and by `SessionCompositeScoreWriter` when the session-end write
   * throws.
   */
  public recordWritebackWarning(input: RecordWritebackWarningInput): void {
    this.insertWritebackWarningStmt.run({
      warning_id: input.warningId,
      source: input.source,
      action_path_id: input.actionPathId,
      step_index: input.stepIndex,
      session_id: input.sessionId,
      replay_id: input.replayId,
      observed_outcome: input.observedOutcome,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      payload_blob: input.payloadBlob,
      created_at: input.createdAt,
    });
  }

  /**
   * Read-side helper for tests + handoff verification. Reads
   * the most recent N warnings (newest first). Pure SELECT.
   */
  public listRecentWritebackWarnings(limit: number = 100): WritebackWarningRow[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = this.db
      .prepare(
        `SELECT warning_id, source, action_path_id, step_index, session_id, replay_id,
                observed_outcome, error_code, error_message, payload_blob, created_at
           FROM experience_writeback_warnings
          ORDER BY created_at DESC, warning_id DESC
          LIMIT ?`,
      )
      .all(safeLimit) as WritebackWarningDbRow[];
    return rows.map((row) => ({
      warningId: row.warning_id,
      source: row.source as WritebackWarningRow['source'],
      actionPathId: row.action_path_id ?? undefined,
      stepIndex: row.step_index ?? undefined,
      sessionId: row.session_id ?? undefined,
      replayId: row.replay_id ?? undefined,
      observedOutcome: row.observed_outcome ?? undefined,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      payloadBlob: row.payload_blob ?? undefined,
      createdAt: row.created_at,
    }));
  }
}

export interface WritebackWarningRow {
  warningId: string;
  source: 'experience_score_step' | 'session_composite_score';
  actionPathId?: string;
  stepIndex?: number;
  sessionId?: string;
  replayId?: string;
  observedOutcome?: string;
  errorCode: string;
  errorMessage: string;
  payloadBlob?: string;
  createdAt: string;
}

interface WritebackWarningDbRow {
  warning_id: string;
  source: string;
  action_path_id: string | null;
  step_index: number | null;
  session_id: string | null;
  replay_id: string | null;
  observed_outcome: string | null;
  error_code: string;
  error_message: string;
  payload_blob: string | null;
  created_at: string;
}

function rowToActionPath(row: ExperienceActionPathDbRow): ExperienceActionPathRow {
  const out: ExperienceActionPathRow = {
    actionPathId: row.action_path_id,
    pageRole: row.page_role,
    intentSignature: row.intent_signature,
    stepSequence: parseStepSequence(row.step_sequence),
    successCount: row.success_count,
    failureCount: row.failure_count,
    lastUsedAt: row.last_used_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.last_replay_at) out.lastReplayAt = row.last_replay_at;
  if (row.last_replay_outcome) {
    out.lastReplayOutcome = row.last_replay_outcome as ClickObservedOutcome;
  }
  if (row.last_replay_status === 'ok' || row.last_replay_status === 'failed') {
    out.lastReplayStatus = row.last_replay_status;
  }
  if (row.composite_score_decayed !== null && row.composite_score_decayed !== undefined) {
    out.compositeScoreDecayed = row.composite_score_decayed;
  }
  return out;
}
