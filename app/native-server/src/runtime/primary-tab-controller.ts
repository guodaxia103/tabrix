/**
 * Primary Tab Controller — runtime tab-hygiene enforcement.
 *
 * Why this exists:
 *   Tabrix originally shipped `scripts/lib/v25-primary-tab-session.cjs`
 *   as a benchmark-runner-only helper. It enforced the "navigate within
 *   a single primary tab" contract for the acceptance suite, but the
 *   production runtime kept the legacy `chrome_navigate({ url })`
 *   behaviour: every multi-site task could open new tabs. The
 *   competitor scorecard (`.claude/strategy/TABRIX_TOOL_METHOD_COMPETI
 *   TOR_SCORECARD_V1.md`) flagged this as the dominant v2.5 reliability
 *   regression vs. competitor browser agents.
 *
 *   This module promotes the contract to a product-side runtime module
 *   so multi-site flows stop leaking tabs. The product-side
 *   adoption is fail-soft (env-gated, see below) — the bridge runtime
 *   snapshot still surfaces the controller's hygiene metrics
 *   regardless of enforcement, so benchmark reports have
 *   evidence to show whether enforcement helped without requiring an
 *   irreversible behaviour flip.
 *
 * Enforcement gate:
 *   `process.env.TABRIX_PRIMARY_TAB_ENFORCE === 'true'` enables
 *   `getInjectedTabId()` to return a non-null value, which
 *   `register-tools.ts` will inject into the `chrome_navigate` args.
 *   When the gate is off (DEFAULT), `getInjectedTabId()` always
 *   returns null and runtime navigation behaviour stays
 *   legacy-compatible except for the additional snapshot fields.
 *
 * What this module does NOT do:
 *   - It does not call `chrome_navigate` itself — the runtime caller
 *     does that. The controller observes the result via
 *     `recordNavigation()` and computes hygiene metrics.
 *   - It does not parse NDJSON.
 *   - It does not own the benchmark runner contract — that stays in
 *     the cjs helper, which is unchanged. The two sources MUST stay
 *     semantically aligned (closed-enum violation kinds, primary-tab
 *     reuse rate definition); the alignment is enforced by tests in
 *     `primary-tab-controller.test.ts` that import the cjs's
 *     `HYGIENE_VIOLATION_KINDS` and assert the TS controller emits the
 *     same string keys.
 *
 * State model (per-process singleton, see `getDefaultPrimaryTabController`):
 *   - `primaryTabId`: integer of the first observed `chrome_navigate`
 *     return tabId. Persists until `reset()`.
 *   - `samePrimaryTabNavigations / expectedPrimaryTabNavigations`:
 *     numerator/denominator for `primaryTabReuseRate`. Allowlisted
 *     navigations are excluded from both. Mirrors the cjs helper.
 *   - `benchmarkOwnedTabCount`: number of distinct tabIds the
 *     controller has observed. The runtime does not track baseline
 *     tabs (those are a benchmark-runner concept), so this counter is
 *     "tabs Tabrix has driven" rather than "tabs the suite created".
 *     The bridge snapshot field name carries the historical spelling for
 *     report-consumer compatibility.
 *   - `violations`: closed-enum kind list (mirrors the cjs).
 */

const HYGIENE_VIOLATION_KIND_VALUES = [
  'unexpected_new_tab',
  'tab_id_changed_after_navigation',
  'forbidden_bare_navigate_retry',
  'cleanup_closed_baseline_tab',
  'cleanup_failed',
] as const;

export type PrimaryTabHygieneViolationKind = (typeof HYGIENE_VIOLATION_KIND_VALUES)[number];

export const HYGIENE_VIOLATION_KINDS: Readonly<{
  UNEXPECTED_NEW_TAB: PrimaryTabHygieneViolationKind;
  TAB_ID_CHANGED: PrimaryTabHygieneViolationKind;
  FORBIDDEN_BARE_RETRY: PrimaryTabHygieneViolationKind;
  CLEANUP_CLOSED_BASELINE: PrimaryTabHygieneViolationKind;
  CLEANUP_FAILED: PrimaryTabHygieneViolationKind;
}> = Object.freeze({
  UNEXPECTED_NEW_TAB: 'unexpected_new_tab',
  TAB_ID_CHANGED: 'tab_id_changed_after_navigation',
  FORBIDDEN_BARE_RETRY: 'forbidden_bare_navigate_retry',
  CLEANUP_CLOSED_BASELINE: 'cleanup_closed_baseline_tab',
  CLEANUP_FAILED: 'cleanup_failed',
});

