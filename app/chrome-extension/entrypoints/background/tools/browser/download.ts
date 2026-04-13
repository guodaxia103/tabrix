import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';

interface HandleDownloadParams {
  filenameContains?: string;
  url?: string;
  filename?: string;
  saveAs?: boolean;
  timeoutMs?: number; // default 60000
  waitForComplete?: boolean; // default true
}

const AUTO_DOWNLOAD_SUBDIR = 'tabrix';
const INTERACTIVE_BYPASS_WINDOW_MS = 15000;

type DownloadFailureCode =
  | 'permission'
  | 'browser_settings'
  | 'session'
  | 'timeout'
  | 'interrupted'
  | 'not_found'
  | 'unknown';

class DownloadToolError extends Error {
  code: DownloadFailureCode;
  details?: Record<string, unknown>;

  constructor(code: DownloadFailureCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const interactiveBypassTabs = new Map<number, number>();
let globalDownloadRoutingInstalled = false;

export function markNextDownloadAsInteractive(tabId?: number): void {
  if (!Number.isFinite(tabId)) return;
  interactiveBypassTabs.set(Number(tabId), Date.now() + INTERACTIVE_BYPASS_WINDOW_MS);
}

function sanitizeDownloadFilename(name: string): string {
  const trimmed = (name || '').trim();
  const normalized = Array.from(trimmed, (ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0 && code < 32 ? '_' : ch;
  }).join('');
  const replaced = normalized
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!replaced) return `download-${Date.now()}`;
  // Avoid hidden/invalid trailing dots on Windows
  return replaced.replace(/[. ]+$/g, '') || `download-${Date.now()}`;
}

function getDownloadLeafName(item: chrome.downloads.DownloadItem): string {
  const filename = (item.filename || '').split(/[/\\]/).pop() || '';
  if (filename) return filename;
  try {
    const url = new URL(item.url || '');
    const leaf = decodeURIComponent((url.pathname || '').split('/').pop() || '');
    if (leaf) return leaf;
  } catch {}
  return `download-${item.id ?? Date.now()}`;
}

function shouldBypassGlobalRouting(item: chrome.downloads.DownloadItem): boolean {
  const tabId = Number((item as any).tabId);
  if (!Number.isFinite(tabId) || tabId < 0) return false;
  const expiresAt = interactiveBypassTabs.get(tabId);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    interactiveBypassTabs.delete(tabId);
    return false;
  }
  interactiveBypassTabs.delete(tabId);
  return true;
}

function ensureGlobalSilentDownloadRouting(): void {
  if (globalDownloadRoutingInstalled) return;
  if (
    typeof chrome === 'undefined' ||
    !chrome.downloads ||
    !chrome.downloads.onDeterminingFilename ||
    typeof chrome.downloads.onDeterminingFilename.addListener !== 'function'
  ) {
    return;
  }
  globalDownloadRoutingInstalled = true;
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    try {
      // Keep extension-owned downloads untouched (they already provide explicit filenames).
      if (item.byExtensionId === chrome.runtime.id) {
        suggest();
        return;
      }
      // Explicit debug escape hatch from click tool.
      if (shouldBypassGlobalRouting(item)) {
        suggest();
        return;
      }
      const leaf = sanitizeDownloadFilename(getDownloadLeafName(item));
      suggest({
        filename: `${AUTO_DOWNLOAD_SUBDIR}/${leaf}`,
        conflictAction: 'uniquify',
      });
    } catch {
      suggest();
    }
  });
}

function classifyDownloadFailure(error: unknown): DownloadToolError {
  if (error instanceof DownloadToolError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('timed out')) {
    if (lower.includes('save as') || lower.includes('ask save location')) {
      return new DownloadToolError('browser_settings', message, {
        hint: 'Disable "Ask where to save each file" or keep silent default routing.',
      });
    }
    return new DownloadToolError('timeout', message);
  }
  if (lower.includes('interrupted')) {
    return new DownloadToolError('interrupted', message);
  }
  if (lower.includes('permission') || lower.includes('denied') || lower.includes('not allowed')) {
    return new DownloadToolError('permission', message);
  }
  if (lower.includes('not found')) {
    return new DownloadToolError('not_found', message);
  }
  if (lower.includes('native host') || lower.includes('bridge') || lower.includes('session')) {
    return new DownloadToolError('session', message);
  }
  return new DownloadToolError('unknown', message);
}

function createDownloadErrorResponse(error: unknown): ToolResult {
  const parsed = classifyDownloadFailure(error);
  const detailSuffix = parsed.details?.hint ? ` Hint: ${String(parsed.details.hint)}` : '';
  return createErrorResponse(
    `Handle download failed [${parsed.code}]: ${parsed.message}${detailSuffix}`,
  );
}

