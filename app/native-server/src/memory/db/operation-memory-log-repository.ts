import { randomUUID } from 'node:crypto';

import type { SqliteDatabase } from './client';
import {
  buildOperationLogBlobV2,
  buildOperationLogMetadata,
  parseOperationLogBlob,
  type OperationLogMetadata,
} from './operation-log-metadata';

export interface OperationMemoryLogInsert {
  operationLogId?: string;
  taskId: string;
  sessionId: string;
  stepId: string;
  toolName: string;
  urlPattern?: string | null;
  pageRole?: string | null;
  requestedLayer?: string | null;
  selectedDataSource?: string | null;
  sourceRoute?: string | null;
  decisionReason?: string | null;
  resultKind?: string | null;
  durationMs?: number | null;
  success: boolean;
  fallbackUsed?: string | null;
  errorCode?: string | null;
  readCount?: number | null;
  tokensSaved?: number | null;
  tabHygiene?: unknown;
  /**
   * V26-FIX-07 — closed-shape "why" envelope persisted alongside
   * `tabHygiene` inside the existing `tab_hygiene_blob` column. The
   * repository fills in any missing field with the
   * `'not_applicable'` sentinel; callers MAY pass `undefined` for
   * legacy back-compat (the row will still carry a fully-formed
   * metadata block on read).
   */
  metadata?: Partial<OperationLogMetadata>;
  createdAt: string;
}

export interface OperationMemoryLog {
  operationLogId: string;
  taskId: string;
  sessionId: string;
  stepId: string;
  toolName: string;
  urlPattern: string | null;
  pageRole: string | null;
  requestedLayer: string | null;
  selectedDataSource: string | null;
  sourceRoute: string | null;
  decisionReason: string | null;
  resultKind: string | null;
  durationMs: number | null;
  success: boolean;
  fallbackUsed: string | null;
  errorCode: string | null;
  readCount: number | null;
  tokensSaved: number | null;
  tabHygiene: unknown | null;
  /**
   * V26-FIX-07 — always non-null on read. Legacy rows (written
   * before FIX-07) surface the `'not_applicable'` sentinel for
   * every field so a downstream join never has to special-case
   * "old vs new" rows.
   */
  metadata: OperationLogMetadata;
  createdAt: string;
}

interface OperationMemoryLogRow {
  operation_log_id: string;
  task_id: string;
  session_id: string;
  step_id: string;
  tool_name: string;
  url_pattern: string | null;
  page_role: string | null;
  requested_layer: string | null;
  selected_data_source: string | null;
  source_route: string | null;
  decision_reason: string | null;
  result_kind: string | null;
  duration_ms: number | null;
  success: number;
  fallback_used: string | null;
  error_code: string | null;
  read_count: number | null;
  tokens_saved: number | null;
  tab_hygiene_blob: string | null;
  created_at: string;
}

function normalizeOptionalInteger(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value as number));
}

function parseJsonBlob(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function rowToOperationMemoryLog(row: OperationMemoryLogRow): OperationMemoryLog {
  const { tabHygiene, metadata } = parseOperationLogBlob(parseJsonBlob(row.tab_hygiene_blob));
  return {
    operationLogId: row.operation_log_id,
    taskId: row.task_id,
    sessionId: row.session_id,
    stepId: row.step_id,
    toolName: row.tool_name,
    urlPattern: row.url_pattern,
    pageRole: row.page_role,
    requestedLayer: row.requested_layer,
    selectedDataSource: row.selected_data_source,
    sourceRoute: row.source_route,
    decisionReason: row.decision_reason,
    resultKind: row.result_kind,
    durationMs: row.duration_ms,
    success: row.success === 1,
    fallbackUsed: row.fallback_used,
    errorCode: row.error_code,
    readCount: row.read_count,
    tokensSaved: row.tokens_saved,
    tabHygiene,
    metadata,
    createdAt: row.created_at,
  };
}

export class OperationMemoryLogRepository {
  private readonly insertStmt;
  private readonly listBySessionStmt;
  private readonly countStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.insertStmt = db.prepare(
      `INSERT OR REPLACE INTO operation_memory_logs
        (operation_log_id, task_id, session_id, step_id, tool_name,
         url_pattern, page_role, requested_layer, selected_data_source,
         source_route, decision_reason, result_kind, duration_ms, success,
         fallback_used, error_code, read_count, tokens_saved, tab_hygiene_blob, created_at)
       VALUES
        (@operation_log_id, @task_id, @session_id, @step_id, @tool_name,
         @url_pattern, @page_role, @requested_layer, @selected_data_source,
         @source_route, @decision_reason, @result_kind, @duration_ms, @success,
         @fallback_used, @error_code, @read_count, @tokens_saved, @tab_hygiene_blob, @created_at)`,
    );
    this.listBySessionStmt = db.prepare(
      'SELECT * FROM operation_memory_logs WHERE session_id = ? ORDER BY created_at ASC',
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS count FROM operation_memory_logs');
    this.clearStmt = db.prepare('DELETE FROM operation_memory_logs');
  }

  public insert(input: OperationMemoryLogInsert): OperationMemoryLog {
    // V26-FIX-07 — always serialise to the schema-v2 wrapper so a
    // downstream `taskSessionId` join never has to branch on
    // "legacy vs structured". Even when the caller passes neither
    // `tabHygiene` nor `metadata`, we still emit a wrapper carrying
    // the all-`'not_applicable'` defaults: it costs ~140 bytes per
    // row and removes a whole class of "missing field" bugs.
    const metadata = buildOperationLogMetadata(input.metadata);
    const blob = buildOperationLogBlobV2({
      tabHygiene: input.tabHygiene ?? null,
      metadata,
    });
    const row = {
      operation_log_id: input.operationLogId ?? randomUUID(),
      task_id: input.taskId,
      session_id: input.sessionId,
      step_id: input.stepId,
      tool_name: input.toolName,
      url_pattern: input.urlPattern ?? null,
      page_role: input.pageRole ?? null,
      requested_layer: input.requestedLayer ?? null,
      selected_data_source: input.selectedDataSource ?? null,
      source_route: input.sourceRoute ?? null,
      decision_reason: input.decisionReason ?? null,
      result_kind: input.resultKind ?? null,
      duration_ms: normalizeOptionalInteger(input.durationMs),
      success: input.success ? 1 : 0,
      fallback_used: input.fallbackUsed ?? null,
      error_code: input.errorCode ?? null,
      read_count: normalizeOptionalInteger(input.readCount),
      tokens_saved: normalizeOptionalInteger(input.tokensSaved),
      tab_hygiene_blob: JSON.stringify(blob),
      created_at: input.createdAt,
    };
    this.insertStmt.run(row);
    return rowToOperationMemoryLog(row);
  }

  public listBySession(sessionId: string): OperationMemoryLog[] {
    return (this.listBySessionStmt.all(sessionId) as OperationMemoryLogRow[]).map(
      rowToOperationMemoryLog,
    );
  }

  public count(): number {
    const row = this.countStmt.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
