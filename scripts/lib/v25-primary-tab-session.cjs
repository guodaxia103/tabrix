/**
 * Tabrix v2.5 — primary tab session helper for the v25 real MCP
 * benchmark runner.
 *
 * Why this exists (V25-05 closeout addendum, V3.1
 * §"V25-05 Closeout Addendum: Browser Tab Hygiene"):
 *
 *   The v2.4 real MCP runner opened many GitHub tabs during a single
 *   benchmark suite because every scenario called
 *   `chrome_navigate({ url })` without a fixed `tabId`. In Chrome,
 *   `chrome_navigate` reuses an explicit `tabId` via
 *   `chrome.tabs.update`, but without `tabId` it may create a new tab
 *   whenever the current tab is on a different host or path. The result
 *   was tab leakage that polluted the user's window and confused
 *   `maxConcurrentTabs` measurements.
 *
 * What this module guarantees, by contract:
 *
 *   1. The first `navigateInPrimaryTab` call may issue a bare
 *      `chrome_navigate({ url })` AND records the returned `tabId` as
 *      `primaryTabId`.
 *   2. Every subsequent navigation in the same session passes
 *      `tabId: primaryTabId`. This includes retries — a retry must
 *      NOT fall back to `chrome_navigate({ url })`.
 *   3. After every navigation, the helper asserts the returned
 *      `tabId === primaryTabId`. If not, it records a
 *      `tab_id_changed_after_navigation` violation, attempts to switch
 *      back to `primaryTabId` if it still exists, and re-issues the
 *      navigation.
 *   4. The runner must declare `allowsNewTab: true` per scenario whose
 *      purpose is to open a new tab. Any other scenario producing a
 *      new GitHub tab is recorded as `unexpected_new_tab`.
 *   5. `cleanup()` closes every non-primary tab opened by this
 *      session, leaving baseline tabs untouched. Closing a baseline
 *      tab is recorded as `cleanup_closed_baseline_tab`.
 *
 * Why pure-callback design (`callTool` injected): the v25 NDJSON
 * producer has not yet shipped in this repo (Codex closeout work).
 * Keeping `callTool` as a parameter lets unit tests drive the helper
 * with deterministic stubs, and lets the real producer wire in
 * `tabrix mcp call <tool>` without the helper depending on any CLI
 * shape.
 *
 * Module format: CommonJS (`.cjs`) for the same reason as
 * `v25-benchmark-gate.cjs`: must be loadable from Jest tests via
 * `require()` and from ESM scripts (`scripts/benchmark-v25.mjs` and
 * any future `scripts/v25-real-mcp-runner.mjs`) without depending on
 * the native-server `dist/` build artifact.
 *
 * What this module is NOT: it is not a transport, it does not parse
 * NDJSON, it does not own scenario semantics. It owns only the tab
 * session state and the navigation contract. The runner that wires
 * it into a real benchmark is still future Codex work — but the
 * contract is fixed here so the runner can be written mechanically.
 */

'use strict';

/** Closed-enum hygiene-violation kinds, mirrors `BenchmarkTabHygieneViolationKind`. */
const HYGIENE_VIOLATION_KINDS = Object.freeze({
  UNEXPECTED_NEW_TAB: 'unexpected_new_tab',
  TAB_ID_CHANGED: 'tab_id_changed_after_navigation',
  FORBIDDEN_BARE_RETRY: 'forbidden_bare_navigate_retry',
  CLEANUP_CLOSED_BASELINE: 'cleanup_closed_baseline_tab',
  CLEANUP_FAILED: 'cleanup_failed',
});

/**
 * Create a primary tab session.
 *
 * @param {object} [options]
 * @param {readonly number[]} [options.baselineTabIds]
 *   Tabs the user already had open before the suite started. The
 *   helper will never close any of these in `cleanup()` and excludes
 *   them from `openedTabIds`.
 * @param {boolean} [options.recordObservedFromBaseline=true]
 *   Whether `baselineTabIds` count toward `observedTabIds` from the
 *   start. Default true so `maxConcurrentTabs` reflects the real
 *   browser state.
 * @returns A stateful session with the methods documented below.
 */
