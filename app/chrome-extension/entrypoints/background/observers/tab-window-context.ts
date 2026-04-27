/**
 * V27-05 — Tabrix v2.7 Tab/Window Context Observer (extension side).
 *
 * Wires `chrome.tabs.*` and `chrome.windows.*` events to the v2.7
 * native-server `ContextManager` via the additive `BridgeObservationMessage`
 * (`kind: 'tab_event'`) bridge member.
 *
 * Boundary:
 * - Passive. Never opens, closes, replaces, focuses tabs. Never reads
 *   page DOM. The native-server runtime decides what to do with each
 *   event; this observer only relays.
 * - Brand-neutral: no raw URLs leave this module. `urlPattern` is the
 *   path-only `host + pathname` form (mirrors `observers/lifecycle.ts`),
 *   and is `null` for events that do not carry a url
 *   (`tab_removed`, `window_focus_changed`).
 * - Best-effort `stable-target-ref-registry` revalidation on
 *   `bfcache_restored`: the producer reports a closed-enum verdict
 *   (`'live' | 'stale' | 'missing' | 'unknown'`) plus liveCount /
 *   staleCount derived from the registry snapshot. The runtime-side
 *   `v27-context-manager.ts` uses the verdict to decide whether to
 *   bump the page version under a `bfcache_restored` reason.
 *
 * Like `observers/lifecycle.ts`, this observer takes its `send` hook
 * via dependency injection so the dependency arrow stays one-directional
 * (`native-host` -> `observers/tab-window-context`) and unit tests can
 * drive a fake bridge.
 */

import type {
  BridgeObservationMessage,
  StableRefRevalidationResult,
  TabWindowContextEventEnvelope,
  TabWindowEventKind,
} from '@tabrix/shared';

import { toUrlPattern } from './lifecycle';

export interface TabWindowContextObserverContext {
  /**
   * Send the observation envelope to the native server. Implementations
   * normally return resolved/`undefined`; the observer never awaits
   * the result on the main path so a slow bridge never blocks the
   * `chrome.tabs.*` / `chrome.windows.*` handlers.
   */
  send: (message: BridgeObservationMessage) => void | Promise<void>;
  /** Producer connection id (mirrors hello/heartbeat). */
  getConnectionId: () => string | null;
  /** Producer extension id (mirrors hello/heartbeat). */
  getExtensionId: () => string;
  /**
   * Probe the stable-target-ref-registry for this tab and return a
   * verdict. Tests inject a fake; production wires this to the real
   * `getStableTargetRefRegistrySnapshot()`.
   */
  probeStableRefs?: (tabId: number) => StableRefRevalidationResult | null;
  /** Optional logger; defaults to a noop. */
  warn?: (message: string, error?: unknown) => void;
}

interface TabWindowContextObserverHandle {
  /**
   * Mark a tab as having just emerged from bfcache (i.e. the lifecycle
   * observer just received `webNavigation.onCommitted` with a
   * `forward_back` qualifier). The next call to this method emits a
   * `bfcache_restored` event with the registry verdict attached.
   */
  notifyBfcacheRestored(tabId: number, urlPattern: string | null): void;
  detach(): void;
}

/** V27-05 bfcache-revalidation helper. Reads the stable-target-ref-registry
 *  snapshot and converts it into a closed-enum verdict. The registry is
 *  pure in-memory: `entryCounts[tabId] > 0` means we *had* refs for this
 *  tab, but those refs are presumed `'stale'` after a bfcache restore
 *  (the content-script accessibility tree was torn down and rebuilt).
 *  `entryCounts[tabId] === 0` -> `'missing'` (nothing to invalidate).
 */
export function classifyStableRefRevalidation(
  liveCount: number,
  staleCount: number,
): StableRefRevalidationResult {
  const observedAtMs = Date.now();
  if (staleCount > 0) {
    return { outcome: 'stale', liveCount, staleCount, observedAtMs };
  }
  if (liveCount > 0) {
    return { outcome: 'live', liveCount, staleCount, observedAtMs };
  }
  return { outcome: 'missing', liveCount: 0, staleCount: 0, observedAtMs };
}

/**
 * Subscribe to the `chrome.tabs.*` and `chrome.windows.*` event surface
 * and forward each event as a `BridgeObservationMessage` of
 * `kind: 'tab_event'`. Returns a handle that detaches every listener
 * — safe for tests / SW restart.
 */
