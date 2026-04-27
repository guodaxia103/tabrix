/**
 * V27-02 — Tabrix v2.7 Network Fact Observer (extension side).
 *
 * Wires `chrome.webRequest.*` to a passive emitter that summarises each
 * completed XHR/fetch request into a brand-neutral `NetworkRequestFact`
 * and forwards it as a `BridgeObservationMessage` of
 * `kind: 'fact_snapshot'` (envelope eventKind `'network_request'`).
 *
 * Boundary:
 * - Passive observer. Never installs body / header capture, never
 *   blocks a request, never reads request bodies. The runtime MAY
 *   pivot to `chrome.debugger`-based body capture later (V27-06+ /
 *   on-demand capture tool); this observer stays passive.
 * - Brand-neutral: every emitted fact is a closed-enum bucket plus
 *   host + path-only `urlPattern`. Query string values, headers, and
 *   bodies never leave Chrome.
 * - XHR / fetch only: main_frame / sub_frame / image / stylesheet
 *   navigations are dropped at the boundary so the observer overhead
 *   stays inside the V27-00 budget
 *   (`OBSERVER_OVERHEAD_BUDGET_MS_PER_EVENT`).
 *
 * Like `observers/lifecycle.ts`, this module receives a `send`
 * callback rather than importing the native-host directly, so the
 * dependency arrow stays one-directional and unit tests can drive a
 * fake send.
 */

import type {
  BridgeObservationMessage,
  BrowserFactSnapshotEnvelope,
  NetworkFactMethod,
  NetworkFactNoiseClass,
  NetworkRequestFact,
} from '@tabrix/shared';

export interface NetworkFactObserverContext {
  send: (message: BridgeObservationMessage) => void | Promise<void>;
  getConnectionId: () => string | null;
  getExtensionId: () => string;
  /** Optional override for the per-tab session id stamped into each
   *  envelope; defaults to a `null` session id (consumer may correlate
   *  by `tabId`). */
  getSessionId?: (tabId: number) => string | null;
  /** Optional override for the producer-side fact snapshot id;
   *  defaults to a deterministic per-tab id. */
  getFactSnapshotId?: (tabId: number) => string;
  /** Optional logger; defaults to a noop. */
  warn?: (message: string, error?: unknown) => void;
}

interface NetworkFactObserverHandle {
  detach(): void;
}

/** Keep the in-flight start-time map bounded so a runaway tab cannot
 *  inflate the worker's heap. The cap is generous for normal pages. */
const REQUEST_START_CAP = 256;

/** Closed allowlist of `chrome.webRequest.ResourceType` values the
 *  observer cares about. Asset / navigation types are filtered before
 *  emitting any fact. */
const OBSERVED_RESOURCE_TYPES: ReadonlySet<string> = new Set(['xmlhttprequest', 'fetch']);

/**
 * Lightweight, brand-neutral noise classifier for fact-snapshot
 * bucketing. Intentionally narrower than the foreground
 * `classifyNetworkCaptureEndpoint` capture tool: it does not depend on
 * the global ad/analytics list (which would pull in the full
 * `network-capture-web-request` module and its module-init listeners).
 * The fact collector only needs to know whether a request is plausibly
 * data (`'usable'`), an auth handshake, or something it should keep
 * but treat as `'unknown'`. Persistence-side redaction (PrivacyGate)
 * remains the belt-and-suspenders defence.
 */
function classifyNoise(input: {
  url: string;
  method: string | undefined;
  type: string | undefined;
}): NetworkFactNoiseClass {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return 'unknown';
  }
  const path = parsed.pathname.toLowerCase();
  const method = (input.method ?? 'GET').toUpperCase();
  const type = (input.type ?? '').toLowerCase();
  if (path.includes('/_private/') || path.includes('/private/')) return 'private';
  if (/\b(login|logout|session|oauth|token|authorize|auth)\b/.test(path)) return 'auth';
  if (/\b(stats|telemetry|metrics|collect|beacon|events?)\b/.test(path)) return 'telemetry';
  if ((method === 'GET' || method === 'HEAD') && (type === 'xmlhttprequest' || type === 'fetch')) {
    return 'usable';
  }
  return 'unknown';
}

/** Closed-enum mapping of HTTP method strings to `NetworkFactMethod`. */
function classifyMethod(raw: string | undefined): NetworkFactMethod {
  const m = (raw ?? '').toUpperCase();
  switch (m) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return m;
    case '':
      return 'unknown';
    default:
      return 'OTHER';
  }
}

/**
 * Convert a raw URL into the fact-collector's brand-neutral form:
 * lower-cased host, path without query/fragment, sorted unique
 * `queryKeys`. Returns `null` for non-http(s) URLs.
 */
export function summariseUrl(rawUrl: string | null | undefined): {
  host: string;
  pathPattern: string;
  queryKeys: string[];
  urlPattern: string;
} | null {
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  const pathPattern = parsed.pathname || '/';
  const queryKeys = Array.from(new Set(Array.from(parsed.searchParams.keys()))).sort();
  return {
    host,
    pathPattern,
    queryKeys,
    urlPattern: `${host}${pathPattern}`,
  };
}

