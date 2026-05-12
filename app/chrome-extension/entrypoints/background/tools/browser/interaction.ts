import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import {
  TOOL_NAMES,
  type ClickObservedOutcome,
  type ClickVerification,
  isClickSuccessOutcome,
} from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';
import { handleDownloadTool, markNextDownloadAsInteractive } from './download';
import { prearmDialogHandling } from './dialog-prearm';
import { type CandidateActionInput, resolveCandidateActionTarget } from './candidate-action';
import { lookupStableTargetRef } from './stable-target-ref-registry';
import { armActionOutcome } from '../../observers/action-outcome-singleton';
import {
  CLICK_VERIFIER_READBACK_MAX_MS,
  type ClickVerifierContext,
  type ClickVerifierResult,
  isVerifierContextRequested,
  runClickVerifier,
} from './click-verifier';

/**
 * Explicit lane label on every click response. The Tabrix extension-first
 * execution lane is `tabrix_owned`. If a future code path ever introduces
 * a CDP / debugger / external-controller fallback, that path MUST set a
 * different lane value on its response so silent lane drift is visible to
 * release-evidence consumers. This is observability, not enforcement.
 */
const TABRIX_OWNED_LANE = 'tabrix_owned';

const NEW_TAB_OBSERVE_AMBIGUOUS_CAP_MS = 75;
const NEW_TAB_OBSERVE_VERIFIER_CAP_BUFFER_MS = 50;
export const NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS =
  CLICK_VERIFIER_READBACK_MAX_MS + NEW_TAB_OBSERVE_VERIFIER_CAP_BUFFER_MS;

interface Coordinates {
  x: number;
  y: number;
}

interface ClickToolParams {
  selector?: string; // CSS selector or XPath for the element to click
  selectorType?: 'css' | 'xpath'; // Type of selector (default: 'css')
  ref?: string; // Element ref from accessibility tree (window.__claudeElementMap)
  candidateAction?: CandidateActionInput; // Optional action seed from read_page
  coordinates?: Coordinates; // Coordinates to click at (x, y relative to viewport)
  waitForNavigation?: boolean; // Whether to wait for navigation to complete after click
  timeout?: number; // Timeout in milliseconds for waiting for the element or navigation
  frameId?: number; // Target frame for ref/selector resolution
  double?: boolean; // Perform double click when true
  button?: 'left' | 'right' | 'middle';
  bubbles?: boolean;
  cancelable?: boolean;
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
  allowDownloadClick?: boolean;
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
  // Internal-only opt-in for family-aware post-click verification. Not
  // exposed on the public MCP input schema; intended to be wired from
  // internal helpers / tests until a public contract is settled.
  verifierContext?: ClickVerifierContext;
}

interface InteractionSchemeGuard {
  allowed: boolean;
  scheme: string;
  pageType:
    | 'web_page'
    | 'extension_page'
    | 'browser_internal_page'
    | 'devtools_page'
    | 'unsupported_page';
  unsupportedPageType: string | null;
  recommendedAction: string | null;
}

function inferInteractionSchemeGuard(url: string): InteractionSchemeGuard {
  const raw = String(url || '');
  const lower = raw.toLowerCase();

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return {
      allowed: true,
      scheme: lower.startsWith('https://') ? 'https' : 'http',
      pageType: 'web_page',
      unsupportedPageType: null,
      recommendedAction: null,
    };
  }

  if (lower.startsWith('chrome-extension://')) {
    return {
      allowed: false,
      scheme: 'chrome-extension',
      pageType: 'extension_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('chrome://') || lower.startsWith('edge://') || lower.startsWith('about:')) {
    return {
      allowed: false,
      scheme: lower.startsWith('edge://')
        ? 'edge'
        : lower.startsWith('about:')
          ? 'about'
          : 'chrome',
      pageType: 'browser_internal_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('chrome-error://')) {
    return {
      allowed: false,
      scheme: 'chrome-error',
      pageType: 'browser_internal_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('devtools://')) {
    return {
      allowed: false,
      scheme: 'devtools',
      pageType: 'devtools_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('view-source:') || lower.startsWith('file://')) {
    return {
      allowed: false,
      scheme: lower.startsWith('view-source:') ? 'view-source' : 'file',
      pageType: 'unsupported_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  const scheme = raw.includes(':') ? raw.slice(0, raw.indexOf(':')).toLowerCase() : 'unknown';
  return {
    allowed: false,
    scheme,
    pageType: 'unsupported_page',
    unsupportedPageType: 'non_web_tab',
    recommendedAction: 'switch_to_http_tab',
  };
}

function createUnsupportedTabResponse(
  action: string,
  tab: chrome.tabs.Tab,
  guard: InteractionSchemeGuard,
): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          action,
          reason: 'unsupported_page_type',
          pageType: guard.pageType,
          scheme: guard.scheme,
          unsupportedPageType: guard.unsupportedPageType,
          recommendedAction: guard.recommendedAction,
          message: `Current tab is not a regular web page for ${action}`,
          tabId: tab.id ?? null,
          title: String(tab.title || ''),
          url: String(tab.url || ''),
        }),
      },
    ],
    isError: false,
  };
}

