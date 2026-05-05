/**
 * V27-03 — Tabrix v2.7 Action Outcome Observer (extension side).
 *
 * The native classifier in `app/native-server/src/runtime/action-outcome-classifier.ts`
 * is a pure function over a closed-enum signal timeline. This module is
 * the producer side: it opens a settle window after an action is
 * dispatched, races browser-side signals (`chrome.webNavigation.*`,
 * `chrome.tabs.*`, `chrome.webRequest.*`) into a signal bag scoped to
 * the action's tab, and forwards the final
 * `ActionOutcomeEventEnvelope` over the bridge as a
 * `BridgeObservationMessage` of `kind: 'action_outcome'`.
 *
 * Boundary:
 * - Passive observer. Never modifies tab state, never injects scripts,
 *   never reads page DOM. DOM-region and dialog signals must be pushed
 *   in via `pushSignal()` by an existing tool (e.g. click-verifier
 *   already reads a hash-rule readback after a click).
 * - Brand-neutral: every emitted signal carries closed-enum metadata
 *   only (host / pathPattern / regionTag / newTabId). Raw URLs, header
 *   values, and DOM strings never leave Chrome. The persistence-side
 *   V27-00 PrivacyGate is the belt-and-suspenders defence.
 * - Per-tab scoping: signals fire across the whole browser, but each
 *   in-flight observation only accepts signals matching its tabId.
 *   This avoids one tab's network noise polluting another tab's
 *   classification.
 *
 * Like `observers/lifecycle.ts` and `observers/network-fact.ts`, this
 * module receives a `send` callback and a `now()` clock so the
 * dependency arrow stays one-directional and unit tests can drive
 * synthetic events.
 */

import type {
  ActionKind,
  ActionOutcomeEventEnvelope,
  ActionSignal,
  ActionSignalKind,
  BridgeObservationMessage,
} from '@tabrix/shared';

const MAIN_FRAME_ID = 0;

/** Default settle window the producer honours when the caller does not
 *  pass one explicitly. Mirrors the runtime-side default in
 *  `action-outcome-classifier.ts` so the producer + classifier agree on the
 *  effective window length. */
export const ACTION_OUTCOME_OBSERVER_DEFAULT_SETTLE_MS = 1_500;

/** Hard cap on concurrent in-flight observations to avoid an unbounded
 *  Map in pathological test scenarios. The cap is generous; real
 *  callers should never come close. */
const ACTION_OUTCOME_INFLIGHT_CAP = 32;

export interface ActionOutcomeObserverContext {
  send: (message: BridgeObservationMessage) => void | Promise<void>;
  getConnectionId: () => string | null;
  getExtensionId: () => string;
  /** Optional clock for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Optional logger; defaults to a noop. */
  warn?: (message: string, error?: unknown) => void;
}

export interface ActionDescriptor {
  actionId: string;
  actionKind: ActionKind;
  tabId: number;
  urlPattern: string | null;
}

export interface ActionOutcomeHandle {
  /** Push a signal the observer cannot derive from background-only
   *  events (e.g. dom_region_changed from a content-script readback,
   *  dialog_opened from the existing dialog tool). */
  pushSignal(signal: Pick<ActionSignal, 'kind'> & Partial<ActionSignal>): void;
  /** Flush early. Idempotent — second call is a no-op. */
  flush(): void;
  /** Tear down the auto-flush timer without emitting anything. */
  dispose(): void;
}

export interface ActionOutcomeObserverHandle {
  observe(action: ActionDescriptor, options?: { settleWindowMs?: number }): ActionOutcomeHandle;
  detach(): void;
}

interface InFlightObservation {
  descriptor: ActionDescriptor;
  signals: ActionSignal[];
  startedAtMs: number;
  endsAtMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  flushed: boolean;
}

