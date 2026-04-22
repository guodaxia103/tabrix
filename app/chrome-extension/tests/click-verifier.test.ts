// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLICK_VERIFIER_SETTLE_DELAY_MS,
  evaluateClickVerifier,
  isVerifierContextActive,
  isVerifierContextRequested,
  runClickVerifier,
} from '@/entrypoints/background/tools/browser/click-verifier';
import {
  clickTool,
  NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS,
} from '@/entrypoints/background/tools/browser/interaction';

/**
 * Test strategy for B-024 (Click V2 · verifier hook v1).
 *
 * These tests target the narrow mechanical contract from
 * `docs/CLICK_V2_EXECUTION_BRIEF_V1.md` §10:
 *
 *   1. verifier not requested  → current generic click path still works
 *   2. verifier requested + destination matches → `success: true`
 *   3. verifier requested + URL changes but role mismatches → `success: false`
 *   4. verifier requested + no matching destination → `success: false`
 *   5. response includes `postClickState`
 *
 * We exercise the pure evaluator directly (tests 2/3/4) and use the thin
 * IO wrapper `runClickVerifier` to cover the plumbing (tests 1/5).
 *
 * `interaction.ts` projects `ClickVerifierResult` 1:1 into the public
 * `postClickState` object, so a field-shape assertion here is sufficient
 * to keep the public contract honest — the projection itself is a
 * mechanical copy covered by the TypeScript compiler.
 */

const GITHUB_ISSUES_BODY =
  'New issue Assignee Labels Milestone — bug reports and feature requests for octocat/hello.';
const GITHUB_ACTIONS_BODY =
  'Filter workflow runs · run 42 · completed successfully · workflow run entries';
const GITHUB_REPO_HOME_BODY =
  'Code Issues Pull requests Actions — go to file · main branch · readme';

describe('isVerifierContextRequested', () => {
  it('returns false when context is missing or key is empty', () => {
    expect(isVerifierContextRequested(undefined)).toBe(false);
    expect(isVerifierContextRequested(null)).toBe(false);
    expect(isVerifierContextRequested({})).toBe(false);
    expect(isVerifierContextRequested({ verifierKey: '' })).toBe(false);
  });

  it('returns true for both known and unknown non-empty keys', () => {
    expect(isVerifierContextRequested({ verifierKey: 'github.repo_nav.issues' })).toBe(true);
    expect(isVerifierContextRequested({ verifierKey: 'github.repo_nav.nope' })).toBe(true);
  });
});

describe('isVerifierContextActive', () => {
  it('returns false when context is missing, empty, or key is unknown', () => {
    expect(isVerifierContextActive(undefined)).toBe(false);
    expect(isVerifierContextActive(null)).toBe(false);
    expect(isVerifierContextActive({})).toBe(false);
    expect(isVerifierContextActive({ verifierKey: '' })).toBe(false);
    expect(isVerifierContextActive({ verifierKey: 'nope.not_a_real_key' })).toBe(false);
  });

  it('returns true for all three v1 GitHub repo-nav keys', () => {
    expect(isVerifierContextActive({ verifierKey: 'github.repo_nav.issues' })).toBe(true);
    expect(isVerifierContextActive({ verifierKey: 'github.repo_nav.pull_requests' })).toBe(true);
    expect(isVerifierContextActive({ verifierKey: 'github.repo_nav.actions' })).toBe(true);
  });
});

