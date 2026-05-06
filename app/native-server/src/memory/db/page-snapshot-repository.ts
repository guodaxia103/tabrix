import type { SqliteDatabase } from './client';

/**
 * Structured page snapshot persisted from `chrome_read_page` results.
 *
 * Field naming uses camelCase at the DTO layer and snake_case at the
 * SQL layer, matching the existing `execution/types.ts` conventions.
 */
export interface PageSnapshot {
  snapshotId: string;
  stepId: string;
  tabId?: number | null;
  url?: string | null;
  title?: string | null;
  pageType?: string | null;
  mode?: string | null;
  pageRole?: string | null;
  primaryRegion?: string | null;
  quality?: string | null;
  taskMode?: string | null;
  complexityLevel?: string | null;
  sourceKind?: string | null;
  fallbackUsed: boolean;
  interactiveCount: number;
  candidateActionCount: number;
  highValueObjectCount: number;
  summaryBlob?: string | null;
  pageContextBlob?: string | null;
  highValueObjectsBlob?: string | null;
  interactiveElementsBlob?: string | null;
  candidateActionsBlob?: string | null;
  protocolL0Blob?: string | null;
  protocolL1Blob?: string | null;
  protocolL2Blob?: string | null;
  capturedAt: string;
}

interface PageSnapshotRow {
  snapshot_id: string;
  step_id: string;
  tab_id: number | null;
  url: string | null;
  title: string | null;
  page_type: string | null;
  mode: string | null;
  page_role: string | null;
  primary_region: string | null;
  quality: string | null;
  task_mode: string | null;
  complexity_level: string | null;
  source_kind: string | null;
  fallback_used: number;
  interactive_count: number;
  candidate_action_count: number;
  high_value_object_count: number;
  summary_blob: string | null;
  page_context_blob: string | null;
  high_value_objects_blob: string | null;
  interactive_elements_blob: string | null;
  candidate_actions_blob: string | null;
  protocol_l0_blob: string | null;
  protocol_l1_blob: string | null;
  protocol_l2_blob: string | null;
  captured_at: string;
}

function snapshotToRow(snap: PageSnapshot): PageSnapshotRow {
  return {
    snapshot_id: snap.snapshotId,
    step_id: snap.stepId,
    tab_id: snap.tabId ?? null,
    url: snap.url ?? null,
    title: snap.title ?? null,
    page_type: snap.pageType ?? null,
    mode: snap.mode ?? null,
    page_role: snap.pageRole ?? null,
    primary_region: snap.primaryRegion ?? null,
    quality: snap.quality ?? null,
    task_mode: snap.taskMode ?? null,
    complexity_level: snap.complexityLevel ?? null,
    source_kind: snap.sourceKind ?? null,
    fallback_used: snap.fallbackUsed ? 1 : 0,
    interactive_count: snap.interactiveCount,
    candidate_action_count: snap.candidateActionCount,
    high_value_object_count: snap.highValueObjectCount,
    summary_blob: snap.summaryBlob ?? null,
    page_context_blob: snap.pageContextBlob ?? null,
    high_value_objects_blob: snap.highValueObjectsBlob ?? null,
    interactive_elements_blob: snap.interactiveElementsBlob ?? null,
    candidate_actions_blob: snap.candidateActionsBlob ?? null,
    protocol_l0_blob: snap.protocolL0Blob ?? null,
    protocol_l1_blob: snap.protocolL1Blob ?? null,
    protocol_l2_blob: snap.protocolL2Blob ?? null,
    captured_at: snap.capturedAt,
  };
}

function rowToSnapshot(row: PageSnapshotRow): PageSnapshot {
  return {
    snapshotId: row.snapshot_id,
    stepId: row.step_id,
    tabId: row.tab_id ?? undefined,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
    pageType: row.page_type ?? undefined,
    mode: row.mode ?? undefined,
    pageRole: row.page_role ?? undefined,
    primaryRegion: row.primary_region ?? undefined,
    quality: row.quality ?? undefined,
    taskMode: row.task_mode ?? undefined,
    complexityLevel: row.complexity_level ?? undefined,
    sourceKind: row.source_kind ?? undefined,
    fallbackUsed: row.fallback_used === 1,
    interactiveCount: row.interactive_count,
    candidateActionCount: row.candidate_action_count,
    highValueObjectCount: row.high_value_object_count,
    summaryBlob: row.summary_blob ?? undefined,
    pageContextBlob: row.page_context_blob ?? undefined,
    highValueObjectsBlob: row.high_value_objects_blob ?? undefined,
    interactiveElementsBlob: row.interactive_elements_blob ?? undefined,
    candidateActionsBlob: row.candidate_actions_blob ?? undefined,
    protocolL0Blob: row.protocol_l0_blob ?? undefined,
    protocolL1Blob: row.protocol_l1_blob ?? undefined,
    protocolL2Blob: row.protocol_l2_blob ?? undefined,
    capturedAt: row.captured_at,
  };
}

