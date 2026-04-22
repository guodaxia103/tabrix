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
  ended_at          TEXT,
  aggregated_at     TEXT
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
 * Stage 3b Experience schema (seeded in B-005, first writer in B-012).
 *
 * Co-located in the same `memory.db` file as Memory: Experience is a
 * derived view of Memory data, and keeping them in one DB keeps
 * projection reads/writes local to one SQLite handle.
 *
 * Same idempotency rules as Memory: every `CREATE … IF NOT EXISTS`.
 */
export const EXPERIENCE_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS experience_action_paths (
  action_path_id    TEXT PRIMARY KEY,
  page_role         TEXT NOT NULL,
  intent_signature  TEXT NOT NULL,
  step_sequence     TEXT NOT NULL,          -- JSON: ordered [{ toolName, status, historyRef }]
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

/**
 * Knowledge schema (B-017, opt-in via TABRIX_POLICY_CAPABILITIES=api_knowledge).
 *
 * `knowledge_api_endpoints` is the storage side of "API Knowledge capture
 * v1": a deduplicated, redaction-only-metadata view of API endpoints that
 * Tabrix has observed traversing the user's browser tabs while a
 * `chrome_network_capture` session was active. It exists to power future
 * "skip the page, ask the API" decisions (B-018+) — never to replay or
 * call user APIs from the agent side.
 *
 * Hard rules baked into the schema:
 *  - `endpoint_signature` is a *normalized* `<METHOD> <host><path-template>`
 *    string; no query string, no path-id leakage. `(site, endpoint_signature)`
 *    is the dedup key (UNIQUE) so re-observing the same endpoint upserts
 *    sample_count + last_seen_at instead of growing unbounded rows.
 *  - `request_summary_blob` / `response_summary_blob` are JSON metadata
 *    only: header *names* (lower-cased), query *keys* (no values), body
 *    *keys* / shape, response content-type / size, and at most a small
 *    deterministic excerpt of the response shape. No raw header values,
 *    no Authorization, no Cookie, no body payloads.
 *  - `source_*` columns are informational pointers back into Memory; they
 *    are nullable on purpose so older rows survive Memory rotation.
 *
 * Idempotent CREATE: same pattern as `MEMORY_CREATE_TABLES_SQL` and
 * `EXPERIENCE_CREATE_TABLES_SQL`. Old DBs that pre-date B-017 simply
 * pick up the new table on next `openMemoryDb()`; no ALTER needed.
 */
export const KNOWLEDGE_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS knowledge_api_endpoints (
  endpoint_id            TEXT PRIMARY KEY,
  site                   TEXT NOT NULL,
  family                 TEXT NOT NULL,
  method                 TEXT NOT NULL,
  url_pattern            TEXT NOT NULL,
  endpoint_signature     TEXT NOT NULL,
  semantic_tag           TEXT,
  status_class           TEXT,
  request_summary_blob   TEXT NOT NULL,
  response_summary_blob  TEXT NOT NULL,
  source_session_id      TEXT,
  source_step_id         TEXT,
  source_history_ref     TEXT,
  sample_count           INTEGER NOT NULL DEFAULT 1,
  first_seen_at          TEXT NOT NULL,
  last_seen_at           TEXT NOT NULL,
  UNIQUE (site, endpoint_signature)
);

CREATE INDEX IF NOT EXISTS knowledge_api_endpoints_site_idx
  ON knowledge_api_endpoints(site);
CREATE INDEX IF NOT EXISTS knowledge_api_endpoints_family_idx
  ON knowledge_api_endpoints(family);
CREATE INDEX IF NOT EXISTS knowledge_api_endpoints_last_seen_at_idx
  ON knowledge_api_endpoints(last_seen_at);
`;

/**
 * V23-04 / B-018 v1.5 telemetry schema for `tabrix_choose_context`.
 *
 * Two tables, both append-only:
 *  - `tabrix_choose_context_decisions` — one row per chooser invocation
 *    that returned `status='ok'`. Captures the resolved bucket
 *    (intent_signature / pageRole / siteFamily) plus the chosen
 *    strategy and fallback. Lets us answer "which strategy did the
 *    chooser pick last week?" without having to replay.
 *  - `tabrix_choose_context_outcomes` — one row per
 *    `tabrix_choose_context_record_outcome` call. Pure write-back.
 *    `decision_id` is a FK back to the decisions table so the
 *    aggregation script can compute reuse/fallback ratios per
 *    strategy.
 *
 * Both tables are gated by the same Memory persistence check the
 * rest of the native server uses; when persistence is `'off'` the
 * tables still exist (idempotent CREATE) but the chooser writer is a
 * no-op so we never silently grow the file in tests.
 *
 * No personally identifying info: `intent_signature` is the same
 * normalized form as B-013 (already pre-redacted), `page_role` is a
 * structural label, `site_family` is the closed B-018 enum. We do NOT
 * store the raw `intent` string to avoid leaking session content into
 * a long-horizon table.
 */
export const CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS tabrix_choose_context_decisions (
  decision_id        TEXT PRIMARY KEY,
  intent_signature   TEXT NOT NULL,
  page_role          TEXT,
  site_family        TEXT,
  strategy           TEXT NOT NULL,
  fallback_strategy  TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tabrix_choose_context_decisions_strategy_idx
  ON tabrix_choose_context_decisions(strategy);
CREATE INDEX IF NOT EXISTS tabrix_choose_context_decisions_created_at_idx
  ON tabrix_choose_context_decisions(created_at);

CREATE TABLE IF NOT EXISTS tabrix_choose_context_outcomes (
  outcome_id    TEXT PRIMARY KEY,
  decision_id   TEXT NOT NULL REFERENCES tabrix_choose_context_decisions(decision_id) ON DELETE CASCADE,
  outcome       TEXT NOT NULL,
  recorded_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tabrix_choose_context_outcomes_decision_id_idx
  ON tabrix_choose_context_outcomes(decision_id);
CREATE INDEX IF NOT EXISTS tabrix_choose_context_outcomes_recorded_at_idx
  ON tabrix_choose_context_outcomes(recorded_at);
`;
