/**
 * Browser Fact Collector (in-memory).
 *
 * Goal:
 * - In-memory ring of `BrowserFactSnapshot` produced by the extension
 *   observers (`network-fact.ts`, `dom-fact.ts`, `readiness.ts`). The
 *   runtime queries snapshots by `factSnapshotId` from V27-04 readiness
 *   profiler and V27-05 context manager.
 *
 * What this module is:
 * - A pure module with one process-wide singleton. No I/O, no SQLite,
 *   no operation-log writes. Snapshots live for `ttlMs` (default 30s)
 *   then get pruned. The capacity is bounded so a runaway producer
 *   cannot starve the runtime; LRU eviction kicks in once the cap is
 *   reached.
 * - Privacy boundary: the collector keeps `tabId` / `sessionId` in
 *   memory because the Router/ContextManager need them for routing.
 *   Persistence-side redaction is the responsibility of downstream
 *   writers (operation log, future Experience): they MUST funnel the
 *   snapshot through `redactFactSnapshotForPersistence` before any
 *   disk write. Producer-side observers MUST NOT include cookies,
 *   authorization headers, raw URLs, raw bodies, or value-shaped
 *   scalars — that contract is enforced by the V27-00 privacy-gate
 *   golden tests covering this module's persistence helper.
 *
 * What this module is NOT:
 * - It does not own the bridge socket. The producer (the native-server
 *   `bridge-command-channel` future hook) calls `ingestFactObservation`
 *   with a parsed envelope; this module never sees a raw WebSocket
 *   message.
 * - It does not run any policy. "Should we trust this snapshot for
 *   read-page avoidance?" is the Router's job. The collector only
 *   answers "is this id known and fresh, and what facts have we got?"
 */

import type {
  BrowserFactSnapshot,
  BrowserFactSnapshotEnvelope,
  DomRegionFingerprint,
  FactObservationPayload,
  NetworkRequestFact,
  ReadinessSignals,
} from '@tabrix/shared';
import { redactForPersistence } from './privacy-gate';

/** Default per-snapshot freshness window. */
export const FACT_SNAPSHOT_DEFAULT_TTL_MS = 30_000;
/** Default ring capacity. Producers stamp short-lived ids (one per task
 *  or one per tab session) so 256 slots is plenty in practice. */
export const FACT_SNAPSHOT_RING_CAPACITY = 256;
/** Cap on per-snapshot network facts so a chatty page cannot inflate
 *  the heap. The latest N are kept. */
export const FACT_SNAPSHOT_NETWORK_FACT_CAP = 64;

const DEFAULT_READINESS: ReadinessSignals = Object.freeze({
  documentComplete: 'unknown',
  routeStable: 'unknown',
  keyRegionReady: 'unknown',
  networkQuiet: 'unknown',
  observedAtMs: 0,
});

/** Closed-enum result of `getFactSnapshot`. */
export type FactSnapshotLookupVerdict = 'fresh' | 'stale' | 'missing';

export interface FactSnapshotLookupResult {
  verdict: FactSnapshotLookupVerdict;
  snapshot: BrowserFactSnapshot | null;
}

export interface FactCollector {
  ingestFactObservation(envelope: BrowserFactSnapshotEnvelope, nowMs?: number): BrowserFactSnapshot;
  getFactSnapshot(id: string, nowMs?: number): FactSnapshotLookupResult;
  prune(nowMs?: number): number;
  reset(): void;
  /** Test-only diagnostic: how many live snapshots are tracked. */
  size(): number;
}

