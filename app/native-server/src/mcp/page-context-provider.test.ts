/**
 * V26-04 (B-027) — `LivePageContextProvider` unit tests.
 *
 * Pins the four contracts the v26 chooser depends on:
 *   1. Lookup order (live URL → memory pageRole → memory global →
 *      fallback_zero with explicit cause).
 *   2. `persistence_off` short-circuit when the reader is `null`.
 *   3. Provider-level error isolation: any throw inside the reader
 *      becomes `fallback_zero` with cause `provider_error` so the
 *      chooser hot path cannot crash.
 *   4. Cause string is correct for each `fallback_zero` branch and
 *      omitted for non-fallback branches.
 *
 * No SQLite involved — we drive a fake `PageSnapshotReader` so the
 * tests pin the provider semantics, not the repository's SQL.
 */

import {
  LivePageContextProvider,
  createLivePageContextProvider,
  type PageSnapshotReader,
} from './page-context-provider';
import type { PageSnapshot } from '../memory/db/page-snapshot-repository';

function makeSnap(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    snapshotId: 'snap-1',
    stepId: 'step-1',
    tabId: null,
    url: 'https://example.com/issues',
    title: 'issues',
    pageType: 'github',
    mode: 'l0',
    pageRole: 'github_issues_list',
    primaryRegion: 'main',
    quality: 'ok',
    taskMode: 'browse',
    complexityLevel: 'normal',
    sourceKind: 'dom',
    fallbackUsed: false,
    interactiveCount: 12,
    candidateActionCount: 7,
    highValueObjectCount: 3,
    summaryBlob: null,
    pageContextBlob: null,
    highValueObjectsBlob: null,
    interactiveElementsBlob: null,
    candidateActionsBlob: null,
    protocolL0Blob: 'a'.repeat(40),
    protocolL1Blob: 'b'.repeat(60),
    protocolL2Blob: 'c'.repeat(100),
    capturedAt: '2026-04-25T10:00:00.000Z',
    ...overrides,
  };
}

function makeReader(overrides: Partial<PageSnapshotReader> = {}): PageSnapshotReader {
  return {
    findLatestForUrl: () => undefined,
    findLatestForPageRole: () => undefined,
    findLatestGlobal: () => undefined,
    ...overrides,
  };
}

describe('LivePageContextProvider — lookup order', () => {
  test('returns live_snapshot when the URL matches a recent snapshot', () => {
    const snap = makeSnap({ candidateActionCount: 9, highValueObjectCount: 4 });
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestForUrl: (url) => (url === 'https://example.com/issues' ? snap : undefined),
      }),
    });
    const result = provider.getContext({ url: 'https://example.com/issues' });
    expect(result.source).toBe('live_snapshot');
    expect(result.candidateActionsCount).toBe(9);
    expect(result.hvoCount).toBe(4);
    expect(result.pageRole).toBe('github_issues_list');
    expect(result.fullReadByteLength).toBe(40 + 60 + 100);
    expect(result.fallbackCause).toBeUndefined();
  });

  test('falls back to memory_snapshot when only pageRole matches', () => {
    const snap = makeSnap({
      url: 'https://other.example/repo',
      candidateActionCount: 2,
      highValueObjectCount: 1,
    });
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestForPageRole: (role) => (role === 'github_issues_list' ? snap : undefined),
      }),
    });
    const result = provider.getContext({
      url: 'https://example.com/issues',
      pageRole: 'github_issues_list',
    });
    expect(result.source).toBe('memory_snapshot');
    expect(result.candidateActionsCount).toBe(2);
    expect(result.hvoCount).toBe(1);
    expect(result.fallbackCause).toBeUndefined();
  });

  test('falls back to memory_snapshot global when neither URL nor pageRole match', () => {
    const snap = makeSnap({ candidateActionCount: 5, highValueObjectCount: 2 });
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestGlobal: () => snap,
      }),
    });
    const result = provider.getContext({});
    expect(result.source).toBe('memory_snapshot');
    expect(result.candidateActionsCount).toBe(5);
    expect(result.hvoCount).toBe(2);
  });

  test('newest snapshot wins when several exist (delegates to reader)', () => {
    let calls = 0;
    const newer = makeSnap({
      snapshotId: 'snap-newer',
      candidateActionCount: 11,
      capturedAt: '2026-04-25T12:00:00.000Z',
    });
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestForUrl: () => {
          calls += 1;
          return newer;
        },
      }),
    });
    const result = provider.getContext({ url: 'https://example.com/issues' });
    expect(calls).toBe(1);
    expect(result.candidateActionsCount).toBe(11);
    expect(result.source).toBe('live_snapshot');
  });
});