export function attachTabWindowContextObserver(
  context: TabWindowContextObserverContext,
): TabWindowContextObserverHandle {
  const warn = context.warn ?? (() => undefined);

  function emit(envelope: TabWindowContextEventEnvelope): void {
    const connectionId = context.getConnectionId();
    if (!connectionId) return;
    const message: BridgeObservationMessage = {
      type: 'observation',
      kind: 'tab_event',
      connectionId,
      extensionId: context.getExtensionId(),
      sentAt: Date.now(),
      payload: { kind: 'tab_event', data: envelope },
    };
    try {
      const result = context.send(message);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) =>
          warn('tab-window-context observer send failed', error),
        );
      }
    } catch (error) {
      warn('tab-window-context observer send threw', error);
    }
  }

  function envelope(
    eventKind: TabWindowEventKind,
    tabId: number,
    extras: Partial<TabWindowContextEventEnvelope> = {},
  ): TabWindowContextEventEnvelope {
    return {
      eventKind,
      tabId,
      observedAtMs: Date.now(),
      urlPattern: extras.urlPattern ?? null,
      newTabId: extras.newTabId ?? null,
      windowId: extras.windowId ?? null,
      stableRefRevalidation: extras.stableRefRevalidation ?? null,
    };
  }

  const onTabCreated = (tab: chrome.tabs.Tab): void => {
    if (typeof tab.id !== 'number' || tab.id < 0) return;
    emit(
      envelope('tab_created', tab.id, {
        urlPattern: toUrlPattern(tab.url ?? null),
        windowId: typeof tab.windowId === 'number' ? tab.windowId : null,
      }),
    );
  };

  const onTabRemoved = (tabId: number, info: chrome.tabs.TabRemoveInfo): void => {
    emit(
      envelope('tab_removed', tabId, {
        windowId: typeof info?.windowId === 'number' ? info.windowId : null,
      }),
    );
  };

  const onTabReplaced = (addedTabId: number, removedTabId: number): void => {
    emit(
      envelope('tab_replaced', removedTabId, {
        newTabId: addedTabId,
      }),
    );
  };

  const onWindowFocusChanged = (windowId: number): void => {
    // `chrome.windows.WINDOW_ID_NONE` is `-1`; the manager treats
    // `tabId: -1` as "focus left Chrome".
    emit(
      envelope('window_focus_changed', -1, {
        windowId,
      }),
    );
  };

  type AnyEventHook = {
    addListener: (listener: any) => void;
    removeListener: (listener: any) => void;
  };
  const bindings: Array<{ hook: AnyEventHook; listener: any }> = [];
  function tryBind(hook: AnyEventHook | undefined, listener: any, label: string): void {
    if (!hook || typeof hook.addListener !== 'function') {
      warn(`tab-window-context observer skipped binding (${label} unavailable)`);
      return;
    }
    try {
      hook.addListener(listener);
      bindings.push({ hook, listener });
    } catch (error) {
      warn(`tab-window-context observer addListener failed (${label})`, error);
    }
  }

  const tabs = (chrome as any)?.tabs as
    | {
        onCreated?: AnyEventHook;
        onRemoved?: AnyEventHook;
        onReplaced?: AnyEventHook;
      }
    | undefined;
  const windows = (chrome as any)?.windows as { onFocusChanged?: AnyEventHook } | undefined;

  tryBind(tabs?.onCreated, onTabCreated, 'tabs.onCreated');
  tryBind(tabs?.onRemoved, onTabRemoved, 'tabs.onRemoved');
  tryBind(tabs?.onReplaced, onTabReplaced, 'tabs.onReplaced');
  tryBind(windows?.onFocusChanged, onWindowFocusChanged, 'windows.onFocusChanged');

  return {
    notifyBfcacheRestored(tabId: number, urlPattern: string | null): void {
      let verdict: StableRefRevalidationResult | null = null;
      try {
        verdict = context.probeStableRefs?.(tabId) ?? null;
      } catch (error) {
        warn('tab-window-context observer probeStableRefs threw', error);
        verdict = { outcome: 'unknown', liveCount: 0, staleCount: 0, observedAtMs: Date.now() };
      }
      emit(
        envelope('bfcache_restored', tabId, {
          urlPattern,
          stableRefRevalidation: verdict ?? {
            outcome: 'unknown',
            liveCount: 0,
            staleCount: 0,
            observedAtMs: Date.now(),
          },
        }),
      );
    },
    detach(): void {
      for (const { hook, listener } of bindings) {
        try {
          hook.removeListener(listener);
        } catch (error) {
          warn('tab-window-context observer removeListener failed', error);
        }
      }
      bindings.length = 0;
    },
  };
}
