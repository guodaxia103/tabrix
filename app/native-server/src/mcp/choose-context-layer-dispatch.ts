/**
 * V25-02 — pure layer dispatcher.
 *
 * Translates the V25-02 Layer Dispatch Strategy Table from
 * `.claude/strategy/TABRIX_V2_5_P0_CHAIN_V3_1.md` §V25-02 into a
 * deterministic priority-1→6 linear scan. Returns the first row that
 * matches; never throws to the caller (an unrecognized input or an
 * internal error becomes the fail-safe row instead, so downstream
 * tools always have a valid `chosenLayer`).
 *
 * Design constraints baked in:
 * - **Pure** — no IO, no clock, no Memory read. Tests pin the matrix
 *   without standing up SQLite or the chooser orchestrator.
 * - **Deterministic** — same input → same output across runs.
 * - **Closed enums** — `chosenLayer` / `reason` / `sourceRoute` come
 *   from `@tabrix/shared`; the v25 release gate compares against the
 *   same enum lists.
 * - **Stability outranks tokens** — the safety override (priority 1)
 *   forces `L0+L1+L2` whenever the caller explicitly says replay /
 *   click verifier / portable-args needs full layers. Tokens never
 *   win against execution truth (V3.1 §4.2).
 *
 * The matrix is held in a single ordered list of rules. Each rule is
 * a `{ matches, decide }` pair so the test suite can iterate the
 * table and assert the linear-scan property without hand-mirroring
 * branches in switch statements.
 */

import {
  LAYER_DISPATCH_REASON_VALUES,
  LAYER_SOURCE_ROUTE_VALUES,
  READ_PAGE_REQUESTED_LAYER_VALUES,
  estimateTokensFromBytes,
  type LayerDispatchReason,
  type LayerSourceRoute,
  type ReadPageRequestedLayer,
} from '@tabrix/shared';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Closed-enum hint for what the user said in plain language. The
 * dispatcher only consumes the bucket, not raw text — keeping the
 * surface tiny avoids leaking PII into Memory and pins the
 * regex/keyword extraction at the caller.
 *
 * Order matches the priority-2 user-intent override block in the
 * Strategy Table.
 */
export type LayerDispatchUserIntentHint =
  | 'summary'
  | 'open_or_select'
  | 'form_or_submit'
  | 'details'
  | 'unknown';

/**
 * Closed-enum hint for "what flavour of task is this", consulted at
 * priority 3 (task type). Today we only need a binary; a third value
 * (`'unknown'`) lets the dispatcher fall through to page-complexity
 * scoring instead of guessing.
 */
export type LayerDispatchTaskType = 'reading_only' | 'action' | 'unknown';

export interface LayerDispatchInput {
  /**
   * Optional structural label of the page (e.g. `'repo_home'`,
   * `'workflow_run_detail'`). Trimmed before use; an empty / missing
   * value triggers the fail-safe row when no other rule matches.
   */
  pageRole?: string | null;
  /** User intent bucket. `'unknown'` skips priority 2. */
  userIntent?: LayerDispatchUserIntentHint;
  /** Task type bucket. `'unknown'` skips priority 3. */
  taskType?: LayerDispatchTaskType;
  /**
   * Number of `candidateActions` the upstream chooser knows about.
   * Drives priority-4 page-complexity rows. A negative or non-finite
   * value is normalized to `0`.
   */
  candidateActionsCount?: number;
  /** Number of high-value objects on the page. Same normalization. */
  hvoCount?: number;
  /**
   * Whether the chooser's MKEP support layer surfaced a usable API
   * Knowledge catalog for this site/page. Drives priority-5 rows.
   */
  knowledgeAvailable?: boolean;
  /**
   * True when V26-07 resolved a read-only search/list API candidate.
   * This lets API-backed reading tasks beat the generic "search form"
   * bucket without adding a new public source-route enum.
   */
  searchListIntent?: boolean;
  /**
   * Whether the chooser has a replay-eligible Experience candidate
   * for this `(intent, pageRole)` bucket (i.e.
   * `experience_replay` would actually run). Drives priority-5.
   */
  experienceReplayAvailable?: boolean;
  /**
   * Set by upstream callers when stability invariants would lose
   * required fields at a shallower layer (e.g. portable replay args,
   * stable targetRef registry, click verifier inputs). When `true`,
   * the dispatcher MUST stay at `L0+L1+L2` regardless of any other
   * row. This is the priority-1 safety override.
   */
  safetyRequiresFullLayers?: boolean;
  /** Optional reason string surfaced when `safetyRequiresFullLayers` is set. */
  safetyReason?: string;
  /**
   * Optional whole-page byte length for token-estimate calculations.
   * Used by `estimateTokensFromBytes`. `0` / missing → token estimate
   * is `0` and the result's `tokensSavedEstimate` is also `0`.
   */
  fullReadByteLength?: number;
}

