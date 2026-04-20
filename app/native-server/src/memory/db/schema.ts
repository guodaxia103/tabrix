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
`;
