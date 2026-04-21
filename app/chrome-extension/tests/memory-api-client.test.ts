/**
 * Unit tests for the MKEP Memory HTTP client
 * (`common/memory-api-client.ts`).
 *
 * These tests mock `fetch` and `chrome.storage.local` directly — no
 * Vue, no server — so they cover pure marshalling, port resolution
 * and error taxonomy regardless of the UI that wraps them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NATIVE_SERVER_PORT,
  DEFAULT_SESSIONS_PAGE_SIZE,
  MemoryApiError,
  fetchMemoryTask,
  fetchRecentSessions,
  fetchSessionSteps,
  resolveMemoryApiBaseUrl,
} from '@/common/memory-api-client';

type FetchMock = ReturnType<typeof vi.fn>;

function okResponse<T>(data: T): Response {
  return new Response(JSON.stringify({ status: 'ok', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errResponse(httpStatus: number, message: string): Response {
  return new Response(JSON.stringify({ status: 'error', message }), {
    status: httpStatus,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveMemoryApiBaseUrl', () => {
  it('falls back to 12306 when nativeServerPort is missing', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
      _keys: unknown,
      cb: (items: Record<string, unknown>) => void,
    ) => {
      cb({});
    }) as never);

    const url = await resolveMemoryApiBaseUrl();
    expect(url).toBe(`http://127.0.0.1:${DEFAULT_NATIVE_SERVER_PORT}`);
  });

  it('uses the stored native port when it is a valid number', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
      _keys: unknown,
      cb: (items: Record<string, unknown>) => void,
    ) => {
      cb({ nativeServerPort: 24680 });
    }) as never);

    const url = await resolveMemoryApiBaseUrl();
    expect(url).toBe('http://127.0.0.1:24680');
  });

  it('ignores out-of-range port values and falls back to the default', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
      _keys: unknown,
      cb: (items: Record<string, unknown>) => void,
    ) => {
      cb({ nativeServerPort: 0 });
    }) as never);

    const url = await resolveMemoryApiBaseUrl();
    expect(url).toBe(`http://127.0.0.1:${DEFAULT_NATIVE_SERVER_PORT}`);
  });
});

describe('fetchRecentSessions', () => {
  it('sends the default limit/offset when called without args', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        sessions: [],
        total: 0,
        limit: DEFAULT_SESSIONS_PAGE_SIZE,
        offset: 0,
        persistenceMode: 'disk',
      }),
    );

    await fetchRecentSessions({ baseUrl: 'http://127.0.0.1:12306' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(
      `http://127.0.0.1:12306/memory/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}&offset=0`,
    );
  });

  it('clamps limit into [1, 500] before putting it on the wire', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        sessions: [],
        total: 0,
        limit: 500,
        offset: 0,
        persistenceMode: 'disk',
      }),
    );

    await fetchRecentSessions({
      limit: 999_999,
      offset: -5,
      baseUrl: 'http://127.0.0.1:12306',
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('limit=500');
    expect(url).toContain('offset=0');
  });

  it('returns the data envelope payload when the server replies 200 ok', async () => {
    const payload = {
      sessions: [
        {
          sessionId: 'sess-1',
          taskId: 'task-1',
          taskTitle: 'Open login',
          taskIntent: 'Navigate to login',
          transport: 'stdio',
          clientName: 'codex',
          status: 'completed' as const,
          startedAt: '2026-04-20T10:00:00Z',
          endedAt: '2026-04-20T10:00:42Z',
          stepCount: 3,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      persistenceMode: 'disk' as const,
    };
    fetchMock.mockResolvedValue(okResponse(payload));

    const data = await fetchRecentSessions({ baseUrl: 'http://127.0.0.1:12306' });
    expect(data).toEqual(payload);
  });

  it('raises a MemoryApiError(kind=http) on non-2xx responses', async () => {
    fetchMock.mockResolvedValue(errResponse(500, 'boom'));

    await expect(fetchRecentSessions({ baseUrl: 'http://127.0.0.1:12306' })).rejects.toMatchObject({
      name: 'MemoryApiError',
      kind: 'http',
      httpStatus: 500,
      message: 'boom',
    });
  });

  it('raises a MemoryApiError(kind=network) when fetch itself throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchRecentSessions({ baseUrl: 'http://127.0.0.1:12306' })).rejects.toMatchObject({
      name: 'MemoryApiError',
      kind: 'network',
    });
  });

  it('raises a MemoryApiError(kind=shape) when the envelope is unrecognised', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(fetchRecentSessions({ baseUrl: 'http://127.0.0.1:12306' })).rejects.toBeInstanceOf(
      MemoryApiError,
    );
  });
});

describe('fetchSessionSteps', () => {
  it('URL-encodes the sessionId segment', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ sessionId: 'sess/1', steps: [], persistenceMode: 'disk' }),
    );

    await fetchSessionSteps('sess/1', { baseUrl: 'http://127.0.0.1:12306' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe('http://127.0.0.1:12306/memory/sessions/sess%2F1/steps');
  });

  it('rejects an empty sessionId before touching the network', async () => {
    await expect(fetchSessionSteps('')).rejects.toMatchObject({
      kind: 'shape',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchMemoryTask', () => {
  it('returns the task row on 200 ok', async () => {
    const payload = {
      task: {
        taskId: 'task-1',
        taskType: 'browser.navigate',
        title: 't',
        intent: 'i',
        origin: 'codex',
        createdAt: '2026-04-20T10:00:00Z',
        updatedAt: '2026-04-20T10:00:00Z',
        status: 'completed' as const,
        labels: [],
      },
      persistenceMode: 'disk' as const,
    };
    fetchMock.mockResolvedValue(okResponse(payload));

    const data = await fetchMemoryTask('task-1', { baseUrl: 'http://127.0.0.1:12306' });
    expect(data).toEqual(payload);
  });

  it('surfaces the server message on 404 responses', async () => {
    fetchMock.mockResolvedValue(errResponse(404, 'Task not found'));

    await expect(
      fetchMemoryTask('missing', { baseUrl: 'http://127.0.0.1:12306' }),
    ).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 404,
      message: 'Task not found',
    });
  });
});
