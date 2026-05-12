import { ToolExecutor } from '@/common/tool-handler';
import type { ToolResult } from '@/common/tool-handler';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';

const PING_TIMEOUT_MS = 300;
const TAB_SETTLE_TIMEOUT_MS = 8000;
const TAB_ACTIVATION_TIMEOUT_MS = 1500;
const TAB_POLL_INTERVAL_MS = 100;

interface WaitForTabSettledOptions {
  timeoutMs?: number;
  previousUrl?: string;
  requireUrlChange?: boolean;
}

interface WaitForTabSettledResult {
  tab: chrome.tabs.Tab;
  settled: boolean;
  timedOut: boolean;
  reason: 'already_complete' | 'complete' | 'complete_after_url_change' | 'timeout' | 'tab_missing';
  waitedMs: number;
  readyState: string | null;
}

interface WaitForTabActivatedOptions {
  timeoutMs?: number;
  expectedWindowId?: number;
  requireFocusedWindow?: boolean;
}

interface WaitForTabActivatedResult {
  tab: chrome.tabs.Tab;
  activated: boolean;
  timedOut: boolean;
  waitedMs: number;
  windowFocused: boolean | null;
}

/**
 * Base class for browser tool executors
 */
export abstract class BaseBrowserToolExecutor implements ToolExecutor {
  abstract name: string;
  abstract execute(args: any): Promise<ToolResult>;

