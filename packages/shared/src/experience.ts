/**
 * MKEP Experience read-side DTOs.
 *
 * These types describe the JSON shapes returned by the native-server's
 * read-only Experience MCP tools (Stage 3b). They live in `@tabrix/shared`
 * so the native-server (canonical emitter) and any future consumer
 * (sidepanel, e2e tests, downstream tooling) read the same contract.
 *
 * Conventions:
 * - All timestamps are ISO-8601 strings in UTC.
 * - `intentSignature` is the normalized bucket key produced by
 *   `normalizeIntentSignature` in the native-server aggregator (B-012).
 *   Never used as a display label.
 * - `historyRef` is a stable cross-table pointer minted by Memory; opaque
 *   to MCP clients.
 * - No field is ever renamed across layers: the server emits the same keys
 *   the client consumes.
 */

import type { MemoryPersistenceMode } from './memory';

/**
 * One step inside a stored Experience action path. Mirrors the
 * `step_sequence` JSON column written by B-012.
 */
export interface ExperienceActionPathStep {
  toolName: string;
  status: string;
  /** First Memory artifact_ref attached to the step, or `null` when none. */
  historyRef: string | null;
}

/**
 * Single Experience action path candidate returned by
 * `experience_suggest_plan`.
 *
 * `successRate` is computed server-side from `successCount` /
 * `(successCount + failureCount)` and clamped to `[0, 1]`. When both
 * counters are zero (only ever true for synthetic/empty rows) the rate
 * is reported as `0` rather than `NaN`.
 */
export interface ExperienceActionPathPlan {
  actionPathId: string;
  pageRole: string;
  intentSignature: string;
  successCount: number;
  failureCount: number;
  successRate: number;
  lastUsedAt?: string;
  steps: ExperienceActionPathStep[];
}

/**
 * Maximum number of plans returnable from `experience_suggest_plan` in a
 * single call. Hard cap; callers asking for more receive this many rows
 * silently (no error).
 *
 * Kept tight intentionally: in v1 the upstream LLM only needs the
 * top-1 candidate and at most a couple of fallbacks, and a wider window
 * just inflates the response payload without changing the planning
 * decision.
 */
export const MAX_EXPERIENCE_SUGGEST_PLAN_LIMIT = 5;

/**
 * Maximum byte/char length of `intent` accepted by the tool. Anything
 * longer is truncated before normalization (no error). Matches the
 * worst-case Memory `tasks.intent` length we expect to see in v1.
 */
export const MAX_EXPERIENCE_SUGGEST_PLAN_INTENT_CHARS = 1024;

/**
 * Maximum length of the optional `pageRole` filter. Short on purpose —
 * `pageRole` is a registered semantic label, not free text.
 */
export const MAX_EXPERIENCE_SUGGEST_PLAN_PAGE_ROLE_CHARS = 128;

/**
 * Validated `experience_suggest_plan` input. Built from raw MCP args by
 * the native-server's `parseExperienceSuggestPlanInput`.
 */
export interface ExperienceSuggestPlanInput {
  /** Raw caller intent, post-trim. Empty string is rejected upstream. */
  intent: string;
  /** Normalized lookup key. Same algorithm as the B-012 aggregator. */
  intentSignature: string;
  /** Optional `pageRole` filter, or `undefined` when not provided. */
  pageRole?: string;
  /** Effective row cap, already clamped to `[1, MAX_EXPERIENCE_SUGGEST_PLAN_LIMIT]`. */
  limit: number;
}

/**
 * `experience_suggest_plan` response body.
 *
 * `status` is `'no_match'` when zero plans were found for the requested
 * `(intentSignature, pageRole?)` bucket. The two top-level booleans the
 * client cares about (`status === 'ok'` vs `status === 'no_match'`) are
 * encoded as a discriminator string so future variants
 * (`'memory_off'`, `'over_limit'`, …) can be added without breaking the
 * field set.
 */
export interface ExperienceSuggestPlanResult {
  status: 'ok' | 'no_match';
  plans: ExperienceActionPathPlan[];
  persistenceMode: MemoryPersistenceMode;
}
