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
const DIALOG_HANDLE_MAX_ATTEMPTS = 10;
const DIALOG_HANDLE_RETRY_DELAY_MS = 100;

function isDialogNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(DIALOG_NOT_SHOWING_MESSAGE);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
        await cdpSessionManager.sendCommand(tabId, 'Page.enable');
        let lastError: unknown;

        for (let attempt = 0; attempt < DIALOG_HANDLE_MAX_ATTEMPTS; attempt += 1) {
          try {
            await cdpSessionManager.sendCommand(tabId, 'Page.handleJavaScriptDialog', {
              accept: action === 'accept',
              promptText: action === 'accept' ? promptText : undefined,
            });
            return;
          } catch (error) {
            lastError = error;

            if (!isDialogNotReadyError(error) || attempt === DIALOG_HANDLE_MAX_ATTEMPTS - 1) {
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
