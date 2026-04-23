/**
 * V24-02 — pure session-end composite score module.
 *
 * Deterministic, side-effect-free maths used by:
 *   - the aggregator at session aggregation time (writes the
 *     decayed composite onto `experience_action_paths` via
 *     `SessionCompositeScoreWriter`);
 *   - V24-03 chooser ranking (reads `composite_score_decayed`
 *     directly — does NOT recompute on the hot path).
 *
 * SoT: `.claude/TABRIX_MKEP_FRAMEWORK_V2.md` §3.2 + `.claude/TABRIX_V2_4_0_PLAN.md`
 * §V24-02. The four component axes (`accuracy`, `speed`, `token`,
 * `stability`) and the recency half-life live in
 * `@tabrix/shared/experience-score-step` so any consumer (extension,
 * benchmark scripts, reports) reads the same constants.
 *
 * Failure handling: every public function returns either a number or
 * a typed result; nothing throws. The persistence path
 * (`SessionCompositeScoreWriter`) is the layer that swallows SQLite
 * exceptions and emits structured warnings — see
 * `experience-repository.ts::recordWritebackWarning`.
 */

import {
  EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS,
  EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS,
  type TabrixTaskWeights,
} from '@tabrix/shared';
import type { ExperienceRepository } from './experience-repository';

/** The four composite-score axes; values are clamped to `[0, 1]`. */
export interface CompositeScoreComponents {
  accuracy: number;
  speed: number;
  token: number;
  stability: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Clamp to `[0, 1]` and treat non-finite as 0 (defensive). */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Project per-session signals into the four composite axes. All
 * inputs are optional; missing axes degrade to `0`. Pure function —
 * no IO, no time source, no randomness.
 *
 * Mapping rules:
 *   - `accuracy`: success rate of the recorded steps. `successCount /
 *     (successCount + failureCount)`; both `0`/`0` and missing
 *     yields `0` (no evidence is not "perfect").
 *   - `speed`: normalised against the session budget. Caller passes
 *     the observed wall-time in ms and the budget the upstream
 *     intends; `1 - elapsed/budget` clipped to `[0, 1]`. Missing
 *     budget = 0 (we do not invent a baseline).
 *   - `token`: token-saving ratio (read_page rounds avoided / total
 *     potential rounds). Caller is responsible for capping ≥ 0.
 *   - `stability`: `1 - variancePenalty` where the caller measured
 *     locator-hit variance across the run. The aggregator (V24-02)
 *     passes `failureRate`-derived stability so the first session
 *     has signal even before any benchmark fixture lands.
 *
 * The four axes are deliberately additive (no max / min folding) so
 * a degenerate "all zeros" session returns `0` rather than NaN.
 */
export function projectCompositeComponents(input: {
  successCount?: number;
  failureCount?: number;
  elapsedMs?: number;
  budgetMs?: number;
  tokenSavingRatio?: number;
  stability?: number;
}): CompositeScoreComponents {
  const success = Math.max(0, input.successCount ?? 0);
  const failure = Math.max(0, input.failureCount ?? 0);
  const total = success + failure;
  const accuracy = total > 0 ? success / total : 0;
  const speed =
    input.budgetMs && input.budgetMs > 0 && input.elapsedMs !== undefined
      ? 1 - input.elapsedMs / input.budgetMs
      : 0;
  const token = input.tokenSavingRatio ?? 0;
  const stability = input.stability ?? (total > 0 ? 1 - failure / total : 0);
  return {
    accuracy: clamp01(accuracy),
    speed: clamp01(speed),
    token: clamp01(token),
    stability: clamp01(stability),
  };
}

/**
 * Pure weighted sum. Weights are normalised (sum-to-1) at compute
 * time so callers can pass either probabilities (`{0.4, 0.2, 0.3, 0.1}`)
 * or counts (`{4, 2, 3, 1}`) and get the same result. Zero or
 * negative weights are clamped to 0; an all-zero weight vector
 * collapses to the unweighted mean of the components.
 */
export function computeRawComposite(
  components: CompositeScoreComponents,
  weights: TabrixTaskWeights = EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS,
): number {
  const a = Math.max(0, weights.accuracy);
  const s = Math.max(0, weights.speed);
  const t = Math.max(0, weights.token);
  const st = Math.max(0, weights.stability);
  const sum = a + s + t + st;
  if (sum <= 0) {
    return (
      (clamp01(components.accuracy) +
        clamp01(components.speed) +
        clamp01(components.token) +
        clamp01(components.stability)) /
      4
    );
  }
  const score =
    (clamp01(components.accuracy) * a +
      clamp01(components.speed) * s +
      clamp01(components.token) * t +
      clamp01(components.stability) * st) /
    sum;
  return clamp01(score);
}

/**
 * Apply exponential recency decay using the half-life from
 * `@tabrix/shared`. `nowIso` is required (no `Date.now()` call so
 * tests stay deterministic). When `lastReplayAt` is missing or in the
 * future relative to `nowIso`, the raw score is returned unchanged.
 *
 * Formula: `decayed = raw * 0.5^(daysSince / halfLife)`.
 */
export function applyRecencyDecay(
  rawScore: number,
  lastReplayAt: string | undefined | null,
  nowIso: string,
): number {
  if (!lastReplayAt) return clamp01(rawScore);
  const last = Date.parse(lastReplayAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now) || now <= last) {
    return clamp01(rawScore);
  }
  const days = (now - last) / MS_PER_DAY;
  const decay = Math.pow(0.5, days / EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS);
  return clamp01(rawScore * decay);
}

