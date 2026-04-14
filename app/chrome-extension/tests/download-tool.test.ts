import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDownloadTool } from '@/entrypoints/background/tools/browser/download';
import {
  registerNativeBridgeForwarder,
  registerNativeBridgeRequester,
} from '@/entrypoints/background/native-bridge';

type DownloadListener = (delta: chrome.downloads.DownloadDelta) => void;

describe('handleDownloadTool', () => {
  let changedListeners: DownloadListener[] = [];
  let createdListeners: Array<(item: chrome.downloads.DownloadItem) => void> = [];
  let determiningListeners: Array<
    (
      item: chrome.downloads.DownloadItem,
      suggest: (suggestion?: chrome.downloads.DownloadFilenameSuggestion) => void,
    ) => void
  > = [];
  let runtimeMessageListeners: Array<(message: any) => void> = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    registerNativeBridgeForwarder(null);
    registerNativeBridgeRequester(null);
    changedListeners = [];
    createdListeners = [];
    determiningListeners = [];
    runtimeMessageListeners = [];

    const downloadsStore = new Map<number, Partial<chrome.downloads.DownloadItem>>();
    let nextId = 100;

    chrome.runtime.lastError = undefined;
    chrome.runtime.onMessage = {
      addListener: vi.fn((listener: (message: any) => void) => {
        runtimeMessageListeners.push(listener);
      }),
      removeListener: vi.fn((listener: (message: any) => void) => {
        runtimeMessageListeners = runtimeMessageListeners.filter((l) => l !== listener);
      }),
    } as any;
    chrome.runtime.sendMessage = vi.fn(async (message: any) => {
      if (message?.type === 'forward_to_native') {
        const requestId = message?.message?.requestId;
        setTimeout(() => {
          runtimeMessageListeners.forEach((listener) =>
            listener({
              type: 'file_operation_response',
              responseToRequestId: requestId,
              payload: {
                success: true,
                filePath: `C:\\Temp\\chrome-mcp-uploads\\${message?.message?.payload?.fileName || 'download.bin'}`,
                fileName: message?.message?.payload?.fileName || 'download.bin',
                size: 123,
              },
            }),
          );
        }, 0);
      }
      return { success: true };
    }) as any;
    chrome.downloads = {
      download: vi.fn(
        (options: chrome.downloads.DownloadOptions, callback?: (id?: number) => void) => {
          const id = ++nextId;
          downloadsStore.set(id, {
            id,
            filename: `C:\\Users\\test\\Downloads\\${options.filename || 'unknown'}`,
            url: options.url || '',
            state: 'in_progress',
          });
          callback?.(id);
        },
      ) as any,
      search: vi.fn(async (query: chrome.downloads.DownloadQuery) => {
        if (typeof query.id === 'number') {
          const hit = downloadsStore.get(query.id);
          return hit ? ([hit] as chrome.downloads.DownloadItem[]) : [];
        }
        return Array.from(downloadsStore.values()) as chrome.downloads.DownloadItem[];
      }) as any,
      onChanged: {
        addListener: vi.fn((listener: DownloadListener) => {
          changedListeners.push(listener);
        }),
        removeListener: vi.fn((listener: DownloadListener) => {
          changedListeners = changedListeners.filter((l) => l !== listener);
        }),
      } as any,
      onCreated: {
        addListener: vi.fn((listener: (item: chrome.downloads.DownloadItem) => void) => {
          createdListeners.push(listener);
        }),
        removeListener: vi.fn((listener: (item: chrome.downloads.DownloadItem) => void) => {
          createdListeners = createdListeners.filter((l) => l !== listener);
        }),
      } as any,
      onDeterminingFilename: {
        addListener: vi.fn(
          (
            listener: (
              item: chrome.downloads.DownloadItem,
              suggest: (suggestion?: chrome.downloads.DownloadFilenameSuggestion) => void,
            ) => void,
          ) => {
            determiningListeners.push(listener);
          },
        ),
        removeListener: vi.fn(
          (
            listener: (
              item: chrome.downloads.DownloadItem,
              suggest: (suggestion?: chrome.downloads.DownloadFilenameSuggestion) => void,
            ) => void,
          ) => {
            determiningListeners = determiningListeners.filter((l) => l !== listener);
          },
        ),
      } as any,
    } as any;
  });

  it('prefers the in-worker native request bridge over runtime message forwarding when available', async () => {
    registerNativeBridgeRequester(async (request) => {
      expect(request.requestId).toContain('download-native');
      return {
        success: true,
        filePath: 'C:\\Temp\\chrome-mcp-uploads\\bridge.txt',
        fileName: 'bridge.txt',
        size: 456,
      };
    });

    const result = await handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'bridge.txt',
      waitForComplete: true,
      timeoutMs: 3000,
    });

    expect(result.isError).toBe(false);
    const text = (result.content[0] as { text: string }).text;
    const payload = JSON.parse(text);
    expect(payload.download.savedPath).toContain('bridge.txt');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('downloads via native host by default and returns savedPath', async () => {
    const result = await handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'report.txt',
      waitForComplete: true,
      timeoutMs: 3000,
    });
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { text: string }).text;
    const payload = JSON.parse(text);
    expect(payload.success).toBe(true);
    expect(payload.download.savedPath).toContain('chrome-mcp-uploads');
    expect(payload.download.filename).toBe('report.txt');
    expect(payload.download.source).toBe('native');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'forward_to_native',
      }),
    );
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it('returns diagnostic message when native download timeout occurs', async () => {
    chrome.runtime.sendMessage = vi.fn(async (_message: any) => ({ success: true })) as any;
    const result = await handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'stuck.txt',
      waitForComplete: true,
      timeoutMs: 10,
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Native file operation timed out');
  });

  it('does not fallback to browser download when native bridge is unavailable by default', async () => {
    chrome.runtime.sendMessage = vi.fn(async (_message: any) => ({
      success: false,
      error: 'Native host not connected',
    })) as any;
    const result = await handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'no-fallback.txt',
      waitForComplete: true,
      timeoutMs: 3000,
    });

    expect(result.isError).toBe(true);
    expect(chrome.downloads.download).not.toHaveBeenCalled();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Native host is not connected');
  });

  it('dedupes duplicate requests within task scope by default (join policy)', async () => {
    const firstRun = handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'dup.txt',
      waitForComplete: true,
      timeoutMs: 3000,
      taskId: 'task-join-1',
    });
    const secondRun = handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'dup.txt',
      waitForComplete: true,
      timeoutMs: 3000,
      taskId: 'task-join-1',
    });

    const [first, second] = await Promise.all([firstRun, secondRun]);
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    const payload1 = JSON.parse((first.content[0] as { text: string }).text);
    const payload2 = JSON.parse((second.content[0] as { text: string }).text);
    expect(payload1.dedupe.reused).toBe(false);
    expect(payload2.dedupe.reused).toBe(true);
  });

  it('can bypass dedupe with force policy in same task scope', async () => {
    const firstRun = handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'force.txt',
      waitForComplete: true,
      timeoutMs: 3000,
      taskId: 'task-force-1',
      dedupePolicy: 'force',
    });
    const secondRun = handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'force.txt',
      waitForComplete: true,
      timeoutMs: 3000,
      taskId: 'task-force-1',
      dedupePolicy: 'force',
    });

    const [first, second] = await Promise.all([firstRun, secondRun]);
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    const payload1 = JSON.parse((first.content[0] as { text: string }).text);
    const payload2 = JSON.parse((second.content[0] as { text: string }).text);
    expect(payload1.dedupe.policy).toBe('force');
    expect(payload2.dedupe.policy).toBe('force');
    expect(payload1.dedupe.reused).toBe(false);
    expect(payload2.dedupe.reused).toBe(false);
  });
});
