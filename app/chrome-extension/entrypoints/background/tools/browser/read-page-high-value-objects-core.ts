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
 * T5.4.2: neutral candidate collection.
 *
 * Three sources in order:
 *   1. `candidateActions` (labelled via matching interactive element / aria).
 *   2. `interactiveElements` not already covered by a candidate action.
 *   3. `adapters[].collectExtraCandidates(context)` for family-specific seeds
 *      when the adapter owns the current pageRole.
 *
 * Deduplication keys on candidate id and interactive ref. Empty labels are
 * dropped.
 *
 * The function itself is family-agnostic: no site-specific vocabulary or
 * role-literal lookups live here. All family-specific behaviour comes from
 * the adapters.
 */
export function collectCandidateObjects(
  context: ObjectLayerContext,
  inputs: CollectInputs,
  adapters: readonly ObjectLayerFamilyAdapter[] = [],
): CandidateObject[] {
  const byRef = new Map<string, ReadPageInteractiveElement>();
  for (const element of inputs.interactiveElements) {
    if (element?.ref) byRef.set(element.ref, element);
  }

  const candidates: CandidateObject[] = [];
  const seenIds = new Set<string>();
  const seenRefs = new Set<string>();

  for (const action of inputs.candidateActions) {
    const target = action.targetRef ? byRef.get(action.targetRef) : undefined;
    const ariaLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
    const label = String(target?.name || ariaLabel || action.targetRef || action.id).trim();
    if (!label) continue;
    const id = `hvo_${action.id}`;
    if (seenIds.has(id)) continue;
    const actions: ReadPageHighValueObjectAction[] | undefined = action.targetRef
      ? [
          {
            type: action.actionType === 'fill' ? 'fill' : 'click',
            ref: action.targetRef,
            actionType: action.actionType,
          },
        ]
      : undefined;
    candidates.push({
      id,
      label,
      ref: action.targetRef || undefined,
      role: target?.role,
      actionType: action.actionType,
      sourceKind: 'dom_semantic',
      origin: 'candidate_action',
      provenance: { candidateActionId: action.id },
      actions,
      rawConfidence: action.confidence,
      matchReason: action.matchReason,
    });
    seenIds.add(id);
    if (action.targetRef) seenRefs.add(action.targetRef);
  }

  for (const element of inputs.interactiveElements) {
    if (!element?.ref || seenRefs.has(element.ref)) continue;
    const label = String(element.name || element.role || element.ref).trim();
    if (!label) continue;
    const id = `hvo_ref_${element.ref.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    if (seenIds.has(id)) continue;
    candidates.push({
      id,
      label,
      ref: element.ref,
      role: element.role,
      sourceKind: 'dom_semantic',
      origin: 'interactive_element',
      provenance: { interactiveRef: element.ref },
      actions: [{ type: 'click', ref: element.ref }],
    });
    seenIds.add(id);
    seenRefs.add(element.ref);
  }

  for (const adapter of adapters) {
    if (!adapter.owns(context.pageRole)) continue;
    const extras = adapter.collectExtraCandidates?.(context) ?? [];
    for (const extra of extras) {
      if (!extra?.label || seenIds.has(extra.id)) continue;
      candidates.push(extra);
      seenIds.add(extra.id);
      if (extra.ref) seenRefs.add(extra.ref);
    }
  }

  return candidates;
}

/**
 * T5.4.2: neutral classification.
 *
 * Ask each owning adapter first — a family adapter may return `null` to
 * defer to the neutral fallback. The neutral fallback keys off generic ARIA
 * role names (`button`, `textbox`, ...) and the candidate origin so it
 * contains no site-specific vocabulary.
 */
export function classifyCandidateObject(
  candidate: CandidateObject,
  context: ObjectLayerContext,
  adapters: readonly ObjectLayerFamilyAdapter[] = [],
): ClassifiedCandidateObject {
  for (const adapter of adapters) {
    if (!adapter.owns(context.pageRole)) continue;
    const classified = adapter.classify?.(candidate, context);
    if (classified) return classified;
  }

  const role = (candidate.role || '').toLowerCase();
  let objectType: ReadPageObjectType = 'entry';
  let reason = 'neutral role-based classification';

  if (['button', 'textbox', 'searchbox', 'combobox', 'switch', 'checkbox'].includes(role)) {
    objectType = 'control';
  } else if (role === 'tab' || role === 'menuitem') {
    objectType = 'nav_entry';
  } else if (role === 'link') {
    objectType = 'entry';
  } else if (candidate.origin === 'candidate_action') {
    objectType = 'control';
    reason = 'neutral origin-based classification (candidate_action)';
  }

  return {
    ...candidate,
    objectType,
    region: context.primaryRegion,
    classificationReasons: [reason],
  };
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
