/**
 * Browser Context Manager (native runtime side).
 *
 * What this module is:
 * - A pure, in-memory, deterministic versioned context tree keyed by
 *   `tabId`. Each tab's record carries (`contextId`, `version`,
 *   `urlPattern`, `level`, `lastInvalidationReason`).
 * - The single integration point for the observation backbone:
 *   - lifecycle snapshots feed `applyLifecycleSnapshot()`.
 *   - action outcome snapshots feed `applyActionOutcome()`.
 *   - tab/window events feed `applyTabEvent()`.
 * - The Router/Policy is the only consumer that calls `getContext(tabId)`
 *   to detect "did the page underneath my plan change?". The manager
 *   does NOT decide policy — it only owns lifecycle/version/invalidation
 *   /cleanup. "Should the AI follow a freshly opened tab?" or "is the
 *   primary tab the new tab?" are explicitly deferred to Router/Policy
 *   and to the v2.6 `primary-tab-controller.ts` (V25-05 lineage).
 *
 * What this module is NOT:
 * - It does not own the bridge. The native-server `bridge-command-channel`
 *   ingests `BridgeObservationMessage` of `kind: 'tab_event'` and calls
 *   the `applyTabEvent()` helper here.
 * - It does not own DOM ref identity. That stays at the extension-side
 *   `stable-target-ref-registry.ts`. When a `bfcache_restored` event
 *   arrives carrying a `StableRefRevalidationResult`, the manager only
 *   uses the closed-enum verdict to decide whether to bump the version
 *   under a `bfcache_restored` reason.
 * - It does not persist anything. Persistence is the operation log's
 *   responsibility through PrivacyGate; the manager hands snapshots
 *   to the writer, never the reverse.
 *
 * Boundary cross-ref:
 * - Public types: `packages/shared/src/browser-fact.ts`.
 * - Lifecycle producer: `app/native-server/src/runtime/lifecycle-state-machine.ts`.
 * - Action outcome producer:
 *   `app/native-server/src/runtime/action-outcome-classifier.ts`.
 * - Tab event producer (extension side):
 *   `app/chrome-extension/entrypoints/background/observers/tab-window-context.ts`.
 *
 * Determinism: same sequence of inputs -> same final tree. Tests
 * should pin the version count and the contextId issuance pattern.
 */

import type {
  ActionOutcome,
  ActionOutcomeSnapshot,
  ContextInvalidationReason,
  ContextLevel,
  ContextVersion,
  LifecycleStateSnapshot,
  TabWindowContextEventEnvelope,
} from '@tabrix/shared';

/**
 * Contract of the manager. Returned by `createContextManager()`. The
 * default singleton is what the bridge-command-channel calls into;
 * tests prefer the constructor.
 */
export interface ContextManager {
  /**
   * Apply a lifecycle snapshot. The manager updates the
   *  `urlPattern` for the tab and bumps `version` when:
   *   - the previous record's urlPattern differs (navigation), OR
   *   - the lifecycleFlag is one of `back_forward` / `reload` /
   *     `tab_replaced` (heavy invalidation).
   *
   *  History-state pulses inside the same urlPattern bump the version
   *  under `route_change` at the `region` level.
   */
  applyLifecycleSnapshot(snapshot: LifecycleStateSnapshot): ContextVersion;

  /**
   * Apply a tab/window event. Returns the updated context
   * record for `event.tabId`. For `tab_removed`, the record is
   * removed and `null` is returned (the manager's cleanup hook).
   */
  applyTabEvent(event: TabWindowContextEventEnvelope): ContextVersion | null;

  /**
   * Apply an action-outcome snapshot. The manager bumps the
   * version under `route_change` (for `spa_partial_update`) or
   * `navigation` (for `navigated_same_tab`) at the matching context
   * level. Other outcomes (`navigated_new_tab`, `modal_opened`,
   * `no_observed_change`) do NOT touch this tab's context — those are
   * either "no DOM changed for this tab" or "a different tab needs a
   * separate apply call".
   */
  applyActionOutcome(snapshot: ActionOutcomeSnapshot, tabId: number): ContextVersion | null;

  /** Look up the current context record for a tab. */
  getContext(tabId: number): ContextVersion | null;

  /**
   * Force-invalidate a tab's context with a caller-supplied reason.
   * Bumps the version. Used by the Router when it wants to express
   * "task ended; whatever AI thought is now stale".
   */
  invalidate(
    tabId: number,
    reason: ContextInvalidationReason,
    level?: ContextLevel,
  ): ContextVersion | null;

  /** Drop everything. Test seam. */
  reset(): void;

  /** Test-only diagnostic: how many tabs are currently tracked. */
  size(): number;
}

interface ContextManagerOptions {
  /** Test seam — defaults to `Date.now`. */
  now?: () => number;
  /**
   * Custom contextId factory. Defaults to a deterministic
   * `'ctx-<tabId>-<seq>'` so tests do not need to mock `crypto`.
   * Production may swap in a UUID factory.
   */
  newContextId?: (tabId: number, seq: number) => string;
}

