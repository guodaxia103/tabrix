import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendCommandMock, withSessionMock } = vi.hoisted(() => ({
  sendCommandMock: vi.fn(),
  withSessionMock: vi.fn(
    async (_tabId: number, _owner: string, fn: () => Promise<unknown>) => await fn(),
  ),
}));

vi.mock('@/utils/cdp-session-manager', () => ({
  cdpSessionManager: {
    withSession: withSessionMock,
    sendCommand: sendCommandMock,
  },
}));

import { handleDialogTool } from '@/entrypoints/background/tools/browser/dialog';

describe('handleDialogTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 123,
      windowId: 1,
      active: true,
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 123,
        windowId: 1,
        active: true,
      } as chrome.tabs.Tab,
    ]);
  });

  it('retries when CDP reports that no dialog is showing yet', async () => {
    sendCommandMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('No dialog is showing'))
      .mockResolvedValueOnce({});

    const result = await handleDialogTool.execute({
      action: 'accept',
      promptText: 'phase0-dialog',
      tabId: 123,
    });

    expect(result.isError).toBe(false);
    expect(sendCommandMock).toHaveBeenCalledTimes(3);
    expect(sendCommandMock).toHaveBeenNthCalledWith(1, 123, 'Page.enable');
    expect(sendCommandMock).toHaveBeenNthCalledWith(3, 123, 'Page.handleJavaScriptDialog', {
      accept: true,
      promptText: 'phase0-dialog',
    });
  });

  it('continues with direct dialog handling when Page.enable times out', async () => {
    sendCommandMock
      .mockRejectedValueOnce(new Error('Enable dialog domain timed out'))
      .mockResolvedValueOnce({});

    const result = await handleDialogTool.execute({
      action: 'accept',
      promptText: 'phase0-dialog',
      tabId: 123,
    });

    expect(result.isError).toBe(false);
    expect(sendCommandMock).toHaveBeenNthCalledWith(1, 123, 'Page.enable');
    expect(sendCommandMock).toHaveBeenNthCalledWith(2, 123, 'Page.handleJavaScriptDialog', {
      accept: true,
      promptText: 'phase0-dialog',
    });
  });

  it('keeps polling long enough for a delayed dialog to appear', async () => {
    vi.useFakeTimers();

    sendCommandMock.mockResolvedValueOnce({});
    for (let attempt = 0; attempt < 15; attempt += 1) {
      sendCommandMock.mockRejectedValueOnce(new Error('No dialog is showing'));
    }
    sendCommandMock.mockResolvedValueOnce({});

    const resultPromise = handleDialogTool.execute({
      action: 'accept',
      promptText: 'phase0-dialog',
      tabId: 123,
    });

    await vi.advanceTimersByTimeAsync(1600);
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    expect(sendCommandMock).toHaveBeenLastCalledWith(123, 'Page.handleJavaScriptDialog', {
      accept: true,
      promptText: 'phase0-dialog',
    });
  });

  it('falls back to another tab when no explicit tabId is provided', async () => {
    vi.useFakeTimers();

    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 123, windowId: 1, active: true } as chrome.tabs.Tab,
      { id: 456, windowId: 2, active: true } as chrome.tabs.Tab,
    ]);

    sendCommandMock.mockImplementation(async (tabId: number, method: string) => {
      if (method === 'Page.enable') {
        return {};
      }
      if (tabId === 123) {
        throw new Error('No dialog is showing');
      }
      if (tabId === 456) {
        return {};
      }
      throw new Error(`Unexpected tab ${tabId}`);
    });

    const resultPromise = handleDialogTool.execute({
      action: 'accept',
      promptText: 'phase0-dialog',
    });

    await vi.advanceTimersByTimeAsync(6200);
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    expect(sendCommandMock).toHaveBeenLastCalledWith(456, 'Page.handleJavaScriptDialog', {
      accept: true,
      promptText: 'phase0-dialog',
    });
    expect((result.content[0] as { text: string }).text).toContain('"tabId":456');
  });

  it('falls back to another tab when the requested tab has no visible dialog', async () => {
    vi.useFakeTimers();

    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 123, windowId: 1, active: true } as chrome.tabs.Tab,
      { id: 456, windowId: 2, active: true } as chrome.tabs.Tab,
    ]);

    sendCommandMock.mockImplementation(async (tabId: number, method: string) => {
      if (method === 'Page.enable') {
        return {};
      }
      if (tabId === 123) {
        throw new Error('No dialog is showing');
      }
      if (tabId === 456) {
        return {};
      }
      throw new Error(`Unexpected tab ${tabId}`);
    });

    const resultPromise = handleDialogTool.execute({
      action: 'accept',
      promptText: 'phase0-dialog',
      tabId: 123,
    });

    await vi.advanceTimersByTimeAsync(6200);
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    expect(sendCommandMock).toHaveBeenLastCalledWith(456, 'Page.handleJavaScriptDialog', {
      accept: true,
      promptText: 'phase0-dialog',
    });
    expect((result.content[0] as { text: string }).text).toContain('"tabId":456');
  });

  it('surfaces an error after exhausting dialog retries', async () => {
    vi.useFakeTimers();

    sendCommandMock.mockResolvedValueOnce({});
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Page.enable') {
        return {};
      }
      throw new Error('No dialog is showing');
    });

    const resultPromise = handleDialogTool.execute({
      action: 'accept',
      promptText: 'phase0-dialog',
      tabId: 123,
    });
    await vi.advanceTimersByTimeAsync(7000);
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as { text: string }).text).toContain('Failed to handle dialog');
    expect(sendCommandMock).toHaveBeenCalled();
  });
});
