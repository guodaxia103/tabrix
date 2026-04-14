import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { prepareFileViaNative } from './native-file';

interface HandleDownloadParams {
  filenameContains?: string;
  url?: string;
  filename?: string;
  saveAs?: boolean;
  allowBrowserFallback?: boolean; // debug-only: allow fallback to chrome.downloads when native is unavailable
  timeoutMs?: number; // default 60000
  waitForComplete?: boolean; // default true
  sessionId?: string;
  taskId?: string;
  dedupeWindowSec?: number; // default 60
  dedupePolicy?: 'join' | 'force';
}

const AUTO_DOWNLOAD_SUBDIR = 'tabrix';
const INTERACTIVE_BYPASS_WINDOW_MS = 15000;
const DOWNLOAD_MAX_CONCURRENCY = 5;
const DOWNLOAD_DEFAULT_DEDUPE_WINDOW_SEC = 60;

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
let downloadActiveCount = 0;
const downloadWaiters: Array<() => void> = [];
const downloadDedupeCache = new Map<
  string,
  {
    promise: Promise<any>;
    expiresAt: number;
  }
>();

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

function normalizeUrlForDedupe(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function normalizeScopeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveDownloadScope(args: HandleDownloadParams): string {
  const taskId = normalizeScopeId(args?.taskId);
  if (taskId) return `task:${taskId}`;
  const sessionId = normalizeScopeId(args?.sessionId);
  if (sessionId) return `session:${sessionId}`;
  return 'global';
}

function getDedupeWindowMs(args: HandleDownloadParams): number {
  const raw = Number(args?.dedupeWindowSec);
  if (!Number.isFinite(raw)) return DOWNLOAD_DEFAULT_DEDUPE_WINDOW_SEC * 1000;
  const sec = Math.min(300, Math.max(1, Math.floor(raw)));
  return sec * 1000;
}

function getDedupePolicy(args: HandleDownloadParams): 'join' | 'force' {
  return args?.dedupePolicy === 'force' ? 'force' : 'join';
}

function cleanupExpiredDedupeEntries(now = Date.now()): void {
  for (const [key, entry] of downloadDedupeCache.entries()) {
    if (entry.expiresAt <= now) {
      downloadDedupeCache.delete(key);
    }
  }
}

function buildDedupeKey(params: {
  scope: string;
  url: string;
  filename: string;
  saveAs: boolean;
  waitForComplete: boolean;
}): string {
  const { scope, url, filename, saveAs, waitForComplete } = params;
  return JSON.stringify({
    scope,
    url: normalizeUrlForDedupe(url),
    filename,
    saveAs,
    waitForComplete,
  });
}

async function acquireDownloadSlot(): Promise<void> {
  if (downloadActiveCount < DOWNLOAD_MAX_CONCURRENCY) {
    downloadActiveCount += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    downloadWaiters.push(() => {
      downloadActiveCount += 1;
      resolve();
    });
  });
}

function releaseDownloadSlot(): void {
  downloadActiveCount = Math.max(0, downloadActiveCount - 1);
  const next = downloadWaiters.shift();
  if (next) {
    next();
  }
}

