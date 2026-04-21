/**
 * Sprint 1 · B-003 tests: session → steps drill-down.
 *
 * Covers the step-cache / toggle / refetch extensions that were added
 * to `useMemoryTimeline`, plus the two pure helpers
 * `extractHistoryRef` and `copyTextToClipboard`. Together with the
 * existing `tests/use-memory-timeline.test.ts` and
 * `tests/memory-api-client.test.ts`, they keep the drill-down state
 * machine pinned without pulling a DOM component test into the mix
 * (Vue SFC rendering under jsdom is not how the rest of this
 * package tests composables — see B-002).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryExecutionStep } from '@tabrix/shared';
import {
  MEMORY_HISTORY_REF_PREFIX,
  copyTextToClipboard,
  extractHistoryRef,
} from '@/common/memory-api-client';
import { useMemoryTimeline } from '@/entrypoints/shared/composables/useMemoryTimeline';

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

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function step(overrides: Partial<MemoryExecutionStep> = {}): MemoryExecutionStep {
  return {
    stepId: 'step-1',
    sessionId: 'sess-1',
    index: 1,
    toolName: 'chrome_read_page',
    stepType: 'tool_call',
    status: 'completed',
    startedAt: '2026-04-20T10:00:00Z',
    endedAt: '2026-04-20T10:00:00.420Z',
    artifactRefs: [],
    ...overrides,
  };
}

describe('extractHistoryRef', () => {
  it('returns the first memory:// entry from artifactRefs', () => {
    const s = step({
      artifactRefs: [
        'artifact://read_page/1',
        `${MEMORY_HISTORY_REF_PREFIX}snapshot/abc-123`,
        `${MEMORY_HISTORY_REF_PREFIX}snapshot/def-456`,
      ],
    });
    expect(extractHistoryRef(s)).toBe(`${MEMORY_HISTORY_REF_PREFIX}snapshot/abc-123`);
  });

  it('returns null when no memory:// entry is present', () => {
    const s = step({ artifactRefs: ['artifact://read_page/1'] });
    expect(extractHistoryRef(s)).toBeNull();
  });

  it('returns null when artifactRefs is empty or malformed', () => {
    expect(extractHistoryRef(step({ artifactRefs: [] }))).toBeNull();
    expect(extractHistoryRef({ artifactRefs: undefined as unknown as string[] })).toBeNull();
    expect(extractHistoryRef({ artifactRefs: null as unknown as string[] })).toBeNull();
  });
});

describe('copyTextToClipboard', () => {
  it('writes via the async clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const ok = await copyTextToClipboard('memory://snapshot/abc');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('memory://snapshot/abc');
  });

  it('refuses to copy an empty string', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    expect(await copyTextToClipboard('')).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports failure when the clipboard API rejects and no fallback exists', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    // Strip jsdom's execCommand so the fallback path fails too.
    const orig = document.execCommand;

    (document as any).execCommand = () => false;

    try {
      expect(await copyTextToClipboard('memory://snapshot/abc')).toBe(false);
    } finally {
      (document as any).execCommand = orig;
    }
  });
});

describe('useMemoryTimeline — drill-down (B-003)', () => {
  it('initializes the expansion state empty and returns an idle slot on demand', () => {
    const api = useMemoryTimeline();
    expect(api.expandedSessionId.value).toBeNull();

    const slot = api.getStepsSlot('sess-9');
    expect(slot.status).toBe('idle');
    expect(slot.steps).toEqual([]);
    // Calling twice returns the same slot reference (no duplication).
    expect(api.getStepsSlot('sess-9')).toBe(slot);
  });

  it('toggleExpansion opens a row and lazily fetches its steps', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        status: 'ok',
        data: {
          sessionId: 'sess-1',
          steps: [step(), step({ stepId: 'step-2', index: 2 })],
          persistenceMode: 'disk',
        },
      }),
    );

    const api = useMemoryTimeline();
    await api.toggleExpansion('sess-1');

    expect(api.expandedSessionId.value).toBe('sess-1');
    const slot = api.getStepsSlot('sess-1');
    expect(slot.status).toBe('ready');
    expect(slot.steps).toHaveLength(2);
    expect(slot.persistenceMode).toBe('disk');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches fetched steps: toggling the same row closes and reopens without refetching', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        status: 'ok',
        data: {
          sessionId: 'sess-1',
          steps: [step()],
          persistenceMode: 'disk',
        },
      }),
    );

    const api = useMemoryTimeline();
    await api.toggleExpansion('sess-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await api.toggleExpansion('sess-1');
    expect(api.expandedSessionId.value).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await api.toggleExpansion('sess-1');
    expect(api.expandedSessionId.value).toBe('sess-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces step-level errors without affecting the sessions list status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'error', message: 'steps boom' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = useMemoryTimeline();
    await api.toggleExpansion('sess-1');

    const slot = api.getStepsSlot('sess-1');
    expect(slot.status).toBe('error');
    expect(slot.errorKind).toBe('http');
    expect(slot.errorMessage).toBe('steps boom');
    // The sessions list state machine is independent of per-session slots.
    expect(api.status.value).toBe('idle');
  });

  it('reloadSteps force-refetches even when a slot is already ready', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          status: 'ok',
          data: {
            sessionId: 'sess-1',
            steps: [step({ stepId: 'step-a' })],
            persistenceMode: 'disk',
          },
        }),
      )
      .mockResolvedValueOnce(
        okJson({
          status: 'ok',
          data: {
            sessionId: 'sess-1',
            steps: [step({ stepId: 'step-b' })],
            persistenceMode: 'disk',
          },
        }),
      );

    const api = useMemoryTimeline();
    await api.toggleExpansion('sess-1');
    expect(api.getStepsSlot('sess-1').steps[0]?.stepId).toBe('step-a');

    await api.reloadSteps('sess-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(api.getStepsSlot('sess-1').steps[0]?.stepId).toBe('step-b');
  });

  it('switching between two different sessions caches them independently', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          status: 'ok',
          data: {
            sessionId: 'sess-1',
            steps: [step({ stepId: 'step-1' })],
            persistenceMode: 'disk',
          },
        }),
      )
      .mockResolvedValueOnce(
        okJson({
          status: 'ok',
          data: {
            sessionId: 'sess-2',
            steps: [step({ stepId: 'step-2', sessionId: 'sess-2' })],
            persistenceMode: 'disk',
          },
        }),
      );

    const api = useMemoryTimeline();
    await api.toggleExpansion('sess-1');
    await api.toggleExpansion('sess-2');

    expect(api.expandedSessionId.value).toBe('sess-2');
    expect(api.getStepsSlot('sess-1').status).toBe('ready');
    expect(api.getStepsSlot('sess-2').status).toBe('ready');
    expect(api.getStepsSlot('sess-1').steps[0]?.stepId).toBe('step-1');
    expect(api.getStepsSlot('sess-2').steps[0]?.stepId).toBe('step-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('dispose aborts in-flight step fetches', async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
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

    const api = useMemoryTimeline();
    const pending = api.toggleExpansion('sess-1');
    api.dispose();
    await pending;

    expect(capturedSignal?.aborted).toBe(true);
    expect(api.expandedSessionId.value).toBeNull();
    // Slot stays in whatever state the aborted fetch left it (the
    // composable swallows AbortError so `loading` remains). The UI
    // never sees this because `expandedSessionId` is null.
    expect(['loading', 'idle']).toContain(api.getStepsSlot('sess-1').status);
  });
});
