/**
 * Chooser-side replay eligibility + ranking helpers.
 *
 * Lives in its own module so:
 *   - the `chooseContextStrategy` pure layer stays tiny and easy to
 *     audit,
 *   - tests can exercise the eligibility / ranking matrix without
 *     standing up the full IO orchestrator,
 *   - the per-tool portable allowlist (`extractPortableReplayArgs`)
 *     is consumed from exactly one place on the chooser side and
 *     stays in lock-step with the aggregator's persisted contract.
 *
 * Both helpers are pure functions: no IO, no clock side-effects (the
 * caller passes `nowIso`), no logging. The chooser pays one read of
 * `experience.suggestActionPaths`; everything below is in-memory math
 * over the rows we already have.
 *
 * Failure-mode contract:
 *   - {@link isReplayEligible} returns the FIRST blocker in
 *     {@link ReplayEligibilityBlockReason} order so the chooser's
 *     `replayEligibleBlockedBy` post-mortem field is stable across
 *     runs (multiple blockers → one stable label, not "the random
 *     one we noticed first").
 *   - {@link rankExperienceCandidates} keeps ineligible rows in the
 *     ranked list with `replayEligible: false` + their blocker so
 *     telemetry can group "we had a candidate but blocked it"; only
 *     candidates whose composite score is finite survive (rows with
 *     0/0 counters AND no decayed cache return score 0 and rank
 *     last, but they DO appear).
 */

import {
  EXPERIENCE_RANKED_TOP_N,
  EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT,
  EXPERIENCE_REPLAY_MIN_SUCCESS_RATE,
  TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES,
  TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS,
  getTaskWeightsFor,
  type ReplayEligibilityBlockReason,
  type TabrixChooseContextRankedCandidate,
  type TabrixTaskWeights,
} from '@tabrix/shared';
import {
  applyRecencyDecay,
  computeRawComposite,
  projectCompositeComponents,
} from '../memory/experience/composite-score';
import type { ExperienceActionPathRow } from '../memory/experience/experience-repository';
import { extractPortableReplayArgs } from './experience-replay-args';

export interface ReplayEligibilityResult {
  eligible: boolean;
  blockedBy?: ReplayEligibilityBlockReason;
}

/**
 * Single-row eligibility check. Returns the FIRST blocker in the closed
 * {@link ReplayEligibilityBlockReason} order so post-mortem grouping is
 * deterministic. The order matches what `replayability` actually
 * depends on (cheap → expensive checks first):
 *
 *   1. `capability_off`     — operator never opted in
 *   2. `unsupported_step_kind` — row has a tool outside v1's allowlist
 *   3. `non_portable_args`  — args carry only session-local handles
 *   4. `non_github_pageRole`— pageRole outside the GitHub v1 allowlist
 *   5. `below_threshold`    — successRate / successCount under the bar
 *   6. `stale_locator`      — reserved for step-outcome write-back
 *      signals; the chooser does NOT fire this on its own.
 *
 * `'none'` is reserved for the success branch (caller MUST set it
 * when emitting the `experience_replay` strategy).
 */
export function isReplayEligible(
  row: ExperienceActionPathRow,
  capabilityEnabled: boolean,
): ReplayEligibilityResult {
  if (!capabilityEnabled) return { eligible: false, blockedBy: 'capability_off' };

  if (row.stepSequence.length === 0) {
    return { eligible: false, blockedBy: 'unsupported_step_kind' };
  }
  for (const step of row.stepSequence) {
    if (!TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS.has(step.toolName)) {
      return { eligible: false, blockedBy: 'unsupported_step_kind' };
    }
  }
  for (const step of row.stepSequence) {
    if (!extractPortableReplayArgs(step.toolName, step.args)) {
      return { eligible: false, blockedBy: 'non_portable_args' };
    }
  }
  if (!TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES.has(row.pageRole)) {
    return { eligible: false, blockedBy: 'non_github_pageRole' };
  }

  const total = row.successCount + row.failureCount;
  const successRate = total > 0 ? row.successCount / total : 0;
  if (
    successRate < EXPERIENCE_REPLAY_MIN_SUCCESS_RATE ||
    row.successCount < EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT
  ) {
    return { eligible: false, blockedBy: 'below_threshold' };
  }

  return { eligible: true, blockedBy: 'none' };
}

/**
 * Composite score the chooser ranks on. Reads the cached decayed score
 * (`compositeScoreDecayed`) when present; otherwise re-derives from
 * per-row counters using the same math the writer used so a row the
 * writer has not yet visited still has a deterministic score.
 *
 * The fallback projection uses `successCount / failureCount` to seed
 * `accuracy` + `stability` (the writer's `extractScoreComponentsFromSession`
 * does the same when an aggregator pass has not landed yet); `speed`
 * and `token` default to 0 because the chooser has no access to per-step
 * timing or token telemetry. This is intentionally conservative — a
 * row whose writer pass has not run will rank lower than a row whose
 * cache is fresh, encouraging the aggregator to catch up.
 */
