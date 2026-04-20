import type { PageRole } from './read-page-understanding-core';

/**
 * T5.4.0 Object Layer — Neutral Core
 *
 * This module defines family-agnostic types and helpers for the high-value
 * object / L0 prior system. It MUST NOT contain any site-specific vocabulary
 * or page-role literals. Family-specific priors live in sibling
 * `read-page-high-value-objects-<family>.ts` modules behind the
 * `PageObjectFamilyAdapter` contract.
 *
 * Scope:
 *  - Defines shape of per-role priority rules and task seeds.
 *  - Provides a neutral dispatcher that iterates registered family adapters.
 *  - Provides a neutral scoring helper for pattern-based label priors.
 *
 * Non-scope (stays in task protocol):
 *  - Generic task mode inference (search/monitor/compare/extract).
 *  - Length/commit/SHA noise penalties that are not family-specific.
 *  - L0/L1/L2 assembly and output shape.
 */

export interface HighValueObjectPriorityRule {
  primary: RegExp[];
  secondary?: RegExp[];
  tertiary?: RegExp[];
  deprioritize?: RegExp[];
  l0Prefix?: string;
}

export interface HighValueObjectSeed {
  labels: string[];
  reason: string;
}

export interface PageObjectPriors {
  priorityRule: HighValueObjectPriorityRule | null;
  seed: HighValueObjectSeed | null;
  l0Prefix: string | null;
}

export interface PageObjectFamilyAdapter {
  family: string;
  resolve(pageRole: PageRole): PageObjectPriors | null;
}

const EMPTY_PRIORS: PageObjectPriors = {
  priorityRule: null,
  seed: null,
  l0Prefix: null,
};

export function resolvePageObjectPriors(
  adapters: readonly PageObjectFamilyAdapter[],
  pageRole: PageRole,
): PageObjectPriors {
  for (const adapter of adapters) {
    const priors = adapter.resolve(pageRole);
    if (priors) {
      return priors;
    }
  }
  return EMPTY_PRIORS;
}

export function applyPriorityRuleMatch(
  rule: HighValueObjectPriorityRule | null,
  normalizedLabel: string,
): number {
  if (!rule) return 0;
  let score = 0;
  rule.primary.forEach((pattern, index) => {
    if (pattern.test(normalizedLabel)) {
      score += 320 - index * 24;
    }
  });
  rule.secondary?.forEach((pattern, index) => {
    if (pattern.test(normalizedLabel)) {
      score += 180 - index * 18;
    }
  });
  rule.tertiary?.forEach((pattern, index) => {
    if (pattern.test(normalizedLabel)) {
      score += 90 - index * 12;
    }
  });
  rule.deprioritize?.forEach((pattern, index) => {
    if (pattern.test(normalizedLabel)) {
      score -= 140 - index * 10;
    }
  });
  return score;
}
