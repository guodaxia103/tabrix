/**
 * V25-03 — Sidepanel "Execution" tab DTOs.
 *
 * These types describe the response bodies of four read-only HTTP routes
 * exposed by the native server under `/execution/**` and consumed by the
 * Sidepanel `Execution` tab. They surface what V25-02 layer-dispatch and
 * V24 ranked-replay telemetry produced, without ever exposing
 * user-supplied free text.
 *
 * Privacy contract (M4 binding):
 *   - response bodies MUST NOT echo full URLs (no query strings, no fragments)
 *   - response bodies MUST NOT include any field from
 *     `memory_sessions.user_input`
 *   - response bodies MUST NOT include cookie or auth header values
 *   - intent is exposed only as the structural `intent_signature`
 *     (already lower-cased + redacted upstream by B-013)
 *
 * Stable shapes are required because the Sidepanel ships across
 * multiple native-server versions; new fields must be optional.
 */

import type { ContextStrategyName, TabrixChooseContextOutcome } from './choose-context';
import type {
  LayerDispatchReason,
  LayerSourceRoute,
  ReadPageRequestedLayer,
} from './read-page-contract';

/** Single recent decision, sanitized for UI display. */
export interface ExecutionRecentDecisionSummary {
  /** Stable decision id; safe to expose (UUID v4). */
  decisionId: string;
  /** ISO 8601 UTC. Used for sort + relative-time rendering. */
  createdAt: string;
  /**
   * Structural intent fingerprint (B-013 normalized form). Already
   * lower-cased and redacted, so safe to display as a small chip. We
   * intentionally do NOT expose the raw `intent` text.
   */
  intentSignature: string;
  /** Optional structural pageRole. Empty string normalizes to null. */
  pageRole: string | null;
  /** Closed enum (`'github'` today). Telemetry-only. */
  siteFamily: string | null;
  /** Chosen strategy from the closed v1 set. */
  strategy: ContextStrategyName;
  /** Optional fallback strategy. */
  fallbackStrategy: ContextStrategyName | null;
  /** Chosen layer envelope from V25-02. `null` when telemetry pre-dates V25-02. */
  chosenLayer: ReadPageRequestedLayer | null;
  /** V25-02 dispatch reason; `null` for legacy rows. */
  layerDispatchReason: LayerDispatchReason | null;
  /** V25-02 source route; `null` for legacy rows. */
  sourceRoute: LayerSourceRoute | null;
  /** Free-text fail-safe reason; only set when dispatcher fell back. */
  fallbackCause: string | null;
  /** Tokens saved by the layer envelope vs full read; never negative. `null` for legacy. */
  tokensSavedEstimate: number | null;
}

/** `GET /execution/decisions/recent` response body. */
export interface ExecutionRecentDecisionsResponseData {
  decisions: ExecutionRecentDecisionSummary[];
  total: number;
  limit: number;
  /** Mirrors Memory routes for UI parity. */
  persistenceMode: 'disk' | 'memory' | 'off';
}

/** Aggregated savings across all persisted decisions. */
export interface ExecutionSavingsSummary {
  /** Total decision rows; 0 on a virgin DB. */
  decisionCount: number;
  /** Sum of `tokens_saved_estimate` across all decisions; 0 when no row carried estimates. */
  tokensSavedEstimateSum: number;
  /**
   * Per-layer counts. Keys cover the closed `ReadPageRequestedLayer`
   * union plus `'unknown'` for rows without `chosen_layer` (legacy /
   * pre-V25-02). Values are non-negative integers.
   */
  layerCounts: Record<ReadPageRequestedLayer | 'unknown', number>;
  /**
   * The most recent `experience_replay` decision + its outcome (if
   * recorded). `null` when no replay has happened yet.
   */
  lastReplay: {
    decisionId: string;
    createdAt: string;
    /** `'reuse' | 'fallback' | 'completed' | 'retried'` or `null` if no outcome row exists. */
    outcome: TabrixChooseContextOutcome | null;
  } | null;
  persistenceMode: 'disk' | 'memory' | 'off';
}

/**
 * Top-N action paths grouped by `(intent_signature, page_role,
 * site_family)`. "Action path" here is the dispatcher view, not the
 * Experience deck — it answers "which intent buckets did we serve most
 * often?".
 */
export interface ExecutionTopActionPathSummary {
  intentSignature: string;
  pageRole: string | null;
  siteFamily: string | null;
  /** Number of decision rows in this bucket. */
  decisionCount: number;
  /** Most-recent ISO timestamp in this bucket. */
  lastSeenAt: string;
  /**
   * Most frequently picked strategy in this bucket. `null` if every
   * row resolved to the same fallback (rare; defensive only).
   */
  topStrategy: ContextStrategyName;
}

/** `GET /execution/action-paths/top` response body. */
export interface ExecutionTopActionPathsResponseData {
  paths: ExecutionTopActionPathSummary[];
  limit: number;
  persistenceMode: 'disk' | 'memory' | 'off';
}

/**
 * Reliability signals derived from the V25-02 telemetry. These are
 * coarse "did the dispatcher have to escape hatch?" counters; they
 * are NOT a substitute for the V25-04 benchmark stability metrics.
 */
export interface ExecutionReliabilitySignalSummary {
  /** Total decision rows considered for the signal computation. */
  decisionCount: number;
  /**
   * How many decisions emitted `source_route='dispatcher_fallback_safe'`.
   * Non-zero values mean the dispatcher fell through to its fail-safe.
   */
  fallbackSafeCount: number;
  /**
   * Fraction `fallbackSafeCount / decisionCount`, rounded to 4dp.
   * `0` when `decisionCount === 0` (avoids NaN in the UI).
   */
  fallbackSafeRate: number;
  /**
   * Per-source-route counts. Keys cover the closed
   * {@link LayerSourceRoute} union plus `'unknown'` for legacy rows.
   */
  sourceRouteCounts: Record<LayerSourceRoute | 'unknown', number>;
  /**
   * How many `experience_replay`-eligible decisions ended up blocked,
   * grouped by reason. Empty object when no V24-03 telemetry exists.
   */
  replayBlockedByCounts: Record<string, number>;
  persistenceMode: 'disk' | 'memory' | 'off';
}

/** Standard success envelope shared by all `/execution/*` routes. */
export interface ExecutionReadSuccess<TData> {
  status: 'ok';
  data: TData;
}

export interface ExecutionReadError {
  status: 'error';
  message: string;
}

export type ExecutionReadResponse<TData> = ExecutionReadSuccess<TData> | ExecutionReadError;

/** Default page size for `/execution/decisions/recent`; mirrors Memory routes. */
export const EXECUTION_RECENT_DECISIONS_DEFAULT_LIMIT = 20;

/** Hard cap on `/execution/decisions/recent?limit=`. */
export const EXECUTION_RECENT_DECISIONS_LIMIT_MAX = 100;

/** Default page size for `/execution/action-paths/top`. */
export const EXECUTION_TOP_ACTION_PATHS_DEFAULT_LIMIT = 5;

/** Hard cap on `/execution/action-paths/top?limit=`. */
export const EXECUTION_TOP_ACTION_PATHS_LIMIT_MAX = 25;
