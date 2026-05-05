/**
 * V27-04b — Complexity Profiler tests.
 *
 * Drives synthetic `BrowserFactSnapshot` inputs and asserts the
 * profiler returns the documented closed-enum verdict + clamped
 * confidence. The profiler must NOT consult readiness signals; the
 * "agnostic to readiness" guard test pins this contract.
 */
import type {
  BrowserFactSnapshot,
  DomRegionFingerprint,
  NetworkRequestFact,
  ReadinessSignals,
} from '@tabrix/shared';

import { classifyComplexity } from './page-complexity-profiler';

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

function makeFingerprint(regionHashes: Record<string, string>): DomRegionFingerprint {
  return {
    regionHashes,
    domSnapshotHash: 'composite',
    observedAtMs: 1_000,
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

function makeFact(overrides: Partial<NetworkRequestFact> = {}): NetworkRequestFact {
  return {
    method: 'GET',
    host: 'example.test',
    pathPattern: '/api/items',
    queryKeys: ['page'],
    status: 200,
    resourceType: 'xmlhttprequest',
    contentType: 'application/json',
    sizeClass: 'medium',
    timingMs: 50,
    noiseClass: 'usable',
    observedAtMs: 1_000,
    ...overrides,
  };
}

describe('page-complexity-profiler — classifyComplexity', () => {
  it('returns unknown when both arms abstain', () => {
    const out = classifyComplexity(makeSnapshot());
    expect(out.kind).toBe('unknown');
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThan(0.4);
  });

  it('classifies a list/search shell from a list-shaped network fact alone', () => {
    const out = classifyComplexity(
      makeSnapshot({
        networkFacts: [makeFact({ queryKeys: ['q', 'page'] })],
      }),
    );
    expect(out.kind).toBe('list_or_search');
    expect(out.confidence).toBeCloseTo(0.7);
  });

  it('classifies a list/search shell from a main_list region tag alone', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ main_list: 'list-hash' }),
      }),
    );
    expect(out.kind).toBe('list_or_search');
    expect(out.confidence).toBeCloseTo(0.7);
  });

  it('boosts confidence when DOM and network arms agree on list/search', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ main_list: 'list-hash' }),
        networkFacts: [makeFact({ queryKeys: ['q', 'page'], sizeClass: 'large' })],
      }),
    );
    expect(out.kind).toBe('list_or_search');
    expect(out.confidence).toBeCloseTo(0.9);
  });

  it('classifies a transactional page from a POST + transactional_form region', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ transactional_form: 'form-hash' }),
        networkFacts: [makeFact({ method: 'POST', queryKeys: [], pathPattern: '/api/submit' })],
      }),
    );
    expect(out.kind).toBe('transactional');
    expect(out.confidence).toBeCloseTo(0.9);
  });

  it('classifies a media page from a media_player region tag', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ media_player: 'player-hash', main_list: 'list-hash' }),
      }),
    );
    expect(out.kind).toBe('media');
    expect(out.confidence).toBeCloseTo(0.7);
  });

  it('classifies a document page from a document_body region + html GET on a docs path', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ document_body: 'doc-hash' }),
        networkFacts: [
          makeFact({
            method: 'GET',
            pathPattern: '/docs/intro',
            sizeClass: 'large',
            contentType: 'text/html',
            queryKeys: [],
          }),
        ],
      }),
    );
    expect(out.kind).toBe('document');
    expect(out.confidence).toBeCloseTo(0.9);
  });

  it('classifies a detail page from a /:id-shaped GET response', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ detail_panel: 'detail-hash' }),
        networkFacts: [
          makeFact({
            method: 'GET',
            pathPattern: '/api/items/abc123',
            queryKeys: [],
            sizeClass: 'small',
          }),
        ],
      }),
    );
    expect(out.kind).toBe('detail');
    expect(out.confidence).toBeCloseTo(0.9);
  });

  it('classifies a complex_app page from an app_shell region or websocket fact', () => {
    const wsOnly = classifyComplexity(
      makeSnapshot({
        networkFacts: [makeFact({ resourceType: 'websocket', method: 'GET', contentType: null })],
      }),
    );
    expect(wsOnly.kind).toBe('complex_app');

    const shellAndWs = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ app_shell: 'shell-hash' }),
        networkFacts: [makeFact({ resourceType: 'websocket', method: 'GET', contentType: null })],
      }),
    );
    expect(shellAndWs.kind).toBe('complex_app');
    expect(shellAndWs.confidence).toBeCloseTo(0.9);
  });

  it('classifies a simple shell from a header-only fingerprint', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ header: 'h-hash', footer: 'f-hash' }),
      }),
    );
    expect(out.kind).toBe('simple');
  });

  it('downgrades confidence to single-signal when DOM and network disagree', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({ document_body: 'doc-hash' }),
        networkFacts: [
          makeFact({ queryKeys: ['q', 'page'], pathPattern: '/api/items', sizeClass: 'large' }),
        ],
      }),
    );
    // DOM arm says document, network arm says list/search; DOM wins
    // (more decisive) but confidence drops to single-signal.
    expect(out.kind).toBe('document');
    expect(out.confidence).toBeCloseTo(0.7);
  });

  it('ignores asset/analytics/auth/private/telemetry network facts', () => {
    const out = classifyComplexity(
      makeSnapshot({
        networkFacts: [
          makeFact({ noiseClass: 'asset', queryKeys: ['v'] }),
          makeFact({ noiseClass: 'analytics', queryKeys: ['user'] }),
          makeFact({ noiseClass: 'auth', queryKeys: ['token'] }),
          makeFact({ noiseClass: 'telemetry', queryKeys: ['session'] }),
          makeFact({ noiseClass: 'private', queryKeys: ['secret'] }),
        ],
      }),
    );
    expect(out.kind).toBe('unknown');
  });

  it('drops region tags outside the closed allowlist', () => {
    const out = classifyComplexity(
      makeSnapshot({
        domFingerprint: makeFingerprint({
          unknown_tag: 'rogue-hash',
          another_unknown: 'rogue2',
        }),
      }),
    );
    expect(out.kind).toBe('unknown');
  });

  it('agnostic to readiness arm — readiness signals do not change verdict', () => {
    const a = classifyComplexity(
      makeSnapshot({
        readiness: makeReadiness({ documentComplete: 'true', keyRegionReady: 'true' }),
        domFingerprint: makeFingerprint({ main_list: 'h' }),
      }),
    );
    const b = classifyComplexity(
      makeSnapshot({
        readiness: makeReadiness(),
        domFingerprint: makeFingerprint({ main_list: 'h' }),
      }),
    );
    expect(a.kind).toBe(b.kind);
    expect(a.confidence).toBe(b.confidence);
  });

  it('is deterministic — same snapshot twice yields the same verdict', () => {
    const snap = makeSnapshot({
      domFingerprint: makeFingerprint({ main_list: 'h' }),
      networkFacts: [makeFact({ queryKeys: ['q'] })],
    });
    const a = classifyComplexity(snap, { now: () => 4242 });
    const b = classifyComplexity(snap, { now: () => 4242 });
    expect(a).toEqual(b);
  });

  it('clamps confidence into [0, 1]', () => {
    const out = classifyComplexity(makeSnapshot());
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });
});
