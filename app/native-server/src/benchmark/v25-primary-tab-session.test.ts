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
 * Plus the V25-05 closeout follow-up rules:
 *   8. Mismatched tabId triggers exactly one switch-back retry that
 *      passes `tabId: primaryTabId` (never bare).
 *   9. If switch-back retry succeeds, the helper-level navigation is
 *      a single successful primary reuse (expected +1 / same +1).
 *  10. If switch-back retry still fails, a second violation is
 *      recorded and the helper-level navigation counts as
 *      `expected +1 / same +0`.
 *  11. `maxConcurrentTabs` excludes baseline tabs.
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

describe('createPrimaryTabSession — switch-back retry (V25-05 follow-up rules 8/9/10)', () => {
  it('mismatched tabId triggers a switch-back retry on the same primary tab', async () => {
    const session = helper.createPrimaryTabSession();
    // First nav lands on 42 (primary). Second nav (mismatch → 99)
    // must trigger a switch-back retry; we don't care about the
    // retry's outcome here, only that the retry happened with
    // tabId: primaryTabId and was NOT bare.
    const nav = fakeNavigator([42, 99, 42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo/issues', {
      scenarioId: 'GH-ISSUES',
    });
    expect(nav.calls).toHaveLength(3);
    // Initial second-nav call carried tabId: primaryTabId.
    expect(nav.calls[1].args).toEqual({
      url: 'https://github.com/owner/repo/issues',
      tabId: 42,
    });
    // Switch-back retry MUST also carry tabId: primaryTabId.
    expect(nav.calls[2].name).toBe('chrome_navigate');
    expect(nav.calls[2].args).toEqual({
      url: 'https://github.com/owner/repo/issues',
      tabId: 42,
    });
    expect(nav.calls[2].args).not.toEqual({ url: 'https://github.com/owner/repo/issues' });
  });

  it('switch-back retry succeeds → helper-level reuse stays at 1.0 for that navigation', async () => {
    const session = helper.createPrimaryTabSession();
    const nav = fakeNavigator([42, 99, 42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo/issues', {
      scenarioId: 'GH-ISSUES',
    });
    const report = session.toReportInput();
    // Exactly one violation (the original mismatch). Switch-back
    // recovery does NOT add a second one.
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].kind).toBe(helper.HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED);
    expect(report.violations[0].scenarioId).toBe('GH-ISSUES');
    expect(report.violations[0].detail).toContain('returned tabId=99');
    // The whole navigateInPrimaryTab call counts as ONE successful
    // primary reuse: expected += 1, same += 1. Combined with the
    // first-ever nav (also +1/+1), the rate is 2/2 = 1.0.
    expect(report.expectedPrimaryTabNavigations).toBe(2);
    expect(report.samePrimaryTabNavigations).toBe(2);
  });

  it('switch-back retry fails again → records second violation, expected +1 / same +0', async () => {
    const session = helper.createPrimaryTabSession();
    // Second nav: 99 (mismatch). Retry: 99 (still wrong).
    const nav = fakeNavigator([42, 99, 99]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo/issues', {
      scenarioId: 'GH-ISSUES',
    });
    const report = session.toReportInput();
    expect(report.violations).toHaveLength(2);
    expect(report.violations[0].kind).toBe(helper.HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED);
    expect(report.violations[0].detail).toContain('returned tabId=99');
    expect(report.violations[1].kind).toBe(helper.HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED);
    expect(report.violations[1].detail).toContain('switch-back retry failed');
    // First nav (1,1) + failed second nav (1,0) → 2 expected, 1 same.
    expect(report.expectedPrimaryTabNavigations).toBe(2);
    expect(report.samePrimaryTabNavigations).toBe(1);
    // primary tab id is unchanged.
    expect(report.primaryTabId).toBe(42);
    // Three chrome_navigate calls total: first-nav, broken second-nav,
    // failed switch-back retry.
    expect(nav.calls).toHaveLength(3);
    expect(nav.calls[2].args).toEqual({
      url: 'https://github.com/owner/repo/issues',
      tabId: 42,
    });
  });

  it('allowlisted scenario does NOT trigger switch-back retry on a new tab', async () => {
    const session = helper.createPrimaryTabSession();
    session.declareAllowsNewTab('GH-NEW-TAB-LINK');
    const nav = fakeNavigator([42, 99]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/other-repo', {
      scenarioId: 'GH-NEW-TAB-LINK',
    });
    // No switch-back call — only the two user-driven navs.
    expect(nav.calls).toHaveLength(2);
    const report = session.toReportInput();
    expect(report.violations).toEqual([]);
    // Allowlisted call is excluded from the reuse denominator.
    expect(report.expectedPrimaryTabNavigations).toBe(1);
    expect(report.samePrimaryTabNavigations).toBe(1);
  });
});

describe('createPrimaryTabSession — maxConcurrentTabs (V25-05 follow-up rule 11)', () => {
  it('excludes baseline tabs from the benchmark concurrency ceiling', async () => {
    const session = helper.createPrimaryTabSession({ baselineTabIds: [1, 2] });
    const nav = fakeNavigator([42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    session.recordToolCallTabId('GH-LEAK', 99);
    // benchmark-owned live tabs = primary 42 + leaked 99 = 2.
    // Baseline tabs 1 and 2 stay in observedTabIds (so cleanup
    // refuses to close them) but do NOT inflate the v2.5 ceiling.
    expect(session.maxConcurrentTabs).toBe(2);
    const report = session.toReportInput();
    expect(report.maxConcurrentTabs).toBe(2);
    expect(report.baselineTabIds).toEqual([1, 2]);
    expect(report.observedTabIds).toEqual([1, 2, 42, 99]);
  });

  it('peak counts only benchmark-owned tabs when leaks come and go', async () => {
    const session = helper.createPrimaryTabSession({ baselineTabIds: [1, 2, 3] });
    const nav = fakeNavigator([42]);
    await session.navigateInPrimaryTab(nav.callTool, 'https://github.com/owner/repo');
    // Two leaks land — benchmark-owned live = primary + 2 leaks = 3.
    session.recordToolCallTabId('GH-LEAK-A', 99);
    session.recordToolCallTabId('GH-LEAK-B', 100);
    expect(session.maxConcurrentTabs).toBe(3);
    // Baseline-only observation MUST NOT bump the ceiling above the
    // real benchmark peak.
    session.recordToolCallTabId(null, 1);
    expect(session.maxConcurrentTabs).toBe(3);
  });
});