/**
 * Raw page-local signals collected by `inject-scripts/click-helper.js`.
 * These are facts, not verdicts. The verdict is computed in
 * `mergeClickSignals()` by combining these with browser-level signals
 * observed in the background layer (e.g. a new tab being created).
 */
export interface ClickPageSignals {
  beforeUnloadFired: boolean;
  urlBefore: string;
  urlAfter: string;
  hashBefore: string;
  hashAfter: string;
  domChanged: boolean;
  domAddedDialog: boolean;
  domAddedMenu: boolean;
  focusChanged: boolean;
  targetStateDelta: Record<string, unknown> | null;
  waitDiagnostics?: {
    verification?: { waitedMs: number; reason: string };
  };
}

/**
 * Browser-level signals gathered in the background layer for the origin tab
 * during the verification window.
 */
export interface ClickBrowserSignals {
  newTabOpened: boolean;
  waitDiagnostics?: {
    newTabObservation: {
      waitedMs: number;
      reason:
        | 'new_tab_created'
        | 'tab_query_delta'
        | 'page_strong_outcome_observed'
        | 'page_outcome_observed'
        | 'ambiguous_cap_elapsed'
        | 'listener_unavailable';
      maxMs: number;
    };
  };
}

type ClickDiffUrlDelta = 'none' | 'hash_only' | 'same_origin' | 'cross_origin' | 'unavailable';

type ClickDiffSummary =
  | { kind: 'no_change' }
  | {
      kind: 'change';
      urlDelta: ClickDiffUrlDelta;
      hashChanged: boolean;
      newTabOpened: boolean;
      beforeUnloadFired: boolean;
      domChanged: boolean;
      dialogAdded: boolean;
      menuAdded: boolean;
      focusChanged: boolean;
      stateChanged: boolean;
    };

function classifyClickUrlDelta(page: ClickPageSignals): ClickDiffUrlDelta {
  if (page.urlBefore === page.urlAfter) {
    return page.hashBefore !== page.hashAfter ? 'hash_only' : 'none';
  }
  try {
    const before = new URL(page.urlBefore);
    const after = new URL(page.urlAfter);
    return before.origin === after.origin ? 'same_origin' : 'cross_origin';
  } catch {
    return 'unavailable';
  }
}

function buildClickDiffSummary(
  page: ClickPageSignals | null,
  browser: ClickBrowserSignals,
): ClickDiffSummary {
  const stateChanged = page?.targetStateDelta != null;
  const urlDelta = page ? classifyClickUrlDelta(page) : 'unavailable';
  const hashChanged = page ? page.hashBefore !== page.hashAfter : false;
  const beforeUnloadFired = page?.beforeUnloadFired === true;
  const domChanged = page?.domChanged === true;
  const dialogAdded = page?.domAddedDialog === true;
  const menuAdded = page?.domAddedMenu === true;
  const focusChanged = page?.focusChanged === true;

  const hasChange =
    browser.newTabOpened ||
    beforeUnloadFired ||
    urlDelta !== 'none' ||
    domChanged ||
    dialogAdded ||
    menuAdded ||
    focusChanged ||
    stateChanged;

  if (!hasChange) {
    return { kind: 'no_change' };
  }

  return {
    kind: 'change',
    urlDelta,
    hashChanged,
    newTabOpened: browser.newTabOpened,
    beforeUnloadFired,
    domChanged,
    dialogAdded,
    menuAdded,
    focusChanged,
    stateChanged,
  };
}

/**
 * Pure function: given the raw signals from page-local + browser-level
 * sources, produce the public click contract fields.
 *
 * Ordering of the outcome checks matters: it encodes Tabrix's preference
 * for the most specific explanation of what the user saw.
 *
 * Exported for direct unit-testing from `tests/click-contract.test.ts`.
 */
