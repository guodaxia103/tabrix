import type { ExecutionSession, ExecutionSessionStatus } from '../../execution/types';
import type { SqliteDatabase } from './client';
import { rowToSession, sessionToRow, type SessionRow } from './row-mappers';

export interface SessionUpdate {
  sessionId: string;
  status: ExecutionSessionStatus;
  summary?: string;
  endedAt: string;
}

/**
 * Read-only projection used by the Memory UI (Stage 3e, B-001).
 *
 * Joins the owning Task's title + intent and pre-computes the
 * per-session step count in SQL so the sidepanel can render a recent
 * sessions list in a single round trip.
 */
export interface SessionSummary {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  taskIntent: string;
  transport: string;
  clientName: string;
  status: ExecutionSessionStatus;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  workspaceContext?: string;
  browserContext?: string;
  stepCount: number;
}

interface SessionSummaryRow extends SessionRow {
  task_title: string;
  task_intent: string;
  step_count: number;
}

/**
 * Upper bound on `limit` accepted by {@link SessionRepository.listRecent}.
 * Keeps sidepanel first-paint under ~50 ms even on a 10k-row DB and
 * prevents an unbounded read from being turned into a JSON response.
 */
export const SESSION_SUMMARY_LIMIT_MAX = 500;

export class SessionRepository {
  private readonly insertStmt;
  private readonly getStmt;
  private readonly updateStmt;
  private readonly listStmt;
  private readonly listRecentWithTaskStmt;
  private readonly countAllStmt;
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
    this.listRecentWithTaskStmt = db.prepare(
      `SELECT s.*,
              t.title  AS task_title,
              t.intent AS task_intent,
              (SELECT COUNT(*) FROM memory_steps WHERE session_id = s.session_id)
                AS step_count
         FROM memory_sessions s
         JOIN memory_tasks t ON t.task_id = s.task_id
         ORDER BY s.started_at DESC, s.session_id DESC
         LIMIT @limit OFFSET @offset`,
    );
    this.countAllStmt = db.prepare('SELECT COUNT(*) AS total FROM memory_sessions');
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

  /**
   * Read-only: list the most recent sessions with task title/intent and
   * step count joined in. Ordered `started_at DESC, session_id DESC`
   * (secondary key keeps the order stable when multiple sessions share
   * the same ISO timestamp).
   *
   * @param limit  max rows to return, clamped to `[1, SESSION_SUMMARY_LIMIT_MAX]`
   * @param offset rows to skip, clamped to `[0, +∞)`
   * @returns SessionSummary[] (never null; may be empty).
   * @remarks read-only; paginate with limit ≤ 500 to keep sidepanel renders < 50 ms.
   */
  public listRecent(limit: number, offset: number): SessionSummary[] {
    const safeLimit = Math.min(
      SESSION_SUMMARY_LIMIT_MAX,
      Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 1),
    );
    const safeOffset = Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0);
    const rows = this.listRecentWithTaskStmt.all({
      limit: safeLimit,
      offset: safeOffset,
    }) as SessionSummaryRow[];
    return rows.map((row) => {
      const session = rowToSession(row);
      return {
        sessionId: session.sessionId,
        taskId: session.taskId,
        taskTitle: row.task_title,
        taskIntent: row.task_intent,
        transport: session.transport,
        clientName: session.clientName,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        summary: session.summary,
        workspaceContext: session.workspaceContext,
        browserContext: session.browserContext,
        stepCount: Number(row.step_count ?? 0),
      };
    });
  }

  /**
   * Read-only: total number of sessions in the DB. Used to render
   * pagination controls in the sidepanel Memory tab.
   *
   * @returns total row count as a non-negative integer.
   * @remarks read-only; paginate with limit ≤ 500 to keep sidepanel renders < 50 ms.
   */
  public countAll(): number {
    const row = this.countAllStmt.get() as { total: number } | undefined;
    return Number(row?.total ?? 0);
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
