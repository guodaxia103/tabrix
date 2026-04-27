/**
 * V27-03 — proves the production click path arms the action-outcome
 * observer through the singleton seam and emits an
 * `action_outcome` envelope over the bridge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clickTool } from '@/entrypoints/background/tools/browser/interaction';
import {
  __resetActionOutcomeObserverHandleForTests,
  setActionOutcomeObserverHandle,
} from '@/entrypoints/background/observers/action-outcome-singleton';
import {
  attachActionOutcomeObserver,
  type ActionOutcomeObserverContext,
} from '@/entrypoints/background/observers/action-outcome';
import type { BridgeObservationMessage } from '@tabrix/shared';

describe('clickTool — V27-03 action-outcome arming', () => {
  let sent: BridgeObservationMessage[];
  let detach: () => void;

  beforeEach(() => {
    vi.restoreAllMocks();
    __resetActionOutcomeObserverHandleForTests();
    sent = [];
    // Neutralise the listener-binding seams the observer touches at
    // construction time. This mirrors the observer-test setup.
    const wn = (globalThis as any).chrome.webNavigation;
    wn.onCommitted.addListener = vi.fn();
    wn.onCommitted.removeListener = vi.fn();
    const tabs = (globalThis as any).chrome.tabs;
    tabs.onCreated.addListener = vi.fn();
    tabs.onCreated.removeListener = vi.fn();
    const wr = (globalThis as any).chrome.webRequest;
    wr.onCompleted.addListener = vi.fn();
    wr.onCompleted.removeListener = vi.fn();

    const context: ActionOutcomeObserverContext = {
      send: (msg) => {
        sent.push(msg);
      },
      getConnectionId: () => 'conn-test',
      getExtensionId: () => 'ext-test',
      now: () => Date.now(),
    };
    const handle = attachActionOutcomeObserver(context);
    detach = () => handle.detach();
    setActionOutcomeObserverHandle(handle);
  });

  afterEach(() => {
    try {
      detach?.();
    } catch {
      // noop
    }
    __resetActionOutcomeObserverHandleForTests();
  });

  it('arms the observer for chrome_click_element and emits an action_outcome envelope (real click-helper field names)', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 7,
      url: 'https://example.com/list?q=secret',
      windowId: 1,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    // Page-local helper reports a successful click with a real-shape signals
    // payload. The shape MUST match
    // app/chrome-extension/inject-scripts/click-helper.js (`domChanged` and
    // `domAddedDialog`); the previous `domRegionChanged`/`dialogOpened` keys
    // were a bridge-side fiction and would never be set in production.
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true, domAddedDialog: true },
    });
    vi.spyOn(clickTool as any, 'preflightDownloadIntercept').mockResolvedValue({
      interceptedDownload: false,
    });

    const result = await clickTool.execute({
      selector: '#go',
      tabId: 7,
    });
    expect(result.isError).toBe(false);

    // The observer auto-flushes after the default settle window (1.5s).
    // We rely on the fact that pushSignal() was recorded synchronously in
    // execute(), then wait a short real interval for the flush to fire.
    await new Promise((r) => setTimeout(r, 1700));

    expect(sent.length).toBeGreaterThanOrEqual(1);
    const msg = sent[0];
    expect(msg.type).toBe('observation');
    expect(msg.kind).toBe('action_outcome');
    if (msg.payload.kind !== 'action_outcome') throw new Error('payload kind');
    const env = msg.payload.data;
    expect(env.actionKind).toBe('click');
    expect(env.tabId).toBe(7);
    // Brand-neutral urlPattern: host + path only, query stripped.
    expect(env.urlPattern).toBe('example.com/list');
    const kinds = env.signals.map((s) => s.kind);
    expect(kinds).toContain('dom_region_changed');
    expect(kinds).toContain('dialog_opened');
  }, 10000);

  it('also accepts the alias field names (forward-compat regression guard)', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 8,
      url: 'https://example.com/page',
      windowId: 1,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      // Alias path: same boolean meaning, future-proofs against a rename.
      signals: { domRegionChanged: true, dialogOpened: true },
    });
    vi.spyOn(clickTool as any, 'preflightDownloadIntercept').mockResolvedValue({
      interceptedDownload: false,
    });

    const result = await clickTool.execute({
      selector: '#go',
      tabId: 8,
    });
    expect(result.isError).toBe(false);

    await new Promise((r) => setTimeout(r, 1700));

    expect(sent.length).toBeGreaterThanOrEqual(1);
    const msg = sent[0];
    if (msg.payload.kind !== 'action_outcome') throw new Error('payload kind');
    const kinds = msg.payload.data.signals.map((s) => s.kind);
    expect(kinds).toContain('dom_region_changed');
    expect(kinds).toContain('dialog_opened');
  }, 10000);
});
