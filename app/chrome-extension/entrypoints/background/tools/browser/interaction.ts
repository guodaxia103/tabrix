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

  if (lower.startsWith('devtools://')) {
    return {
      allowed: false,
      scheme: 'devtools',
      pageType: 'devtools_page',
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
 * B-023: raw page-local signals collected by `inject-scripts/click-helper.js`.
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
}

/**
 * B-023: browser-level signals gathered in the background layer for the
 * origin tab during the verification window.
 */
export interface ClickBrowserSignals {
  newTabOpened: boolean;
}

/**
 * B-023: pure function — given the raw signals from page-local + browser-level
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
 * B-023: register a one-shot `chrome.tabs.onCreated` listener scoped to the
 * origin window and report whether a new tab was created within the window.
 *
 * We deliberately avoid a long-lived `chrome.webNavigation` subscriber here —
 * one-shot listener + explicit removal keeps the blast radius tiny.
 */
function observeNewTabOnce(
  originWindowId: number | undefined,
  windowMs: number,
): Promise<ClickBrowserSignals> {
  return new Promise((resolve) => {
    let newTabOpened = false;
    const listener = (tab: chrome.tabs.Tab) => {
      if (originWindowId == null || tab.windowId === originWindowId) {
        newTabOpened = true;
      }
    };
    try {
      chrome.tabs.onCreated.addListener(listener);
    } catch {
      resolve({ newTabOpened: false });
      return;
    }
    setTimeout(
      () => {
        try {
          chrome.tabs.onCreated.removeListener(listener);
        } catch {
          // ignore
        }
        resolve({ newTabOpened });
      },
      Math.max(0, windowMs),
    );
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

      const resolvedTarget = resolveCandidateActionTarget({
        explicitRef: args.ref,
        explicitSelector: selector,
        explicitSelectorType: selectorType,
        candidateAction: args.candidateAction,
      });

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

      // B-023: start browser-level observation IN PARALLEL with the
      // click dispatch so we don't miss a `chrome.tabs.onCreated` firing
      // during the page-local verification window. The window must at
      // least cover the page-local window (400ms) to stay consistent
      // with `click-helper.js`.
      const NEW_TAB_OBSERVE_WINDOW_MS = Math.max(
        400,
        waitForNavigation ? Number(timeout) || 400 : 400,
      );
      const browserSignalsPromise = observeNewTabOnce(tab.windowId, NEW_TAB_OBSERVE_WINDOW_MS);

      // Send click message to content script
      const result = await this.sendMessageToTab(
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

      // B-023: if the helper returned an explicit error, propagate it
      // verbatim with the contract fields zeroed out (no dispatch, no
      // observed outcome to merge).
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: merged.success,
              dispatchSucceeded: merged.dispatchSucceeded,
              observedOutcome: merged.observedOutcome,
              verification: merged.verification,
              // One-release compat field; equals verification.navigationOccurred.
              navigationOccurred: merged.verification.navigationOccurred,
              message: merged.success
                ? `Click observed outcome: ${merged.observedOutcome}`
                : merged.observedOutcome === 'no_observed_change'
                  ? 'Click was dispatched but no observable outcome was detected within the verification window'
                  : `Click dispatched; outcome unverified (${merged.observedOutcome})`,
              elementInfo: result?.elementInfo,
              clickMethod,
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
      });

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
