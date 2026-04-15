import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';
import { handleDownloadTool, markNextDownloadAsInteractive } from './download';
import { prearmDialogHandling } from './dialog-prearm';

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
      await prearmDialogHandling(tab.id);
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
              message: result.message || 'Click operation successful',
              elementInfo: result.elementInfo,
              navigationOccurred: result.navigationOccurred,
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
