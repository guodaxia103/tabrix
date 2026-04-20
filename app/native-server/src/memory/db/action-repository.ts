import type { SqliteDatabase } from './client';

export type MemoryActionKind = 'click' | 'fill' | 'navigate' | 'keyboard';
export type MemoryActionStatus = 'success' | 'failed' | 'soft_failure';
export type MemoryNavigateMode = 'url' | 'refresh' | 'back' | 'forward' | 'new_tab';

export interface MemoryAction {
  actionId: string;
  stepId: string;
  sessionId: string;
  toolName: string;
  actionKind: MemoryActionKind;
  navigateMode?: MemoryNavigateMode | null;
  tabId?: number | null;
  windowId?: number | null;
  targetRef?: string | null;
  targetSelector?: string | null;
  targetFrameId?: number | null;
  urlRequested?: string | null;
  urlBefore?: string | null;
  urlAfter?: string | null;
  keySpec?: string | null;
  valueSummary?: string | null;
  status: MemoryActionStatus;
  errorCode?: string | null;
  preSnapshotRef?: string | null;
  argsBlob?: string | null;
  resultBlob?: string | null;
  capturedAt: string;
}

interface MemoryActionRow {
  action_id: string;
  step_id: string;
  session_id: string;
  tool_name: string;
  action_kind: string;
  navigate_mode: string | null;
  tab_id: number | null;
  window_id: number | null;
  target_ref: string | null;
  target_selector: string | null;
  target_frame_id: number | null;
  url_requested: string | null;
  url_before: string | null;
  url_after: string | null;
  key_spec: string | null;
  value_summary: string | null;
  status: string;
  error_code: string | null;
  pre_snapshot_ref: string | null;
  args_blob: string | null;
  result_blob: string | null;
  captured_at: string;
}

function actionToRow(action: MemoryAction): MemoryActionRow {
  return {
    action_id: action.actionId,
    step_id: action.stepId,
    session_id: action.sessionId,
    tool_name: action.toolName,
    action_kind: action.actionKind,
    navigate_mode: action.navigateMode ?? null,
    tab_id: action.tabId ?? null,
    window_id: action.windowId ?? null,
    target_ref: action.targetRef ?? null,
    target_selector: action.targetSelector ?? null,
    target_frame_id: action.targetFrameId ?? null,
    url_requested: action.urlRequested ?? null,
    url_before: action.urlBefore ?? null,
    url_after: action.urlAfter ?? null,
    key_spec: action.keySpec ?? null,
    value_summary: action.valueSummary ?? null,
    status: action.status,
    error_code: action.errorCode ?? null,
    pre_snapshot_ref: action.preSnapshotRef ?? null,
    args_blob: action.argsBlob ?? null,
    result_blob: action.resultBlob ?? null,
    captured_at: action.capturedAt,
  };
}

function rowToAction(row: MemoryActionRow): MemoryAction {
  return {
    actionId: row.action_id,
    stepId: row.step_id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    actionKind: row.action_kind as MemoryActionKind,
    navigateMode: (row.navigate_mode as MemoryNavigateMode | null) ?? null,
    tabId: row.tab_id ?? null,
    windowId: row.window_id ?? null,
    targetRef: row.target_ref ?? null,
    targetSelector: row.target_selector ?? null,
    targetFrameId: row.target_frame_id ?? null,
    urlRequested: row.url_requested ?? null,
    urlBefore: row.url_before ?? null,
    urlAfter: row.url_after ?? null,
    keySpec: row.key_spec ?? null,
    valueSummary: row.value_summary ?? null,
    status: row.status as MemoryActionStatus,
    errorCode: row.error_code ?? null,
    preSnapshotRef: row.pre_snapshot_ref ?? null,
    argsBlob: row.args_blob ?? null,
    resultBlob: row.result_blob ?? null,
    capturedAt: row.captured_at,
  };
}

export class ActionRepository {
  private readonly insertStmt;
  private readonly getStmt;
  private readonly listBySessionStmt;
  private readonly listByStepStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.insertStmt = db.prepare(
      `INSERT INTO memory_actions
        (action_id, step_id, session_id, tool_name, action_kind, navigate_mode,
         tab_id, window_id, target_ref, target_selector, target_frame_id,
         url_requested, url_before, url_after, key_spec, value_summary,
         status, error_code, pre_snapshot_ref, args_blob, result_blob, captured_at)
       VALUES
        (@action_id, @step_id, @session_id, @tool_name, @action_kind, @navigate_mode,
         @tab_id, @window_id, @target_ref, @target_selector, @target_frame_id,
         @url_requested, @url_before, @url_after, @key_spec, @value_summary,
         @status, @error_code, @pre_snapshot_ref, @args_blob, @result_blob, @captured_at)`,
    );
    this.getStmt = db.prepare('SELECT * FROM memory_actions WHERE action_id = ?');
    this.listBySessionStmt = db.prepare(
      'SELECT * FROM memory_actions WHERE session_id = ? ORDER BY captured_at ASC',
    );
    this.listByStepStmt = db.prepare(
      'SELECT * FROM memory_actions WHERE step_id = ? ORDER BY captured_at ASC',
    );
    this.clearStmt = db.prepare('DELETE FROM memory_actions');
  }

  public insert(action: MemoryAction): void {
    this.insertStmt.run(actionToRow(action));
  }

  public get(actionId: string): MemoryAction | undefined {
    const row = this.getStmt.get(actionId) as MemoryActionRow | undefined;
    return row ? rowToAction(row) : undefined;
  }

  public listBySession(sessionId: string): MemoryAction[] {
    return (this.listBySessionStmt.all(sessionId) as MemoryActionRow[]).map(rowToAction);
  }

  public listByStep(stepId: string): MemoryAction[] {
    return (this.listByStepStmt.all(stepId) as MemoryActionRow[]).map(rowToAction);
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
