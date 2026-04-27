/**
 * V27-02 — Browser Fact Collector tests.
 *
 * Covers:
 *   - ingest of network / dom / readiness events folds into a single
 *     snapshot by `factSnapshotId`,
 *   - TTL-based stale rejection,
 *   - LRU eviction at capacity,
 *   - per-snapshot network-fact cap,
 *   - `redactFactSnapshotForPersistence` strips bookkeeping ids and any
 *     value-shaped scalar leak before persistence.
 */

import type {
  BrowserFactSnapshotEnvelope,
  DomRegionFingerprint,
  NetworkRequestFact,
  ReadinessSignals,
} from '@tabrix/shared';

import {
  FACT_SNAPSHOT_DEFAULT_TTL_MS,
  createFactCollector,
  redactFactSnapshotForPersistence,
} from './v27-fact-collector';

function makeNetworkFact(overrides: Partial<NetworkRequestFact> = {}): NetworkRequestFact {
  return {
    method: 'GET',
    host: 'example.test',
    pathPattern: '/api/items',
    queryKeys: ['page'],
    status: 200,
    resourceType: 'xmlhttprequest',
    contentType: 'application/json',
    sizeClass: 'small',
    timingMs: 42,
    noiseClass: 'usable',
    observedAtMs: 1_000,
    ...overrides,
  };
}

function makeFingerprint(overrides: Partial<DomRegionFingerprint> = {}): DomRegionFingerprint {
  return {
    regionHashes: { header: 'aaa', list: 'bbb' },
    domSnapshotHash: 'composite',
    observedAtMs: 1_000,
    ...overrides,
  };
}

function makeReadiness(overrides: Partial<ReadinessSignals> = {}): ReadinessSignals {
  return {
    documentComplete: 'true',
    routeStable: 'true',
    keyRegionReady: 'unknown',
    networkQuiet: 'unknown',
    observedAtMs: 1_000,
    ...overrides,
  };
}

function makeNetworkEnvelope(
  factSnapshotId: string,
  overrides: Partial<NetworkRequestFact> = {},
  envelope: Partial<BrowserFactSnapshotEnvelope> = {},
): BrowserFactSnapshotEnvelope {
  return {
    factSnapshotId,
    observedAtMs: envelope.observedAtMs ?? 1_000,
    payload: {
      eventKind: 'network_request',
      fact: makeNetworkFact(overrides),
      tabId: 7,
      urlPattern: 'example.test/api/items',
      sessionId: 'sess-1',
    },
  };
}

