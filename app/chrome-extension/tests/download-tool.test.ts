import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDownloadTool } from '@/entrypoints/background/tools/browser/download';

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

  beforeEach(() => {
    vi.restoreAllMocks();
    changedListeners = [];
    createdListeners = [];
    determiningListeners = [];

    const downloadsStore = new Map<number, Partial<chrome.downloads.DownloadItem>>();

    chrome.runtime.lastError = undefined;
    chrome.downloads = {
      download: vi.fn((options: chrome.downloads.DownloadOptions, callback?: (id?: number) => void) => {
        const id = 101;
        downloadsStore.set(id, {
          id,
          filename: `C:\\Users\\test\\Downloads\\${options.filename || 'unknown'}`,
          url: options.url || '',
          state: 'in_progress',
        });
        callback?.(id);
      }) as any,
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

  it('actively downloads via extension and returns savedPath', async () => {
    const run = handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'report.txt',
      waitForComplete: true,
      timeoutMs: 3000,
    });

    setTimeout(() => {
      changedListeners.forEach((listener) => {
        listener({
          id: 101,
          state: { current: 'complete' },
        } as chrome.downloads.DownloadDelta);
      });
    }, 0);

    const result = await run;
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { text: string }).text;
    const payload = JSON.parse(text);
    expect(payload.success).toBe(true);
    expect(payload.download.savedPath).toContain('Downloads');
    expect(payload.download.savedPath).toContain('tabrix/report.txt');
    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/file.txt',
        filename: 'tabrix/report.txt',
        saveAs: false,
        conflictAction: 'uniquify',
      }),
      expect.any(Function),
    );
  });

  it('returns diagnostic message when timeout occurs', async () => {
    const result = await handleDownloadTool.execute({
      url: 'https://example.com/file.txt',
      filename: 'stuck.txt',
      waitForComplete: true,
      timeoutMs: 10,
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Download wait timed out');
    expect(text).toContain('ask save location each time');
  });
});

