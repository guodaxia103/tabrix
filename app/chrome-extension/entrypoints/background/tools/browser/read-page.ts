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

interface ReadPageParams {
  filter?: 'interactive'; // when omitted, return all visible elements
  depth?: number; // maximum DOM depth to traverse (0 = root only)
  refId?: string; // focus on subtree rooted at this refId
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
}

type PageRole =
  | 'unknown'
  | 'hotspot_rank_list'
  | 'hotspot_topic_list'
  | 'hotspot_detail'
  | 'creator_home'
  | 'creator_overview'
  | 'login_required'
  | 'extension_page'
  | 'browser_internal_page'
  | 'devtools_page'
  | 'outer_shell';

type Confidence = 'low' | 'medium' | 'high';
type PageType =
  | 'web_page'
  | 'extension_page'
  | 'browser_internal_page'
  | 'devtools_page'
  | 'unsupported_page';

interface PageUnderstandingSummary {
  pageRole: PageRole;
  primaryRegion: string;
  primaryRegionConfidence: Confidence;
  footerOnly: boolean;
  anchorTexts: string[];
}

interface Preconditions {
  loginRequired: boolean;
  accountDataMissing: boolean;
  contentSampleMissing: boolean;
}

interface SchemeGuardSummary {
  scheme: string;
  pageType: PageType;
  supportedForContentScript: boolean;
  pageRole: PageRole;
  primaryRegion: string;
  unsupportedPageType: string | null;
  recommendedAction: string | null;
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

function findAnchorTexts(pageContent: string, candidates: string[]): string[] {
  return candidates.filter((candidate) => pageContent.includes(candidate));
}

function inferSchemeGuard(url: string): SchemeGuardSummary {
  const raw = String(url || '');
  const lower = raw.toLowerCase();

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return {
      scheme: lower.startsWith('https://') ? 'https' : 'http',
      pageType: 'web_page',
      supportedForContentScript: true,
      pageRole: 'unknown',
      primaryRegion: 'document',
      unsupportedPageType: null,
      recommendedAction: null,
    };
  }

