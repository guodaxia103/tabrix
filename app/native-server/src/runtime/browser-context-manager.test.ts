/**
 * V27-05 — Tabrix v2.7 Tab/Window Context Manager unit tests (native runtime).
 *
 * Pins the closed-enum decision tree, the version-bump invariants, the
 * cleanup contract, and the bfcache stable-ref revalidation policy.
 *
 * Determinism: every test pins a deterministic clock and a
 * deterministic contextId factory so a future schema bump shows up as
 * a single-test diff, not a whole-suite drift.
 */

import {
  createContextManager,
  getDefaultContextManager,
  resetDefaultContextManager,
  type ContextManager,
} from './browser-context-manager';
import type {
  ActionOutcomeSnapshot,
  ContextVersion,
  LifecycleStateSnapshot,
  TabWindowContextEventEnvelope,
} from '@tabrix/shared';

function makeManager(start = 1_700_000_000_000): {
  manager: ContextManager;
  tick: (deltaMs?: number) => number;
  now: () => number;
} {
  let t = start;
  const now = () => t;
  const tick = (deltaMs = 1) => {
    t += deltaMs;
    return t;
  };
  const manager = createContextManager({ now });
  return { manager, tick, now };
}

function lifecycle(
  partial: Partial<LifecycleStateSnapshot> & {
    tabId: number;
    lifecycleFlag: LifecycleStateSnapshot['lifecycleFlag'];
  },
): LifecycleStateSnapshot {
  return {
    lifecycleState: 'route_stable',
    lifecycleFlag: partial.lifecycleFlag,
    navigationIntent: 'unknown',
    lifecycleConfidence: 0.9,
    urlPattern: 'example.test/foo',
    producedAtMs: 1,
    tabId: partial.tabId,
    ...partial,
  };
}

function tabEvent(
  partial: Partial<TabWindowContextEventEnvelope> & {
    eventKind: TabWindowContextEventEnvelope['eventKind'];
    tabId: number;
  },
): TabWindowContextEventEnvelope {
  return {
    observedAtMs: 1,
    urlPattern: null,
    newTabId: null,
    windowId: null,
    stableRefRevalidation: null,
    ...partial,
  } as TabWindowContextEventEnvelope;
}

function actionOutcome(outcome: ActionOutcomeSnapshot['outcome']): ActionOutcomeSnapshot {
  return {
    actionId: 'act-1',
    outcome,
    outcomeConfidence: 0.95,
    observedSignalKinds: [],
    producedAtMs: 1,
  };
}

