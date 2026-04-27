import type {
  LayerDispatchReason,
  LayerSourceRoute,
  ReadPageRequestedLayer,
} from './read-page-contract';

/**
 * Tabrix MKEP Stage 3h — `tabrix_choose_context` v1 minimal slice (B-018).
 *
 * SoT for the public input/output contract is
 * [`docs/B_018_CONTEXT_SELECTOR_V1.md`](../../../docs/B_018_CONTEXT_SELECTOR_V1.md).
 *
 * v1 is intentionally tiny:
 *  - 3 strategies (no `api_only`, no `experience_replay`, no `read_page_markdown`).
 *  - No `tokenEstimate` (we have no calibration data; an invented number
 *    would mislead upstream planners).
 *  - GitHub-first; non-GitHub URLs fall through to `read_page_required`.
 *
 * This module is types + constants only — pure data, no IO. The runtime
 * lives in the native-server (`mcp/choose-context.ts`).
 */

/** Maximum length of the `intent` argument before truncation. Same as B-013. */
export const MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS = 1024;

/** Maximum length of the optional `pageRole` filter. Same as B-013. */
export const MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS = 128;

/**
 * Single threshold v1 uses to decide an Experience hit is good enough.
 * Strict `>=`. Plans below this rate are treated as "no match" so the
 * caller does not get a low-quality replay candidate dressed up as
 * `experience_reuse`.
 *
 * Kept conservative on purpose: a second knob (e.g. minimum sample
 * count) is exactly what v1 forbids — adding one is a v2 design call,
 * informed by run-history data.
 */
export const EXPERIENCE_HIT_MIN_SUCCESS_RATE = 0.5;

/**
 * Number of plans we ask `experience_suggest_plan` for. The best
 * surviving plan drives the strategy; the rest become artifacts.
 */
export const EXPERIENCE_LOOKUP_LIMIT = 3;

// ---------------------------------------------------------------------------
// V24-03 — ranked replay constants
// ---------------------------------------------------------------------------

/**
 * V24-03 / `tabrix_choose_context` v2 — number of replay candidates the
 * chooser surfaces in the `experience_ranked` artifact. Three is large
 * enough to give a real ladder (top-1 + two backups) and small enough
 * that the upstream LLM will actually attempt them all before giving
 * up. Treat as a closed knob: bumping requires a brief amendment +
 * re-checking the per-tool token budget.
 */
export const EXPERIENCE_RANKED_TOP_N = 3;

/**
 * V24-03 — minimum `successRate` (success / (success+failure)) a row
 * must clear to be considered replay-eligible. This is STRICTER than
 * {@link EXPERIENCE_HIT_MIN_SUCCESS_RATE} (which is the v1 reuse
 * gate): replay actually dispatches the recorded steps against the
 * live page, so the bar to take that risk is higher than the bar to
 * surface a recorded plan as advice.
 */
export const EXPERIENCE_REPLAY_MIN_SUCCESS_RATE = 0.8;

/**
 * V24-03 — minimum absolute success count. Pairs with
 * {@link EXPERIENCE_REPLAY_MIN_SUCCESS_RATE}: 1 success / 0 failures
 * is a perfect rate but a single sample, which is not enough evidence
 * to dispatch a recorded plan. Three matches MKEP §3.2's "min sample
 * count for ranked surfacing".
 */
export const EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT = 3;

/**
 * V24-03 — recency-decay half-life in days for chooser-side ranking.
 * Mirrors `EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS` so the
 * read-side ranking and the write-side `compositeScoreDecayed` cache
 * use the same time constant; if these ever drift, the chooser's
 * ordering will not match the persisted score.
 */
export const EXPERIENCE_RECENCY_DECAY_DAYS = 30;

/**
 * V24-03 — closed enum for `TabrixChooseContextResult.replayEligibleBlockedBy`.
 *
 * Each value is a single, deterministic reason the chooser can give
 * for refusing to route a candidate to `experience_replay`. The
 * `'none'` value is reserved for the success branch (i.e. the chooser
 * actually emitted `experience_replay`); a downgraded result must
 * always carry a non-`'none'` reason so a post-mortem can say
 * "Codex's MCP saw N decisions, X% were blocked by reason Y".
 *
 * Order is: capability gate → step kind → portability → page role →
 * threshold → stale locator. Multiple reasons may apply; the chooser
 * reports the FIRST one in this order so the post-mortem signal is
 * stable across runs.
 */
