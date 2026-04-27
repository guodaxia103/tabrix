/**
 * V27-01 — Tabrix v2.7 Lifecycle Observer (extension side) tests.
 *
 * Drives synthetic webNavigation/tabs events and asserts that the
 * observer:
 *   - emits brand-neutral `urlPattern` (host+path only, query/fragment stripped),
 *   - drops sub-frame events,
 *   - silently no-ops while the bridge connectionId is unset,
 *   - maps `transitionType` + `transitionQualifiers` to the closed-enum
 *     `NavigationIntent` (with `'unknown'` fallback per V27-00).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachLifecycleObserver,
  classifyNavigationIntent,
  toUrlPattern,
} from '@/entrypoints/background/observers/lifecycle';
import type { BridgeObservationMessage } from '@tabrix/shared';

interface ListenerStore {
  beforeNavigate: ((details: any) => void)[];
  committed: ((details: any) => void)[];
  domContentLoaded: ((details: any) => void)[];
  completed: ((details: any) => void)[];
  historyStateUpdated: ((details: any) => void)[];
  tabRemoved: ((tabId: number) => void)[];
}

function installWebNavigationStubs(): ListenerStore {
  const store: ListenerStore = {
    beforeNavigate: [],
    committed: [],
    domContentLoaded: [],
    completed: [],
    historyStateUpdated: [],
    tabRemoved: [],
  };
  const make = (bucket: ((details: any) => void)[]) => ({
    addListener: vi.fn((listener: (details: any) => void) => {
      bucket.push(listener);
    }),
    removeListener: vi.fn((listener: (details: any) => void) => {
      const idx = bucket.indexOf(listener);
      if (idx >= 0) bucket.splice(idx, 1);
    }),
  });
  (chrome as any).webNavigation = {
    onBeforeNavigate: make(store.beforeNavigate),
    onCommitted: make(store.committed),
    onDOMContentLoaded: make(store.domContentLoaded),
    onCompleted: make(store.completed),
    onHistoryStateUpdated: make(store.historyStateUpdated),
  };
  (chrome.tabs as any).onRemoved = make(store.tabRemoved as any);
  return store;
}

describe('toUrlPattern', () => {
  it('strips query and fragment, keeps host+path', () => {
    expect(toUrlPattern('https://example.com/foo/bar?x=1#z')).toBe('example.com/foo/bar');
  });
  it('returns null for unsupported schemes', () => {
    expect(toUrlPattern('chrome://extensions')).toBeNull();
    expect(toUrlPattern('about:blank')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(toUrlPattern(null)).toBeNull();
    expect(toUrlPattern(undefined)).toBeNull();
    expect(toUrlPattern('not a url')).toBeNull();
  });
});

describe('classifyNavigationIntent', () => {
  it('flags forward_back regardless of transitionType', () => {
    expect(classifyNavigationIntent('link', ['forward_back'])).toBe('forward_back');
  });
  it('detects reload', () => {
    expect(classifyNavigationIntent('reload', [])).toBe('reload');
  });
  it('detects redirects', () => {
    expect(classifyNavigationIntent('link', ['client_redirect'])).toBe('redirect');
    expect(classifyNavigationIntent('link', ['server_redirect'])).toBe('redirect');
  });
  it('classifies user-initiated transitions', () => {
    expect(classifyNavigationIntent('link', [])).toBe('user_initiated');
    expect(classifyNavigationIntent('typed', [])).toBe('user_initiated');
    expect(classifyNavigationIntent('form_submit', [])).toBe('user_initiated');
  });
  it('falls back to unknown for unrecognised types', () => {
    expect(classifyNavigationIntent('martian_subframe', [])).toBe('unknown');
    expect(classifyNavigationIntent(undefined, undefined)).toBe('unknown');
  });
});

describe('attachLifecycleObserver — synthetic event flow', () => {
  let store: ListenerStore;
  let sent: BridgeObservationMessage[];

  beforeEach(() => {
    store = installWebNavigationStubs();
    sent = [];
  });

  function attach(connectionId: string | null = 'conn-1') {
    return attachLifecycleObserver({
      send: (msg) => {
        sent.push(msg);
      },
      getConnectionId: () => connectionId,
      getExtensionId: () => 'ext-test',
    });
  }

  it('drops events when bridge connectionId is null', () => {
    attach(null);
    store.beforeNavigate[0]?.({ tabId: 1, frameId: 0, url: 'https://e.com/a' });
    expect(sent).toHaveLength(0);
  });

  it('ignores sub-frame events', () => {
    attach();
    store.beforeNavigate[0]?.({ tabId: 1, frameId: 99, url: 'https://e.com/iframe' });
    store.committed[0]?.({
      tabId: 1,
      frameId: 99,
      url: 'https://e.com/iframe',
      transitionType: 'link',
      transitionQualifiers: [],
    });
    expect(sent).toHaveLength(0);
  });

  it('emits a lifecycle_event observation for main-frame before_navigate', () => {
    attach();
    store.beforeNavigate[0]?.({ tabId: 7, frameId: 0, url: 'https://e.com/list?q=secret#hash' });
    expect(sent).toHaveLength(1);
    const msg = sent[0];
    expect(msg.type).toBe('observation');
    expect(msg.kind).toBe('lifecycle_event');
    expect(msg.connectionId).toBe('conn-1');
    expect(msg.extensionId).toBe('ext-test');
    if (msg.payload.kind !== 'lifecycle_event') throw new Error('expected lifecycle_event payload');
    const data = msg.payload.data;
    expect(data.eventKind).toBe('before_navigate');
    expect(data.tabId).toBe(7);
    expect(data.urlPattern).toBe('e.com/list');
    expect(data.navigationIntent).toBe('unknown');
    expect(typeof data.observedAtMs).toBe('number');
  });

  it('passes navigationIntent through on committed', () => {
    attach();
    store.committed[0]?.({
      tabId: 2,
      frameId: 0,
      url: 'https://e.com/page',
      transitionType: 'link',
      transitionQualifiers: ['forward_back'],
    });
    expect(sent).toHaveLength(1);
    const msg = sent[0];
    if (msg.payload.kind !== 'lifecycle_event') throw new Error('payload kind');
    expect(msg.payload.data.eventKind).toBe('committed');
    expect(msg.payload.data.navigationIntent).toBe('forward_back');
  });

  it('emits dom_content_loaded, document_complete and history_state_updated for main frame', () => {
    attach();
    store.domContentLoaded[0]?.({ tabId: 3, frameId: 0, url: 'https://e.com/x' });
    store.completed[0]?.({ tabId: 3, frameId: 0, url: 'https://e.com/x' });
    store.historyStateUpdated[0]?.({
      tabId: 3,
      frameId: 0,
      url: 'https://e.com/x/y',
      transitionType: 'link',
      transitionQualifiers: [],
    });
    const kinds = sent.map((msg) => {
      if (msg.payload.kind !== 'lifecycle_event') throw new Error('payload kind');
      return msg.payload.data.eventKind;
    });
    expect(kinds).toEqual(['dom_content_loaded', 'document_complete', 'history_state_updated']);
  });

  it('emits tab_removed for tab close (no urlPattern)', () => {
    attach();
    store.tabRemoved[0]?.(42);
    expect(sent).toHaveLength(1);
    const msg = sent[0];
    if (msg.payload.kind !== 'lifecycle_event') throw new Error('payload kind');
    expect(msg.payload.data.eventKind).toBe('tab_removed');
    expect(msg.payload.data.tabId).toBe(42);
    expect(msg.payload.data.urlPattern).toBeNull();
  });

  it('detach removes every listener', () => {
    const handle = attach();
    handle.detach();
    expect(store.beforeNavigate).toHaveLength(0);
    expect(store.committed).toHaveLength(0);
    expect(store.domContentLoaded).toHaveLength(0);
    expect(store.completed).toHaveLength(0);
    expect(store.historyStateUpdated).toHaveLength(0);
    expect(store.tabRemoved).toHaveLength(0);
  });

  it('does not throw when send() rejects asynchronously', async () => {
    const handle = attachLifecycleObserver({
      send: () => Promise.reject(new Error('bridge down')),
      getConnectionId: () => 'conn-1',
      getExtensionId: () => 'ext-test',
      warn: () => undefined,
    });
    expect(() =>
      store.beforeNavigate[0]?.({ tabId: 5, frameId: 0, url: 'https://e.com/' }),
    ).not.toThrow();
    handle.detach();
    // Allow microtask queue to drain so the rejection handler runs.
    await Promise.resolve();
  });
});
