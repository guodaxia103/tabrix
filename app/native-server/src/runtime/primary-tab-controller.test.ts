/**
 * V26-02 (B-026) — primary tab controller runtime tests.
 *
 * Covers the runtime promotion of the V25-05 closeout tab-hygiene
 * contract, plus the V26-02-specific opt-in enforcement gate. The
 * cjs benchmark helper (`scripts/lib/v25-primary-tab-session.cjs`)
 * remains the source of truth for the closed-enum violation kinds
 * and the reuse-rate semantics; this suite cross-checks the TS
 * controller emits the same string values so future report
 * consumers can read both surfaces interchangeably.
 */
import * as path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
  HYGIENE_VIOLATION_KINDS,
  createPrimaryTabController,
  getDefaultPrimaryTabController,
  resetDefaultPrimaryTabController,
} from './primary-tab-controller';
import { BridgeStateManager } from '../server/bridge-state';

interface CjsHelperModule {
  HYGIENE_VIOLATION_KINDS: {
    UNEXPECTED_NEW_TAB: string;
    TAB_ID_CHANGED: string;
    FORBIDDEN_BARE_RETRY: string;
    CLEANUP_CLOSED_BASELINE: string;
    CLEANUP_FAILED: string;
  };
}

const cjsHelper: CjsHelperModule = require(
  path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'v25-primary-tab-session.cjs'),
);

describe('PrimaryTabController — alignment with the v25 cjs helper', () => {
  it('uses the same closed-enum violation kind strings as the v25 benchmark helper', () => {
    expect(HYGIENE_VIOLATION_KINDS.UNEXPECTED_NEW_TAB).toBe(
      cjsHelper.HYGIENE_VIOLATION_KINDS.UNEXPECTED_NEW_TAB,
    );
    expect(HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED).toBe(
      cjsHelper.HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED,
    );
    expect(HYGIENE_VIOLATION_KINDS.FORBIDDEN_BARE_RETRY).toBe(
      cjsHelper.HYGIENE_VIOLATION_KINDS.FORBIDDEN_BARE_RETRY,
    );
    expect(HYGIENE_VIOLATION_KINDS.CLEANUP_CLOSED_BASELINE).toBe(
      cjsHelper.HYGIENE_VIOLATION_KINDS.CLEANUP_CLOSED_BASELINE,
    );
    expect(HYGIENE_VIOLATION_KINDS.CLEANUP_FAILED).toBe(
      cjsHelper.HYGIENE_VIOLATION_KINDS.CLEANUP_FAILED,
    );
  });
});

