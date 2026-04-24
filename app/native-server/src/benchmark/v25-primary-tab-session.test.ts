/**
 * V25-05 closeout — primary tab session helper tests.
 *
 * Covers the seven hygiene rules from V3.1
 * §"V25-05 Closeout Addendum: Browser Tab Hygiene":
 *   1. First navigation may be bare and seeds primaryTabId.
 *   2. Subsequent navigations pass tabId: primaryTabId.
 *   3. Retries also pass tabId: primaryTabId.
 *   4. Same-tab GitHub menu navigation keeps the same tabId
 *      (primaryTabReuseRate stays 1.0).
 *   5. Allowlisted scenarios may open a new tab without violation.
 *   6. Non-allowlisted new tab is recorded as `unexpected_new_tab`.
 *   7. cleanup() never closes a baseline tab.
 *
 * Why CommonJS-require: the helper is shipped as a `.cjs` so both
 * Jest and ESM scripts can load it without a build step.
 */
import * as path from 'node:path';

interface PrimaryTabSession {
  declareAllowsNewTab: (scenarioId: string) => void;
  navigateInPrimaryTab: (
    callTool: (name: string, args: Record<string, unknown>) => Promise<{ tabId?: number }>,
    url: string,
    opts?: { scenarioId?: string | null; allowsNewTab?: boolean; isRetry?: boolean },
  ) => Promise<{ tabId?: number } | undefined>;
  recordToolCallTabId: (scenarioId: string | null, tabId: number) => void;
  cleanup: (
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  ) => Promise<void>;
  toReportInput: () => {
    primaryTabId: number | null;
    baselineTabIds: number[];
    observedTabIds: number[];
    openedTabIds: number[];
    closedTabIds: number[];
    maxConcurrentTabs: number;
    samePrimaryTabNavigations: number;
    expectedPrimaryTabNavigations: number;
    allowsNewTabScenarioIds: string[];
    violations: Array<{ scenarioId: string | null; kind: string; detail?: string }>;
  };
  readonly primaryTabId: number | null;
  readonly maxConcurrentTabs: number;
}

interface HelperModule {
  HYGIENE_VIOLATION_KINDS: {
    UNEXPECTED_NEW_TAB: string;
    TAB_ID_CHANGED: string;
    FORBIDDEN_BARE_RETRY: string;
    CLEANUP_CLOSED_BASELINE: string;
    CLEANUP_FAILED: string;
  };
  createPrimaryTabSession: (options?: {
    baselineTabIds?: readonly number[];
    recordObservedFromBaseline?: boolean;
  }) => PrimaryTabSession;
}

const HELPER_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'lib',
  'v25-primary-tab-session.cjs',
);
const helper: HelperModule = require(HELPER_PATH);

function fakeNavigator(tabIdSequence: readonly number[]) {
  const queue = [...tabIdSequence];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name !== 'chrome_navigate') {
        return { ok: true };
      }
      const next = queue.shift();
      return { tabId: next };
    },
  };
}

describe('createPrimaryTabSession — primary tab acquisition (rule 1)', () => {
  it('first navigation is bare and seeds primaryTabId from chrome_navigate result', async () => {
    const session = helper.createPrimaryTabSession();
    const nav = fakeNavigator([42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo', {
      scenarioId: 'GH-REPO-NAV',
    });
    expect(session.primaryTabId).toBe(42);
    expect(nav.calls).toHaveLength(1);
    expect(nav.calls[0].name).toBe('chrome_navigate');
    expect(nav.calls[0].args).toEqual({ url: 'https://github.com/owner/repo' });
  });
});