export type ReplayEligibilityBlockReason =
  | 'capability_off'
  | 'unsupported_step_kind'
  | 'non_portable_args'
  | 'non_github_pageRole'
  | 'below_threshold'
  | 'stale_locator'
  | 'none';

/**
 * Maximum number of endpoint signatures echoed in the `knowledge_light`
 * artifact summary. Keeps payload bounded even when a site has many
 * captured endpoints.
 */
export const KNOWLEDGE_LIGHT_SAMPLE_LIMIT = 5;

/**
 * Site families recognised by v1. Anything else resolves to
 * `siteFamily: undefined` and falls through to `read_page_required`.
 */
export type TabrixContextSiteFamily = 'github';

/**
 * Closed v1 strategy set. Adding a new value here is itself a v2 design
 * decision — never silently widen this in a feature branch.
 *
 * V23-04 / B-018 v1.5: `read_page_markdown` joins the set as the
 * "GitHub text-heavy reading" branch. It points the caller at
 * `chrome_read_page(render='markdown')` (B-015 / V23-03), which is a
 * READING surface — the JSON HVOs / candidateActions / `targetRef`
 * stay the execution truth. The chooser only picks this branch when
 * (a) no experience hit, (b) no usable knowledge catalog, and
 * (c) `pageRole` is in a small known-text whitelist (see
 * `MARKDOWN_FRIENDLY_PAGE_ROLES`). Outside that whitelist the chooser
 * still returns `read_page_required` so JSON-only callers see no
 * behavior change.
 */
export type ContextStrategyName =
  | 'experience_replay'
  | 'experience_reuse'
  | 'knowledge_light'
  | 'read_page_markdown'
  | 'read_page_required';

/**
 * V23-04 / B-018 v1.5 — small, hand-curated set of `pageRole` values
 * for which the chooser will route the no-experience / no-knowledge
 * fallback to `read_page_markdown` instead of `read_page_required`.
 *
 * Why a hand-curated set: today only a handful of GitHub pageRoles are
 * reliably emitted by `read-page-understanding-github.ts`, and only a
 * subset of those are "long-form reading" pages where Markdown beats
 * the JSON snapshot for token cost. Forward-compatible tokens
 * (`issue_detail`, `pull_request_detail`, `discussion_detail`, `wiki`,
 * `release_notes`, `commit_detail`) are pre-listed so when the
 * understanding layer starts emitting them, the routing flips on
 * automatically without another shared-contract change.
 *
 * Anything outside this list keeps the v1 fallback (`read_page_required`).
 */
export const MARKDOWN_FRIENDLY_PAGE_ROLES: readonly string[] = Object.freeze([
  'repo_home',
  'issue_detail',
  'pull_request_detail',
  'discussion_detail',
  'wiki',
  'release_notes',
  'commit_detail',
]);

/**
 * Validated public input. Built from raw MCP args by
 * `parseTabrixChooseContextInput` in the native-server.
 */
export interface TabrixChooseContextInput {
  /** Free-text intent. Non-empty after trim. Truncated before normalization. */
  intent: string;
  /** Optional page URL. Unparseable values are silently ignored (see doc §3.1). */
  url?: string;
  /** Optional `pageRole` filter, mirroring the B-013 contract. */
  pageRole?: string;
  /**
   * Optional explicit site-family override. v1 only honours `'github'`;
   * any other value is dropped on the floor and the URL-derived family
   * (if any) is used instead.
   */
  siteId?: TabrixContextSiteFamily;
}

/**
 * V24-03 — single ranked replay candidate inside the
 * `experience_ranked` artifact. `score` is the deterministic composite
 * (accuracy / speed / token / stability with recency decay; see
 * `composite-score.ts`); `replayEligible` is the AND of every
 * eligibility gate (capability, step kinds, portable args, pageRole,
 * thresholds). A non-eligible candidate stays in the ranked list with
 * `replayEligible: false` + a `blockedBy` reason so the post-mortem
 * stays grouped per actionPathId; the chooser still picks
 * `experience_reuse` if the top-ranked is non-eligible.
 */
export interface TabrixChooseContextRankedCandidate {
  ref: string;
  score: number;
  replayEligible: boolean;
  blockedBy?: ReplayEligibilityBlockReason;
}

