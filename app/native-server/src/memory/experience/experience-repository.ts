import type { SqliteDatabase } from '../db';

export interface ExperienceActionPathStep {
  toolName: string;
  status: string;
  historyRef: string | null;
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
      .map((item) => ({
        toolName: String((item as { toolName?: unknown }).toolName ?? ''),
        status: String((item as { status?: unknown }).status ?? ''),
        historyRef: (() => {
          const value = (item as { historyRef?: unknown }).historyRef;
          return typeof value === 'string' && value.length > 0 ? value : null;
        })(),
      }));
  } catch {
    return [];
  }
}

export class ExperienceRepository {
  private readonly upsertStmt;
  private readonly listStmt;
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
    return rows.map((row) => ({
      actionPathId: row.action_path_id,
      pageRole: row.page_role,
      intentSignature: row.intent_signature,
      stepSequence: parseStepSequence(row.step_sequence),
      successCount: row.success_count,
      failureCount: row.failure_count,
      lastUsedAt: row.last_used_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
