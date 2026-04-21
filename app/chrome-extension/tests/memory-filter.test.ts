/**
 * Unit tests for the Sprint 2 Memory tab filter / search / jump-to-last-
 * failure logic (B-006). Lives alongside `use-memory-timeline.test.ts`
 * but focuses on the filtering concern to keep each file under 200 lines.
 *
 * Same mocking pattern as `use-memory-timeline.test.ts`:
 *  - `fetch` is stubbed globally so we exercise the real composable +
 *    `fetchRecentSessions` code path
 *  - `chrome.storage.local.get` is stubbed callback-style, matching the
 *    convention from `docs/EXTENSION_TESTING_CONVENTIONS.md` (B-008).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    sessionId: 'sess',
    taskId: 'task',
    taskTitle: 'Default title',
    taskIntent: 'Default intent',
    transport: 'stdio',
    clientName: 'codex',
    status: 'completed',
    startedAt: '2026-04-20T10:00:00Z',
    endedAt: '2026-04-20T10:00:42Z',
    stepCount: 1,
    ...overrides,
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const SAMPLE_SESSIONS: MemorySessionSummary[] = [
  session({
    sessionId: 'sess-run',
    status: 'running',
    taskTitle: 'Scrape nightly reports',
    taskIntent: 'collect numbers from dashboards',
    startedAt: '2026-04-20T12:00:00Z',
  }),
  session({
    sessionId: 'sess-start',
    status: 'starting',
    taskTitle: 'Warming up form',
    taskIntent: 'prepare a submit',
    startedAt: '2026-04-20T11:30:00Z',
  }),
  session({
    sessionId: 'sess-done',
    status: 'completed',
    taskTitle: 'Smoke test login',
    taskIntent: 'Finish happy path',
    startedAt: '2026-04-20T11:00:00Z',
  }),
  session({
    sessionId: 'sess-fail-a',
    status: 'failed',
    taskTitle: 'Upload CSV',
    taskIntent: 'Retry after captcha',
    startedAt: '2026-04-20T10:30:00Z',
  }),
  session({
    sessionId: 'sess-fail-b',
    status: 'failed',
    taskTitle: 'Pay invoice',
    taskIntent: 'Card declined',
    startedAt: '2026-04-20T10:00:00Z',
  }),
  session({
    sessionId: 'sess-stop',
    status: 'aborted',
    taskTitle: 'Cancelled by user',
    taskIntent: 'Manual cancel',
    startedAt: '2026-04-20T09:30:00Z',
  }),
];

async function freshTimelineWith(sessions: MemorySessionSummary[]) {
  fetchMock.mockResolvedValueOnce(
    okJson({
      status: 'ok',
      data: {
        sessions,
        total: sessions.length,
        offset: 0,
        limit: 20,
        persistenceMode: 'disk',
      },
    }),
  );
  const api = useMemoryTimeline();
  await api.load();
  return api;
}

describe('Memory tab filters (B-006)', () => {
  it('with no chips selected, filteredSessions mirrors the full list (all visible)', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    expect(api.statusFilter.value.size).toBe(0);
    expect(api.filteredSessions.value).toHaveLength(SAMPLE_SESSIONS.length);
    expect(api.hasActiveFilters.value).toBe(false);
  });

  it('toggleStatusChip("failed") shows only failed sessions', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.toggleStatusChip('failed');
    const statuses = api.filteredSessions.value.map((s) => s.status);
    expect(statuses).toEqual(['failed', 'failed']);
    expect(api.hasActiveFilters.value).toBe(true);
  });

  it('"running" chip matches both raw running and starting statuses', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.toggleStatusChip('running');
    const statuses = api.filteredSessions.value.map((s) => s.status).sort();
    expect(statuses).toEqual(['running', 'starting']);
  });

  it('selecting multiple chips acts as OR (running + completed)', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.toggleStatusChip('running');
    api.toggleStatusChip('completed');
    const statuses = api.filteredSessions.value.map((s) => s.status).sort();
    expect(statuses).toEqual(['completed', 'running', 'starting']);
  });

  it('search matches task title case-insensitively', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.searchQuery.value = 'SMOKE';
    expect(api.filteredSessions.value.map((s) => s.sessionId)).toEqual(['sess-done']);
  });

  it('search falls through to task intent when title does not match', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.searchQuery.value = 'captcha';
    expect(api.filteredSessions.value.map((s) => s.sessionId)).toEqual(['sess-fail-a']);
  });

  it('empty search string is a no-op (whitespace-only is treated as empty)', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.searchQuery.value = '   ';
    expect(api.filteredSessions.value).toHaveLength(SAMPLE_SESSIONS.length);
    expect(api.hasActiveFilters.value).toBe(false);
  });

  it('jumpToLastFailure returns the first failed session in server order (most recent)', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    // SAMPLE_SESSIONS[3] (sess-fail-a) comes before sess-fail-b in descending startedAt.
    expect(api.jumpToLastFailure()).toBe('sess-fail-a');
    expect(api.lastFailedSessionId.value).toBe('sess-fail-a');
  });

  it('jumpToLastFailure returns null when no failed session is visible after filtering', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.toggleStatusChip('completed');
    expect(api.jumpToLastFailure()).toBeNull();
  });

  it('clearFilters wipes both status chips and search without refetching', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.toggleStatusChip('failed');
    api.searchQuery.value = 'Pay';
    expect(api.filteredSessions.value).toHaveLength(1);

    const callCountBefore = fetchMock.mock.calls.length;
    api.clearFilters();
    expect(api.statusFilter.value.size).toBe(0);
    expect(api.searchQuery.value).toBe('');
    expect(api.filteredSessions.value).toHaveLength(SAMPLE_SESSIONS.length);
    expect(fetchMock.mock.calls.length).toBe(callCountBefore);
  });

  it('toggling the same chip twice clears it', async () => {
    const api = await freshTimelineWith(SAMPLE_SESSIONS);
    api.toggleStatusChip('failed');
    expect(api.statusFilter.value.has('failed')).toBe(true);
    api.toggleStatusChip('failed');
    expect(api.statusFilter.value.has('failed')).toBe(false);
    expect(api.filteredSessions.value).toHaveLength(SAMPLE_SESSIONS.length);
  });
});
