/**
 * `experience_suggest_plan` MCP tool — pure input/output helpers.
 *
 * Lives next to the aggregator on purpose: the read-side and the
 * write-side share `normalizeIntentSignature` so a `(pageRole, intent)`
 * pair always lands in the same bucket whether it was just observed or
 * is being looked up.
 *
 * Everything in this module is side-effect-free. The IO layer
 * (`ExperienceQueryService`) is a thin wrapper that calls
 * `parseExperienceSuggestPlanInput` → `ExperienceRepository.suggestActionPaths`
 * → `buildSuggestPlanResult`.
 */

import {
  MAX_EXPERIENCE_SUGGEST_PLAN_INTENT_CHARS,
  MAX_EXPERIENCE_SUGGEST_PLAN_LIMIT,
  MAX_EXPERIENCE_SUGGEST_PLAN_PAGE_ROLE_CHARS,
  type ExperienceActionPathPlan,
  type ExperienceSuggestPlanInput,
  type ExperienceSuggestPlanResult,
  type MemoryPersistenceMode,
} from '@tabrix/shared';
import { normalizeIntentSignature } from './experience-aggregator';
import type { ExperienceActionPathRow } from './experience-repository';

export class ExperienceSuggestPlanInputError extends Error {
  public readonly code: 'TABRIX_EXPERIENCE_SUGGEST_PLAN_BAD_INPUT';
  constructor(message: string) {
    super(message);
    this.code = 'TABRIX_EXPERIENCE_SUGGEST_PLAN_BAD_INPUT';
    this.name = 'ExperienceSuggestPlanInputError';
  }
}

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ExperienceSuggestPlanInputError(`'${key}' must be a string`);
  }
  return value;
}

function readInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExperienceSuggestPlanInputError(`'${key}' must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new ExperienceSuggestPlanInputError(`'${key}' must be an integer`);
  }
  return value;
}

/**
 * Parse and validate the public MCP arguments for `experience_suggest_plan`.
 *
 * - `intent`: required, non-empty after trim. Truncated to
 *   `MAX_EXPERIENCE_SUGGEST_PLAN_INTENT_CHARS` BEFORE normalization so
 *   long inputs do not silently slip into a different bucket than the
 *   aggregator would see.
 * - `pageRole`: optional. Trimmed; empty-after-trim is treated as
 *   "filter not requested" (caller may pass `''` from a UI).
 * - `limit`: optional, defaults to 1. Clamped to
 *   `[1, MAX_EXPERIENCE_SUGGEST_PLAN_LIMIT]`. Non-integers / NaN raise.
 *
 * Throws `ExperienceSuggestPlanInputError` for typed-but-invalid inputs;
 * the MCP handler converts that into a structured error result.
 */
export function parseExperienceSuggestPlanInput(rawArgs: unknown): ExperienceSuggestPlanInput {
  if (rawArgs === null || rawArgs === undefined) {
    throw new ExperienceSuggestPlanInputError('missing arguments object');
  }
  if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new ExperienceSuggestPlanInputError('arguments must be an object');
  }
  const args = rawArgs as Record<string, unknown>;

  const rawIntent = readString(args, 'intent');
  if (rawIntent === undefined) {
    throw new ExperienceSuggestPlanInputError("'intent' is required");
  }
  const trimmedIntent = rawIntent.trim();
  if (trimmedIntent.length === 0) {
    throw new ExperienceSuggestPlanInputError("'intent' must be a non-empty string");
  }
  // Truncate before normalization so the bucket stays identical to what
  // the aggregator wrote from `memory_tasks.intent`.
  const cappedIntent = trimmedIntent.slice(0, MAX_EXPERIENCE_SUGGEST_PLAN_INTENT_CHARS);
  const intentSignature = normalizeIntentSignature(cappedIntent);
  if (intentSignature.length === 0) {
    throw new ExperienceSuggestPlanInputError("'intent' normalized to an empty signature");
  }

  const rawPageRole = readString(args, 'pageRole');
  let pageRole: string | undefined;
  if (rawPageRole !== undefined) {
    const trimmedRole = rawPageRole.trim();
    if (trimmedRole.length > MAX_EXPERIENCE_SUGGEST_PLAN_PAGE_ROLE_CHARS) {
      throw new ExperienceSuggestPlanInputError(
        `'pageRole' exceeds ${MAX_EXPERIENCE_SUGGEST_PLAN_PAGE_ROLE_CHARS} chars`,
      );
    }
    if (trimmedRole.length > 0) {
      pageRole = trimmedRole;
    }
  }

  const rawLimit = readInteger(args, 'limit');
  const limit =
    rawLimit === undefined ? 1 : Math.min(MAX_EXPERIENCE_SUGGEST_PLAN_LIMIT, Math.max(1, rawLimit));

  return {
    intent: cappedIntent,
    intentSignature,
    pageRole,
    limit,
  };
}

function computeSuccessRate(successCount: number, failureCount: number): number {
  const total = successCount + failureCount;
  if (total <= 0) return 0;
  return successCount / total;
}

function rowToPlan(row: ExperienceActionPathRow): ExperienceActionPathPlan {
  return {
    actionPathId: row.actionPathId,
    pageRole: row.pageRole,
    intentSignature: row.intentSignature,
    successCount: row.successCount,
    failureCount: row.failureCount,
    successRate: computeSuccessRate(row.successCount, row.failureCount),
    lastUsedAt: row.lastUsedAt,
    steps: row.stepSequence.map((step) => ({
      toolName: step.toolName,
      status: step.status,
      historyRef: step.historyRef,
    })),
  };
}

/**
 * Pure projection: rows → `ExperienceSuggestPlanResult`. Unit-tested
 * directly. Empty `rows` always yields `status: 'no_match'`.
 */
export function buildSuggestPlanResult(
  rows: ExperienceActionPathRow[],
  persistenceMode: MemoryPersistenceMode,
): ExperienceSuggestPlanResult {
  const plans = rows.map(rowToPlan);
  return {
    status: plans.length > 0 ? 'ok' : 'no_match',
    plans,
    persistenceMode,
  };
}