describe('browser-context-manager — applyLifecycleSnapshot', () => {
  it('mints a fresh contextId on the first cold_load for a tab', () => {
    const { manager } = makeManager();
    const ctx = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'cold_load' }),
    );
    expect(ctx.tabId).toBe(100);
    expect(ctx.version).toBe(1);
    expect(ctx.lastInvalidationReason).toBe('navigation');
    expect(ctx.level).toBe('page');
    expect(ctx.contextId).toBe('ctx-100-1');
    expect(ctx.urlPattern).toBe('example.test/foo');
  });

  it('mints a NEW contextId on cold_load even when the tab already has a record', () => {
    const { manager } = makeManager();
    const first = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'cold_load' }),
    );
    const second = manager.applyLifecycleSnapshot(
      lifecycle({
        tabId: 100,
        lifecycleFlag: 'cold_load',
        urlPattern: 'example.test/bar',
      }),
    );
    expect(second.contextId).not.toBe(first.contextId);
    expect(second.contextId).toBe('ctx-100-2');
    // version is the bumpVersion-after-mint counter for the NEW
    // record, not the previous one
    expect(second.version).toBe(1);
    expect(second.urlPattern).toBe('example.test/bar');
  });

  it('mints a NEW contextId on back_forward / reload / tab_replaced', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 100, lifecycleFlag: 'cold_load' }));
    const back = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'back_forward' }),
    );
    expect(back.contextId).toBe('ctx-100-2');
    expect(back.lastInvalidationReason).toBe('navigation');
    expect(back.level).toBe('page');

    const reload = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'reload' }),
    );
    expect(reload.contextId).toBe('ctx-100-3');

    const replaced = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'tab_replaced' }),
    );
    expect(replaced.contextId).toBe('ctx-100-4');
  });

  it('keeps contextId but bumps version under route_change for spa_route_change', () => {
    const { manager } = makeManager();
    const first = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'cold_load' }),
    );
    const spa = manager.applyLifecycleSnapshot(
      lifecycle({
        tabId: 100,
        lifecycleFlag: 'spa_route_change',
        urlPattern: 'example.test/foo/details',
      }),
    );
    expect(spa.contextId).toBe(first.contextId);
    expect(spa.version).toBe(2);
    expect(spa.lastInvalidationReason).toBe('route_change');
    expect(spa.level).toBe('region');
    expect(spa.urlPattern).toBe('example.test/foo/details');
  });

  it('keeps contextId for history_state_update and bumps under route_change/region', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 100, lifecycleFlag: 'cold_load' }));
    const hsu = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'history_state_update' }),
    );
    expect(hsu.contextId).toBe('ctx-100-1');
    expect(hsu.version).toBe(2);
    expect(hsu.lastInvalidationReason).toBe('route_change');
    expect(hsu.level).toBe('region');
  });

  it('on tab_closed, removes the record and returns a tombstone', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 100, lifecycleFlag: 'cold_load' }));
    expect(manager.size()).toBe(1);
    const closed = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'tab_closed' }),
    );
    expect(closed.lastInvalidationReason).toBe('tab_closed');
    expect(closed.level).toBe('page');
    // the live map dropped the entry
    expect(manager.size()).toBe(0);
    expect(manager.getContext(100)).toBeNull();
  });

  it('treats an unknown flag with same urlPattern as a no-op (no version bump)', () => {
    const { manager } = makeManager();
    const first = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'cold_load' }),
    );
    const noop = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 100, lifecycleFlag: 'unknown' }),
    );
    expect(noop.contextId).toBe(first.contextId);
    expect(noop.version).toBe(first.version);
  });

  it('treats an unknown flag with different urlPattern as a navigation and mints a new contextId', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 100, lifecycleFlag: 'cold_load' }));
    const nav = manager.applyLifecycleSnapshot(
      lifecycle({
        tabId: 100,
        lifecycleFlag: 'unknown',
        urlPattern: 'example.test/somewhere-else',
      }),
    );
    expect(nav.contextId).toBe('ctx-100-2');
    expect(nav.lastInvalidationReason).toBe('navigation');
    expect(nav.level).toBe('page');
  });
});

