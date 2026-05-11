import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { captureFrameOnAction, isAutoCaptureActive } from './gif-recorder';

// Default window dimensions
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 720;

interface NavigateToolParams {
  url?: string;
  newWindow?: boolean;
  width?: number;
  height?: number;
  refresh?: boolean;
  tabId?: number;
  windowId?: number;
  background?: boolean; // when true, do not activate tab or focus window
}

function buildNavigationReadinessFields(input: {
  settled?: boolean;
  readyState?: string | null;
  finalUrl?: string | null;
  status?: string | null;
}) {
  const finalUrl = input.finalUrl || '';
  const pageReadable =
    input.settled === true &&
    input.readyState === 'complete' &&
    finalUrl.length > 0 &&
    finalUrl !== 'about:blank';

  return {
    pageReadable,
    nextStepHint: pageReadable
      ? 'safe_to_read_page'
      : 'navigation_not_readable; avoid chrome_read_page until navigation settles or choose another path',
  };
}

function shouldAddWwwVariant(hostname: string): boolean {
  if (!hostname || hostname === 'localhost') {
    return false;
  }

  // IPv6 literals arrive without brackets in URL.hostname.
  if (hostname.includes(':')) {
    return false;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }

  return hostname.includes('.');
}

function normalizeComparableUrl(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const normalizedPath =
      parsed.pathname !== '/' && parsed.pathname.endsWith('/')
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname || '/';
    return `${parsed.origin}${normalizedPath}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

export function buildNavigateUrlPatterns(input: string): string[] {
  const patterns = new Set<string>();

  try {
    if (!input.includes('*')) {
      const u = new URL(input);
      const pathWildcard = '/*';

      const hostNoWww = u.host.replace(/^www\./, '');
      const hostWithWww = shouldAddWwwVariant(u.hostname)
        ? hostNoWww.startsWith('www.')
          ? hostNoWww
          : `www.${hostNoWww}`
        : null;

      patterns.add(`${u.protocol}//${u.host}${pathWildcard}`);
      patterns.add(`${u.protocol}//${hostNoWww}${pathWildcard}`);
      if (hostWithWww) {
        patterns.add(`${u.protocol}//${hostWithWww}${pathWildcard}`);
      }

      const altProtocol = u.protocol === 'https:' ? 'http:' : 'https:';
      patterns.add(`${altProtocol}//${u.host}${pathWildcard}`);
      patterns.add(`${altProtocol}//${hostNoWww}${pathWildcard}`);
      if (hostWithWww) {
        patterns.add(`${altProtocol}//${hostWithWww}${pathWildcard}`);
      }
    } else {
      patterns.add(input);
    }
  } catch {
    patterns.add(input.endsWith('/') ? `${input}*` : `${input}/*`);
  }

  return Array.from(patterns);
}

/**
 * Tool for navigating to URLs in browser tabs or windows
 */
class NavigateTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NAVIGATE;

  /**
   * Trigger GIF auto-capture after successful navigation
   */
  private async triggerAutoCapture(tabId: number, url?: string): Promise<void> {
    if (!isAutoCaptureActive(tabId)) {
      return;
    }
    try {
      await captureFrameOnAction(tabId, { type: 'navigate', url });
    } catch (error) {
      console.warn('[NavigateTool] Auto-capture failed:', error);
    }
  }

  async execute(args: NavigateToolParams): Promise<ToolResult> {
    const {
      newWindow = false,
      width,
      height,
      url,
      refresh = false,
      tabId,
      background,
      windowId,
    } = args;

    console.log(
      `Attempting to ${refresh ? 'refresh current tab' : `open URL: ${url}`} with options:`,
      args,
    );

    try {
      // Handle refresh option first
      if (refresh) {
        console.log('Refreshing current active tab');
        const explicit = await this.tryGetTab(tabId);
        // Get target tab (explicit or active in provided window)
        const targetTab = explicit || (await this.getActiveTabOrThrowInWindow(windowId));
        if (!targetTab.id) return createErrorResponse('No target tab found to refresh');
        const previousUrl = targetTab.url;
        await chrome.tabs.reload(targetTab.id);
        const settleResult = await this.waitForTabSettled(targetTab.id, {
          previousUrl,
          requireUrlChange: false,
        });

        console.log(`Refreshed tab ID: ${targetTab.id}`);

        // Get updated tab information
        const updatedTab = settleResult.tab;

        // Trigger auto-capture on refresh
        await this.triggerAutoCapture(updatedTab.id!, updatedTab.url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Successfully refreshed current tab',
                tabId: updatedTab.id,
                windowId: updatedTab.windowId,
                url: updatedTab.url,
                status: updatedTab.status,
                settled: settleResult.settled,
                settleReason: settleResult.reason,
                waitedMs: settleResult.waitedMs,
                readyState: settleResult.readyState,
                ...buildNavigationReadinessFields({
                  settled: settleResult.settled,
                  readyState: settleResult.readyState,
                  finalUrl: updatedTab.url,
                  status: updatedTab.status,
                }),
              }),
            },
          ],
          isError: false,
        };
      }

      // Validate that url is provided when not refreshing
      if (!url) {
        return createErrorResponse('URL parameter is required when refresh is not true');
      }

      // Handle history navigation: url="back" or url="forward"
      if (url === 'back' || url === 'forward') {
        const explicitTab = await this.tryGetTab(tabId);
        const targetTab = explicitTab || (await this.getActiveTabOrThrowInWindow(windowId));
        if (!targetTab.id) {
          return createErrorResponse('No target tab found for history navigation');
        }

        // Respect background flag for focus behavior
        await this.ensureFocus(targetTab, {
          activate: background !== true,
          focusWindow: background !== true,
        });
        const previousUrl = targetTab.url;

        if (url === 'forward') {
          await chrome.tabs.goForward(targetTab.id);
          console.log(`Navigated forward in tab ID: ${targetTab.id}`);
        } else {
          await chrome.tabs.goBack(targetTab.id);
          console.log(`Navigated back in tab ID: ${targetTab.id}`);
        }

        const settleResult = await this.waitForTabSettled(targetTab.id, {
          previousUrl,
          requireUrlChange: true,
        });
        const updatedTab = settleResult.tab;

        // Trigger auto-capture on history navigation
        await this.triggerAutoCapture(updatedTab.id!, updatedTab.url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Successfully navigated ${url} in browser history`,
                tabId: updatedTab.id,
                windowId: updatedTab.windowId,
                url: updatedTab.url,
                status: updatedTab.status,
                settled: settleResult.settled,
                settleReason: settleResult.reason,
                waitedMs: settleResult.waitedMs,
                readyState: settleResult.readyState,
              }),
            },
          ],
          isError: false,
        };
      }

      // 1. Check if URL is already open
      // Prefer Chrome's URL match patterns for robust matching (host/path variations)
      console.log(`Checking if URL is already open: ${url}`);

      // Build robust match patterns from the provided URL.
      // This mirrors the approach in CloseTabsTool: ensure wildcard path and
      // add common variants (www/no-www, http/https) to handle real-world redirects.
      const urlPatterns = buildNavigateUrlPatterns(url);
      const candidateTabs = await chrome.tabs.query({ url: urlPatterns });
      console.log(`Found ${candidateTabs.length} matching tabs with patterns:`, urlPatterns);

      // Prefer strict match when user specifies a concrete path/query.
      // Only fall back to host-level activation when the target is site root.
      const pickBestMatch = (target: string, tabsToPick: chrome.tabs.Tab[]) => {
        let targetUrl: URL | undefined;
        try {
          targetUrl = new URL(target);
        } catch {
          // Not a fully-qualified URL; cannot do structured comparison
          return tabsToPick[0];
        }

        const normalizePath = (p: string) => {
          if (!p) return '/';
          // Ensure leading slash
          const withLeading = p.startsWith('/') ? p : `/${p}`;
          // Remove trailing slash except when root
          return withLeading !== '/' && withLeading.endsWith('/')
            ? withLeading.slice(0, -1)
            : withLeading;
        };

        const hostBase = (h: string) => h.replace(/^www\./, '').toLowerCase();
        const isRootTarget = normalizePath(targetUrl.pathname) === '/' && !targetUrl.search;
        const targetPath = normalizePath(targetUrl.pathname);
        const targetSearch = targetUrl.search || '';
        const targetHostBase = hostBase(targetUrl.host);

        let best: { tab?: chrome.tabs.Tab; score: number } = { score: -1 };

        for (const tab of tabsToPick) {
          const tabUrlStr = tab.url || '';
          let tabUrl: URL | undefined;
          try {
            tabUrl = new URL(tabUrlStr);
          } catch {
            continue;
          }

          const tabHostBase = hostBase(tabUrl.host);
          if (tabHostBase !== targetHostBase) continue;

          const tabPath = normalizePath(tabUrl.pathname);
          const tabSearch = tabUrl.search || '';

          // Scoring:
          // 3 - exact path match and (if target has query) exact query match
          // 2 - exact path match ignoring query (target without query)
          // 1 - same host, any path (only if target is root)
          let score = -1;
          const pathEqual = tabPath === targetPath;
          const searchEqual = tabSearch === targetSearch;

          if (pathEqual && (targetSearch ? searchEqual : true)) {
            score = 3;
          } else if (pathEqual && !targetSearch) {
            score = 2;
          }

          if (score > best.score) {
            best = { tab, score };
            if (score === 3) break; // Cannot do better
          }
        }

        return best.tab;
      };

      const explicitTab = await this.tryGetTab(tabId);
      const existingTab = explicitTab || pickBestMatch(url, candidateTabs);
      if (existingTab?.id !== undefined) {
        console.log(
          `URL already open in Tab ID: ${existingTab.id}, Window ID: ${existingTab.windowId}`,
        );
        const previousUrl = existingTab.url;
        const shouldNavigateExplicitTab =
          explicitTab?.id === existingTab.id &&
          normalizeComparableUrl(explicitTab.url) !== normalizeComparableUrl(url);

        // Update URL only when explicit tab specified and url differs
        if (shouldNavigateExplicitTab && explicitTab && typeof explicitTab.id === 'number') {
          await chrome.tabs.update(explicitTab.id, { url });
        }
        // Optionally bring to foreground based on background flag
        await this.ensureFocus(existingTab, {
          activate: background !== true,
          focusWindow: background !== true,
        });

        console.log(`Activated existing Tab ID: ${existingTab.id}`);
        const settleResult = await this.waitForTabSettled(existingTab.id, {
          previousUrl,
          requireUrlChange: shouldNavigateExplicitTab,
        });
        const updatedTab = settleResult.tab;

        // Trigger auto-capture on existing tab activation
        await this.triggerAutoCapture(updatedTab.id!, updatedTab.url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: shouldNavigateExplicitTab
                  ? 'Navigated explicit tab to requested URL'
                  : 'Activated matching existing tab',
                tabId: updatedTab.id,
                windowId: updatedTab.windowId,
                requestedUrl: url,
                finalUrl: updatedTab.url,
                status: updatedTab.status,
                activated: background !== true,
                usedExistingTab: true,
                navigatedExplicitTab: shouldNavigateExplicitTab,
                settled: settleResult.settled,
                settleReason: settleResult.reason,
                waitedMs: settleResult.waitedMs,
                readyState: settleResult.readyState,
              }),
            },
          ],
          isError: false,
        };
      }

      // 2. If URL is not already open, decide how to open it based on options
      const openInNewWindow = newWindow || typeof width === 'number' || typeof height === 'number';

      if (openInNewWindow) {
        console.log('Opening URL in a new window.');

        // Create new window
        const newWindow = await chrome.windows.create({
          url: url,
          width: typeof width === 'number' ? width : DEFAULT_WINDOW_WIDTH,
          height: typeof height === 'number' ? height : DEFAULT_WINDOW_HEIGHT,
          focused: background === true ? false : true,
        });

        if (newWindow && newWindow.id !== undefined) {
          console.log(`URL opened in new Window ID: ${newWindow.id}`);

          // Trigger auto-capture if the new window has a tab
          const firstTab = newWindow.tabs?.[0];
          if (firstTab?.id) {
            const settleResult = await this.waitForTabSettled(firstTab.id);
            await this.triggerAutoCapture(firstTab.id, settleResult.tab.url);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Opened URL in new window',
                    windowId: newWindow.id,
                    tabId: settleResult.tab.id,
                    requestedUrl: url,
                    finalUrl: settleResult.tab.url,
                    status: settleResult.tab.status,
                    settled: settleResult.settled,
                    settleReason: settleResult.reason,
                    waitedMs: settleResult.waitedMs,
                    readyState: settleResult.readyState,
                    tabs: newWindow.tabs
                      ? newWindow.tabs.map((tab) => ({
                          tabId: tab.id,
                          url: tab.url,
                        }))
                      : [],
                  }),
                },
              ],
              isError: false,
            };
          }
        }
      } else {
        console.log('Opening URL in the last active window.');
        // Try to open a new tab in the specified window, otherwise the most recently active window
        let targetWindow: chrome.windows.Window | null = null;
        if (typeof windowId === 'number') {
          targetWindow = await chrome.windows.get(windowId, { populate: false });
        }
        if (!targetWindow) {
          targetWindow = await chrome.windows.getLastFocused({ populate: false });
        }

        if (targetWindow && targetWindow.id !== undefined) {
          console.log(`Found target Window ID: ${targetWindow.id}`);

          const newTab = await chrome.tabs.create({
            url: url,
            windowId: targetWindow.id,
            active: background === true ? false : true,
          });
          if (background !== true) {
            await chrome.windows.update(targetWindow.id, { focused: true });
          }

          console.log(
            `URL opened in new Tab ID: ${newTab.id} in existing Window ID: ${targetWindow.id}`,
          );

          const settleResult = newTab.id ? await this.waitForTabSettled(newTab.id) : null;

          // Trigger auto-capture on new tab
          if (newTab.id) {
            await this.triggerAutoCapture(newTab.id, settleResult?.tab.url || newTab.url);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'Opened URL in new tab in existing window',
                  tabId: settleResult?.tab.id || newTab.id,
                  windowId: targetWindow.id,
                  requestedUrl: url,
                  finalUrl: settleResult?.tab.url || newTab.url,
                  status: settleResult?.tab.status || newTab.status,
                  settled: settleResult?.settled ?? false,
                  settleReason: settleResult?.reason || null,
                  waitedMs: settleResult?.waitedMs || 0,
                  readyState: settleResult?.readyState || null,
                  ...buildNavigationReadinessFields({
                    settled: settleResult?.settled ?? false,
                    readyState: settleResult?.readyState || null,
                    finalUrl: settleResult?.tab.url || newTab.url,
                    status: settleResult?.tab.status || newTab.status,
                  }),
                }),
              },
            ],
            isError: false,
          };
        } else {
          // In rare cases, if there's no recently active window (e.g., browser just started with no windows)
          // Fall back to opening in a new window
          console.warn('No last focused window found, falling back to creating a new window.');

          const fallbackWindow = await chrome.windows.create({
            url: url,
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
            focused: true,
          });

          if (fallbackWindow && fallbackWindow.id !== undefined) {
            console.log(`URL opened in fallback new Window ID: ${fallbackWindow.id}`);

            // Trigger auto-capture if fallback window has a tab
            const firstTab = fallbackWindow.tabs?.[0];
            if (firstTab?.id) {
              const settleResult = await this.waitForTabSettled(firstTab.id);
              await this.triggerAutoCapture(firstTab.id, settleResult.tab.url);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      message: 'Opened URL in new window',
                      windowId: fallbackWindow.id,
                      tabId: settleResult.tab.id,
                      requestedUrl: url,
                      finalUrl: settleResult.tab.url,
                      status: settleResult.tab.status,
                      settled: settleResult.settled,
                      settleReason: settleResult.reason,
                      waitedMs: settleResult.waitedMs,
                      readyState: settleResult.readyState,
                      tabs: fallbackWindow.tabs
                        ? fallbackWindow.tabs.map((tab) => ({
                            tabId: tab.id,
                            url: tab.url,
                          }))
                        : [],
                    }),
                  },
                ],
                isError: false,
              };
            }
          }
        }
      }

      // If all attempts fail, return a generic error
      return createErrorResponse('Failed to open URL: Unknown error occurred');
    } catch (error) {
      if (chrome.runtime.lastError) {
        console.error(`Chrome API Error: ${chrome.runtime.lastError.message}`, error);
        return createErrorResponse(`Chrome API Error: ${chrome.runtime.lastError.message}`);
      } else {
        console.error('Error in navigate:', error);
        return createErrorResponse(
          `Error navigating to URL: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
export const navigateTool = new NavigateTool();

interface CloseTabsToolParams {
  tabIds?: number[];
  url?: string;
  /** When closing the "active" tab (no tabIds/url), resolve active tab in this window. */
  windowId?: number;
}

/**
 * Tool for closing browser tabs
 */
class CloseTabsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLOSE_TABS;

  async execute(args: CloseTabsToolParams): Promise<ToolResult> {
    const { tabIds, url, windowId } = args;
    let urlPattern = url;
    console.log(`Attempting to close tabs with options:`, args);

    try {
      // If URL is provided, close all tabs matching that URL
      if (urlPattern) {
        console.log(`Searching for tabs with URL: ${url}`);
        try {
          // Build a proper Chrome match pattern from a concrete URL.
          // If caller already provided a match pattern with '*', use as-is.
          if (!urlPattern.includes('*')) {
            // Ignore search/hash; match by origin + pathname prefix.
            // Use URL to normalize; fallback to simple suffixing when parsing fails.
            try {
              const u = new URL(urlPattern);
              const basePath = u.pathname || '/';
              const pathWithWildcard = basePath.endsWith('/') ? `${basePath}*` : `${basePath}/*`;
              urlPattern = `${u.protocol}//${u.host}${pathWithWildcard}`;
            } catch {
              // Not a fully-qualified URL; ensure it ends with wildcard
              urlPattern = urlPattern.endsWith('/') ? `${urlPattern}*` : `${urlPattern}/*`;
            }
          }
        } catch {
          // Best-effort: ensure we have some wildcard
          urlPattern = urlPattern.endsWith('*')
            ? urlPattern
            : urlPattern.endsWith('/')
              ? `${urlPattern}*`
              : `${urlPattern}/*`;
        }

        const tabs = await chrome.tabs.query({ url: urlPattern });

        if (!tabs || tabs.length === 0) {
          console.log(`No tabs found with URL pattern: ${urlPattern}`);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `No tabs found with URL pattern: ${urlPattern}`,
                  closedCount: 0,
                }),
              },
            ],
            isError: false,
          };
        }

        console.log(`Found ${tabs.length} tabs with URL pattern: ${urlPattern}`);
        const tabIdsToClose = tabs
          .map((tab) => tab.id)
          .filter((id): id is number => id !== undefined);

        if (tabIdsToClose.length === 0) {
          return createErrorResponse('Found tabs but could not get their IDs');
        }

        await chrome.tabs.remove(tabIdsToClose);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Closed ${tabIdsToClose.length} tabs with URL: ${url}`,
                closedCount: tabIdsToClose.length,
                closedTabIds: tabIdsToClose,
              }),
            },
          ],
          isError: false,
        };
      }

      // If tabIds are provided, close those tabs
      if (tabIds && tabIds.length > 0) {
        console.log(`Closing tabs with IDs: ${tabIds.join(', ')}`);

        // Verify that all tabIds exist
        const existingTabs = await Promise.all(
          tabIds.map(async (tabId) => {
            try {
              return await chrome.tabs.get(tabId);
            } catch (error) {
              console.warn(`Tab with ID ${tabId} not found`);
              return null;
            }
          }),
        );

        const validTabIds = existingTabs
          .filter((tab): tab is chrome.tabs.Tab => tab !== null)
          .map((tab) => tab.id)
          .filter((id): id is number => id !== undefined);

        if (validTabIds.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: 'None of the provided tab IDs exist',
                  closedCount: 0,
                }),
              },
            ],
            isError: false,
          };
        }

        await chrome.tabs.remove(validTabIds);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Closed ${validTabIds.length} tabs`,
                closedCount: validTabIds.length,
                closedTabIds: validTabIds,
                invalidTabIds: tabIds.filter((id) => !validTabIds.includes(id)),
              }),
            },
          ],
          isError: false,
        };
      }

      // If no tabIds or URL provided, close the current active tab (optionally scoped by window)
      console.log('No tabIds or URL provided, closing active tab');
      const activeTab = await this.getActiveTabInWindow(windowId);

      if (!activeTab || !activeTab.id) {
        return createErrorResponse('No active tab found');
      }

      await chrome.tabs.remove(activeTab.id);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Closed active tab',
              closedCount: 1,
              closedTabIds: [activeTab.id],
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in CloseTabsTool.execute:', error);
      return createErrorResponse(
        `Error closing tabs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const closeTabsTool = new CloseTabsTool();

interface SwitchTabToolParams {
  tabId: number;
  windowId?: number;
}

/**
 * Tool for switching the active tab
 */
class SwitchTabTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SWITCH_TAB;

  async execute(args: SwitchTabToolParams): Promise<ToolResult> {
    const { tabId, windowId } = args;

    console.log(`Attempting to switch to tab ID: ${tabId} in window ID: ${windowId}`);

    try {
      const targetTab = await chrome.tabs.get(tabId);
      if (windowId !== undefined && targetTab.windowId !== windowId) {
        return createErrorResponse(`Tab ${tabId} does not belong to window ${windowId}`);
      }

      await this.ensureFocus(targetTab, {
        activate: true,
        focusWindow: true,
      });

      const activationResult = await this.waitForTabActivated(tabId, {
        expectedWindowId: targetTab.windowId,
        requireFocusedWindow: true,
      });

      const settleResult =
        activationResult.tab.status === 'complete'
          ? null
          : await this.waitForTabSettled(tabId, { timeoutMs: 5000 });
      const updatedTab = settleResult?.tab || activationResult.tab;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Successfully switched to tab ID: ${tabId}`,
              tabId: updatedTab.id,
              windowId: updatedTab.windowId,
              url: updatedTab.url,
              status: updatedTab.status,
              activated: activationResult.activated,
              activationTimedOut: activationResult.timedOut,
              activationWaitedMs: activationResult.waitedMs,
              windowFocused: activationResult.windowFocused,
              settled: settleResult ? settleResult.settled : updatedTab.status === 'complete',
              settleReason: settleResult?.reason || 'already_complete',
              settleWaitedMs: settleResult?.waitedMs || 0,
              readyState: settleResult?.readyState || null,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      if (chrome.runtime.lastError) {
        console.error(`Chrome API Error: ${chrome.runtime.lastError.message}`, error);
        return createErrorResponse(`Chrome API Error: ${chrome.runtime.lastError.message}`);
      } else {
        console.error('Error in SwitchTabTool.execute:', error);
        return createErrorResponse(
          `Error switching tab: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

export const switchTabTool = new SwitchTabTool();
