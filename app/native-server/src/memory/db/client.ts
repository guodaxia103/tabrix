/**
 * Memory DB connection factory.
 *
 * Unlike `agent/db/client.ts` which is a process-wide singleton, the
 * Memory DB factory is instance-oriented: `SessionManager` owns its
 * own DB handle. This allows:
 *
 * - Tests to inject `:memory:` for isolation (no cross-test pollution).
 * - Production `sessionManager` singleton to open the default
 *   `~/.chrome-mcp-agent/memory.db` path exactly once.
 *
 * Native binding failures are normalized to `TABRIX_DB_BINDING_MISSING`
 * following the same pattern as `agent/db/client.ts`; callers are
 * expected to catch and fall back to pure in-memory mode.
 */

import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';

import { getTabrixDataDir } from '../../shared/data-dirs';
import {
  CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL,
  EXPERIENCE_CREATE_TABLES_SQL,
  EXPERIENCE_WRITEBACK_WARNINGS_CREATE_TABLES_SQL,
  KNOWLEDGE_CREATE_TABLES_SQL,
  MEMORY_CREATE_TABLES_SQL,
  OPERATION_MEMORY_LOG_CREATE_TABLES_SQL,
} from './schema';

export type SqliteDatabase = Database.Database;

export interface MemoryDbOptions {
  /**
   * SQLite file path. Use ':memory:' for ephemeral in-memory DB
   * (used by tests and by the global singleton under NODE_ENV=test).
   * Defaults to `~/.chrome-mcp-agent/memory.db`.
   */
  dbPath?: string;
}

export function resolveMemoryDbPath(options?: MemoryDbOptions): string {
  if (options?.dbPath !== undefined) {
    return options.dbPath;
  }
  const envPath = process.env.TABRIX_MEMORY_DB_FILE;
  if (envPath && envPath.trim()) {
    return path.resolve(envPath.trim());
  }
  return path.join(getTabrixDataDir(), 'memory.db');
}

const SQLITE_BINDING_ERROR_PATTERNS = [
  'Could not locate the bindings file',
  'better_sqlite3.node',
  'NODE_MODULE_VERSION',
  'was compiled against a different Node.js version',
];

function isSqliteBindingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return SQLITE_BINDING_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export class TabrixMemoryDbBindingError extends Error {
  public readonly code = 'TABRIX_DB_BINDING_MISSING';
  constructor() {
    super(
      [
        'TABRIX_DB_BINDING_MISSING: better-sqlite3 native binding is unavailable.',
        'Reinstall or rebuild native modules, then restart Chrome.',
        'Recommended: npm i -g @tabrix/tabrix@latest --force',
        'If you use pnpm: run pnpm approve-builds and reinstall.',
      ].join(' '),
    );
    this.name = 'TabrixMemoryDbBindingError';
  }
}

let sqliteFactory: ((filename: string) => SqliteDatabase) | null = null;

