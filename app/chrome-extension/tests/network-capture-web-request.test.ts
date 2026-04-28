import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyNetworkCaptureEndpoint,
  evaluateNetworkCaptureObserveModeGate,
  isNetworkCaptureObserveMode,
  networkCaptureStartTool,
  networkCaptureStopTool,
  redactNetworkCaptureUrlForMetadata,
  sanitizeNetworkCaptureHeaders,
} from '@/entrypoints/background/tools/browser/network-capture-web-request';
import { responseSummarySampler } from '@/entrypoints/background/tools/browser/response-summary-sampler';

const RESPONSE_SUMMARY_MESSAGE = 'tabrix:v27-response-summary';

describe('network capture webRequest metadata helpers', () => {
  it('redacts raw query values while preserving query keys', () => {
    const redacted = redactNetworkCaptureUrlForMetadata(
      'https://api.github.com/search/repositories?q=AI助手&sort=stars&order=desc',
    );

    expect(redacted).toBe('https://api.github.com/search/repositories?order=&q=&sort=');
    expect(redacted).not.toContain('AI助手');
    expect(redacted).not.toContain('stars');
    expect(redacted).not.toContain('desc');
  });

  it('keeps only safe header names and strips all header values', () => {
    const headers = sanitizeNetworkCaptureHeaders({
      Authorization: 'Bearer ghp_SECRET',
      Cookie: 'session=secret',
      Accept: 'application/json',
      'User-Agent': 'Tabrix',
      'X-Api-Key': 'sk-secret',
    });

    expect(headers).toEqual({
      accept: '',
      'user-agent': '',
    });
    expect(JSON.stringify(headers)).not.toMatch(/SECRET|session=|Tabrix|sk-secret/);
  });

  it('classifies usable API candidates and noisy private telemetry separately', () => {
    expect(
      classifyNetworkCaptureEndpoint({
        url: 'https://api.github.com/search/repositories?q=',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toBe('usable');
    expect(
      classifyNetworkCaptureEndpoint({
        url: 'https://api.github.com/_private/browser/stats?token=',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toBe('private');
    expect(
      classifyNetworkCaptureEndpoint({
        url: 'https://assets.example.test/app.css',
        method: 'GET',
        type: 'stylesheet',
        mimeType: 'text/css',
      }),
    ).toBe('asset');
  });
});

describe('V26-FIX-02 — network capture observe-mode gate', () => {
  it('null override → proceed (legacy v2.5 behaviour)', () => {
    expect(evaluateNetworkCaptureObserveModeGate(null)).toEqual({
      action: 'proceed',
      reason: 'no_override',
    });
  });

  it('foreground override → proceed', () => {
    expect(evaluateNetworkCaptureObserveModeGate('foreground')).toEqual({
      action: 'proceed',
      reason: 'foreground_requested',
    });
  });

  it('background override → skip (passive listeners only)', () => {
    expect(evaluateNetworkCaptureObserveModeGate('background')).toEqual({
      action: 'skip',
      reason: 'background_passive',
    });
  });

  it('disabled override → skip (chooser advisory)', () => {
    expect(evaluateNetworkCaptureObserveModeGate('disabled')).toEqual({
      action: 'skip',
      reason: 'disabled_advisory',
    });
  });

  it('isNetworkCaptureObserveMode is closed-enum', () => {
    expect(isNetworkCaptureObserveMode('foreground')).toBe(true);
    expect(isNetworkCaptureObserveMode('background')).toBe(true);
    expect(isNetworkCaptureObserveMode('disabled')).toBe(true);
    expect(isNetworkCaptureObserveMode('')).toBe(false);
    expect(isNetworkCaptureObserveMode('FOREGROUND')).toBe(false);
    expect(isNetworkCaptureObserveMode(null)).toBe(false);
    expect(isNetworkCaptureObserveMode(undefined)).toBe(false);
    expect(isNetworkCaptureObserveMode(42)).toBe(false);
  });
});

describe('V27-10R2 — browser-context response summary sampler', () => {
  type WebRequestListener = (details: Record<string, unknown>) => void;

  let listeners: Record<string, WebRequestListener>;
  let runtimeMessageListener:
    | ((message: unknown, sender: { tab?: { id?: number } }) => boolean)
    | null;

  beforeEach(() => {
    listeners = {};
    runtimeMessageListener = null;
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue({
      id: 77,
      url: 'https://neutral-social.example.test/search?keyword=desk',
      title: 'Search',
    } as chrome.tabs.Tab);
    (
      chrome as typeof chrome & { scripting: { executeScript: ReturnType<typeof vi.fn> } }
    ).scripting = {
      executeScript: vi.fn().mockResolvedValue([{ result: { ok: true } }]),
    };
    const webRequest = chrome.webRequest as typeof chrome.webRequest & {
      onSendHeaders: {
        addListener: ReturnType<typeof vi.fn>;
        removeListener: ReturnType<typeof vi.fn>;
      };
      onHeadersReceived: {
        addListener: ReturnType<typeof vi.fn>;
        removeListener: ReturnType<typeof vi.fn>;
      };
    };
    webRequest.onBeforeRequest.addListener = vi.fn((listener: WebRequestListener) => {
      listeners.before = listener;
    });
    webRequest.onSendHeaders = {
      addListener: vi.fn((listener: WebRequestListener) => {
        listeners.sendHeaders = listener;
      }),
      removeListener: vi.fn(),
    };
    webRequest.onHeadersReceived = {
      addListener: vi.fn((listener: WebRequestListener) => {
        listeners.headers = listener;
      }),
      removeListener: vi.fn(),
    };
    webRequest.onCompleted.addListener = vi.fn((listener: WebRequestListener) => {
      listeners.completed = listener;
    });
    webRequest.onErrorOccurred.addListener = vi.fn((listener: WebRequestListener) => {
      listeners.error = listener;
    });
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(((
      listener: typeof runtimeMessageListener,
    ) => {
      runtimeMessageListener = listener;
    }) as never);
  });

  afterEach(async () => {
    (
      networkCaptureStartTool as unknown as {
        webRequestListenersInstalled: boolean;
        listeners: Record<string, unknown>;
      }
    ).webRequestListenersInstalled = false;
    (
      networkCaptureStartTool as unknown as {
        webRequestListenersInstalled: boolean;
        listeners: Record<string, unknown>;
      }
    ).listeners = {};
    (
      responseSummarySampler as unknown as {
        listenerInstalled: boolean;
        states: Map<number, unknown>;
      }
    ).listenerInstalled = false;
    (
      responseSummarySampler as unknown as {
        listenerInstalled: boolean;
        states: Map<number, unknown>;
      }
    ).states.clear();
    vi.restoreAllMocks();
    networkCaptureStartTool.captureData.clear();
  });

  it('start waits for sampler arm ack and stop returns compact safe summary without raw body', async () => {
    const start = await networkCaptureStartTool.execute({
      tabId: 77,
      maxCaptureTime: 0,
      inactivityTimeout: 0,
    });
    expect(start.isError).toBe(false);
    const startPayload = JSON.parse(String(start.content[0].text)) as {
      responseSummarySampler: { samplerId: string; samplerArmedAt: number };
      responseSummarySource: string;
      bridgePath: string;
      rawBodyPersisted: boolean;
    };
    expect(startPayload).toMatchObject({
      responseSummarySource: 'browser_context_summary',
      bridgePath: 'main_world_to_content_to_native',
      rawBodyPersisted: false,
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);

    const rawUrl = 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    listeners.before({
      tabId: 77,
      requestId: 'r1',
      url: rawUrl,
      method: 'GET',
      type: 'xmlhttprequest',
      timeStamp: startPayload.responseSummarySampler.samplerArmedAt + 5,
    });
    listeners.headers({
      tabId: 77,
      requestId: 'r1',
      statusCode: 200,
      statusLine: 'HTTP/2 200',
      timeStamp: startPayload.responseSummarySampler.samplerArmedAt + 20,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    });
    expect(runtimeMessageListener).not.toBeNull();
    runtimeMessageListener?.(
      {
        type: RESPONSE_SUMMARY_MESSAGE,
        samplerId: startPayload.responseSummarySampler.samplerId,
        summary: {
          responseSummarySource: 'browser_context_summary',
          bridgePath: 'main_world_to_content_to_native',
          capturedAfterArm: true,
          rawBodyPersisted: false,
          privacyCheck: 'passed',
          rejectedReason: null,
          method: 'GET',
          url: rawUrl,
          status: 200,
          contentType: 'application/json',
          rows: [{ title: 'desk result', score: 7 }],
          rowCount: 1,
          emptyResult: false,
          taskQueryValueMatched: true,
          samplerArmedAt: startPayload.responseSummarySampler.samplerArmedAt,
          capturedAt: startPayload.responseSummarySampler.samplerArmedAt + 30,
        },
      },
      { tab: { id: 77 } },
    );

    const stop = await networkCaptureStopTool.execute({ tabId: 77 });
    expect(stop.isError).toBe(false);
    const stopPayload = JSON.parse(String(stop.content[0].text)) as {
      requests: Array<{ url: string; responseBody?: string; safeResponseSummary?: unknown }>;
      responseSummaryLifecycle: { responseSummarySource: string; bridgePath: string };
    };
    const blob = JSON.stringify(stopPayload);

    expect(stopPayload.requests[0]).toMatchObject({
      url: 'https://api.neutral-social.example.test/v1/search/items?keyword=&page=',
      safeResponseSummary: {
        responseSummarySource: 'browser_context_summary',
        bridgePath: 'main_world_to_content_to_native',
        capturedAfterArm: true,
        rawBodyPersisted: false,
        rows: [{ title: 'desk result', score: 7 }],
      },
    });
    expect(stopPayload.responseSummaryLifecycle).toMatchObject({
      responseSummarySource: 'browser_context_summary',
      bridgePath: 'main_world_to_content_to_native',
    });
    expect(blob).not.toContain('responseBody');
    expect(blob).not.toContain('keyword=desk');
  });

  it('arm failure returns fallback evidence instead of success', async () => {
    (
      chrome as typeof chrome & { scripting: { executeScript: ReturnType<typeof vi.fn> } }
    ).scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access page'));

    const start = await networkCaptureStartTool.execute({
      tabId: 77,
      maxCaptureTime: 0,
      inactivityTimeout: 0,
    });
    const payload = JSON.parse(String(start.content[0].text));

    expect(start.isError).toBe(true);
    expect(payload).toMatchObject({
      success: false,
      fallbackCause: 'sampler_injection_failed',
      responseSummarySource: 'not_available',
      bridgePath: 'not_available',
      rawBodyPersisted: false,
    });
  });

  it('does not accept unproven empty summaries as successful empty results', async () => {
    const start = await networkCaptureStartTool.execute({
      tabId: 77,
      maxCaptureTime: 0,
      inactivityTimeout: 0,
    });
    const startPayload = JSON.parse(String(start.content[0].text)) as {
      responseSummarySampler: { samplerId: string; samplerArmedAt: number };
    };
    const rawUrl = 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    listeners.before({
      tabId: 77,
      requestId: 'r-empty',
      url: rawUrl,
      method: 'GET',
      type: 'xmlhttprequest',
      timeStamp: startPayload.responseSummarySampler.samplerArmedAt + 5,
    });
    listeners.headers({
      tabId: 77,
      requestId: 'r-empty',
      statusCode: 200,
      statusLine: 'HTTP/2 200',
      timeStamp: startPayload.responseSummarySampler.samplerArmedAt + 20,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    });

    runtimeMessageListener?.(
      {
        type: RESPONSE_SUMMARY_MESSAGE,
        samplerId: startPayload.responseSummarySampler.samplerId,
        summary: {
          responseSummarySource: 'browser_context_summary',
          bridgePath: 'main_world_to_content_to_native',
          capturedAfterArm: true,
          rawBodyPersisted: false,
          privacyCheck: 'passed',
          rejectedReason: null,
          method: 'GET',
          url: rawUrl,
          status: 200,
          contentType: 'application/json',
          rows: [],
          rowCount: 0,
          emptyResult: true,
          taskQueryValueMatched: true,
          samplerArmedAt: startPayload.responseSummarySampler.samplerArmedAt,
          capturedAt: startPayload.responseSummarySampler.samplerArmedAt + 30,
        },
      },
      { tab: { id: 77 } },
    );

    const stop = await networkCaptureStopTool.execute({ tabId: 77 });
    const stopPayload = JSON.parse(String(stop.content[0].text)) as {
      requests: Array<{
        safeResponseSummary?: {
          emptyResult?: boolean;
          rejectedReason?: string;
          fieldShapeSummaryAvailable?: boolean;
        };
      }>;
    };

    expect(stopPayload.requests[0]?.safeResponseSummary).toMatchObject({
      emptyResult: false,
      rejectedReason: 'compact_rows_unavailable',
      fieldShapeSummaryAvailable: false,
    });
  });
});
