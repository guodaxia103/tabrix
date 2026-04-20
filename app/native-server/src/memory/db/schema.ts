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
`;
