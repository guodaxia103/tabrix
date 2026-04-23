import type { SqliteDatabase } from '../db';
import type { TabrixReplayPlaceholder } from '@tabrix/shared';

export interface ExperienceActionPathStep {
  toolName: string;
  status: string;
  historyRef: string | null;
  /**
   * V24-01: the captured tool-call args lifted from
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
   * V24-01 forward-compat: the {@link TabrixReplayPlaceholder} keys
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
        const obj = item as {
          toolName?: unknown;
          status?: unknown;
          historyRef?: unknown;
          args?: unknown;
          templateFields?: unknown;
        };
        const out: ExperienceActionPathStep = {
          toolName: String(obj.toolName ?? ''),
          status: String(obj.status ?? ''),
          historyRef:
            typeof obj.historyRef === 'string' && obj.historyRef.length > 0 ? obj.historyRef : null,
        };
        // V24-01 forward-compat: preserve `args` / `templateFields`
        // when an existing row already carries them. Today the
        // aggregator does NOT write them; this read-side branch only
        // matters once a future capture-side PR starts populating them.
        if (obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)) {
          out.args = obj.args as Record<string, unknown>;
        }
        if (Array.isArray(obj.templateFields)) {
          const seen: TabrixReplayPlaceholder[] = [];
          for (const k of obj.templateFields) {
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

export class ExperienceRepository {
  private readonly upsertStmt;
  private readonly listStmt;
  private readonly findByIdStmt;
  private readonly suggestStmt;
  private readonly suggestForRoleStmt;
  private readonly clearStmt;

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
              created_at,
              updated_at
         FROM experience_action_paths
        ORDER BY page_role ASC, intent_signature ASC`,
    );
    // V24-01: targeted point-lookup used by:
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
              created_at,
              updated_at
         FROM experience_action_paths
        WHERE action_path_id = ?`,
    );
    // Read-only lookup for `experience_suggest_plan` (B-013).
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
   * V24-01: targeted point-lookup by `actionPathId`.
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
   * Read-only lookup for `experience_suggest_plan` (B-013).
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
}

function rowToActionPath(row: ExperienceActionPathDbRow): ExperienceActionPathRow {
  return {
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
}
