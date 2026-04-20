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
 * Neutral noise patterns — site-agnostic signals that a label is low-value.
 * Per SoT `T5.4 高价值对象提取 正式产品级规格`, section "明确的低价值对象降权规则":
 *   - commit hash / commit headlines
 *   - duration / timing wording (e.g. `15s`, `3m`, `2h`)
 *   - commitlint prefixes (`fix(...)`, `feat(...)`, ...)
 *
 * Family-specific noise (watch/star/pin, "Search or jump to...",
 * "Open Copilot...", "Skip to content", footer links) belongs in family
 * adapters via `scorePrior` so core stays neutral.
 */
const NEUTRAL_NOISE_PATTERNS: Array<{ pattern: RegExp; delta: number; label: string }> = [
  { pattern: /\b[0-9a-f]{7,40}\b/i, delta: -0.5, label: 'commit_hash' },
  { pattern: /^\d+[smhd]$/i, delta: -0.45, label: 'duration_timing' },
  { pattern: /^commit\b/i, delta: -0.35, label: 'commit_prefix' },
  {
    pattern: /^(fix|feat|docs|chore|refactor|test|build|ci|perf)\s*\(/i,
    delta: -0.35,
    label: 'commitlint_prefix',
  },
];

function formatDelta(delta: number): string {
  return delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
}

function alignsWithTaskMode(
  objectType: ReadPageObjectType,
  taskMode: ReadPageTaskMode | null,
): boolean {
  if (!taskMode) return false;
  switch (taskMode) {
    case 'search':
      return objectType === 'control' || objectType === 'record';
    case 'extract':
      return objectType === 'record' || objectType === 'doc_block';
    case 'monitor':
      return objectType === 'status_item' || objectType === 'metric_card';
    case 'compare':
      return objectType === 'record' || objectType === 'entry';
    case 'read':
      return objectType === 'nav_entry' || objectType === 'entry' || objectType === 'doc_block';
    default:
      return false;
  }
}

/**
 * T5.4.3: importance + confidence scoring.
 *
 * `importance` is the task-relevance weight in `[0, 1]`. It starts at 0.5 and
 * receives signed contributions from:
 *   - origin (page_role_seed > candidate_action > others)
 *   - primaryRegion alignment
 *   - family classifier match (pageRole-specific)
 *   - taskMode alignment with objectType
 *   - neutral noise penalties (commit hash / duration / commitlint)
 *   - family `scorePrior` (e.g. watch/star/pin, "Search or jump to...")
 *
 * `confidence` is the recognition confidence in `[0, 1]` and reflects how
 * sure we are the classified type is correct, not how important the label is.
 *
 * `scoringReasons` records every non-zero contribution for explainability.
 */
export function scoreCandidateObject(
  classified: ClassifiedCandidateObject,
  context: ObjectLayerContext,
  adapters: readonly ObjectLayerFamilyAdapter[] = [],
): ScoredCandidateObject {
  const reasons: string[] = ['base=0.50'];
  let importance = 0.5;
  let confidence: number;

  if (classified.origin === 'page_role_seed') {
    confidence = 0.85;
    importance += 0.08;
    reasons.push('+0.08 origin=page_role_seed');
  } else if (classified.origin === 'candidate_action') {
    const raw = classified.rawConfidence;
    confidence = typeof raw === 'number' && raw > 0 ? Math.max(0.5, Math.min(1, raw)) : 0.6;
    importance += 0.05;
    reasons.push('+0.05 actionability=candidate_action');
  } else {
    confidence = classified.role ? 0.7 : 0.5;
  }

  if (classified.region && classified.region === context.primaryRegion) {
    importance += 0.1;
    reasons.push('+0.10 region matches primaryRegion');
  } else if (classified.region && !context.primaryRegion) {
    importance += 0.03;
    reasons.push('+0.03 region present, primaryRegion unknown');
  }

  const familyClassified = classified.classificationReasons.some(
    (reason) => reason.includes('pageRole=') && reason.includes('matched'),
  );
  if (familyClassified) {
    importance += 0.1;
    reasons.push('+0.10 family classifier matched');
  }

  if (alignsWithTaskMode(classified.objectType, context.taskMode)) {
    importance += 0.06;
    reasons.push(
      `+0.06 objectType=${classified.objectType} aligns with taskMode=${context.taskMode}`,
    );
  }

  if (classified.actions && classified.actions.length > 0) {
    importance += 0.02;
    reasons.push('+0.02 has executable actions');
  }

  for (const noise of NEUTRAL_NOISE_PATTERNS) {
    if (noise.pattern.test(classified.label)) {
      importance += noise.delta;
      confidence = Math.max(0, confidence - 0.15);
      reasons.push(`${formatDelta(noise.delta)} noise=${noise.label}`);
    }
  }

  if (classified.label.length > 96) {
    importance -= 0.1;
    reasons.push('-0.10 label_too_long');
  }

  for (const adapter of adapters) {
    if (!adapter.owns(context.pageRole)) continue;
    const prior = adapter.scorePrior?.(classified, context);
    if (prior) {
      importance += prior.delta;
      for (const r of prior.reasons) reasons.push(r);
      if (prior.delta < 0) {
        confidence = Math.max(0, confidence - 0.1);
      }
    }
  }

  importance = Math.max(0, Math.min(1, importance));
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    ...classified,
    importance,
    confidence,
    scoringReasons: reasons,
  };
}