describe('PrimaryTabController — observation contract', () => {
  it('seeds primaryTabId on the first navigation and counts it as expected/same', () => {
    const ctrl = createPrimaryTabController();
    ctrl.recordNavigation({ returnedTabId: 42 });
    const snap = ctrl.getSnapshot();
    expect(snap.primaryTabId).toBe(42);
    expect(snap.samePrimaryTabNavigations).toBe(1);
    expect(snap.expectedPrimaryTabNavigations).toBe(1);
    expect(snap.primaryTabReuseRate).toBe(1);
    expect(snap.benchmarkOwnedTabCount).toBe(1);
    expect(snap.violations).toEqual([]);
  });

  it('counts subsequent same-tab navigations as primary reuse', () => {
    const ctrl = createPrimaryTabController();
    ctrl.recordNavigation({ returnedTabId: 42 });
    ctrl.recordNavigation({ returnedTabId: 42 });
    ctrl.recordNavigation({ returnedTabId: 42 });
    const snap = ctrl.getSnapshot();
    expect(snap.primaryTabReuseRate).toBe(1);
    expect(snap.expectedPrimaryTabNavigations).toBe(3);
    expect(snap.samePrimaryTabNavigations).toBe(3);
    expect(snap.benchmarkOwnedTabCount).toBe(1);
  });

  it('records a tab_id_changed_after_navigation violation on non-allowlisted mismatch', () => {
    const ctrl = createPrimaryTabController();
    ctrl.recordNavigation({ returnedTabId: 42 });
    ctrl.recordNavigation({
      returnedTabId: 99,
      scenarioId: 'T-MULTI',
      url: 'https://b.example.com',
    });
    const snap = ctrl.getSnapshot();
    expect(snap.expectedPrimaryTabNavigations).toBe(2);
    expect(snap.samePrimaryTabNavigations).toBe(1);
    expect(snap.primaryTabReuseRate).toBe(0.5);
    expect(snap.benchmarkOwnedTabCount).toBe(2);
    expect(snap.violations).toEqual([
      {
        scenarioId: 'T-MULTI',
        kind: HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED,
        detail: expect.stringContaining('returned tabId=99 but primaryTabId=42'),
      },
    ]);
  });

  it('honours scenario-level allowsNewTab — no violation, excluded from denominator', () => {
    const ctrl = createPrimaryTabController();
    ctrl.declareAllowsNewTab('T-ALLOW-NEW');
    ctrl.recordNavigation({ returnedTabId: 42 });
    ctrl.recordNavigation({ returnedTabId: 99, scenarioId: 'T-ALLOW-NEW' });
    const snap = ctrl.getSnapshot();
    expect(snap.violations).toEqual([]);
    expect(snap.expectedPrimaryTabNavigations).toBe(1);
    expect(snap.samePrimaryTabNavigations).toBe(1);
    expect(snap.allowsNewTabScenarioIds).toEqual(['T-ALLOW-NEW']);
  });

  it('honours per-call allowsNewTab override', () => {
    const ctrl = createPrimaryTabController();
    ctrl.recordNavigation({ returnedTabId: 42 });
    ctrl.recordNavigation({ returnedTabId: 99, allowsNewTab: true });
    const snap = ctrl.getSnapshot();
    expect(snap.violations).toEqual([]);
    expect(snap.expectedPrimaryTabNavigations).toBe(1);
    expect(snap.benchmarkOwnedTabCount).toBe(2);
  });

  it('degrades reuse rate honestly when navigation produces no tabId', () => {
    const ctrl = createPrimaryTabController();
    ctrl.recordNavigation({ returnedTabId: 42 });
    ctrl.recordNavigation({ returnedTabId: null });
    const snap = ctrl.getSnapshot();
    expect(snap.expectedPrimaryTabNavigations).toBe(2);
    expect(snap.samePrimaryTabNavigations).toBe(1);
    expect(snap.primaryTabReuseRate).toBe(0.5);
    expect(snap.violations).toEqual([]);
  });

  it('reset() drops all state', () => {
    const ctrl = createPrimaryTabController();
    ctrl.recordNavigation({ returnedTabId: 42 });
    ctrl.recordNavigation({ returnedTabId: 99 });
    ctrl.reset();
    const snap = ctrl.getSnapshot();
    expect(snap.primaryTabId).toBeNull();
    expect(snap.expectedPrimaryTabNavigations).toBe(0);
    expect(snap.samePrimaryTabNavigations).toBe(0);
    expect(snap.benchmarkOwnedTabCount).toBe(0);
    expect(snap.violations).toEqual([]);
  });
});