/**
 * One reusable artifact reference returned alongside the chosen
 * strategy. `ref` is opaque to the caller — it is owned by whichever
 * native subsystem produced it (Experience action-path id; site name
 * for the Knowledge catalog; etc.).
 *
 * V24-03 added `'experience_ranked'`: the chooser emits a single
 * artifact of this kind whenever it surfaces a ranked candidate list
 * (whether or not it ultimately routes to `experience_replay`). The
 * top-1 is `ref`; the full list (top-N up to {@link EXPERIENCE_RANKED_TOP_N})
 * is in `ranked`. `summary` echoes a short description of the top-1.
 */
export interface TabrixChooseContextArtifact {
  kind: 'experience' | 'experience_ranked' | 'knowledge_api' | 'read_page';
  ref: string;
  /** Compact human-readable label, ≤ 200 chars. Not a UI string. */
  summary: string;
  /**
   * V24-03 — populated only on `kind === 'experience_ranked'`. List
   * length is in `[1, EXPERIENCE_RANKED_TOP_N]`; ordering is the
   * deterministic ranking from `rankExperienceCandidates`
   * (composite score DESC, then `successCount` DESC, then
   * `lastReplayAt` DESC NULLS LAST, then `actionPathId` ASC).
   */
  ranked?: TabrixChooseContextRankedCandidate[];
}

/**
 * Echo of what the tool resolved from input — useful for debugging
 * bucket alignment with `experience_suggest_plan`.
 */
export interface TabrixChooseContextResolved {
  intentSignature: string;
  pageRole?: string;
  siteFamily?: TabrixContextSiteFamily;
}

export interface TabrixChooseContextErrorBody {
  code: string;
  message: string;
}

/**
 * Public response. `status: 'invalid_input'` carries only `error`
 * (everything else is omitted) so the caller can branch on the
 * discriminator without writing optional-chains for every field.
 */
