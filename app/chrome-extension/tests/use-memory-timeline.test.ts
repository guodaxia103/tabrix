/**
 * Unit tests for `useMemoryTimeline` (Sidepanel Memory tab composable).
 *
 * We stub `fetch` at the global level so the composable exercises its
 * real code path through `fetchRecentSessions`. This keeps us from
 * over-mocking and catches drift between the composable's state
 * transitions and the wire format.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { useMemoryTimeline } from '@/entrypoints/shared/composables/useMemoryTimeline';
import type { MemorySessionSummary } from '@tabrix/shared';

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
});

function session(overrides: Partial<MemorySessionSummary> = {}): MemorySessionSummary {
  return {
    sessionId: 'sess-1',
    taskId: 'task-1',
    taskTitle: 'Title',
    taskIntent: 'Intent',
    transport: 'stdio',
    clientName: 'codex',
    status: 'completed',
    startedAt: '2026-04-20T10:00:00Z',
    endedAt: '2026-04-20T10:00:42Z',
    stepCount: 2,
    ...overrides,
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useMemoryTimeline', () => {
  it('starts in the idle state with no sessions', () => {
    const api = useMemoryTimeline();
    expect(api.status.value).toBe('idle');
    expect(api.sessions.value).toEqual([]);
    expect(api.total.value).toBe(0);
    expect(api.offset.value).toBe(0);
    expect(api.errorMessage.value).toBeNull();
    expect(api.isEmpty.value).toBe(false);
    expect(api.hasNextPage.value).toBe(false);
    expect(api.hasPrevPage.value).toBe(false);
  });

  it('transitions idle → loading → ready on a successful load', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        status: 'ok',
        data: {
          sessions: [session({ sessionId: 's-1' }), session({ sessionId: 's-2' })],
          total: 2,
          limit: 20,
          offset: 0,
          persistenceMode: 'disk',
        },
      }),
    );

    const clock = vi.fn(() => 1_700_000_000_000);
    const api = useMemoryTimeline({ now: clock });

    const loadPromise = api.load();
    expect(api.status.value).toBe('loading');
    await loadPromise;

    expect(api.status.value).toBe('ready');
    expect(api.sessions.value.map((s) => s.sessionId)).toEqual(['s-1', 's-2']);
    expect(api.total.value).toBe(2);
    expect(api.persistenceMode.value).toBe('disk');
    expect(api.lastLoadedAt.value).toBe(1_700_000_000_000);
    expect(api.isEmpty.value).toBe(false);
  });

  it('marks isEmpty=true when the server returns zero sessions at offset 0', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        status: 'ok',
        data: {
          sessions: [],
          total: 0,
          limit: 20,
          offset: 0,
          persistenceMode: 'disk',
        },
      }),
    );

    const api = useMemoryTimeline();
    await api.load();

    expect(api.status.value).toBe('ready');
    expect(api.isEmpty.value).toBe(true);
  });

  it('surfaces MemoryApiError as a typed error state, preserving kind', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'error', message: 'DB unavailable' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = useMemoryTimeline();
    await api.load();

    expect(api.status.value).toBe('error');
    expect(api.errorKind.value).toBe('http');
    expect(api.errorMessage.value).toBe('DB unavailable');
    expect(api.sessions.value).toEqual([]);
  });

  it('falls back to a network error when fetch rejects entirely', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const api = useMemoryTimeline();
    await api.load();

    expect(api.status.value).toBe('error');
    expect(api.errorKind.value).toBe('network');
  });

  it('computes hasNextPage/hasPrevPage from offset and total', async () => {
    // Page 1 of 3: offset=0, total=50, pageSize=20 → hasNext=true, hasPrev=false
    fetchMock.mockResolvedValueOnce(
      okJson({
        status: 'ok',
        data: {
          sessions: Array.from({ length: 20 }, (_, i) => session({ sessionId: `s-${i}` })),
          total: 50,
          limit: 20,
          offset: 0,
          persistenceMode: 'disk',
        },
      }),
    );

    const api = useMemoryTimeline({ pageSize: 20 });
    await api.load();

    expect(api.hasNextPage.value).toBe(true);
    expect(api.hasPrevPage.value).toBe(false);

    // Advance to page 2.
    fetchMock.mockResolvedValueOnce(
      okJson({
        status: 'ok',
        data: {
          sessions: Array.from({ length: 20 }, (_, i) => session({ sessionId: `s-${20 + i}` })),
          total: 50,
          limit: 20,
          offset: 20,
          persistenceMode: 'disk',
        },
      }),
    );
    await api.nextPage();
    expect(api.offset.value).toBe(20);
    expect(api.hasNextPage.value).toBe(true);
    expect(api.hasPrevPage.value).toBe(true);
  });

  it('aborts an in-flight request when a new load is kicked off', async () => {
    // First request pends until its AbortSignal fires, mimicking
    // what the browser's real fetch does.
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      firstSignal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) return;
        const onAbort = () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
    });

    // Second request resolves immediately.
    fetchMock.mockResolvedValueOnce(
      okJson({
        status: 'ok',
        data: {
          sessions: [session({ sessionId: 's-latest' })],
          total: 1,
          limit: 20,
          offset: 0,
          persistenceMode: 'disk',
        },
      }),
    );

    const api = useMemoryTimeline();
    const firstLoad = api.load();
    // Kick off a second load while the first is still pending.
    await api.reload();

    expect(firstSignal?.aborted).toBe(true);
    expect(api.status.value).toBe('ready');
    expect(api.sessions.value[0]?.sessionId).toBe('s-latest');

    // The awaited cancellation should not flip our state back to
    // 'loading' or 'error'.
    await firstLoad;
    await nextTick();
    expect(api.status.value).toBe('ready');
  });
});