export interface PrimaryTabHygieneViolation {
  scenarioId: string | null;
  kind: PrimaryTabHygieneViolationKind;
  detail?: string;
}

export interface PrimaryTabControllerSnapshot {
  primaryTabId: number | null;
  primaryTabReuseRate: number | null;
  benchmarkOwnedTabCount: number;
  samePrimaryTabNavigations: number;
  expectedPrimaryTabNavigations: number;
  observedTabIds: number[];
  allowsNewTabScenarioIds: string[];
  violations: PrimaryTabHygieneViolation[];
}

export interface RecordNavigationInput {
  /** The tabId Chrome returned for the navigation. May be null when the call failed. */
  returnedTabId?: number | null;
  /** Optional scenarioId. When present, the controller honours `declareAllowsNewTab` for it. */
  scenarioId?: string | null;
  /**
   * Per-call override of the allowlist. When `true`, the navigation
   * is excluded from the reuse-rate denominator and a non-primary
   * returned tab is tolerated without a violation.
   */
  allowsNewTab?: boolean;
  /**
   * Free-form URL the navigation targeted. Only used to enrich
   * violation `detail` text — never mutated.
   */
  url?: string | null;
}

export interface PrimaryTabControllerOptions {
  /**
   * When true, `getInjectedTabId()` returns the primary tab id once
   * it has been seeded so the caller can pass it through to
   * `chrome_navigate` args. When false (default), the controller is
   * observation-only and the runtime caller keeps legacy navigation behavior.
   *
   * The default is intentionally `false` for fail-soft adoption.
   * Production opt-in flips via `TABRIX_PRIMARY_TAB_ENFORCE=true`.
   */
  enforce?: boolean;
}

export interface PrimaryTabController {
  /**
   * Mark a scenarioId as one whose purpose is to open a new tab.
   * Idempotent; calling twice with the same id is a no-op.
   */
  declareAllowsNewTab(scenarioId: string): void;

  /**
   * Record an observation from a `chrome_navigate` outcome. Does not
   * issue any IO. Updates the controller's bookkeeping (primaryTabId,
   * reuse rate counters, observed-tabs count, violations).
   */
  recordNavigation(input: RecordNavigationInput): void;

  /**
   * If enforcement is on AND a primary tab has been seeded AND the
   * scenario is not allowlisted, returns the primary tabId for the
   * caller to inject into `chrome_navigate({ tabId })`. Otherwise
   * returns `null` so the caller keeps legacy navigation behavior.
   */
  getInjectedTabId(opts?: { scenarioId?: string | null; allowsNewTab?: boolean }): number | null;

  /** Snapshot copy — safe for the bridge state to consume. */
  getSnapshot(): PrimaryTabControllerSnapshot;

  /** Drop all state. Used in tests and at session boundaries. */
  reset(): void;
}

/**
 * Build a fresh controller. Usually you want
 * `getDefaultPrimaryTabController()` (process-wide singleton); this
 * constructor exists for tests and for benchmark runners that need a
 * scoped instance.
 */