export function mergeClickSignals(
  dispatchSucceeded: boolean,
  page: ClickPageSignals | null,
  browser: ClickBrowserSignals,
): {
  success: boolean;
  dispatchSucceeded: boolean;
  observedOutcome: ClickObservedOutcome;
  verification: ClickVerification;
} {
  if (!dispatchSucceeded || page == null) {
    const verification: ClickVerification = {
      navigationOccurred: false,
      urlChanged: false,
      newTabOpened: browser.newTabOpened,
      domChanged: false,
      stateChanged: false,
      focusChanged: false,
    };
    return {
      success: false,
      dispatchSucceeded,
      observedOutcome: dispatchSucceeded ? 'verification_unavailable' : 'no_observed_change',
      verification,
    };
  }

  const urlChanged = page.urlBefore !== page.urlAfter;
  const hashOnlyChanged =
    urlChanged &&
    stripHash(page.urlBefore) === stripHash(page.urlAfter) &&
    page.hashBefore !== page.hashAfter;
  const sameHost =
    urlChanged &&
    !hashOnlyChanged &&
    (() => {
      try {
        const a = new URL(page.urlBefore);
        const b = new URL(page.urlAfter);
        return a.host === b.host;
      } catch {
        return false;
      }
    })();
  const stateChanged = page.targetStateDelta != null;

  const verification: ClickVerification = {
    navigationOccurred: page.beforeUnloadFired,
    urlChanged,
    newTabOpened: browser.newTabOpened,
    domChanged: page.domChanged,
    stateChanged,
    focusChanged: page.focusChanged,
  };

  // Outcome priority: the most specific and most "this is what the user
  // saw" categories come first. `dom_changed` and `focus_changed` are
  // catch-alls at the bottom.
  let observedOutcome: ClickObservedOutcome;
  if (browser.newTabOpened) {
    observedOutcome = 'new_tab_opened';
  } else if (page.beforeUnloadFired) {
    observedOutcome = 'cross_document_navigation';
  } else if (hashOnlyChanged) {
    observedOutcome = 'hash_change';
  } else if (urlChanged && sameHost) {
    observedOutcome = 'spa_route_change';
  } else if (urlChanged) {
    // Cross-host client-side URL change without unload. Rare but real.
    observedOutcome = 'spa_route_change';
  } else if (page.domAddedDialog) {
    observedOutcome = 'dialog_opened';
  } else if (page.domAddedMenu) {
    observedOutcome = 'menu_opened';
  } else if (stateChanged) {
    observedOutcome = 'state_toggled';
  } else if (page.domChanged) {
    observedOutcome = 'dom_changed';
  } else if (page.focusChanged) {
    observedOutcome = 'focus_changed';
  } else {
    observedOutcome = 'no_observed_change';
  }

  return {
    success: isClickSuccessOutcome(observedOutcome),
    dispatchSucceeded,
    observedOutcome,
    verification,
  };
}

function stripHash(url: string): string {
  const i = url.indexOf('#');
  return i >= 0 ? url.slice(0, i) : url;
}

/**
 * Observe new-tab creation for the lifetime of a single click interaction,
 * then keep the listener alive for a tiny drain window so we do not miss a
 * late-delivered `chrome.tabs.onCreated` event right after the page helper
 * returns.
 *
 * We deliberately avoid a long-lived `chrome.webNavigation` subscriber here —
 * one-shot listener + explicit removal keeps the blast radius tiny.
 *
 * Exported for direct unit-testing from `tests/click-contract.test.ts`.
 */
