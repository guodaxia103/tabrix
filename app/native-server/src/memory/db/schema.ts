/**
 * Memory Phase 0 SQL schema.
 *
 * Three tables, one-to-one with the in-memory TS types in
 * `src/execution/types.ts`:
 * - memory_tasks      <-> Task
 * - memory_sessions   <-> ExecutionSession (minus `steps`)
 * - memory_steps      <-> ExecutionStep
 *
 * Columns use TEXT for ids/enums/timestamps to match the existing
 * TypeScript DTOs exactly (no int encoding). `labels` and
 * `artifact_refs` are stored as JSON-serialized TEXT.
 *
 * Design choices (see docs/MEMORY_PHASE_0.md):
 * - Independent SQLite file (`memory.db`) to avoid coupling with
 *   the agent db's hand-rolled migration surface.
 * - `CREATE TABLE IF NOT EXISTS` for idempotent initialization.
 * - Foreign keys enforced via `PRAGMA foreign_keys=ON`.
 * - WAL journal for concurrent-read safety.
 * - Compound uniqueness `(session_id, step_index)` preserves
 *   ordering invariants from `SessionManager.startStep`.
 */

export const MEMORY_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS memory_tasks (
  task_id     TEXT PRIMARY KEY,
  task_type   TEXT NOT NULL,
  title       TEXT NOT NULL,
  intent      TEXT NOT NULL,
  origin      TEXT NOT NULL,
  owner       TEXT,
  project_id  TEXT,
  labels      TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_tasks_created_at_idx ON memory_tasks(created_at);
CREATE INDEX IF NOT EXISTS memory_tasks_status_idx     ON memory_tasks(status);

CREATE TABLE IF NOT EXISTS memory_sessions (
  session_id        TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES memory_tasks(task_id) ON DELETE CASCADE,
  transport         TEXT NOT NULL,
  client_name       TEXT NOT NULL,
  workspace_context TEXT,
  browser_context   TEXT,
  summary           TEXT,
  status            TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  ended_at          TEXT
);

CREATE INDEX IF NOT EXISTS memory_sessions_task_id_idx    ON memory_sessions(task_id);
CREATE INDEX IF NOT EXISTS memory_sessions_started_at_idx ON memory_sessions(started_at);

CREATE TABLE IF NOT EXISTS memory_steps (
  step_id        TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES memory_sessions(session_id) ON DELETE CASCADE,
  step_index     INTEGER NOT NULL,
  tool_name      TEXT NOT NULL,
  step_type      TEXT NOT NULL,
  status         TEXT NOT NULL,
  input_summary  TEXT,
  result_summary TEXT,
  error_code     TEXT,
  error_summary  TEXT,
  artifact_refs  TEXT NOT NULL DEFAULT '[]',
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  UNIQUE (session_id, step_index)
);

CREATE INDEX IF NOT EXISTS memory_steps_session_id_idx ON memory_steps(session_id);
CREATE INDEX IF NOT EXISTS memory_steps_tool_name_idx  ON memory_steps(tool_name);

-- Phase 0.2: structured page snapshots produced by chrome_read_page.
-- Stable columns are kept narrow (query-friendly, low volatility).
-- Blob columns hold JSON-serialized slices of the original response,
-- intentionally trimmed (e.g. top-24 interactive elements) so the
-- table stays lightweight enough for long-horizon retention.
CREATE TABLE IF NOT EXISTS memory_page_snapshots (
  snapshot_id               TEXT PRIMARY KEY,
  step_id                   TEXT NOT NULL REFERENCES memory_steps(step_id) ON DELETE CASCADE,
  tab_id                    INTEGER,
  url                       TEXT,
  title                     TEXT,
  page_type                 TEXT,
  mode                      TEXT,
  page_role                 TEXT,
  primary_region            TEXT,
  quality                   TEXT,
  task_mode                 TEXT,
  complexity_level          TEXT,
  source_kind               TEXT,
  fallback_used             INTEGER DEFAULT 0,
  interactive_count         INTEGER DEFAULT 0,
  candidate_action_count    INTEGER DEFAULT 0,
  high_value_object_count   INTEGER DEFAULT 0,
  summary_blob              TEXT,
  page_context_blob         TEXT,
  high_value_objects_blob   TEXT,
  interactive_elements_blob TEXT,
  candidate_actions_blob    TEXT,
  protocol_l0_blob          TEXT,
  protocol_l1_blob          TEXT,
  protocol_l2_blob          TEXT,
  captured_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_page_snapshots_step_id_idx      ON memory_page_snapshots(step_id);
CREATE INDEX IF NOT EXISTS memory_page_snapshots_url_idx          ON memory_page_snapshots(url);
CREATE INDEX IF NOT EXISTS memory_page_snapshots_page_role_idx    ON memory_page_snapshots(page_role);
CREATE INDEX IF NOT EXISTS memory_page_snapshots_captured_at_idx  ON memory_page_snapshots(captured_at);
-- Added in Phase 0.3 to support "latest snapshot for this tab in the
-- current session" lookup from the action post-processor.
CREATE INDEX IF NOT EXISTS memory_page_snapshots_tab_captured_idx ON memory_page_snapshots(tab_id, captured_at);

-- Phase 0.3: structured trail of DOM-interaction actions produced by
-- click / fill / navigate / keyboard tools. Each row links back to
-- the owning execution step, the session, and (when available) the
-- most recent page snapshot for the same tab in the same session.
-- Sensitive values (notably chrome_fill_or_select.value) are never
-- stored in plaintext; only a redacted {kind,type,length,sha256}
-- summary lands in value_summary. result_blob is omitted for fill
-- because the extension response may echo the submitted value.
CREATE TABLE IF NOT EXISTS memory_actions (
  action_id         TEXT PRIMARY KEY,
  step_id           TEXT NOT NULL REFERENCES memory_steps(step_id) ON DELETE CASCADE,
  session_id        TEXT NOT NULL REFERENCES memory_sessions(session_id) ON DELETE CASCADE,
  tool_name         TEXT NOT NULL,
  action_kind       TEXT NOT NULL,       -- 'click' | 'fill' | 'navigate' | 'keyboard'
  navigate_mode     TEXT,                -- 'url' | 'refresh' | 'back' | 'forward' | 'new_tab' | null
  tab_id            INTEGER,
  window_id         INTEGER,
  target_ref        TEXT,
  target_selector   TEXT,
  target_frame_id   INTEGER,
  url_requested     TEXT,
  url_before        TEXT,
  url_after         TEXT,
  key_spec          TEXT,
  value_summary     TEXT,                -- JSON redaction record; null unless action_kind='fill'
  status            TEXT NOT NULL,       -- 'success' | 'failed' | 'soft_failure'
  error_code        TEXT,
  pre_snapshot_ref  TEXT,                -- memory://snapshot/<uuid> | null
  args_blob         TEXT,                -- JSON; sensitive fields replaced with '[redacted]'
  result_blob       TEXT,                -- JSON; null for fill (see above)
  captured_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_actions_step_id_idx     ON memory_actions(step_id);
CREATE INDEX IF NOT EXISTS memory_actions_session_id_idx  ON memory_actions(session_id);
CREATE INDEX IF NOT EXISTS memory_actions_action_kind_idx ON memory_actions(action_kind);
CREATE INDEX IF NOT EXISTS memory_actions_captured_at_idx ON memory_actions(captured_at);
`;

/**
 * Stage 3b seed (Sprint 2, B-005): empty Experience tables.
 *
 * Intentionally **no repository class, no INSERT/UPDATE code** in this
 * sprint — the aggregator that populates these tables (reading Memory,
 * writing Experience) is scheduled for Sprint 3+ (B-012). Shipping the
 * schema early means the aggregator can land as a pure writer-side PR
 * without a migration coupled in.
 *
 * Co-located in the same `memory.db` file as Memory: Experience is a
 * derived view of Memory data, and keeping them in one DB simplifies
 * cross-table reads in the aggregator without a JOIN-across-files hack.
 * If we ever need to scale Experience out, the only thing that changes
 * is this constant.
 *
 * Same idempotency rules as Memory: every `CREATE … IF NOT EXISTS`.
 */
export const EXPERIENCE_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS experience_action_paths (
  action_path_id    TEXT PRIMARY KEY,
  page_role         TEXT NOT NULL,
  intent_signature  TEXT NOT NULL,
  step_sequence     TEXT NOT NULL,          -- JSON: ordered [{ toolName, argTemplate }]
  success_count     INTEGER NOT NULL DEFAULT 0,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  last_used_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS experience_action_paths_role_intent_idx
  ON experience_action_paths(page_role, intent_signature);
CREATE INDEX IF NOT EXISTS experience_action_paths_last_used_at_idx
  ON experience_action_paths(last_used_at);

CREATE TABLE IF NOT EXISTS experience_locator_prefs (
  locator_pref_id          TEXT PRIMARY KEY,
  page_role                TEXT NOT NULL,
  element_purpose          TEXT NOT NULL,
  preferred_selector_kind  TEXT NOT NULL,    -- 'role' | 'text' | 'data-testid' | 'css'
  preferred_selector       TEXT NOT NULL,
  hit_count                INTEGER NOT NULL DEFAULT 0,
  last_hit_at              TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS experience_locator_prefs_role_purpose_idx
  ON experience_locator_prefs(page_role, element_purpose);
CREATE INDEX IF NOT EXISTS experience_locator_prefs_last_hit_at_idx
  ON experience_locator_prefs(last_hit_at);
`;
