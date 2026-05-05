/**
 * V27-03 — extension-side tests for the Action Outcome Observer.
 *
 * The native classifier is unit-tested separately in
 * `app/native-server/src/runtime/action-outcome-classifier.test.ts`. These
 * tests exercise the producer:
 *
 *   - background-derivable signals (lifecycle/tab/network) are folded
 *     into the in-flight observation when they fire on the matching tab,
 *     ignored otherwise;
 *   - manual `pushSignal()` records dom_region_changed / dialog_opened;
 *   - the observer flushes on auto-timer, on explicit `flush()`, and
 *     evicts cleanly when a second observation starts on the same tab;
 *   - `getConnectionId()` returning null silently drops the emit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachActionOutcomeObserver,
  type ActionOutcomeObserverContext,
} from '@/entrypoints/background/observers/action-outcome';
import type { BridgeObservationMessage } from '@tabrix/shared';

interface ListenerStore {
  webNavOnCommitted: Array<(d: any) => void>;
  tabsOnCreated: Array<(t: any) => void>;
  webRequestOnCompleted: Array<(d: any) => void>;
}

function installChromeStubs(): ListenerStore {
  const store: ListenerStore = {
    webNavOnCommitted: [],
    tabsOnCreated: [],
    webRequestOnCompleted: [],
  };
  const wn = (globalThis as any).chrome.webNavigation;
  wn.onCommitted.addListener = vi.fn((cb: any) => store.webNavOnCommitted.push(cb));
  wn.onCommitted.removeListener = vi.fn((cb: any) => {
    store.webNavOnCommitted = store.webNavOnCommitted.filter((x) => x !== cb);
  });
  const tabs = (globalThis as any).chrome.tabs;
  tabs.onCreated.addListener = vi.fn((cb: any) => store.tabsOnCreated.push(cb));
  tabs.onCreated.removeListener = vi.fn((cb: any) => {
    store.tabsOnCreated = store.tabsOnCreated.filter((x) => x !== cb);
  });
  const wr = (globalThis as any).chrome.webRequest;
  wr.onCompleted.addListener = vi.fn((cb: any) => store.webRequestOnCompleted.push(cb));
  wr.onCompleted.removeListener = vi.fn((cb: any) => {
    store.webRequestOnCompleted = store.webRequestOnCompleted.filter((x) => x !== cb);
  });
  return store;
}

describe('attachActionOutcomeObserver — synthetic flow', () => {
  let store: ListenerStore;
  let sent: BridgeObservationMessage[];
  const fakeNow = vi.fn(() => 1_700_000_000_000);

  beforeEach(() => {
    store = installChromeStubs();
    sent = [];
    fakeNow.mockReset();
    fakeNow.mockReturnValue(1_700_000_000_000);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  function attach(
    connectionId: string | null = 'conn-1',
  ): ReturnType<typeof attachActionOutcomeObserver> {
    const context: ActionOutcomeObserverContext = {
      send: (message) => {
        sent.push(message);
      },
      getConnectionId: () => connectionId,
      getExtensionId: () => 'ext-1',
      now: () => Date.now(),
    };
    return attachActionOutcomeObserver(context);
  }

  it('drops emits while connectionId is null', () => {
    const observer = attach(null);
    const handle = observer.observe({
      actionId: 'act-1',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    handle.flush();
    expect(sent).toEqual([]);
    observer.detach();
  });

  it('emits an envelope on explicit flush() with no signals', () => {
    const observer = attach();
    const handle = observer.observe({
      actionId: 'act-2',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    handle.flush();
    expect(sent).toHaveLength(1);
    const env = sent[0]!;
    expect(env.kind).toBe('action_outcome');
    expect(env.payload.kind).toBe('action_outcome');
    if (env.payload.kind === 'action_outcome') {
      expect(env.payload.data.actionId).toBe('act-2');
      expect(env.payload.data.signals).toEqual([]);
    }
    observer.detach();
  });

  it('captures lifecycle_committed when navigation fires on the matching tab', () => {
    const observer = attach();
    const handle = observer.observe({
      actionId: 'act-3',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    vi.advanceTimersByTime(50);
    store.webNavOnCommitted.forEach((cb) =>
      cb({
        frameId: 0,
        tabId: 100,
        timeStamp: 1_700_000_000_050,
        url: 'http://example.test/next',
        transitionType: 'link',
        transitionQualifiers: [],
      }),
    );
    handle.flush();
    expect(sent).toHaveLength(1);
    if (sent[0]!.payload.kind === 'action_outcome') {
      const signals = sent[0]!.payload.data.signals;
      expect(signals.map((s) => s.kind)).toEqual(['lifecycle_committed']);
    }
    observer.detach();
  });

  it('ignores lifecycle events on a different tab', () => {
    const observer = attach();
    const handle = observer.observe({
      actionId: 'act-4',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    vi.advanceTimersByTime(50);
    store.webNavOnCommitted.forEach((cb) =>
      cb({
        frameId: 0,
        tabId: 999, // different tab
        timeStamp: 1_700_000_000_050,
        url: 'http://other.test/page',
        transitionType: 'link',
        transitionQualifiers: [],
      }),
    );
    handle.flush();
    if (sent[0]!.payload.kind === 'action_outcome') {
      expect(sent[0]!.payload.data.signals).toEqual([]);
    }
    observer.detach();
  });

  it('captures tab_created when a new tab is opened by the action tab', () => {
    const observer = attach();
    const handle = observer.observe({
      actionId: 'act-5',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    vi.advanceTimersByTime(80);
    store.tabsOnCreated.forEach((cb) => cb({ id: 200, openerTabId: 100 }));
    handle.flush();
    if (sent[0]!.payload.kind === 'action_outcome') {
      const signals = sent[0]!.payload.data.signals;
      expect(signals.map((s) => s.kind)).toEqual(['tab_created']);
      expect(signals[0]!.newTabId).toBe(200);
    }
    observer.detach();
  });

  it('captures network_completed signals scoped to the action tab', () => {
    const observer = attach();
    const handle = observer.observe({
      actionId: 'act-6',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    vi.advanceTimersByTime(80);
    store.webRequestOnCompleted.forEach((cb) =>
      cb({
        tabId: 100,
        type: 'xmlhttprequest',
        url: 'http://example.test/api/items?page=1',
        timeStamp: 1_700_000_000_080,
      }),
    );
    handle.flush();
    if (sent[0]!.payload.kind === 'action_outcome') {
      const signals = sent[0]!.payload.data.signals;
      expect(signals.map((s) => s.kind)).toEqual(['network_completed']);
      expect(signals[0]!.host).toBe('example.test');
      expect(signals[0]!.pathPattern).toBe('/api/items');
    }
    observer.detach();
  });

  it('records pushSignal() entries (dom_region_changed / dialog_opened)', () => {
    const observer = attach();
    const handle = observer.observe({
      actionId: 'act-7',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    handle.pushSignal({
      kind: 'dom_region_changed',
      observedAtMs: 1_700_000_000_100,
      regionTag: 'main_list',
    });
    handle.pushSignal({
      kind: 'dialog_opened',
      observedAtMs: 1_700_000_000_120,
    });
    handle.flush();
    if (sent[0]!.payload.kind === 'action_outcome') {
      const signals = sent[0]!.payload.data.signals;
      expect(signals.map((s) => s.kind)).toEqual(['dom_region_changed', 'dialog_opened']);
    }
    observer.detach();
  });

  it('drops signals dated before the action observedAtMs', () => {
    const observer = attach();
    const handle = observer.observe({
      actionId: 'act-8',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    handle.pushSignal({
      kind: 'dom_region_changed',
      observedAtMs: 1_699_999_999_000, // before start
      regionTag: 'main_list',
    });
    handle.flush();
    if (sent[0]!.payload.kind === 'action_outcome') {
      expect(sent[0]!.payload.data.signals).toEqual([]);
    }
    observer.detach();
  });

  it('auto-flushes after the settle window elapses', () => {
    const observer = attach();
    observer.observe(
      {
        actionId: 'act-9',
        actionKind: 'click',
        tabId: 100,
        urlPattern: 'example.test/list',
      },
      { settleWindowMs: 200 },
    );
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(199);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(sent).toHaveLength(1);
    if (sent[0]!.payload.kind === 'action_outcome') {
      expect(sent[0]!.payload.data.actionId).toBe('act-9');
    }
    observer.detach();
  });

  it('flush() is idempotent — second call is a no-op', () => {
    const observer = attach();
    const handle = observer.observe({
      actionId: 'act-10',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    handle.flush();
    handle.flush();
    expect(sent).toHaveLength(1);
    observer.detach();
  });

  it('starting a second observation on the same tab flushes the first', () => {
    const observer = attach();
    observer.observe({
      actionId: 'act-11',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    expect(sent).toHaveLength(0);
    const second = observer.observe({
      actionId: 'act-12',
      actionKind: 'click',
      tabId: 100,
      urlPattern: 'example.test/list',
    });
    expect(sent).toHaveLength(1); // first flushed
    if (sent[0]!.payload.kind === 'action_outcome') {
      expect(sent[0]!.payload.data.actionId).toBe('act-11');
    }
    second.flush();
    expect(sent).toHaveLength(2);
    if (sent[1]!.payload.kind === 'action_outcome') {
      expect(sent[1]!.payload.data.actionId).toBe('act-12');
    }
    observer.detach();
  });

  it('dispose() suppresses both auto-flush and explicit flush', () => {
    const observer = attach();
    const handle = observer.observe(
      {
        actionId: 'act-13',
        actionKind: 'click',
        tabId: 100,
        urlPattern: 'example.test/list',
      },
      { settleWindowMs: 200 },
    );
    handle.dispose();
    vi.advanceTimersByTime(500);
    handle.flush();
    expect(sent).toEqual([]);
    observer.detach();
  });

  it('detach() removes every chrome listener it installed', () => {
    const observer = attach();
    expect(store.webNavOnCommitted).toHaveLength(1);
    expect(store.tabsOnCreated).toHaveLength(1);
    expect(store.webRequestOnCompleted).toHaveLength(1);
    observer.detach();
    expect(store.webNavOnCommitted).toHaveLength(0);
    expect(store.tabsOnCreated).toHaveLength(0);
    expect(store.webRequestOnCompleted).toHaveLength(0);
  });
});
