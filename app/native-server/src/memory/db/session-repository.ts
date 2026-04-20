import type { ExecutionSession, ExecutionSessionStatus } from '../../execution/types';
import type { SqliteDatabase } from './client';
import { rowToSession, sessionToRow, type SessionRow } from './row-mappers';

export interface SessionUpdate {
  sessionId: string;
  status: ExecutionSessionStatus;
  summary?: string;
  endedAt: string;
}

export class SessionRepository {
  private readonly insertStmt;
  private readonly getStmt;
  private readonly updateStmt;
  private readonly listStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.insertStmt = db.prepare(
      `INSERT INTO memory_sessions
        (session_id, task_id, transport, client_name, workspace_context, browser_context, summary, status, started_at, ended_at)
       VALUES
        (@session_id, @task_id, @transport, @client_name, @workspace_context, @browser_context, @summary, @status, @started_at, @ended_at)`,
    );
    this.getStmt = db.prepare('SELECT * FROM memory_sessions WHERE session_id = ?');
    this.updateStmt = db.prepare(
      `UPDATE memory_sessions
         SET status = @status, summary = @summary, ended_at = @ended_at
       WHERE session_id = @session_id`,
    );
    this.listStmt = db.prepare('SELECT * FROM memory_sessions ORDER BY started_at ASC');
    this.clearStmt = db.prepare('DELETE FROM memory_sessions');
  }

  public insert(session: ExecutionSession): void {
    this.insertStmt.run(sessionToRow(session));
  }

  public get(sessionId: string): ExecutionSession | undefined {
    const row = this.getStmt.get(sessionId) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  public finish(update: SessionUpdate): void {
    this.updateStmt.run({
      session_id: update.sessionId,
      status: update.status,
      summary: update.summary ?? null,
      ended_at: update.endedAt,
    });
  }

  public list(): ExecutionSession[] {
    return (this.listStmt.all() as SessionRow[]).map((row) => rowToSession(row));
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