/**
 * Subscribe to `chrome.webRequest.{onBeforeRequest,onCompleted,onErrorOccurred}`
 * and forward each completed XHR/fetch as a fact-snapshot bridge
 * message. Returns a handle that detaches every listener.
 */
export function attachNetworkFactObserver(
  context: NetworkFactObserverContext,
): NetworkFactObserverHandle {
  const warn = context.warn ?? (() => undefined);
  const requestStarts = new Map<string, number>();

  function rememberStart(requestId: string, startMs: number): void {
    if (requestStarts.has(requestId)) requestStarts.delete(requestId);
    requestStarts.set(requestId, startMs);
    while (requestStarts.size > REQUEST_START_CAP) {
      const oldest = requestStarts.keys().next().value;
      if (oldest === undefined) break;
      requestStarts.delete(oldest);
    }
  }

  function takeStart(requestId: string): number | null {
    const start = requestStarts.get(requestId);
    if (start === undefined) return null;
    requestStarts.delete(requestId);
    return start;
  }

  function emit(fact: NetworkRequestFact, tabId: number, urlPattern: string): void {
    const connectionId = context.getConnectionId();
    if (!connectionId) return;
    const sessionId = context.getSessionId ? context.getSessionId(tabId) : null;
    const factSnapshotId = context.getFactSnapshotId
      ? context.getFactSnapshotId(tabId)
      : `tab:${tabId}`;
    const envelope: BrowserFactSnapshotEnvelope = {
      factSnapshotId,
      observedAtMs: fact.observedAtMs,
      payload: {
        eventKind: 'network_request',
        fact,
        tabId,
        urlPattern,
        sessionId,
      },
    };
    const message: BridgeObservationMessage = {
      type: 'observation',
      kind: 'fact_snapshot',
      connectionId,
      extensionId: context.getExtensionId(),
      sentAt: Date.now(),
      payload: { kind: 'fact_snapshot', data: envelope },
    };
    try {
      const result = context.send(message);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) =>
          warn('network-fact observer send failed', error),
        );
      }
    } catch (error) {
      warn('network-fact observer send threw', error);
    }
  }

  function onBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails): void {
    if (!OBSERVED_RESOURCE_TYPES.has(details.type)) return;
    rememberStart(details.requestId, details.timeStamp);
  }

  function onCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
    if (!OBSERVED_RESOURCE_TYPES.has(details.type)) return;
    if (typeof details.tabId !== 'number' || details.tabId < 0) return;
    const summary = summariseUrl(details.url);
    if (!summary) return;
    const start = takeStart(details.requestId);
    const timingMs = start !== null ? Math.max(0, Math.round(details.timeStamp - start)) : null;
    const noiseClass = classifyNoise({
      url: details.url,
      method: details.method,
      type: details.type,
    });
    const fact: NetworkRequestFact = {
      method: classifyMethod(details.method),
      host: summary.host,
      pathPattern: summary.pathPattern,
      queryKeys: summary.queryKeys,
      status: typeof details.statusCode === 'number' ? details.statusCode : null,
      resourceType: details.type,
      contentType: null,
      sizeClass: 'unknown',
      timingMs,
      noiseClass,
      observedAtMs: Math.round(details.timeStamp),
    };
    emit(fact, details.tabId, summary.urlPattern);
  }

  function onErrorOccurred(details: chrome.webRequest.WebResponseErrorDetails): void {
    if (!OBSERVED_RESOURCE_TYPES.has(details.type)) return;
    if (typeof details.tabId !== 'number' || details.tabId < 0) return;
    takeStart(details.requestId);
  }

  type AnyEventHook = {
    addListener: (listener: any, ...args: any[]) => void;
    removeListener: (listener: any) => void;
  };
  const bindings: Array<{ hook: AnyEventHook; listener: any }> = [];

  function tryBind(hook: AnyEventHook | undefined, listener: any, label: string): void {
    if (!hook || typeof hook.addListener !== 'function') {
      warn(`network-fact observer skipped binding (${label} hook unavailable)`);
      return;
    }
    try {
      hook.addListener(listener, { urls: ['<all_urls>'] });
      bindings.push({ hook, listener });
    } catch (error) {
      try {
        hook.addListener(listener);
        bindings.push({ hook, listener });
      } catch (innerError) {
        warn(`network-fact observer addListener failed (${label})`, innerError ?? error);
      }
    }
  }

  const wr = (chrome as any)?.webRequest as
    | {
        onBeforeRequest?: AnyEventHook;
        onCompleted?: AnyEventHook;
        onErrorOccurred?: AnyEventHook;
      }
    | undefined;

  tryBind(wr?.onBeforeRequest, onBeforeRequest, 'webRequest.onBeforeRequest');
  tryBind(wr?.onCompleted, onCompleted, 'webRequest.onCompleted');
  tryBind(wr?.onErrorOccurred, onErrorOccurred, 'webRequest.onErrorOccurred');

  return {
    detach(): void {
      for (const { hook, listener } of bindings) {
        try {
          hook.removeListener(listener);
        } catch (error) {
          warn('network-fact observer removeListener failed', error);
        }
      }
      bindings.length = 0;
      requestStarts.clear();
    },
  };
}
