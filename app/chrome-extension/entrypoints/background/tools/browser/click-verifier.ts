/**
 * B-024 (Click V2 · verifier hook v1).
 *
 * Narrow, surgical addition on top of the B-023 click contract.
 *
 * The generic click pipeline in `interaction.ts` (B-023) already merges
 * page-local + browser-level signals into `observedOutcome` + `success`.
 * That answers "what changed". It does NOT answer "did the user reach the
 * intended destination".
 *
 * This module adds one more optional stage: a family-aware post-click
 * verifier. For v1 it only covers three GitHub repo-nav flows. It is
 * explicitly NOT a general-purpose verifier framework; adding another
 * family / site / verifier key means expanding this file and the lookup
 * table, not wiring through new abstractions.
 *
 * Scope follows `docs/CLICK_V2_EXECUTION_BRIEF_V1.md`:
 *   - verifier keys covered in v1: github.repo_nav.issues,
 *     github.repo_nav.pull_requests, github.repo_nav.actions
 *   - at most ONE compact readback per verifier invocation
 *   - no hidden retry loops
 *   - no side effects on the click contract when verifier not requested
 */
import { inferPageUnderstanding } from './read-page-understanding';

/**
 * Hint the caller passes to opt into a verifier run.
 *
 * Kept intentionally tiny. `verifierKey` is the only lookup key; `family`
 * is informational today but reserved so that future additions (non-GitHub
 * sites) can coexist without renaming.
 */
export interface ClickVerifierContext {
  family?: 'github';
  verifierKey?: string;
}

/**
 * Pure-data snapshot of the page state the verifier observed AFTER the
 * click settled. Fed into `evaluateClickVerifier`.
 *
 * `url` / `title` / `bodyText` come from the real browser in
 * `runClickVerifier`. `bodyText` is a small sample (capped in the IO
 * wrapper) — NOT the full DOM. The verifier must survive with a truncated
 * sample.
 */
export interface ClickPostClickReadback {
  url: string | null;
  title: string | null;
  bodyText: string | null;
}

/**
 * Verdict produced by the verifier.
 *
 * This is the pure-function output. `interaction.ts` projects a subset of
 * it into the public `postClickState` field. Keeping `pageRoleBefore`
 * here makes the unit tests readable even though we do not currently
 * expose it in the public contract (brief §5 only requires five fields).
 */
export interface ClickVerifierResult {
  passed: boolean;
  reason: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  pageRoleAfter: string | null;
}

interface VerifierRule {
  pathRegex: RegExp;
  expectedRole: string | null;
  /**
   * When true, the rule passes as long as the URL matches AND the page is
   * no longer on the source role (`repo_home`). Used only for
   * `pull_requests` where we do not currently emit a stable `pull_requests_list`
   * role — see brief §7 "If the role for pull requests is not currently
   * stable, URL + 'left repo_home' is acceptable".
   */
  acceptLeftRepoHome?: boolean;
}

/**
 * V1 verifier key lookup table.
 *
 * Path regexes are anchored against `URL.pathname` (not the raw href) to
 * avoid getting fooled by `?query` / `#hash`. They only match repo-scoped
 * paths (`/<owner>/<repo>/<tab>`) so that GitHub's global `/issues` list
 * does not accidentally satisfy the repo-nav verifier.
 */
const GITHUB_VERIFIER_RULES: Record<string, VerifierRule> = {
  'github.repo_nav.issues': {
    pathRegex: /^\/[^/]+\/[^/]+\/issues(?:\/|$)/,
    expectedRole: 'issues_list',
  },
  'github.repo_nav.pull_requests': {
    pathRegex: /^\/[^/]+\/[^/]+\/pulls(?:\/|$)/,
    expectedRole: null,
    acceptLeftRepoHome: true,
  },
  'github.repo_nav.actions': {
    pathRegex: /^\/[^/]+\/[^/]+\/actions(?:\/|$)/,
    expectedRole: 'actions_list',
  },
};

function parsePathname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * Pure, side-effect-free verifier evaluation.
 *
 * All tests target this function directly (see
 * `tests/click-verifier.test.ts`). The IO wrapper
 * `runClickVerifier` only feeds it `beforeUrl` + `readback` and forwards
 * the verdict.
 */