describe('LivePageContextProvider — fallback_zero shapes', () => {
  test('returns persistence_off when the reader is null', () => {
    const provider = new LivePageContextProvider({ reader: null });
    const result = provider.getContext({
      url: 'https://example.com',
      pageRole: 'role_x',
    });
    expect(result).toEqual({
      source: 'fallback_zero',
      candidateActionsCount: 0,
      hvoCount: 0,
      fullReadByteLength: 0,
      pageRole: 'role_x',
      fallbackCause: 'persistence_off',
    });
  });

  test('returns no_session_snapshots when a URL is supplied but no snapshot is found', () => {
    const provider = new LivePageContextProvider({ reader: makeReader() });
    const result = provider.getContext({ url: 'https://example.com/missing' });
    expect(result.source).toBe('fallback_zero');
    expect(result.fallbackCause).toBe('no_session_snapshots');
    expect(result.candidateActionsCount).toBe(0);
    expect(result.hvoCount).toBe(0);
  });

  test('returns no_task_snapshots when no URL and no global snapshot exist', () => {
    const provider = new LivePageContextProvider({ reader: makeReader() });
    const result = provider.getContext({});
    expect(result.source).toBe('fallback_zero');
    expect(result.fallbackCause).toBe('no_task_snapshots');
  });

  test('isolates reader exceptions into provider_error', () => {
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestForUrl: () => {
          throw new Error('disk corrupt');
        },
      }),
    });
    const result = provider.getContext({
      url: 'https://example.com',
      pageRole: 'role_y',
    });
    expect(result.source).toBe('fallback_zero');
    expect(result.fallbackCause).toBe('provider_error');
    expect(result.pageRole).toBe('role_y');
  });

  test('treats whitespace-only URL / pageRole as omitted', () => {
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestForUrl: () => makeSnap(),
        findLatestForPageRole: () => makeSnap(),
      }),
    });
    const result = provider.getContext({ url: '   ', pageRole: '\t\n' });
    expect(result.source).toBe('fallback_zero');
    expect(result.fallbackCause).toBe('no_task_snapshots');
    expect(result.pageRole).toBeNull();
  });
});

describe('LivePageContextProvider — projection details', () => {
  test('coerces non-finite counters to 0 (defensive)', () => {
    const snap = makeSnap({
      candidateActionCount: Number.NaN as unknown as number,
      highValueObjectCount: Number.POSITIVE_INFINITY as unknown as number,
    });
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestForUrl: () => snap,
      }),
    });
    const result = provider.getContext({ url: 'https://example.com/issues' });
    expect(result.candidateActionsCount).toBe(0);
    expect(result.hvoCount).toBe(0);
  });

  test('estimates fullReadByteLength as the sum of L0/L1/L2 blob lengths', () => {
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestForUrl: () =>
          makeSnap({
            protocolL0Blob: 'x'.repeat(10),
            protocolL1Blob: null,
            protocolL2Blob: 'z'.repeat(7),
          }),
      }),
    });
    const result = provider.getContext({ url: 'https://example.com/issues' });
    expect(result.fullReadByteLength).toBe(10 + 7);
  });

  test('null pageRole on the snapshot stays null on the result', () => {
    const provider = new LivePageContextProvider({
      reader: makeReader({
        findLatestForUrl: () => makeSnap({ pageRole: null }),
      }),
    });
    const result = provider.getContext({ url: 'https://example.com/issues' });
    expect(result.pageRole).toBeNull();
  });
});

describe('createLivePageContextProvider factory', () => {
  test('returns a working provider instance for a non-null reader', () => {
    const provider = createLivePageContextProvider(
      makeReader({
        findLatestForUrl: () => makeSnap({ candidateActionCount: 4 }),
      }),
    );
    const result = provider.getContext({ url: 'https://example.com/issues' });
    expect(result.source).toBe('live_snapshot');
    expect(result.candidateActionsCount).toBe(4);
  });

  test('returns a provider that always answers persistence_off when reader is null', () => {
    const provider = createLivePageContextProvider(null);
    const result = provider.getContext({ url: 'https://example.com' });
    expect(result.source).toBe('fallback_zero');
    expect(result.fallbackCause).toBe('persistence_off');
  });
});
