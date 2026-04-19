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
const SEARCH_HINT_PATTERN = /\b(search|filter|find|labels?|milestone|assignee|query|issues?)\b/i;
const COMMIT_SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;

const PAGE_ROLE_PRIORITY_RULES: Partial<
  Record<
    string,
    {
      primary: RegExp[];
      secondary?: RegExp[];
      tertiary?: RegExp[];
      deprioritize?: RegExp[];
      l0Prefix?: string;
    }
  >
> = {
  repo_home: {
    primary: [/\bissues\b/i, /\bpull requests?\b/i, /\bactions\b/i],
    secondary: [/\bgo to file\b/i],
    tertiary: [/\bmain branch\b/i],
    deprioritize: [
      /\bwatch\b/i,
      /\bstar(?:red)?\b/i,
      /\bpin this repository\b/i,
      /\bsee your forks\b/i,
      /\badd file\b/i,
      /\bcommits? by\b/i,
      /^commit\b/i,
    ],
    l0Prefix: 'Primary repo entry points are',
  },
  issues_list: {
    primary: [/\bsearch issues\b/i],
    secondary: [/\bfilter by\b/i, /\bfilter\b/i, /\bnew issue\b/i],
    tertiary: [/\bissue\b/i],
    deprioritize: [/^search or jump to/i, /^open copilot/i, /^skip to content$/i],
    l0Prefix: 'Primary issue controls are',
  },
  actions_list: {
    primary: [/\bfilter workflow runs\b/i],
    secondary: [/\brun\s+\d+\b/i, /\bcompleted successfully: run\b/i],
    tertiary: [/\bsummary\b/i, /\bjobs?\b/i],
    deprioritize: [/^search or jump to/i, /^open copilot/i, /^skip to content$/i],
    l0Prefix: 'Primary workflow run entries are',
  },
  workflow_run_detail: {
    primary: [/\bsummary\b/i, /\bshow all jobs\b/i, /\bjobs?\b/i],
    secondary: [/\bartifacts?\b/i, /\blogs?\b/i, /\bannotations?\b/i],
    tertiary: [/\bshow more\b/i],
    deprioritize: [/^\d+[smhd]$/i, /github\.blog/i, /^v?\d+\.\d+\.\d+$/i],
    l0Prefix: 'Primary workflow diagnostics are',
  },
};

const PAGE_ROLE_TASK_SEEDS: Partial<
  Record<
    string,
    {
      labels: string[];
      reason: string;
    }
  >
> = {
  repo_home: {
    labels: ['Issues', 'Pull requests', 'Actions'],
    reason: 'primary repo navigation inferred from page role',
  },
  issues_list: {
    labels: ['Search Issues', 'Filter issues', 'Issue entries'],
    reason: 'primary issue triage objects inferred from page role',
  },
  actions_list: {
    labels: ['Filter workflow runs', 'Workflow run entries', 'Run detail entry'],
    reason: 'primary workflow list objects inferred from page role',
  },
  workflow_run_detail: {
    labels: ['Summary', 'Jobs', 'Artifacts', 'Logs'],
    reason: 'primary workflow diagnostics inferred from page role',
  },
};

function normalizeHighValueLabel(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase();
}

function buildInteractiveMap(elements: ReadPageInteractiveElement[]) {
  const map = new Map<string, ReadPageInteractiveElement>();
  for (const element of elements) {
    if (!element?.ref) continue;
    map.set(element.ref, element);
  }
  return map;
}