  if (lower.startsWith('chrome-extension://')) {
    return {
      scheme: 'chrome-extension',
      pageType: 'extension_page',
      supportedForContentScript: false,
      pageRole: 'extension_page',
      primaryRegion: 'extension_surface',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('chrome://')) {
    return {
      scheme: 'chrome',
      pageType: 'browser_internal_page',
      supportedForContentScript: false,
      pageRole: 'browser_internal_page',
      primaryRegion: 'browser_surface',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('devtools://')) {
    return {
      scheme: 'devtools',
      pageType: 'devtools_page',
      supportedForContentScript: false,
      pageRole: 'devtools_page',
      primaryRegion: 'devtools_surface',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  const scheme = raw.includes(':') ? raw.slice(0, raw.indexOf(':')).toLowerCase() : 'unknown';
  return {
    scheme,
    pageType: 'unsupported_page',
    supportedForContentScript: false,
    pageRole: 'outer_shell',
    primaryRegion: 'unsupported_surface',
    unsupportedPageType: 'non_web_tab',
    recommendedAction: 'switch_to_http_tab',
  };
}

function inferPageUnderstanding(pageContent: string, url: string, title: string): PageUnderstandingSummary {
  const footerAnchors = findAnchorTexts(pageContent, [
    '帐号授权协议',
    '用户服务协议',
    '隐私政策',
    '联系我们',
    '京ICP备',
    '北京抖音科技有限公司',
  ]);
  const hotspotRankAnchors = findAnchorTexts(pageContent, [
    '视频总榜',
    '低粉爆款视频榜',
    '高完播率视频榜',
    '高涨粉率视频榜',
  ]);
  const hotspotTopicAnchors = findAnchorTexts(pageContent, ['话题总榜', '热度飙升的话题榜']);
  const hotspotDetailAnchors = findAnchorTexts(pageContent, [
    '趋势',
    '关联内容',
    '相关内容',
    '用户关注点',
    '用户关注',
    '关注点',
  ]);
  const creatorHomeAnchors = findAnchorTexts(pageContent, [
    '数据中心',
    '最新作品',
    '数据总览',
    '近期作品',
  ]);
  const creatorOverviewAnchors = findAnchorTexts(pageContent, [
    '账号诊断',
    '账号总览',
    '数据表现',
    '视频播放量',
    '互动指数',
  ]);
  const loginAnchors = findAnchorTexts(pageContent, [
    '请输入手机号',
    '请输入验证码',
    '获取验证码',
    '国家/地区',
  ]);

  const footerOnly =
    footerAnchors.length >= 2 &&
    hotspotRankAnchors.length === 0 &&
    hotspotTopicAnchors.length === 0 &&
    hotspotDetailAnchors.length < 2 &&
    creatorHomeAnchors.length === 0 &&
    creatorOverviewAnchors.length === 0;

  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();

  if (loginAnchors.length >= 2) {
    return {
      pageRole: 'login_required',
      primaryRegion: 'login_gate',
      primaryRegionConfidence: 'high',
      footerOnly: false,
      anchorTexts: loginAnchors,
    };
  }

  if (creatorOverviewAnchors.length >= 2) {
    return {
      pageRole: 'creator_overview',
      primaryRegion: creatorOverviewAnchors[0] || 'creator_overview',
      primaryRegionConfidence: 'high',
      footerOnly: false,
      anchorTexts: creatorOverviewAnchors,
    };
  }

  if (
    creatorHomeAnchors.length >= 2 ||
    (lowerUrl.includes('creator') && (pageContent.includes('最新作品') || pageContent.includes('数据中心')))
  ) {
    return {
      pageRole: 'creator_home',
      primaryRegion: creatorHomeAnchors[0] || 'creator_home',
      primaryRegionConfidence: creatorHomeAnchors.length >= 2 ? 'high' : 'medium',
      footerOnly: false,
      anchorTexts: creatorHomeAnchors,
    };
  }

  if (hotspotDetailAnchors.length >= 2) {
    return {
      pageRole: 'hotspot_detail',
      primaryRegion: hotspotDetailAnchors.slice(0, 2).join(' / '),
      primaryRegionConfidence: 'high',
      footerOnly: false,
      anchorTexts: hotspotDetailAnchors,
    };
  }

  if (
    hotspotTopicAnchors.length >= 1 ||
    lowerUrl.includes('active_tab=hotspot_topic') ||
    lowerTitle.includes('热榜广场')
  ) {
    return {
      pageRole: footerOnly ? 'outer_shell' : 'hotspot_topic_list',
      primaryRegion: footerOnly ? 'footer' : hotspotTopicAnchors[0] || 'topic_list',
      primaryRegionConfidence:
        footerOnly ? 'low' : hotspotTopicAnchors.length >= 1 ? 'high' : 'medium',
      footerOnly,
      anchorTexts: hotspotTopicAnchors,
    };
  }

  if (
    hotspotRankAnchors.length >= 1 ||
    lowerUrl.includes('active_tab=hotspot_all') ||
    pageContent.includes('榜单聚合')
  ) {
    return {
      pageRole: footerOnly ? 'outer_shell' : 'hotspot_rank_list',
      primaryRegion: footerOnly ? 'footer' : hotspotRankAnchors[0] || 'rank_list',
      primaryRegionConfidence:
        footerOnly ? 'low' : hotspotRankAnchors.length >= 1 ? 'high' : 'medium',
      footerOnly,
      anchorTexts: hotspotRankAnchors,
    };
  }

  if (footerOnly) {
    return {
      pageRole: 'outer_shell',
      primaryRegion: 'footer',
      primaryRegionConfidence: 'low',
      footerOnly: true,
      anchorTexts: footerAnchors,
    };
  }

  return {
    pageRole: 'unknown',
    primaryRegion: 'document',
    primaryRegionConfidence: 'low',
    footerOnly: false,
    anchorTexts: [],
  };
}

function inferPreconditions(pageContent: string, pageRole: PageRole, url: string): Preconditions {
  const creatorLike = url.toLowerCase().includes('creator');
  const hasCreatorMetrics =
    pageContent.includes('播放量') ||
    pageContent.includes('主页访问量') ||
    pageContent.includes('视频播放量') ||
    pageContent.includes('互动指数');

  return {
    loginRequired: pageRole === 'login_required',
    accountDataMissing: creatorLike && pageRole !== 'login_required' && !hasCreatorMetrics,
    contentSampleMissing:
      pageContent.includes('近30天未发布新作品') || pageContent.includes('未发布新作品'),
  };
}

class ReadPageTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.READ_PAGE;

  // Execute read page
  async execute(args: ReadPageParams): Promise<ToolResult> {
    const { filter, depth, refId } = args || {};

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
          `- generic "Current tab is not a regular web page"`,
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
                filter: filter || 'all',
                pageContent: guardPageContent,
                contentSummary: summarizePageContent(guardPageContent),
                tips: standardTips,
                viewport: { width: null, height: null, dpr: null },
                stats: { processed: 0, included: 0, durationMs: 0 },
                refMapCount: 0,
                sparse: true,
                depth: requestedDepth ?? null,
                focus: focusRefId ? { refId: focusRefId, found: false } : null,
                markedElements: [],
                elements: [],
                count: 0,
                fallbackUsed: false,
                fallbackSource: null,
                reason: 'unsupported_page_type',
                pageRole: schemeGuard.pageRole,
                primaryRegion: schemeGuard.primaryRegion,
                primaryRegionConfidence: 'high',
                footerOnly: false,
                anchorTexts: currentTitle ? [currentTitle] : [],
                preconditions: {
                  loginRequired: false,
                  accountDataMissing: false,
                  contentSampleMissing: false,
                },
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
        filter: filter || 'all',
        pageContent,
        contentSummary,
        tips: standardTips,
        viewport: treeOk ? resp.viewport : { width: null, height: null, dpr: null },
        stats: stats || { processed: 0, included: 0, durationMs: 0 },
        refMapCount: refCount,
        sparse: treeOk ? isSparse : false,
        depth: requestedDepth ?? null,
        focus: focusRefId ? { refId: focusRefId, found: treeOk } : null,
        markedElements,
        elements: [],
        count: 0,
        fallbackUsed: false,
        fallbackSource: null,
        reason: null,
        pageRole: 'unknown',
        primaryRegion: 'document',
        primaryRegionConfidence: 'low',
        footerOnly: false,
        anchorTexts: [],
        preconditions: {
          loginRequired: false,
          accountDataMissing: false,
          contentSampleMissing: false,
        },
        pageType: schemeGuard.pageType,
        scheme: schemeGuard.scheme,
        unsupportedPageType: schemeGuard.unsupportedPageType,
        recommendedAction: schemeGuard.recommendedAction,
      };

      const applyPageUnderstanding = () => {
        const summary = inferPageUnderstanding(basePayload.pageContent || '', currentUrl, currentTitle);
        basePayload.pageRole = summary.pageRole;
        basePayload.primaryRegion = summary.primaryRegion;
        basePayload.primaryRegionConfidence = summary.primaryRegionConfidence;
        basePayload.footerOnly = summary.footerOnly;
        basePayload.anchorTexts = summary.anchorTexts;
        basePayload.preconditions = inferPreconditions(
          basePayload.pageContent || '',
          summary.pageRole,
          currentUrl,
        );
      };

      // Normal path: return tree
      if (treeOk && !isSparse) {
        applyPageUnderstanding();
        return {
          content: [{ type: 'text', text: JSON.stringify(basePayload) }],
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
            basePayload.contentSummary = summarizePageContent(basePayload.pageContent);
          }
          applyPageUnderstanding();

          return {
            content: [{ type: 'text', text: JSON.stringify(basePayload) }],
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
