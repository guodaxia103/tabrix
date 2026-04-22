/**
 * Tabrix MKEP Experience write/execute layer (V24-01) — `experience_replay` v1
 * shared contracts.
 *
 * SoT: [`docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md`](../../../docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md)
 * (owner-locked 2026-04-23).
 *
 * Conventions:
 * - Pure types + constants. No IO, no runtime branches.
 * - Mirrors the brief §3 input/output and §6 closed failure-code enum.
 * - Lives in `@tabrix/shared` so the native-server (canonical emitter)
 *   and any future consumer (sidepanel, downstream tooling, e2e tests)
 *   read the same contract.
 *
 * Scope discipline (brief §1 / §2):
 * - Replay re-runs a NAMED existing `actionPathId`. It does not plan,
 *   does not invent steps, does not call back into the upstream LLM
 *   mid-replay.
 * - Fails closed (no autonomous retry, no autonomous re-locator, no
 *   autonomous read-page-and-re-plan).
 * - v1 step-kind allowlist is `chrome_click_element` + `chrome_fill_or_select`.
 * - v1 substitution whitelist is `'queryText' | 'targetLabel'`.
 */

/**
 * Whitelist of legal substitution keys (brief §10 item 4).
 *
 * v1 is intentionally tiny; v2 grows it only after telemetry shows real
 * callers blocked on a specific missing key.
 */
export type TabrixReplayPlaceholder =
  /** primary search/filter text (issue search, file finder) */
  | 'queryText'
  /** a label/tag/state selector value */
  | 'targetLabel';

/** Set form of {@link TabrixReplayPlaceholder} for runtime membership checks. */
export const TABRIX_REPLAY_PLACEHOLDERS: ReadonlySet<TabrixReplayPlaceholder> =
  new Set<TabrixReplayPlaceholder>(['queryText', 'targetLabel']);

/** Strict format for `actionPathId` — matches `experience-aggregator.ts::buildActionPathId`. */
export const TABRIX_EXPERIENCE_REPLAY_ACTION_PATH_ID_PATTERN = /^action_path_[0-9a-f]{64}$/;

/**
 * Maximum chars accepted for `actionPathId`. Brief §3.1.
 *
 * The strict regex above already implies a 64-hex-char body; the cap
 * is a defensive ceiling so the input parser can fail fast on garbage
 * before running the regex.
 */
export const MAX_TABRIX_EXPERIENCE_REPLAY_PATH_ID_CHARS = 256;

/**
 * Maximum number of steps the replay engine will execute under a
 * single MCP call (brief §3.1, §10 item — `MAX_STEP_BUDGET = 16`).
 *
 * A row whose `step_sequence.length` exceeds this cap is
 * `failed-precondition`, NOT "execute the first 16".
 */
export const MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET = 16;

/**
 * Maximum char length per substitution value. Defensive bound; the
 * underlying tool's own input validator (e.g. `chrome_fill_or_select`)
 * is the authoritative limit. We cap here only so a runaway input
 * cannot inflate the substituted args before the per-tool validator
 * sees them.
 */
export const MAX_TABRIX_EXPERIENCE_REPLAY_SUBSTITUTION_VALUE_CHARS = 4096;

/**
 * Tool names allowed inside a replayed `step_sequence` (brief §2 item 2,
 * §6 `unsupported_step_kind`).
 *
 * Adding a value here is a deliberate v2 design decision; the engine
 * carries a strategy-set guard test that fails the build on an
 * unannounced addition.
 */
export const TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS: ReadonlySet<string> = new Set<string>([
  'chrome_click_element',
  'chrome_fill_or_select',
]);

/**
 * `pageRole` values v1 will accept on the row being replayed (brief §2
 * item 6 — GitHub-first). A row whose `pageRole` is not in this set
 * resolves to `non_github_pageRole` `failed-precondition`.
 *
 * Forward-compatible additions are deliberately conservative: we list
 * only roles `read-page-understanding-github.ts` actually emits today.
 */
export const TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES: ReadonlySet<string> = new Set<string>([
  'repo_home',
  'issues_list',
  'issue_detail',
  'pull_requests_list',
  'pull_request_detail',
  'discussion_detail',
  'releases_list',
  'release_notes',
  'wiki',
  'commit_detail',
  'search',
]);

/**
 * Closed failure-code enum (brief §6).
 *
 * The "Where it appears" column maps to either the top-level `result.error`
 * or per-step `evidenceRefs[i].failureCode`. `replay_aborted_by_caller`
 * is reserved for v2's `cancel` channel and is never emitted by v1.
 */
export type TabrixReplayFailureCode =
  // failed-precondition (top-level)
  | 'unknown_action_path'
  | 'step_budget_exceeded'
  | 'unsupported_step_kind'
  | 'page_role_mismatch'
  | 'non_github_pageRole'
  | 'template_field_missing'
  // per-step
  | 'substitution_invalid'
  | 'step_target_not_found'
  | 'step_verifier_red'
  | 'step_dialog_intercepted'
  | 'step_navigation_drift'
  // reserved for v2
  | 'replay_aborted_by_caller'
  // denied
  | 'policy_denied'
  | 'capability_off';