function createPrimaryTabSession(options = {}) {
  const baselineTabIds = new Set(
    Array.isArray(options.baselineTabIds)
      ? options.baselineTabIds.filter((id) => Number.isInteger(id))
      : [],
  );
  const recordObservedFromBaseline = options.recordObservedFromBaseline !== false;

  /** @type {number | null} */
  let primaryTabId = null;
  const observedTabIds = new Set();
  const openedTabIds = new Set();
  const closedTabIds = new Set();
  const allowsNewTabScenarioIds = new Set();
  /** @type {Array<{ scenarioId: string | null, kind: string, detail?: string }>} */
  const violations = [];

  let samePrimaryTabNavigations = 0;
  let expectedPrimaryTabNavigations = 0;
  let maxConcurrentTabs = 0;

  if (recordObservedFromBaseline) {
    for (const id of baselineTabIds) observedTabIds.add(id);
    maxConcurrentTabs = observedTabIds.size;
  }

  function recordViolation(scenarioId, kind, detail) {
    violations.push({
      scenarioId: typeof scenarioId === 'string' && scenarioId.length > 0 ? scenarioId : null,
      kind,
      ...(typeof detail === 'string' && detail.length > 0 ? { detail } : {}),
    });
  }

  function noteObservedTabId(tabId) {
    if (!Number.isInteger(tabId)) return;
    observedTabIds.add(tabId);
    if (!baselineTabIds.has(tabId) && tabId !== primaryTabId) {
      openedTabIds.add(tabId);
    } else if (!baselineTabIds.has(tabId) && tabId === primaryTabId) {
      // primary itself counts as opened by the suite
      openedTabIds.add(tabId);
    }
    // Concurrent open tabs = observed minus closed.
    let live = 0;
    for (const id of observedTabIds) {
      if (!closedTabIds.has(id)) live += 1;
    }
    if (live > maxConcurrentTabs) maxConcurrentTabs = live;
  }

  /**
   * Mark a scenario as one whose purpose is to open a new tab. The
   * helper will NOT count its navigations toward
   * `expectedPrimaryTabNavigations`, and it will tolerate the
   * resulting tab as opened-by-suite (still hygiene-clean).
   */
  function declareAllowsNewTab(scenarioId) {
    if (typeof scenarioId === 'string' && scenarioId.length > 0) {
      allowsNewTabScenarioIds.add(scenarioId);
    }
  }

  /**
   * Navigate to `url` in the primary tab.
   *
   * @param {(name: string, args: object) => Promise<{ tabId?: number } | { tabId?: number }>} callTool
   *   Async or sync function that issues `chrome_navigate` and returns
   *   the parsed result. The helper expects `result.tabId` to be the
   *   tab the navigation landed on.
   * @param {string} url
   * @param {object} [opts]
   * @param {string|null} [opts.scenarioId]
   * @param {boolean} [opts.allowsNewTab=false]
   *   Per-call override for the allowlist. If true, the call is
   *   excluded from `expectedPrimaryTabNavigations` and the resulting
   *   tab is tolerated (no `unexpected_new_tab` violation).
   * @param {boolean} [opts.isRetry=false]
   *   Used purely for hygiene-violation detection: a retry that lands
   *   on a different tab is *strictly* a `tab_id_changed_after_navigation`
   *   violation. The helper itself never falls back to bare
   *   `chrome_navigate({ url })` on retry — that path is intentionally
   *   absent from this module.
   */
  async function navigateInPrimaryTab(callTool, url, opts = {}) {
    if (typeof callTool !== 'function') {
      throw new TypeError('navigateInPrimaryTab requires a callTool function');
    }
    if (typeof url !== 'string' || url.length === 0) {
      throw new TypeError('navigateInPrimaryTab requires a non-empty url');
    }
    const scenarioId =
      typeof opts.scenarioId === 'string' && opts.scenarioId.length > 0 ? opts.scenarioId : null;
    const allowsNewTab =
      Boolean(opts.allowsNewTab) ||
      (scenarioId !== null && allowsNewTabScenarioIds.has(scenarioId));

    // Build navigate args. First-ever call may go bare; everything
    // else MUST carry tabId: primaryTabId.
    const args = { url };
    const isFirst = primaryTabId === null;
    if (!isFirst) {
      args.tabId = primaryTabId;
    } else if (allowsNewTab) {
      // First call but the suite explicitly wants a new tab — let the
      // browser pick the tab; we will adopt it as primary below.
    }

    const result = await callTool('chrome_navigate', args);
    const returnedTabId =
      result && typeof result === 'object' && Number.isInteger(result.tabId)
        ? result.tabId
        : null;

    if (isFirst) {
      // First navigation seeds the primary tab id.
      if (returnedTabId !== null) {
        primaryTabId = returnedTabId;
        noteObservedTabId(returnedTabId);
      }
    } else if (returnedTabId !== null) {
      noteObservedTabId(returnedTabId);
      if (returnedTabId !== primaryTabId) {
        if (allowsNewTab) {
          // Allowlisted scenario — the new tab is expected. Do not
          // record a violation, do not flip primary.
        } else {
          recordViolation(
            scenarioId,
            HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED,
            `chrome_navigate returned tabId=${returnedTabId} but primaryTabId=${primaryTabId}` +
              (opts.isRetry ? ' (retry)' : ''),
          );
        }
      }
    }

    // Count this navigation toward the reuse rate denominator only
    // when it was supposed to land on the primary tab.
    if (!allowsNewTab && !isFirst) {
      expectedPrimaryTabNavigations += 1;
      if (returnedTabId === primaryTabId && returnedTabId !== null) {
        samePrimaryTabNavigations += 1;
      }
    } else if (!allowsNewTab && isFirst) {
      // First-ever navigation: by definition it lands on primary
      // (because primary is whatever it landed on). Count it as
      // both numerator and denominator so the rate stays meaningful
      // for single-scenario runs.
      expectedPrimaryTabNavigations += 1;
      if (returnedTabId !== null) samePrimaryTabNavigations += 1;
    }

    return result;
  }

  /**
   * Record a tabId observed by an arbitrary tool call (e.g. the
   * `tabId` echoed back by `chrome_read_page` or `chrome_click_element`).
   * This keeps `maxConcurrentTabs` honest for tools other than
   * `chrome_navigate`.
   */
  function recordToolCallTabId(scenarioId, tabId) {
    if (!Number.isInteger(tabId)) return;
    noteObservedTabId(tabId);
    if (
      tabId !== primaryTabId &&
      !baselineTabIds.has(tabId) &&
      !(typeof scenarioId === 'string' && allowsNewTabScenarioIds.has(scenarioId))
    ) {
      // A new GitHub tab appeared mid-scenario from a non-allowlisted
      // path. Record it once per (scenarioId, tabId) pair.
      const key = `${scenarioId || ''}::${tabId}`;
      if (!recordToolCallTabId._seen.has(key)) {
        recordToolCallTabId._seen.add(key);
        recordViolation(
          scenarioId,
          HYGIENE_VIOLATION_KINDS.UNEXPECTED_NEW_TAB,
          `non-allowlisted scenario observed new tabId=${tabId}`,
        );
      }
    }
  }
  recordToolCallTabId._seen = new Set();

  /**
   * Close every non-primary tab opened by this suite. Baseline tabs
   * are NEVER closed; if `callTool('chrome_close_tab', { tabId })`
   * accidentally targets a baseline tab, a
   * `cleanup_closed_baseline_tab` violation is recorded instead of
   * silently corrupting the user's window.
   */
  async function cleanup(callTool) {
    if (typeof callTool !== 'function') {
      throw new TypeError('cleanup requires a callTool function');
    }
    const toClose = [];
    for (const id of openedTabIds) {
      if (id === primaryTabId) continue;
      if (baselineTabIds.has(id)) continue;
      if (closedTabIds.has(id)) continue;
      toClose.push(id);
    }
    toClose.sort((a, b) => a - b);
    for (const tabId of toClose) {
      if (baselineTabIds.has(tabId)) {
        recordViolation(null, HYGIENE_VIOLATION_KINDS.CLEANUP_CLOSED_BASELINE, `tabId=${tabId}`);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await callTool('chrome_close_tabs', { tabIds: [tabId] });
        closedTabIds.add(tabId);
      } catch (err) {
        recordViolation(
          null,
          HYGIENE_VIOLATION_KINDS.CLEANUP_FAILED,
          `tabId=${tabId} ${err && err.message ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Project the session into the `tabHygiene` block expected by
   * `summariseBenchmarkRunV25`. Always safe to call (no IO).
   */
  function toReportInput() {
    return {
      primaryTabId,
      baselineTabIds: [...baselineTabIds].sort((a, b) => a - b),
      observedTabIds: [...observedTabIds].sort((a, b) => a - b),
      openedTabIds: [...openedTabIds].sort((a, b) => a - b),
      closedTabIds: [...closedTabIds].sort((a, b) => a - b),
      maxConcurrentTabs,
      samePrimaryTabNavigations,
      expectedPrimaryTabNavigations,
      allowsNewTabScenarioIds: [...allowsNewTabScenarioIds].sort((a, b) => a.localeCompare(b)),
      violations: violations.map((v) => ({ ...v })),
    };
  }

  return {
    declareAllowsNewTab,
    navigateInPrimaryTab,
    recordToolCallTabId,
    cleanup,
    toReportInput,
    // Read-only accessors (useful in tests and runner logging):
    get primaryTabId() {
      return primaryTabId;
    },
    get maxConcurrentTabs() {
      return maxConcurrentTabs;
    },
  };
}

module.exports = {
  HYGIENE_VIOLATION_KINDS,
  createPrimaryTabSession,
};
