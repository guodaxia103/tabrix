/**
 * Unit tests for `useExecutionInsights` (V25-03 Sidepanel composable).
 *
 * We stub `fetch` at the global level so the composable exercises its
 * real code path through `execution-api-client`. This keeps us from
 * over-mocking and catches drift between the composable's state
 * transitions and the wire format produced by
 * `app/native-server/src/server/execution-routes.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useExecutionInsights } from '@/entrypoints/shared/composables/useExecutionInsights';
import type {
  ExecutionRecentDecisionsResponseData,
  ExecutionReliabilitySignalSummary,
  ExecutionSavingsSummary,
  ExecutionTopActionPathsResponseData,
} from '@tabrix/shared';

type FetchMock = ReturnType<typeof vi.fn>;

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
    _keys: unknown,
    cb: (items: Record<string, unknown>) => void,
  ) => {
    cb({ nativeServerPort: 12306 });
  }) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyDecisions(): ExecutionRecentDecisionsResponseData {
  return { decisions: [], total: 0, limit: 20, persistenceMode: 'disk' };
}

function emptySavings(): ExecutionSavingsSummary {
  return {
    decisionCount: 0,
    tokensSavedEstimateSum: 0,
    layerCounts: { L0: 0, 'L0+L1': 0, 'L0+L1+L2': 0, unknown: 0 },
    lastReplay: null,
    persistenceMode: 'disk',
  };
}

function emptyPaths(): ExecutionTopActionPathsResponseData {
  return { paths: [], limit: 5, persistenceMode: 'disk' };
}

function emptyReliability(): ExecutionReliabilitySignalSummary {
  return {
    decisionCount: 0,
    fallbackSafeCount: 0,
    fallbackSafeRate: 0,
    sourceRouteCounts: {
      read_page_required: 0,
      experience_replay_skip_read: 0,
      knowledge_supported_read: 0,
      dispatcher_fallback_safe: 0,
      unknown: 0,
    },
    replayBlockedByCounts: {},
    persistenceMode: 'disk',
  };
}

/**
 * Fastify-style envelope mock router. Switches off the `?` substring in
 * the URL so the same fetch mock can serve all four routes.
 */
function routeReply(
  url: string,
  payloads: {
    decisions?: ExecutionRecentDecisionsResponseData;
    savings?: ExecutionSavingsSummary;
    paths?: ExecutionTopActionPathsResponseData;
    reliability?: ExecutionReliabilitySignalSummary;
  },
): Response {
  if (url.includes('/execution/decisions/recent')) {
    return okJson({ status: 'ok', data: payloads.decisions ?? emptyDecisions() });
  }
  if (url.includes('/execution/savings/summary')) {
    return okJson({ status: 'ok', data: payloads.savings ?? emptySavings() });
  }
  if (url.includes('/execution/action-paths/top')) {
    return okJson({ status: 'ok', data: payloads.paths ?? emptyPaths() });
  }
  if (url.includes('/execution/reliability/signals')) {
    return okJson({ status: 'ok', data: payloads.reliability ?? emptyReliability() });
  }
  throw new Error(`unexpected url ${url}`);
}