function inferTaskMode(params: TaskProtocolParams): ReadPageTaskMode {
  const url = String(params.currentUrl || '').toLowerCase();
  const title = String(params.currentTitle || '').toLowerCase();
  const elementLabels = params.interactiveElements
    .map((item) => String(item?.name || ''))
    .join(' | ');
  const actionHints = params.candidateActions
    .map((item) => String(item?.matchReason || item?.actionType || ''))
    .join(' | ');

  if (params.pageRole === 'workflow_run_detail' || params.pageRole === 'actions_list') {
    return 'monitor';
  }
  if (params.pageRole === 'issues_list') {
    return 'search';
  }
  if (params.pageRole === 'repo_home' || params.pageRole === 'login_required') {
    return 'read';
  }

  if (
    COMPARE_HINT_PATTERN.test(url) ||
    COMPARE_HINT_PATTERN.test(title) ||
    COMPARE_HINT_PATTERN.test(elementLabels)
  ) {
    return 'compare';
  }
  if (
    url.includes('/actions') ||
    MONITOR_HINT_PATTERN.test(title) ||
    MONITOR_HINT_PATTERN.test(elementLabels) ||
    MONITOR_HINT_PATTERN.test(actionHints)
  ) {
    return 'monitor';
  }
  if (EXTRACT_HINT_PATTERN.test(elementLabels)) {
    return 'extract';
  }
  if (url.includes('/issues') || SEARCH_HINT_PATTERN.test(elementLabels)) {
    return 'search';
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

function scoreHighValueLabel(label: string, params: TaskProtocolParams): number {
  const normalized = String(label || '').trim();
  if (!normalized) return Number.NEGATIVE_INFINITY;

  let score = 0;
  const rules = PAGE_ROLE_PRIORITY_RULES[params.pageRole];
  rules?.primary.forEach((pattern, index) => {
    if (pattern.test(normalized)) {
      score += 320 - index * 24;
    }
  });
  rules?.secondary?.forEach((pattern, index) => {
    if (pattern.test(normalized)) {
      score += 180 - index * 18;
    }
  });
  rules?.tertiary?.forEach((pattern, index) => {
    if (pattern.test(normalized)) {
      score += 90 - index * 12;
    }
  });
  rules?.deprioritize?.forEach((pattern, index) => {
    if (pattern.test(normalized)) {
      score -= 140 - index * 10;
    }
  });

  if (
    params.primaryRegion &&
    normalized.toLowerCase().includes(params.primaryRegion.toLowerCase())
  ) {
    score += 40;
  }

  if (COMMIT_SHA_PATTERN.test(normalized)) score -= 160;
  if (/^\d+[smhd]$/i.test(normalized)) score -= 120;
  if (/^commit\b/i.test(normalized)) score -= 100;
  if (/^fix\(|^feat\(|^docs\(|^chore\(/i.test(normalized)) score -= 90;
  if (normalized.length > 96) score -= 30;
  if (normalized.length > 140) score -= 60;

  return score;
}

function buildHighValueObjects(params: TaskProtocolParams): ReadPageHighValueObject[] {
  const interactiveByRef = buildInteractiveMap(params.interactiveElements);
  const candidates: Array<ReadPageHighValueObject & { score: number; order: number }> = [];
  const seenIds = new Set<string>();
  const seenRefs = new Set<string>();
  let order = 0;

  for (const action of params.candidateActions) {
    const target = interactiveByRef.get(action.targetRef);
    const ariaLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
    const label = String(target?.name || ariaLabel || action.targetRef || action.id).trim();
    const objectId = `hvo_${action.id}`;
    if (!label || seenIds.has(objectId)) continue;
    const labelScore = scoreHighValueLabel(label, params);
    candidates.push({
      id: objectId,
      kind: 'candidate_action',
      label,
      ref: action.targetRef,
      role: target?.role,
      actionType: action.actionType,
      confidence: action.confidence,
      reason: action.matchReason,
      score: labelScore + Number(action.confidence || 0) * 10 + 8,
      order,
    });
    order += 1;
    seenIds.add(objectId);
    if (action.targetRef) seenRefs.add(action.targetRef);
  }

  for (const element of params.interactiveElements) {
    if (!element?.ref || seenRefs.has(element.ref)) continue;
    const label = String(element.name || element.role || element.ref).trim();
    if (!label) continue;
    candidates.push({
      id: `hvo_ref_${element.ref.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      kind: 'interactive_element',
      label,
      ref: element.ref,
      role: element.role,
      reason: params.primaryRegion
        ? `high-value ${element.role} surfaced from ${params.primaryRegion}`
        : `high-value ${element.role} surfaced from compact snapshot`,
      score: scoreHighValueLabel(label, params),
      order,
    });
    order += 1;
  }

  const seedConfig = PAGE_ROLE_TASK_SEEDS[params.pageRole];
  if (seedConfig) {
    seedConfig.labels.forEach((label, index) => {
      candidates.push({
        id: `hvo_seed_${params.pageRole}_${index}`,
        kind: 'page_role_seed',
        label,
        reason: seedConfig.reason,
        score: 1000 - index * 40,
        order: -100 + index,
      });
    });
  }

  return candidates
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .filter((item, index, sorted) => {
      const normalized = normalizeHighValueLabel(item.label);
      if (!normalized) return false;
      return (
        sorted.findIndex((candidate) => normalizeHighValueLabel(candidate.label) === normalized) ===
        index
      );
    })
    .slice(0, 6)
    .map(({ score: _score, order: _order, ...item }) => item);
}

function buildLevel0(
  taskMode: ReadPageTaskMode,
  pageRole: string,
  primaryRegion: string | null,
  highValueObjects: ReadPageHighValueObject[],
): ReadPageTaskLevel0 {
  const focusObjectIds = highValueObjects.slice(0, 3).map((item) => item.id);
  const focusLabels = highValueObjects
    .slice(0, 3)
    .map((item) => item.label)
    .filter(Boolean);
  const focusText = focusLabels.join(', ');
  const l0Prefix = PAGE_ROLE_PRIORITY_RULES[pageRole]?.l0Prefix;

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
  const taskMode = inferTaskMode(params);
  const complexityLevel = inferComplexityLevel(params);
  const sourceKind = inferSourceKind(params);
  const highValueObjects = buildHighValueObjects(params);
  const L0 = buildLevel0(taskMode, params.pageRole, params.primaryRegion, highValueObjects);
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
