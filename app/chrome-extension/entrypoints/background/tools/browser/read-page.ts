import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import {
  TOOL_NAMES,
  type ReadPageArtifactRef,
  type ReadPageCandidateAction,
  type ReadPageCandidateActionLocator,
  type ReadPageCompactSnapshot,
  type ReadPageExtensionFields,
  type ReadPageFullSnapshot,
  type ReadPageInteractiveElement,
  type ReadPageMode,
  type ReadPageNormalSnapshot,
  type ReadPagePageContext,
  type ReadPagePageType,
  type ReadPagePrimaryRegionConfidence,
  type ReadPageRenderMode,
  type ReadPageRequestedLayer,
  READ_PAGE_REQUESTED_LAYER_VALUES,
} from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { ERROR_MESSAGES } from '@/common/constants';
import { buildTaskProtocol } from './read-page-task-protocol';
import { inferPageUnderstanding, type PageRole } from './read-page-understanding';
import { buildHistoryRef } from './stable-target-ref';
import {
  recordStableTargetRefSnapshot,
  type StableTargetRefEntry,
} from './stable-target-ref-registry';
import {
  buildMarkdownArtifactRef,
  buildMarkdownProjection,
  MARKDOWN_ARTIFACT_KIND,
} from './read-page-markdown';
import { extractVisibleRegionRows, type VisibleRegionRowsResult } from './visible-region-rows';

interface ReadPageStats {
  processed: number;
  included: number;
  durationMs: number;
}
type PageType = ReadPagePageType;
type PrimaryRegionConfidence = ReadPagePrimaryRegionConfidence;

interface ReadPageParams {
  filter?: 'interactive'; // when omitted, return all visible elements
  mode?: ReadPageMode; // output verbosity mode, default compact
  render?: ReadPageRenderMode; // V23-03/B-015 render mode, default 'json'
  depth?: number; // maximum DOM depth to traverse (0 = root only)
  refId?: string; // focus on subtree rooted at this refId
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
  // V25-02 layer envelope. When omitted preserves the legacy full
  // L0+L1+L2 payload. The stable HVO targetRef registry is ALWAYS
  // written (even at 'L0') so chrome_click_element resolution stays
  // deterministic — see V25-04 click-resolution-l0 contract.
  requestedLayer?: ReadPageRequestedLayer;
}

interface SchemeGuardSummary {
  scheme: string;
  pageType: PageType;
  supportedForContentScript: boolean;
  unsupportedPageType: string | null;
  recommendedAction: string | null;
}

