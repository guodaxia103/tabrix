/**
 * V27-01 — Tabrix v2.7 Lifecycle Observer (extension side).
 *
 * Wires `chrome.webNavigation.*` and `chrome.tabs.*` events to the v2.7
 * native-server lifecycle state machine via the additive
 * `BridgeObservationMessage` (`kind: 'lifecycle_event'`) bridge member.
 *
 * Boundary:
 * - Passive observer. Never modifies tab state, never injects scripts,
 *   never reads page DOM.
 * - Brand-neutral: every `LifecycleEventPayload.urlPattern` is the
 *   path-only, query-stripped form (no host, no query, no fragment).
 *   Raw URLs and tab/frame ids are filtered out at the observer
 *   boundary; the V27-00 PrivacyGate is the persistence-side belt
 *   alongside this suspenders.
 * - Main-frame only. Sub-frame navigations are ignored to keep the
 *   observer overhead inside the V27-00 budget
 *   (`OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT`).
 *
 * The observer does NOT import native-host directly — `attachLifecycleObserver`
 * receives a `send` callback so the dependency arrow stays
 * one-directional (`native-host` -> `observers/lifecycle`), and so
 * unit tests can drive a fake send.
 */

import type {
  BridgeObservationMessage,
  LifecycleEventKind,
  LifecycleEventPayload,
  NavigationIntent,
} from '@tabrix/shared';

export interface LifecycleObserverContext {
  /**
   * Send the observation envelope to the native server. Implementations
   * normally return resolved/`undefined`; the observer never awaits the
   * result on the main path so a slow bridge never blocks
   * `chrome.webNavigation.*` handlers.
   */
  send: (message: BridgeObservationMessage) => void | Promise<void>;
  /** Producer connection id (mirrors hello/heartbeat). */
  getConnectionId: () => string | null;
  /** Producer extension id (mirrors hello/heartbeat). */
  getExtensionId: () => string;
  /** Optional logger; defaults to a noop. */
  warn?: (message: string, error?: unknown) => void;
  /**
   * V27-05 hook — invoked on a main-frame `committed` event whose
   * `navigationIntent` resolves to `'forward_back'`. The native-host
   * wires this to the tab-window-context observer's
   * `notifyBfcacheRestored(tabId, urlPattern)` so a bfcache restore
   * gets a `tab_event:bfcache_restored` envelope on the bridge with
   * the stable-target-ref-registry verdict attached.
   *
   * Best-effort: any throw is caught by the observer; failures here
   * must not block the lifecycle handler chain.
   */
  onForwardBackCommitted?: (tabId: number, urlPattern: string | null) => void;
}

interface LifecycleObserverHandle {
  detach(): void;
}

const MAIN_FRAME_ID = 0;

/**
 * Convert a raw URL into the brand-neutral path-only urlPattern the
 * v2.7 contract allows on the wire. Returns `null` for any URL that
 * cannot be parsed (e.g. `chrome://`, `about:blank`, malformed input).
 */
