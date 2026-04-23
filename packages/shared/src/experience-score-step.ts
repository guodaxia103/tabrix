/**
 * Tabrix MKEP Experience write-back layer (V24-02) — `experience_score_step`
 * shared contracts.
 *
 * SoT: `.claude/TABRIX_V2_4_0_PLAN.md` §V24-02 + `.claude/TABRIX_MKEP_FRAMEWORK_V2.md`.
 *
 * Conventions (mirrors `experience-replay.ts`):
 *   - Pure types + constants. No IO, no runtime branches.
 *   - Lives in `@tabrix/shared` so the native-server (canonical
 *     emitter) and any future consumer (sidepanel, downstream
 *     tooling, e2e tests) read the same contract.
 *
 * Scope discipline:
 *   - The tool re-uses the existing `ClickObservedOutcome` enum from
 *     `click.ts`; we deliberately do NOT introduce a parallel outcome
 *     taxonomy.
 *   - The tool re-uses the `experience_replay` capability gate (one
 *     capability governs the whole replay/score-step write-back family
 *     — see `.claude/TABRIX_V2_4_0_PLAN.md` §1.1).
 *   - Failure mode is "isolation + structured warning" (handler maps
 *     write-back I/O failures to the new `experience_writeback_warnings`
 *     table, never to a thrown error that breaks the replay user
 *     path).
 */

import type { ClickObservedOutcome } from './click';

/** Strict format for `actionPathId` — matches the shape from `experience-replay.ts`. */
export const TABRIX_EXPERIENCE_SCORE_STEP_ACTION_PATH_ID_PATTERN = /^action_path_[0-9a-f]{64}$/;

/** Defensive ceiling on `actionPathId` chars (matches replay). */
export const MAX_TABRIX_EXPERIENCE_SCORE_STEP_PATH_ID_CHARS = 256;

/**
 * Defensive ceiling on `stepIndex`. Mirrors the replay step budget so a
 * caller cannot smuggle an unbounded counter through the write-back
 * channel — the persisted Experience row will never have more than
 * {@link MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET} steps anyway.
 */
export const MAX_TABRIX_EXPERIENCE_SCORE_STEP_STEP_INDEX = 16;

/**
 * Defensive ceiling on free-text `evidence.message` chars. Matches
 * `extractErrorSummary` in `experience-replay.ts` (512 cap).
 */
export const MAX_TABRIX_EXPERIENCE_SCORE_STEP_EVIDENCE_MESSAGE_CHARS = 512;

/**
 * Defensive ceiling on `evidence.code` chars. Closed enums elsewhere
 * (`TabrixReplayFailureCode`) are short identifiers; the cap stops
 * pathological input from inflating the warning row.
 */
export const MAX_TABRIX_EXPERIENCE_SCORE_STEP_EVIDENCE_CODE_CHARS = 128;

/** Defensive ceiling on `historyRef` / `replayId` chars. */
export const MAX_TABRIX_EXPERIENCE_SCORE_STEP_REF_CHARS = 256;

/**
 * Closed status enum for the per-step write-back. The mapping rule
 * (`isClickSuccessOutcome`) lives in {@link ClickObservedOutcome};
 * this status is the projection used by the persistence layer
 * (success vs failure delta to the `experience_action_paths`
 * counters).
 */
export type TabrixExperienceScoreStepStatus = 'ok' | 'failed';

/**
 * Public input for `experience_score_step` (one call per replayed step).
 *
 * `replayId` and `historyRef` are forward-compat audit fields; v1
 * does not require them but the writer persists them when present so
 * the `experience_writeback_warnings` table can correlate isolation
 * events back to the originating replay session and step.
 */
export interface TabrixExperienceScoreStepInput {
  /** Action path the replayed step belongs to. */
  actionPathId: string;
  /** 0-based index inside `experience_action_paths.step_sequence`. */
  stepIndex: number;
  /** Re-uses {@link ClickObservedOutcome} — no parallel outcome enum. */
  observedOutcome: ClickObservedOutcome;
  /** Optional Memory `historyRef` for audit correlation. */
  historyRef?: string;
  /** Optional Memory replay session id (`memory_sessions.session_id`). */
  replayId?: string;
  /** Optional structured evidence (failure code + short message). */
  evidence?: {
    code?: string;
    message?: string;
  };
}

/**
 * Top-level error envelope for `experience_score_step` (mirrors the
 * replay envelope shape — `code` is one of
 * {@link TabrixExperienceScoreStepInvalidInputCode} when
 * `status === 'invalid_input'`, or `'capability_off'` when
 * `status === 'denied'`).
 */
export interface TabrixExperienceScoreStepErrorBody {
  code: string;
  message: string;
}

/**
 * Public result shape.
 *
 * `'no_match'` is the success sibling of `'ok'`: the call was
 * accepted, but the supplied `actionPathId` no longer exists (race
 * with deletion / stale id from a long-lived agent loop). The caller
 * should treat it as "we tried and the row is gone", NOT as an
 * invariant violation.
 *
 * `'isolated'` indicates that the underlying SQLite write threw and
 * the handler successfully wrote a structured warning row instead of
 * propagating; the upstream replay path is intentionally insulated.
 */
