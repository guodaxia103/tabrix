/**
 * `useMemoryTimeline` — Sidepanel Memory tab data source
 * (Stage 3e · B-002 list · B-003 drill-down).
 *
 * Wraps `fetchRecentSessions` and `fetchSessionSteps` with reactive
 * state so the Memory tab can render a recent-sessions list **and**
 * drill into a single session's steps without owning any fetch /
 * cancellation / cache plumbing. This composable is the **only**
 * Memory data source the sidepanel should use; direct calls to the
 * HTTP client are reserved for unit tests.
 *
 * State machine (sessions list)
 * -----------------------------
 * - Initial: `status === 'idle'`, `sessions === []`.
 * - Call `load()` → `status === 'loading'`. On success: `ready`, on
 *   failure: `error` with typed `errorKind`.
 * - `reload()` is an alias for `load({ offset: 0 })` and is the hook
 *   that UI exposes to an explicit refresh button.
 * - Pagination is cursor-by-offset: callers pass `{ offset }` to
 *   `load()`; `nextPage()` / `prevPage()` drive that off the current
 *   state and are idempotent at page boundaries.
 *
 * Drill-down (steps)
 * ------------------
 * - `expandedSessionId` holds at most one session id; the UI renders
 *   its steps inline under the row.
 * - `toggleExpansion(id)` expands the row and lazily fetches its
 *   steps the first time; a second toggle collapses without
 *   re-fetching (steps stay cached for the page lifetime).
 * - `getStepsSlot(id)` returns a reactive slot — `{ status, steps,
 *   errorKind, errorMessage }` — which the UI switches on. Slots
 *   always exist (idle default) so templates can bind without
 *   guards.
 * - `reloadSteps(id)` force-refetches a single session (e.g. a retry
 *   button on an error slot).
 *
 * Cancellation
 * ------------
 * - The sessions fetch uses one `AbortController`. Each `load()`
 *   aborts the previous in-flight request so a stale response can
 *   never overwrite a newer one.
 * - Each session's step fetch uses its own `AbortController` keyed
 *   by `sessionId`. Collapsing / re-toggling the same row aborts
 *   the old fetch before issuing the new one.
 */

import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue';
import type {
  MemoryExecutionStep,
  MemoryPersistenceMode,
  MemorySessionStatus,
  MemorySessionSummary,
} from '@tabrix/shared';
import {
  DEFAULT_SESSIONS_PAGE_SIZE,
  MemoryApiError,
  type MemoryApiErrorKind,
  fetchRecentSessions,
  fetchSessionSteps,
} from '../../../common/memory-api-client';