export interface LayerDispatchAlternative {
  layer: ReadPageRequestedLayer;
  reason: LayerDispatchReason;
  sourceRoute: LayerSourceRoute;
}

export interface LayerDispatchResult {
  chosenLayer: ReadPageRequestedLayer;
  reason: LayerDispatchReason;
  sourceRoute: LayerSourceRoute;
  /**
   * `ceil(byteLength/4)` token estimate for the chosen layer envelope.
   * Computed against the input's `fullReadByteLength` × per-layer
   * compression factor (see {@link layerByteFraction}). `0` when no
   * byte length was supplied.
   */
  tokenEstimate: number;
  /** Always present; mirrors `fullReadByteLength` so the chooser can derive `tokensSavedEstimate`. */
  fullReadTokenEstimate: number;
  /**
   * Other rows that ALSO matched, in the same priority order. Useful
   * for telemetry post-mortem ("we picked L0 but L0+L1 was also
   * eligible"). Never includes the row that won.
   */
  alternatives: LayerDispatchAlternative[];
  /**
   * `true` ONLY when the dispatcher selected the
   * `experience_replay_skip_read` source route (Strategy Table row 8
   * → kickoff binding). The caller is expected to skip
   * `chrome_read_page` entirely on this branch.
   */
  readPageAvoided: boolean;
  /** Populated only on the fail-safe branch; `''` otherwise. */
  fallbackCause: string;
}

// ---------------------------------------------------------------------------
// Internal — rule definitions
// ---------------------------------------------------------------------------

/**
 * Per-layer compression factor used to estimate `tokenEstimateChosen`.
 * The numbers are deliberately conservative ceilings against the
 * full-read byte length; tests rely on the SAME factors so a
 * regression in the dispatcher is visible in the V25-05 release gate.
 *
 * Source: V3.1 §V25-05 step 2 (L0 ≤ 35% of full read; L0+L1 ≤ 60%).
 * The dispatcher uses the upper bound from those gate thresholds so
 * an L0 result whose ACTUAL token count comes in lower will simply
 * widen the gap; an L0 result that comes in higher is a transformer
 * bug surfaced by the gate, not by the dispatcher.
 */
function layerByteFraction(layer: ReadPageRequestedLayer): number {
  switch (layer) {
    case 'L0':
      return 0.35;
    case 'L0+L1':
      return 0.6;
    case 'L0+L1+L2':
      return 1;
  }
}

interface DispatchRule {
  layer: ReadPageRequestedLayer;
  reason: LayerDispatchReason;
  sourceRoute: LayerSourceRoute;
  matches(input: NormalizedInput): boolean;
}

interface NormalizedInput {
  pageRole: string;
  userIntent: LayerDispatchUserIntentHint;
  taskType: LayerDispatchTaskType;
  candidateActionsCount: number;
  hvoCount: number;
  knowledgeAvailable: boolean;
  searchListIntent: boolean;
  experienceReplayAvailable: boolean;
  safetyRequiresFullLayers: boolean;
  safetyReason: string;
  fullReadByteLength: number;
}

const SAFE_REASON_FALLBACK: LayerDispatchReason = 'dispatcher_fallback_safe';
const SAFE_LAYER_FALLBACK: ReadPageRequestedLayer = 'L0+L1+L2';
const SAFE_ROUTE_FALLBACK: LayerSourceRoute = 'dispatcher_fallback_safe';

/**
 * Strategy table, one entry per row of V3.1 §V25-02. Order MATTERS —
 * the dispatcher walks the list top-to-bottom and returns the first
 * match. New rules MUST be inserted at the priority position they
 * belong to (the comment block above each block declares the priority).
 */
