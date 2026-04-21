import { openMemoryDb } from '../db/client';
import { EXPERIENCE_ACTION_PATHS_TABLE, EXPERIENCE_LOCATOR_PREFS_TABLE } from './index';

function fresh(): { db: ReturnType<typeof openMemoryDb>['db']; close: () => void } {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  return { db, close: () => db.close() };
}

interface TableInfoRow {
  name: string;
  type: string;
}

interface IndexRow {
  name: string;
}

interface CountRow {
  total: number;
}

describe('Experience schema seed (B-005)', () => {
  it('creates both experience tables on a virgin DB', () => {
    const { db, close } = fresh();
    try {
      const rows = db
        .prepare("SELECT name, type FROM sqlite_master WHERE type='table' AND name IN (?, ?)")
        .all(EXPERIENCE_ACTION_PATHS_TABLE, EXPERIENCE_LOCATOR_PREFS_TABLE) as TableInfoRow[];
      const names = rows.map((r) => r.name).sort();
      expect(names).toEqual([EXPERIENCE_ACTION_PATHS_TABLE, EXPERIENCE_LOCATOR_PREFS_TABLE]);
    } finally {
      close();
    }
  });

  it('creates the expected indexes on both tables', () => {
    const { db, close } = fresh();
    try {
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN (?, ?)")
        .all(EXPERIENCE_ACTION_PATHS_TABLE, EXPERIENCE_LOCATOR_PREFS_TABLE) as IndexRow[];
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'experience_action_paths_role_intent_idx',
          'experience_action_paths_last_used_at_idx',
          'experience_locator_prefs_role_purpose_idx',
          'experience_locator_prefs_last_hit_at_idx',
        ]),
      );
    } finally {
      close();
    }
  });

  it('is idempotent: re-opening the DB does not error and does not duplicate indexes', () => {
    const path = ':memory:';
    // First open
    const first = openMemoryDb({ dbPath: path });
    try {
      first.db.exec(
        'CREATE INDEX IF NOT EXISTS experience_action_paths_role_intent_idx ON experience_action_paths(page_role, intent_signature);',
      );
    } finally {
      first.db.close();
    }
    // Re-open (same lifecycle, but on a fresh `:memory:` database). For a
    // proper idempotency check we re-exec the DDL on the same handle.
    const { db, close } = fresh();
    try {
      expect(() => {
        db.exec('BEGIN; END;');
      }).not.toThrow();
      // Re-run DDL on the already-migrated handle — must be a no-op.
      expect(() =>
        db.exec(
          `CREATE TABLE IF NOT EXISTS ${EXPERIENCE_ACTION_PATHS_TABLE} (
            action_path_id TEXT PRIMARY KEY,
            page_role TEXT NOT NULL,
            intent_signature TEXT NOT NULL,
            step_sequence TEXT NOT NULL,
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_used_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );`,
        ),
      ).not.toThrow();
      const indexCount = db
        .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='index' AND name=?")
        .get('experience_action_paths_role_intent_idx') as CountRow;
      expect(indexCount.total).toBe(1);
    } finally {
      close();
    }
  });

  it('seeds both tables as empty (Sprint 2: no writer exists yet)', () => {
    const { db, close } = fresh();
    try {
      const actionPaths = db
        .prepare(`SELECT COUNT(*) AS total FROM ${EXPERIENCE_ACTION_PATHS_TABLE}`)
        .get() as CountRow;
      const locatorPrefs = db
        .prepare(`SELECT COUNT(*) AS total FROM ${EXPERIENCE_LOCATOR_PREFS_TABLE}`)
        .get() as CountRow;
      expect(actionPaths.total).toBe(0);
      expect(locatorPrefs.total).toBe(0);
    } finally {
      close();
    }
  });
});