interface CollectorOptions {
  capacity?: number;
  defaultTtlMs?: number;
  networkFactCap?: number;
  /** Test seam — defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Build a fresh fact collector. Most callers want
 * `getDefaultFactCollector()`; the constructor exists so V27-04 / V27-05
 * unit tests can spin up an isolated collector with a frozen clock.
 */
export function createFactCollector(options: CollectorOptions = {}): FactCollector {
  const capacity = options.capacity ?? FACT_SNAPSHOT_RING_CAPACITY;
  const defaultTtlMs = options.defaultTtlMs ?? FACT_SNAPSHOT_DEFAULT_TTL_MS;
  const networkFactCap = options.networkFactCap ?? FACT_SNAPSHOT_NETWORK_FACT_CAP;
  const clock = options.now ?? (() => Date.now());

  // We rely on the Map insertion-order iteration for LRU: re-inserting
  // an entry on touch keeps it at the back, the oldest sits at the
  // front and is evicted when capacity is breached.
  const ring = new Map<string, BrowserFactSnapshot>();

  function touchAndStore(id: string, snapshot: BrowserFactSnapshot): void {
    if (ring.has(id)) ring.delete(id);
    ring.set(id, snapshot);
    while (ring.size > capacity) {
      const oldestKey = ring.keys().next().value;
      if (oldestKey === undefined) break;
      ring.delete(oldestKey);
    }
  }

  function isStale(snapshot: BrowserFactSnapshot, nowMs: number): boolean {
    return nowMs - snapshot.producedAtMs >= snapshot.ttlMs;
  }

  function ingestFactObservation(
    envelope: BrowserFactSnapshotEnvelope,
    nowMs: number = clock(),
  ): BrowserFactSnapshot {
    const id = envelope.factSnapshotId;
    if (!id) throw new Error('V27-02 fact-collector: factSnapshotId is required');

    // The collector is an in-memory ring. We deliberately keep
    // bookkeeping keys (tabId, sessionId) in memory because the
    // Router/ContextManager need them. Privacy redaction is a
    // *persistence-side* concern — see `redactFactSnapshotForPersistence`
    // below, which downstream writers (operation log, future Experience)
    // must use before any disk write.
    //
    // Producer contract: the extension-side observers MUST send only
    // pre-summarised, brand-neutral fields (closed-enum classifications,
    // hashes, host + URL pattern). Raw URLs, raw bodies, cookies, auth
    // headers MUST NOT appear in the envelope. Producers that violate
    // this contract are caught by the redaction golden test on the
    // persistence side, not by this hot path.

    const previous = ring.get(id) ?? null;
    const snapshot = applyEvent(previous, envelope, nowMs, defaultTtlMs, networkFactCap);
    touchAndStore(id, snapshot);
    return snapshot;
  }

  function getFactSnapshot(id: string, nowMs: number = clock()): FactSnapshotLookupResult {
    const snapshot = ring.get(id);
    if (!snapshot) return { verdict: 'missing', snapshot: null };
    if (isStale(snapshot, nowMs)) {
      ring.delete(id);
      return { verdict: 'stale', snapshot: null };
    }
    // Touch on read to keep frequently-accessed snapshots warm.
    if (ring.delete(id)) ring.set(id, snapshot);
    return { verdict: 'fresh', snapshot };
  }

  function prune(nowMs: number = clock()): number {
    let evicted = 0;
    for (const [id, snapshot] of ring) {
      if (isStale(snapshot, nowMs)) {
        ring.delete(id);
        evicted += 1;
      }
    }
    return evicted;
  }

  return {
    ingestFactObservation,
    getFactSnapshot,
    prune,
    reset(): void {
      ring.clear();
    },
    size(): number {
      return ring.size;
    },
  };
}

/**
 * Fold a single fact-observation envelope into the existing snapshot
 * (or create a fresh one). Pure function — no clock, no I/O.
 */
function applyEvent(
  previous: BrowserFactSnapshot | null,
  envelope: BrowserFactSnapshotEnvelope,
  nowMs: number,
  defaultTtlMs: number,
  networkFactCap: number,
): BrowserFactSnapshot {
  const next: BrowserFactSnapshot = previous
    ? { ...previous, networkFacts: [...previous.networkFacts] }
    : {
        factSnapshotId: envelope.factSnapshotId,
        networkSnapshotId: null,
        domSnapshotId: null,
        sessionId: null,
        readiness: { ...DEFAULT_READINESS, observedAtMs: nowMs },
        urlPattern: null,
        tabId: null,
        producedAtMs: nowMs,
        ttlMs: defaultTtlMs,
        networkFacts: [],
        domFingerprint: null,
      };

  next.producedAtMs = nowMs;

  const payload = envelope.payload;
  switch (payload.eventKind) {
    case 'network_request': {
      next.networkFacts.push(payload.fact as NetworkRequestFact);
      if (next.networkFacts.length > networkFactCap) {
        next.networkFacts = next.networkFacts.slice(-networkFactCap);
      }
      next.networkSnapshotId = `${envelope.factSnapshotId}#net@${envelope.observedAtMs}`;
      next.urlPattern = payload.urlPattern ?? next.urlPattern;
      next.tabId = payload.tabId ?? next.tabId;
      next.sessionId = payload.sessionId ?? next.sessionId;
      break;
    }
    case 'dom_fingerprint': {
      next.domFingerprint = payload.fingerprint as DomRegionFingerprint;
      next.domSnapshotId = `${envelope.factSnapshotId}#dom@${envelope.observedAtMs}`;
      next.urlPattern = payload.urlPattern ?? next.urlPattern;
      next.tabId = payload.tabId ?? next.tabId;
      next.sessionId = payload.sessionId ?? next.sessionId;
      break;
    }
    case 'readiness_signal': {
      next.readiness = { ...payload.signals };
      next.urlPattern = payload.urlPattern ?? next.urlPattern;
      next.tabId = payload.tabId ?? next.tabId;
      next.sessionId = payload.sessionId ?? next.sessionId;
      break;
    }
    case 'unknown':
    default:
      // Unknown sub-kinds are tolerated for forward compat (see
      // FACT_OBSERVATION_EVENT_KINDS). The snapshot's wallclock is
      // bumped so a downstream consumer sees the heartbeat.
      break;
  }

  return next;
}

let defaultCollector: FactCollector | null = null;

/** Process-wide singleton. Created lazily so test files can `reset()`. */
export function getDefaultFactCollector(): FactCollector {
  if (!defaultCollector) defaultCollector = createFactCollector();
  return defaultCollector;
}

/** Drop the singleton. Test-only. */
export function resetDefaultFactCollector(): void {
  defaultCollector = null;
}

/**
 * Funnel a `BrowserFactSnapshot` through the V27-00 privacy gate
 * before any persistence write (operation log, future Experience).
 * Returns a *new* object — `tabId`, `sessionId`, host header bags,
 * raw bodies, cookies, and value-shaped scalars are dropped or
 * `[redacted]`. Callers MUST use this helper instead of writing the
 * raw snapshot to disk.
 */
export function redactFactSnapshotForPersistence(snapshot: BrowserFactSnapshot): unknown {
  return redactForPersistence(snapshot, { kind: 'fact_snapshot' });
}

export type { FactObservationPayload };