export interface TabrixChooseContextResult {
  status: 'ok' | 'invalid_input';
  strategy?: ContextStrategyName;
  /**
   * Concrete next-step the caller should fall back to if `strategy`
   * cannot be acted on. In v1 this is always `'read_page_required'`
   * when `strategy` is something else, and omitted when `strategy`
   * already is `'read_page_required'`.
   */
  fallbackStrategy?: ContextStrategyName;
  /** Short rationale, stable enough to grep in logs. */
  reasoning?: string;
  /** Always a list when `status === 'ok'`; possibly empty. */
  artifacts?: TabrixChooseContextArtifact[];
  resolved?: TabrixChooseContextResolved;
  error?: TabrixChooseContextErrorBody;
  /**
   * V23-04 / B-018 v1.5 — opaque decision id (UUIDv4). Present when
   * `status === 'ok'` AND a telemetry row was successfully written.
   * Absent when telemetry is disabled / failed (the chooser still
   * succeeds; outcome write-back simply has nothing to point at).
   *
   * Upstream callers MAY persist this id and pass it back to
   * `tabrix_choose_context_record_outcome` to close the loop on
   * "did this strategy actually save us a `read_page` round-trip?".
   * The id has no semantics beyond being a primary key; do NOT parse it.
   */
  decisionId?: string;
  /**
   * V24-03 — number of replay candidates in the
   * `experience_ranked` artifact (0 when none surfaced). Present on
   * any ok result, regardless of strategy: a non-replay strategy
   * still sets this to `0` so post-hoc analysis can cleanly group
   * "we had ranked candidates but went elsewhere" vs "we never had
   * any". A non-zero value implies one artifact of kind
   * `'experience_ranked'`.
   */
  rankedCandidateCount?: number;
  /**
   * V24-03 — first reason the chooser refused to route the top-1
   * candidate to `experience_replay`. `'none'` is set on the
   * success branch (chooser actually emitted `experience_replay`);
   * any other value is the FIRST blocker in the closed
   * {@link ReplayEligibilityBlockReason} order so the post-mortem
   * signal is stable. Absent on result branches that never even
   * looked at Experience (e.g. `read_page_required` when no
   * candidate row existed at all).
   */
  replayEligibleBlockedBy?: ReplayEligibilityBlockReason;
  /**
   * V24-03 — replay-engine fallback depth the chooser THINKS the
   * caller will hit. The chooser itself can only declare `0` (we
   * surfaced a candidate) or `'cold'` (no candidates surfaced, so
   * the caller will pay full read-page cost). The actual `1 | 2 | 3`
   * values are written by the replay engine on outcome write-back
   * (V24-02) and surface in telemetry; the chooser never claims to
   * know the post-execution depth. Numeric encoding intentionally
   * matches the per-pair K7 metric in V24-05 so analysis joins
   * across surfaces without translation.
   */
  replayFallbackDepth?: 0 | 1 | 2 | 3 | 'cold';
  /**
   * V25-02 — chosen layer envelope the dispatcher selected for this
   * decision. Optional so older callers / tests that mock the result
   * stay valid; populated whenever `status === 'ok'` and the v25
   * dispatcher ran.
   */
  chosenLayer?: ReadPageRequestedLayer;
  /**
   * V25-02 — closed-enum reason that maps 1:1 to the V25-02 Layer
   * Dispatch Strategy Table row. See {@link
   * ./read-page-contract.LayerDispatchReason}.
   */
  layerDispatchReason?: LayerDispatchReason;
  /**
   * V25-02 — closed-enum routing instruction telling the caller
   * whether `chrome_read_page` is required, the experience replay
   * skip-read shortcut applies, knowledge supports the read, or the
   * dispatcher fell back. See {@link
   * ./read-page-contract.LayerSourceRoute}.
   */
  sourceRoute?: LayerSourceRoute;
  /**
   * V25-02 — short rationale string for the dispatcher's fallback
   * branch. Empty / omitted on non-fallback branches. Intended for
   * post-mortems and the v25 release report.
   */
  fallbackCause?: string;
  /**
   * V25-02 — `ceil(byteLength/4)` token estimate of the layer the
   * dispatcher chose to ask for. `0` means the dispatcher did not
   * derive an estimate (e.g. unknown page size).
   */
  tokenEstimateChosen?: number;
  /**
   * V25-02 — `ceil(byteLength/4)` token estimate of the equivalent
   * full `L0+L1+L2` read. `0` when unknown. Always `>= tokenEstimateChosen`
   * when both are known.
   */
  tokenEstimateFullRead?: number;
  /**
   * V25-02 — `max(0, tokenEstimateFullRead - tokenEstimateChosen)`.
   * Pre-computed for telemetry ergonomics. Always `0` when either side
   * is unknown.
   */
  tokensSavedEstimate?: number;
  /**
   * V25-02 — when the dispatcher routes the caller through
   * `experience_replay_skip_read`, the caller is expected to skip
   * `chrome_read_page` entirely. This flag is `true` ONLY in that
   * exact branch; the chooser never claims a generic "do not read".
   */
  readPageAvoided?: boolean;
  /**
   * V26-FIX-01 — optional inline API execution envelope. Present only
   * when (a) the chooser routed to `'knowledge_supported_read'`, (b)
   * a high-confidence read-only endpoint candidate was resolved, and
   * (c) the executor actually attempted the call. The closed-enum
   * `executionMode` discriminator distinguishes:
   *   - `'direct_api'`           — rows are present; upstream MAY
   *                                skip the chrome_navigate +
   *                                chrome_read_page round-trip.
   *   - `'fallback_required'`    — the API call failed (timeout /
   *                                rate-limit / decode error /
   *                                semantic mismatch); upstream MUST
   *                                fall back to chrome_read_page at
   *                                the suggested entry layer.
   *   - `'skipped_*'`            — the executor short-circuited
   *                                without attempting a call (low
   *                                confidence / non-read-only intent
   *                                / no candidate / route mismatch);
   *                                upstream behaves exactly like a
   *                                pre-V26-FIX-01 chooser caller.
   *
   * Absent on every other strategy / status combination so legacy
   * callers stay bit-identical pre-V26-FIX-01. Field is additive on
   * the JSON wire shape; no MCP `tools.ts` schema change.
   */
  directApiExecution?: TabrixDirectApiExecution;
}

/**
 * V26-FIX-01 — closed-enum executor state surfaced on
 * {@link TabrixChooseContextResult.directApiExecution}.
 */
export type TabrixDirectApiExecutionMode =
  | 'direct_api'
  | 'fallback_required'
  | 'skipped_low_confidence'
  | 'skipped_not_read_only'
  | 'skipped_no_candidate'
  | 'skipped_route_mismatch';

/**
 * V26-FIX-01 — closed-enum reason the executor reached its
 * {@link TabrixDirectApiExecutionMode}. The
 * `'api_call_failed_<reason>'` family is intentionally a string union
 * over the underlying API knowledge fallback reasons (rate_limited /
 * network_timeout / decode_error / …) so a post-mortem can group by
 * the failure class without parsing free-form strings.
 */