export function attachActionOutcomeObserver(
  context: ActionOutcomeObserverContext,
): ActionOutcomeObserverHandle {
  const warn = context.warn ?? (() => undefined);
  const now = context.now ?? (() => Date.now());

  /** Map of tabId -> in-flight observation. Per-tab scoping means at
   *  most one in-flight observation per tab; a second `observe()` on
   *  the same tab flushes the previous one first to avoid leaking
   *  signals across actions. */
  const inFlight = new Map<number, InFlightObservation>();

  function emit(record: InFlightObservation): void {
    if (record.flushed) return;
    record.flushed = true;
    if (record.timer !== null) {
      clearTimeout(record.timer);
      record.timer = null;
    }
    const connectionId = context.getConnectionId();
    if (!connectionId) return;
    const envelope: ActionOutcomeEventEnvelope = {
      actionId: record.descriptor.actionId,
      actionKind: record.descriptor.actionKind,
      tabId: record.descriptor.tabId,
      urlPattern: record.descriptor.urlPattern,
      observedAtMs: record.startedAtMs,
      signals: record.signals.slice(),
    };
    const message: BridgeObservationMessage = {
      type: 'observation',
      kind: 'action_outcome',
      connectionId,
      extensionId: context.getExtensionId(),
      sentAt: now(),
      payload: { kind: 'action_outcome', data: envelope },
    };
    try {
      const result = context.send(message);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) =>
          warn('action-outcome observer send failed', error),
        );
      }
    } catch (error) {
      warn('action-outcome observer send threw', error);
    }
  }

  function pushSignalRaw(tabId: number, signal: ActionSignal): void {
    const record = inFlight.get(tabId);
    if (!record || record.flushed) return;
    if (signal.observedAtMs < record.startedAtMs || signal.observedAtMs > record.endsAtMs) return;
    record.signals.push(signal);
  }

  function makeSignal(kind: ActionSignalKind, overrides: Partial<ActionSignal> = {}): ActionSignal {
    return {
      kind,
      observedAtMs: overrides.observedAtMs ?? now(),
      regionTag: overrides.regionTag ?? null,
      host: overrides.host ?? null,
      pathPattern: overrides.pathPattern ?? null,
      newTabId: overrides.newTabId ?? null,
    };
  }

  // ---------------------------------------------------------------
  // Background-derivable signals.
  // ---------------------------------------------------------------

  function onCommitted(details: chrome.webNavigation.WebNavigationTransitionCallbackDetails): void {
    if (details.frameId !== MAIN_FRAME_ID) return;
    if (typeof details.tabId !== 'number' || details.tabId < 0) return;
    pushSignalRaw(
      details.tabId,
      makeSignal('lifecycle_committed', {
        observedAtMs: details.timeStamp ?? now(),
      }),
    );
  }

  function onTabCreated(tab: chrome.tabs.Tab): void {
    if (typeof tab.openerTabId !== 'number' || tab.openerTabId < 0) return;
    pushSignalRaw(
      tab.openerTabId,
      makeSignal('tab_created', {
        observedAtMs: now(),
        newTabId: tab.id ?? null,
      }),
    );
  }

  function summariseHostAndPath(rawUrl: string): { host: string; pathPattern: string } | null {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return {
        host: parsed.hostname.toLowerCase(),
        pathPattern: parsed.pathname || '/',
      };
    } catch {
      return null;
    }
  }

  function onWebRequestCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
    if (typeof details.tabId !== 'number' || details.tabId < 0) return;
    // chrome.webRequest reports both `fetch()` and XHR under the
    // `xmlhttprequest` ResourceType. The string literal `'fetch'` is
    // declared in TS lib only as a guard for forward-compat; we keep
    // the cast to allow either (older Chrome) without breaking newer
    // type defs that exclude it.
    const t = details.type as string;
    if (t !== 'xmlhttprequest' && t !== 'fetch') return;
    const summary = summariseHostAndPath(details.url);
    if (!summary) return;
    pushSignalRaw(
      details.tabId,
      makeSignal('network_completed', {
        observedAtMs: details.timeStamp ?? now(),
        host: summary.host,
        pathPattern: summary.pathPattern,
      }),
    );
  }

  // Defensive event-bus binding (mirrors lifecycle/network-fact observers).
  type AnyEventHook = {
    addListener: (listener: any, ...args: any[]) => void;
    removeListener: (listener: any) => void;
  };
  const bindings: Array<{ hook: AnyEventHook; listener: any; useFilter?: boolean }> = [];

  function tryBind(
    hook: AnyEventHook | undefined,
    listener: any,
    label: string,
    filter?: object,
  ): void {
    if (!hook || typeof hook.addListener !== 'function') {
      warn(`action-outcome observer skipped binding (${label} hook unavailable)`);
      return;
    }
    try {
      if (filter) {
        hook.addListener(listener, filter);
      } else {
        hook.addListener(listener);
      }
      bindings.push({ hook, listener, useFilter: Boolean(filter) });
    } catch (error) {
      try {
        hook.addListener(listener);
        bindings.push({ hook, listener });
      } catch (innerError) {
        warn(`action-outcome observer addListener failed (${label})`, innerError ?? error);
      }
    }
  }

  const wn = (chrome as any)?.webNavigation as { onCommitted?: AnyEventHook } | undefined;
  const tabs = (chrome as any)?.tabs as { onCreated?: AnyEventHook } | undefined;
  const wr = (chrome as any)?.webRequest as { onCompleted?: AnyEventHook } | undefined;

  tryBind(wn?.onCommitted, onCommitted, 'webNavigation.onCommitted');
  tryBind(tabs?.onCreated, onTabCreated, 'tabs.onCreated');
  tryBind(wr?.onCompleted, onWebRequestCompleted, 'webRequest.onCompleted', {
    urls: ['<all_urls>'],
  });

  function startObservation(
    descriptor: ActionDescriptor,
    options?: { settleWindowMs?: number },
  ): ActionOutcomeHandle {
    const settleWindowMs = options?.settleWindowMs ?? ACTION_OUTCOME_OBSERVER_DEFAULT_SETTLE_MS;

    // If an observation is already in-flight for the same tab, flush
    // it first so its signals don't leak into the new observation.
    const existing = inFlight.get(descriptor.tabId);
    if (existing && !existing.flushed) {
      emit(existing);
      inFlight.delete(descriptor.tabId);
    }

    if (inFlight.size >= ACTION_OUTCOME_INFLIGHT_CAP) {
      // Evict the oldest record to keep the map bounded. The evicted
      // record is flushed best-effort so the operation log still gets
      // *something* for it.
      const oldestKey = inFlight.keys().next().value as number | undefined;
      if (oldestKey !== undefined) {
        const oldest = inFlight.get(oldestKey);
        if (oldest) emit(oldest);
        inFlight.delete(oldestKey);
      }
    }

    const startedAtMs = now();
    const endsAtMs = startedAtMs + Math.max(0, settleWindowMs);
    const record: InFlightObservation = {
      descriptor,
      signals: [],
      startedAtMs,
      endsAtMs,
      timer: null,
      flushed: false,
    };
    record.timer = setTimeout(
      () => {
        const live = inFlight.get(descriptor.tabId);
        if (live === record) {
          emit(record);
          inFlight.delete(descriptor.tabId);
        }
      },
      Math.max(0, settleWindowMs),
    );
    inFlight.set(descriptor.tabId, record);

    return {
      pushSignal(signal): void {
        if (record.flushed) return;
        const kind = signal.kind;
        const observedAtMs = signal.observedAtMs ?? now();
        if (observedAtMs < record.startedAtMs || observedAtMs > record.endsAtMs) return;
        record.signals.push({
          kind,
          observedAtMs,
          regionTag: signal.regionTag ?? null,
          host: signal.host ?? null,
          pathPattern: signal.pathPattern ?? null,
          newTabId: signal.newTabId ?? null,
        });
      },
      flush(): void {
        if (record.flushed) return;
        emit(record);
        if (inFlight.get(descriptor.tabId) === record) {
          inFlight.delete(descriptor.tabId);
        }
      },
      dispose(): void {
        if (record.timer !== null) {
          clearTimeout(record.timer);
          record.timer = null;
        }
        record.flushed = true;
        if (inFlight.get(descriptor.tabId) === record) {
          inFlight.delete(descriptor.tabId);
        }
      },
    };
  }

  return {
    observe: startObservation,
    detach(): void {
      for (const { hook, listener } of bindings) {
        try {
          hook.removeListener(listener);
        } catch (error) {
          warn('action-outcome observer removeListener failed', error);
        }
      }
      bindings.length = 0;
      for (const record of inFlight.values()) {
        if (record.timer !== null) clearTimeout(record.timer);
        record.flushed = true;
      }
      inFlight.clear();
    },
  };
}