describe('createPrimaryTabSession — primary tab reuse (rules 2, 3, 4)', () => {
  it('subsequent navigations pass tabId: primaryTabId', async () => {
    const session = helper.createPrimaryTabSession();
    const nav = fakeNavigator([42, 42, 42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo/issues');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo/actions');
    expect(nav.calls[1].args).toEqual({
      url: 'https://github.com/owner/repo/issues',
      tabId: 42,
    });
    expect(nav.calls[2].args).toEqual({
      url: 'https://github.com/owner/repo/actions',
      tabId: 42,
    });
    const report = session.toReportInput();
    expect(report.primaryTabId).toBe(42);
    expect(report.samePrimaryTabNavigations).toBe(3);
    expect(report.expectedPrimaryTabNavigations).toBe(3);
    expect(report.violations).toEqual([]);
  });

  it('retry path also passes tabId: primaryTabId — never bare', async () => {
    const session = helper.createPrimaryTabSession();
    const nav = fakeNavigator([42, 42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo/issues', {
      scenarioId: 'GH-ISSUES',
      isRetry: true,
    });
    expect(nav.calls[1].args).toEqual({
      url: 'https://github.com/owner/repo/issues',
      tabId: 42,
    });
    expect(nav.calls[1].args).not.toHaveProperty('newWindow');
    const report = session.toReportInput();
    expect(report.violations).toEqual([]);
  });

  it('GitHub menu / SPA navigation keeps the same tabId — reuse rate stays 1.0', async () => {
    const session = helper.createPrimaryTabSession();
    const nav = fakeNavigator([7, 7, 7, 7, 7]);
    for (const url of [
      'https://github.com/owner/repo',
      'https://github.com/owner/repo/issues',
      'https://github.com/owner/repo/pulls',
      'https://github.com/owner/repo/actions',
      'https://github.com/owner/repo/blob/main/README.md',
    ]) {
      await session.navigateInPrimaryTab(nav.callTool, url, { scenarioId: 'menu-nav' });
    }
    const report = session.toReportInput();
    expect(report.primaryTabId).toBe(7);
    expect(report.samePrimaryTabNavigations).toBe(5);
    expect(report.expectedPrimaryTabNavigations).toBe(5);
    expect(report.violations).toEqual([]);
  });
});

describe('createPrimaryTabSession — new-tab allowlist (rules 5, 6)', () => {
  it('declareAllowsNewTab — allowlisted scenario may open a new tab without violation', async () => {
    const session = helper.createPrimaryTabSession();
    session.declareAllowsNewTab('GH-NEW-TAB-LINK');
    const nav = fakeNavigator([42, 99]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/other-repo', {
      scenarioId: 'GH-NEW-TAB-LINK',
    });
    const report = session.toReportInput();
    expect(report.violations).toEqual([]);
    expect(report.allowsNewTabScenarioIds).toEqual(['GH-NEW-TAB-LINK']);
    // The allowlisted call did not count toward the reuse denominator.
    expect(report.expectedPrimaryTabNavigations).toBe(1);
    expect(report.samePrimaryTabNavigations).toBe(1);
  });

  it('non-allowlisted scenario producing a new tabId records tab_id_changed_after_navigation', async () => {
    const session = helper.createPrimaryTabSession();
    const nav = fakeNavigator([42, 99]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo/issues', {
      scenarioId: 'GH-ISSUES',
    });
    const report = session.toReportInput();
    expect(report.primaryTabId).toBe(42);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].kind).toBe(helper.HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED);
    expect(report.violations[0].scenarioId).toBe('GH-ISSUES');
    // First nav (no scenarioId) contributes (1, 1); the broken second nav
    // contributes (1, 0): expected=2, same=1, reuseRate=0.5 < 0.95 → gate
    // would block.
    expect(report.expectedPrimaryTabNavigations).toBe(2);
    expect(report.samePrimaryTabNavigations).toBe(1);
  });

  it('recordToolCallTabId from non-allowlisted scenario records unexpected_new_tab', () => {
    const session = helper.createPrimaryTabSession();
    // Seed primary tab manually via a fake first navigation.
    return session
      .navigateInPrimaryTab(fakeNavigator([42]).callTool, 'https://github.com/owner/repo')
      .then(() => {
        session.recordToolCallTabId('GH-CLICK', 99);
        const report = session.toReportInput();
        const kinds = report.violations.map((v) => v.kind);
        expect(kinds).toContain(helper.HYGIENE_VIOLATION_KINDS.UNEXPECTED_NEW_TAB);
      });
  });
});

describe('createPrimaryTabSession — cleanup (rule 7)', () => {
  it('cleanup never closes a baseline tab', async () => {
    const session = helper.createPrimaryTabSession({ baselineTabIds: [1, 2, 3] });
    const nav = fakeNavigator([42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    // Pretend a non-allowlisted tool call leaked tabId=99 into the suite.
    session.recordToolCallTabId('GH-LEAK', 99);

    const closed: number[] = [];
    await session.cleanup(async (name, args) => {
      if (name === 'chrome_close_tabs') {
        const ids = (args as { tabIds?: number[] }).tabIds ?? [];
        for (const id of ids) closed.push(id);
      }
      return { ok: true };
    });

    expect(closed).not.toContain(1);
    expect(closed).not.toContain(2);
    expect(closed).not.toContain(3);
    expect(closed).not.toContain(42); // primary itself preserved
    expect(closed).toContain(99);
    const report = session.toReportInput();
    expect(report.closedTabIds).toEqual([99]);
    // No baseline was closed → no cleanup_closed_baseline_tab violation.
    expect(report.violations.map((v) => v.kind)).not.toContain(
      helper.HYGIENE_VIOLATION_KINDS.CLEANUP_CLOSED_BASELINE,
    );
  });

  it('cleanup records cleanup_failed when callTool throws', async () => {
    const session = helper.createPrimaryTabSession();
    await session.navigateInPrimaryTab(
      fakeNavigator([42]).callTool,
      'https://github.com/owner/repo',
    );
    session.recordToolCallTabId('GH-LEAK', 99);
    await session.cleanup(async () => {
      throw new Error('chrome_close_tabs failed');
    });
    const kinds = session.toReportInput().violations.map((v) => v.kind);
    expect(kinds).toContain(helper.HYGIENE_VIOLATION_KINDS.CLEANUP_FAILED);
  });
});

describe('createPrimaryTabSession — maxConcurrentTabs', () => {
  it('counts live observed tabs (baseline + opened) at peak', async () => {
    const session = helper.createPrimaryTabSession({ baselineTabIds: [1, 2] });
    const nav = fakeNavigator([42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    session.recordToolCallTabId('GH-LEAK', 99);
    // baseline 1, 2 + primary 42 + leaked 99 = 4 live
    expect(session.maxConcurrentTabs).toBe(4);
  });
});