const RULES: readonly DispatchRule[] = Object.freeze([
  // ---------- priority 1 — safety override ----------
  {
    layer: 'L0+L1+L2',
    reason: 'safety_required_full_layers',
    sourceRoute: 'read_page_required',
    matches: (i) => i.safetyRequiresFullLayers,
  },

  // ---------- priority 2 — user intent override ----------
  {
    layer: 'L0',
    reason: 'knowledge_supports_summary',
    sourceRoute: 'knowledge_supported_read',
    matches: (i) => i.knowledgeAvailable && i.searchListIntent,
  },
  {
    layer: 'L0',
    reason: 'user_intent_summary',
    sourceRoute: 'read_page_required',
    matches: (i) => i.userIntent === 'summary',
  },
  {
    layer: 'L0+L1',
    reason: 'user_intent_open_or_select',
    sourceRoute: 'read_page_required',
    matches: (i) => i.userIntent === 'open_or_select',
  },
  {
    layer: 'L0+L1',
    reason: 'user_intent_form_or_submit',
    sourceRoute: 'read_page_required',
    matches: (i) => i.userIntent === 'form_or_submit',
  },
  {
    layer: 'L0+L1+L2',
    reason: 'user_intent_details_or_compare',
    sourceRoute: 'read_page_required',
    matches: (i) => i.userIntent === 'details',
  },

  // ---------- priority 3 — task type ----------
  {
    layer: 'L0',
    reason: 'task_type_reading_only',
    sourceRoute: 'read_page_required',
    matches: (i) => i.taskType === 'reading_only',
  },
  {
    layer: 'L0+L1',
    reason: 'task_type_action',
    sourceRoute: 'read_page_required',
    matches: (i) => i.taskType === 'action',
  },

  // ---------- priority 4 — page complexity ----------
  {
    layer: 'L0',
    reason: 'simple_page_low_density',
    sourceRoute: 'read_page_required',
    matches: (i) => i.candidateActionsCount <= 8 && i.hvoCount <= 5 && i.pageRole.length > 0,
  },
  {
    layer: 'L0+L1',
    reason: 'medium_page_overview',
    sourceRoute: 'read_page_required',
    matches: (i) => i.candidateActionsCount <= 40 && i.pageRole.length > 0,
  },
  {
    layer: 'L0+L1+L2',
    reason: 'complex_page_detail_required',
    sourceRoute: 'read_page_required',
    matches: (i) => i.candidateActionsCount > 40 && i.pageRole.length > 0,
  },

  // ---------- priority 5 — MKEP support ----------
  // Strategy Table row 8 (V3.1) — kickoff binding:
  //   `experience_replay` available + safe → chosenLayer='L0',
  //   sourceRoute='experience_replay_skip_read'. The caller decides
  //   whether to skip `chrome_read_page` based on `sourceRoute`.
  // NOTE: this rule is intentionally placed AFTER user-intent and
  // task-type so an explicit "details" override is honoured even
  // when replay is technically available — V25-04 stability
  // contract.
  {
    layer: 'L0',
    reason: 'experience_replay_executable',
    sourceRoute: 'experience_replay_skip_read',
    matches: (i) => i.experienceReplayAvailable,
  },
  {
    layer: 'L0',
    reason: 'knowledge_supports_summary',
    sourceRoute: 'knowledge_supported_read',
    matches: (i) => i.knowledgeAvailable && i.taskType === 'reading_only',
  },
  {
    layer: 'L0+L1',
    reason: 'knowledge_with_action',
    sourceRoute: 'knowledge_supported_read',
    matches: (i) => i.knowledgeAvailable,
  },
]);

// ---------------------------------------------------------------------------
// Internal — input normalization
// ---------------------------------------------------------------------------

function normalizeUserIntent(value: unknown): LayerDispatchUserIntentHint {
  if (
    value === 'summary' ||
    value === 'open_or_select' ||
    value === 'form_or_submit' ||
    value === 'details'
  ) {
    return value;
  }
  return 'unknown';
}

function normalizeTaskType(value: unknown): LayerDispatchTaskType {
  if (value === 'reading_only' || value === 'action') return value;
  return 'unknown';
}

function normalizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizeBool(value: unknown): boolean {
  return value === true;
}

function normalizeString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeInput(input: LayerDispatchInput): NormalizedInput | { error: string } {
  if (input === null || input === undefined || typeof input !== 'object') {
    return { error: 'input is not an object' };
  }
  return {
    pageRole: normalizeString(input.pageRole),
    userIntent: normalizeUserIntent(input.userIntent),
    taskType: normalizeTaskType(input.taskType),
    candidateActionsCount: normalizeCount(input.candidateActionsCount),
    hvoCount: normalizeCount(input.hvoCount),
    knowledgeAvailable: normalizeBool(input.knowledgeAvailable),
    searchListIntent: normalizeBool(input.searchListIntent),
    experienceReplayAvailable: normalizeBool(input.experienceReplayAvailable),
    safetyRequiresFullLayers: normalizeBool(input.safetyRequiresFullLayers),
    safetyReason: normalizeString(input.safetyReason),
    fullReadByteLength: normalizeCount(input.fullReadByteLength),
  };
}

