import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { ERROR_MESSAGES } from '@/common/constants';
import { listMarkersForUrl } from '@/entrypoints/background/element-marker/element-marker-storage';

interface ReadPageStats {
  processed: number;
  included: number;
  durationMs: number;
}

type ReadPageMode = 'compact' | 'normal' | 'full';

interface ReadPageParams {
  filter?: 'interactive'; // when omitted, return all visible elements
  mode?: ReadPageMode; // output verbosity mode, default compact
  depth?: number; // maximum DOM depth to traverse (0 = root only)
  refId?: string; // focus on subtree rooted at this refId
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
}

type PageType =
  | 'web_page'
  | 'extension_page'
  | 'browser_internal_page'
  | 'devtools_page'
  | 'unsupported_page';

interface SchemeGuardSummary {
  scheme: string;
  pageType: PageType;
  supportedForContentScript: boolean;
  unsupportedPageType: string | null;
  recommendedAction: string | null;
}

type PageRole =
  | 'unknown'
  | 'hotspot_rank_list'
  | 'hotspot_topic_list'
  | 'hotspot_detail'
  | 'creator_home'
  | 'creator_overview'
  | 'login_required'
  | 'outer_shell';

interface PageUnderstandingSummary {
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: 'low' | 'medium' | 'high' | null;
  footerOnly: boolean;
  anchorTexts: string[];
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

function collectAnchorTexts(pageContent: string) {
  const anchors = [
    '视频总榜',
    '话题榜',
    '话题总榜',
    '热度飙升的话题榜',
    '话题名称',
    '热度趋势',
    '热度值',
    '视频量',
    '播放量',
    '稿均播放量',
    '查看',
    '发布视频',
    '趋势',
    '关联内容',
    '用户关注',
    '评论',
    '账号总览',
    '近30天未发布新作品',
    '手机号',
    '验证码',
  ];

  return anchors.filter((anchor) => pageContent.includes(anchor));
}

function inferPageUnderstanding(url: string, pageContent: string): PageUnderstandingSummary {
  const lowerUrl = String(url || '').toLowerCase();
  const content = String(pageContent || '');
  const anchorTexts = collectAnchorTexts(content);
  const footerOnly =
    anchorTexts.length <= 2 &&
    /账号授权协议|用户服务协议|隐私政策|联系我们/.test(content) &&
    !/热度值|播放量|查看|发布视频|话题名称/.test(content);

  if (/手机号|验证码/.test(content) && /登录|抖音/.test(content)) {
    return {
      pageRole: 'login_required',
      primaryRegion: 'login_gate',
      primaryRegionConfidence: 'high',
      footerOnly,
      anchorTexts,
    };
  }

  if (lowerUrl.includes('active_tab=hotspot_topic')) {
    const isTopicTable =
      /话题名称|热度趋势|热度值|视频量|播放量|稿均播放量/.test(content) ||
      /发布视频查看/.test(content);

    return {
      pageRole: isTopicTable
        ? 'hotspot_topic_list'
        : footerOnly
          ? 'outer_shell'
          : 'hotspot_topic_list',
      primaryRegion: isTopicTable ? 'topic_table' : footerOnly ? 'footer_shell' : 'topic_shell',
      primaryRegionConfidence: isTopicTable ? 'high' : footerOnly ? 'low' : 'medium',
      footerOnly,
      anchorTexts,
    };
  }

  if (
    lowerUrl.includes('active_tab=hotspot_all') ||
    /视频总榜|低粉爆款视频榜|高完播率视频榜|高涨粉率视频榜/.test(content)
  ) {
    return {
      pageRole: footerOnly ? 'outer_shell' : 'hotspot_rank_list',
      primaryRegion: /视频总榜|低粉爆款视频榜|高完播率视频榜|高涨粉率视频榜/.test(content)
        ? 'rank_panels'
        : 'rank_shell',
      primaryRegionConfidence: footerOnly ? 'low' : /视频总榜/.test(content) ? 'high' : 'medium',
      footerOnly,
      anchorTexts,
    };
  }

  if (/趋势|关联内容|用户关注/.test(content)) {
    return {
      pageRole: 'hotspot_detail',
      primaryRegion: 'detail_evidence',
      primaryRegionConfidence: 'medium',
      footerOnly,
      anchorTexts,
    };
  }

  if (lowerUrl.includes('/creator') || lowerUrl.includes('creator')) {
    if (/账号总览|播放量|互动指数|视频完播率/.test(content)) {
      return {
        pageRole: 'creator_overview',
        primaryRegion: 'creator_metrics',
        primaryRegionConfidence: 'medium',
        footerOnly,
        anchorTexts,
      };
    }

    return {
      pageRole: 'creator_home',
      primaryRegion: footerOnly ? 'footer_shell' : 'creator_shell',
      primaryRegionConfidence: footerOnly ? 'low' : 'medium',
      footerOnly,
      anchorTexts,
    };
  }

  return {
    pageRole: footerOnly ? 'outer_shell' : 'unknown',
    primaryRegion: footerOnly ? 'footer_shell' : null,
    primaryRegionConfidence: footerOnly ? 'low' : null,
    footerOnly,
    anchorTexts,
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
}

interface SnapshotInteractiveElement {
  ref: string;
  role: string;
  name: string;
}

interface SnapshotArtifactRef {
  kind: 'dom_snapshot';
  ref: string;
}

interface CandidateActionLocator {
  type: 'aria' | 'css';
  value: string;
}

interface CandidateActionSeed {
  id: string;
  actionType: 'click' | 'fill';
  targetRef: string;
  confidence: number;
  matchReason: string;
  locatorChain: CandidateActionLocator[];
}

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
    nodes.push({
      role: String(match[1] || 'generic')
        .trim()
        .toLowerCase(),
      name: String(match[2] || '')
        .replace(/\\"/g, '"')
        .trim(),
      ref: String(match[3] || '').trim(),
      depth: Math.max(0, Math.floor(indent / 2)),
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

function scoreCompactInteractiveNode(node: SnapshotNode, index: number): number {
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

  // Keep nearby content slightly preferred without letting early chrome dominate compact mode.
  score -= Math.floor(index / 12);
  return score;
}

function prioritizeCompactNodes(
  nodes: SnapshotNode[],
  limit: number,
): SnapshotInteractiveElement[] {
  return nodes
    .filter((node) => node.ref)
    .map((node, index) => ({
      node,
      index,
      score: scoreCompactInteractiveNode(node, index),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ node }) => ({
      ref: node.ref,
      role: node.role || 'generic',
      name: node.name || '',
    }));
}

function buildInteractiveElements(
  pageContent: string,
  fallbackElements: any[],
  limit: number,
  mode: ReadPageMode,
): SnapshotInteractiveElement[] {
  const nodes = parseSnapshotNodesFromPageContent(pageContent);
  const parsedInteractive = nodes
    .filter((node) => INTERACTIVE_ROLES.has(node.role))
    .map((node, index) => {
      const nodeIndex = nodes.findIndex((candidate) => candidate.ref === node.ref);
      return {
        ...node,
        name: node.name || (nodeIndex >= 0 ? findDescendantLabel(nodes, nodeIndex) : ''),
      };
    });
  const source = parsedInteractive.length > 0 ? parsedInteractive : nodes;
  const fromSnapshot =
    mode === 'compact'
      ? prioritizeCompactNodes(source, limit)
      : source
          .filter((node) => node.ref)
          .slice(0, limit)
          .map((node) => ({
            ref: node.ref,
            role: node.role || 'generic',
            name: node.name || '',
          }));

  if (fromSnapshot.length > 0) return fromSnapshot;

  const fromFallback = Array.isArray(fallbackElements) ? fallbackElements : [];
  const fallbackNodes = fromFallback.map((item: any, index: number) => ({
    ref: String(item?.ref || item?.selector || `fallback_${index + 1}`),
    role: String(item?.type || 'generic').toLowerCase(),
    name: String(item?.text || '').trim(),
  }));
  if (mode === 'compact') {
    return prioritizeCompactNodes(fallbackNodes, limit);
  }
  return fallbackNodes.slice(0, limit).map((node) => ({
    ref: node.ref,
    role: node.role,
    name: node.name,
  }));
}

function buildArtifactRefs(tabId: number): SnapshotArtifactRef[] {
  const safeTabId = Number.isFinite(tabId) ? tabId : 0;
  return [
    { kind: 'dom_snapshot', ref: `artifact://read_page/tab-${safeTabId}/normal` },
    { kind: 'dom_snapshot', ref: `artifact://read_page/tab-${safeTabId}/full` },
  ];
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

function buildModeOutput(params: {
  mode: ReadPageMode;
  tabId: number;
  currentUrl: string;
  currentTitle: string;
  pageType: PageType;
  scheme: string;
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: 'low' | 'medium' | 'high' | null;
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
}) {
  const interactiveLimit = params.mode === 'compact' ? 24 : 80;
  const interactiveElements = buildInteractiveElements(
    params.pageContent,
    params.elements,
    interactiveLimit,
    params.mode,
  );
  const candidateActions =
    params.candidateActions.length > 0
      ? params.candidateActions
      : buildCandidateActions(interactiveElements, params.refMap);
  const artifactRefs = buildArtifactRefs(params.tabId);
  const pageContext = {
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

  const sharedPayload = {
    mode: params.mode,
    page: {
      url: params.currentUrl,
      title: params.currentTitle,
      pageType: params.pageType,
    },
    summary: {
      pageRole: params.pageRole,
      primaryRegion: params.primaryRegion,
      quality: params.contentSummary.quality,
    },
    interactiveElements,
    candidateActions,
    artifactRefs,
    pageContext,
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
    const { filter, depth, refId, mode } = args || {};

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

      // Load any user-marked elements for this URL (priority hints)
      const currentUrl = String(tab.url || '');
      const currentTitle = String(tab.title || '');
      const userMarkers = currentUrl ? await listMarkersForUrl(currentUrl) : [];
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
      const pageUnderstanding = inferPageUnderstanding(currentUrl, pageContent);

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

      // Build user-marked elements for inclusion
      const markedElements = userMarkers.map((m) => ({
        name: m.name,
        selector: m.selector,
        selectorType: m.selectorType || 'css',
        urlMatch: { type: m.matchType, origin: m.origin, path: m.path },
        source: 'marker',
        priority: 'highest',
      }));

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
      };

      // Normal path: return tree
      if (treeOk && !isSparse) {
        const modePayload = buildModeOutput({
          mode: selectedMode,
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
          const limited = fallback.elements.slice(0, 150);
          // Merge user markers at the front, de-duplicated by selector
          const markerEls = userMarkers.map((m) => ({
            type: 'marker',
            selector: m.selector,
            text: m.name,
            selectorType: m.selectorType || 'css',
            isInteractive: true,
            source: 'marker',
            priority: 'highest',
          }));
          const seen = new Set(markerEls.map((e) => e.selector));
          const merged = [...markerEls, ...limited.filter((e: any) => !seen.has(e.selector))];

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
            String(basePayload.pageContent || ''),
          );
          basePayload.pageRole = fallbackUnderstanding.pageRole;
          basePayload.primaryRegion = fallbackUnderstanding.primaryRegion;
          basePayload.primaryRegionConfidence = fallbackUnderstanding.primaryRegionConfidence;
          basePayload.footerOnly = fallbackUnderstanding.footerOnly;
          basePayload.anchorTexts = fallbackUnderstanding.anchorTexts;

          const modePayload = buildModeOutput({
            mode: selectedMode,
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