export class PageSnapshotRepository {
  private readonly insertStmt;
  private readonly getStmt;
  private readonly listByStepStmt;
  private readonly findLatestInSessionForTabStmt;
  private readonly findLatestPageRoleForSessionStmt;
  private readonly findLatestForUrlStmt;
  private readonly findLatestForPageRoleStmt;
  private readonly findLatestGlobalStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.insertStmt = db.prepare(
      `INSERT INTO memory_page_snapshots
        (snapshot_id, step_id, tab_id, url, title, page_type, mode,
         page_role, primary_region, quality, task_mode, complexity_level,
         source_kind, fallback_used, interactive_count, candidate_action_count,
         high_value_object_count, summary_blob, page_context_blob,
         high_value_objects_blob, interactive_elements_blob, candidate_actions_blob,
         protocol_l0_blob, protocol_l1_blob, protocol_l2_blob, captured_at)
       VALUES
        (@snapshot_id, @step_id, @tab_id, @url, @title, @page_type, @mode,
         @page_role, @primary_region, @quality, @task_mode, @complexity_level,
         @source_kind, @fallback_used, @interactive_count, @candidate_action_count,
         @high_value_object_count, @summary_blob, @page_context_blob,
         @high_value_objects_blob, @interactive_elements_blob, @candidate_actions_blob,
         @protocol_l0_blob, @protocol_l1_blob, @protocol_l2_blob, @captured_at)`,
    );
    this.getStmt = db.prepare('SELECT * FROM memory_page_snapshots WHERE snapshot_id = ?');
    this.listByStepStmt = db.prepare(
      'SELECT * FROM memory_page_snapshots WHERE step_id = ? ORDER BY captured_at ASC',
    );
    // Phase 0.3: pre-snapshot lookup for an action. Scoped to the
    // current session to avoid binding stale page state from other
    // sessions to a new task.
    this.findLatestInSessionForTabStmt = db.prepare(
      `SELECT s.* FROM memory_page_snapshots s
       JOIN memory_steps st ON st.step_id = s.step_id
       WHERE s.tab_id = @tab_id
         AND st.session_id = @session_id
         AND s.captured_at <= @before_iso
       ORDER BY s.captured_at DESC
       LIMIT 1`,
    );
    this.findLatestPageRoleForSessionStmt = db.prepare(
      `SELECT s.page_role
         FROM memory_page_snapshots s
         JOIN memory_steps st ON st.step_id = s.step_id
        WHERE st.session_id = @session_id
          AND s.page_role IS NOT NULL
          AND s.page_role <> ''
        ORDER BY s.captured_at DESC, s.snapshot_id DESC
        LIMIT 1`,
    );
    // Live page context provider lookups. Three newest-first finders feed
    // `LivePageContextProvider`. They are
    // pure reads — no joins, no writes — and rely on the
    // `captured_at_idx` ordering already in `MEMORY_CREATE_TABLES_SQL`.
    this.findLatestForUrlStmt = db.prepare(
      `SELECT * FROM memory_page_snapshots
        WHERE url = ?
        ORDER BY captured_at DESC, snapshot_id DESC
        LIMIT 1`,
    );
    this.findLatestForPageRoleStmt = db.prepare(
      `SELECT * FROM memory_page_snapshots
        WHERE page_role = ?
        ORDER BY captured_at DESC, snapshot_id DESC
        LIMIT 1`,
    );
    this.findLatestGlobalStmt = db.prepare(
      `SELECT * FROM memory_page_snapshots
        ORDER BY captured_at DESC, snapshot_id DESC
        LIMIT 1`,
    );
    this.clearStmt = db.prepare('DELETE FROM memory_page_snapshots');
  }

  public insert(snap: PageSnapshot): void {
    this.insertStmt.run(snapshotToRow(snap));
  }

  public get(snapshotId: string): PageSnapshot | undefined {
    const row = this.getStmt.get(snapshotId) as PageSnapshotRow | undefined;
    return row ? rowToSnapshot(row) : undefined;
  }

  public listByStep(stepId: string): PageSnapshot[] {
    return (this.listByStepStmt.all(stepId) as PageSnapshotRow[]).map(rowToSnapshot);
  }

  /**
   * Find the most recent page snapshot for the given tab within the
   * given session, captured at or before `beforeIso`. Returns
   * `undefined` when no snapshot is available (e.g. action fires
   * without a prior `chrome_read_page`).
   */
  public findLatestInSessionForTab(params: {
    sessionId: string;
    tabId: number;
    beforeIso: string;
  }): PageSnapshot | undefined {
    const row = this.findLatestInSessionForTabStmt.get({
      session_id: params.sessionId,
      tab_id: params.tabId,
      before_iso: params.beforeIso,
    }) as PageSnapshotRow | undefined;
    return row ? rowToSnapshot(row) : undefined;
  }

  /**
   * Find the latest non-empty `page_role` seen inside one session.
   */
  public findLatestPageRoleForSession(sessionId: string): string | undefined {
    const row = this.findLatestPageRoleForSessionStmt.get({ session_id: sessionId }) as
      | { page_role: string | null }
      | undefined;
    if (!row?.page_role) return undefined;
    return row.page_role;
  }

  /**
   * Newest snapshot whose `url` exactly matches.
   * `undefined` when no row matches. Caller must treat `undefined`
   * as "no live signal — degrade to memory_snapshot or fallback".
   */
  public findLatestForUrl(url: string): PageSnapshot | undefined {
    const row = this.findLatestForUrlStmt.get(url) as PageSnapshotRow | undefined;
    return row ? rowToSnapshot(row) : undefined;
  }

  /**
   * Newest snapshot whose `page_role` matches.
   * `undefined` when no row matches.
   */
  public findLatestForPageRole(pageRole: string): PageSnapshot | undefined {
    const row = this.findLatestForPageRoleStmt.get(pageRole) as PageSnapshotRow | undefined;
    return row ? rowToSnapshot(row) : undefined;
  }

  /**
   * Newest snapshot in the table, regardless of
   * URL or pageRole. Used as the last-resort `memory_snapshot`
   * fallback before the provider returns `fallback_zero`.
   */
  public findLatestGlobal(): PageSnapshot | undefined {
    const row = this.findLatestGlobalStmt.get() as PageSnapshotRow | undefined;
    return row ? rowToSnapshot(row) : undefined;
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
