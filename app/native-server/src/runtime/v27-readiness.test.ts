/**
 * V27-04a — Readiness Profiler tests.
 *
 * Drives synthetic `BrowserFactSnapshot` inputs and asserts the
 * profiler returns the documented closed-enum verdict + clamped
 * confidence + dedup contributing-signals list. Determinism is pinned
 * by re-running the same input twice in `is deterministic`.
 *
 * The profiler must NOT consult `domFingerprint`, `networkFacts`
 * (beyond the hard-error rule), or any field outside the readiness
 * signals — that is V27-04b's job. The "agnostic to complexity" guard
 * test pins this contract.
 */
import type { BrowserFactSnapshot, ReadinessSignals } from '@tabrix/shared';

import { classifyReadiness } from './v27-readiness';

function makeReadiness(overrides: Partial<ReadinessSignals> = {}): ReadinessSignals {
  return {
    documentComplete: 'unknown',
    routeStable: 'unknown',
    keyRegionReady: 'unknown',
    networkQuiet: 'unknown',
    observedAtMs: 1_000,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<BrowserFactSnapshot> = {}): BrowserFactSnapshot {
  return {
    factSnapshotId: 'snap-1',
    networkSnapshotId: null,
    domSnapshotId: null,
    sessionId: 'sess-1',
    readiness: makeReadiness(),
    urlPattern: 'example.test/page',
    tabId: 7,
    producedAtMs: 1_000,
    ttlMs: 5_000,
    networkFacts: [],
    domFingerprint: null,
    ...overrides,
  };
}

describe('v27-readiness — classifyReadiness', () => {
  it('returns unknown with low confidence when every signal is unknown', () => {
    const out = classifyReadiness(makeSnapshot());
    expect(out.state).toBe('unknown');
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThan(0.4);
    expect(out.contributingSignals).toEqual([]);
    expect(out.producedAtMs).toBe(1_000);
  });

  it('returns route_stable when route_stable + network_quiet are true', () => {
    const out = classifyReadiness(
      makeSnapshot({
        readiness: makeReadiness({
          documentComplete: 'true',
          routeStable: 'true',
          keyRegionReady: 'true',
          networkQuiet: 'true',
        }),
      }),
    );
    expect(out.state).toBe('route_stable');
    expect(out.confidence).toBe(1);
    expect(out.contributingSignals).toEqual([
      'document_complete',
      'key_region_ready',
      'network_key_done',
      'route_stable',
    ]);
  });

  it('returns network_key_done when key_region_ready + network_quiet but not route_stable', () => {
    const out = classifyReadiness(
      makeSnapshot({
        readiness: makeReadiness({
          documentComplete: 'true',
          routeStable: 'unknown',
          keyRegionReady: 'true',
          networkQuiet: 'true',
        }),
      }),
    );
    expect(out.state).toBe('network_key_done');
    expect(out.confidence).toBe(1);
    expect(out.contributingSignals).toContain('document_complete');
    expect(out.contributingSignals).toContain('key_region_ready');
    expect(out.contributingSignals).toContain('network_key_done');
    expect(out.contributingSignals).not.toContain('route_stable');
  });

  it('returns key_region_ready when only key_region_ready is true', () => {
    const out = classifyReadiness(
      makeSnapshot({
        readiness: makeReadiness({
          documentComplete: 'unknown',
          routeStable: 'unknown',
          keyRegionReady: 'true',
          networkQuiet: 'unknown',
        }),
      }),
    );
    expect(out.state).toBe('key_region_ready');
    expect(out.contributingSignals).toEqual(['key_region_ready']);
    // Single-signal verdict — confidence should be the base floor.
    expect(out.confidence).toBeCloseTo(0.6);
  });

  it('returns document_complete when only documentComplete is true', () => {
    const out = classifyReadiness(
      makeSnapshot({
        readiness: makeReadiness({
          documentComplete: 'true',
          routeStable: 'unknown',
          keyRegionReady: 'unknown',
          networkQuiet: 'unknown',
        }),
      }),
    );
    expect(out.state).toBe('document_complete');
    expect(out.contributingSignals).toEqual(['document_complete']);
    expect(out.confidence).toBeCloseTo(0.6);
  });

  it('returns empty when documentComplete=true AND keyRegionReady=false AND networkQuiet=true', () => {
    const out = classifyReadiness(
      makeSnapshot({
        readiness: makeReadiness({
          documentComplete: 'true',
          routeStable: 'unknown',
          keyRegionReady: 'false',
          networkQuiet: 'true',
        }),
      }),
    );
    expect(out.state).toBe('empty');
    expect(out.contributingSignals).toEqual(['empty']);
    expect(out.confidence).toBeCloseTo(0.85);
  });

  it('returns error when every captured network fact is a 5xx response', () => {
    const out = classifyReadiness(
      makeSnapshot({
        readiness: makeReadiness({ documentComplete: 'true' }), // ignored
        networkFacts: [
          {
            method: 'GET',
            host: 'example.test',
            pathPattern: '/api/items',
            queryKeys: [],
            status: 503,
            resourceType: 'xmlhttprequest',
            contentType: 'application/json',
            sizeClass: 'small',
            timingMs: 100,
            noiseClass: 'usable',
            observedAtMs: 1_000,
          },
        ],
      }),
    );
    expect(out.state).toBe('error');
    expect(out.contributingSignals).toEqual(['error']);
    expect(out.confidence).toBeCloseTo(0.85);
  });

  it('does NOT flag error when only some network facts are 5xx', () => {
    const out = classifyReadiness(
      makeSnapshot({
        readiness: makeReadiness({ documentComplete: 'true' }),
        networkFacts: [
          {
            method: 'GET',
            host: 'example.test',
            pathPattern: '/api/items',
            queryKeys: [],
            status: 200,
            resourceType: 'xmlhttprequest',
            contentType: 'application/json',
            sizeClass: 'small',
            timingMs: 100,
            noiseClass: 'usable',
            observedAtMs: 1_000,
          },
          {
            method: 'GET',
            host: 'example.test',
            pathPattern: '/api/health',
            queryKeys: [],
            status: 503,
            resourceType: 'xmlhttprequest',
            contentType: 'application/json',
            sizeClass: 'small',
            timingMs: 100,
            noiseClass: 'usable',
            observedAtMs: 1_010,
          },
        ],
      }),
    );
    expect(out.state).not.toBe('error');
  });

  it('is deterministic — same snapshot twice yields the same verdict', () => {
    const snap = makeSnapshot({
      readiness: makeReadiness({
        documentComplete: 'true',
        routeStable: 'true',
        keyRegionReady: 'true',
        networkQuiet: 'true',
      }),
    });
    const a = classifyReadiness(snap, { now: () => 9999 });
    const b = classifyReadiness(snap, { now: () => 9999 });
    expect(a).toEqual(b);
  });

  it('clamps confidence into [0, 1]', () => {
    const out = classifyReadiness(makeSnapshot());
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });

  it('agnostic to complexity arm — domFingerprint + networkFacts (non-error) do not change verdict', () => {
    const snapA = makeSnapshot({
      readiness: makeReadiness({
        documentComplete: 'true',
        keyRegionReady: 'true',
        networkQuiet: 'true',
      }),
      domFingerprint: null,
      networkFacts: [],
    });
    const snapB = makeSnapshot({
      readiness: makeReadiness({
        documentComplete: 'true',
        keyRegionReady: 'true',
        networkQuiet: 'true',
      }),
      domFingerprint: {
        regionHashes: { document_body: 'doc-hash' },
        domSnapshotHash: 'composite',
        observedAtMs: 1_000,
      },
      networkFacts: [
        {
          method: 'GET',
          host: 'example.test',
          pathPattern: '/api/items',
          queryKeys: ['q'],
          status: 200,
          resourceType: 'xmlhttprequest',
          contentType: 'application/json',
          sizeClass: 'large',
          timingMs: 100,
          noiseClass: 'usable',
          observedAtMs: 1_000,
        },
      ],
    });
    const a = classifyReadiness(snapA);
    const b = classifyReadiness(snapB);
    // Same readiness signals -> same readiness verdict.
    expect(a.state).toBe(b.state);
    expect(a.confidence).toBe(b.confidence);
    expect(a.contributingSignals).toEqual(b.contributingSignals);
  });
});
