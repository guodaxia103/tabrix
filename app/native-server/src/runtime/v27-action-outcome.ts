/**
 * V27-03 — Tabrix v2.7 Action Outcome Classifier (native runtime side).
 *
 * Pure, in-memory, deterministic. Given an `ActionOutcomeEventEnvelope`
 * (action descriptor + a typed signal timeline produced by the v2.7
 * race observer in the extension), this module returns an
 * `ActionOutcomeSnapshot` carrying:
 *
 *   - `outcome`              — closed-enum verdict (V27-03 enum from
 *                              `@tabrix/shared`, includes `'ambiguous'`,
 *                              `'multiple_signals'`, `'unknown'`).
 *   - `outcomeConfidence`    — clamped `[0, 1]` float. The operation-log
 *                              writer formats it as `'0.00'..'1.00'` for
 *                              the `outcomeConfidence` metadata key
 *                              (declared by V27-00).
 *   - `observedSignalKinds`  — deduplicated, sorted closed-enum signal
 *                              kinds that fired in the settle window.
 *
 * Boundary:
 * - No I/O. No bridge calls. No DOM access. The classifier is a pure
 *   function over its envelope; the extension-side observer is the
 *   only producer of `ActionSignal[]` records.
 * - No reliance on the raw URL: the producer pre-summarises into
 *   `urlPattern` / `host` / `pathPattern`. The runtime never inspects
 *   any string for sensitive content; persistence-side redaction stays
 *   the belt-and-suspenders defence (V27-00 PrivacyGate).
 * - All inputs and outputs are closed-enum bags (`ACTION_KINDS`,
 *   `ACTION_SIGNAL_KINDS`, `ACTION_OUTCOMES`); the V27-00
 *   `RequireUnknownFallback` invariant pins `'unknown'` as a member of
 *   each.
 *
 * Confidence model (calibrated against the SoT V2 acceptance scenarios
 * described in the V27-03 plan section, not against real-browser Gate
 * evidence — that stays owner-lane):
 *
 *   - A single corroborating signal in the closed allowlist scores
 *     0.85.
 *   - Two corroborating signals (e.g. navigation + dom region change)
 *     score 0.95.
 *   - A signal kind that does not match any verdict bucket lowers the
 *     verdict confidence by 0.1 per stray signal, floored at 0.6 so
 *     `'ambiguous'` never collapses below the V27-00 confidence floor.
 *   - `no_observed_change` (empty timeline) returns 1.0 — the absence
 *     of signals is itself a strong claim.
 *   - Anything outside the allowlist falls through to `'unknown'`
 *     with confidence 0.0.
 */

import type {
  ActionKind,
  ActionOutcome,
  ActionOutcomeEventEnvelope,
  ActionOutcomeSnapshot,
  ActionSignal,
  ActionSignalKind,
} from '@tabrix/shared';

/** Default settle window the classifier honours when the caller does
 *  not pass one explicitly. The producer is expected to stop emitting
 *  signals once this window has elapsed; the classifier additionally
 *  drops signals beyond it as a defensive guard. */
export const ACTION_OUTCOME_DEFAULT_SETTLE_WINDOW_MS = 1_500;

/** Lower bound on the classifier's reported confidence. Anything below
 *  this floor would conflict with the V27-00 `lifecycleConfidence`
 *  expectations elsewhere in the runtime. */
export const ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE = 0.6;

export interface ClassifyOptions {
  /** Override the settle window in ms. Defaults to
   *  `ACTION_OUTCOME_DEFAULT_SETTLE_WINDOW_MS`. */
  settleWindowMs?: number;
  /** Producer wallclock for the snapshot. Defaults to
   *  `Date.now()`. Tests should pin this. */
  now?: () => number;
}

/**
 * Classify an action outcome from the timeline of signals observed
 * after the action. Pure: same envelope -> same snapshot.
 */