/** Set form of {@link TabrixReplayFailureCode} for runtime guards. */
export const TABRIX_REPLAY_FAILURE_CODES: ReadonlySet<TabrixReplayFailureCode> =
  new Set<TabrixReplayFailureCode>([
    'unknown_action_path',
    'step_budget_exceeded',
    'unsupported_step_kind',
    'page_role_mismatch',
    'non_github_pageRole',
    'template_field_missing',
    'substitution_invalid',
    'step_target_not_found',
    'step_verifier_red',
    'step_dialog_intercepted',
    'step_navigation_drift',
    'replay_aborted_by_caller',
    'policy_denied',
    'capability_off',
  ]);

/**
 * Public input for `experience_replay` (brief §3.1).
 *
 * `variableSubstitutions` keys are constrained to
 * {@link TabrixReplayPlaceholder} at the type level; values are typed
 * strings. The engine additionally checks each requested key against
 * the per-step `templateFields` allowlist captured at aggregator time
 * — an unrequested key is a `failed-precondition`.
 */
export interface TabrixExperienceReplayInput {
  /**
   * The action-path the caller wants replayed. MUST match
   * {@link TABRIX_EXPERIENCE_REPLAY_ACTION_PATH_ID_PATTERN} and be
   * ≤ {@link MAX_TABRIX_EXPERIENCE_REPLAY_PATH_ID_CHARS} chars.
   */
  actionPathId: string;

  /**
   * Optional placeholder substitutions. Keys are the
   * {@link TabrixReplayPlaceholder} whitelist; values are the
   * runtime strings to substitute in. Empty / omitted = replay
   * recorded values verbatim.
   */
  variableSubstitutions?: Partial<Record<TabrixReplayPlaceholder, string>>;

  /**
   * Optional tab. When omitted, the native server picks the active
   * tab in the active window. A `pageRole` mismatch between the
   * chosen tab and the row's `page_role` is a `failed-precondition`
   * (`page_role_mismatch`).
   */
  targetTabId?: number;

  /**
   * Step-budget ceiling, defaults to
   * {@link MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET}. Clamped to
   * `[1, MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET]` at parse time.
   */
  maxSteps?: number;
}

/** Per-step outcome inside {@link TabrixExperienceReplayResult.evidenceRefs}. */
export interface TabrixExperienceReplayStepOutcome {
  /** 0-based index into the recorded plan. */
  stepIndex: number;
  /** Echoed from the recorded step. */
  toolName: string;
  status: 'ok' | 'failed' | 'aborted';
  /** Pointer into Memory; null only when the step failed before any artifact was captured. */
  historyRef: string | null;
  /** Present iff `status !== 'ok'`. Closed enum, see {@link TabrixReplayFailureCode}. */
  failureCode?: TabrixReplayFailureCode;
}

/** Echo block returned alongside per-step outcomes. */
export interface TabrixExperienceReplayResolved {
  actionPathId: string;
  pageRole: string;
  intentSignature: string;
  /** Keys actually substituted into the replay. NEVER echoes the values. */
  appliedSubstitutionKeys: TabrixReplayPlaceholder[];
}

/**
 * Top-level error envelope (brief §3.2). Present iff `status` is one
 * of `'invalid_input' | 'denied' | 'failed-precondition'`.
 */
export interface TabrixExperienceReplayErrorBody {
  /** Closed enum — a {@link TabrixReplayFailureCode} when applicable, plus the parser-side codes below. */
  code: string;
  message: string;
}

/**
 * Public result for `experience_replay` (brief §3.2).
 *
 * `partial` is a TERMINAL state in v1 — there is no resume channel.
 */
export interface TabrixExperienceReplayResult {
  status: 'ok' | 'partial' | 'failed' | 'failed-precondition' | 'invalid_input' | 'denied';
  /**
   * Memory session id (`memory_sessions.session_id`) the replay
   * opened. ALWAYS present for `ok | partial | failed`; absent for
   * the three pre-execution statuses.
   */
  replayId?: string;
  /**
   * Per-step outcomes in execution order. Length ≤ steps actually
   * attempted, which is itself ≤ the recorded `step_sequence.length`.
   */
  evidenceRefs: TabrixExperienceReplayStepOutcome[];
  resolved?: TabrixExperienceReplayResolved;
  error?: TabrixExperienceReplayErrorBody;
}

/**
 * Stable parser error codes (echoed in `result.error.code` when
 * `status === 'invalid_input'`). Distinct from
 * {@link TabrixReplayFailureCode} on purpose: invalid_input means we
 * never even looked at the `actionPathId`; failure codes mean we did.
 */
export type TabrixReplayInvalidInputCode =
  | 'missing_action_path_id'
  | 'invalid_action_path_id'
  | 'invalid_variable_substitutions'
  | 'invalid_substitution_key'
  | 'invalid_substitution_value'
  | 'invalid_max_steps'
  | 'invalid_target_tab_id'
  | 'invalid_input';

/**
 * Optional templatable-field annotation an aggregator may attach to a
 * step inside `step_sequence` JSON (brief §5).
 *
 * v1 only carries the keys; the per-tool input validator on each
 * field decides whether the substituted value is acceptable.
 *
 * Absence of `templateFields` (or an empty array) means the step is
 * NON-templatable — replay uses the captured value verbatim.
 */
export interface TabrixReplayStepTemplateMeta {
  templateFields?: TabrixReplayPlaceholder[];
}