async function runWithDownloadQueue<T>(fn: () => Promise<T>): Promise<T> {
  await acquireDownloadSlot();
  try {
    return await fn();
  } finally {
    releaseDownloadSlot();
  }
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

interface NativeFileResponsePayload {
  success?: boolean;
  filePath?: string;
  fileName?: string;
  size?: number;
  error?: string;
}

function hasNativeFileBridge(): boolean {
  const runtime = chrome?.runtime as any;
  return Boolean(
    runtime &&
    typeof runtime.sendMessage === 'function' &&
    runtime.onMessage &&
    typeof runtime.onMessage.addListener === 'function' &&
    typeof runtime.onMessage.removeListener === 'function',
  );
}

async function downloadViaNativeHost(opts: {
  url: string;
  fileName: string;
  timeoutMs: number;
}): Promise<{
  id: null;
  filename: string;
  savedPath?: string;
  url: string;
  fileSize?: number;
  state: 'complete';
  source: 'native';
}> {
  const { url, fileName, timeoutMs } = opts;
  if (!hasNativeFileBridge()) {
    throw new DownloadToolError(
      'session',
      'Native file bridge is unavailable in current runtime context',
    );
  }
  const requestId = `download-native-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const payload = await new Promise<NativeFileResponsePayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new DownloadToolError('timeout', `Native download timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const listener = (message: any) => {
      if (
        message &&
        message.type === 'file_operation_response' &&
        message.responseToRequestId === requestId
      ) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        if (message.error) {
          reject(
            new DownloadToolError('session', `Native download failed: ${String(message.error)}`),
          );
          return;
        }
        resolve((message.payload || {}) as NativeFileResponsePayload);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime
      .sendMessage({
        type: 'forward_to_native',
        message: {
          type: 'file_operation',
          requestId,
          payload: {
            action: 'prepareFile',
            fileUrl: url,
            fileName,
          },
        },
      })
      .then((response: any) => {
        if (response?.success !== true) {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(listener);
          reject(
            new DownloadToolError(
              'session',
              `Native host is not connected: ${response?.error || 'forward_to_native rejected'}`,
            ),
          );
        }
      })
      .catch((error) => {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        reject(
          new DownloadToolError(
            'session',
            `Failed to contact native host for download: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      });
  });

  if (!payload?.success || !payload.filePath) {
    throw new DownloadToolError(
      'session',
      `Native download did not produce a file path: ${payload?.error || 'unknown reason'}`,
    );
  }

  return {
    id: null,
    filename: payload.fileName || fileName,
    savedPath: payload.filePath,
    url,
    fileSize: payload.size,
    state: 'complete',
    source: 'native',
  };
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
    const allowBrowserFallback = args?.allowBrowserFallback === true;
    const waitForComplete = args?.waitForComplete !== false;
    const timeoutMs = Math.max(1000, Math.min(Number(args?.timeoutMs ?? 60000), 300000));
    const effectiveFilter = filenameContains;

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
      const scope = resolveDownloadScope(args);
      const dedupeWindowMs = getDedupeWindowMs(args);
      const dedupePolicy = getDedupePolicy(args);
      const dedupeKey = buildDedupeKey({
        scope,
        url: downloadUrl,
        filename: targetFilename,
        saveAs,
        waitForComplete,
      });

      try {
        const now = Date.now();
        cleanupExpiredDedupeEntries(now);
        let reused = false;
        let dedupeEntry = downloadDedupeCache.get(dedupeKey);
        if (dedupePolicy === 'join' && dedupeEntry && dedupeEntry.expiresAt > now) {
          reused = true;
        } else {
          const promise = runWithDownloadQueue(async () => {
            if (!saveAs) {
              try {
                return await downloadViaNativeHost({
                  url: downloadUrl,
                  fileName: safeLeaf,
                  timeoutMs,
                });
              } catch (error) {
                const parsed = classifyDownloadFailure(error);
                // Hard default: no browser fallback in silent mode to prevent Save As popups.
                if (parsed.code !== 'session' || !allowBrowserFallback) {
                  throw parsed;
                }
                return await triggerDownloadAndWait({
                  url: downloadUrl,
                  filename: targetFilename,
                  saveAs: false,
                  waitForComplete,
                  timeoutMs,
                });
              }
            }
            return await triggerDownloadAndWait({
              url: downloadUrl,
              filename: targetFilename,
              saveAs,
              waitForComplete,
              timeoutMs,
            });
          }).catch((error) => {
            // Failed entries should not stay cached; allow immediate retry.
            downloadDedupeCache.delete(dedupeKey);
            throw error;
          });
          dedupeEntry = {
            promise,
            expiresAt: now + dedupeWindowMs,
          };
          downloadDedupeCache.set(dedupeKey, dedupeEntry);
        }
        const triggered = await dedupeEntry.promise;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                download: triggered,
                dedupe: {
                  policy: dedupePolicy,
                  windowSec: Math.floor(dedupeWindowMs / 1000),
                  scope,
                  reused,
                },
                queue: {
                  maxConcurrency: DOWNLOAD_MAX_CONCURRENCY,
                  active: downloadActiveCount,
                  pending: downloadWaiters.length,
                },
              }),
            },
          ],
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

  const waitForDownloadId = async (id: number, maxWaitMs: number) => {
    return await new Promise<any>((resolveById, rejectById) => {
      let waitTimer: any = null;
      const cleanupById = () => {
        try {
          if (waitTimer) clearTimeout(waitTimer);
        } catch {}
        try {
          chrome.downloads.onChanged.removeListener(onChangedById);
        } catch {}
      };
      const finishById = async () => {
        try {
          const [found] = await chrome.downloads.search({ id });
          if (!found) {
            cleanupById();
            rejectById(new DownloadToolError('not_found', `Download ${id} not found`));
            return;
          }
          cleanupById();
          resolveById({
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
          cleanupById();
          rejectById(classifyDownloadFailure(error));
        }
      };
      const onChangedById = (delta: chrome.downloads.DownloadDelta) => {
        if (!delta || delta.id !== id) return;
        const state = delta.state?.current;
        if (!state) return;
        if (!waitForComplete) {
          void finishById();
          return;
        }
        if (state === 'complete') {
          void finishById();
          return;
        }
        if (state === 'interrupted') {
          cleanupById();
          rejectById(new DownloadToolError('interrupted', `Download ${id} interrupted`));
        }
      };
      chrome.downloads.onChanged.addListener(onChangedById);
      waitTimer = setTimeout(
        () => rejectById(new DownloadToolError('timeout', `Download ${id} timed out`)),
        maxWaitMs,
      );
      void chrome.downloads
        .search({ id })
        .then((rows) => {
          const row = rows?.[0];
          if (!row) return;
          if (!waitForComplete || row.state === 'complete') {
            void finishById();
          }
        })
        .catch(() => {});
    });
  };

  const fallbackSilentDownload = async () => {
    try {
      try {
        await chrome.downloads.cancel(downloadId);
      } catch {}
      try {
        await chrome.downloads.erase({ id: downloadId });
      } catch {}
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new DownloadToolError('session', `Fallback fetch failed: HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolveDataUrl, rejectDataUrl) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolveDataUrl(reader.result);
          else rejectDataUrl(new Error('Fallback produced non-string data URL'));
        };
        reader.onerror = () =>
          rejectDataUrl(reader.error || new Error('Fallback FileReader failed'));
        reader.readAsDataURL(blob);
      });
      const nativeSaved = await prepareFileViaNative({
        base64Data: dataUrl,
        fileName: filename.split('/').pop() || filename,
        requestPrefix: 'download-fallback',
      });
      return {
        id: null,
        filename,
        savedPath: nativeSaved.fullPath,
        url,
        fileSize: nativeSaved.size,
        state: 'complete',
        source: 'native-fallback',
      };
    } catch (error) {
      throw classifyDownloadFailure(error);
    }
  };

  return await new Promise<any>((resolve, reject) => {
    let timer: any = null;
    let blockedProbeTimer: any = null;
    const cleanup = () => {
      try {
        if (timer) clearTimeout(timer);
      } catch {}
      try {
        if (blockedProbeTimer) clearTimeout(blockedProbeTimer);
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
        if (state === 'in_progress' && !filename) {
          try {
            const fallback = await fallbackSilentDownload();
            cleanup();
            resolve(fallback);
            return;
          } catch (error) {
            fail(classifyDownloadFailure(error));
            return;
          }
        }
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

    // Fast-fail probe: detect likely Save-As blocking early instead of waiting full timeout.
    // If a download stays "in_progress" without a resolved filename for several seconds,
    // it is typically waiting on a native save dialog.
    const blockedProbeStartedAt = Date.now();
    const blockedProbe = async () => {
      try {
        const [row] = await chrome.downloads.search({ id: downloadId });
        if (!row) return;
        if (row.state === 'complete' || row.state === 'interrupted') return;
        const hasFilename = typeof row.filename === 'string' && row.filename.trim().length > 0;
        const elapsed = Date.now() - blockedProbeStartedAt;
        if (!hasFilename && elapsed >= Math.min(8000, timeoutMs)) {
          await failWithDownloadState('Download appears blocked (likely waiting for Save As)');
          return;
        }
      } catch {
        // ignore probe failures
      }
      blockedProbeTimer = setTimeout(() => {
        void blockedProbe();
      }, 1000);
    };
    blockedProbeTimer = setTimeout(() => {
      void blockedProbe();
    }, 1500);

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