export function evaluateClickVerifier(
  ctx: ClickVerifierContext,
  beforeUrl: string | null,
  readback: ClickPostClickReadback,
): ClickVerifierResult {
  const afterUrl = readback.url ?? null;

  const pageRoleAfter =
    readback.url && readback.title != null && readback.bodyText != null
      ? (inferPageUnderstanding(readback.url, readback.title, readback.bodyText).pageRole ?? null)
      : null;

  const key = ctx.verifierKey ?? '';
  const rule = GITHUB_VERIFIER_RULES[key];
  if (!rule) {
    return {
      passed: false,
      reason: `verifier_key_unknown:${key || '(none)'}`,
      beforeUrl,
      afterUrl,
      pageRoleAfter,
    };
  }

  const afterPath = parsePathname(afterUrl);
  const urlMatches = afterPath != null && rule.pathRegex.test(afterPath);

  if (!urlMatches) {
    return {
      passed: false,
      reason: `${key}:url_mismatch`,
      beforeUrl,
      afterUrl,
      pageRoleAfter,
    };
  }

  if (rule.expectedRole != null) {
    if (pageRoleAfter !== rule.expectedRole) {
      return {
        passed: false,
        reason: `${key}:role_mismatch`,
        beforeUrl,
        afterUrl,
        pageRoleAfter,
      };
    }
    return { passed: true, reason: key, beforeUrl, afterUrl, pageRoleAfter };
  }

  if (rule.acceptLeftRepoHome) {
    if (pageRoleAfter === 'repo_home') {
      return {
        passed: false,
        reason: `${key}:still_on_repo_home`,
        beforeUrl,
        afterUrl,
        pageRoleAfter,
      };
    }
    return { passed: true, reason: key, beforeUrl, afterUrl, pageRoleAfter };
  }

  return {
    passed: false,
    reason: `${key}:rule_incomplete`,
    beforeUrl,
    afterUrl,
    pageRoleAfter,
  };
}

export function isVerifierContextActive(ctx: ClickVerifierContext | undefined | null): boolean {
  if (!isVerifierContextRequested(ctx)) return false;
  const key = ctx?.verifierKey;
  if (typeof key !== 'string' || key.length === 0) return false;
  return Object.prototype.hasOwnProperty.call(GITHUB_VERIFIER_RULES, key);
}

/**
 * Returns true when the caller explicitly asked for post-click verification,
 * regardless of whether the key is known. Unknown keys should fail closed
 * with a structured diagnostic, not silently disable the verifier path.
 */
export function isVerifierContextRequested(ctx: ClickVerifierContext | undefined | null): boolean {
  if (!ctx) return false;
  const key = ctx.verifierKey;
  return typeof key === 'string' && key.length > 0;
}

/**
 * Body text sample cap. Intentionally tight — the goal is just to give
 * `inferPageUnderstanding` enough anchor strings, not to reconstruct the
 * full page. 20 KiB is comparable to the compact mode of `read_page`.
 */
const BODY_SAMPLE_MAX_CHARS = 20_000;

/**
 * Milliseconds to wait before sampling the post-click state. Gives SPA
 * route changes a chance to settle without introducing a retry loop.
 *
 * The brief says at most ONE compact readback in v1, so we do NOT poll
 * for pageRole convergence here — if this fixed wait is too short for a
 * slow SPA, the verifier fails honestly rather than hiding the cost.
 */
const SETTLE_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function readPostClickSnapshot(tabId: number): Promise<ClickPostClickReadback> {
  let tab: chrome.tabs.Tab | null = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { url: null, title: null, bodyText: null };
  }

  const url = typeof tab?.url === 'string' ? tab.url : null;
  const title = typeof tab?.title === 'string' ? tab.title : null;

  let bodyText: string | null = null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (maxChars: number) => {
        try {
          const raw = (document.body && document.body.innerText) || '';
          return typeof raw === 'string' ? raw.slice(0, maxChars) : '';
        } catch {
          return '';
        }
      },
      args: [BODY_SAMPLE_MAX_CHARS],
    });
    const result = injection?.result;
    bodyText = typeof result === 'string' ? result : null;
  } catch {
    bodyText = null;
  }

  return { url, title, bodyText };
}

/**
 * IO wrapper. Does at most one settle delay + one readback, then delegates
 * to the pure evaluator. Returns `null` only for defensive infra failures
 * (caller treats that as "verifier requested but could not run").
 */
export async function runClickVerifier(
  tabId: number,
  ctx: ClickVerifierContext,
  beforeUrl: string | null,
): Promise<ClickVerifierResult | null> {
  if (!isVerifierContextRequested(ctx)) {
    return null;
  }
  try {
    await delay(SETTLE_DELAY_MS);
    const readback = await readPostClickSnapshot(tabId);
    return evaluateClickVerifier(ctx, beforeUrl, readback);
  } catch {
    return null;
  }
}