export interface TabrixExperienceScoreStepResult {
  status: 'ok' | 'no_match' | 'isolated' | 'invalid_input' | 'denied';
  /** Counter delta actually applied (defaults to {0,0} on `'no_match' | 'isolated' | 'invalid_input' | 'denied'`). */
  delta?: {
    successDelta: number;
    failureDelta: number;
  };
  /** Echoed for trace correlation. */
  actionPathId?: string;
  stepIndex?: number;
  observedOutcome?: ClickObservedOutcome;
  /** ISO 8601 timestamp the writer used; absent on the non-ok branches. */
  lastReplayAt?: string;
  /** Persisted status (success vs failure). Absent on non-ok branches. */
  lastReplayStatus?: TabrixExperienceScoreStepStatus;
  /**
   * Set on `'isolated'`. Stable id of the warning row written to
   * `experience_writeback_warnings`. Tests assert presence; consumers
   * may use it to grep correlated logs.
   */
  warningId?: string;
  error?: TabrixExperienceScoreStepErrorBody;
}

/** Stable parser error codes. */
export type TabrixExperienceScoreStepInvalidInputCode =
  | 'missing_action_path_id'
  | 'invalid_action_path_id'
  | 'missing_step_index'
  | 'invalid_step_index'
  | 'missing_observed_outcome'
  | 'invalid_observed_outcome'
  | 'invalid_history_ref'
  | 'invalid_replay_id'
  | 'invalid_evidence'
  | 'invalid_input';

// ---------------------------------------------------------------------------
// Knowledge taskWeights v1
// ---------------------------------------------------------------------------

/**
 * Composite-score component weights. The four axes mirror MKEP §3.2:
 *   - `accuracy`: success_rate-derived signal,
 *   - `speed`: normalized inverse step latency,
 *   - `token`: token-saving (read_page hits avoided / token delta),
 *   - `stability`: variance penalty across recent runs.
 *
 * Weights are deterministic; `composite-score.ts` normalizes them at
 * compute time so `(0.40, 0.20, 0.30, 0.10)` and `(4, 2, 3, 1)` produce
 * the same composite. The baseline matches MKEP §3.2's "default
 * page-role-agnostic mix".
 */
export interface TabrixTaskWeights {
  accuracy: number;
  speed: number;
  token: number;
  stability: number;
}

/**
 * V24-02 baseline / fallback weights. Used when no GitHub-seeded
 * task weight matches (or `siteFamily !== 'github'`). Numbers are
 * the MKEP §3.2 default mix; do NOT tweak without updating MKEP +
 * `composite-score.test.ts` fixtures together.
 */
export const EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS: Readonly<TabrixTaskWeights> =
  Object.freeze({
    accuracy: 0.4,
    speed: 0.2,
    token: 0.3,
    stability: 0.1,
  });

/**
 * GitHub-seeded `taskWeights` for v1. Two entries cover the two
 * highest-volume action-path families MKEP §3.2 calls out:
 *   - `releases/new` (release authoring) — accuracy heavy because a
 *     mis-clicked button can publish a draft.
 *   - `search` (issue / PR / repo search) — token heavy because the
 *     value of replay is mostly avoiding a `read_page` round-trip.
 *
 * Adding a third entry should land alongside a new fixture in
 * `composite-score.test.ts`; this map is deliberately tiny so the
 * read-side `getTaskWeightsFor(...)` stays O(map.size).
 */
export const EXPERIENCE_SCORE_STEP_GITHUB_TASK_WEIGHTS: Readonly<
  Record<string, Readonly<TabrixTaskWeights>>
> = Object.freeze({
  releases_new: Object.freeze({
    accuracy: 0.55,
    speed: 0.15,
    token: 0.2,
    stability: 0.1,
  }),
  search: Object.freeze({
    accuracy: 0.3,
    speed: 0.2,
    token: 0.4,
    stability: 0.1,
  }),
});

/**
 * Recognized site families. v1 only honours `'github'`; everything
 * else short-circuits to {@link EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS}.
 */
export type TabrixTaskWeightsSiteFamily = 'github';

/**
 * Pure read-side resolver. Returns the baseline mix when no override
 * applies; never throws.
 *
 * v1 keying is `pageRole` exact-match within the site family — not a
 * per-intent template — because MKEP §3.2 explicitly bounds v1 to
 * "pageRole grain". The helper deliberately keeps the unknown-key
 * path silent so the chooser hot path (V24-03) does not pay a log
 * cost for every miss.
 */
export function getTaskWeightsFor(
  siteFamily: TabrixTaskWeightsSiteFamily | undefined,
  pageRole: string | undefined,
): Readonly<TabrixTaskWeights> {
  if (siteFamily !== 'github' || !pageRole) return EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS;
  // GitHub `pageRole` tokens use slash-style canonical labels (e.g.
  // `releases/new`); the seed map uses underscore keys to keep the
  // constant identifiers ASCII-clean. Normalize on the read side.
  const key = pageRole.replace(/\//g, '_');
  const seed = EXPERIENCE_SCORE_STEP_GITHUB_TASK_WEIGHTS[key];
  return seed ?? EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS;
}

/**
 * Recency decay half-life in days. `composite-score.ts::applyRecencyDecay`
 * uses `raw * 0.5^(daysSinceRun / EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS)`
 * so a row last replayed 30 days ago weighs half as much as a fresh one.
 */
export const EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS = 30;
