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

  it('arms the observer for chrome_click_element and emits an action_outcome envelope', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 7,
      url: 'https://example.com/list?q=secret',
      windowId: 1,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    // Page-local helper reports a successful click with a DOM region change.
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domRegionChanged: true },
    });
    // Defang the download preflight script-injection.
    vi.spyOn(clickTool as any, 'preflightDownloadIntercept').mockResolvedValue({
      interceptedDownload: false,
    });

    const result = await clickTool.execute({
      selector: '#go',
      tabId: 7,
    });
    expect(result.isError).toBe(false);

    // Force the observer to flush by yielding the auto-flush timer
    // forward. The default settle window is 1.5s; vi.advanceTimersByTime
    // would be cleaner but we are not in fake-timer mode here, so wait
    // a real but short interval and then explicitly fall back to a
    // direct flush via the singleton handle when test infra demands
    // determinism. We rely on the fact that `pushSignal` was already
    // recorded synchronously inside `execute()`; the envelope is emitted
    // when the auto-flush timer fires. To keep the test deterministic,
    // wait until the bridge has seen something.
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
    expect(env.signals.map((s) => s.kind)).toContain('dom_region_changed');
  }, 10000);
});