export type TabrixDirectApiDecisionReason =
  | 'endpoint_knowledge_high_confidence'
  | 'endpoint_low_confidence'
  | 'endpoint_not_resolved'
  | 'route_mismatch_not_knowledge_supported'
  | 'intent_not_read_only'
  | `api_call_failed_${string}`;

/**
 * V26-FIX-01 — compact API row shape mirrored from the underlying
 * reader (`ApiKnowledgeCompactRow`). Kept as a flat string-or-scalar
 * map so the JSON wire shape never carries nested raw bodies.
 */
export type TabrixDirectApiCompactRow = Record<string, string | number | boolean | null>;

/**
 * V26-FIX-01 — public view of the executor result the chooser ships.
 * Intentionally narrower than the internal
 * `DirectApiExecutionResult` to keep the wire surface stable while
 * V26-FIX-04 swaps the underlying lookup module.
 */
export interface TabrixDirectApiExecution {
  executionMode: TabrixDirectApiExecutionMode;
  decisionReason: TabrixDirectApiDecisionReason;
  /** True iff `executionMode === 'direct_api'`. */
  browserNavigationSkipped: boolean;
  /** Mirrors {@link browserNavigationSkipped}; preserved for the chrome_read_page contract. */
  readPageAvoided: boolean;
  /** Endpoint family the executor (would have) called; null when no candidate was eligible. */
  endpointFamily: string | null;
  /** Confidence score the executor saw on the candidate; null when the candidate was missing. */
  candidateConfidence: number | null;
  /**
   * Closed-enum reader fallback cause; null on `direct_api` and on
   * the `'skipped_*'` short-circuits. Surfaced so V26-FIX-07 can log
   * a single closed-enum value to the operation log.
   */
  fallbackCause: string | null;
  /** Suggested entry layer when `'fallback_required'`; null otherwise. */
  fallbackEntryLayer: 'L0+L1' | null;
  /**
   * Compact rows; present ONLY when `executionMode === 'direct_api'`.
   * Same scrubbed shape `chrome_read_page`'s API path returns —
   * upstream consumers can treat the two surfaces interchangeably.
   */
  rows: TabrixDirectApiCompactRow[] | null;
  /** Row count; null when no fetch was attempted. */
  rowCount: number | null;
  /** Optional API telemetry forwarded from the underlying reader. */
  apiTelemetry?: TabrixDirectApiTelemetry | null;
}

/** V26-FIX-01 — read-only API telemetry fields surfaced upward. */
export interface TabrixDirectApiTelemetry {
  endpointFamily?: string;
  method: string;
  reason: string;
  status: number | null;
  waitedMs: number;
  readAllowed: boolean;
  fallbackEntryLayer: 'L0+L1' | 'none';
}

/**
 * V23-04 / B-018 v1.5 — closed outcome label set for the chooser
 * write-back loop. `reuse` means the suggested strategy was acted on
 * AND saved a `read_page`; `fallback` means the caller had to fall
 * back to `read_page` anyway; `completed` means the whole task
 * completed successfully on top of the suggested strategy; `retried`
 * means the caller went back and re-issued `tabrix_choose_context`
 * (signalling the first decision wasn't useful).
 *
 * Closed on purpose so the outcome aggregation in
 * `release:choose-context-stats` can keep its grouping deterministic.
 */
export type TabrixChooseContextOutcome = 'reuse' | 'fallback' | 'completed' | 'retried';

/** Validated public input for `tabrix_choose_context_record_outcome`. */
export interface TabrixChooseContextRecordOutcomeInput {
  decisionId: string;
  outcome: TabrixChooseContextOutcome;
}

/**
 * Public response for `tabrix_choose_context_record_outcome`.
 * `status: 'invalid_input'` carries only `error`. `status: 'unknown_decision'`
 * means the decision id was well-formed but no telemetry row matched;
 * the caller should treat that as "decision lost" rather than "permission
 * denied" or a transport error.
 */
export interface TabrixChooseContextRecordOutcomeResult {
  status: 'ok' | 'invalid_input' | 'unknown_decision';
  decisionId?: string;
  outcome?: TabrixChooseContextOutcome;
  error?: TabrixChooseContextErrorBody;
}