/**
 * Convenience full-pipeline wrapper. Used by the aggregator's
 * session-end writer and by tests.
 */
export function computeDecayedComposite(input: {
  components: CompositeScoreComponents;
  weights?: TabrixTaskWeights;
  lastReplayAt: string;
  nowIso: string;
}): number {
  const raw = computeRawComposite(input.components, input.weights);
  return applyRecencyDecay(raw, input.lastReplayAt, input.nowIso);
}

/**
 * Persistence shim. Writes the (raw, decayed) pair on a single
 * SQLite transaction-equivalent path. Failure is ISOLATED:
 *   - we never throw out of `write()`;
 *   - the underlying SQLite error is reported through the injected
 *     warning sink so the caller can continue replay aggregation.
 *
 * The class is a deliberate thin seam. Tests inject a fake
 * `repository` to assert the `record()` / `recordWritebackWarning()`
 * call shape; production wires it to {@link ExperienceRepository}.
 */
export interface SessionCompositeScoreWriterDeps {
  repository: Pick<
    ExperienceRepository,
    | 'updateCompositeScoreForActionPath'
    | 'updateMemorySessionCompositeScore'
    | 'recordWritebackWarning'
  >;
  /**
   * Optional structured-log sink. Defaults to a no-op; tests pass a
   * spy. Production wires it to the same logger used by other
   * write-back paths so an operator can see the warning even before
   * SQLite opens.
   */
  onWarning?: (warning: { code: string; message: string; warningId: string }) => void;
}

export interface SessionCompositeScoreWriteInput {
  sessionId: string;
  actionPathId: string;
  components: CompositeScoreComponents;
  weights?: TabrixTaskWeights;
  /** Used for both `last_replay_at` and `applyRecencyDecay`. */
  lastReplayAt: string;
  nowIso: string;
}

export interface SessionCompositeScoreWriteResult {
  status: 'ok' | 'isolated';
  raw: number;
  decayed: number;
  warningId?: string;
}

export class SessionCompositeScoreWriter {
  constructor(private readonly deps: SessionCompositeScoreWriterDeps) {}

  public write(input: SessionCompositeScoreWriteInput): SessionCompositeScoreWriteResult {
    const raw = computeRawComposite(input.components, input.weights);
    const decayed = applyRecencyDecay(raw, input.lastReplayAt, input.nowIso);
    try {
      this.deps.repository.updateMemorySessionCompositeScore({
        sessionId: input.sessionId,
        compositeScoreRaw: raw,
        components: { ...input.components },
      });
      this.deps.repository.updateCompositeScoreForActionPath({
        actionPathId: input.actionPathId,
        compositeScoreDecayed: decayed,
        nowIso: input.nowIso,
      });
      return { status: 'ok', raw, decayed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const warningId = `warn_composite_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
      try {
        this.deps.repository.recordWritebackWarning({
          warningId,
          source: 'session_composite_score',
          actionPathId: input.actionPathId,
          stepIndex: null,
          sessionId: input.sessionId,
          replayId: null,
          observedOutcome: null,
          errorCode: 'composite_score_write_failed',
          errorMessage: message.slice(0, 512),
          payloadBlob: JSON.stringify({ components: input.components, raw, decayed }),
          createdAt: input.nowIso,
        });
      } catch {
        // Even the warning row failed to land — by design we still
        // do not throw; the aggregator must keep moving so the user
        // path stays alive.
      }
      this.deps.onWarning?.({
        code: 'composite_score_write_failed',
        message,
        warningId,
      });
      return { status: 'isolated', raw, decayed, warningId };
    }
  }
}
