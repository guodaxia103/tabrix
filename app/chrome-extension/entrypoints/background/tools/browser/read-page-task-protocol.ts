import type {
  ReadPageArtifactRef,
  ReadPageCandidateAction,
  ReadPageComplexityLevel,
  ReadPageHighValueObject,
  ReadPageInteractiveElement,
  ReadPagePageContext,
  ReadPageSourceKind,
  ReadPageTaskLevel0,
  ReadPageTaskLevel1,
  ReadPageTaskLevel2,
  ReadPageTaskMode,
} from '@tabrix/shared';
import type {
  CollectInputs,
  ObjectLayerContext,
  ObjectLayerFamilyAdapter,
  PageObjectFamilyAdapter,
  PageObjectPriors,
  ScoredCandidateObject,
} from './read-page-high-value-objects-core';
import {
  classifyCandidateObject,
  collectCandidateObjects,
  resolvePageObjectPriors,
  scoreCandidateObject,
} from './read-page-high-value-objects-core';
import type { PageRole } from './read-page-understanding-core';
import {
  githubHighValueObjectAdapter,
  githubObjectLayerAdapter,
} from './read-page-high-value-objects-github';
import { annotateStableTargetRefs } from './stable-target-ref';

interface TaskProtocolParams {
  mode: 'compact' | 'normal' | 'full';
  currentUrl: string;
  currentTitle: string;
  pageType: string;
  pageRole: string;
  primaryRegion: string | null;
  interactiveElements: ReadPageInteractiveElement[];
  candidateActions: ReadPageCandidateAction[];
  artifactRefs: ReadPageArtifactRef[];
  pageContext: ReadPagePageContext;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
}

interface TaskProtocolResult {
  taskMode: ReadPageTaskMode;
  complexityLevel: ReadPageComplexityLevel;
  sourceKind: ReadPageSourceKind;
  highValueObjects: ReadPageHighValueObject[];
  L0: ReadPageTaskLevel0;
  L1: ReadPageTaskLevel1;
  L2: ReadPageTaskLevel2;
}

const COMPARE_HINT_PATTERN = /\b(compare|diff|review changes)\b/i;
const EXTRACT_HINT_PATTERN = /\b(export|download|copy|artifact|csv|json)\b/i;
const MONITOR_HINT_PATTERN = /\b(summary|jobs?|logs?|annotations?|workflow run|runs?)\b/i;
const SEARCH_HINT_PATTERN =
  /\b(search(?: issues?)?|filter(?: issues?)?|find|labels?|milestone|assignee|query|new issue|issue entries)\b/i;
const COMMIT_SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;

type RankedTaskMode = Exclude<ReadPageTaskMode, 'read'>;

interface TaskModeSignalContext {
  url: string;
  title: string;
  pageRole: string;
  primaryRegion: string;
  signalText: string[];
  highValueText: string[];
}

const PAGE_OBJECT_FAMILY_ADAPTERS: readonly PageObjectFamilyAdapter[] = [
  githubHighValueObjectAdapter,
];

/**
 * T5.4.4: four-layer object pipeline adapters. The task protocol only calls
 * the neutral `collectCandidateObjects` / `classifyCandidateObject` /
 * `scoreCandidateObject` helpers and hands these family adapters in so that
 * family-specific seeds, classification rules, and prior boosts stay out of
 * the protocol layer.
 */
const OBJECT_LAYER_ADAPTERS: readonly ObjectLayerFamilyAdapter[] = [githubObjectLayerAdapter];

const MAX_HIGH_VALUE_OBJECTS = 6;

// T5.4.0 intentionally scopes out generic task-mode inference. These role/region
// hints drive the taskMode (read/search/monitor/...) scoring, not the object
// layer priors, and remain GitHub-flavoured today. A later pass (expected in
// the T5.4+ task-mode cleanup) will lift them behind a family adapter; until
// then they stay here to avoid scope creep on the object-layer boundary work.
const PAGE_ROLE_TASK_MODE_HINTS: Partial<Record<string, ReadPageTaskMode>> = {
  repo_home: 'read',
  issues_list: 'search',
  actions_list: 'monitor',
  workflow_run_detail: 'monitor',
  workflow_run_shell: 'monitor',
  login_required: 'read',
};

