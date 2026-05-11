import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import {
  TOOL_NAMES,
  type ReadPageCompactSnapshot,
  type ReadPageFullSnapshot,
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
import { inferPageUnderstanding, type PageRole } from './read-page-understanding';
import {
  recordStableTargetRefSnapshot,
  type StableTargetRefEntry,
} from './stable-target-ref-registry';
import { inferSchemeGuard } from './read-page-scheme-guard';
import { summarizePageContent } from './read-page-content-summary';
import { buildInteractiveElements } from './read-page-interactive-elements';
import { buildCandidateActions, type CandidateActionSeed } from './read-page-candidate-actions';
import { buildArtifactRefs } from './read-page-artifact-refs';
import { buildFallbackRefMap, formatElementsAsPageContent } from './read-page-fallback-format';
import { buildExtensionLayer, buildStableSnapshotLayer } from './read-page-snapshot-builders';
import { buildReadPageModeResult } from './read-page-mode-result';
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
  render?: ReadPageRenderMode; // render mode, default 'json'
  depth?: number; // maximum DOM depth to traverse (0 = root only)
  refId?: string; // focus on subtree rooted at this refId
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
  // Layer envelope. When omitted preserves the legacy full L0+L1+L2 payload.
  // The stable HVO targetRef registry is ALWAYS written (even at 'L0') so
  // chrome_click_element resolution stays deterministic.
  requestedLayer?: ReadPageRequestedLayer;
}

const READ_PAGE_SPARSE_RETRY_DELAY_MS = 450;
const INTERACTIVE_ELEMENTS_HELPER_FILE = 'inject-scripts/interactive-elements-helper.js';
const INTERACTIVE_ELEMENTS_HELPER_PING_TIMEOUT_MS = 300;
const VISIBLE_TEXT_FALLBACK_MAX_CHARS = 12_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reconcilePageUnderstandingWithVisibleRows(payload: Record<string, any>): void {
  const rows = payload.visibleRegionRows as VisibleRegionRowsResult | undefined;
  if (payload.pageRole !== 'login_required' || !rows?.visibleRegionRowsUsed) {
    return;
  }

  payload.pageRole = 'unknown';
  payload.primaryRegion = 'visible_results';
  payload.primaryRegionConfidence = 'medium';
  payload.footerOnly = false;
  payload.visibleRegionRows = {
    ...rows,
    sourceRegion: 'visible_results',
    rows: rows.rows.map((row) => ({
      ...row,
      sourceRegion: 'visible_results',
    })),
  };
}

function completeVisibleRegionRows(params: {
  rows: VisibleRegionRowsResult;
  pageContent: string;
  visibleTextContent?: string | null;
  primaryRegion: string | null;
  interactiveElements: Array<{ ref: string; role: string; name: string; href?: string }>;
  currentUrl: string;
  currentTitle: string;
  viewport: { width: number | null; height: number | null; dpr: number | null };
}): VisibleRegionRowsResult {
  if (params.rows.visibleRegionRowsUsed) {
    return params.rows;
  }
  return extractVisibleRegionRows({
    pageContent: params.pageContent,
    visibleTextContent: params.visibleTextContent,
    sourceRegion: params.primaryRegion,
    fallbackInteractiveElements: params.interactiveElements,
    url: params.currentUrl,
    title: params.currentTitle,
    viewport: params.viewport,
  });
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
  visibleTextContent?: string | null;
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
  /** Layer envelope; defaults to 'L0+L1+L2' for legacy callers. */
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
  const visibleRegionRows = completeVisibleRegionRows({
    rows: params.visibleRegionRows,
    pageContent: params.pageContent,
    visibleTextContent: params.visibleTextContent,
    primaryRegion: params.primaryRegion,
    interactiveElements,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    viewport: params.viewport,
  });
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
    visibleRegionRows,
    requestedLayer: params.requestedLayer,
  });

  // Feed the per-tab stable-targetRef registry so the click bridge can
  // translate `tgt_*` from prior turns back into the live per-snapshot
  // `ref_*` for this exact tab. We do this exactly once per snapshot, after
  // the extension layer is built but before serializing the response, so
  // every successful read replaces the previous mapping atomically.
  if (Array.isArray(extensionLayer.highValueObjects)) {
    const entries: StableTargetRefEntry[] = [];
    for (const highValueObject of extensionLayer.highValueObjects) {
      if (highValueObject.targetRef && highValueObject.ref) {
        entries.push({ targetRef: highValueObject.targetRef, ref: highValueObject.ref });
      }
    }
    recordStableTargetRefSnapshot(params.tabId, entries);
  }

  const sharedPayload: ReadPageCompactSnapshot = {
    ...stableLayer,
    ...extensionLayer,
  };

  return buildReadPageModeResult({
    sharedPayload,
    mode: params.mode,
    primaryRegionConfidence: params.primaryRegionConfidence,
    footerOnly: params.footerOnly,
    anchorTexts: params.anchorTexts,
    pageContent: params.pageContent,
    contentSummary: params.contentSummary,
    stats: params.stats,
    elements: params.elements,
    count: params.count,
    markedElements: params.markedElements,
    refMap: params.refMap,
    reason: params.reason,
    tips: params.tips,
  });
}

class ReadPageTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.READ_PAGE;

  private async ensureInteractiveElementsHelper(tabId: number): Promise<void> {
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tabId, {
          action: `${TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS}_ping`,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('interactive elements helper ping timed out')),
            INTERACTIVE_ELEMENTS_HELPER_PING_TIMEOUT_MS,
          ),
        ),
      ]);

      if (response && (response as any).status === 'pong') {
        return;
      }
    } catch {
      // Expected when the fallback helper has not been injected on this page yet.
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [INTERACTIVE_ELEMENTS_HELPER_FILE],
      world: 'ISOLATED',
    } as any);
  }

  private async sampleVisibleTextContent(tabId: number): Promise<string | null> {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (maxChars: number) => {
          try {
            const text = document.body?.innerText || '';
            return typeof text === 'string' ? text.slice(0, maxChars) : '';
          } catch {
            return '';
          }
        },
        args: [VISIBLE_TEXT_FALLBACK_MAX_CHARS],
      } as any);
      const text = result?.[0]?.result;
      return typeof text === 'string' && text.trim() ? text : null;
    } catch {
      return null;
    }
  }

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

    // Validate render mode. Default 'json' so legacy callers see no behavior
    // change. We deliberately fail closed on unknown values rather than
    // silently coerce: an unknown render mode usually means the upstream
    // client speaks a newer contract than this extension can satisfy, and
    // silent coercion would hide that drift.
    const selectedRenderRaw = render || 'json';
    if (!['json', 'markdown'].includes(selectedRenderRaw)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: render must be one of json | markdown`,
      );
    }
    const selectedRender = selectedRenderRaw as ReadPageRenderMode;

    // Validate requestedLayer. Default to the legacy `'L0+L1+L2'` envelope
    // so older callers see byte-identical payloads. Unknown values fail
    // closed for the same reason `render` does: the upstream client almost
    // certainly speaks a newer contract than this extension can satisfy.
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
                  visibleTextContent: null,
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
      let resp = await this.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
        filter: filter || null,
        depth: requestedDepth,
        refId: focusRefId || undefined,
      });

      // Evaluate tree result and decide whether to fallback
      const treeOk = resp && resp.success === true;
      let pageContent: string =
        resp && typeof resp.pageContent === 'string' ? resp.pageContent : '';
      let lines = pageContent
        ? pageContent.split('\n').filter((l: string) => l.trim().length > 0).length
        : 0;
      let refCount = Array.isArray(resp?.refMap) ? resp.refMap.length : 0;
      let isSparse = !userControlled && lines < 10 && refCount < 3;

      if (treeOk && isSparse) {
        await delay(READ_PAGE_SPARSE_RETRY_DELAY_MS);
        const retryResp = await this.sendMessageToTab(tab.id, {
          action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
          filter: filter || null,
          depth: requestedDepth,
          refId: focusRefId || undefined,
        });
        const retryContent =
          retryResp && typeof retryResp.pageContent === 'string' ? retryResp.pageContent : '';
        const retryLines = retryContent
          ? retryContent.split('\n').filter((l: string) => l.trim().length > 0).length
          : 0;
        const retryRefCount = Array.isArray(retryResp?.refMap) ? retryResp.refMap.length : 0;
        if (retryResp?.success === true && retryLines + retryRefCount > lines + refCount) {
          resp = retryResp;
          pageContent = retryContent;
          lines = retryLines;
          refCount = retryRefCount;
          isSparse = !userControlled && lines < 10 && refCount < 3;
        }
      }

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

      const contentSummary = summarizePageContent(pageContent);

      // User markers have been removed with the Element Marker surface
      // (MKEP pruning §P7). Keep the field on the payload as an empty
      // array to preserve the outbound contract that downstream consumers
      // (telemetry, prompt builder) still reference.
      const markedElements: any[] = [];

      // Unified base payload structure - consistent keys for stable contract
      const basePayload: Record<string, any> = {
        success: true,
        mode: selectedMode,
        filter: filter || 'all',
        pageContent,
        visibleTextContent: null,
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
          url: currentUrl,
          title: currentTitle,
          viewport: treeOk ? resp.viewport : null,
          scrollY: typeof resp?.scrollY === 'number' ? resp.scrollY : null,
          pixelsBelow: typeof resp?.pixelsBelow === 'number' ? resp.pixelsBelow : null,
        }),
      };
      reconcilePageUnderstandingWithVisibleRows(basePayload);

      if (treeOk && !userControlled && !basePayload.visibleRegionRows.visibleRegionRowsUsed) {
        const visibleTextContent = await this.sampleVisibleTextContent(tab.id);
        if (visibleTextContent) {
          const visibleTextRows = extractVisibleRegionRows({
            pageContent: String(basePayload.pageContent || ''),
            visibleTextContent,
            sourceRegion: pageUnderstanding.primaryRegion,
            url: currentUrl,
            title: currentTitle,
            viewport: basePayload.viewport,
            scrollY: typeof resp?.scrollY === 'number' ? resp.scrollY : null,
            pixelsBelow: typeof resp?.pixelsBelow === 'number' ? resp.pixelsBelow : null,
          });
          if (visibleTextRows.visibleRegionRowsUsed) {
            basePayload.visibleTextContent = visibleTextContent;
            basePayload.visibleRegionRows = visibleTextRows;
            basePayload.fallbackSource = 'visible_text';
            reconcilePageUnderstandingWithVisibleRows(basePayload);
          }
        }
      }

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
          visibleTextContent: basePayload.visibleTextContent,
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

      // Fallback path: try get_interactive_elements with one short retry.
      // Newly opened MV3 pages can report document complete before the
      // injected helper is ready to answer its first runtime message.
      try {
        let fallback: any = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (attempt > 0) await delay(READ_PAGE_SPARSE_RETRY_DELAY_MS);
          await this.ensureInteractiveElementsHelper(tab.id);
          fallback = await this.sendMessageToTab(tab.id, {
            action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
            includeCoordinates: true,
          });
          if (fallback && fallback.success && Array.isArray(fallback.elements)) break;
        }

        if (fallback && fallback.success && Array.isArray(fallback.elements)) {
          const merged = fallback.elements.slice(0, 150);
          const fallbackRefMap = buildFallbackRefMap(merged);
          const fallbackRefEntryCount = fallbackRefMap.filter((entry) => entry != null).length;

          basePayload.fallbackUsed = true;
          basePayload.fallbackSource = 'get_interactive_elements';
          basePayload.reason = treeOk ? 'sparse_tree' : resp?.error || 'tree_failed';
          basePayload.elements = merged;
          basePayload.count = fallback.elements.length;
          basePayload.refMap = fallbackRefMap;
          basePayload.refMapCount = fallbackRefEntryCount;
          if (merged.length > 0 || !basePayload.pageContent) {
            basePayload.pageContent = formatElementsAsPageContent(merged, fallbackRefMap);
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
            url: currentUrl,
            title: currentTitle,
            viewport: basePayload.viewport,
            scrollY: typeof fallback?.scrollY === 'number' ? fallback.scrollY : null,
            pixelsBelow: typeof fallback?.pixelsBelow === 'number' ? fallback.pixelsBelow : null,
          });
          if (!basePayload.visibleRegionRows.visibleRegionRowsUsed) {
            const visibleTextContent = await this.sampleVisibleTextContent(tab.id);
            if (visibleTextContent) {
              basePayload.visibleTextContent = visibleTextContent;
              basePayload.visibleRegionRows = extractVisibleRegionRows({
                pageContent: String(basePayload.pageContent || ''),
                visibleTextContent,
                sourceRegion: fallbackUnderstanding.primaryRegion,
                url: currentUrl,
                title: currentTitle,
                viewport: basePayload.viewport,
                scrollY: typeof fallback?.scrollY === 'number' ? fallback.scrollY : null,
                pixelsBelow:
                  typeof fallback?.pixelsBelow === 'number' ? fallback.pixelsBelow : null,
              });
            }
          }
          reconcilePageUnderstandingWithVisibleRows(basePayload);

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
            visibleTextContent: basePayload.visibleTextContent,
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
