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
  KNOWLEDGE_CREATE_TABLES_SQL,
  MEMORY_CREATE_TABLES_SQL,
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

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.some((row) => row.name === column);
}

/**
 * Guarded migration for B-012:
 * old DBs created before Sprint 3 lack `memory_sessions.aggregated_at`.
 * SQLite does not support `ADD COLUMN IF NOT EXISTS`, so we probe first.
 */
function ensureSessionAggregatedAtColumn(db: SqliteDatabase): void {
  if (!hasColumn(db, 'memory_sessions', 'aggregated_at')) {
    db.exec('ALTER TABLE memory_sessions ADD COLUMN aggregated_at TEXT');
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
  ensureSessionAggregatedAtColumn(db);
  db.exec(EXPERIENCE_CREATE_TABLES_SQL);
  // B-017: Knowledge tables. Idempotent CREATE IF NOT EXISTS — same
  // contract as Memory / Experience. The table exists regardless of
  // capability state so writes from a freshly-enabled capability do
  // not race a missing table; gating happens at the writer.
  db.exec(KNOWLEDGE_CREATE_TABLES_SQL);
  // V23-04 / B-018 v1.5: Telemetry tables for the chooser. Same idempotent
  // CREATE IF NOT EXISTS pattern; old DBs from before V23-04 pick up the
  // tables on next open without a migration. Writers respect the same
  // Memory persistence gate the rest of the native server uses, so a DB
  // running with persistence='off' will not accumulate telemetry rows.
  db.exec(CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL);

  return {
    db,
    dbPath,
    persistenceMode: dbPath === ':memory:' ? 'memory' : 'disk',
  };
}
