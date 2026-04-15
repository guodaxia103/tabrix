import { beforeEach, describe, expect, it, vi } from 'vitest';

const { attachMock, detachMock, sendCommandMock } = vi.hoisted(() => ({
  attachMock: vi.fn(),
  detachMock: vi.fn(),
  sendCommandMock: vi.fn(),
}));

vi.mock('@/utils/cdp-session-manager', () => ({
  cdpSessionManager: {
    attach: attachMock,
    detach: detachMock,
    sendCommand: sendCommandMock,
  },
}));

import { prearmDialogHandling } from '@/entrypoints/background/tools/browser/dialog-prearm';

describe('prearmDialogHandling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('attaches and enables the page domain before scheduling detach', async () => {
    attachMock.mockResolvedValue(undefined);
    sendCommandMock.mockResolvedValue({});
    detachMock.mockResolvedValue(undefined);

    await prearmDialogHandling(321, 50);

    expect(attachMock).toHaveBeenCalledWith(321, 'dialog-prearm:321');
    expect(sendCommandMock).toHaveBeenCalledWith(321, 'Page.enable');

    await vi.advanceTimersByTimeAsync(50);
    expect(detachMock).toHaveBeenCalledWith(321, 'dialog-prearm:321');
  });

  it('keeps the click path non-failing when attach is unavailable', async () => {
    attachMock.mockRejectedValue(new Error('Debugger already attached'));

    await expect(prearmDialogHandling(654, 50)).resolves.toBeUndefined();
    expect(sendCommandMock).not.toHaveBeenCalled();
  });
});