function deriveCandidateScore(
  row: ExperienceActionPathRow,
  weights: TabrixTaskWeights,
  nowIso: string,
): number {
  if (typeof row.compositeScoreDecayed === 'number' && Number.isFinite(row.compositeScoreDecayed)) {
    return row.compositeScoreDecayed;
  }
  const components = projectCompositeComponents({
    successCount: row.successCount,
    failureCount: row.failureCount,
  });
  const raw = computeRawComposite(components, weights);
  return applyRecencyDecay(raw, row.lastReplayAt ?? row.lastUsedAt ?? null, nowIso);
}

/**
 * Strict deterministic comparator. Order is:
 *   1. score DESC,
 *   2. successCount DESC,
 *   3. lastReplayAt DESC NULLS LAST (lexicographic ISO 8601 compare),
 *   4. actionPathId ASC.
 *
 * Tie-break #3 deliberately uses `lastReplayAt` (active replay
 * timestamp), NOT `lastUsedAt` (legacy aggregator), so a row that was
 * actually replayed wins over a row that was only ever passively
 * suggested.
 */
function compareCandidates(
  a: { row: ExperienceActionPathRow; score: number },
  b: { row: ExperienceActionPathRow; score: number },
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.row.successCount !== a.row.successCount) {
    return b.row.successCount - a.row.successCount;
  }
  const aLast = a.row.lastReplayAt ?? '';
  const bLast = b.row.lastReplayAt ?? '';
  if (aLast !== bLast) {
    if (aLast === '') return 1;
    if (bLast === '') return -1;
    return bLast.localeCompare(aLast);
  }
  return a.row.actionPathId.localeCompare(b.row.actionPathId);
}

export interface RankExperienceCandidatesInput {
  rows: ExperienceActionPathRow[];
  capabilityEnabled: boolean;
  /** ISO 8601. Required so callers stay deterministic in tests. */
  nowIso: string;
  /** Optional override; defaults to {@link getTaskWeightsFor}(`pageRole`). */
  weights?: TabrixTaskWeights;
  /**
   * Page role used to seed task-weights when `weights` is not
   * provided. Mirrors the chooser's resolved `pageRole` field.
   */
  pageRole?: string;
}

export interface RankExperienceCandidatesResult {
  /**
   * Top-N ranked candidates in deterministic order. Length is
   * `min(rows.length, EXPERIENCE_RANKED_TOP_N)`. Empty when `rows`
   * is empty (the caller can short-circuit to `read_page_required`).
   */
  ranked: TabrixChooseContextRankedCandidate[];
  /**
   * Convenience pointer: `ranked[0]?.replayEligible === true`. The
   * caller checks this AND `topRow` to decide between
   * `experience_replay` (eligible) and `experience_reuse` (not).
   */
  topReplayEligible: boolean;
  /**
   * The full underlying row object for the top-1 candidate (or
   * `undefined` when `rows` is empty). The chooser uses this to
   * build the existing `experience` artifact summary text and the
   * legacy `experienceHit` reasoning string.
   */
  topRow?: ExperienceActionPathRow;
  /**
   * The first blocker reported for the top-1 candidate. `'none'`
   * when the top-1 is eligible; `undefined` when there is no top-1.
   */
  topBlockedBy?: ReplayEligibilityBlockReason;
}

/**
 * Deterministic top-N replay ranking.
 *
 * The chooser ALWAYS returns a ranked list when `rows` is non-empty
 * (even when nothing is replay-eligible); telemetry post-mortems
 * track ineligible candidates separately so the operator can see
 * "we had X candidates but Y were blocked by reason Z".
 */
export function rankExperienceCandidates(
  input: RankExperienceCandidatesInput,
): RankExperienceCandidatesResult {
  const weights = input.weights ?? getTaskWeightsFor('github', input.pageRole);
  if (input.rows.length === 0) {
    return { ranked: [], topReplayEligible: false };
  }

  const enriched = input.rows.map((row) => {
    const eligibility = isReplayEligible(row, input.capabilityEnabled);
    const score = deriveCandidateScore(row, weights, input.nowIso);
    return { row, score, eligibility };
  });
  enriched.sort(compareCandidates);

  const ranked: TabrixChooseContextRankedCandidate[] = enriched
    .slice(0, EXPERIENCE_RANKED_TOP_N)
    .map(({ row, score, eligibility }) => ({
      ref: row.actionPathId,
      score,
      replayEligible: eligibility.eligible,
      blockedBy: eligibility.blockedBy,
    }));

  const top = enriched[0];
  return {
    ranked,
    topReplayEligible: top?.eligibility.eligible ?? false,
    topRow: top?.row,
    topBlockedBy: top?.eligibility.blockedBy,
  };
}