describe('useExecutionInsights', () => {
  it('starts idle with no data', () => {
    const api = useExecutionInsights();
    expect(api.status.value).toBe('idle');
    expect(api.recent.value).toBeNull();
    expect(api.savings.value).toBeNull();
    expect(api.topPaths.value).toBeNull();
    expect(api.reliability.value).toBeNull();
    expect(api.isEmpty.value).toBe(false);
  });

  it('transitions idle → loading → ready on a successful load', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(routeReply(url, {})));

    const api = useExecutionInsights();
    const loadPromise = api.load();
    expect(api.status.value).toBe('loading');
    await loadPromise;

    expect(api.status.value).toBe('ready');
    // empty payloads → isEmpty true
    expect(api.isEmpty.value).toBe(true);
    expect(api.recent.value?.persistenceMode).toBe('disk');
    expect(api.savings.value?.layerCounts.L0).toBe(0);
    expect(api.reliability.value?.fallbackSafeRate).toBe(0);
  });

  it('reports populated state when at least one route returns data', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        routeReply(url, {
          decisions: {
            decisions: [
              {
                decisionId: 'd-1',
                createdAt: '2026-04-23T00:00:00Z',
                intentSignature: 'list_user_repositories',
                pageRole: 'list',
                siteFamily: 'github',
                strategy: 'experience_replay',
                fallbackStrategy: null,
                chosenLayer: 'L0',
                layerDispatchReason: 'experience_replay_can_execute',
                sourceRoute: 'experience_replay_skip_read',
                fallbackCause: null,
                tokensSavedEstimate: 1234,
              },
            ],
            total: 1,
            limit: 20,
            persistenceMode: 'disk',
          },
          savings: {
            decisionCount: 1,
            tokensSavedEstimateSum: 1234,
            layerCounts: { L0: 1, 'L0+L1': 0, 'L0+L1+L2': 0, unknown: 0 },
            lastReplay: {
              decisionId: 'd-1',
              createdAt: '2026-04-23T00:00:00Z',
              outcome: 'reuse',
            },
            persistenceMode: 'disk',
          },
          paths: {
            paths: [
              {
                intentSignature: 'list_user_repositories',
                pageRole: 'list',
                siteFamily: 'github',
                decisionCount: 1,
                lastSeenAt: '2026-04-23T00:00:00Z',
                topStrategy: 'experience_replay',
              },
            ],
            limit: 5,
            persistenceMode: 'disk',
          },
          reliability: {
            decisionCount: 1,
            fallbackSafeCount: 0,
            fallbackSafeRate: 0,
            sourceRouteCounts: {
              read_page_required: 0,
              experience_replay_skip_read: 1,
              knowledge_supported_read: 0,
              dispatcher_fallback_safe: 0,
              unknown: 0,
            },
            replayBlockedByCounts: {},
            persistenceMode: 'disk',
          },
        }),
      ),
    );

    const api = useExecutionInsights();
    await api.load();

    expect(api.status.value).toBe('ready');
    expect(api.isEmpty.value).toBe(false);
    expect(api.recent.value?.decisions[0].chosenLayer).toBe('L0');
    expect(api.savings.value?.decisionCount).toBe(1);
    expect(api.topPaths.value?.paths[0].intentSignature).toBe('list_user_repositories');
    expect(api.reliability.value?.sourceRouteCounts.experience_replay_skip_read).toBe(1);
  });

  it('reflects a fallback-heavy snapshot with non-zero fallbackSafeRate', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        routeReply(url, {
          reliability: {
            decisionCount: 4,
            fallbackSafeCount: 1,
            fallbackSafeRate: 0.25,
            sourceRouteCounts: {
              read_page_required: 1,
              experience_replay_skip_read: 0,
              knowledge_supported_read: 2,
              dispatcher_fallback_safe: 1,
              unknown: 0,
            },
            replayBlockedByCounts: { stale_anchor: 1, hot_path_changed: 2 },
            persistenceMode: 'disk',
          },
        }),
      ),
    );

    const api = useExecutionInsights();
    await api.load();

    expect(api.reliability.value?.fallbackSafeRate).toBeCloseTo(0.25);
    expect(api.reliability.value?.replayBlockedByCounts.hot_path_changed).toBe(2);
  });

  it('marks status=error when a route fails', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/execution/savings/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'error', message: 'boom' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(routeReply(url, {}));
    });

    const api = useExecutionInsights();
    await api.load();

    expect(api.status.value).toBe('error');
    expect(api.errorKind.value).toBe('http');
    expect(api.errorMessage.value).toContain('boom');
  });

  it('marks status=error with kind=network when fetch throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed to fetch'));

    const api = useExecutionInsights();
    await api.load();

    expect(api.status.value).toBe('error');
    expect(api.errorKind.value).toBe('network');
  });

  it('aborts the in-flight controller when load() is called twice in a row', async () => {
    const seenSignals: AbortSignal[] = [];
    fetchMock.mockImplementation((url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) seenSignals.push(init.signal);
      // First batch (signals 1..4) never resolves until aborted.
      // Second batch (signals 5..8) resolves with empty payloads.
      if (seenSignals.length <= 4) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      return Promise.resolve(routeReply(url, {}));
    });

    const api = useExecutionInsights();
    const first = api.load();
    // Wait until all 4 first-batch fetches have been issued so they
    // each have a registered signal we can later assert on.
    await waitUntil(() => seenSignals.length >= 4);
    const second = api.load();
    await Promise.allSettled([first, second]);

    expect(seenSignals.slice(0, 4).every((s) => s.aborted)).toBe(true);
  });

  it('dispose() aborts any active fetch signal', async () => {
    const seenSignals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) seenSignals.push(init.signal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });

    const api = useExecutionInsights();
    const pending = api.load();
    await waitUntil(() => seenSignals.length >= 4);
    api.dispose();
    await Promise.allSettled([pending]);

    expect(seenSignals.every((s) => s.aborted)).toBe(true);
  });
});

/**
 * Microtask-driven polling helper so the cancellation tests don't
 * depend on a fixed number of `await Promise.resolve()` flushes (which
 * varies with how many awaits live inside `resolveMemoryApiBaseUrl`).
 */
async function waitUntil(predicate: () => boolean, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitUntil timed out before predicate became true');
}