/** Build a fresh manager. Tests use this; production goes through
 *  `getDefaultContextManager()`. */
export function createContextManager(options: ContextManagerOptions = {}): ContextManager {
  const clock = options.now ?? (() => Date.now());
  const idFactory = options.newContextId ?? defaultContextIdFactory;
  const records = new Map<number, ContextVersion>();
  // Per-tab monotonic counter for the contextId factory. Reused so a
  // tab that goes through many navigations does not pile distinct
  // counters onto an already-bounded Map.
  const seqByTab = new Map<number, number>();

  function nextContextId(tabId: number): string {
    const next = (seqByTab.get(tabId) ?? 0) + 1;
    seqByTab.set(tabId, next);
    return idFactory(tabId, next);
  }

  function bumpVersion(
    tabId: number,
    urlPattern: string | null,
    reason: ContextInvalidationReason,
    level: ContextLevel,
    options: { mintNewContextId?: boolean } = {},
  ): ContextVersion {
    const previous = records.get(tabId) ?? null;
    const observedAtMs = clock();
    if (!previous || options.mintNewContextId) {
      const next: ContextVersion = {
        contextId: nextContextId(tabId),
        tabId,
        urlPattern,
        version: 1,
        level,
        lastInvalidationReason: reason,
        observedAtMs,
      };
      records.set(tabId, next);
      return next;
    }
    const next: ContextVersion = {
      contextId: previous.contextId,
      tabId,
      urlPattern: urlPattern ?? previous.urlPattern,
      version: previous.version + 1,
      level,
      lastInvalidationReason: reason,
      observedAtMs,
    };
    records.set(tabId, next);
    return next;
  }

  function snapshot(tabId: number): ContextVersion | null {
    const live = records.get(tabId);
    return live ? { ...live } : null;
  }

  return {
    applyLifecycleSnapshot(snap): ContextVersion {
      // `LifecycleStateSnapshot.tabId` is `number | null`. Without a
      // tabId there is no record to update — return a synthetic
      // "ambient" tombstone that the Router can ignore. We use
      // `tabId: -1` to mirror `chrome.windows.WINDOW_ID_NONE`.
      if (typeof snap.tabId !== 'number') {
        return {
          contextId: 'ctx-ambient-0',
          tabId: -1,
          urlPattern: snap.urlPattern,
          version: 0,
          level: 'page',
          lastInvalidationReason: 'unknown',
          observedAtMs: clock(),
        };
      }
      const tabId = snap.tabId;
      const previous = records.get(tabId) ?? null;
      // Closed-enum branch on lifecycleFlag. The manager keeps this
      // mapping narrow on purpose — anything we do not recognise
      // collapses to a `route_change`/`page` bump so a future flag
      // does not silently swallow an invalidation.
      switch (snap.lifecycleFlag) {
        case 'cold_load': {
          // First lifecycle snapshot for the tab, or a totally fresh
          // load on the same tab. Mint a new contextId.
          return bumpVersion(tabId, snap.urlPattern, 'navigation', 'page', {
            mintNewContextId: true,
          });
        }
        case 'back_forward':
        case 'reload':
        case 'tab_replaced': {
          // Heavy invalidation — the page identity changes. Mint a
          // fresh contextId so consumers cannot accidentally compare
          // across the boundary.
          return bumpVersion(tabId, snap.urlPattern, 'navigation', 'page', {
            mintNewContextId: true,
          });
        }
        case 'spa_route_change':
        case 'history_state_update': {
          return bumpVersion(tabId, snap.urlPattern, 'route_change', 'region');
        }
        case 'tab_closed': {
          records.delete(tabId);
          // Return a tombstone snapshot so the caller knows the tab
          // was just closed; the record is gone from the live map.
          return {
            contextId: previous?.contextId ?? nextContextId(tabId),
            tabId,
            urlPattern: previous?.urlPattern ?? snap.urlPattern,
            version: (previous?.version ?? 0) + 1,
            level: 'page',
            lastInvalidationReason: 'tab_closed',
            observedAtMs: clock(),
          };
        }
        case 'unknown':
        default: {
          // urlPattern change without a known flag — treat as a
          // navigation if the urlPattern moved, otherwise no-op.
          if (previous && previous.urlPattern === snap.urlPattern) {
            // No-op snapshot (no change). Return the previous record
            // unchanged so the caller's "did anything bump?" check is
            // straightforward.
            return { ...previous };
          }
          return bumpVersion(tabId, snap.urlPattern, 'navigation', 'page', {
            mintNewContextId: previous?.urlPattern !== snap.urlPattern,
          });
        }
      }
    },

    applyTabEvent(event): ContextVersion | null {
      switch (event.eventKind) {
        case 'tab_created': {
          // Mint a fresh record. The Router decides whether to follow
          // the new tab or stay on the previous one — the manager
          // simply records the existence of the new context.
          return bumpVersion(event.tabId, event.urlPattern ?? null, 'navigation', 'page', {
            mintNewContextId: true,
          });
        }
        case 'tab_removed': {
          const previous = records.get(event.tabId);
          records.delete(event.tabId);
          if (!previous) return null;
          // Tombstone — same shape as the lifecycle 'tab_closed' arm.
          return {
            contextId: previous.contextId,
            tabId: event.tabId,
            urlPattern: previous.urlPattern,
            version: previous.version + 1,
            level: 'page',
            lastInvalidationReason: 'tab_closed',
            observedAtMs: clock(),
          };
        }
        case 'tab_replaced': {
          // The tab named by `event.tabId` was replaced by `event.newTabId`.
          // Tombstone the old, mint the new under `tab_replaced`.
          const previous = records.get(event.tabId);
          records.delete(event.tabId);
          if (typeof event.newTabId !== 'number' || event.newTabId < 0) {
            return previous
              ? {
                  contextId: previous.contextId,
                  tabId: event.tabId,
                  urlPattern: previous.urlPattern,
                  version: previous.version + 1,
                  level: 'page',
                  lastInvalidationReason: 'tab_replaced',
                  observedAtMs: clock(),
                }
              : null;
          }
          return bumpVersion(event.newTabId, event.urlPattern ?? null, 'tab_replaced', 'page', {
            mintNewContextId: true,
          });
        }
        case 'window_focus_changed': {
          // The manager does not bump version on focus changes alone;
          // those are pure routing hints for the Router. Return the
          // current record (or null) so the caller can still consult
          // it.
          return snapshot(event.tabId);
        }
        case 'bfcache_restored': {
          // Use the producer-supplied stable-ref verdict, if any, to
          // decide whether to bump the version. `stale` and `unknown`
          // both bump (the Router cannot reuse refs in either case);
          // `live` and `missing` do not bump (refs are either still
          // live, or there were no refs to invalidate).
          const verdict = event.stableRefRevalidation?.outcome ?? 'unknown';
          if (verdict === 'live' || verdict === 'missing') {
            return snapshot(event.tabId);
          }
          return bumpVersion(event.tabId, event.urlPattern ?? null, 'bfcache_restored', 'page');
        }
        case 'unknown':
        default:
          return snapshot(event.tabId);
      }
    },

    applyActionOutcome(snap, tabId): ContextVersion | null {
      const reason = mapOutcomeToReason(snap.outcome);
      if (!reason) return snapshot(tabId);
      // `route_change` / `navigation` both bump under the existing
      // contextId — the action did not switch sites.
      return bumpVersion(
        tabId,
        records.get(tabId)?.urlPattern ?? null,
        reason.reason,
        reason.level,
      );
    },

    getContext(tabId): ContextVersion | null {
      return snapshot(tabId);
    },

    invalidate(tabId, reason, level): ContextVersion | null {
      const previous = records.get(tabId);
      if (!previous) return null;
      const next = bumpVersion(tabId, previous.urlPattern, reason, level ?? 'page');
      return next;
    },

    reset(): void {
      records.clear();
      seqByTab.clear();
    },

    size(): number {
      return records.size;
    },
  };
}