/**
 * Tool: wait for a download and return info
 */
class HandleDownloadTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD as any;

  async execute(args: HandleDownloadParams): Promise<ToolResult> {
    ensureGlobalSilentDownloadRouting();
    const filenameContains = String(args?.filenameContains || '').trim();
    const downloadUrl = String(args?.url || '').trim();
    const requestedFilename = String(args?.filename || '').trim();
    const saveAs = args?.saveAs === true;
    const waitForComplete = args?.waitForComplete !== false;
    const timeoutMs = Math.max(1000, Math.min(Number(args?.timeoutMs ?? 60000), 300000));
    let effectiveFilter = filenameContains;

    if (downloadUrl) {
      const safeLeaf = requestedFilename
        ? sanitizeDownloadFilename(requestedFilename)
        : sanitizeDownloadFilename(
            (() => {
              try {
                const parsed = new URL(downloadUrl);
                return decodeURIComponent(parsed.pathname.split('/').pop() || '');
              } catch {
                return '';
              }
            })(),
          );
      const targetFilename = `${AUTO_DOWNLOAD_SUBDIR}/${safeLeaf}`;
      try {
        const triggered = await triggerDownloadAndWait({
          url: downloadUrl,
          filename: targetFilename,
          saveAs,
          waitForComplete,
          timeoutMs,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, download: triggered }) }],
          isError: false,
        };
      } catch (e: any) {
        return createDownloadErrorResponse(e);
      }
    }

    try {
      const result = await waitForDownload({
        filenameContains: effectiveFilter,
        waitForComplete,
        timeoutMs,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, download: result }) }],
        isError: false,
      };
    } catch (e: any) {
      return createDownloadErrorResponse(e);
    }
  }
}

async function waitForDownload(opts: {
  filenameContains?: string;
  waitForComplete: boolean;
  timeoutMs: number;
}) {
  const { filenameContains, waitForComplete, timeoutMs } = opts;
  return new Promise<any>((resolve, reject) => {
    let timer: any = null;
    let determineListener:
      | ((
          item: chrome.downloads.DownloadItem,
          suggest: (suggestion?: chrome.downloads.DownloadFilenameSuggestion) => void,
        ) => void)
      | null = null;
    const onError = (err: any) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const cleanup = () => {
      try {
        if (timer) clearTimeout(timer);
      } catch {}
      try {
        chrome.downloads.onCreated.removeListener(onCreated);
      } catch {}
      try {
        chrome.downloads.onChanged.removeListener(onChanged);
      } catch {}
      try {
        if (determineListener) {
          chrome.downloads.onDeterminingFilename.removeListener(determineListener);
        }
      } catch {}
    };
    const matches = (item: chrome.downloads.DownloadItem) => {
      if (!filenameContains) return true;
      const name = (item.filename || '').split(/[/\\]/).pop() || '';
      return name.includes(filenameContains) || (item.url || '').includes(filenameContains);
    };
    const fulfill = async (item: chrome.downloads.DownloadItem) => {
      // try to fill more details via downloads.search
      try {
        const [found] = await chrome.downloads.search({ id: item.id });
        const out = found || item;
        cleanup();
        resolve({
          id: out.id,
          filename: out.filename,
          savedPath: out.filename || undefined,
          url: out.url,
          mime: (out as any).mime || undefined,
          fileSize: out.fileSize ?? out.totalBytes ?? undefined,
          state: out.state,
          danger: out.danger,
          startTime: out.startTime,
          endTime: (out as any).endTime || undefined,
          exists: (out as any).exists,
        });
        return;
      } catch {
        cleanup();
        resolve({
          id: item.id,
          filename: item.filename,
          savedPath: item.filename || undefined,
          url: item.url,
          state: item.state,
        });
      }
    };
    const onCreated = (item: chrome.downloads.DownloadItem) => {
      try {
        if (!matches(item)) return;
        if (!waitForComplete) {
          fulfill(item);
        }
      } catch {}
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      try {
        if (!delta || typeof delta.id !== 'number') return;
        // pull item and check
        chrome.downloads
          .search({ id: delta.id })
          .then((arr) => {
            const item = arr && arr[0];
            if (!item) return;
            if (!matches(item)) return;
            if (waitForComplete && item.state === 'complete') fulfill(item);
          })
          .catch(() => {});
      } catch {}
    };
    determineListener = (item, suggest) => {
      try {
        if (!matches(item)) {
          suggest();
          return;
        }
        // Auto-route matching downloads into Downloads/tabrix to avoid save dialog prompts.
        const leaf = sanitizeDownloadFilename(getDownloadLeafName(item));
        suggest({
          filename: `${AUTO_DOWNLOAD_SUBDIR}/${leaf}`,
          conflictAction: 'uniquify',
        });
      } catch {
        suggest();
      }
    };
    chrome.downloads.onDeterminingFilename.addListener(determineListener);
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
    timer = setTimeout(() => onError(new Error('Download wait timed out')), timeoutMs);
    // Try to find an already-running matching download
    chrome.downloads
      .search({ state: waitForComplete ? 'in_progress' : undefined })
      .then((arr) => {
        const hit = (arr || []).find((d) => matches(d));
        if (hit && !waitForComplete) fulfill(hit);
      })
      .catch(() => {});
  });
}