function inferSchemeGuard(url: string): SchemeGuardSummary {
  const raw = String(url || '');
  const lower = raw.toLowerCase();

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return {
      scheme: lower.startsWith('https://') ? 'https' : 'http',
      pageType: 'web_page',
      supportedForContentScript: true,
      unsupportedPageType: null,
      recommendedAction: null,
    };
  }

  if (lower.startsWith('chrome-extension://')) {
    return {
      scheme: 'chrome-extension',
      pageType: 'extension_page',
      supportedForContentScript: false,
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('chrome://') || lower.startsWith('edge://') || lower.startsWith('about:')) {
    return {
      scheme: lower.startsWith('edge://')
        ? 'edge'
        : lower.startsWith('about:')
          ? 'about'
          : 'chrome',
      pageType: 'browser_internal_page',
      supportedForContentScript: false,
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('devtools://')) {
    return {
      scheme: 'devtools',
      pageType: 'devtools_page',
      supportedForContentScript: false,
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  const scheme = raw.includes(':') ? raw.slice(0, raw.indexOf(':')).toLowerCase() : 'unknown';
  return {
    scheme,
    pageType: 'unsupported_page',
    supportedForContentScript: false,
    unsupportedPageType: 'non_web_tab',
    recommendedAction: 'switch_to_http_tab',
  };
}

function summarizePageContent(pageContent: string) {
  const normalized = (pageContent || '').replace(/\s+/g, ' ').trim();
  const lineCount = (pageContent || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;

  return {
    charCount: pageContent.length,
    normalizedLength: normalized.length,
    lineCount,
    quality: normalized.length < 120 || lineCount < 10 ? 'sparse' : 'usable',
  };
}

interface SnapshotNode {
  role: string;
  name: string;
  ref: string;
  depth: number;
  href: string | null;
}
type SnapshotInteractiveElement = ReadPageInteractiveElement;
type SnapshotArtifactRef = ReadPageArtifactRef;
type CandidateActionLocator = ReadPageCandidateActionLocator;
type CandidateActionSeed = ReadPageCandidateAction;

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'option',
  'menuitem',
  'tab',
  'treeitem',
  'spinbutton',
]);

const COMPACT_ROLE_PRIORITY = new Map<string, number>([
  ['textbox', 70],
  ['searchbox', 70],
  ['combobox', 68],
  ['button', 56],
  ['tab', 52],
  ['menuitem', 48],
  ['link', 34],
]);

const COMPACT_ACTION_KEYWORDS =
  /(issues?|pull requests?|actions?|search|filter|label|milestone|assignee|summary|jobs?|run\b|login|sign in|submit|save|continue|next|confirm|apply|checkout|export|archive|details?|settings|手机号|验证码|登录|提交|保存|搜索|筛选|过滤|详情|设置|导出)/i;

const COMPACT_SHELL_NAME_PATTERNS = [/^skip to content$/i, /^search or jump to/i, /^open copilot/i];

const COMPACT_STATUS_LABEL_PATTERNS =
  /\b\d+\s+jobs?\b|completed|failed|cancelled|succeeded|in progress|queued/i;

const COMPACT_RUN_DETAIL_PATTERNS = /\brun\s+\d+\s+of\b|workflow run/i;
const GITHUB_WORKFLOW_RUN_DETAIL_URL_PATTERN =
  /https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_BASE_PATTERN = /\/actions\/runs\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN = /\/actions\/runs\/\d+(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN = /\/actions\/runs\/\d+\/job\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN = /\/actions\/runs\/\d+\/usage(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN = /\/actions\/runs\/\d+\/workflow(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN = /#step(?::|=)|\/actions\/runs\/\d+\/job\/\d+.*#step/i;

const WORKFLOW_RUN_DETAIL_NAME_PRIORITY_PATTERN =
  /(summary|show all jobs|jobs?|artifacts?|annotations?|logs?|steps?)/i;

const WORKFLOW_RUN_DETAIL_METADATA_COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const WORKFLOW_RUN_DETAIL_METADATA_BRANCH_PATTERN = /^(main|master|develop|dev)$/i;
const WORKFLOW_RUN_DETAIL_METADATA_DURATION_PATTERN = /^\d+[smhd]$/i;

interface CompactScoringContext {
  workflowRunDetail: boolean;
}

const DEFAULT_COMPACT_SCORING_CONTEXT: CompactScoringContext = {
  workflowRunDetail: false,
};

function isGithubWorkflowRunDetailUrl(url: string): boolean {
  return GITHUB_WORKFLOW_RUN_DETAIL_URL_PATTERN.test(String(url || '').trim());
}

function inferWorkflowRunDetailLabelFromHref(href: string): string {
  const normalizedHref = String(href || '')
    .trim()
    .toLowerCase();
  if (!normalizedHref) return '';

  if (WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN.test(normalizedHref)) return 'Logs';
  if (WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN.test(normalizedHref)) return 'Jobs';
  if (WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN.test(normalizedHref)) return 'Artifacts';
  if (
    WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN.test(normalizedHref) ||
    WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN.test(normalizedHref)
  ) {
    return 'Summary';
  }

  return '';
}

function scoreWorkflowRunDetailNode(node: SnapshotNode): number {
  const name = String(node.name || '').trim();
  const href = String(node.href || '')
    .trim()
    .toLowerCase();
  let score = 0;

  if (WORKFLOW_RUN_DETAIL_NAME_PRIORITY_PATTERN.test(name)) score += 72;

  if (href) {
    if (WORKFLOW_RUN_DETAIL_HREF_BASE_PATTERN.test(href)) score += 18;
    if (WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN.test(href)) score += 82;
    if (WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN.test(href)) score += 94;
    if (WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN.test(href)) score += 76;
    if (WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN.test(href)) score += 78;
    if (WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN.test(href)) score += 102;

    if (/\/commit\//i.test(href)) score -= 130;
    if (/\/tree\/refs\/heads\//i.test(href)) score -= 120;
    if (/^\/[^/]+$/.test(href) || /github\.com\/[^/]+\/?$/.test(href)) score -= 98;
  }

  if (WORKFLOW_RUN_DETAIL_METADATA_COMMIT_PATTERN.test(name)) score -= 86;
  if (WORKFLOW_RUN_DETAIL_METADATA_BRANCH_PATTERN.test(name)) score -= 72;
  if (WORKFLOW_RUN_DETAIL_METADATA_DURATION_PATTERN.test(name)) score -= 66;

  return score;
}

function parseSnapshotNodesFromPageContent(pageContent: string): SnapshotNode[] {
  const lines = String(pageContent || '')
    .split('\n')
    .filter((line) => line.trim());

  const nodes: SnapshotNode[] = [];
  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    const match = trimmedLine.match(/^- ([^\s"]+)(?: "([^"]*)")? \[ref=([^\]]+)\]/);
    if (!match) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const hrefMatch = trimmedLine.match(/\shref="([^"]+)"/i);
    nodes.push({
      role: String(match[1] || 'generic')
        .trim()
        .toLowerCase(),
      name: String(match[2] || '')
        .replace(/\\"/g, '"')
        .trim(),
      ref: String(match[3] || '').trim(),
      depth: Math.max(0, Math.floor(indent / 2)),
      href: hrefMatch ? String(hrefMatch[1] || '').trim() : null,
    });
    if (nodes.length >= 300) break;
  }
  return nodes;
}

function findDescendantLabel(nodes: SnapshotNode[], index: number): string {
  const node = nodes[index];
  let bestLabel = '';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
    const candidate = nodes[cursor];
    if (candidate.depth <= node.depth) break;
    if (!candidate.name) continue;
    if (INTERACTIVE_ROLES.has(candidate.role)) continue;
    let score = 0;
    if (COMPACT_ACTION_KEYWORDS.test(candidate.name)) score += 24;
    if (
      /show|open|view|go to|filter|search|summary|jobs?|artifacts?|logs?|workflow/i.test(
        candidate.name,
      )
    )
      score += 18;
    if (candidate.name.length >= 8) score += 6;
    if (candidate.name.length >= 40) score -= 12;
    if (COMPACT_STATUS_LABEL_PATTERNS.test(candidate.name)) score -= 20;
    if (score > bestScore) {
      bestScore = score;
      bestLabel = candidate.name;
    }
  }
  return bestLabel;
}

function scoreCompactInteractiveNode(
  node: SnapshotNode,
  index: number,
  context: CompactScoringContext,
): number {
  const role = String(node.role || '').toLowerCase();
  const name = String(node.name || '').trim();
  const normalizedName = name.toLowerCase();
  const isRunDetail = COMPACT_RUN_DETAIL_PATTERNS.test(name);
  let score = 0;

  score += COMPACT_ROLE_PRIORITY.get(role) ?? 24;
  score += name ? 90 : -120;

  if (name.length >= 4) score += 8;
  if (name.length >= 12) score += 6;
  if (name.length >= 48) score -= 28;
  if (name.length >= 80) score -= 44;
  if (COMPACT_ACTION_KEYWORDS.test(name)) score += 28;
  if (isRunDetail) score += 56;
  if (COMPACT_SHELL_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName))) score -= 80;
  if (context.workflowRunDetail) {
    score += scoreWorkflowRunDetailNode(node);
  }

  // Keep nearby content slightly preferred without letting early chrome dominate compact mode.
  score -= Math.floor(index / 12);
  return score;
}

function toInteractiveElement(node: SnapshotNode): SnapshotInteractiveElement {
  const element: SnapshotInteractiveElement = {
    ref: node.ref,
    role: node.role || 'generic',
    name: node.name || '',
  };
  const href = typeof node.href === 'string' ? node.href.trim() : '';
  if (href) element.href = href;
  return element;
}

function prioritizeCompactNodes(
  nodes: SnapshotNode[],
  limit: number,
  context: CompactScoringContext = DEFAULT_COMPACT_SCORING_CONTEXT,
): SnapshotInteractiveElement[] {
  return nodes
    .filter((node) => node.ref)
    .map((node, index) => ({
      node,
      index,
      score: scoreCompactInteractiveNode(node, index, context),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ node }) => toInteractiveElement(node));
}

function buildInteractiveElements(
  pageContent: string,
  fallbackElements: any[],
  limit: number,
  mode: ReadPageMode,
  currentUrl: string,
): SnapshotInteractiveElement[] {
  const scoringContext: CompactScoringContext = {
    workflowRunDetail: isGithubWorkflowRunDetailUrl(currentUrl),
  };
  const nodes = parseSnapshotNodesFromPageContent(pageContent);
  const parsedInteractive = nodes
    .filter((node) => INTERACTIVE_ROLES.has(node.role))
    .map((node, index) => {
      const nodeIndex = nodes.findIndex((candidate) => candidate.ref === node.ref);
      const descendantLabel = nodeIndex >= 0 ? findDescendantLabel(nodes, nodeIndex) : '';
      const hrefLabel = scoringContext.workflowRunDetail
        ? inferWorkflowRunDetailLabelFromHref(node.href || '')
        : '';
      return {
        ...node,
        name: node.name || descendantLabel || hrefLabel,
      };
    });
  const source = parsedInteractive.length > 0 ? parsedInteractive : nodes;
  const fromSnapshot =
    mode === 'compact'
      ? prioritizeCompactNodes(source, limit, scoringContext)
      : source
          .filter((node) => node.ref)
          .slice(0, limit)
          .map((node) => toInteractiveElement(node));

  if (fromSnapshot.length > 0) return fromSnapshot;

  const fromFallback = Array.isArray(fallbackElements) ? fallbackElements : [];
  const fallbackNodes: SnapshotNode[] = fromFallback.map((item: any, index: number) => ({
    ref: String(item?.ref || item?.selector || `fallback_${index + 1}`),
    role: String(item?.type || 'generic').toLowerCase(),
    name: String(item?.text || '').trim(),
    depth: 0,
    href: typeof item?.href === 'string' ? item.href : null,
  }));
  if (mode === 'compact') {
    return prioritizeCompactNodes(fallbackNodes, limit, scoringContext);
  }
  return fallbackNodes.slice(0, limit).map((node) => toInteractiveElement(node));
}

function buildArtifactRefs(tabId: number, includeMarkdown: boolean): SnapshotArtifactRef[] {
  const safeTabId = Number.isFinite(tabId) ? tabId : 0;
  const refs: SnapshotArtifactRef[] = [
    { kind: 'dom_snapshot', ref: `artifact://read_page/tab-${safeTabId}/normal` },
    { kind: 'dom_snapshot', ref: `artifact://read_page/tab-${safeTabId}/full` },
  ];
  if (includeMarkdown) {
    refs.push({ kind: MARKDOWN_ARTIFACT_KIND, ref: buildMarkdownArtifactRef(safeTabId) });
  }
  return refs;
}

function buildRefSelectorMap(refMap: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of Array.isArray(refMap) ? refMap : []) {
    const ref = typeof item?.ref === 'string' ? item.ref.trim() : '';
    const selector = typeof item?.selector === 'string' ? item.selector.trim() : '';
    if (!ref || !selector) continue;
    map.set(ref, selector);
  }
  return map;
}

function buildCandidateActions(
  interactiveElements: SnapshotInteractiveElement[],
  refMap: any[],
): CandidateActionSeed[] {
  const selectorMap = buildRefSelectorMap(refMap);
  const clickRoles = new Set(['button', 'link', 'menuitem', 'tab', 'option']);
  const fillRoles = new Set(['textbox', 'searchbox', 'combobox']);
  const primaryKeywords =
    /(submit|save|continue|next|confirm|login|sign in|search|checkout|提交|保存|继续|下一步|确认|登录|搜索)/i;

  const seeds: CandidateActionSeed[] = [];
  for (const element of interactiveElements) {
    if (!element.ref) continue;
    const role = String(element.role || '').toLowerCase();
    const name = String(element.name || '').trim();
    let actionType: 'click' | 'fill' | null = null;

    if (clickRoles.has(role)) actionType = 'click';
    else if (fillRoles.has(role)) actionType = 'fill';
    if (!actionType) continue;

    const locatorChain: CandidateActionLocator[] = [];
    if (name) {
      locatorChain.push({ type: 'aria', value: name });
    }
    const selector = selectorMap.get(element.ref);
    if (selector) {
      locatorChain.push({ type: 'css', value: selector });
    }

    const isPrimary = primaryKeywords.test(name);
    const confidence = isPrimary ? 0.93 : actionType === 'fill' ? 0.68 : 0.72;
    const matchReason = isPrimary
      ? 'primary action inferred from interactive label'
      : actionType === 'fill'
        ? 'form input candidate from structured snapshot'
        : 'interactive clickable candidate from structured snapshot';

    const safeRef = element.ref.replace(/[^a-zA-Z0-9_]/g, '_');
    seeds.push({
      id: `ca_${actionType}_${safeRef}`,
      actionType,
      targetRef: element.ref,
      confidence: Number(confidence.toFixed(2)),
      matchReason,
      locatorChain,
    });
    if (seeds.length >= 8) break;
  }
  return seeds;
}

function buildStableSnapshotLayer(params: {
  mode: ReadPageMode;
  currentUrl: string;
  currentTitle: string;
  pageType: PageType;
  pageRole: PageRole;
  primaryRegion: string | null;
  quality: string;
  interactiveElements: SnapshotInteractiveElement[];
  artifactRefs: SnapshotArtifactRef[];
}): Omit<ReadPageCompactSnapshot, keyof ReadPageExtensionFields> {
  return {
    mode: params.mode,
    page: {
      url: params.currentUrl,
      title: params.currentTitle,
      pageType: params.pageType,
    },
    summary: {
      pageRole: params.pageRole,
      primaryRegion: params.primaryRegion,
      quality: params.quality,
    },
    interactiveElements: params.interactiveElements,
    artifactRefs: params.artifactRefs,
  };
}

function buildExtensionLayer(params: {
  mode: ReadPageMode;
  renderMode: ReadPageRenderMode;
  currentUrl: string;
  currentTitle: string;
  pageType: PageType;
  pageRole: PageRole;
  primaryRegion: string | null;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
  artifactRefs: SnapshotArtifactRef[];
  candidateActions: CandidateActionSeed[];
  interactiveElements: SnapshotInteractiveElement[];
  pageContext: ReadPagePageContext;
  visibleRegionRows: VisibleRegionRowsResult;
  /** V25-02 — when 'L0' or 'L0+L1', strip detail layers below the requested envelope. */
  requestedLayer: ReadPageRequestedLayer;
}): ReadPageExtensionFields {
  const markdownArtifact = params.artifactRefs.find((item) => item.kind === MARKDOWN_ARTIFACT_KIND);
  const taskProtocol = buildTaskProtocol({
    mode: params.mode,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    pageType: params.pageType,
    pageRole: params.pageRole,
    primaryRegion: params.primaryRegion,
    interactiveElements: params.interactiveElements,
    candidateActions: params.candidateActions,
    artifactRefs: params.artifactRefs,
    pageContext: params.pageContext,
    contentSummary: params.contentSummary,
    markdownArtifactRef: markdownArtifact?.ref ?? null,
  });

  // B-011: populate `historyRef` with a compact snapshot identifier so
  // upstream callers can correlate stable HVO `targetRef`s back to the
  // snapshot they were first seen in. The seed mixes URL host + path,
  // pageRole and a tiny content fingerprint so two reads of the same
  // page yield the same historyRef when content is unchanged but
  // distinct refs after a real navigation. Pure helper, no I/O.
  const historyRef = buildHistoryRef({
    url: params.currentUrl,
    pageRole: params.pageRole,
    contentSeed: `${params.contentSummary.normalizedLength}|${taskProtocol.highValueObjects.length}`,
  });

  // V23-03 / B-015: when the caller explicitly requested
  // render='markdown', generate a Markdown projection from the *final*
  // ranked HVO + interactive lists (so it stays consistent with the JSON
  // payload the same response carries). The projection is intentionally
  // ref-free (see read-page-markdown.ts) so it cannot be misused as a
  // click locator. Empty result -> emit `null` to signal "Markdown
  // unavailable" rather than "page is empty".
  let markdown: string | null = null;
  if (params.renderMode === 'markdown') {
    const projected = buildMarkdownProjection({
      url: params.currentUrl,
      title: params.currentTitle,
      pageRole: params.pageRole,
      primaryRegion: params.primaryRegion,
      highValueObjects: taskProtocol.highValueObjects,
      interactiveElements: params.interactiveElements,
    });
    markdown = projected || null;
  }

  // V25-02 layer envelope — strip detail layers per `requestedLayer`.
  // Stable HVO `targetRef` registry stays untouched (registered in
  // buildModeOutput) so `chrome_click_element` keeps resolving via the
  // same `tgt_*` even at `'L0'`. Markdown stays available because it
  // is a separate render contract (B-015) and is intentionally
  // ref-free.
  const includeL1 = params.requestedLayer !== 'L0';
  const includeL2 = params.requestedLayer === 'L0+L1+L2';
  const extensionLayer = {
    candidateActions: includeL1 ? params.candidateActions : [],
    pageContext: params.pageContext,
    // T3.2: reserved extension fields (not locked as long-term schema yet).
    frameContext: null,
    historyRef,
    memoryHints: [],
    taskMode: taskProtocol.taskMode,
    complexityLevel: taskProtocol.complexityLevel,
    sourceKind: taskProtocol.sourceKind,
    highValueObjects: taskProtocol.highValueObjects,
    L0: taskProtocol.L0,
    L1: includeL1 ? taskProtocol.L1 : undefined,
    L2: includeL2 ? taskProtocol.L2 : undefined,
    visibleRegionRows: params.visibleRegionRows,
    renderMode: params.renderMode,
    markdown,
  };
  return extensionLayer as ReadPageExtensionFields;
}

function buildModeOutput(params: {
  mode: ReadPageMode;
  renderMode: ReadPageRenderMode;
  tabId: number;
  currentUrl: string;
  currentTitle: string;
  pageType: PageType;
  scheme: string;
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: PrimaryRegionConfidence;
  footerOnly: boolean;
  anchorTexts: string[];
  pageContent: string;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
  stats: ReadPageStats | { processed: number; included: number; durationMs: number };
  viewport: { width: number | null; height: number | null; dpr: number | null };
  filter: string;
  depth: number | null;
  focus: { refId: string; found: boolean } | null;
  sparse: boolean;
  fallbackUsed: boolean;
  fallbackSource: string | null;
  refMapCount: number;
  markedElements: any[];
  elements: any[];
  count: number;
  reason: string | null;
  tips: string;
  refMap: any[];
  candidateActions: CandidateActionSeed[];
  visibleRegionRows: VisibleRegionRowsResult;
  /** V25-02 — layer envelope; defaults to 'L0+L1+L2' for legacy callers. */
  requestedLayer: ReadPageRequestedLayer;
}): ReadPageCompactSnapshot | ReadPageNormalSnapshot | ReadPageFullSnapshot {
  const interactiveLimit = params.mode === 'compact' ? 24 : 80;
  const interactiveElements = buildInteractiveElements(
    params.pageContent,
    params.elements,
    interactiveLimit,
    params.mode,
    params.currentUrl,
  );
  const candidateActions =
    params.candidateActions.length > 0
      ? params.candidateActions
      : buildCandidateActions(interactiveElements, params.refMap);
  const artifactRefs = buildArtifactRefs(params.tabId, params.renderMode === 'markdown');
  const pageContext: ReadPagePageContext = {
    filter: params.filter,
    depth: params.depth,
    focus: params.focus,
    scheme: params.scheme,
    viewport: params.viewport,
    sparse: params.sparse,
    fallbackUsed: params.fallbackUsed,
    fallbackSource: params.fallbackSource,
    refMapCount: params.refMapCount,
    markedElementsCount: params.markedElements.length,
  };

  const stableLayer = buildStableSnapshotLayer({
    mode: params.mode,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    pageType: params.pageType,
    pageRole: params.pageRole,
    primaryRegion: params.primaryRegion,
    quality: params.contentSummary.quality,
    interactiveElements,
    artifactRefs,
  });

  const extensionLayer = buildExtensionLayer({
    mode: params.mode,
    renderMode: params.renderMode,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    pageType: params.pageType,
    pageRole: params.pageRole,
    primaryRegion: params.primaryRegion,
    contentSummary: params.contentSummary,
    artifactRefs,
    candidateActions,
    interactiveElements,
    pageContext,
    visibleRegionRows: params.visibleRegionRows,
    requestedLayer: params.requestedLayer,
  });

  // B-011: feed the per-tab stable-targetRef registry so the click bridge
  // can translate `tgt_*` from prior turns back into the live per-snapshot
  // `ref_*` for this exact tab. We do this exactly once per snapshot, after
  // the extension layer is built but before serializing the response, so
  // every successful read replaces the previous mapping atomically.
  if (Array.isArray(extensionLayer.highValueObjects)) {
    const entries: StableTargetRefEntry[] = [];
    for (const obj of extensionLayer.highValueObjects) {
      if (obj.targetRef && obj.ref) {
        entries.push({ targetRef: obj.targetRef, ref: obj.ref });
      }
    }
    recordStableTargetRefSnapshot(params.tabId, entries);
  }

  const sharedPayload: ReadPageCompactSnapshot = {
    ...stableLayer,
    ...extensionLayer,
  };

  if (params.mode === 'compact') {
    return sharedPayload;
  }

  if (params.mode === 'normal') {
    return {
      ...sharedPayload,
      summary: {
        ...sharedPayload.summary,
        primaryRegionConfidence: params.primaryRegionConfidence,
        footerOnly: params.footerOnly,
        anchorTexts: params.anchorTexts,
      },
      diagnostics: {
        stats: params.stats,
        contentSummary: params.contentSummary,
        tips: params.tips,
        reason: params.reason,
      },
    };
  }

  return {
    ...sharedPayload,
    summary: {
      ...sharedPayload.summary,
      primaryRegionConfidence: params.primaryRegionConfidence,
      footerOnly: params.footerOnly,
      anchorTexts: params.anchorTexts,
    },
    fullSnapshot: {
      pageContent: params.pageContent,
      refMap: params.refMap,
      fallbackElements: params.elements,
      fallbackCount: params.count,
      markedElements: params.markedElements,
      stats: params.stats,
      contentSummary: params.contentSummary,
      tips: params.tips,
      reason: params.reason,
    },
  };
}

class ReadPageTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.READ_PAGE;

  // Execute read page
  async execute(args: ReadPageParams): Promise<ToolResult> {
    const { filter, depth, refId, mode, render, requestedLayer } = args || {};

    // Validate refId parameter
    const focusRefId = typeof refId === 'string' ? refId.trim() : '';
    if (refId !== undefined && !focusRefId) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: refId must be a non-empty string`,
      );
    }

    // Validate depth parameter
    const requestedDepth = depth === undefined ? undefined : Number(depth);
    if (requestedDepth !== undefined && (!Number.isInteger(requestedDepth) || requestedDepth < 0)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: depth must be a non-negative integer`,
      );
    }

    const selectedModeRaw = mode || 'compact';
    if (!['compact', 'normal', 'full'].includes(selectedModeRaw)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: mode must be one of compact | normal | full`,
      );
    }
    const selectedMode = selectedModeRaw as ReadPageMode;

    // V23-03 / B-015: validate render mode. Default 'json' so legacy
    // callers see no behavior change. We deliberately fail closed on
    // unknown values rather than silently coerce — an unknown render
    // mode usually means the upstream client speaks a newer contract
    // than this extension can satisfy, and silent coercion would hide
    // that drift.
    const selectedRenderRaw = render || 'json';
    if (!['json', 'markdown'].includes(selectedRenderRaw)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: render must be one of json | markdown`,
      );
    }
    const selectedRender = selectedRenderRaw as ReadPageRenderMode;

    // V25-02 — validate requestedLayer. Default to the legacy
    // `'L0+L1+L2'` envelope so older callers see byte-identical
    // payloads. Unknown values fail closed for the same reason
    // `render` does: the upstream client almost certainly speaks a
    // newer contract than this extension can satisfy.
    let selectedLayer: ReadPageRequestedLayer = 'L0+L1+L2';
    if (requestedLayer !== undefined) {
      if (
        typeof requestedLayer !== 'string' ||
        !(READ_PAGE_REQUESTED_LAYER_VALUES as readonly string[]).includes(requestedLayer)
      ) {
        return createErrorResponse(
          `${ERROR_MESSAGES.INVALID_PARAMETERS}: requestedLayer must be one of ${READ_PAGE_REQUESTED_LAYER_VALUES.join(' | ')}`,
        );
      }
      selectedLayer = requestedLayer;
    }

    // Track if user explicitly controlled the output (skip sparse heuristics)
    const userControlled = requestedDepth !== undefined || !!focusRefId;

    try {
      // Tip text returned to callers to guide next action
      const standardTips =
        "Stay on the safe path first: prefer ref-based actions from chrome_read_page or chrome_get_interactive_elements. If the specific element you need is still missing, use chrome_screenshot for visual confirmation and coordinates. Reserve chrome_computer or chrome_javascript for explicit fallback/debug cases only. Also note: 'markedElements' are user-marked elements and have the highest priority when choosing targets.";

      const explicit = await this.tryGetTab(args?.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args?.windowId));
      if (!tab.id)
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');

      const currentUrl = String(tab.url || '');
      const currentTitle = String(tab.title || '');
      const schemeGuard = inferSchemeGuard(currentUrl);

      if (!schemeGuard.supportedForContentScript) {
        const guardPageContent = [
          '- generic "Current tab is not a regular web page"',
          currentTitle ? `- generic "title: ${currentTitle.replace(/\s+/g, ' ').trim()}"` : '',
          currentUrl ? `- generic "url: ${currentUrl}"` : '',
          `- generic "pageType: ${schemeGuard.pageType}"`,
          `- generic "unsupportedPageType: ${schemeGuard.unsupportedPageType || 'none'}"`,
          `- generic "recommendedAction: ${schemeGuard.recommendedAction || 'none'}"`,
        ]
          .filter(Boolean)
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                ...buildModeOutput({
                  mode: selectedMode,
                  renderMode: selectedRender,
                  tabId: tab.id,
                  currentUrl,
                  currentTitle,
                  pageType: schemeGuard.pageType,
                  scheme: schemeGuard.scheme,
                  pageRole: 'unknown',
                  primaryRegion: null,
                  primaryRegionConfidence: null,
                  footerOnly: false,
                  anchorTexts: [],
                  pageContent: guardPageContent,
                  contentSummary: summarizePageContent(guardPageContent),
                  stats: { processed: 0, included: 0, durationMs: 0 },
                  viewport: { width: null, height: null, dpr: null },
                  filter: filter || 'all',
                  depth: requestedDepth ?? null,
                  focus: focusRefId ? { refId: focusRefId, found: false } : null,
                  sparse: true,
                  fallbackUsed: false,
                  fallbackSource: null,
                  refMapCount: 0,
                  markedElements: [],
                  elements: [],
                  count: 0,
                  reason: 'unsupported_page_type',
                  tips: standardTips,
                  refMap: [],
                  candidateActions: [],
                  visibleRegionRows: extractVisibleRegionRows({
                    pageContent: '',
                    sourceRegion: 'unsupported_page',
                  }),
                  requestedLayer: selectedLayer,
                }),
                reason: 'unsupported_page_type',
                pageType: schemeGuard.pageType,
                scheme: schemeGuard.scheme,
                unsupportedPageType: schemeGuard.unsupportedPageType,
                recommendedAction: schemeGuard.recommendedAction,
              }),
            },
          ],
          isError: false,
        };
      }

      // Inject helper in ISOLATED world to enable chrome.runtime messaging
      // Inject into all frames to support same-origin iframe operations
      await this.injectContentScript(
        tab.id,
        ['inject-scripts/accessibility-tree-helper.js'],
        false,
        'ISOLATED',
        true,
      );

      // Ask content script to generate accessibility tree
      const resp = await this.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
        filter: filter || null,
        depth: requestedDepth,
        refId: focusRefId || undefined,
      });

      // Evaluate tree result and decide whether to fallback
      const treeOk = resp && resp.success === true;
      const pageContent: string =
        resp && typeof resp.pageContent === 'string' ? resp.pageContent : '';
      const pageUnderstanding = inferPageUnderstanding(currentUrl, currentTitle, pageContent);

      // Extract stats from response
      const stats: ReadPageStats | null =
        treeOk && resp?.stats
          ? {
              processed: resp.stats.processed ?? 0,
              included: resp.stats.included ?? 0,
              durationMs: resp.stats.durationMs ?? 0,
            }
          : null;

      const lines = pageContent
        ? pageContent.split('\n').filter((l: string) => l.trim().length > 0).length
        : 0;
      const refCount = Array.isArray(resp?.refMap) ? resp.refMap.length : 0;
      const contentSummary = summarizePageContent(pageContent);

      // Skip sparse heuristics when user explicitly controls output
      const isSparse = !userControlled && lines < 10 && refCount < 3;

      // User markers have been removed with the Element Marker surface
      // (MKEP pruning §P7). Keep the field on the payload as an empty
      // array to preserve the outbound contract that downstream consumers
      // (telemetry, prompt builder) still reference.
      const markedElements: any[] = [];

      // Helper to convert elements array to pageContent format
      const formatElementsAsPageContent = (elements: any[]): string => {
        const out: string[] = [];
        for (const e of elements || []) {
          const type = typeof e?.type === 'string' && e.type ? e.type : 'element';
          const rawText = typeof e?.text === 'string' ? e.text.trim() : '';
          const text =
            rawText.length > 0
              ? ` "${rawText.replace(/\s+/g, ' ').slice(0, 100).replace(/"/g, '\\"')}"`
              : '';
          const selector =
            typeof e?.selector === 'string' && e.selector ? ` selector="${e.selector}"` : '';
          const coords =
            e?.coordinates && Number.isFinite(e.coordinates.x) && Number.isFinite(e.coordinates.y)
              ? ` (x=${Math.round(e.coordinates.x)},y=${Math.round(e.coordinates.y)})`
              : '';
          out.push(`- ${type}${text}${selector}${coords}`);
          if (out.length >= 150) break;
        }
        return out.join('\n');
      };

      // Unified base payload structure - consistent keys for stable contract
      const basePayload: Record<string, any> = {
        success: true,
        mode: selectedMode,
        filter: filter || 'all',
        pageContent,
        contentSummary,
        tips: standardTips,
        viewport: treeOk ? resp.viewport : { width: null, height: null, dpr: null },
        stats: stats || { processed: 0, included: 0, durationMs: 0 },
        refMapCount: refCount,
        sparse: treeOk ? isSparse : false,
        pageType: schemeGuard.pageType,
        scheme: schemeGuard.scheme,
        pageRole: pageUnderstanding.pageRole,
        primaryRegion: pageUnderstanding.primaryRegion,
        primaryRegionConfidence: pageUnderstanding.primaryRegionConfidence,
        footerOnly: pageUnderstanding.footerOnly,
        anchorTexts: pageUnderstanding.anchorTexts,
        depth: requestedDepth ?? null,
        focus: focusRefId ? { refId: focusRefId, found: treeOk } : null,
        markedElements,
        elements: [],
        count: 0,
        fallbackUsed: false,
        fallbackSource: null,
        reason: null,
        refMap: Array.isArray(resp?.refMap) ? resp.refMap : [],
        candidateActions: [],
        visibleRegionRows: extractVisibleRegionRows({
          pageContent,
          sourceRegion: pageUnderstanding.primaryRegion,
        }),
      };

      // Normal path: return tree
      if (treeOk && !isSparse) {
        const modePayload = buildModeOutput({
          mode: selectedMode,
          renderMode: selectedRender,
          tabId: tab.id,
          currentUrl,
          currentTitle,
          pageType: schemeGuard.pageType,
          scheme: schemeGuard.scheme,
          pageRole: basePayload.pageRole,
          primaryRegion: basePayload.primaryRegion,
          primaryRegionConfidence: basePayload.primaryRegionConfidence,
          footerOnly: basePayload.footerOnly,
          anchorTexts: basePayload.anchorTexts,
          pageContent: basePayload.pageContent,
          contentSummary: basePayload.contentSummary,
          stats: basePayload.stats,
          viewport: basePayload.viewport,
          filter: basePayload.filter,
          depth: basePayload.depth,
          focus: basePayload.focus,
          sparse: basePayload.sparse,
          fallbackUsed: basePayload.fallbackUsed,
          fallbackSource: basePayload.fallbackSource,
          refMapCount: basePayload.refMapCount,
          markedElements: basePayload.markedElements,
          elements: basePayload.elements,
          count: basePayload.count,
          reason: basePayload.reason,
          tips: basePayload.tips,
          refMap: basePayload.refMap,
          candidateActions: basePayload.candidateActions,
          visibleRegionRows: basePayload.visibleRegionRows,
          requestedLayer: selectedLayer,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(modePayload) }],
          isError: false,
        };
      }

      // When refId is explicitly provided, do not fallback (refs are frame-local and may expire)
      if (focusRefId) {
        return createErrorResponse(resp?.error || `refId "${focusRefId}" not found or expired`);
      }

      // When user explicitly controls depth, do not override with fallback heuristics
      if (requestedDepth !== undefined) {
        return createErrorResponse(resp?.error || 'Failed to generate accessibility tree');
      }

      // Fallback path: try get_interactive_elements once
      try {
        await this.injectContentScript(tab.id, ['inject-scripts/interactive-elements-helper.js']);
        const fallback = await this.sendMessageToTab(tab.id, {
          action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
          includeCoordinates: true,
        });

        if (fallback && fallback.success && Array.isArray(fallback.elements)) {
          const merged = fallback.elements.slice(0, 150);

          basePayload.fallbackUsed = true;
          basePayload.fallbackSource = 'get_interactive_elements';
          basePayload.reason = treeOk ? 'sparse_tree' : resp?.error || 'tree_failed';
          basePayload.elements = merged;
          basePayload.count = fallback.elements.length;
          if (!basePayload.pageContent) {
            basePayload.pageContent = formatElementsAsPageContent(merged);
          }
          const fallbackUnderstanding = inferPageUnderstanding(
            currentUrl,
            currentTitle,
            String(basePayload.pageContent || ''),
          );
          basePayload.pageRole = fallbackUnderstanding.pageRole;
          basePayload.primaryRegion = fallbackUnderstanding.primaryRegion;
          basePayload.primaryRegionConfidence = fallbackUnderstanding.primaryRegionConfidence;
          basePayload.footerOnly = fallbackUnderstanding.footerOnly;
          basePayload.anchorTexts = fallbackUnderstanding.anchorTexts;
          basePayload.visibleRegionRows = extractVisibleRegionRows({
            pageContent: String(basePayload.pageContent || ''),
            sourceRegion: fallbackUnderstanding.primaryRegion,
          });

          const modePayload = buildModeOutput({
            mode: selectedMode,
            renderMode: selectedRender,
            tabId: tab.id,
            currentUrl,
            currentTitle,
            pageType: schemeGuard.pageType,
            scheme: schemeGuard.scheme,
            pageRole: basePayload.pageRole,
            primaryRegion: basePayload.primaryRegion,
            primaryRegionConfidence: basePayload.primaryRegionConfidence,
            footerOnly: basePayload.footerOnly,
            anchorTexts: basePayload.anchorTexts,
            pageContent: basePayload.pageContent,
            contentSummary: summarizePageContent(String(basePayload.pageContent || '')),
            stats: basePayload.stats,
            viewport: basePayload.viewport,
            filter: basePayload.filter,
            depth: basePayload.depth,
            focus: basePayload.focus,
            sparse: basePayload.sparse,
            fallbackUsed: basePayload.fallbackUsed,
            fallbackSource: basePayload.fallbackSource,
            refMapCount: basePayload.refMapCount,
            markedElements: basePayload.markedElements,
            elements: basePayload.elements,
            count: basePayload.count,
            reason: basePayload.reason,
            tips: basePayload.tips,
            refMap: basePayload.refMap,
            candidateActions: basePayload.candidateActions,
            visibleRegionRows: basePayload.visibleRegionRows,
            requestedLayer: selectedLayer,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(modePayload) }],
            isError: false,
          };
        }
      } catch (fallbackErr) {
        console.warn('read_page fallback failed:', fallbackErr);
      }

      // If we reach here, both tree (usable) and fallback failed
      return createErrorResponse(
        treeOk
          ? 'Accessibility tree is too sparse and fallback failed'
          : resp?.error || 'Failed to generate accessibility tree and fallback failed',
      );
    } catch (error) {
      console.error('Error in read page tool:', error);
      return createErrorResponse(
        `Error generating accessibility tree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const readPageTool = new ReadPageTool();
