import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';
import { handleDownloadTool, markNextDownloadAsInteractive } from './download';

interface Coordinates {
  x: number;
  y: number;
}

interface ClickToolParams {
  selector?: string; // CSS selector or XPath for the element to click
  selectorType?: 'css' | 'xpath'; // Type of selector (default: 'css')
  ref?: string; // Element ref from accessibility tree (window.__claudeElementMap)
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

type PostActionConfidence = 'low' | 'medium' | 'high';

interface AppliedFilter {
  label: string;
  path?: string[];
  rawValue?: string;
}

interface PostActionSummary {
  urlChanged: boolean;
  domChanged: boolean;
  visibleTextChanged: boolean;
  selectedStateChanged: boolean;
  appliedFilters?: AppliedFilter[];
  mainRegionChanged: boolean;
  postActionConfidence: PostActionConfidence;
}

interface LightweightPageState {
  url: string;
  title: string;
  bodyTextDigest: string;
  mainRegionDigest: string;
  domSignature: string;
  formStateSignature: string;
  selectedLabels: string[];
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

  if (lower.startsWith('chrome://')) {
    return {
      allowed: false,
      scheme: 'chrome',
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

function buildPostActionSummary(
  before: LightweightPageState | null,
  after: LightweightPageState | null,
): PostActionSummary | null {
  if (!before || !after) {
    return null;
  }

  const urlChanged = before.url !== after.url;
  const domChanged =
    before.domSignature !== after.domSignature ||
    before.formStateSignature !== after.formStateSignature;
  const visibleTextChanged = before.bodyTextDigest !== after.bodyTextDigest;
  const selectedStateChanged = before.selectedLabels.join('|') !== after.selectedLabels.join('|');
  const mainRegionChanged = before.mainRegionDigest !== after.mainRegionDigest;

  const beforeLabels = new Set(before.selectedLabels);
  const appliedLabels = after.selectedLabels.filter((label) => !beforeLabels.has(label));
  const stableLabels = appliedLabels.length > 0 ? appliedLabels : after.selectedLabels;

  let postActionConfidence: PostActionConfidence = 'low';
  if (urlChanged || selectedStateChanged || mainRegionChanged) {
    postActionConfidence = 'high';
  } else if (domChanged || visibleTextChanged) {
    postActionConfidence = 'medium';
  }

  return {
    urlChanged,
    domChanged,
    visibleTextChanged,
    selectedStateChanged,
    appliedFilters:
      stableLabels.length > 0
        ? stableLabels.slice(0, 8).map((label) => ({
            label,
            path: [label],
            rawValue: label,
          }))
        : undefined,
    mainRegionChanged,
    postActionConfidence,
  };
}

async function captureLightweightPageState(
  tabId: number,
  frameId?: number,
): Promise<LightweightPageState | null> {
  try {
    const target: chrome.scripting.InjectionTarget = {
      tabId,
      ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}),
    };
    const [result] = await chrome.scripting.executeScript({
      target,
      func: () => {
        const normalize = (value: unknown, max = 600) => {
          if (typeof value !== 'string') return '';
          return value.replace(/\s+/g, ' ').trim().slice(0, max);
        };

        const isVisible = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        };

        const readText = (element: Element | null, max = 600) =>
          normalize(
            element instanceof HTMLElement ? element.innerText || element.textContent || '' : '',
            max,
          );

        const candidateSelectors = [
          'main',
          '[role="main"]',
          '[role="tabpanel"]',
          'article',
          'section',
          '[data-testid*="content"]',
          '[data-testid*="main"]',
          '[class*="content"]',
          '[class*="panel"]',
          '[class*="result"]',
          '[class*="main"]',
          '[class*="list"]',
        ];

        const candidateElements = candidateSelectors
          .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
          .filter(isVisible);

        const mainElement =
          candidateElements.sort(
            (left, right) => readText(right, 2000).length - readText(left, 2000).length,
          )[0] || document.body;

        const selectedSelectors = [
          '[aria-selected="true"]',
          '[aria-pressed="true"]',
          '[aria-checked="true"]',
          '[data-state="active"]',
          '[data-state="selected"]',
          '.selected',
          '.is-selected',
          '.is-active',
          '.arco-tag-checked',
          '.arco-tabs-header-title-active',
          'input:checked',
          'option:checked',
        ];

        const selectedLabels = Array.from(
          new Set(
            selectedSelectors
              .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
              .filter(isVisible)
              .map((element) => {
                if (element instanceof HTMLInputElement) {
                  return normalize(
                    element.labels?.[0]?.innerText ||
                      element.getAttribute('aria-label') ||
                      element.value ||
                      element.name ||
                      element.id,
                    120,
                  );
                }
                return normalize(
                  element.getAttribute('aria-label') ||
                    (element as HTMLElement).innerText ||
                    element.textContent ||
                    '',
                  120,
                );
              })
              .filter(Boolean),
          ),
        ).slice(0, 12);

        const formStateSignature = Array.from(document.querySelectorAll('input, textarea, select'))
          .filter(isVisible)
          .slice(0, 30)
          .map((element) => {
            if (element instanceof HTMLInputElement) {
              const value =
                element.type === 'checkbox' || element.type === 'radio'
                  ? String(element.checked)
                  : normalize(element.value, 80);
              return `${element.name || element.id || element.type}:${element.type}:${value}`;
            }
            if (element instanceof HTMLTextAreaElement) {
              return `${element.name || element.id || 'textarea'}:${normalize(element.value, 80)}`;
            }
            if (element instanceof HTMLSelectElement) {
              return `${element.name || element.id || 'select'}:${normalize(element.value, 80)}`;
            }
            return '';
          })
          .filter(Boolean)
          .join('|');

        const bodyTextDigest = readText(document.body, 600);
        const mainRegionDigest = readText(mainElement, 600);
        const domSignature = [
          document.body?.childElementCount || 0,
          document.querySelectorAll('*').length,
          mainRegionDigest,
          selectedLabels.join('|'),
        ].join('::');

        return {
          url: window.location.href,
          title: document.title,
          bodyTextDigest,
          mainRegionDigest,
          domSignature,
          formStateSignature,
          selectedLabels,
        };
      },
    });
    return (result?.result as LightweightPageState | undefined) || null;
  } catch {
    return null;
  }
}

async function capturePageStateWithRetries(
  tabId: number,
  frameId?: number,
  delaysMs: number[] = [],
): Promise<LightweightPageState | null> {
  let latest = await captureLightweightPageState(tabId, frameId);
  for (const delayMs of delaysMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const next = await captureLightweightPageState(tabId, frameId);
    if (next) {
      latest = next;
    }
  }
  return latest;
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

    if (!selector && !coordinates && !args.ref) {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS + ': Provide ref or selector or coordinates',
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

      const beforeState = await captureLightweightPageState(tab.id, frameId);

      let finalRef = args.ref;
      let finalSelector = selector;

      // If selector is XPath, convert to ref first
      if (selector && selectorType === 'xpath') {
        await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
        try {
          const resolved = await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
              selector,
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
      if (args.allowDownloadClick === true) {
        markNextDownloadAsInteractive(tab.id);
      }

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

      const interactionText = String(
        result?.elementInfo?.text ||
          result?.elementInfo?.ariaLabel ||
          finalSelector ||
          finalRef ||
          '',
      ).trim();
      const shouldWaitLonger =
        result?.elementInfo?.tagName === 'BUTTON' ||
        interactionText.includes('查看') ||
        interactionText.includes('垂类') ||
        interactionText.includes('美食');
      const afterState = await capturePageStateWithRetries(
        tab.id,
        frameId,
        shouldWaitLonger ? [180, 420, 900] : [150],
      );
      const postActionSummary = buildPostActionSummary(beforeState, afterState);

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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message:
                postActionSummary?.postActionConfidence === 'low'
                  ? `${result.message || 'Click operation successful'} (success=true but state_change=weak)`
                  : result.message || 'Click operation successful',
              elementInfo: result.elementInfo,
              navigationOccurred: result.navigationOccurred,
              clickMethod,
              postActionSummary,
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

    if (!selector && !ref) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': Provide ref or selector');
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

      const beforeState = await captureLightweightPageState(tab.id, frameId);

      let finalRef = ref;
      let finalSelector = selector;

      // If selector is XPath, convert to ref first
      if (selector && selectorType === 'xpath') {
        await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
        try {
          const resolved = await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
              selector,
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

      const afterState = await capturePageStateWithRetries(tab.id, frameId, [120, 300]);
      const postActionSummary = buildPostActionSummary(beforeState, afterState);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message:
                postActionSummary?.postActionConfidence === 'low'
                  ? `${result.message || 'Fill operation successful'} (success=true but state_change=weak)`
                  : result.message || 'Fill operation successful',
              elementInfo: result.elementInfo,
              postActionSummary,
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