export function toUrlPattern(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname;
    const path = parsed.pathname;
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/**
 * Closed-enum mapping of `chrome.webNavigation` `transitionType` +
 * `transitionQualifiers` to the v2.7 `NavigationIntent` enum. Returns
 * `'unknown'` for unrecognised inputs (V27-00 invariant).
 */
export function classifyNavigationIntent(
  transitionType: string | undefined,
  transitionQualifiers: ReadonlyArray<string> | undefined,
): NavigationIntent {
  const qualifiers = transitionQualifiers ?? [];
  if (qualifiers.includes('forward_back')) return 'forward_back';
  if (transitionType === 'reload') return 'reload';
  if (qualifiers.includes('client_redirect') || qualifiers.includes('server_redirect')) {
    return 'redirect';
  }
  switch (transitionType) {
    case 'link':
    case 'typed':
    case 'form_submit':
    case 'keyword':
    case 'keyword_generated':
    case 'generated':
      return 'user_initiated';
    case 'auto_bookmark':
    case 'auto_toplevel':
    case 'start_page':
      return 'auto';
    default:
      return 'unknown';
  }
}

/**
 * Subscribe to the `chrome.webNavigation.*` and `chrome.tabs.*` event
 * surface and forward each main-frame transition as a
 * `BridgeObservationMessage` of `kind: 'lifecycle_event'`. Returns a
 * handle that detaches every listener — safe for tests / SW restart.
 */
export function attachLifecycleObserver(
  context: LifecycleObserverContext,
): LifecycleObserverHandle {
  const warn = context.warn ?? (() => undefined);

  function emit(
    eventKind: LifecycleEventKind,
    tabId: number,
    urlPattern: string | null,
    intent?: NavigationIntent,
  ): void {
    const connectionId = context.getConnectionId();
    if (!connectionId) return;
    const payload: LifecycleEventPayload = {
      eventKind,
      tabId,
      urlPattern,
      navigationIntent: intent ?? 'unknown',
      observedAtMs: Date.now(),
    };
    const message: BridgeObservationMessage = {
      type: 'observation',
      kind: 'lifecycle_event',
      connectionId,
      extensionId: context.getExtensionId(),
      sentAt: Date.now(),
      payload: { kind: 'lifecycle_event', data: payload },
    };
    try {
      const result = context.send(message);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => warn('lifecycle observer send failed', error));
      }
    } catch (error) {
      warn('lifecycle observer send threw', error);
    }
  }

  const onBeforeNavigate = (
    details: chrome.webNavigation.WebNavigationParentedCallbackDetails,
  ): void => {
    if (details.frameId !== MAIN_FRAME_ID) return;
    emit('before_navigate', details.tabId, toUrlPattern(details.url));
  };

  const onCommitted = (
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
  ): void => {
    if (details.frameId !== MAIN_FRAME_ID) return;
    const intent = classifyNavigationIntent(details.transitionType, details.transitionQualifiers);
    const urlPattern = toUrlPattern(details.url);
    emit('committed', details.tabId, urlPattern, intent);
    if (intent === 'forward_back' && context.onForwardBackCommitted) {
      try {
        context.onForwardBackCommitted(details.tabId, urlPattern);
      } catch (error) {
        warn('lifecycle observer onForwardBackCommitted threw', error);
      }
    }
  };

  const onDomContentLoaded = (
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
  ): void => {
    if (details.frameId !== MAIN_FRAME_ID) return;
    emit('dom_content_loaded', details.tabId, toUrlPattern(details.url));
  };

  const onCompleted = (details: chrome.webNavigation.WebNavigationFramedCallbackDetails): void => {
    if (details.frameId !== MAIN_FRAME_ID) return;
    emit('document_complete', details.tabId, toUrlPattern(details.url));
  };

  const onHistoryStateUpdated = (
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
  ): void => {
    if (details.frameId !== MAIN_FRAME_ID) return;
    emit('history_state_updated', details.tabId, toUrlPattern(details.url));
  };

  const onTabRemoved = (tabId: number): void => {
    emit('tab_removed', tabId, null);
  };

  // Defensive event-bus binding. If a particular event hook is missing
  // (e.g. older Chrome, a test harness that stubs only the runtime
  // surface, a future SW restart partial-API window), we silently skip
  // that hook rather than crashing the background worker. The observer
  // is best-effort by design — V27-05 ContextManager still works on the
  // events it does receive.
  type AnyEventHook = {
    addListener: (listener: any) => void;
    removeListener: (listener: any) => void;
  };
  const bindings: Array<{ hook: AnyEventHook; listener: any }> = [];
  function tryBind(hook: AnyEventHook | undefined, listener: any, label: string): void {
    if (!hook || typeof hook.addListener !== 'function') {
      warn(`lifecycle observer skipped binding (${label} hook unavailable)`);
      return;
    }
    try {
      hook.addListener(listener);
      bindings.push({ hook, listener });
    } catch (error) {
      warn(`lifecycle observer addListener failed (${label})`, error);
    }
  }

  const wn = (chrome as any)?.webNavigation as
    | {
        onBeforeNavigate?: AnyEventHook;
        onCommitted?: AnyEventHook;
        onDOMContentLoaded?: AnyEventHook;
        onCompleted?: AnyEventHook;
        onHistoryStateUpdated?: AnyEventHook;
      }
    | undefined;
  const tabs = (chrome as any)?.tabs as { onRemoved?: AnyEventHook } | undefined;

  tryBind(wn?.onBeforeNavigate, onBeforeNavigate, 'webNavigation.onBeforeNavigate');
  tryBind(wn?.onCommitted, onCommitted, 'webNavigation.onCommitted');
  tryBind(wn?.onDOMContentLoaded, onDomContentLoaded, 'webNavigation.onDOMContentLoaded');
  tryBind(wn?.onCompleted, onCompleted, 'webNavigation.onCompleted');
  tryBind(wn?.onHistoryStateUpdated, onHistoryStateUpdated, 'webNavigation.onHistoryStateUpdated');
  tryBind(tabs?.onRemoved, onTabRemoved, 'tabs.onRemoved');

  return {
    detach(): void {
      for (const { hook, listener } of bindings) {
        try {
          hook.removeListener(listener);
        } catch (error) {
          warn('lifecycle observer removeListener failed', error);
        }
      }
      bindings.length = 0;
    },
  };
}