// ---------------------------------------------------------------------------
// Internal — sanity guards (DO NOT remove; the test suite depends on them)
// ---------------------------------------------------------------------------

function ensureClosedEnumsAreInSync(): void {
  // Asserts at module load that every reason / route / layer used by
  // RULES is present in the shared closed-enum constant arrays. A
  // mistyped reason in this file would otherwise silently bypass the
  // V25-05 release gate.
  for (const rule of RULES) {
    if (!READ_PAGE_REQUESTED_LAYER_VALUES.includes(rule.layer)) {
      throw new Error(`layer-dispatch: unknown chosenLayer '${rule.layer}' in rule table`);
    }
    if (!LAYER_DISPATCH_REASON_VALUES.includes(rule.reason)) {
      throw new Error(`layer-dispatch: unknown reason '${rule.reason}' in rule table`);
    }
    if (!LAYER_SOURCE_ROUTE_VALUES.includes(rule.sourceRoute)) {
      throw new Error(`layer-dispatch: unknown sourceRoute '${rule.sourceRoute}' in rule table`);
    }
  }
}

ensureClosedEnumsAreInSync();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pure dispatcher entrypoint. NEVER throws on bad input — returns the
 * fail-safe `{ L0+L1+L2, dispatcher_fallback_safe, dispatcher_fallback_safe }`
 * triple so the chooser callsite always has a usable result.
 *
 * Programmer errors (e.g. a future change accidentally inserts a
 * rule with a typo'd reason) are still caught at module load by
 * `ensureClosedEnumsAreInSync`.
 */
export function dispatchLayer(input: LayerDispatchInput): LayerDispatchResult {
  const normalized = normalizeInput(input);
  if ('error' in normalized) {
    return buildFailSafe(0, normalized.error);
  }

  let chosen: DispatchRule | undefined;
  const alternatives: LayerDispatchAlternative[] = [];
  try {
    for (const rule of RULES) {
      if (!rule.matches(normalized)) continue;
      if (chosen === undefined) {
        chosen = rule;
        continue;
      }
      alternatives.push({
        layer: rule.layer,
        reason: rule.reason,
        sourceRoute: rule.sourceRoute,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailSafe(normalized.fullReadByteLength, `rule-eval threw: ${message}`);
  }

  if (chosen === undefined) {
    // No rule matched — happens when pageRole is missing AND no user
    // intent / task type / MKEP support is available. Fail-safe.
    return buildFailSafe(
      normalized.fullReadByteLength,
      normalized.pageRole.length === 0 ? 'pageRole_unknown' : 'no_rule_matched',
    );
  }

  const fullReadTokenEstimate = estimateTokensFromBytes(normalized.fullReadByteLength);
  const chosenBytes = Math.floor(normalized.fullReadByteLength * layerByteFraction(chosen.layer));
  const tokenEstimate = estimateTokensFromBytes(chosenBytes);

  return {
    chosenLayer: chosen.layer,
    reason: chosen.reason,
    sourceRoute: chosen.sourceRoute,
    tokenEstimate,
    fullReadTokenEstimate,
    alternatives,
    readPageAvoided: chosen.sourceRoute === 'experience_replay_skip_read',
    fallbackCause: '',
  };
}

function buildFailSafe(fullReadByteLength: number, cause: string): LayerDispatchResult {
  const fullReadTokenEstimate = estimateTokensFromBytes(fullReadByteLength);
  return {
    chosenLayer: SAFE_LAYER_FALLBACK,
    reason: SAFE_REASON_FALLBACK,
    sourceRoute: SAFE_ROUTE_FALLBACK,
    tokenEstimate: fullReadTokenEstimate,
    fullReadTokenEstimate,
    alternatives: [],
    readPageAvoided: false,
    fallbackCause: cause || 'unspecified',
  };
}

/**
 * Test-facing accessor — exposes the rule list so the strategy-table
 * test suite can iterate it without re-declaring the matrix in test
 * code. Treat as INTERNAL: production callers should only use
 * `dispatchLayer`.
 */
export function getLayerDispatchRulesForTesting(): readonly DispatchRule[] {
  return RULES;
}