describe('PrimaryTabController — enforcement gate', () => {
  it('returns null injected tabId when enforcement is off (default)', () => {
    const ctrl = createPrimaryTabController({ enforce: false });
    ctrl.recordNavigation({ returnedTabId: 42 });
    expect(ctrl.getInjectedTabId()).toBeNull();
  });

  it('returns primaryTabId for non-first navigations when enforcement is on', () => {
    const ctrl = createPrimaryTabController({ enforce: true });
    expect(ctrl.getInjectedTabId()).toBeNull();
    ctrl.recordNavigation({ returnedTabId: 42 });
    expect(ctrl.getInjectedTabId()).toBe(42);
  });

  it('does not inject for allowlisted scenarios even when enforcement is on', () => {
    const ctrl = createPrimaryTabController({ enforce: true });
    ctrl.declareAllowsNewTab('T-ALLOW-NEW');
    ctrl.recordNavigation({ returnedTabId: 42 });
    expect(ctrl.getInjectedTabId({ scenarioId: 'T-ALLOW-NEW' })).toBeNull();
    expect(ctrl.getInjectedTabId({ allowsNewTab: true })).toBeNull();
    expect(ctrl.getInjectedTabId({ scenarioId: 'T-OTHER' })).toBe(42);
  });
});

describe('PrimaryTabController — singleton lifecycle', () => {
  beforeEach(() => {
    resetDefaultPrimaryTabController();
    delete process.env.TABRIX_PRIMARY_TAB_ENFORCE;
  });

  afterEach(() => {
    resetDefaultPrimaryTabController();
    delete process.env.TABRIX_PRIMARY_TAB_ENFORCE;
  });

  it('returns the same instance across calls', () => {
    const a = getDefaultPrimaryTabController();
    const b = getDefaultPrimaryTabController();
    expect(a).toBe(b);
  });

  it('reads TABRIX_PRIMARY_TAB_ENFORCE lazily on first access', () => {
    process.env.TABRIX_PRIMARY_TAB_ENFORCE = 'true';
    const ctrl = getDefaultPrimaryTabController();
    ctrl.recordNavigation({ returnedTabId: 7 });
    expect(ctrl.getInjectedTabId()).toBe(7);
  });

  it('default enforcement is off', () => {
    const ctrl = getDefaultPrimaryTabController();
    ctrl.recordNavigation({ returnedTabId: 7 });
    expect(ctrl.getInjectedTabId()).toBeNull();
  });
});

describe('BridgeStateManager — V26-02 setPrimaryTabSnapshot', () => {
  it('exposes primaryTabId / primaryTabReuseRate / benchmarkOwnedTabCount on getSnapshot()', () => {
    const manager = new BridgeStateManager(() => false);
    const initial = manager.getSnapshot();
    expect(initial.primaryTabId).toBeNull();
    expect(initial.primaryTabReuseRate).toBeNull();
    expect(initial.benchmarkOwnedTabCount).toBe(0);

    manager.setPrimaryTabSnapshot({
      primaryTabId: 42,
      primaryTabReuseRate: 0.75,
      benchmarkOwnedTabCount: 3,
    });
    const updated = manager.getSnapshot();
    expect(updated.primaryTabId).toBe(42);
    expect(updated.primaryTabReuseRate).toBe(0.75);
    expect(updated.benchmarkOwnedTabCount).toBe(3);
  });

  it('coerces malformed inputs to safe defaults', () => {
    const manager = new BridgeStateManager(() => false);
    manager.setPrimaryTabSnapshot({
      primaryTabId: Number.NaN as unknown as number,
      primaryTabReuseRate: Number.NaN as unknown as number,
      benchmarkOwnedTabCount: -5,
    });
    const snap = manager.getSnapshot();
    expect(snap.primaryTabId).toBeNull();
    expect(snap.primaryTabReuseRate).toBeNull();
    expect(snap.benchmarkOwnedTabCount).toBe(0);
  });

  it('reset() clears the V26-02 fields back to defaults', () => {
    const manager = new BridgeStateManager(() => false);
    manager.setPrimaryTabSnapshot({
      primaryTabId: 42,
      primaryTabReuseRate: 0.5,
      benchmarkOwnedTabCount: 2,
    });
    manager.reset();
    const snap = manager.getSnapshot();
    expect(snap.primaryTabId).toBeNull();
    expect(snap.primaryTabReuseRate).toBeNull();
    expect(snap.benchmarkOwnedTabCount).toBe(0);
  });
});