interface OutcomeMapping {
  reason: ContextInvalidationReason;
  level: ContextLevel;
}

/**
 * Map `ActionOutcome` -> `(reason, level)`. Returns `null` for
 * outcomes that should not bump THIS tab's context (e.g. a
 * `navigated_new_tab` is the new tab's problem; a `modal_opened` or
 * `no_observed_change` did not change the tab's page identity).
 */
function mapOutcomeToReason(outcome: ActionOutcome): OutcomeMapping | null {
  switch (outcome) {
    case 'navigated_same_tab':
      return { reason: 'navigation', level: 'page' };
    case 'spa_partial_update':
      return { reason: 'route_change', level: 'region' };
    case 'multiple_signals':
      // Conservative: at least one of the signals could be a
      // navigation. Bump under `navigation`/`page` so the Router
      // re-checks rather than reusing a stale plan.
      return { reason: 'navigation', level: 'page' };
    case 'navigated_new_tab':
    case 'modal_opened':
    case 'no_observed_change':
    case 'ambiguous':
    case 'unknown':
    default:
      return null;
  }
}

function defaultContextIdFactory(tabId: number, seq: number): string {
  return `ctx-${tabId}-${seq}`;
}

let defaultManager: ContextManager | null = null;

/**
 * Process-wide singleton. Mirrors the
 * `getDefaultPrimaryTabController()` pattern so the bridge-command-channel
 * has a fixed entrypoint.
 */
export function getDefaultContextManager(): ContextManager {
  if (defaultManager === null) {
    defaultManager = createContextManager();
  }
  return defaultManager;
}

/** Drop the singleton. Test-only. */
export function resetDefaultContextManager(): void {
  defaultManager = null;
}
