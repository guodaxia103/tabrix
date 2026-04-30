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

import {
  networkDebuggerStartTool,
  networkDebuggerStopTool,
} from '@/entrypoints/background/tools/browser/network-capture-debugger';

describe('V27-CDP-01 network debugger controlled evidence', () => {
  type DebuggerListener = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: Record<string, unknown>,
  ) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 88,
      url: 'https://neutral-social.example.test/search?keyword=desk',
      title: 'Search',
      windowId: 1,
      active: true,
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 88,
        url: 'https://neutral-social.example.test/search?keyword=desk',
        title: 'Search',
        windowId: 1,
        active: true,
      } as chrome.tabs.Tab,
    ]);
    attachMock.mockResolvedValue(undefined);
    detachMock.mockResolvedValue(undefined);
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Network.getResponseBody') {
        return {
          body: JSON.stringify({ items: [{ title: 'desk result', score: 7 }] }),
          base64Encoded: false,
        };
      }
      return {};
    });
  });

  it('returns controlled CDP evidence and compacted body metadata on success', async () => {
    const start = await networkDebuggerStartTool.execute({
      tabId: 88,
      maxCaptureTime: 0,
      inactivityTimeout: 0,
    });
    const startPayload = JSON.parse(String(start.content[0].text));

    expect(start.isError).toBe(false);
    expect(startPayload).toMatchObject({
      observationMode: 'cdp_enhanced',
      cdpUsed: true,
      cdpReason: 'need_response_body',
      debuggerConflict: false,
      rawBodyPersisted: false,
      maxBodyBytes: expect.any(Number),
      maxRequests: expect.any(Number),
    });

    const emitDebuggerEvent = (
      networkDebuggerStartTool as unknown as {
        handleDebuggerEvent: DebuggerListener;
      }
    ).handleDebuggerEvent.bind(networkDebuggerStartTool);

    emitDebuggerEvent({ tabId: 88 }, 'Network.requestWillBeSent', {
      requestId: 'r1',
      request: {
        url: 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1',
        method: 'GET',
      },
      type: 'XHR',
      timestamp: 100,
    });
    emitDebuggerEvent({ tabId: 88 }, 'Network.responseReceived', {
      requestId: 'r1',
      type: 'XHR',
      timestamp: 101,
      response: {
        url: 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1',
        status: 200,
        statusText: 'OK',
        mimeType: 'application/json',
        headers: { 'content-type': 'application/json' },
      },
    });
    await emitDebuggerEvent({ tabId: 88 }, 'Network.loadingFinished', {
      requestId: 'r1',
      encodedDataLength: 96,
    });

    const stop = await networkDebuggerStopTool.execute({ tabId: 88 });
    const stopPayload = JSON.parse(String(stop.content[0].text));
    const blob = JSON.stringify(stopPayload);

    expect(stop.isError).toBe(false);
    expect(stopPayload).toMatchObject({
      observationMode: 'cdp_enhanced',
      cdpUsed: true,
      cdpReason: 'need_response_body',
      cdpDetachSuccess: true,
      debuggerConflict: false,
      responseBodySource: 'debugger_api',
      rawBodyPersisted: false,
      bodyCompacted: true,
      fallbackCause: null,
    });
    expect(stopPayload.requests[0]).toMatchObject({
      responseBodySource: 'debugger_api',
      rawBodyPersisted: false,
      bodyCompacted: true,
      base64Encoded: false,
    });
    expect(blob).toContain('responseBody');
    expect(blob).not.toContain('Authorization');
  });

  it('reports debugger conflict as fallback evidence without claiming CDP use', async () => {
    attachMock.mockRejectedValueOnce(new Error('Debugger is already attached to tab 88'));

    const start = await networkDebuggerStartTool.execute({
      tabId: 88,
      maxCaptureTime: 0,
      inactivityTimeout: 0,
    });
    const payload = JSON.parse(String(start.content[0].text));

    expect(start.isError).toBe(true);
    expect(payload).toMatchObject({
      success: false,
      observationMode: 'no_cdp',
      cdpUsed: false,
      debuggerConflict: true,
      cdpDetachSuccess: false,
      rawBodyPersisted: false,
      fallbackCause: 'debugger_conflict',
    });
  });
});
