/**
 * `useMemoryTimeline` — Sidepanel Memory tab data source (Stage 3e · B-002).
 *
 * Wraps `fetchRecentSessions` with reactive state so the Memory tab can
 * render a recent-sessions list without owning any fetch/cancellation
 * plumbing. This composable is the **only** Memory data source the
 * sidepanel should use; direct calls to the HTTP client are reserved
 * for unit tests.
 *
 * State machine
 * -------------
 * - Initial: `status === 'idle'`, `sessions === []`.
 * - Call `load()` → `status === 'loading'`. On success: `ready`, on
 *   failure: `error` with typed `errorKind`.
 * - `reload()` is an alias for `load({ offset: 0 })` and is the hook
 *   that UI exposes to an explicit refresh button.
 * - Pagination is cursor-by-offset: callers pass `{ offset }` to
 *   `load()`; `nextPage()` / `prevPage()` drive that off the current
 *   state and are idempotent at page boundaries.
 *
 * Cancellation
 * ------------
 * Every `load()` creates a fresh `AbortController`. A subsequent call
 * or `dispose()` aborts the in-flight request, which lets us avoid
 * the classic "stale response overwrites a newer one" race without
 * needing a request id counter.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { MemoryPersistenceMode, MemorySessionSummary } from '@tabrix/shared';
import {
  DEFAULT_SESSIONS_PAGE_SIZE,
  MemoryApiError,
  type MemoryApiErrorKind,
  fetchRecentSessions,
} from '../../../common/memory-api-client';

export type MemoryTimelineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseMemoryTimelineOptions {
  /** Page size for `load()`. Defaults to 20 (one sidepanel viewport). */
  pageSize?: number;
  /**
   * Clock injection point for tests. Production code uses `Date.now`.
   */
  now?: () => number;
}

export interface UseMemoryTimelineApi {
  readonly status: Ref<MemoryTimelineStatus>;
  readonly sessions: Ref<MemorySessionSummary[]>;
  readonly total: Ref<number>;
  readonly offset: Ref<number>;
  readonly pageSize: Ref<number>;
  readonly persistenceMode: Ref<MemoryPersistenceMode | null>;
  readonly errorMessage: Ref<string | null>;
  readonly errorKind: Ref<MemoryApiErrorKind | null>;
  readonly lastLoadedAt: Ref<number | null>;
  readonly hasNextPage: ComputedRef<boolean>;
  readonly hasPrevPage: ComputedRef<boolean>;
  readonly isEmpty: ComputedRef<boolean>;
  load(options?: { offset?: number }): Promise<void>;
  reload(): Promise<void>;
  nextPage(): Promise<void>;
  prevPage(): Promise<void>;
  dispose(): void;
}

export function useMemoryTimeline(options: UseMemoryTimelineOptions = {}): UseMemoryTimelineApi {
  const pageSizeValue = clampPageSize(options.pageSize ?? DEFAULT_SESSIONS_PAGE_SIZE);
  const clock = options.now ?? Date.now;

  const status = ref<MemoryTimelineStatus>('idle');
  const sessions = ref<MemorySessionSummary[]>([]);
  const total = ref<number>(0);
  const offset = ref<number>(0);
  const pageSize = ref<number>(pageSizeValue);
  const persistenceMode = ref<MemoryPersistenceMode | null>(null);
  const errorMessage = ref<string | null>(null);
  const errorKind = ref<MemoryApiErrorKind | null>(null);
  const lastLoadedAt = ref<number | null>(null);

  let inflight: AbortController | null = null;

  const hasNextPage = computed(() => offset.value + sessions.value.length < total.value);
  const hasPrevPage = computed(() => offset.value > 0);
  const isEmpty = computed(
    () => status.value === 'ready' && sessions.value.length === 0 && offset.value === 0,
  );

  async function load(opts: { offset?: number } = {}): Promise<void> {
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;

    const nextOffset = Math.max(0, Math.floor(opts.offset ?? offset.value));
    status.value = 'loading';
    errorMessage.value = null;
    errorKind.value = null;

    try {
      const data = await fetchRecentSessions({
        limit: pageSize.value,
        offset: nextOffset,
        signal: controller.signal,
      });
      // Guard: if a newer call started after us, skip the commit.
      if (inflight !== controller) return;

      sessions.value = data.sessions;
      total.value = data.total;
      offset.value = data.offset;
      persistenceMode.value = data.persistenceMode;
      lastLoadedAt.value = clock();
      status.value = 'ready';
    } catch (error) {
      if (inflight !== controller) return;
      // Abort is a normal control-flow signal, not an error worth
      // surfacing to the UI — keep state untouched.
      if (isAbortError(error)) return;

      const err = toMemoryApiError(error);
      errorMessage.value = err.message;
      errorKind.value = err.kind;
      status.value = 'error';
    } finally {
      if (inflight === controller) {
        inflight = null;
      }
    }
  }

  function reload(): Promise<void> {
    return load({ offset: 0 });
  }

  async function nextPage(): Promise<void> {
    if (!hasNextPage.value) return;
    await load({ offset: offset.value + pageSize.value });
  }

  async function prevPage(): Promise<void> {
    if (!hasPrevPage.value) return;
    await load({ offset: Math.max(0, offset.value - pageSize.value) });
  }

  function dispose(): void {
    inflight?.abort();
    inflight = null;
  }

  return {
    status,
    sessions,
    total,
    offset,
    pageSize,
    persistenceMode,
    errorMessage,
    errorKind,
    lastLoadedAt,
    hasNextPage,
    hasPrevPage,
    isEmpty,
    load,
    reload,
    nextPage,
    prevPage,
    dispose,
  };
}

function clampPageSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SESSIONS_PAGE_SIZE;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function toMemoryApiError(error: unknown): MemoryApiError {
  if (error instanceof MemoryApiError) return error;
  if (error instanceof Error) {
    return new MemoryApiError('network', error.message, { cause: error });
  }
  return new MemoryApiError('network', 'Unknown error');
}