export function observeNewTabUntil(
  originWindowId: number | undefined,
  interactionPromise: Promise<unknown>,
  options:
    | number
    | { maxMs?: number; verifierRequested?: boolean } = NEW_TAB_OBSERVE_AMBIGUOUS_CAP_MS,
): Promise<ClickBrowserSignals> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maxMs =
      typeof options === 'number'
        ? Math.max(0, options)
        : Math.max(0, options.maxMs ?? NEW_TAB_OBSERVE_AMBIGUOUS_CAP_MS);
    const verifierRequested =
      typeof options === 'object' && options != null && options.verifierRequested === true;
    let newTabOpened = false;
    let interactionSettled = false;
    let resolved = false;
    let baselineTabIds: Set<number> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const listener = (tab: chrome.tabs.Tab) => {
      if (originWindowId == null || tab.windowId === originWindowId) {
        newTabOpened = true;
        if (interactionSettled) {
          finalize('new_tab_created');
        }
      }
    };
    const finalize = (
      reason: NonNullable<ClickBrowserSignals['waitDiagnostics']>['newTabObservation']['reason'],
    ) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      try {
        chrome.tabs.onCreated.removeListener(listener);
      } catch {
        // ignore
      }
      resolve({
        newTabOpened,
        waitDiagnostics: {
          newTabObservation: {
            waitedMs: Math.max(0, Date.now() - startedAt),
            reason,
            maxMs,
          },
        },
      });
    };
    try {
      chrome.tabs.onCreated.addListener(listener);
    } catch {
      resolve({
        newTabOpened: false,
        waitDiagnostics: {
          newTabObservation: {
            waitedMs: Math.max(0, Date.now() - startedAt),
            reason: 'listener_unavailable',
            maxMs,
          },
        },
      });
      return;
    }
    const captureBaseline = async () => {
      try {
        const tabs = await chrome.tabs.query(
          originWindowId == null ? {} : { windowId: originWindowId },
        );
        baselineTabIds = new Set(
          tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number'),
        );
      } catch {
        baselineTabIds = null;
      }
    };
    void captureBaseline();
    const readPageSignals = (value: unknown): ClickPageSignals | null =>
      value && typeof value === 'object' && 'signals' in value
        ? ((value as { signals?: ClickPageSignals | null }).signals ?? null)
        : null;
    const pageSignalsHaveStrongOutcome = (value: unknown): boolean => {
      const page = readPageSignals(value);
      if (!page) return false;
      return (
        page.beforeUnloadFired ||
        page.urlBefore !== page.urlAfter ||
        page.hashBefore !== page.hashAfter ||
        page.domAddedDialog ||
        page.domAddedMenu ||
        page.targetStateDelta != null
      );
    };
    const pageSignalsHaveWeakOutcome = (value: unknown): boolean => {
      const page = readPageSignals(value);
      if (!page) return false;
      return (
        page.beforeUnloadFired ||
        page.urlBefore !== page.urlAfter ||
        page.hashBefore !== page.hashAfter ||
        page.domAddedDialog ||
        page.domAddedMenu ||
        page.targetStateDelta != null ||
        page.focusChanged
      );
    };
    const checkTabDelta = async (): Promise<boolean> => {
      if (!baselineTabIds) return false;
      try {
        const tabs = await chrome.tabs.query(
          originWindowId == null ? {} : { windowId: originWindowId },
        );
        return tabs.some((tab) => typeof tab.id === 'number' && !baselineTabIds!.has(tab.id));
      } catch {
        return false;
      }
    };
    const afterInteraction = async (value: unknown) => {
      interactionSettled = true;
      if (newTabOpened) {
        finalize('new_tab_created');
        return;
      }
      if (pageSignalsHaveStrongOutcome(value)) {
        finalize('page_strong_outcome_observed');
        return;
      }
      if (!verifierRequested && pageSignalsHaveWeakOutcome(value)) {
        finalize('page_outcome_observed');
        return;
      }
      if (await checkTabDelta()) {
        newTabOpened = true;
        finalize('tab_query_delta');
        return;
      }
      timeoutId = setTimeout(() => finalize('ambiguous_cap_elapsed'), maxMs);
    };
    void interactionPromise.then(afterInteraction, () => afterInteraction(null));
  });
}

/**
 * Tool for clicking elements on web pages
 */
class ClickTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLICK;

  private async preflightDownloadIntercept(
    tabId: number,
    args: { selector?: string; ref?: string; frameId?: number },
  ): Promise<{
    interceptedDownload: boolean;
    downloadUrl?: string;
    downloadFilename?: string | null;
  }> {
    if (!args.selector && !args.ref) {
      return { interceptedDownload: false };
    }
    try {
      const target: chrome.scripting.InjectionTarget = {
        tabId,
        ...(typeof args.frameId === 'number' ? { frameIds: [args.frameId] } : {}),
      };
      const [injection] = await chrome.scripting.executeScript({
        target,
        func: (params: { selector?: string; ref?: string }) => {
          let element: Element | null = null;
          if (params.ref && typeof params.ref === 'string') {
            try {
              const map = (window as any).__claudeElementMap;
              const weak = map && map[params.ref];
              const deref = weak && typeof weak.deref === 'function' ? weak.deref() : null;
              if (deref instanceof Element) {
                element = deref;
              }
            } catch {
              // ignore
            }
          } else if (params.selector && typeof params.selector === 'string') {
            element = document.querySelector(params.selector);
          }
          if (!element) return { interceptedDownload: false };

          const anchor =
            element instanceof HTMLAnchorElement ? element : element.closest?.('a[href]') || null;
          if (!anchor || !(anchor instanceof HTMLAnchorElement)) {
            return { interceptedDownload: false };
          }

          const href = anchor.href || '';
          const downloadAttr = anchor.getAttribute('download');
          const anchorText = (anchor.textContent || '').trim();
          const parsed = (() => {
            try {
              return new URL(href, window.location.href);
            } catch {
              return null;
            }
          })();
          const path = parsed?.pathname || '';
          const lowerPath = path.toLowerCase();
          const lowerHref = href.toLowerCase();
          const isHashOrJs =
            href.startsWith('#') || lowerHref.startsWith('javascript:') || lowerHref.length === 0;
          const hasFileExt =
            /\.(zip|rar|7z|pdf|csv|xlsx?|docx?|pptx?|txt|json|xml|html?|md|png|jpe?g|gif|webp|mp4|mp3|wav|apk|dmg|exe)$/i.test(
              path,
            );
          const queryLooksDownload =
            /(?:[?&](download|dl|export|attachment|response-content-disposition)=)/i.test(href);
          const hrefKeyword = /\b(download|export|attachment|file)\b/i.test(href);
          const textKeyword = /\b(download|export|下载|导出)\b/i.test(anchorText);
          const likelyApiCall = /\/api(\/|$)/i.test(lowerPath) && !hasFileExt;

          let score = 0;
          if (downloadAttr !== null) score += 3;
          if (hasFileExt) score += 2;
          if (queryLooksDownload) score += 2;
          if (hrefKeyword) score += 1;
          if (textKeyword) score += 1;
          if (likelyApiCall) score -= 2;

          if (!isHashOrJs && score >= 2) {
            return {
              interceptedDownload: true,
              downloadUrl: href,
              downloadFilename: (downloadAttr || '').trim() || null,
            };
          }
          return { interceptedDownload: false };
        },
        args: [{ selector: args.selector, ref: args.ref }],
      });
      const result = injection?.result as
        | { interceptedDownload?: boolean; downloadUrl?: string; downloadFilename?: string | null }
        | undefined;
      return {
        interceptedDownload: result?.interceptedDownload === true,
        downloadUrl: result?.downloadUrl,
        downloadFilename: result?.downloadFilename ?? null,
      };
    } catch {
      return { interceptedDownload: false };
    }
  }

  /**
   * Execute click operation
   */
  async execute(args: ClickToolParams): Promise<ToolResult> {
    const {
      selector,
      selectorType = 'css',
      coordinates,
      waitForNavigation = false,
      timeout = TIMEOUTS.DEFAULT_WAIT * 5,
      frameId,
      button,
      bubbles,
      cancelable,
      modifiers,
    } = args;

    console.log(`Starting click operation with options:`, args);

    if (!selector && !coordinates && !args.ref && !args.candidateAction) {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS +
          ': Provide ref or selector or coordinates (or candidateAction)',
      );
    }

    try {
      // Resolve tab
      const explicit = await this.tryGetTab(args.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }
      const schemeGuard = inferInteractionSchemeGuard(String(tab.url || ''));
      if (!schemeGuard.allowed) {
        return createUnsupportedTabResponse('click', tab, schemeGuard);
      }

      // Snapshot the pre-click URL so the verifier can report
      // `postClickState.beforeUrl` without chasing tab.url after navigation.
      const beforeUrl = typeof tab.url === 'string' ? tab.url : null;

      const resolvedTarget = resolveCandidateActionTarget({
        explicitRef: args.ref,
        explicitSelector: selector,
        explicitSelectorType: selectorType,
        candidateAction: args.candidateAction,
        tabId: tab.id,
        lookupStableTargetRef,
      });

      // When a stable targetRef was supplied but the per-tab snapshot
      // registry has no live mapping, fail closed with a clear
      // remediation message. Falling back to the raw `tgt_*` would
      // always miss in the content script and waste a click.
      if (resolvedTarget.source === 'unresolved_stable_target_ref') {
        return createErrorResponse(
          `${ERROR_MESSAGES.INVALID_PARAMETERS}: candidateAction.targetRef "${
            resolvedTarget.unresolvedStableTargetRef
          }" is a stable id, but no current snapshot of this tab has it. Call chrome_read_page on this tab first, then re-issue the click with the latest targetRef.`,
        );
      }

      let finalRef = resolvedTarget.ref;
      let finalSelector = resolvedTarget.selector;
      const finalSelectorType = resolvedTarget.selectorType || selectorType;

      if (!coordinates && !finalRef && !finalSelector) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': Provide ref or selector or coordinates (candidateAction did not resolve target)',
        );
      }

      // If selector is XPath, convert to ref first
      if (finalSelector && finalSelectorType === 'xpath') {
        await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
        try {
          const resolved = await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
              selector: finalSelector,
              isXPath: true,
            },
            frameId,
          );
          if (resolved && resolved.success && resolved.ref) {
            finalRef = resolved.ref;
            finalSelector = undefined; // Use ref instead of selector
          } else {
            return createErrorResponse(
              `Failed to resolve XPath selector: ${resolved?.error || 'unknown error'}`,
            );
          }
        } catch (error) {
          return createErrorResponse(
            `Error resolving XPath: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (args.allowDownloadClick !== true) {
        const preflight = await this.preflightDownloadIntercept(tab.id, {
          selector: finalSelector,
          ref: finalRef,
          frameId,
        });
        if (preflight.interceptedDownload && preflight.downloadUrl) {
          const downloadResult = await handleDownloadTool.execute({
            url: String(preflight.downloadUrl),
            filename: preflight.downloadFilename ? String(preflight.downloadFilename) : undefined,
            saveAs: false,
            waitForComplete: true,
            timeoutMs: 60000,
          });

          if (downloadResult.isError) {
            return createErrorResponse(
              `Download link preflight intercept failed: ${
                (downloadResult.content?.[0] as any)?.text || 'unknown error'
              }`,
            );
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message:
                    'Download link was preflight-intercepted and handled via chrome_handle_download (silent mode).',
                  clickMethod: 'intercepted-download',
                  downloadUrl: preflight.downloadUrl,
                  downloadFilename: preflight.downloadFilename || null,
                  download: (() => {
                    try {
                      return JSON.parse((downloadResult.content?.[0] as any)?.text || '{}')
                        ?.download;
                    } catch {
                      return null;
                    }
                  })(),
                }),
              },
            ],
            isError: false,
          };
        }
      }

      await this.injectContentScript(tab.id, ['inject-scripts/click-helper.js']);
      await prearmDialogHandling(tab.id);
      if (args.allowDownloadClick === true) {
        markNextDownloadAsInteractive(tab.id);
      }

      // Arm the action-outcome observer right before dispatch. Best-effort;
      // the helper returns a no-op handle when the bridge socket is not yet
      // up, so the click main path is untouched on failure. The dispatched
      // envelope's `urlPattern` is the brand-neutral host+path form (no
      // query/fragment) that the lifecycle/network observers already use.
      const actionUrlPattern = (() => {
        if (typeof beforeUrl !== 'string') return null;
        try {
          const u = new URL(beforeUrl);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
          return `${u.hostname.toLowerCase()}${u.pathname || '/'}`;
        } catch {
          return null;
        }
      })();
      const actionOutcomeHandle = armActionOutcome({
        actionId: `click-${tab.id}-${Date.now()}`,
        actionKind: 'click',
        tabId: tab.id,
        urlPattern: actionUrlPattern,
      });

      // Arm browser-level observation before dispatch, but keep it alive until
      // the page-local helper has finished its own verification window. This
      // prevents a slow `_blank` click from being downgraded to
      // `no_observed_change` just because the background observer stopped first.
      const resultPromise = this.sendMessageToTab(
        tab.id,
        {
          action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
          selector: finalSelector,
          coordinates,
          ref: finalRef,
          waitForNavigation,
          timeout,
          double: args.double === true,
          button,
          bubbles,
          cancelable,
          modifiers,
          allowDownloadClick: args.allowDownloadClick === true,
        },
        frameId,
      );
      const verifierRequested = isVerifierContextRequested(args.verifierContext);
      const newTabObservationMaxMs = verifierRequested
        ? NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS
        : NEW_TAB_OBSERVE_AMBIGUOUS_CAP_MS;
      const browserSignalsPromise = observeNewTabUntil(tab.windowId, resultPromise, {
        maxMs: newTabObservationMaxMs,
        verifierRequested,
      });

      // Send click message to content script
      const result = await resultPromise;

      // Surface page-local DOM-region changes to the action-outcome observer
      // (best-effort). The observer also folds in background-derived signals
      // (lifecycle/tab/network) on its own.
      try {
        const pageSig = result && typeof result === 'object' ? (result as any).signals : null;
        // Real click-helper field names are `domChanged` / `domAddedDialog`
        // (see app/chrome-extension/inject-scripts/click-helper.js). The
        // `domRegionChanged` / `dialogOpened` aliases below exist only as a
        // forward-compat hook in case the helper is ever renamed; tests must
        // exercise the real names so we never silently regress.
        if (pageSig && (pageSig.domChanged === true || pageSig.domRegionChanged === true)) {
          actionOutcomeHandle.pushSignal({ kind: 'dom_region_changed' });
        }
        if (pageSig && (pageSig.domAddedDialog === true || pageSig.dialogOpened === true)) {
          actionOutcomeHandle.pushSignal({ kind: 'dialog_opened' });
        }
      } catch {
        // best-effort
      }

      if (result?.interceptedDownload && result?.downloadUrl) {
        const downloadResult = await handleDownloadTool.execute({
          url: String(result.downloadUrl),
          filename: result.downloadFilename ? String(result.downloadFilename) : undefined,
          saveAs: false,
          waitForComplete: true,
          timeoutMs: 60000,
        });

        if (downloadResult.isError) {
          return createErrorResponse(
            `Download link click was blocked and auto-download failed: ${
              (downloadResult.content?.[0] as any)?.text || 'unknown error'
            }`,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message:
                  'Download link was intercepted and handled via chrome_handle_download (silent mode).',
                clickMethod: 'intercepted-download',
                downloadUrl: result.downloadUrl,
                downloadFilename: result.downloadFilename || null,
                download: (() => {
                  try {
                    return JSON.parse((downloadResult.content?.[0] as any)?.text || '{}')?.download;
                  } catch {
                    return null;
                  }
                })(),
              }),
            },
          ],
          isError: false,
        };
      }

      // Determine actual click method used
      let clickMethod: string;
      if (coordinates) {
        clickMethod = 'coordinates';
      } else if (finalRef) {
        clickMethod = 'ref';
      } else if (finalSelector) {
        clickMethod = 'selector';
      } else {
        clickMethod = 'unknown';
      }

      // If the helper returned an explicit error, propagate it verbatim with
      // the contract fields zeroed out (no dispatch, no observed outcome to
      // merge).
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        return createErrorResponse(String(result.error));
      }

      const browserSignals = await browserSignalsPromise;
      const pageSignals: ClickPageSignals | null =
        result && typeof result === 'object' && 'signals' in result && result.signals
          ? (result.signals as ClickPageSignals)
          : null;
      const dispatchSucceeded =
        result && typeof result === 'object' && 'dispatchSucceeded' in result
          ? Boolean(result.dispatchSucceeded)
          : Boolean(result?.success);

      const merged = mergeClickSignals(dispatchSucceeded, pageSignals, browserSignals);

      // Optional family-aware verifier. Runs at most one compact readback.
      // `success` collapses to false if the verifier was requested and did
      // not pass; otherwise the generic click contract is preserved as-is.
      let postClickState: {
        beforeUrl: string | null;
        afterUrl: string | null;
        pageRoleAfter: string | null;
        verifierPassed: boolean;
        verifierReason: string;
      } | null = null;
      let finalSuccess = merged.success;
      if (isVerifierContextRequested(args.verifierContext)) {
        let verifierResult: ClickVerifierResult | null = null;
        if (merged.dispatchSucceeded) {
          verifierResult = await runClickVerifier(tab.id, args.verifierContext!, beforeUrl);
        }
        if (verifierResult) {
          postClickState = {
            beforeUrl: verifierResult.beforeUrl,
            afterUrl: verifierResult.afterUrl,
            pageRoleAfter: verifierResult.pageRoleAfter,
            verifierPassed: verifierResult.passed,
            verifierReason: verifierResult.reason,
          };
          if (!verifierResult.passed) {
            finalSuccess = false;
          }
        } else {
          postClickState = {
            beforeUrl,
            afterUrl: null,
            pageRoleAfter: null,
            verifierPassed: false,
            verifierReason: merged.dispatchSucceeded
              ? 'verifier_unavailable'
              : 'verifier_skipped_dispatch_failed',
          };
          finalSuccess = false;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: finalSuccess,
              dispatchSucceeded: merged.dispatchSucceeded,
              observedOutcome: merged.observedOutcome,
              verification: merged.verification,
              clickDiff: buildClickDiffSummary(pageSignals, browserSignals),
              // One-release compat field; equals verification.navigationOccurred.
              navigationOccurred: merged.verification.navigationOccurred,
              // Explicit lane label. Always `tabrix_owned` for the
              // extension-first execution path. If a future fallback route is
              // added, that route MUST emit a different lane value so silent
              // lane drift is visible to lane-integrity metrics.
              lane: TABRIX_OWNED_LANE,
              message: finalSuccess
                ? `Click observed outcome: ${merged.observedOutcome}`
                : merged.observedOutcome === 'no_observed_change'
                  ? 'Click was dispatched but no observable outcome was detected within the verification window'
                  : postClickState && !postClickState.verifierPassed
                    ? `Click dispatched but verifier rejected the outcome (${postClickState.verifierReason})`
                    : `Click dispatched; outcome unverified (${merged.observedOutcome})`,
              elementInfo: result?.elementInfo,
              clickMethod,
              ...(postClickState ? { postClickState } : {}),
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in click operation:', error);
      return createErrorResponse(
        `Error performing click: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const clickTool = new ClickTool();

interface FillToolParams {
  selector?: string;
  selectorType?: 'css' | 'xpath'; // Type of selector (default: 'css')
  ref?: string; // Element ref from accessibility tree
  candidateAction?: CandidateActionInput; // Optional action seed from read_page
  // Accept string | number | boolean for broader form input coverage
  value: string | number | boolean;
  frameId?: number;
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
}

/**
 * Tool for filling form elements on web pages
 */
class FillTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FILL;

  /**
   * Execute fill operation
   */
  async execute(args: FillToolParams): Promise<ToolResult> {
    const { selector, selectorType = 'css', ref, value, frameId } = args;

    console.log(`Starting fill operation with options:`, args);

    if (!selector && !ref && !args.candidateAction) {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS + ': Provide ref or selector (or candidateAction)',
      );
    }

    if (value === undefined || value === null) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': Value must be provided');
    }

    try {
      const explicit = await this.tryGetTab(args.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }
      const schemeGuard = inferInteractionSchemeGuard(String(tab.url || ''));
      if (!schemeGuard.allowed) {
        return createUnsupportedTabResponse('fill', tab, schemeGuard);
      }

      const resolvedTarget = resolveCandidateActionTarget({
        explicitRef: ref,
        explicitSelector: selector,
        explicitSelectorType: selectorType,
        candidateAction: args.candidateAction,
        tabId: tab.id,
        lookupStableTargetRef,
      });

      // Same fail-closed rule as clickTool: if the caller passed a stable
      // targetRef and the registry has nothing for this tab, tell them
      // exactly how to recover instead of probing the DOM.
      if (resolvedTarget.source === 'unresolved_stable_target_ref') {
        return createErrorResponse(
          `${ERROR_MESSAGES.INVALID_PARAMETERS}: candidateAction.targetRef "${
            resolvedTarget.unresolvedStableTargetRef
          }" is a stable id, but no current snapshot of this tab has it. Call chrome_read_page on this tab first, then re-issue the fill with the latest targetRef.`,
        );
      }

      let finalRef = resolvedTarget.ref;
      let finalSelector = resolvedTarget.selector;
      const finalSelectorType = resolvedTarget.selectorType || selectorType;

      if (!finalRef && !finalSelector) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': Provide ref or selector (candidateAction did not resolve target)',
        );
      }

      // If selector is XPath, convert to ref first
      if (finalSelector && finalSelectorType === 'xpath') {
        await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
        try {
          const resolved = await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
              selector: finalSelector,
              isXPath: true,
            },
            frameId,
          );
          if (resolved && resolved.success && resolved.ref) {
            finalRef = resolved.ref;
            finalSelector = undefined; // Use ref instead of selector
          } else {
            return createErrorResponse(
              `Failed to resolve XPath selector: ${resolved?.error || 'unknown error'}`,
            );
          }
        } catch (error) {
          return createErrorResponse(
            `Error resolving XPath: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      await this.injectContentScript(tab.id, ['inject-scripts/fill-helper.js']);

      // Send fill message to content script
      const result = await this.sendMessageToTab(
        tab.id,
        {
          action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
          selector: finalSelector,
          ref: finalRef,
          value,
        },
        frameId,
      );

      if (result && result.error) {
        return createErrorResponse(result.error);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: result.message || 'Fill operation successful',
              elementInfo: result.elementInfo,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in fill operation:', error);
      return createErrorResponse(
        `Error filling element: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const fillTool = new FillTool();