function getSqliteFactory(): (filename: string) => SqliteDatabase {
  if (sqliteFactory) return sqliteFactory;
  try {
    sqliteFactory = require('better-sqlite3') as (filename: string) => SqliteDatabase;
    return sqliteFactory;
  } catch (error) {
    if (isSqliteBindingError(error)) throw new TabrixMemoryDbBindingError();
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function ensureParentDir(dbPath: string): void {
  if (dbPath === ':memory:') return;
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export interface OpenMemoryDbResult {
  db: SqliteDatabase;
  dbPath: string;
  persistenceMode: 'disk' | 'memory';
}

interface TableInfoRow {
  name: string;
}

interface SqliteMasterNameRow {
  name: string;
}

function hasTable(db: SqliteDatabase, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as SqliteMasterNameRow | undefined;
  return row?.name === table;
}

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.some((row) => row.name === column);
}

function execMigration(
  db: SqliteDatabase,
  args: { table: string; column?: string; sql: string },
): void {
  try {
    db.exec(args.sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `migration failed for table=${args.table}`,
        args.column ? `column=${args.column}` : null,
        `sql=${args.sql}`,
        `cause=${message}`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
}

/**
 * Guarded migration for legacy session aggregation:
 * old DBs created before session aggregation existed lack `memory_sessions.aggregated_at`.
 * SQLite does not support `ADD COLUMN IF NOT EXISTS`, so we probe first.
 */
function ensureSessionAggregatedAtColumn(db: SqliteDatabase): void {
  if (!hasColumn(db, 'memory_sessions', 'aggregated_at')) {
    execMigration(db, {
      table: 'memory_sessions',
      column: 'aggregated_at',
      sql: 'ALTER TABLE memory_sessions ADD COLUMN aggregated_at TEXT',
    });
  }
}

/**
 * Additive migration for legacy DBs that pre-date the
 * replay-outcome write-back columns. Each ALTER is guarded by a
 * `hasColumn` probe so re-opening a fresh DB (where the columns are
 * already present from `EXPERIENCE_CREATE_TABLES_SQL`) is a no-op.
 *
 * Splitting per-column keeps the migration shape uniform with the
 * session aggregation helper above; it also means a partial-failure mid-migration
 * (e.g. disk full between two ALTERs) leaves the DB in a recoverable
 * state — the next `openMemoryDb()` resumes from where it stopped.
 */
function ensureExperienceReplayWritebackColumns(db: SqliteDatabase): void {
  if (!hasTable(db, 'experience_action_paths')) return;
  if (!hasColumn(db, 'experience_action_paths', 'last_replay_at')) {
    execMigration(db, {
      table: 'experience_action_paths',
      column: 'last_replay_at',
      sql: 'ALTER TABLE experience_action_paths ADD COLUMN last_replay_at TEXT',
    });
  }
  if (!hasColumn(db, 'experience_action_paths', 'last_replay_outcome')) {
    execMigration(db, {
      table: 'experience_action_paths',
      column: 'last_replay_outcome',
      sql: 'ALTER TABLE experience_action_paths ADD COLUMN last_replay_outcome TEXT',
    });
  }
  if (!hasColumn(db, 'experience_action_paths', 'last_replay_status')) {
    execMigration(db, {
      table: 'experience_action_paths',
      column: 'last_replay_status',
      sql: 'ALTER TABLE experience_action_paths ADD COLUMN last_replay_status TEXT',
    });
  }
  if (!hasColumn(db, 'experience_action_paths', 'composite_score_decayed')) {
    execMigration(db, {
      table: 'experience_action_paths',
      column: 'composite_score_decayed',
      sql: 'ALTER TABLE experience_action_paths ADD COLUMN composite_score_decayed REAL',
    });
  }
  // Replay scoring partial index — created idempotently so legacy DBs pick it
  // up after the column exists.
  execMigration(db, {
    table: 'experience_action_paths',
    sql: `CREATE INDEX IF NOT EXISTS experience_action_paths_composite_score_idx
       ON experience_action_paths(composite_score_decayed)
       WHERE composite_score_decayed IS NOT NULL`,
  });
  if (!hasColumn(db, 'memory_sessions', 'composite_score_raw')) {
    execMigration(db, {
      table: 'memory_sessions',
      column: 'composite_score_raw',
      sql: 'ALTER TABLE memory_sessions ADD COLUMN composite_score_raw REAL',
    });
  }
  if (!hasColumn(db, 'memory_sessions', 'components_blob')) {
    execMigration(db, {
      table: 'memory_sessions',
      column: 'components_blob',
      sql: 'ALTER TABLE memory_sessions ADD COLUMN components_blob TEXT',
    });
  }
}

/**
 * Additive migration for legacy DBs that pre-date the
 * layer-dispatch telemetry columns on `tabrix_choose_context_decisions`.
 * Each ALTER is guarded by a `hasColumn` probe so a virgin DB (where
 * the columns are already present from `CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL`)
 * is a no-op. Same partial-failure recovery contract as
 * `ensureExperienceReplayWritebackColumns`.
 *
 * Audit reference for ranked-replay fields not yet persisted
 * before this migration:
 *   - `ranked_candidate_count` — top-K size after rank
 *   - `replay_eligible_blocked_by` — comma-joined block reasons
 *   - `replay_fallback_depth` — 0=top-1 reuse, ≥1=ranked fallback
 *
 * `knowledge_endpoint_family` is **telemetry-only**; it MUST NOT
 * drive routing.
 */
/**
 * Additive migration for legacy DBs that pre-date the
 * generic-classifier columns on `knowledge_api_endpoints`. Each
 * ALTER is guarded by a `hasColumn` probe so a virgin DB (where
 * the columns are already present from `KNOWLEDGE_CREATE_TABLES_SQL`)
 * is a no-op. Same partial-failure recovery contract as
 * `ensureChooseContextDecisionLayerColumns`.
 */
function ensureKnowledgeApiEndpointsClassifierColumns(db: SqliteDatabase): void {
  const additions: Array<[string, string]> = [
    ['semantic_type', 'TEXT'],
    ['query_params_shape', 'TEXT'],
    ['response_shape_summary', 'TEXT'],
    ['usable_for_task', 'INTEGER'],
    ['noise_reason', 'TEXT'],
  ];
  for (const [name, type] of additions) {
    if (!hasColumn(db, 'knowledge_api_endpoints', name)) {
      db.exec(`ALTER TABLE knowledge_api_endpoints ADD COLUMN ${name} ${type}`);
    }
  }
}

/**
 * Additive migration for legacy DBs that pre-date Endpoint
 * Knowledge lineage columns on `knowledge_api_endpoints`. Each
 * ALTER is guarded by a `hasColumn` probe so a virgin DB (where the
 * columns are already present from `KNOWLEDGE_CREATE_TABLES_SQL`) is
 * a no-op. Same partial-failure recovery contract as
 * `ensureKnowledgeApiEndpointsClassifierColumns`.
 *
 * Schema-cite: the columns added here mirror the inline
 * docstring inside `KNOWLEDGE_CREATE_TABLES_SQL` 1:1. If the
 * docstring drifts the migration must be updated in the same commit
 * or reads will trip on a missing column.
 */
function ensureKnowledgeApiEndpointsLineageColumns(db: SqliteDatabase): void {
  const additions: Array<[string, string]> = [
    ['endpoint_source', 'TEXT'],
    ['correlation_confidence', 'TEXT'],
    ['correlated_region_id', 'TEXT'],
    ['confidence_reason', 'TEXT'],
    ['retirement_candidate', 'INTEGER'],
    ['source_lineage_blob', 'TEXT'],
    ['schema_version', 'INTEGER'],
    // Additive column for the endpoint evidence contract
    // (`lastFailureReason`). Older DBs have a NULL value
    // and are treated as "no failure evidence on file".
    ['last_failure_reason', 'TEXT'],
  ];
  for (const [name, type] of additions) {
    if (!hasColumn(db, 'knowledge_api_endpoints', name)) {
      db.exec(`ALTER TABLE knowledge_api_endpoints ADD COLUMN ${name} ${type}`);
    }
  }
}

function ensureChooseContextDecisionLayerColumns(db: SqliteDatabase): void {
  const additions: Array<[string, string]> = [
    ['chosen_layer', 'TEXT'],
    ['layer_dispatch_reason', 'TEXT'],
    ['source_route', 'TEXT'],
    ['fallback_cause', 'TEXT'],
    ['token_estimate_chosen', 'INTEGER'],
    ['token_estimate_full_read', 'INTEGER'],
    ['tokens_saved_estimate', 'INTEGER'],
    ['knowledge_endpoint_family', 'TEXT'],
    ['ranked_candidate_count', 'INTEGER'],
    ['replay_eligible_blocked_by', 'TEXT'],
    ['replay_fallback_depth', 'INTEGER'],
    // Honest dispatcher inputs. Same idempotent
    // additive pattern. Legacy DBs from before these inputs pick these
    // columns up on next `openMemoryDb`. Virgin DBs see them from
    // the CREATE in `CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL`.
    ['dispatcher_input_source', 'TEXT'],
    ['fallback_cause_v26', 'TEXT'],
  ];
  for (const [name, type] of additions) {
    if (!hasColumn(db, 'tabrix_choose_context_decisions', name)) {
      db.exec(`ALTER TABLE tabrix_choose_context_decisions ADD COLUMN ${name} ${type}`);
    }
  }
}

/**
 * Open (or create) the Memory DB. Caller owns the returned handle and
 * must call `.close()` when done. Re-throws a
 * `TabrixMemoryDbBindingError` if the native binding is missing.
 */
export function openMemoryDb(options?: MemoryDbOptions): OpenMemoryDbResult {
  const dbPath = resolveMemoryDbPath(options);
  ensureParentDir(dbPath);
  const openSqlite = getSqliteFactory();
  const db = openSqlite(dbPath);

  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  db.exec(MEMORY_CREATE_TABLES_SQL);
  db.exec(OPERATION_MEMORY_LOG_CREATE_TABLES_SQL);
  ensureSessionAggregatedAtColumn(db);
  // Legacy DBs may already have `experience_action_paths` without the
  // replay scoring columns. Add them before running the current schema,
  // because the schema includes an index on `composite_score_decayed`.
  ensureExperienceReplayWritebackColumns(db);
  db.exec(EXPERIENCE_CREATE_TABLES_SQL);
  // Legacy-DB additive migration for replay-outcome write-back
  // columns. Runs after `EXPERIENCE_CREATE_TABLES_SQL` so a virgin DB
  // sees the columns from the CREATE statement and the helper is a
  // pure no-op; legacy DBs pick up the columns via the guarded ALTERs.
  ensureExperienceReplayWritebackColumns(db);
  // Knowledge tables. Idempotent CREATE IF NOT EXISTS — same
  // contract as Memory / Experience. The table exists regardless of
  // capability state so writes from a freshly-enabled capability do
  // not race a missing table; gating happens at the writer.
  db.exec(KNOWLEDGE_CREATE_TABLES_SQL);
  // Legacy-DB additive migration for the generic
  // network-observe classifier columns. Runs after the CREATE so
  // virgin DBs see the columns from the CREATE statement and the
  // helper is a pure no-op; legacy DBs from before the classifier columns pick
  // up the columns via the guarded ALTERs.
  ensureKnowledgeApiEndpointsClassifierColumns(db);
  // Legacy-DB additive migration for Endpoint Knowledge
  // lineage columns (endpoint_source / correlation_confidence /
  // correlated_region_id / confidence_reason / retirement_candidate /
  // source_lineage_blob / schema_version). Same idempotent guarded-
  // ALTER contract as the classifier helper above.
  ensureKnowledgeApiEndpointsLineageColumns(db);
  // Telemetry tables for the chooser. Same idempotent
  // CREATE IF NOT EXISTS pattern; old DBs from before the telemetry tables pick up the
  // tables on next open without a migration. Writers respect the same
  // Memory persistence gate the rest of the native server uses, so a DB
  // running with persistence='off' will not accumulate telemetry rows.
  db.exec(CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL);
  // Legacy-DB additive migration for layer-dispatch telemetry
  // columns. Runs after the CHOOSE_CONTEXT CREATE so virgin DBs see
  // the columns from the CREATE statement and the helper is a pure
  // no-op; legacy DBs pick up the columns via the guarded ALTERs.
  ensureChooseContextDecisionLayerColumns(db);
  // Isolation telemetry table. Same idempotent CREATE IF NOT
  // EXISTS pattern. Lives outside `EXPERIENCE_CREATE_TABLES_SQL` so
  // the legacy-migration probe order stays stable (Experience first,
  // then warnings — a warning row that references `action_path_id`
  // is meaningful even if the FK target row was never created).
  db.exec(EXPERIENCE_WRITEBACK_WARNINGS_CREATE_TABLES_SQL);

  return {
    db,
    dbPath,
    persistenceMode: dbPath === ':memory:' ? 'memory' : 'disk',
  };
}