export type MemoryTimelineStatus = 'idle' | 'loading' | 'ready' | 'error';
export type MemoryStepsStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Status-filter chips shown on the Memory tab (B-006). "running" is a
 * UX-level group that matches both raw DB statuses `running` and
 * `starting` (starting is transient and users don't distinguish). The
 * other three chips map 1:1 to the underlying `MemorySessionStatus`.
 */
export type MemoryStatusChip = 'running' | 'completed' | 'failed' | 'aborted';

export const MEMORY_STATUS_CHIPS: readonly MemoryStatusChip[] = [
  'running',
  'completed',
  'failed',
  'aborted',
] as const;

/** Expand a chip into the set of DB statuses it matches. */
export function chipToStatuses(chip: MemoryStatusChip): MemorySessionStatus[] {
  if (chip === 'running') return ['running', 'starting'];
  return [chip];
}

/**
 * One entry in the per-session steps cache. Every session id the UI
 * has ever touched gets a slot, which simplifies `v-if` logic in
 * templates (the slot is always defined, only its status changes).
 */
export interface MemoryStepsSlot {
  status: MemoryStepsStatus;
  steps: MemoryExecutionStep[];
  persistenceMode: MemoryPersistenceMode | null;
  errorKind: MemoryApiErrorKind | null;
  errorMessage: string | null;
  loadedAt: number | null;
}

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
  readonly expandedSessionId: Ref<string | null>;
  readonly stepsBySession: Readonly<Record<string, MemoryStepsSlot>>;
  /**
   * Active status-chip selections (B-006). Empty set is interpreted as
   * "all". Mutating `.value` directly is fine; prefer `toggleStatusChip`
   * / `clearFilters` for chip-row UX.
   */
  readonly statusFilter: Ref<Set<MemoryStatusChip>>;
  /** Trimmed + lowercased search token; empty string means no search. */
  readonly searchQuery: Ref<string>;
  /**
   * `sessions` reduced by `statusFilter` and `searchQuery`. Client-side
   * only — the server still paginates the underlying list 20 at a time.
   */
  readonly filteredSessions: ComputedRef<MemorySessionSummary[]>;
  /**
   * `true` when any filter is active (chip selected OR non-empty
   * search). Drives the empty-state copy ("No sessions match your
   * filters") vs the plain empty state.
   */
  readonly hasActiveFilters: ComputedRef<boolean>;
  /**
   * The session id of the most-recent failed session on the current
   * page (after `statusFilter` / `searchQuery` are applied), or `null`.
   */
  readonly lastFailedSessionId: ComputedRef<string | null>;
  load(options?: { offset?: number }): Promise<void>;
  reload(): Promise<void>;
  nextPage(): Promise<void>;
  prevPage(): Promise<void>;
  toggleExpansion(sessionId: string): Promise<void>;
  reloadSteps(sessionId: string): Promise<void>;
  getStepsSlot(sessionId: string): MemoryStepsSlot;
  /**
   * Toggle membership of a single chip (no network call; local only).
   * Passing the same chip twice clears it, matching the UX of a
   * multi-select chip row.
   */
  toggleStatusChip(chip: MemoryStatusChip): void;
  /** Clear both the status filter and search query in one call. */
  clearFilters(): void;
  /** Pure convenience — returns the same id as `lastFailedSessionId`. */
  jumpToLastFailure(): string | null;
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

  const expandedSessionId = ref<string | null>(null);
  const stepsBySession = reactive<Record<string, MemoryStepsSlot>>({});

  const statusFilter = ref<Set<MemoryStatusChip>>(new Set());
  const searchQuery = ref<string>('');

  let sessionsInflight: AbortController | null = null;
  const stepsInflight = new Map<string, AbortController>();

  const hasNextPage = computed(() => offset.value + sessions.value.length < total.value);
  const hasPrevPage = computed(() => offset.value > 0);
  const isEmpty = computed(
    () => status.value === 'ready' && sessions.value.length === 0 && offset.value === 0,
  );

  const hasActiveFilters = computed(
    () => statusFilter.value.size > 0 || searchQuery.value.trim().length > 0,
  );

  const filteredSessions = computed<MemorySessionSummary[]>(() => {
    const chips = statusFilter.value;
    const allowedStatuses = new Set<MemorySessionStatus>();
    if (chips.size > 0) {
      for (const chip of chips) {
        for (const s of chipToStatuses(chip)) allowedStatuses.add(s);
      }
    }
    const needle = searchQuery.value.trim().toLowerCase();

    return sessions.value.filter((s) => {
      if (allowedStatuses.size > 0 && !allowedStatuses.has(s.status)) return false;
      if (needle) {
        const title = (s.taskTitle ?? '').toLowerCase();
        const intent = (s.taskIntent ?? '').toLowerCase();
        if (!title.includes(needle) && !intent.includes(needle)) return false;
      }
      return true;
    });
  });

  const lastFailedSessionId = computed<string | null>(() => {
    // `sessions` is ordered `started_at DESC` by the server; the first
    // failed row in the filtered list is therefore the most-recent.
    for (const s of filteredSessions.value) {
      if (s.status === 'failed') return s.sessionId;
    }
    return null;
  });

  async function load(opts: { offset?: number } = {}): Promise<void> {
    sessionsInflight?.abort();
    const controller = new AbortController();
    sessionsInflight = controller;

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
      if (sessionsInflight !== controller) return;

      sessions.value = data.sessions;
      total.value = data.total;
      offset.value = data.offset;
      persistenceMode.value = data.persistenceMode;
      lastLoadedAt.value = clock();
      status.value = 'ready';
    } catch (error) {
      if (sessionsInflight !== controller) return;
      if (isAbortError(error)) return;

      const err = toMemoryApiError(error);
      errorMessage.value = err.message;
      errorKind.value = err.kind;
      status.value = 'error';
    } finally {
      if (sessionsInflight === controller) {
        sessionsInflight = null;
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

  function ensureSlot(sessionId: string): MemoryStepsSlot {
    if (!stepsBySession[sessionId]) {
      stepsBySession[sessionId] = {
        status: 'idle',
        steps: [],
        persistenceMode: null,
        errorKind: null,
        errorMessage: null,
        loadedAt: null,
      };
    }
    // Always read back through the reactive container so the returned
    // object is the stable reactive proxy Vue caches — not the plain
    // object we just assigned (those are two different references).
    return stepsBySession[sessionId];
  }

  function getStepsSlot(sessionId: string): MemoryStepsSlot {
    return ensureSlot(sessionId);
  }

  async function loadSteps(sessionId: string, opts: { force?: boolean } = {}): Promise<void> {
    const slot = ensureSlot(sessionId);
    // Skip if we already have fresh data and the caller isn't forcing
    // a refetch. The sidepanel shouldn't reissue fetches just because
    // a row toggles open/close.
    if (!opts.force && slot.status === 'ready') return;

    stepsInflight.get(sessionId)?.abort();
    const controller = new AbortController();
    stepsInflight.set(sessionId, controller);

    slot.status = 'loading';
    slot.errorMessage = null;
    slot.errorKind = null;

    try {
      const data = await fetchSessionSteps(sessionId, { signal: controller.signal });
      if (stepsInflight.get(sessionId) !== controller) return;

      slot.steps = data.steps;
      slot.persistenceMode = data.persistenceMode;
      slot.loadedAt = clock();
      slot.status = 'ready';
    } catch (error) {
      if (stepsInflight.get(sessionId) !== controller) return;
      if (isAbortError(error)) return;

      const err = toMemoryApiError(error);
      slot.errorMessage = err.message;
      slot.errorKind = err.kind;
      slot.status = 'error';
    } finally {
      if (stepsInflight.get(sessionId) === controller) {
        stepsInflight.delete(sessionId);
      }
    }
  }

  async function toggleExpansion(sessionId: string): Promise<void> {
    if (!sessionId) return;
    if (expandedSessionId.value === sessionId) {
      expandedSessionId.value = null;
      stepsInflight.get(sessionId)?.abort();
      stepsInflight.delete(sessionId);
      return;
    }
    expandedSessionId.value = sessionId;
    await loadSteps(sessionId);
  }

  async function reloadSteps(sessionId: string): Promise<void> {
    await loadSteps(sessionId, { force: true });
  }

  function toggleStatusChip(chip: MemoryStatusChip): void {
    // Clone so the returned Ref value changes identity and triggers
    // dependent computeds reliably across Vue versions.
    const next = new Set(statusFilter.value);
    if (next.has(chip)) next.delete(chip);
    else next.add(chip);
    statusFilter.value = next;
  }

  function clearFilters(): void {
    if (statusFilter.value.size > 0) statusFilter.value = new Set();
    if (searchQuery.value !== '') searchQuery.value = '';
  }

  function jumpToLastFailure(): string | null {
    return lastFailedSessionId.value;
  }

  function dispose(): void {
    sessionsInflight?.abort();
    sessionsInflight = null;
    for (const c of stepsInflight.values()) c.abort();
    stepsInflight.clear();
    expandedSessionId.value = null;
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
    expandedSessionId,
    stepsBySession,
    statusFilter,
    searchQuery,
    filteredSessions,
    hasActiveFilters,
    lastFailedSessionId,
    load,
    reload,
    nextPage,
    prevPage,
    toggleExpansion,
    reloadSteps,
    getStepsSlot,
    toggleStatusChip,
    clearFilters,
    jumpToLastFailure,
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