export function createPrimaryTabController(
  options: PrimaryTabControllerOptions = {},
): PrimaryTabController {
  const enforce = Boolean(options.enforce);
  let primaryTabId: number | null = null;
  let samePrimaryTabNavigations = 0;
  let expectedPrimaryTabNavigations = 0;
  const observedTabIds = new Set<number>();
  const allowsNewTabScenarioIds = new Set<string>();
  const violations: PrimaryTabHygieneViolation[] = [];

  function isAllowlisted(
    scenarioId: string | null | undefined,
    perCall: boolean | undefined,
  ): boolean {
    if (perCall === true) return true;
    if (typeof scenarioId === 'string' && scenarioId.length > 0) {
      return allowsNewTabScenarioIds.has(scenarioId);
    }
    return false;
  }

  function recordViolation(
    scenarioId: string | null | undefined,
    kind: PrimaryTabHygieneViolationKind,
    detail?: string,
  ): void {
    violations.push({
      scenarioId: typeof scenarioId === 'string' && scenarioId.length > 0 ? scenarioId : null,
      kind,
      ...(typeof detail === 'string' && detail.length > 0 ? { detail } : {}),
    });
  }

  return {
    declareAllowsNewTab(scenarioId: string): void {
      if (typeof scenarioId === 'string' && scenarioId.length > 0) {
        allowsNewTabScenarioIds.add(scenarioId);
      }
    },

    recordNavigation(input: RecordNavigationInput): void {
      const returnedTabId =
        Number.isInteger(input.returnedTabId) && (input.returnedTabId as number) >= 0
          ? (input.returnedTabId as number)
          : null;
      const scenarioId =
        typeof input.scenarioId === 'string' && input.scenarioId.length > 0
          ? input.scenarioId
          : null;
      const allowed = isAllowlisted(scenarioId, input.allowsNewTab);

      if (returnedTabId !== null) {
        observedTabIds.add(returnedTabId);
      }

      if (primaryTabId === null) {
        if (returnedTabId !== null) {
          primaryTabId = returnedTabId;
          if (!allowed) {
            expectedPrimaryTabNavigations += 1;
            samePrimaryTabNavigations += 1;
          }
        }
        return;
      }

      if (allowed) {
        // Allowlisted; do not flip primary, do not count in
        // denominator, do not flag as violation.
        return;
      }

      if (returnedTabId === null) {
        // Navigation produced no tabId — surface as expected +1, same
        // +0 so reuse rate degrades honestly.
        expectedPrimaryTabNavigations += 1;
        return;
      }

      expectedPrimaryTabNavigations += 1;
      if (returnedTabId === primaryTabId) {
        samePrimaryTabNavigations += 1;
        return;
      }

      // Non-allowlisted mismatch — record a hygiene violation. The
      // runtime controller does NOT auto-retry (that is the runtime
      // caller's responsibility, mirroring the runner contract);
      // it just observes.
      const detail =
        `chrome_navigate returned tabId=${returnedTabId} but primaryTabId=${primaryTabId}` +
        (typeof input.url === 'string' && input.url.length > 0 ? ` (url=${input.url})` : '');
      recordViolation(scenarioId, HYGIENE_VIOLATION_KINDS.TAB_ID_CHANGED, detail);
    },

    getInjectedTabId(
      opts: { scenarioId?: string | null; allowsNewTab?: boolean } = {},
    ): number | null {
      if (!enforce) return null;
      if (primaryTabId === null) return null;
      if (isAllowlisted(opts.scenarioId, opts.allowsNewTab)) return null;
      return primaryTabId;
    },

    getSnapshot(): PrimaryTabControllerSnapshot {
      const reuse =
        expectedPrimaryTabNavigations > 0
          ? samePrimaryTabNavigations / expectedPrimaryTabNavigations
          : null;
      return {
        primaryTabId,
        primaryTabReuseRate: reuse,
        benchmarkOwnedTabCount: observedTabIds.size,
        samePrimaryTabNavigations,
        expectedPrimaryTabNavigations,
        observedTabIds: [...observedTabIds].sort((a, b) => a - b),
        allowsNewTabScenarioIds: [...allowsNewTabScenarioIds].sort((a, b) => a.localeCompare(b)),
        violations: violations.map((v) => ({ ...v })),
      };
    },

    reset(): void {
      primaryTabId = null;
      samePrimaryTabNavigations = 0;
      expectedPrimaryTabNavigations = 0;
      observedTabIds.clear();
      allowsNewTabScenarioIds.clear();
      violations.length = 0;
    },
  };
}

let defaultController: PrimaryTabController | null = null;

/**
 * Process-wide singleton. The first call seeds the instance; later
 * calls return the same instance. The enforcement flag is read from
 * `process.env.TABRIX_PRIMARY_TAB_ENFORCE` lazily on first call so
 * tests can flip the env var before touching the singleton.
 *
 * For tests, prefer `createPrimaryTabController({ enforce })` to
 * avoid stomping the singleton; if you must touch the singleton,
 * call `resetDefaultPrimaryTabController()` afterwards.
 */
export function getDefaultPrimaryTabController(): PrimaryTabController {
  if (defaultController === null) {
    defaultController = createPrimaryTabController({
      enforce: process.env.TABRIX_PRIMARY_TAB_ENFORCE === 'true',
    });
  }
  return defaultController;
}

/**
 * Drop the singleton. Tests use this to ensure isolation; production
 * code should never need to call this.
 */
export function resetDefaultPrimaryTabController(): void {
  defaultController = null;
}
