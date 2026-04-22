import type { Task } from '../../execution/types';
import type { SqliteDatabase } from './client';
import { rowToTask, taskToRow, type TaskRow } from './row-mappers';

export class TaskRepository {
  private readonly insertStmt;
  private readonly getStmt;
  private readonly updateStmt;
  private readonly updateIntentStmt;
  private readonly listStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.insertStmt = db.prepare(
      `INSERT INTO memory_tasks
        (task_id, task_type, title, intent, origin, owner, project_id, labels, status, created_at, updated_at)
       VALUES
        (@task_id, @task_type, @title, @intent, @origin, @owner, @project_id, @labels, @status, @created_at, @updated_at)`,
    );
    this.getStmt = db.prepare('SELECT * FROM memory_tasks WHERE task_id = ?');
    this.updateStmt = db.prepare(
      `UPDATE memory_tasks
         SET status = @status, updated_at = @updated_at
       WHERE task_id = @task_id`,
    );
    // V24-01: re-tag a task's intent. Used by the `experience_replay`
    // MCP handler so the wrapper-owned Memory session carries the
    // `experience_replay:<actionPathId>` prefix the aggregator's
    // special-case (brief §7) keys off. Narrow on purpose: only
    // mutates `intent` + `updated_at`, never `task_type` / `title`.
    this.updateIntentStmt = db.prepare(
      `UPDATE memory_tasks
         SET intent = @intent, updated_at = @updated_at
       WHERE task_id = @task_id`,
    );
    this.listStmt = db.prepare('SELECT * FROM memory_tasks ORDER BY created_at ASC');
    this.clearStmt = db.prepare('DELETE FROM memory_tasks');
  }

  public insert(task: Task): void {
    this.insertStmt.run(taskToRow(task));
  }

  /**
   * Read-only: fetch a single task by id.
   *
   * @param taskId id of the task to look up.
   * @returns Task | undefined when no row matches.
   * @remarks read-only; paginate with limit ≤ 500 to keep sidepanel renders < 50 ms.
   */
  public get(taskId: string): Task | undefined {
    const row = this.getStmt.get(taskId) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  public updateStatus(taskId: string, status: Task['status'], updatedAt: string): void {
    this.updateStmt.run({ task_id: taskId, status, updated_at: updatedAt });
  }

  /**
   * V24-01: update the task's `intent` column. The narrow shape (no
   * status / type changes) keeps callers from accidentally widening
   * this into a generic "patch task" surface.
   */
  public updateIntent(taskId: string, intent: string, updatedAt: string): void {
    this.updateIntentStmt.run({ task_id: taskId, intent, updated_at: updatedAt });
  }

  public list(): Task[] {
    return (this.listStmt.all() as TaskRow[]).map(rowToTask);
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