  /**
   * Inject content script into tab
   */
  protected async injectContentScript(
    tabId: number,
    files: string[],
    injectImmediately = false,
    world: 'MAIN' | 'ISOLATED' = 'ISOLATED',
    allFrames: boolean = false,
    frameIds?: number[],
  ): Promise<void> {
    try {
      const pingFrameId = frameIds?.[0];
      const response = await Promise.race([
        typeof pingFrameId === 'number'
          ? chrome.tabs.sendMessage(
              tabId,
              { action: `${this.name}_ping` },
              { frameId: pingFrameId },
            )
          : chrome.tabs.sendMessage(tabId, { action: `${this.name}_ping` }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`${this.name} Ping action to tab ${tabId} timed out`)),
            PING_TIMEOUT_MS,
          ),
        ),
      ]);

      if (response && response.status === 'pong') {
        return;
      }
    } catch {
      // Ping failure is expected when the script hasn't been injected yet.
    }

    try {
      const target: { tabId: number; allFrames?: boolean; frameIds?: number[] } = { tabId };
      if (frameIds && frameIds.length > 0) {
        target.frameIds = frameIds;
      } else if (allFrames) {
        target.allFrames = true;
      }
      await chrome.scripting.executeScript({
        target,
        files,
        injectImmediately,
        world,
      } as any);
    } catch (injectionError) {
      const errorMessage =
        injectionError instanceof Error ? injectionError.message : String(injectionError);
      throw new Error(
        `${ERROR_MESSAGES.TOOL_EXECUTION_FAILED}: Failed to inject content script in tab ${tabId}: ${errorMessage}`,
      );
    }
  }

  /**
   * Send message to tab
   */
  protected async sendMessageToTab(tabId: number, message: any, frameId?: number): Promise<any> {
    const response =
      typeof frameId === 'number'
        ? await chrome.tabs.sendMessage(tabId, message, { frameId })
        : await chrome.tabs.sendMessage(tabId, message);

    if (response && response.error) {
      throw new Error(String(response.error));
    }

    return response;
  }

  /**
   * Try to get an existing tab by id. Returns null when not found.
   */
  protected async tryGetTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
    if (typeof tabId !== 'number') return null;
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  /**
   * Active tab in the **current** Chrome window. Same as `getActiveTabOrThrowInWindow()` with no `windowId`.
   */
  protected async getActiveTabOrThrow(): Promise<chrome.tabs.Tab> {
    return this.getActiveTabOrThrowInWindow();
  }

  /**
   * Optionally focus window and/or activate tab. Defaults preserve current behavior
   * when caller sets activate/focus flags explicitly.
   */
  protected async ensureFocus(
    tab: chrome.tabs.Tab,
    options: { activate?: boolean; focusWindow?: boolean } = {},
  ): Promise<void> {
    const activate = options.activate === true;
    const focusWindow = options.focusWindow === true;
    if (focusWindow && typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    if (activate && typeof tab.id === 'number') {
      await chrome.tabs.update(tab.id, { active: true });
    }
  }

  protected async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeComparableUrl(url?: string): string {
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

  private async getTabDocumentReadyState(tabId: number): Promise<string | null> {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.readyState,
      });
      return typeof result === 'string' ? result : null;
    } catch {
      return null;
    }
  }

  protected async waitForTabSettled(
    tabId: number,
    options: WaitForTabSettledOptions = {},
  ): Promise<WaitForTabSettledResult> {
    const timeoutMs = options.timeoutMs ?? TAB_SETTLE_TIMEOUT_MS;
    const previousUrl = this.normalizeComparableUrl(options.previousUrl);
    const requireUrlChange = options.requireUrlChange === true;
    const startedAt = Date.now();

    const buildState = async (
      tab: chrome.tabs.Tab,
      reason: WaitForTabSettledResult['reason'],
      timedOut: boolean,
    ): Promise<WaitForTabSettledResult> => ({
      tab,
      settled: !timedOut && reason !== 'tab_missing',
      timedOut,
      reason,
      waitedMs: Date.now() - startedAt,
      readyState: await this.getTabDocumentReadyState(tabId),
    });

    const isSettledTab = (tab: chrome.tabs.Tab): WaitForTabSettledResult['reason'] | null => {
      const currentUrl = this.normalizeComparableUrl(tab.url || tab.pendingUrl);
      const urlChanged = !requireUrlChange || !previousUrl || currentUrl !== previousUrl;
      if (tab.status === 'complete' && urlChanged) {
        return previousUrl && requireUrlChange ? 'complete_after_url_change' : 'complete';
      }
      return null;
    };

    let currentTab: chrome.tabs.Tab;
    try {
      currentTab = await chrome.tabs.get(tabId);
    } catch {
      return {
        tab: { id: tabId } as chrome.tabs.Tab,
        settled: false,
        timedOut: true,
        reason: 'tab_missing',
        waitedMs: Date.now() - startedAt,
        readyState: null,
      };
    }

    const initialReason = isSettledTab(currentTab);
    if (initialReason) {
      return buildState(
        currentTab,
        previousUrl && requireUrlChange ? 'complete_after_url_change' : 'already_complete',
        false,
      );
    }

    return await new Promise<WaitForTabSettledResult>((resolve) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(handleUpdated);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const finish = async (
        reason: WaitForTabSettledResult['reason'],
        timedOut: boolean,
        updatedTab?: chrome.tabs.Tab,
      ) => {
        cleanup();
        let finalTab = updatedTab;
        if (!finalTab) {
          try {
            finalTab = await chrome.tabs.get(tabId);
          } catch {
            resolve({
              tab: { id: tabId } as chrome.tabs.Tab,
              settled: false,
              timedOut: true,
              reason: 'tab_missing',
              waitedMs: Date.now() - startedAt,
              readyState: null,
            });
            return;
          }
        }
        resolve(await buildState(finalTab, reason, timedOut));
      };

      const handleUpdated = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        updatedTab: chrome.tabs.Tab,
      ) => {
        if (updatedTabId !== tabId) return;
        const reason = isSettledTab(updatedTab);
        if (reason || changeInfo.status === 'complete') {
          void finish(reason || 'complete', false, updatedTab);
        }
      };

      chrome.tabs.onUpdated.addListener(handleUpdated);
      timeoutHandle = setTimeout(() => {
        void finish('timeout', true);
      }, timeoutMs);
    });
  }

  protected async waitForTabActivated(
    tabId: number,
    options: WaitForTabActivatedOptions = {},
  ): Promise<WaitForTabActivatedResult> {
    const timeoutMs = options.timeoutMs ?? TAB_ACTIVATION_TIMEOUT_MS;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        let windowFocused: boolean | null = null;
        if (typeof tab.windowId === 'number') {
          try {
            const windowState = await chrome.windows.get(tab.windowId);
            windowFocused = typeof windowState.focused === 'boolean' ? windowState.focused : null;
          } catch {
            windowFocused = null;
          }
        }
        const windowMatches =
          typeof options.expectedWindowId !== 'number' || tab.windowId === options.expectedWindowId;
        const focusOk = options.requireFocusedWindow === true ? windowFocused === true : true;

        if (tab.active === true && windowMatches && focusOk) {
          return {
            tab,
            activated: true,
            timedOut: false,
            waitedMs: Date.now() - startedAt,
            windowFocused,
          };
        }
      } catch {
        break;
      }

      await this.sleep(TAB_POLL_INTERVAL_MS);
    }

    const tab = await chrome.tabs.get(tabId);
    let windowFocused: boolean | null = null;
    if (typeof tab.windowId === 'number') {
      try {
        const windowState = await chrome.windows.get(tab.windowId);
        windowFocused = typeof windowState.focused === 'boolean' ? windowState.focused : null;
      } catch {
        windowFocused = null;
      }
    }

    return {
      tab,
      activated: tab.active === true,
      timedOut: true,
      waitedMs: Date.now() - startedAt,
      windowFocused,
    };
  }

  /**
   * Get the active tab. When windowId provided, search within that window; otherwise currentWindow.
   */
  protected async getActiveTabInWindow(windowId?: number): Promise<chrome.tabs.Tab | null> {
    if (typeof windowId === 'number') {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      return tabs && tabs[0] ? tabs[0] : null;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  /**
   * Same as getActiveTabInWindow, but throws if not found.
   */
  protected async getActiveTabOrThrowInWindow(windowId?: number): Promise<chrome.tabs.Tab> {
    const tab = await this.getActiveTabInWindow(windowId);
    if (!tab || !tab.id) throw new Error('Active tab not found');
    return tab;
  }

  /**
   * Chrome blocks script injection on browser-internal and web-store style pages.
   */
  protected isRestrictedUrl(url?: string): boolean {
    if (!url) return true;

    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-error://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:') ||
      url.startsWith('devtools://') ||
      url.startsWith('view-source:') ||
      url.startsWith('file://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('https://chrome.google.com/webstore') ||
      url.startsWith('https://microsoftedge.microsoft.com/')
    );
  }
}
