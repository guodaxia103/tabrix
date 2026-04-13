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

/**
 * Tool: wait for a download and return info
 */
class HandleDownloadTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD as any;

  async execute(args: HandleDownloadParams): Promise<ToolResult> {
    const filenameContains = String(args?.filenameContains || '').trim();
    const downloadUrl = String(args?.url || '').trim();
    const requestedFilename = String(args?.filename || '').trim();
    const saveAs = args?.saveAs === true;
    const waitForComplete = args?.waitForComplete !== false;
    const timeoutMs = Math.max(1000, Math.min(Number(args?.timeoutMs ?? 60000), 300000));
    let triggerDownload: (() => Promise<void>) | undefined;
    let effectiveFilter = filenameContains;
    let autoRouteFilename = true;

    if (downloadUrl) {
      autoRouteFilename = false;
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
      if (!effectiveFilter && !requestedFilename) {
        effectiveFilter = safeLeaf;
      }
      triggerDownload = async () =>
        await new Promise<void>((resolve, reject) => {
          chrome.downloads.download(
            {
              url: downloadUrl,
              filename: targetFilename,
              conflictAction: 'uniquify',
              saveAs,
            },
            (downloadId) => {
              const lastError = chrome.runtime.lastError;
              if (lastError) {
                reject(new Error(lastError.message));
                return;
              }
              if (typeof downloadId !== 'number') {
                reject(new Error('Download did not return a valid downloadId'));
                return;
              }
              resolve();
            },
          );
        });
    }

    try {
      const result = await waitForDownload({
        filenameContains: effectiveFilter,
        waitForComplete,
        timeoutMs,
        triggerDownload,
        autoRouteFilename,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, download: result }) }],
        isError: false,
      };
    } catch (e: any) {
      return createErrorResponse(`Handle download failed: ${e?.message || String(e)}`);
    }
  }
}

async function waitForDownload(opts: {
  filenameContains?: string;
  waitForComplete: boolean;
  timeoutMs: number;
  triggerDownload?: () => Promise<void>;
  autoRouteFilename?: boolean;
}) {
  const {
    filenameContains,
    waitForComplete,
    timeoutMs,
    triggerDownload,
    autoRouteFilename = true,
  } = opts;
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
        resolve({ id: item.id, filename: item.filename, url: item.url, state: item.state });
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
        if (!autoRouteFilename) {
          suggest();
          return;
        }
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
    if (triggerDownload) {
      triggerDownload().catch((error) => onError(error));
    }
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

export const handleDownloadTool = new HandleDownloadTool();