describe('v27-fact-collector — ingest + lookup', () => {
  it('folds network / dom / readiness events into one snapshot', () => {
    const collector = createFactCollector({ now: () => 1_000 });
    collector.ingestFactObservation(makeNetworkEnvelope('snap-1'));
    collector.ingestFactObservation({
      factSnapshotId: 'snap-1',
      observedAtMs: 1_010,
      payload: {
        eventKind: 'dom_fingerprint',
        fingerprint: makeFingerprint(),
        tabId: 7,
        urlPattern: 'example.test/api/items',
        sessionId: 'sess-1',
      },
    });
    collector.ingestFactObservation({
      factSnapshotId: 'snap-1',
      observedAtMs: 1_020,
      payload: {
        eventKind: 'readiness_signal',
        signals: makeReadiness({ keyRegionReady: 'true' }),
        tabId: 7,
        urlPattern: 'example.test/api/items',
        sessionId: 'sess-1',
      },
    });

    const result = collector.getFactSnapshot('snap-1', 1_030);
    expect(result.verdict).toBe('fresh');
    expect(result.snapshot?.networkFacts).toHaveLength(1);
    expect(result.snapshot?.networkFacts[0]?.host).toBe('example.test');
    expect(result.snapshot?.domFingerprint?.regionHashes.list).toBe('bbb');
    expect(result.snapshot?.readiness.keyRegionReady).toBe('true');
    expect(result.snapshot?.tabId).toBe(7);
    expect(result.snapshot?.sessionId).toBe('sess-1');
    expect(result.snapshot?.urlPattern).toBe('example.test/api/items');
  });

  it('returns missing for unknown ids and stale for expired snapshots', () => {
    const collector = createFactCollector({ now: () => 0, defaultTtlMs: 1_000 });
    collector.ingestFactObservation(makeNetworkEnvelope('snap-1'), 0);
    expect(collector.getFactSnapshot('absent', 0).verdict).toBe('missing');
    expect(collector.getFactSnapshot('snap-1', 500).verdict).toBe('fresh');
    expect(collector.getFactSnapshot('snap-1', 2_000).verdict).toBe('stale');
    expect(collector.size()).toBe(0);
  });

  it('caps per-snapshot network facts at the configured capacity', () => {
    const collector = createFactCollector({ networkFactCap: 3 });
    for (let i = 0; i < 5; i++) {
      collector.ingestFactObservation(makeNetworkEnvelope('snap-1', { observedAtMs: i }), i);
    }
    const result = collector.getFactSnapshot('snap-1', 6);
    expect(result.snapshot?.networkFacts.map((f) => f.observedAtMs)).toEqual([2, 3, 4]);
  });

  it('LRU-evicts the oldest snapshot once capacity is breached', () => {
    const collector = createFactCollector({ capacity: 2 });
    collector.ingestFactObservation(makeNetworkEnvelope('a'), 1);
    collector.ingestFactObservation(makeNetworkEnvelope('b'), 2);
    collector.ingestFactObservation(makeNetworkEnvelope('c'), 3);
    expect(collector.getFactSnapshot('a', 4).verdict).toBe('missing');
    expect(collector.getFactSnapshot('b', 4).verdict).toBe('fresh');
    expect(collector.getFactSnapshot('c', 4).verdict).toBe('fresh');
  });

  it('uses default TTL when the option is not overridden', () => {
    const collector = createFactCollector();
    expect(FACT_SNAPSHOT_DEFAULT_TTL_MS).toBeGreaterThan(0);
    collector.ingestFactObservation(makeNetworkEnvelope('snap-1'), 0);
    const fresh = collector.getFactSnapshot('snap-1', FACT_SNAPSHOT_DEFAULT_TTL_MS - 1);
    expect(fresh.verdict).toBe('fresh');
    const stale = collector.getFactSnapshot('snap-1', FACT_SNAPSHOT_DEFAULT_TTL_MS + 1);
    expect(stale.verdict).toBe('stale');
  });
});

describe('v27-fact-collector — redactFactSnapshotForPersistence', () => {
  it('strips bookkeeping keys (tabId) before persistence', () => {
    const collector = createFactCollector({ now: () => 1_000 });
    collector.ingestFactObservation(makeNetworkEnvelope('snap-1'));
    const snapshot = collector.getFactSnapshot('snap-1', 1_010).snapshot!;
    const redacted = redactFactSnapshotForPersistence(snapshot) as Record<string, unknown>;
    expect(redacted.tabId).toBeUndefined();
    // factSnapshotId is short and not value-shaped → preserved.
    expect(redacted.factSnapshotId).toBe('snap-1');
  });

  it('redacts a value-shaped scalar that a buggy producer leaked', () => {
    const collector = createFactCollector({ now: () => 1_000 });
    // contentType is a free-form string field — intentionally leaked.
    collector.ingestFactObservation(
      makeNetworkEnvelope('snap-1', { contentType: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    );
    const snapshot = collector.getFactSnapshot('snap-1', 1_010).snapshot!;
    const redacted = redactFactSnapshotForPersistence(snapshot) as {
      networkFacts: Array<{ contentType: string }>;
    };
    expect(redacted.networkFacts[0]?.contentType).toBe('[redacted]');
  });
});
