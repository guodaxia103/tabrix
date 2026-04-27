/**
 * V27-05 — Tabrix v2.7 Tab/Window Context Observer (extension side) tests.
 *
 * Drives synthetic tabs/windows events and asserts that the observer:
 *   - emits brand-neutral envelopes for tab_created / tab_removed /
 *     tab_replaced / window_focus_changed,
 *   - silently no-ops while the bridge connectionId is unset,
 *   - on bfcache_restored emits a stable-target-ref-registry verdict
 *     (live / stale / missing / unknown) via the injected probe,
 *   - cleanly detaches every chrome.* listener on `detach()`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachTabWindowContextObserver,
  classifyStableRefRevalidation,
} from '@/entrypoints/background/observers/tab-window-context';
import type { BridgeObservationMessage } from '@tabrix/shared';

interface ListenerStore {
  tabCreated: ((tab: any) => void)[];
  tabRemoved: ((tabId: number, info: any) => void)[];
  tabReplaced: ((added: number, removed: number) => void)[];
  windowFocus: ((windowId: number) => void)[];
}

function installStubs(): ListenerStore {
  const store: ListenerStore = {
    tabCreated: [],
    tabRemoved: [],
    tabReplaced: [],
    windowFocus: [],
  };
  const make = (bucket: any[]) => ({
    addListener: vi.fn((listener: any) => {
      bucket.push(listener);
    }),
    removeListener: vi.fn((listener: any) => {
      const idx = bucket.indexOf(listener);
      if (idx >= 0) bucket.splice(idx, 1);
    }),
  });
  (chrome.tabs as any).onCreated = make(store.tabCreated);
  (chrome.tabs as any).onRemoved = make(store.tabRemoved);
  (chrome.tabs as any).onReplaced = make(store.tabReplaced);
  (chrome as any).windows = { onFocusChanged: make(store.windowFocus) };
  return store;
}

describe('classifyStableRefRevalidation', () => {
  it('maps positive staleCount to "stale"', () => {
    const result = classifyStableRefRevalidation(0, 3);
    expect(result.outcome).toBe('stale');
    expect(result.staleCount).toBe(3);
  });

  it('maps positive liveCount with no stale to "live"', () => {
    const result = classifyStableRefRevalidation(2, 0);
    expect(result.outcome).toBe('live');
    expect(result.liveCount).toBe(2);
  });

  it('maps zero/zero to "missing"', () => {
    const result = classifyStableRefRevalidation(0, 0);
    expect(result.outcome).toBe('missing');
  });
});

describe('attachTabWindowContextObserver', () => {
  let store: ListenerStore;
  let messages: BridgeObservationMessage[];
  let connectionId: string | null;

  beforeEach(() => {
    store = installStubs();
    messages = [];
    connectionId = 'conn-1';
  });

  function attach(probe?: (tabId: number) => any) {
    return attachTabWindowContextObserver({
      send: (message) => {
        messages.push(message);
      },
      getConnectionId: () => connectionId,
      getExtensionId: () => 'ext-1',
      probeStableRefs: probe,
    });
  }

  it('emits tab_created with brand-neutral urlPattern', () => {
    attach();
    store.tabCreated[0]!({
      id: 7,
      windowId: 1,
      url: 'https://example.com/foo?x=1#z',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('observation');
    expect(messages[0]!.kind).toBe('tab_event');
    const env = (messages[0]!.payload as any).data;
    expect(env.eventKind).toBe('tab_created');
    expect(env.tabId).toBe(7);
    expect(env.urlPattern).toBe('example.com/foo');
    expect(env.windowId).toBe(1);
  });

  it('skips tabs with no positive id (e.g. dev-tools tabs)', () => {
    attach();
    store.tabCreated[0]!({ id: -1, windowId: 1 });
    expect(messages).toHaveLength(0);
  });

  it('emits tab_removed', () => {
    attach();
    store.tabRemoved[0]!(7, { windowId: 1, isWindowClosing: false });
    expect(messages).toHaveLength(1);
    const env = (messages[0]!.payload as any).data;
    expect(env.eventKind).toBe('tab_removed');
    expect(env.tabId).toBe(7);
    expect(env.urlPattern).toBeNull();
  });

  it('emits tab_replaced with newTabId and the previous tabId', () => {
    attach();
    store.tabReplaced[0]!(11, 7);
    expect(messages).toHaveLength(1);
    const env = (messages[0]!.payload as any).data;
    expect(env.eventKind).toBe('tab_replaced');
    expect(env.tabId).toBe(7);
    expect(env.newTabId).toBe(11);
  });

  it('emits window_focus_changed with synthetic tabId=-1', () => {
    attach();
    store.windowFocus[0]!(2);
    expect(messages).toHaveLength(1);
    const env = (messages[0]!.payload as any).data;
    expect(env.eventKind).toBe('window_focus_changed');
    expect(env.tabId).toBe(-1);
    expect(env.windowId).toBe(2);
  });

  it('drops events while the bridge connectionId is unset', () => {
    connectionId = null;
    attach();
    store.tabCreated[0]!({ id: 7, windowId: 1 });
    store.tabRemoved[0]!(7, { windowId: 1, isWindowClosing: false });
    expect(messages).toHaveLength(0);
  });

  it('notifyBfcacheRestored emits with the probe verdict', () => {
    const probe = vi.fn((_tabId: number) => ({
      outcome: 'stale',
      liveCount: 0,
      staleCount: 4,
      observedAtMs: 999,
    }));
    const handle = attach(probe as any);
    handle.notifyBfcacheRestored(7, 'example.com/foo');
    expect(probe).toHaveBeenCalledWith(7);
    expect(messages).toHaveLength(1);
    const env = (messages[0]!.payload as any).data;
    expect(env.eventKind).toBe('bfcache_restored');
    expect(env.tabId).toBe(7);
    expect(env.urlPattern).toBe('example.com/foo');
    expect(env.stableRefRevalidation.outcome).toBe('stale');
    expect(env.stableRefRevalidation.staleCount).toBe(4);
  });

  it('notifyBfcacheRestored emits "unknown" verdict when probe throws', () => {
    const probe = vi.fn(() => {
      throw new Error('boom');
    });
    const handle = attach(probe as any);
    handle.notifyBfcacheRestored(7, null);
    expect(messages).toHaveLength(1);
    const env = (messages[0]!.payload as any).data;
    expect(env.stableRefRevalidation.outcome).toBe('unknown');
  });

  it('notifyBfcacheRestored emits "unknown" verdict when no probe is wired', () => {
    const handle = attach();
    handle.notifyBfcacheRestored(7, null);
    expect(messages).toHaveLength(1);
    const env = (messages[0]!.payload as any).data;
    expect(env.stableRefRevalidation.outcome).toBe('unknown');
  });

  it('detach() removes every bound listener', () => {
    const handle = attach();
    expect(store.tabCreated).toHaveLength(1);
    expect(store.tabRemoved).toHaveLength(1);
    expect(store.tabReplaced).toHaveLength(1);
    expect(store.windowFocus).toHaveLength(1);
    handle.detach();
    expect(store.tabCreated).toHaveLength(0);
    expect(store.tabRemoved).toHaveLength(0);
    expect(store.tabReplaced).toHaveLength(0);
    expect(store.windowFocus).toHaveLength(0);
  });
});