export function classifyActionOutcome(
  envelope: ActionOutcomeEventEnvelope,
  options: ClassifyOptions = {},
): ActionOutcomeSnapshot {
  const settle = options.settleWindowMs ?? ACTION_OUTCOME_DEFAULT_SETTLE_WINDOW_MS;
  const now = options.now ? options.now() : Date.now();
  const cutoff = envelope.observedAtMs + Math.max(0, settle);

  const validSignals = envelope.signals.filter(
    (s) => s.observedAtMs >= envelope.observedAtMs && s.observedAtMs <= cutoff,
  );

  const observedSignalKinds = dedupeSorted(validSignals.map((s) => s.kind));

  if (validSignals.length === 0) {
    return {
      actionId: envelope.actionId,
      outcome: 'no_observed_change',
      outcomeConfidence: 1.0,
      observedSignalKinds,
      producedAtMs: now,
    };
  }

  const verdict = chooseVerdict(envelope.actionKind, validSignals);
  return {
    actionId: envelope.actionId,
    outcome: verdict.outcome,
    outcomeConfidence: clamp01(verdict.confidence),
    observedSignalKinds,
    producedAtMs: now,
  };
}

/** Closed-enum check: is this kind a v2.7 signal we know how to
 *  reason about? Defensive guard for envelopes produced by a future
 *  schema generation that rolls back to this binary. */
export function isKnownActionSignalKind(kind: ActionSignalKind): boolean {
  return KNOWN_SIGNAL_KINDS.has(kind);
}

const KNOWN_SIGNAL_KINDS: ReadonlySet<ActionSignalKind> = new Set<ActionSignalKind>([
  'lifecycle_committed',
  'tab_created',
  'dom_region_changed',
  'network_completed',
  'dialog_opened',
]);

interface VerdictResult {
  outcome: ActionOutcome;
  confidence: number;
}

/**
 * Bucket the timeline into the V27-03 closed-enum verdicts. The
 * algorithm prefers a strong single-signal match; only when more than
 * one orthogonal verdict fires does it fall back to
 * `'multiple_signals'`. Any unknown signal kind drops the confidence
 * by a fixed amount, eventually collapsing to `'ambiguous'`.
 */
function chooseVerdict(_actionKind: ActionKind, signals: ActionSignal[]): VerdictResult {
  let hasNavigation = false;
  let hasNewTab = false;
  let hasDomRegion = false;
  let hasNetwork = false;
  let hasDialog = false;
  let unknownCount = 0;

  for (const s of signals) {
    if (!isKnownActionSignalKind(s.kind)) {
      unknownCount++;
      continue;
    }
    switch (s.kind) {
      case 'lifecycle_committed':
        hasNavigation = true;
        break;
      case 'tab_created':
        hasNewTab = true;
        break;
      case 'dom_region_changed':
        hasDomRegion = true;
        break;
      case 'network_completed':
        hasNetwork = true;
        break;
      case 'dialog_opened':
        hasDialog = true;
        break;
    }
  }

  const verdictBuckets: ActionOutcome[] = [];
  if (hasNavigation && !hasNewTab) verdictBuckets.push('navigated_same_tab');
  if (hasNewTab) verdictBuckets.push('navigated_new_tab');
  if (hasDialog) verdictBuckets.push('modal_opened');
  if (hasDomRegion && !hasNavigation && !hasNewTab && !hasDialog)
    verdictBuckets.push('spa_partial_update');

  // Network on its own is too weak to call a verdict — every page
  // emits ambient XHR/fetch traffic. We only treat it as an
  // SPA-partial-update reinforcer (handled below by the confidence
  // boost) and otherwise as an ambiguity signal.
  const hasOnlyNetwork = hasNetwork && verdictBuckets.length === 0;

  if (verdictBuckets.length === 0) {
    if (hasOnlyNetwork) {
      return {
        outcome: 'ambiguous',
        confidence: Math.max(ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE, 0.7 - 0.1 * unknownCount),
      };
    }
    if (unknownCount > 0) {
      return { outcome: 'unknown', confidence: 0 };
    }
    return { outcome: 'no_observed_change', confidence: 1 };
  }

  const dedupedBuckets = dedupeSorted(verdictBuckets);
  if (dedupedBuckets.length > 1) {
    return {
      outcome: 'multiple_signals',
      confidence: Math.max(ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE, 0.85 - 0.1 * unknownCount),
    };
  }

  const single = dedupedBuckets[0];

  // Confidence base: 0.85 for a single matching verdict bucket.
  let confidence = 0.85;

  // Reinforcement: another corroborating signal (e.g.
  // navigation + dom_region_changed for a server-rendered nav, or
  // spa_partial_update + network) lifts the score to 0.95.
  if (single === 'navigated_same_tab' && hasDomRegion) confidence = 0.95;
  if (single === 'spa_partial_update' && hasNetwork) confidence = 0.95;

  // Each unknown stray signal subtracts a fixed amount, floored at
  // ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE so the verdict never
  // collapses below the runtime's ambiguity floor.
  if (unknownCount > 0) {
    confidence = Math.max(ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE, confidence - 0.1 * unknownCount);
  }

  return { outcome: single, confidence };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function dedupeSorted<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort() as T[];
}

