import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { cdpSessionManager } from '@/utils/cdp-session-manager';

interface HandleDialogParams {
  action: 'accept' | 'dismiss';
  promptText?: string;
  tabId?: number;
  windowId?: number;
}

const DIALOG_NOT_SHOWING_MESSAGE = 'No dialog is showing';
const DIALOG_HANDLE_RETRY_DELAY_MS = 80;
const DIALOG_COMMAND_TIMEOUT_MS = 3000;
const DIALOG_TOTAL_TIMEOUT_MS = 6000;
const DIALOG_ENABLE_TIMEOUT_MESSAGE = 'Enable dialog domain timed out';

function isDialogNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(DIALOG_NOT_SHOWING_MESSAGE);
}

function isEnableTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(DIALOG_ENABLE_TIMEOUT_MESSAGE);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Handle JavaScript dialogs (alert/confirm/prompt) via CDP Page.handleJavaScriptDialog
 */
class HandleDialogTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HANDLE_DIALOG;

  async execute(args: HandleDialogParams): Promise<ToolResult> {
    const {
      action,
      promptText,
      tabId: requestedTabId,
      windowId,
    } = args || ({} as HandleDialogParams);
    if (!action || (action !== 'accept' && action !== 'dismiss')) {
      return createErrorResponse('action must be "accept" or "dismiss"');
    }

    try {
      const explicit = await this.tryGetTab(requestedTabId);
      const targetTab = explicit || (await this.getActiveTabOrThrowInWindow(windowId));
      if (!targetTab?.id) return createErrorResponse('No target tab found for dialog handling');
      const tabId = targetTab.id;

      // Use shared CDP session manager for safe attach/detach with refcount
      await cdpSessionManager.withSession(tabId, 'dialog', async () => {
        let pageDomainEnabled = false;
        try {
          await withTimeout(
            cdpSessionManager.sendCommand(tabId, 'Page.enable'),
            DIALOG_COMMAND_TIMEOUT_MS,
            DIALOG_ENABLE_TIMEOUT_MESSAGE,
          );
          pageDomainEnabled = true;
        } catch (error) {
          if (!isEnableTimeoutError(error)) {
            throw error;
          }
          // A visible prompt can block Page.enable on some pages.
          // Continue with direct dialog handling attempts instead of failing fast.
          console.warn('[HandleDialogTool] Page.enable timed out; retrying direct dialog handling');
        }

        let lastError: unknown;
        const startedAt = Date.now();
        const maxAttempts = Math.max(
          1,
          Math.ceil(DIALOG_TOTAL_TIMEOUT_MS / DIALOG_HANDLE_RETRY_DELAY_MS),
        );

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (Date.now() - startedAt > DIALOG_TOTAL_TIMEOUT_MS) {
            throw (
              lastError ||
              new Error('Dialog handling timed out while waiting for a visible JavaScript dialog')
            );
          }
          try {
            await withTimeout(
              cdpSessionManager.sendCommand(tabId, 'Page.handleJavaScriptDialog', {
                accept: action === 'accept',
                promptText: action === 'accept' ? promptText : undefined,
              }),
              DIALOG_COMMAND_TIMEOUT_MS,
              'Handling JavaScript dialog timed out',
            );
            return;
          } catch (error) {
            lastError = error;

            if (
              !isDialogNotReadyError(error) &&
              !(isEnableTimeoutError(error) && !pageDomainEnabled) &&
              attempt !== maxAttempts - 1
            ) {
              throw error;
            }

            if (attempt === maxAttempts - 1) {
              throw error;
            }

            await sleep(DIALOG_HANDLE_RETRY_DELAY_MS);
          }
        }

        throw lastError;
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, action, promptText: promptText || null }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Failed to handle dialog: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const handleDialogTool = new HandleDialogTool();