describe('browser-context-manager — applyTabEvent', () => {
  it('tab_created mints a fresh record', () => {
    const { manager } = makeManager();
    const ctx = manager.applyTabEvent(
      tabEvent({ eventKind: 'tab_created', tabId: 200, urlPattern: 'example.test/page' }),
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.contextId).toBe('ctx-200-1');
    expect(ctx!.lastInvalidationReason).toBe('navigation');
  });

  it('tab_removed deletes the record and returns a tombstone', () => {
    const { manager } = makeManager();
    manager.applyTabEvent(tabEvent({ eventKind: 'tab_created', tabId: 200 }));
    const tombstone = manager.applyTabEvent(tabEvent({ eventKind: 'tab_removed', tabId: 200 }));
    expect(tombstone).not.toBeNull();
    expect(tombstone!.lastInvalidationReason).toBe('tab_closed');
    expect(manager.size()).toBe(0);
    // Removing an unknown tab returns null, not a fabricated tombstone.
    expect(manager.applyTabEvent(tabEvent({ eventKind: 'tab_removed', tabId: 9999 }))).toBeNull();
  });

  it('tab_replaced moves identity from oldTabId to newTabId', () => {
    const { manager } = makeManager();
    manager.applyTabEvent(tabEvent({ eventKind: 'tab_created', tabId: 200 }));
    const replaced = manager.applyTabEvent(
      tabEvent({
        eventKind: 'tab_replaced',
        tabId: 200,
        newTabId: 201,
        urlPattern: 'example.test/replaced',
      }),
    );
    expect(replaced).not.toBeNull();
    expect(replaced!.tabId).toBe(201);
    expect(replaced!.contextId).toBe('ctx-201-1');
    expect(replaced!.lastInvalidationReason).toBe('tab_replaced');
    expect(manager.getContext(200)).toBeNull();
    expect(manager.getContext(201)).not.toBeNull();
  });

  it('tab_replaced without a newTabId only tombstones the previous record', () => {
    const { manager } = makeManager();
    manager.applyTabEvent(tabEvent({ eventKind: 'tab_created', tabId: 200 }));
    const tomb = manager.applyTabEvent(
      tabEvent({ eventKind: 'tab_replaced', tabId: 200, newTabId: null }),
    );
    expect(tomb).not.toBeNull();
    expect(tomb!.lastInvalidationReason).toBe('tab_replaced');
    expect(manager.size()).toBe(0);
  });

  it('window_focus_changed never bumps the version', () => {
    const { manager } = makeManager();
    const first = manager.applyTabEvent(tabEvent({ eventKind: 'tab_created', tabId: 200 }))!;
    const same = manager.applyTabEvent(
      tabEvent({ eventKind: 'window_focus_changed', tabId: 200, windowId: 1 }),
    )!;
    expect(same.contextId).toBe(first.contextId);
    expect(same.version).toBe(first.version);
  });

  it('bfcache_restored bumps the version when the stable-ref verdict is stale or unknown', () => {
    const { manager } = makeManager();
    manager.applyTabEvent(tabEvent({ eventKind: 'tab_created', tabId: 200 }));

    const stale = manager.applyTabEvent(
      tabEvent({
        eventKind: 'bfcache_restored',
        tabId: 200,
        stableRefRevalidation: {
          outcome: 'stale',
          liveCount: 0,
          staleCount: 7,
          observedAtMs: 1,
        },
      }),
    )!;
    expect(stale.version).toBe(2);
    expect(stale.lastInvalidationReason).toBe('bfcache_restored');

    const unknown = manager.applyTabEvent(
      tabEvent({
        eventKind: 'bfcache_restored',
        tabId: 200,
        stableRefRevalidation: null,
      }),
    )!;
    expect(unknown.version).toBe(3);
  });

  it('bfcache_restored does NOT bump the version when refs are live or missing', () => {
    const { manager } = makeManager();
    const first = manager.applyTabEvent(tabEvent({ eventKind: 'tab_created', tabId: 200 }))!;

    const live = manager.applyTabEvent(
      tabEvent({
        eventKind: 'bfcache_restored',
        tabId: 200,
        stableRefRevalidation: {
          outcome: 'live',
          liveCount: 4,
          staleCount: 0,
          observedAtMs: 1,
        },
      }),
    )!;
    expect(live.version).toBe(first.version);

    const missing = manager.applyTabEvent(
      tabEvent({
        eventKind: 'bfcache_restored',
        tabId: 200,
        stableRefRevalidation: {
          outcome: 'missing',
          liveCount: 0,
          staleCount: 0,
          observedAtMs: 1,
        },
      }),
    )!;
    expect(missing.version).toBe(first.version);
  });

  it('unknown event kind is treated as a routing-only no-op', () => {
    const { manager } = makeManager();
    const first = manager.applyTabEvent(tabEvent({ eventKind: 'tab_created', tabId: 200 }))!;
    const noop = manager.applyTabEvent(tabEvent({ eventKind: 'unknown', tabId: 200 }))!;
    expect(noop.version).toBe(first.version);
    expect(noop.contextId).toBe(first.contextId);
  });
});

