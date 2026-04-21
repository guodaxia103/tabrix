/**
 * Stage 3b Experience layer — seed surface (Sprint 2, B-005).
 *
 * At this sprint the Experience layer is **schema-only**: tables exist
 * in the same `memory.db` (see `EXPERIENCE_CREATE_TABLES_SQL` in
 * `../db/schema.ts`), but no repository class writes to them yet. The
 * aggregator that reads Memory and writes Experience is scheduled for
 * Sprint 3+ (B-012).
 *
 * Everything exported here is a **name constant**, so that the future
 * aggregator / reader PRs have a single source of truth for the table
 * names and cannot drift from the SQL DDL.
 */

export const EXPERIENCE_ACTION_PATHS_TABLE = 'experience_action_paths';
export const EXPERIENCE_LOCATOR_PREFS_TABLE = 'experience_locator_prefs';

export const EXPERIENCE_SELECTOR_KINDS = ['role', 'text', 'data-testid', 'css'] as const;
export type ExperienceSelectorKind = (typeof EXPERIENCE_SELECTOR_KINDS)[number];
