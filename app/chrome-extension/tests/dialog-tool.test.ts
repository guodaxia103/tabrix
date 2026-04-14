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

  it('surfaces an error after exhausting dialog retries', async () => {
    sendCommandMock.mockResolvedValueOnce({});
    for (let attempt = 0; attempt < 10; attempt += 1) {
      sendCommandMock.mockRejectedValueOnce(new Error('No dialog is showing'));
    }

    const result = await handleDialogTool.execute({
      action: 'accept',
      promptText: 'phase0-dialog',
      tabId: 123,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as { text: string }).text).toContain('Failed to handle dialog');
    expect(sendCommandMock).toHaveBeenCalledTimes(12);
  });
});