describe('browser-context-manager — applyActionOutcome', () => {
  it('navigated_same_tab bumps under navigation/page', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 300, lifecycleFlag: 'cold_load' }));
    const ctx = manager.applyActionOutcome(actionOutcome('navigated_same_tab'), 300)!;
    expect(ctx.lastInvalidationReason).toBe('navigation');
    expect(ctx.level).toBe('page');
    expect(ctx.version).toBe(2);
  });

  it('spa_partial_update bumps under route_change/region', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 300, lifecycleFlag: 'cold_load' }));
    const ctx = manager.applyActionOutcome(actionOutcome('spa_partial_update'), 300)!;
    expect(ctx.lastInvalidationReason).toBe('route_change');
    expect(ctx.level).toBe('region');
  });

  it('multiple_signals bumps conservatively under navigation/page', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 300, lifecycleFlag: 'cold_load' }));
    const ctx = manager.applyActionOutcome(actionOutcome('multiple_signals'), 300)!;
    expect(ctx.lastInvalidationReason).toBe('navigation');
    expect(ctx.level).toBe('page');
  });

  it.each([
    'navigated_new_tab',
    'modal_opened',
    'no_observed_change',
    'ambiguous',
    'unknown',
  ] as const)("%s does not bump this tab's context", (outcome) => {
    const { manager } = makeManager();
    const first = manager.applyLifecycleSnapshot(
      lifecycle({ tabId: 300, lifecycleFlag: 'cold_load' }),
    );
    const after = manager.applyActionOutcome(actionOutcome(outcome), 300)!;
    expect(after.version).toBe(first.version);
    expect(after.contextId).toBe(first.contextId);
  });

  it('returns null when the action references an unknown tab AND no current state', () => {
    const { manager } = makeManager();
    expect(manager.applyActionOutcome(actionOutcome('navigated_new_tab'), 999)).toBeNull();
  });
});

describe('browser-context-manager — invalidate / reset / size / determinism', () => {
  it('invalidate bumps under the caller-supplied reason', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 400, lifecycleFlag: 'cold_load' }));
    const after = manager.invalidate(400, 'task_ended', 'site')!;
    expect(after.lastInvalidationReason).toBe('task_ended');
    expect(after.level).toBe('site');
    expect(after.version).toBe(2);
  });

  it('invalidate returns null for an unknown tab', () => {
    const { manager } = makeManager();
    expect(manager.invalidate(404, 'manual_reset')).toBeNull();
  });

  it('reset drops everything', () => {
    const { manager } = makeManager();
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 1, lifecycleFlag: 'cold_load' }));
    manager.applyLifecycleSnapshot(lifecycle({ tabId: 2, lifecycleFlag: 'cold_load' }));
    expect(manager.size()).toBe(2);
    manager.reset();
    expect(manager.size()).toBe(0);
    expect(manager.getContext(1)).toBeNull();
  });

  it('is deterministic — same sequence yields the same versions and contextIds', () => {
    const drive = (manager: ContextManager): ContextVersion[] => {
      const out: ContextVersion[] = [];
      out.push(manager.applyLifecycleSnapshot(lifecycle({ tabId: 1, lifecycleFlag: 'cold_load' })));
      out.push(
        manager.applyLifecycleSnapshot(lifecycle({ tabId: 1, lifecycleFlag: 'spa_route_change' })),
      );
      out.push(manager.applyTabEvent(tabEvent({ eventKind: 'tab_created', tabId: 2 }))!);
      out.push(
        manager.applyTabEvent(
          tabEvent({
            eventKind: 'bfcache_restored',
            tabId: 1,
            stableRefRevalidation: {
              outcome: 'stale',
              liveCount: 0,
              staleCount: 1,
              observedAtMs: 1,
            },
          }),
        )!,
      );
      return out;
    };
    const a = drive(makeManager().manager);
    const b = drive(makeManager().manager);
    expect(a.map((r) => ({ id: r.contextId, v: r.version }))).toEqual(
      b.map((r) => ({ id: r.contextId, v: r.version })),
    );
  });
});

describe('browser-context-manager — singleton', () => {
  afterEach(() => {
    resetDefaultContextManager();
  });

  it('returns the same instance across calls', () => {
    const a = getDefaultContextManager();
    const b = getDefaultContextManager();
    expect(a).toBe(b);
  });

  it('reset drops the singleton', () => {
    const a = getDefaultContextManager();
    resetDefaultContextManager();
    const b = getDefaultContextManager();
    expect(a).not.toBe(b);
  });
});