const PRIMARY_REGION_TASK_MODE_HINTS: Partial<Record<string, ReadPageTaskMode>> = {
  repo_primary_nav: 'read',
  issues_results: 'search',
  workflow_runs_list: 'monitor',
  workflow_run_summary: 'monitor',
  workflow_run_shell: 'monitor',
  login_gate: 'read',
  login_form: 'read',
};

const TASK_MODE_SIGNAL_PATTERNS: Record<RankedTaskMode, RegExp[]> = {
  search: [SEARCH_HINT_PATTERN],
  monitor: [MONITOR_HINT_PATTERN],
  compare: [COMPARE_HINT_PATTERN],
  extract: [EXTRACT_HINT_PATTERN],
};

function normalizeHighValueLabel(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase();
}

function isTaskModeNoiseLabel(label: string): boolean {
  const normalized = String(label || '').trim();
  if (!normalized) return true;
  if (COMMIT_SHA_PATTERN.test(normalized)) return true;
  if (/^\d+[smhd]$/i.test(normalized)) return true;
  if (/^commit\b/i.test(normalized)) return true;
  if (/^fix\(|^feat\(|^docs\(|^chore\(/i.test(normalized)) return true;
  if (/^search or jump to/i.test(normalized)) return true;
  if (/^open copilot/i.test(normalized)) return true;
  if (/^skip to content$/i.test(normalized)) return true;
  return false;
}

function buildInteractiveMap(elements: ReadPageInteractiveElement[]) {
  const map = new Map<string, ReadPageInteractiveElement>();
  for (const element of elements) {
    if (!element?.ref) continue;
    map.set(element.ref, element);
  }
  return map;
}

function getCandidateActionLabel(
  action: ReadPageCandidateAction,
  interactiveByRef: Map<string, ReadPageInteractiveElement>,
): string {
  const target = interactiveByRef.get(action.targetRef);
  const ariaLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
  return String(target?.name || ariaLabel || action.targetRef || action.id).trim();
}

function countPatternMatches(patterns: RegExp[], values: string[]): number {
  let matchCount = 0;
  for (const value of values) {
    if (!value) continue;
    if (patterns.some((pattern) => pattern.test(value))) {
      matchCount += 1;
    }
  }
  return matchCount;
}

function buildTaskModeSignalContext(
  params: TaskProtocolParams,
  highValueObjects: ReadPageHighValueObject[],
): TaskModeSignalContext {
  const interactiveByRef = buildInteractiveMap(params.interactiveElements);
  const candidateLabels = params.candidateActions
    .map((item) => getCandidateActionLabel(item, interactiveByRef))
    .filter((item) => !isTaskModeNoiseLabel(item));
  const actionHints = params.candidateActions
    .map((item) => String(item?.matchReason || item?.actionType || '').trim())
    .filter(Boolean);
  const interactiveLabels = params.interactiveElements
    .map((item) => String(item?.name || '').trim())
    .filter((item) => !isTaskModeNoiseLabel(item));
  return {
    url: String(params.currentUrl || '').toLowerCase(),
    title: String(params.currentTitle || '').toLowerCase(),
    pageRole: String(params.pageRole || ''),
    primaryRegion: String(params.primaryRegion || ''),
    signalText: [...interactiveLabels, ...candidateLabels, ...actionHints].map((item) =>
      item.toLowerCase(),
    ),
    highValueText: highValueObjects
      .slice(0, 4)
      .map((item) =>
        String(item?.label || '')
          .trim()
          .toLowerCase(),
      )
      .filter((item) => !isTaskModeNoiseLabel(item)),
  };
}

function scoreTaskMode(mode: RankedTaskMode, context: TaskModeSignalContext): number {
  let score = 0;
  if (PAGE_ROLE_TASK_MODE_HINTS[context.pageRole] === mode) {
    score += 6;
  }
  if (PRIMARY_REGION_TASK_MODE_HINTS[context.primaryRegion] === mode) {
    score += 5;
  }

  const patterns = TASK_MODE_SIGNAL_PATTERNS[mode];
  score += countPatternMatches(patterns, [context.title]) * 3;
  score += countPatternMatches(patterns, context.signalText) * 2;
  score += countPatternMatches(patterns, context.highValueText) * 3;

  if (mode === 'search' && /\/issues(?:\/?|$)/i.test(context.url)) {
    score += 4;
  }
  if (mode === 'monitor' && /\/actions(?:\/?|$)/i.test(context.url)) {
    score += 4;
  }
  if (mode === 'compare' && COMPARE_HINT_PATTERN.test(context.url)) {
    score += 4;
  }
  if (mode === 'extract' && EXTRACT_HINT_PATTERN.test(context.url)) {
    score += 4;
  }

  return score;
}

function scoreReadTaskMode(context: TaskModeSignalContext): number {
  let score = 0;
  if (PAGE_ROLE_TASK_MODE_HINTS[context.pageRole] === 'read') {
    score += 6;
  }
  if (PRIMARY_REGION_TASK_MODE_HINTS[context.primaryRegion] === 'read') {
    score += 5;
  }
  return score;
}

function inferTaskMode(
  params: TaskProtocolParams,
  highValueObjects: ReadPageHighValueObject[],
): ReadPageTaskMode {
  const context = buildTaskModeSignalContext(params, highValueObjects);
  const readScore = scoreReadTaskMode(context);
  const rankedModes: RankedTaskMode[] = ['monitor', 'search', 'extract', 'compare'];
  const ranked = rankedModes
    .map((mode) => ({ mode, score: scoreTaskMode(mode, context) }))
    .sort((left, right) => right.score - left.score);

  if (ranked[0]?.score >= 5 && ranked[0].score > readScore) {
    return ranked[0].mode;
  }

  if (readScore > 0) {
    return 'read';
  }
  return 'read';
}

function inferComplexityLevel(params: TaskProtocolParams): ReadPageComplexityLevel {
  let score = 0;
  const interactiveCount = params.interactiveElements.length;
  const candidateActionCount = params.candidateActions.length;
  const lineCount = Number(params.contentSummary?.lineCount || 0);

  if (interactiveCount > 12) score += 1;
  if (interactiveCount > 24) score += 1;
  if (candidateActionCount > 4) score += 1;
  if (lineCount > 40) score += 1;
  if (lineCount > 120) score += 1;
  if (params.pageContext.fallbackUsed) score += 1;
  // Deferred to post-T5.4.0: complexity scoring still has one GitHub-specific
  // bump. Kept stable here so T5.4.0 remains a pure object-layer boundary move.
  if (params.pageRole === 'workflow_run_detail') score += 1;

  if (score >= 4) return 'complex';
  if (score >= 2) return 'medium';
  return 'simple';
}

function inferSourceKind(params: TaskProtocolParams): ReadPageSourceKind {
  if (params.pageType !== 'web_page') {
    return 'artifact';
  }
  return 'dom_semantic';
}

function originPriority(origin: ScoredCandidateObject['origin']): number {
  switch (origin) {
    case 'page_role_seed':
      return 3;
    case 'candidate_action':
      return 2;
    case 'interactive_element':
      return 1;
    default:
      return 0;
  }
}

function originToKind(origin: ScoredCandidateObject['origin']): ReadPageHighValueObject['kind'] {
  return origin;
}

function buildReason(scored: ScoredCandidateObject, params: TaskProtocolParams): string {
  if (scored.matchReason) return scored.matchReason;
  if (scored.origin === 'interactive_element') {
    const role = scored.role || 'element';
    return params.primaryRegion
      ? `high-value ${role} surfaced from ${params.primaryRegion}`
      : `high-value ${role} surfaced from compact snapshot`;
  }
  return scored.classificationReasons[0] || 'scored high-value object';
}

function toHighValueObject(
  scored: ScoredCandidateObject,
  params: TaskProtocolParams,
): ReadPageHighValueObject {
  const confidence = Number.isFinite(scored.confidence)
    ? Number(scored.confidence.toFixed(3))
    : undefined;
  const importance = Number.isFinite(scored.importance)
    ? Number(scored.importance.toFixed(3))
    : undefined;
  const combinedReasons = [...scored.classificationReasons, ...scored.scoringReasons];

  const out: ReadPageHighValueObject = {
    id: scored.id,
    kind: originToKind(scored.origin),
    label: scored.label,
    reason: buildReason(scored, params),
  };
  if (scored.ref) out.ref = scored.ref;
  if (scored.role) out.role = scored.role;
  if (scored.actionType) out.actionType = scored.actionType;
  if (typeof confidence === 'number') out.confidence = confidence;
  if (scored.objectType) out.objectType = scored.objectType;
  if (scored.objectSubType) out.objectSubType = scored.objectSubType;
  if (scored.region !== undefined) out.region = scored.region;
  if (typeof importance === 'number') out.importance = importance;
  if (combinedReasons.length > 0) out.reasons = combinedReasons;
  if (scored.actions && scored.actions.length > 0) out.actions = scored.actions;
  if (scored.sourceKind) out.sourceKind = scored.sourceKind;
  if (scored.href) out.href = scored.href;
  return out;
}

function runObjectPipeline(
  context: ObjectLayerContext,
  inputs: CollectInputs,
): ScoredCandidateObject[] {
  const candidates = collectCandidateObjects(context, inputs, OBJECT_LAYER_ADAPTERS);
  const scored: ScoredCandidateObject[] = [];
  for (const candidate of candidates) {
    const classified = classifyCandidateObject(candidate, context, OBJECT_LAYER_ADAPTERS);
    scored.push(scoreCandidateObject(classified, context, OBJECT_LAYER_ADAPTERS));
  }
  return scored;
}

function rankScoredObjects(scored: readonly ScoredCandidateObject[]): ScoredCandidateObject[] {
  const indexed = scored.map((item, index) => ({ item, index }));
  indexed.sort((left, right) => {
    if (right.item.importance !== left.item.importance) {
      return right.item.importance - left.item.importance;
    }
    if (right.item.confidence !== left.item.confidence) {
      return right.item.confidence - left.item.confidence;
    }
    const originDelta = originPriority(right.item.origin) - originPriority(left.item.origin);
    if (originDelta !== 0) return originDelta;
    return left.index - right.index;
  });

  const seenLabels = new Set<string>();
  const deduped: ScoredCandidateObject[] = [];
  for (const { item } of indexed) {
    const normalized = normalizeHighValueLabel(item.label);
    if (!normalized) continue;
    if (seenLabels.has(normalized)) continue;
    seenLabels.add(normalized);
    deduped.push(item);
  }
  return deduped;
}

function buildHighValueObjects(
  params: TaskProtocolParams,
  initialContext: ObjectLayerContext,
): { highValueObjects: ReadPageHighValueObject[]; taskMode: ReadPageTaskMode } {
  const inputs: CollectInputs = {
    interactiveElements: params.interactiveElements,
    candidateActions: params.candidateActions,
  };

  // Pass 1: score without a taskMode hint so we can infer taskMode from a
  // neutral baseline (taskMode alignment is a small +0.06 boost that cannot
  // dominate the ranking on its own).
  const preliminaryScored = runObjectPipeline(initialContext, inputs);
  const preliminaryObjects = rankScoredObjects(preliminaryScored)
    .slice(0, MAX_HIGH_VALUE_OBJECTS)
    .map((item) => toHighValueObject(item, params));

  const taskMode = inferTaskMode(params, preliminaryObjects);

  // Pass 2: rescore with the resolved taskMode so the objectType/taskMode
  // alignment boost applies correctly. Reuse `initialContext` inputs untouched.
  const finalContext: ObjectLayerContext = { ...initialContext, taskMode };
  const finalScored = runObjectPipeline(finalContext, inputs);
  const ranked = rankScoredObjects(finalScored)
    .slice(0, MAX_HIGH_VALUE_OBJECTS)
    .map((item) => toHighValueObject(item, params));

  // B-011: annotate stable targetRefs after ranking + dedup so ordinals are
  // computed against the *final* HVO order (visible to upstream callers).
  // This must happen after `rankScoredObjects` and the slice cap so two
  // reads of the same page produce the same ordinals per identity tuple.
  const highValueObjects = annotateStableTargetRefs(ranked, params.pageRole);

  return { highValueObjects, taskMode };
}

function buildLevel0(
  taskMode: ReadPageTaskMode,
  pageRole: string,
  primaryRegion: string | null,
  highValueObjects: ReadPageHighValueObject[],
  priors: PageObjectPriors,
): ReadPageTaskLevel0 {
  const focusObjectIds = highValueObjects.slice(0, 3).map((item) => item.id);
  const focusLabels = highValueObjects
    .slice(0, 3)
    .map((item) => item.label)
    .filter(Boolean);
  const focusText = focusLabels.join(', ');
  const l0Prefix = priors.l0Prefix;

  return {
    taskMode,
    pageRole,
    primaryRegion,
    focusObjectIds,
    summary: focusText
      ? l0Prefix
        ? `${taskMode} view for ${pageRole}${primaryRegion ? ` in ${primaryRegion}` : ''}. ${l0Prefix} ${focusText}.`
        : `${taskMode} view for ${pageRole}${primaryRegion ? ` in ${primaryRegion}` : ''}; focus on ${focusText}.`
      : `${taskMode} view for ${pageRole}${primaryRegion ? ` in ${primaryRegion}` : ''}.`,
  };
}

function buildLevel1(
  params: TaskProtocolParams,
  highValueObjects: ReadPageHighValueObject[],
): ReadPageTaskLevel1 {
  const candidateActionIds = params.candidateActions.slice(0, 6).map((item) => item.id);
  const highValueLabels = highValueObjects
    .slice(0, 4)
    .map((item) => item.label)
    .filter(Boolean)
    .join(', ');

  return {
    highValueObjectIds: highValueObjects.map((item) => item.id),
    candidateActionIds,
    overview: highValueLabels
      ? `Top objects: ${highValueLabels}. Candidate actions: ${candidateActionIds.length}.`
      : `Candidate actions: ${candidateActionIds.length}.`,
  };
}

function buildLevel2(params: TaskProtocolParams): ReadPageTaskLevel2 {
  const inlineFullSnapshot = params.mode === 'full';
  return {
    available: true,
    defaultAccess: inlineFullSnapshot ? 'inline_full_snapshot' : 'artifact_ref',
    detailRefs: params.artifactRefs.map((item) => item.ref),
    expansions: ['interactive_elements', 'candidate_actions', 'dom_snapshot'],
    boundary:
      'T5.0 only defines the detail expansion entrypoint. Family-specific deep readers and non-DOM sources remain deferred.',
  };
}

export function buildTaskProtocol(params: TaskProtocolParams): TaskProtocolResult {
  const priors = resolvePageObjectPriors(PAGE_OBJECT_FAMILY_ADAPTERS, params.pageRole);
  const complexityLevel = inferComplexityLevel(params);
  const sourceKind = inferSourceKind(params);

  const objectLayerContext: ObjectLayerContext = {
    pageRole: params.pageRole as PageRole,
    primaryRegion: params.primaryRegion,
    taskMode: null,
    currentUrl: params.currentUrl,
    priors,
  };

  const { highValueObjects, taskMode } = buildHighValueObjects(params, objectLayerContext);
  const L0 = buildLevel0(taskMode, params.pageRole, params.primaryRegion, highValueObjects, priors);
  const L1 = buildLevel1(params, highValueObjects);
  const L2 = buildLevel2(params);

  return {
    taskMode,
    complexityLevel,
    sourceKind,
    highValueObjects,
    L0,
    L1,
    L2,
  };
}