// ---------------------------------------------------------------------------
// V27-03 — DOM region inclusion/exclusion hash rule
// ---------------------------------------------------------------------------

/**
 * Closed-enum tag for a DOM region signal the producer wants the
 * runtime to weigh when classifying an action outcome. The producer
 * (the extension's `observers/action-outcome.ts` race observer) maps
 * raw DOM observations onto these tags before sending; the runtime
 * never receives a raw HTML string or selector.
 */
export type DomRegionSignalTag =
  // Stable, action-relevant signals — included in the fingerprint.
  | 'text'
  | 'attribute'
  | 'children_count'
  | 'visibility'
  | 'list_item_count'
  // Volatile or attacker-controlled signals — excluded from the
  // fingerprint, even if the producer accidentally sends them.
  | 'dynamic_id'
  | 'timestamp'
  | 'ad_slot'
  | 'skeleton'
  | 'random_token'
  | 'unknown';

const INCLUDED_REGION_TAGS: ReadonlySet<DomRegionSignalTag> = new Set<DomRegionSignalTag>([
  'text',
  'attribute',
  'children_count',
  'visibility',
  'list_item_count',
]);

const EXCLUDED_REGION_TAGS: ReadonlySet<DomRegionSignalTag> = new Set<DomRegionSignalTag>([
  'dynamic_id',
  'timestamp',
  'ad_slot',
  'skeleton',
  'random_token',
]);

export interface DomRegionTaggedSignal {
  tag: DomRegionSignalTag;
  /** Pre-summarised brand-neutral signal (e.g. `"items=14"`). The
   *  runtime never inspects the string content beyond exact equality. */
  value: string;
}

export interface RegionSignalSelectionResult {
  included: DomRegionTaggedSignal[];
  excluded: DomRegionTaggedSignal[];
}

/**
 * Pure helper that splits a producer-side region-signal bag into
 * "include in DOM hash" vs "drop". The split is deterministic — the
 * same bag always produces the same partition — and is the V27-03
 * contract surface tested by the hash-rule golden tests.
 *
 * Unknown / unmapped tags are dropped (defensive default). The
 * producer must update this allowlist explicitly to add a new region
 * signal, which is the v2.7 schema-cite discipline.
 */
export function selectDomRegionSignalsForOutcome(
  signals: DomRegionTaggedSignal[],
): RegionSignalSelectionResult {
  const included: DomRegionTaggedSignal[] = [];
  const excluded: DomRegionTaggedSignal[] = [];
  for (const s of signals) {
    if (INCLUDED_REGION_TAGS.has(s.tag)) {
      included.push(s);
    } else {
      // Both EXCLUDED_REGION_TAGS and unknown tags fall through here;
      // we keep them in `excluded` for observability/debug, but the
      // hash should ignore them.
      excluded.push(s);
    }
  }
  return { included, excluded };
}

/** Visible-for-tests guard so the golden-test suite can assert the
 *  documented allowlist without re-importing private constants. */
export function describeDomRegionSelectionRule(): {
  included: DomRegionSignalTag[];
  excluded: DomRegionSignalTag[];
} {
  return {
    included: [...INCLUDED_REGION_TAGS].sort(),
    excluded: [...EXCLUDED_REGION_TAGS].sort(),
  };
}