async function triggerDownloadAndWait(opts: {
  url: string;
  filename: string;
  saveAs: boolean;
  waitForComplete: boolean;
  timeoutMs: number;
}) {
  const { url, filename, saveAs, waitForComplete, timeoutMs } = opts;

  const downloadId = await new Promise<number>((resolve, reject) => {
    const requestTimeoutMs = Math.min(Math.max(1500, Math.floor(timeoutMs / 2)), 8000);
    const timer = setTimeout(() => {
      reject(
        new DownloadToolError(
          'browser_settings',
          `Download request did not return in ${requestTimeoutMs}ms. ` +
            `Chrome may be waiting on a Save As dialog or download permission prompt.`,
        ),
      );
    }, requestTimeoutMs);
    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: 'uniquify',
        saveAs,
      },
      (id) => {
        clearTimeout(timer);
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(classifyDownloadFailure(lastError.message));
          return;
        }
        if (typeof id !== 'number') {
          reject(new DownloadToolError('unknown', 'Download did not return a valid downloadId'));
          return;
        }
        resolve(id);
      },
    );
  });

  return await new Promise<any>((resolve, reject) => {
    let timer: any = null;
    const cleanup = () => {
      try {
        if (timer) clearTimeout(timer);
      } catch {}
      try {
        chrome.downloads.onChanged.removeListener(onChanged);
      } catch {}
    };
    const fail = (err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const failWithDownloadState = async (baseMessage: string) => {
      try {
        const [item] = await chrome.downloads.search({ id: downloadId });
        if (!item) {
          fail(new DownloadToolError('not_found', `${baseMessage} (download item not found)`));
          return;
        }
        const state = item.state || 'unknown';
        const filename = item.filename || '';
        // In practice, when "Ask where to save each file" is enabled, download may wait
        // indefinitely for user confirmation and appear as a timeout from the extension side.
        fail(
          new DownloadToolError(
            'browser_settings',
            `${baseMessage}. currentState=${state}; filename=${filename || '<empty>'}. ` +
              `If Chrome is configured to ask save location each time, disable that setting ` +
              `or run with saveAs=true for interactive flow.`,
            { state, filename },
          ),
        );
      } catch (error) {
        fail(classifyDownloadFailure(error));
      }
    };
    const finish = async () => {
      try {
        const [found] = await chrome.downloads.search({ id: downloadId });
        if (!found) {
          fail(new DownloadToolError('not_found', `Download ${downloadId} not found`));
          return;
        }
        cleanup();
        resolve({
          id: found.id,
          filename: found.filename,
          savedPath: found.filename || undefined,
          url: found.url,
          mime: (found as any).mime || undefined,
          fileSize: found.fileSize ?? found.totalBytes ?? undefined,
          state: found.state,
          danger: found.danger,
          startTime: found.startTime,
          endTime: (found as any).endTime || undefined,
          exists: (found as any).exists,
        });
      } catch (error) {
        fail(error);
      }
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (!delta || delta.id !== downloadId) return;
      const state = delta.state?.current;
      if (!state) return;
      if (!waitForComplete) {
        finish();
        return;
      }
      if (state === 'complete') {
        finish();
        return;
      }
      if (state === 'interrupted') {
        fail(new DownloadToolError('interrupted', `Download ${downloadId} interrupted`));
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    timer = setTimeout(() => {
      void failWithDownloadState('Download wait timed out');
    }, timeoutMs);
    chrome.downloads
      .search({ id: downloadId })
      .then((rows) => {
        const row = rows?.[0];
        if (!row) return;
        if (!waitForComplete || row.state === 'complete') {
          finish();
        }
      })
      .catch(() => {});
  });
}

export const handleDownloadTool = new HandleDownloadTool();
// Install global download routing when the background module is loaded.
ensureGlobalSilentDownloadRouting();