describe('evaluateClickVerifier (pure)', () => {
  it('issues: URL + role match → passed', () => {
    const result = evaluateClickVerifier(
      { family: 'github', verifierKey: 'github.repo_nav.issues' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/issues',
        title: 'Issues · octocat/hello',
        bodyText: GITHUB_ISSUES_BODY,
      },
    );
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('github.repo_nav.issues');
    expect(result.pageRoleAfter).toBe('issues_list');
    expect(result.beforeUrl).toBe('https://github.com/octocat/hello');
    expect(result.afterUrl).toBe('https://github.com/octocat/hello/issues');
  });

  it('actions: URL + role match → passed', () => {
    const result = evaluateClickVerifier(
      { family: 'github', verifierKey: 'github.repo_nav.actions' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/actions',
        title: 'Actions · octocat/hello',
        bodyText: GITHUB_ACTIONS_BODY,
      },
    );
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('github.repo_nav.actions');
    expect(result.pageRoleAfter).toBe('actions_list');
  });

  it('URL matches but role mismatches → failed with role_mismatch', () => {
    // Brief §10 case 3. The GitHub family adapter decides `pageRole`
    // from URL path, not body, so we use a repo-scoped `/issues/<id>`
    // URL — my verifier's pathRegex still matches (guarding against
    // stale refs that land on a specific issue page), but the adapter's
    // narrow `/^\/issues(?:\/?$|[?#])/` dispatcher does NOT, so it falls
    // through to the legacy fallback (`pageRole: 'unknown'`). That's
    // the realistic "looked like the right destination by URL shape but
    // the page understanding never confirmed it" case.
    const result = evaluateClickVerifier(
      { family: 'github', verifierKey: 'github.repo_nav.issues' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/issues/42',
        title: 'Something is broken · Issue #42 · octocat/hello',
        bodyText: 'Issue 42 comment thread · open · labels · assignees',
      },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('github.repo_nav.issues:role_mismatch');
    expect(result.afterUrl).toBe('https://github.com/octocat/hello/issues/42');
    expect(result.pageRoleAfter).not.toBe('issues_list');
  });

  it('URL does not match the verifier path regex → failed with url_mismatch', () => {
    // Brief §10 case 4 — the SPA stayed on repo_home (verifier was
    // requested for issues, but click did nothing observable).
    const result = evaluateClickVerifier(
      { family: 'github', verifierKey: 'github.repo_nav.issues' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello',
        title: 'octocat/hello',
        bodyText: GITHUB_REPO_HOME_BODY,
      },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('github.repo_nav.issues:url_mismatch');
  });

  it('pull_requests: URL match but pageRoleAfter falls back to "unknown" → fails closed (A3 hardening)', () => {
    // The GitHub family adapter has no `/pulls` branch, so even with
    // a fully-loaded readback (url + title + bodyText all present)
    // `inferPageUnderstanding` will report `pageRole: 'unknown'`.
    // The brief §7 "URL + left repo_home" compromise must NOT accept
    // an `'unknown'` role as evidence that the page successfully left
    // repo_home — `'unknown'` is degraded readback, not a navigation
    // signal. This test pins the fail-closed behaviour so a future
    // refactor cannot silently re-introduce the false-success path.
    const result = evaluateClickVerifier(
      { family: 'github', verifierKey: 'github.repo_nav.pull_requests' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/pulls',
        title: 'Pull requests · octocat/hello',
        bodyText: 'Open Closed Author Label Projects Milestones Reviews',
      },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('github.repo_nav.pull_requests:page_understanding_unavailable');
    expect(result.pageRoleAfter).toBe('unknown');
  });

  it('pull_requests: stable non-degenerate, non-repo_home role → passed (acceptLeftRepoHome happy path)', () => {
    // Synthetic positive case. The GitHub family adapter has no
    // `/pulls` branch, so under real production traffic
    // `inferPageUnderstanding` falls back to `pageRole: 'unknown'`
    // and the verifier fails closed (covered by the test above). To
    // prove the verifier code path can still return `passed: true`
    // when page understanding genuinely resolves to a stable,
    // non-`repo_home`, non-`'unknown'` role, we feed login-shaped
    // body text so `inferLoginRequired` deliberately returns
    // `pageRole: 'login_required'`. As soon as a stable
    // `pull_requests_list` role lands in the GitHub family adapter,
    // rewrite this test to use the real role.
    const result = evaluateClickVerifier(
      { family: 'github', verifierKey: 'github.repo_nav.pull_requests' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/pulls',
        title: 'Login · GitHub',
        bodyText: 'Login to GitHub. Enter your username and password to continue.',
      },
    );
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('github.repo_nav.pull_requests');
    expect(result.pageRoleAfter).toBe('login_required');
  });

  it('pull_requests: incomplete page understanding fails closed', () => {
    const result = evaluateClickVerifier(
      { family: 'github', verifierKey: 'github.repo_nav.pull_requests' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/pulls',
        title: 'Pull requests · octocat/hello',
        bodyText: null,
      },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('github.repo_nav.pull_requests:page_understanding_unavailable');
    expect(result.pageRoleAfter).toBeNull();
  });

  it('pull_requests: repo-home-shaped readback under /pulls URL → fails closed (unknown role)', () => {
    // Same shape as the A3-hardening test above, but with the body
    // text that previously made the adapter fall back through the
    // `'unknown'` branch in a way that used to pass. Now that
    // `'unknown'` is rejected explicitly, this case must also fail
    // closed. If the GitHub family adapter ever gains a `/pulls`
    // branch that emits a stable `pull_requests_list` role, swap the
    // rule to `expectedRole` and rewrite this test.
    const result = evaluateClickVerifier(
      { family: 'github', verifierKey: 'github.repo_nav.pull_requests' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/pulls',
        title: 'octocat/hello',
        bodyText: GITHUB_REPO_HOME_BODY,
      },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('github.repo_nav.pull_requests:page_understanding_unavailable');
    expect(result.pageRoleAfter).toBe('unknown');
  });

  it('unknown verifier key → failed with explicit diagnostic', () => {
    const result = evaluateClickVerifier(
      { verifierKey: 'github.repo_nav.nope' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/issues',
        title: 'Issues · octocat/hello',
        bodyText: GITHUB_ISSUES_BODY,
      },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('verifier_key_unknown:github.repo_nav.nope');
  });

  it('produces the five fields required by brief §5 postClickState projection', () => {
    const result = evaluateClickVerifier(
      { verifierKey: 'github.repo_nav.issues' },
      'https://github.com/octocat/hello',
      {
        url: 'https://github.com/octocat/hello/issues',
        title: 'Issues · octocat/hello',
        bodyText: GITHUB_ISSUES_BODY,
      },
    );
    // These five keys get copied as-is into the public `postClickState`
    // object by interaction.ts (brief §5 minimum required fields).
    expect(Object.keys(result).sort()).toEqual(
      ['passed', 'reason', 'beforeUrl', 'afterUrl', 'pageRoleAfter'].sort(),
    );
  });
});

describe('runClickVerifier (IO wrapper)', () => {
  const mockChrome = globalThis.chrome as unknown as {
    tabs: { get: ReturnType<typeof vi.fn> };
    scripting?: { executeScript: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockChrome.scripting = {
      executeScript: vi.fn(),
    };
  });

  it('returns null when verifier context is inactive (no verifier requested)', async () => {
    // Brief §10 case 1 — caller passes no verifierKey, the whole
    // verifier path must short-circuit with null so interaction.ts keeps
    // the B-023 contract unchanged.
    const promise = runClickVerifier(1, { family: 'github' }, 'https://github.com/a/b');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBeNull();
    expect(mockChrome.tabs.get).not.toHaveBeenCalled();
    expect(mockChrome.scripting!.executeScript).not.toHaveBeenCalled();
  });

  it('reads tab state + injects body-text sample, then passes verifier on match', async () => {
    mockChrome.tabs.get.mockResolvedValueOnce({
      id: 1,
      url: 'https://github.com/octocat/hello/issues',
      title: 'Issues · octocat/hello',
    } as chrome.tabs.Tab);
    mockChrome.scripting!.executeScript.mockResolvedValueOnce([{ result: GITHUB_ISSUES_BODY }]);

    const promise = runClickVerifier(
      1,
      { family: 'github', verifierKey: 'github.repo_nav.issues' },
      'https://github.com/octocat/hello',
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
    expect(result!.reason).toBe('github.repo_nav.issues');
    expect(result!.beforeUrl).toBe('https://github.com/octocat/hello');
    expect(result!.afterUrl).toBe('https://github.com/octocat/hello/issues');
    expect(result!.pageRoleAfter).toBe('issues_list');
    // Brief §9 "at most one compact post-click verification read in the
    // v1 path" — enforce it here so a future refactor can't silently
    // turn this into a poll.
    expect(mockChrome.scripting!.executeScript).toHaveBeenCalledTimes(1);
    expect(mockChrome.tabs.get).toHaveBeenCalledTimes(1);
  });

  it('falls back gracefully when scripting injection throws', async () => {
    mockChrome.tabs.get.mockResolvedValueOnce({
      id: 1,
      url: 'https://github.com/octocat/hello/issues',
      title: 'Issues',
    } as chrome.tabs.Tab);
    mockChrome.scripting!.executeScript.mockRejectedValueOnce(new Error('no permission'));

    const promise = runClickVerifier(
      1,
      { verifierKey: 'github.repo_nav.issues' },
      'https://github.com/octocat/hello',
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    // Verifier must still produce a structured verdict — the caller's
    // `success` should collapse to false, but the tool should not throw.
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.afterUrl).toBe('https://github.com/octocat/hello/issues');
    expect(result!.pageRoleAfter).toBeNull();
  });

  it('pull_requests: scripting failure does not pass via URL-only fallback', async () => {
    mockChrome.tabs.get.mockResolvedValueOnce({
      id: 1,
      url: 'https://github.com/octocat/hello/pulls',
      title: 'Pull requests · octocat/hello',
    } as chrome.tabs.Tab);
    mockChrome.scripting!.executeScript.mockRejectedValueOnce(new Error('no permission'));

    const promise = runClickVerifier(
      1,
      { verifierKey: 'github.repo_nav.pull_requests' },
      'https://github.com/octocat/hello',
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.reason).toBe('github.repo_nav.pull_requests:page_understanding_unavailable');
    expect(result!.afterUrl).toBe('https://github.com/octocat/hello/pulls');
    expect(result!.pageRoleAfter).toBeNull();
  });

  it('returns a structured failure for unknown verifier keys instead of null', async () => {
    mockChrome.tabs.get.mockResolvedValueOnce({
      id: 1,
      url: 'https://github.com/octocat/hello/issues',
      title: 'Issues · octocat/hello',
    } as chrome.tabs.Tab);
    mockChrome.scripting!.executeScript.mockResolvedValueOnce([{ result: GITHUB_ISSUES_BODY }]);

    const promise = runClickVerifier(
      1,
      { verifierKey: 'github.repo_nav.nope' },
      'https://github.com/octocat/hello',
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.reason).toBe('verifier_key_unknown:github.repo_nav.nope');
    expect(result!.afterUrl).toBe('https://github.com/octocat/hello/issues');
  });
});

describe('clickTool integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fails closed with postClickState when verifierKey is unknown', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4105,
      title: 'Repo',
      url: 'https://github.com/octocat/hello',
      windowId: 7,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      dispatchSucceeded: true,
      elementInfo: { tagName: 'A' },
      signals: {
        beforeUnloadFired: false,
        urlBefore: 'https://github.com/octocat/hello',
        urlAfter: 'https://github.com/octocat/hello/issues',
        hashBefore: '',
        hashAfter: '',
        domChanged: false,
        domAddedDialog: false,
        domAddedMenu: false,
        focusChanged: false,
        targetStateDelta: null,
      },
    });
    chrome.tabs.get = vi.fn().mockResolvedValue({
      id: 4105,
      url: 'https://github.com/octocat/hello/issues',
      title: 'Issues · octocat/hello',
      windowId: 7,
    } as chrome.tabs.Tab);
    chrome.scripting.executeScript = vi.fn().mockResolvedValue([{ result: GITHUB_ISSUES_BODY }]);

    const result = await clickTool.execute({
      tabId: 4105,
      selector: '#issues-tab',
      verifierContext: { verifierKey: 'github.repo_nav.nope' },
    } as any);
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.success).toBe(false);
    expect(payload.observedOutcome).toBe('spa_route_change');
    expect(payload.postClickState).toEqual({
      beforeUrl: 'https://github.com/octocat/hello',
      afterUrl: 'https://github.com/octocat/hello/issues',
      pageRoleAfter: 'issues_list',
      verifierPassed: false,
      verifierReason: 'verifier_key_unknown:github.repo_nav.nope',
    });
  });

  /**
   * V23-01: every click response carries an explicit `lane` field so
   * that lane-integrity metrics can detect a future silent fallback to
   * a non-Tabrix browser-control path. The extension-first path is
   * always `tabrix_owned`.
   */
  it('emits lane="tabrix_owned" on the click response (V23-01)', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4106,
      title: 'Repo',
      url: 'https://github.com/octocat/hello',
      windowId: 7,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      dispatchSucceeded: true,
      elementInfo: { tagName: 'A' },
      signals: {
        beforeUnloadFired: false,
        urlBefore: 'https://github.com/octocat/hello',
        urlAfter: 'https://github.com/octocat/hello',
        hashBefore: '',
        hashAfter: '',
        domChanged: true,
        domAddedDialog: false,
        domAddedMenu: false,
        focusChanged: false,
        targetStateDelta: null,
      },
    });

    const result = await clickTool.execute({
      tabId: 4106,
      selector: '#some-button',
    } as any);
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.lane).toBe('tabrix_owned');
  });
});

/**
 * V23-01: window-alignment guard. Before V23-01, the post-dispatch
 * new-tab observation drained 75 ms after the click-helper resolved,
 * but the verifier waited another 250 ms on top — leaving a window
 * where a `_blank` click that opened its tab during the verifier
 * settle delay would be missed by `verification.newTabOpened` even
 * though the verifier itself saw the URL change. The fix exposes one
 * shared constant and consumes it from the click pipeline; this test
 * just pins the contract so a future refactor cannot silently let the
 * windows drift apart again.
 */
describe('V23-01 window alignment', () => {
  it('NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS covers the verifier settle delay', () => {
    expect(NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS).toBeGreaterThanOrEqual(
      CLICK_VERIFIER_SETTLE_DELAY_MS,
    );
  });

  it('CLICK_VERIFIER_SETTLE_DELAY_MS is a positive number', () => {
    expect(typeof CLICK_VERIFIER_SETTLE_DELAY_MS).toBe('number');
    expect(CLICK_VERIFIER_SETTLE_DELAY_MS).toBeGreaterThan(0);
  });
});
