import type {
  ReadPageCandidateAction,
  ReadPageHighValueObjectAction,
  ReadPageInteractiveElement,
  ReadPageObjectType,
  ReadPageSourceKind,
  ReadPageTaskMode,
} from '@tabrix/shared';
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

/* -------------------------------------------------------------------------- */
/* T5.4 four-layer object pipeline — neutral types                             */
/* -------------------------------------------------------------------------- */

/**
 * Layer 1 output: raw candidate before classification or scoring. Origin
 * captures where the candidate came from (interactive / candidate action /
 * family seed) so later layers can adjust weights.
 */
export interface CandidateObject {
  id: string;
  label: string;
  ref?: string;
  role?: string;
  actionType?: string;
  sourceKind: ReadPageSourceKind;
  origin: 'candidate_action' | 'interactive_element' | 'page_role_seed';
  provenance?: {
    candidateActionId?: string;
    interactiveRef?: string;
    seedPageRole?: string;
    seedIndex?: number;
  };
  actions?: ReadPageHighValueObjectAction[];
  rawConfidence?: number;
  matchReason?: string;
}

/** Layer 2 output: classified candidate with a semantic objectType. */
export interface ClassifiedCandidateObject extends CandidateObject {
  objectType: ReadPageObjectType;
  region: string | null;
  classificationReasons: string[];
}

/** Layer 3 output: scored candidate with importance (0..1) and confidence (0..1). */
export interface ScoredCandidateObject extends ClassifiedCandidateObject {
  importance: number;
  confidence: number;
  scoringReasons: string[];
}

/**
 * Neutral context threaded through all four layers. Family-specific signals
 * stay inside `priors` (resolved from the `PageObjectFamilyAdapter`) or inside
 * the per-family overrides supplied via `ObjectLayerFamilyAdapter`.
 */
export interface ObjectLayerContext {
  pageRole: PageRole;
  primaryRegion: string | null;
  taskMode: ReadPageTaskMode | null;
  currentUrl: string;
  priors: PageObjectPriors;
}

export interface CollectInputs {
  interactiveElements: readonly ReadPageInteractiveElement[];
  candidateActions: readonly ReadPageCandidateAction[];
}

/**
 * Family-aware hooks that extend the neutral four-layer pipeline. A family
 * adapter may contribute extra candidates (e.g. role seeds), override the
 * classifier, and/or add a prior boost during scoring.
 *
 * `owns(pageRole)` decides whether this adapter participates at all.
 */
export interface ObjectLayerFamilyAdapter {
  family: string;
  owns(pageRole: PageRole): boolean;
  collectExtraCandidates?: (context: ObjectLayerContext) => CandidateObject[];
  classify?: (
    candidate: CandidateObject,
    context: ObjectLayerContext,
  ) => ClassifiedCandidateObject | null;
  scorePrior?: (
    candidate: ClassifiedCandidateObject,
    context: ObjectLayerContext,
  ) => { delta: number; reasons: string[] };
}

/**
 * T5.4.1 stub. Real candidate collection lands in T5.4.2.
 * Returns an empty list today so any premature wiring produces "no objects"
 * rather than stale data.
 */
export function collectCandidateObjects(
  _context: ObjectLayerContext,
  _inputs: CollectInputs,
  _adapters: readonly ObjectLayerFamilyAdapter[] = [],
): CandidateObject[] {
  return [];
}

/**
 * T5.4.1 stub. Real classification lands in T5.4.2. Throws to ensure callers
 * do not accidentally rely on the stub shape.
 */
export function classifyCandidateObject(
  _candidate: CandidateObject,
  _context: ObjectLayerContext,
  _adapters: readonly ObjectLayerFamilyAdapter[] = [],
): ClassifiedCandidateObject {
  throw new Error('classifyCandidateObject is not yet implemented (pending T5.4.2)');
}

/**
 * T5.4.1 stub. Real scoring lands in T5.4.3. Throws to ensure callers do not
 * silently observe importance=0.
 */
export function scoreCandidateObject(
  _classified: ClassifiedCandidateObject,
  _context: ObjectLayerContext,
  _adapters: readonly ObjectLayerFamilyAdapter[] = [],
): ScoredCandidateObject {
  throw new Error('scoreCandidateObject is not yet implemented (pending T5.4.3)');
}
