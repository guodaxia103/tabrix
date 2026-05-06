/**
 * Shared click contract.
 *
 * `chrome_click_element` emits these fields as part of its tool response.
 * The shape is versioned informally via the `observedOutcome` enum below —
 * adding a new value is a minor compatible change, removing one is not.
 *
 * See `docs/CLICK_CONTRACT_REPAIR_V1.md` for the design and
 * `docs/PRODUCT_BACKLOG.md` for the schema-cite rationale.
 */

/**
 * Outcome categories produced by merging page-local and browser-level
 * signals. Values are stable; treat this union as a public enum for MCP
 * consumers.
 *
 * "Success-like" outcomes: `cross_document_navigation`, `spa_route_change`,
 * `hash_change`, `new_tab_opened`, `dialog_opened`, `menu_opened`,
 * `state_toggled`, `selection_changed`, `dom_changed`, `focus_changed`,
 * `download_intercepted`.
 *
 * "Not-a-success" outcomes: `no_observed_change`, `verification_unavailable`.
 */
export type ClickObservedOutcome =
  | 'cross_document_navigation'
  | 'spa_route_change'
  | 'hash_change'
  | 'new_tab_opened'
  | 'dialog_opened'
  | 'menu_opened'
  | 'state_toggled'
  | 'selection_changed'
  | 'dom_changed'
  | 'focus_changed'
  | 'download_intercepted'
  | 'no_observed_change'
  | 'verification_unavailable';

/**
 * The full closed enum as a runtime tuple. Consumers (e.g. the
 * `experience_score_step` parser) build a Set from this for O(1)
 * membership checks. Keep in lockstep with {@link ClickObservedOutcome}
 * — the unit test in `click.test.ts` enforces parity.
 */
export const CLICK_OBSERVED_OUTCOMES: readonly ClickObservedOutcome[] = [
  'cross_document_navigation',
  'spa_route_change',
  'hash_change',
  'new_tab_opened',
  'dialog_opened',
  'menu_opened',
  'state_toggled',
  'selection_changed',
  'dom_changed',
  'focus_changed',
  'download_intercepted',
  'no_observed_change',
  'verification_unavailable',
];

/**
 * Raw evidence booleans, kept separate from the verdict so that callers
 * who disagree with Tabrix's outcome mapping can build their own view.
 */
export interface ClickVerification {
  /** `beforeunload` fired on the origin page within the verification window. */
  navigationOccurred: boolean;
  /** `location.href` string value differs between pre- and post-click snapshots. */
  urlChanged: boolean;
  /** `chrome.tabs.onCreated` fired for the origin window during the verification window. */
  newTabOpened: boolean;
  /** MutationObserver saw any childList/attribute change on body during the window. */
  domChanged: boolean;
  /**
   * Any of the target's control-state attributes changed:
   * `checked`, `value`, `aria-expanded`, `aria-selected`, `open`, `disabled`.
   */
  stateChanged: boolean;
  /** `document.activeElement` differs between pre- and post-click snapshots. */
  focusChanged: boolean;
}

/**
 * The JSON shape returned by `chrome_click_element`.
 *
 * Callers MUST prefer `success` + `observedOutcome` over `navigationOccurred`.
 * `navigationOccurred` is kept as a one-release compat field; it equals
 * `verification.navigationOccurred`.
 *
 * The `intercepted-download` fast-path has a different shape and is
 * intentionally not unified into this type in v1.
 */
export interface ClickToolResult {
  /** `true` iff `observedOutcome` is a success-like outcome. */
  success: boolean;
  /** `true` iff the click-helper found a target and dispatched the click path. */
  dispatchSucceeded: boolean;
  /** The merged verdict from page-local + browser-level signals. */
  observedOutcome: ClickObservedOutcome;
  verification: ClickVerification;
  /** One-release compat alias for `verification.navigationOccurred`. */
  navigationOccurred: boolean;
  /** `'ref' | 'selector' | 'coordinates' | 'intercepted-download' | …` */
  clickMethod?: string;
  message?: string;
  elementInfo?: unknown;
}

/**
 * The set of values in `ClickObservedOutcome` that count as
 * "success-like". Kept in one place so both the extension's
 * merge function and downstream consumers agree.
 */
export const CLICK_SUCCESS_OUTCOMES: readonly ClickObservedOutcome[] = [
  'cross_document_navigation',
  'spa_route_change',
  'hash_change',
  'new_tab_opened',
  'dialog_opened',
  'menu_opened',
  'state_toggled',
  'selection_changed',
  'dom_changed',
  'focus_changed',
  'download_intercepted',
];

export function isClickSuccessOutcome(outcome: ClickObservedOutcome): boolean {
  return CLICK_SUCCESS_OUTCOMES.includes(outcome);
}
