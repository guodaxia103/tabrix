import type { ExecutionStep, ExecutionStepStatus } from '../../execution/types';
import type { SqliteDatabase } from './client';
import { rowToStep, stepToRow, type StepRow } from './row-mappers';

export interface StepCompletion {
  stepId: string;
  status: ExecutionStepStatus;
  resultSummary?: string;
  errorCode?: string;
  errorSummary?: string;
  artifactRefs: string[];
  endedAt: string;
}

export class StepRepository {
  private readonly insertStmt;
  private readonly updateStmt;
  private readonly listBySessionStmt;
  private readonly clearStmt;
  private readonly nextIndexStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.insertStmt = db.prepare(
      `INSERT INTO memory_steps
        (step_id, session_id, step_index, tool_name, step_type, status,
         input_summary, result_summary, error_code, error_summary,
         artifact_refs, started_at, ended_at)
       VALUES
        (@step_id, @session_id, @step_index, @tool_name, @step_type, @status,
         @input_summary, @result_summary, @error_code, @error_summary,
         @artifact_refs, @started_at, @ended_at)`,
    );
    this.updateStmt = db.prepare(
      `UPDATE memory_steps
         SET status = @status,
             result_summary = @result_summary,
             error_code = @error_code,
             error_summary = @error_summary,
             artifact_refs = @artifact_refs,
             ended_at = @ended_at
       WHERE step_id = @step_id`,
    );
    this.listBySessionStmt = db.prepare(
      'SELECT * FROM memory_steps WHERE session_id = ? ORDER BY step_index ASC',
    );
    this.clearStmt = db.prepare('DELETE FROM memory_steps');
    this.nextIndexStmt = db.prepare(
      'SELECT COALESCE(MAX(step_index), 0) AS max_index FROM memory_steps WHERE session_id = ?',
    );
  }

  public insert(step: ExecutionStep): void {
    this.insertStmt.run(stepToRow(step));
  }

  public complete(completion: StepCompletion): void {
    this.updateStmt.run({
      step_id: completion.stepId,
      status: completion.status,
      result_summary: completion.resultSummary ?? null,
      error_code: completion.errorCode ?? null,
      error_summary: completion.errorSummary ?? null,
      artifact_refs: JSON.stringify(completion.artifactRefs ?? []),
      ended_at: completion.endedAt,
    });
  }

  public listBySession(sessionId: string): ExecutionStep[] {
    return (this.listBySessionStmt.all(sessionId) as StepRow[]).map(rowToStep);
  }

  public clear(): void {
    this.clearStmt.run();
  }

  public nextIndexFor(sessionId: string): number {
    const row = this.nextIndexStmt.get(sessionId) as { max_index: number } | undefined;
    return (row?.max_index ?? 0) + 1;
  }
}
