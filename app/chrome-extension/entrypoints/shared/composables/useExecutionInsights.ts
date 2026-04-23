/**
 * `useExecutionInsights` — Sidepanel "Execution" tab data source (V25-03).
 *
 * Calls the four read-only `/execution/*` HTTP routes added in
 * `app/native-server/src/server/execution-routes.ts` in parallel and
 * exposes a single reactive bundle to the Vue template. The four
 * routes are independent reads of the same underlying telemetry table
 * (`tabrix_choose_context_decisions`) so we batch them into one logical
 * "load" — partial-failure semantics are kept simple: any route error
 * marks the whole pane as `error` because the UI surfaces are
 * inter-dependent (savings only mean something next to recent
 * decisions).
 *
 * Cancellation
 * ------------
 * - One `AbortController` is shared across the parallel fetches so a
 *   second `load()` (e.g. user clicking refresh, then again) can abort
 *   the first batch as a unit and avoid a stale render.
 *
 * Privacy
 * -------
 * - This composable is intentionally a thin pass-through. The
 *   server-side `/execution/*` routes are responsible for the M4
 *   privacy contract (no full URLs, no `user_input`, no cookies / auth
 *   headers) — the negative tests that prove this live in
 *   `execution-routes.test.ts`. The composable therefore does **not**
 *   sanitize fields itself; if a regression on the server slips a raw
 *   PII field through, the UI will only render whatever DTO field is
 *   declared in `@tabrix/shared/execution-value` and tests on both
 *   sides should catch it before that.
 */

import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue';
import type {
  ExecutionRecentDecisionsResponseData,
  ExecutionReliabilitySignalSummary,
  ExecutionSavingsSummary,
  ExecutionTopActionPathsResponseData,
} from '@tabrix/shared';
import {
  EXECUTION_RECENT_DECISIONS_DEFAULT_LIMIT,
  EXECUTION_TOP_ACTION_PATHS_DEFAULT_LIMIT,
} from '@tabrix/shared';
import {
  ExecutionApiError,
  type ExecutionApiErrorKind,
  fetchExecutionRecentDecisions,
  fetchExecutionReliabilitySignals,
  fetchExecutionSavingsSummary,
  fetchExecutionTopActionPaths,
} from '../../../common/execution-api-client';

export type ExecutionInsightsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseExecutionInsightsResult {
  status: Ref<ExecutionInsightsStatus>;
  errorKind: Ref<ExecutionApiErrorKind | null>;
  errorMessage: Ref<string | null>;
  recent: Ref<ExecutionRecentDecisionsResponseData | null>;
  savings: Ref<ExecutionSavingsSummary | null>;
  topPaths: Ref<ExecutionTopActionPathsResponseData | null>;
  reliability: Ref<ExecutionReliabilitySignalSummary | null>;
  /** True iff every snapshot reports zero records or an empty list. */
  isEmpty: ComputedRef<boolean>;
  load(): Promise<void>;
  reload(): Promise<void>;
  dispose(): void;
}

interface InternalState {
  status: ExecutionInsightsStatus;
  errorKind: ExecutionApiErrorKind | null;
  errorMessage: string | null;
}

export function useExecutionInsights(): UseExecutionInsightsResult {
  const internal = reactive<InternalState>({
    status: 'idle',
    errorKind: null,
    errorMessage: null,
  });
  const recent = ref<ExecutionRecentDecisionsResponseData | null>(null);
  const savings = ref<ExecutionSavingsSummary | null>(null);
  const topPaths = ref<ExecutionTopActionPathsResponseData | null>(null);
  const reliability = ref<ExecutionReliabilitySignalSummary | null>(null);

  let activeController: AbortController | null = null;

  async function load(): Promise<void> {
    if (activeController) {
      activeController.abort();
    }
    const controller = new AbortController();
    activeController = controller;
    internal.status = 'loading';
    internal.errorKind = null;
    internal.errorMessage = null;

    try {
      const [r, s, t, rel] = await Promise.all([
        fetchExecutionRecentDecisions({
          limit: EXECUTION_RECENT_DECISIONS_DEFAULT_LIMIT,
          signal: controller.signal,
        }),
        fetchExecutionSavingsSummary({ signal: controller.signal }),
        fetchExecutionTopActionPaths({
          limit: EXECUTION_TOP_ACTION_PATHS_DEFAULT_LIMIT,
          signal: controller.signal,
        }),
        fetchExecutionReliabilitySignals({ signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      recent.value = r;
      savings.value = s;
      topPaths.value = t;
      reliability.value = rel;
      internal.status = 'ready';
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ExecutionApiError) {
        internal.errorKind = err.kind;
        internal.errorMessage = err.message;
      } else {
        internal.errorKind = 'shape';
        internal.errorMessage = err instanceof Error ? err.message : String(err);
      }
      internal.status = 'error';
    } finally {
      if (activeController === controller) {
        activeController = null;
      }
    }
  }

  function reload(): Promise<void> {
    return load();
  }

  function dispose(): void {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
  }

  const isEmpty = computed<boolean>(() => {
    if (internal.status !== 'ready') return false;
    const noRecent = (recent.value?.total ?? 0) === 0;
    const noSavings = (savings.value?.decisionCount ?? 0) === 0;
    const noPaths = (topPaths.value?.paths.length ?? 0) === 0;
    return noRecent && noSavings && noPaths;
  });

  return {
    status: computed(() => internal.status) as unknown as Ref<ExecutionInsightsStatus>,
    errorKind: computed(() => internal.errorKind) as unknown as Ref<ExecutionApiErrorKind | null>,
    errorMessage: computed(() => internal.errorMessage) as unknown as Ref<string | null>,
    recent,
    savings,
    topPaths,
    reliability,
    isEmpty,
    load,
    reload,
    dispose,
  };
}
