/**
 * V27-07 — DOM-Endpoint Correlator.
 *
 * Pure module. Given:
 *   - a set of v2.7 `EndpointObservation`s (each one is an
 *     `EndpointCandidate` (V27-06) PLUS the network completion time
 *     and a stable id derived from the endpoint pattern),
 *   - an action timing descriptor (V27-03 `ActionOutcome` arming
 *     time + settle window + the click region tag if known),
 *   - a `DomChangeSummary` (the diff between the pre-action and
 *     post-action DOM region fingerprints — V27-02 `DomRegionFingerprint`
 *     `regionHashes` keys whose hash changed),
 *
 * the correlator returns `DomEndpointCorrelationCandidate[]` — one
 * entry per in-window endpoint, with a closed-enum confidence verdict.
 *
 * Invariants enforced by this module:
 *
 *   1. Single-session correlation NEVER returns a high-confidence
 *      verdict. The closed enum here tops out at `'low_confidence'`.
 *      V27-08 owns the multi-session escalation to high confidence.
 *   2. Only `click` actions are armed for partial-update correlation
 *      today (Batch A only proved click outcomes). Other action kinds
 *      produce metadata-only candidates so absence is visible to V27-08
 *      lineage.
 *   3. If the action produced no DOM change at all, in-window endpoints
 *      become `metadata_only` candidates — they are still recorded so
 *      V27-08 can later say "we observed this endpoint after a click,
 *      but it did not change the page".
 *   4. If multiple endpoints completed in the same settle window, we
 *      flag `'multi_endpoint_in_window'` and cap every candidate at
 *      `unknown_candidate` (no clean attribution). V27-08 must NOT
 *      treat any of them as a confident region owner.
 *   5. If every observed region changed (full re-render), region
 *      attribution is unsafe; candidates get `correlatedRegionId: null`
 *      and `'metadata_only'` source.
 *   6. Noise / error / unknown_candidate endpoints are excluded from
 *      correlation entirely (they would only inflate false-positive
 *      risk). They are NOT returned in the candidate list — V27-06
 *      already classified them.
 *
 * Privacy: this module never sees DOM raw text, response values, header
 * values, or raw query values. Inputs are closed-enum buckets, region
 * tag names (already brand-neutral, fingerprint-side controlled), and
 * counts. Outputs are the same.
 */

import type { ActionKind } from '@tabrix/shared';
import type {
  EndpointCandidate,
  EndpointCandidateSemanticType,
} from './network-observe-classifier';

/**
 * Closed-enum confidence the V27-07 correlator is allowed to emit.
 * Single-session correlation NEVER reaches high confidence — V27-08
 * is the authority for multi-session escalation.
 */
export type CorrelationConfidence = 'unknown_candidate' | 'low_confidence';

export const CORRELATION_CONFIDENCES = [
  'unknown_candidate',
  'low_confidence',
] as const satisfies ReadonlyArray<CorrelationConfidence>;

/**
 * Closed-enum source of the correlation verdict. The brief allows
 * either `click_partial_update` (the click action produced a single
 * clean region change), `metadata_only` (we have endpoint metadata
 * but no DOM-side correlation), or `unknown` (correlation skipped —
 * e.g. action kind not yet armed).
 */
export type CorrelationSource = 'click_partial_update' | 'metadata_only' | 'unknown';

export const CORRELATION_SOURCES = [
  'click_partial_update',
  'metadata_only',
  'unknown',
] as const satisfies ReadonlyArray<CorrelationSource>;

/**
 * Closed-enum signal tags that may have contributed to a correlation
 * verdict. These are the *only* facts the correlator is allowed to
 * cite — extending this enum is a v2.7 schema-cite event.
 */
export type CorrelationSignalTag =
  | 'within_settle_window'
  | 'single_region_changed'
  | 'multi_region_changed'
  | 'no_region_change'
  | 'multi_endpoint_in_window'
  | 'action_region_tag_match'
  | 'full_rerender'
  | 'action_kind_unsupported';

export const CORRELATION_SIGNAL_TAGS = [
  'within_settle_window',
  'single_region_changed',
  'multi_region_changed',
  'no_region_change',
  'multi_endpoint_in_window',
  'action_region_tag_match',
  'full_rerender',
  'action_kind_unsupported',
] as const satisfies ReadonlyArray<CorrelationSignalTag>;

/**
 * V27-07 — pairing of an `EndpointCandidate` (V27-06) with the
 * completion timing the V27-02 fact collector observed. The runtime
 * builds `EndpointObservation`s by matching `NetworkRequestFact`s
 * against captured-bundle candidates by host+path+observedAtMs.
 */
export interface EndpointObservation {
  /** Stable handle for the endpoint pattern. The repository
   *  (V27-08) uses this as the lookup key. */
  endpointId: string;
  /** Brand-neutral host+path pattern, e.g. `api.example.test/v1/items`. */
  endpointPattern: string;
  /** Closed-enum semantic verdict V27-06 already produced. */
  semanticType: EndpointCandidateSemanticType;
  /** Producer wallclock for the network completion (ms). */
  observedAtMs: number;
  /** HTTP status code, when known. */
  status: number | null;
  /** Echo of the V27-06 candidate so V27-08 lineage can stamp the
   *  shape evidence level alongside the correlation outcome. */
  candidate: EndpointCandidate;
}

/**
 * V27-07 — action timing descriptor. The `settleWindowMs` is the
 * post-action observation window we trust for correlation; outside
 * that window, an endpoint completion is unrelated to the action.
 *
 * `actionRegionTag` is the optional brand-neutral region tag the
 * V27-03 action-outcome envelope carried (e.g. the click target's
 * region tag). When present, a single-region change that matches
 * `actionRegionTag` gets a small confidence boost.
 */
export interface ActionTimingDescriptor {
  actionId: string;
  actionKind: ActionKind;
  observedAtMs: number;
  settleWindowMs: number;
  actionRegionTag?: string | null;
}

/**
 * V27-07 — pre-summarised DOM change descriptor. Producer hashes the
 * pre/post `DomRegionFingerprint.regionHashes` and reports only:
 *   - which region tags changed (names only),
 *   - how many regions were observed in the post-action snapshot
 *     (used to detect full-rerender ambiguity).
 *
 * No raw text, no innerText, no per-region content size.
 */
export interface DomChangeSummary {
  /** Brand-neutral region tag names whose hash changed. */
  changedRegionTags: readonly string[];
  /** Total observed regions in the post-action snapshot. */
  totalRegionsObserved: number;
}

/**
 * V27-07 — output candidate. Field names follow the brief's recommended
 * shape; V27-08 lineage reads `correlationSource` + `correlationConfidence`
 * to decide whether a row may be promoted out of `unknown_candidate`.
 */
export interface DomEndpointCorrelationCandidate {
  actionId: string;
  endpointId: string;
  endpointPattern: string;
  semanticType: EndpointCandidateSemanticType;
  /** Brand-neutral region tag the endpoint is correlated with, or
   *  `null` when no clean attribution was possible. */
  correlatedRegionId: string | null;
  /** Closed-enum signals the verdict was derived from. */
  correlationSignals: readonly CorrelationSignalTag[];
  correlationConfidence: CorrelationConfidence;
  correlationSource: CorrelationSource;
  /** Clamped `[0, 1]` false-positive risk. Higher = less trustworthy. */
  falsePositiveRisk: number;
}

/**
 * V27-07 — input bag for the correlator. Pure: no side effects.
 */
export interface CorrelateDomEndpointsInput {
  observations: readonly EndpointObservation[];
  action: ActionTimingDescriptor;
  domChange: DomChangeSummary;
}

const CORRELATABLE_SEMANTIC_TYPES: ReadonlySet<EndpointCandidateSemanticType> = new Set([
  'search',
  'list',
  'detail',
  'pagination',
  'filter',
  'document',
  'empty',
]);

/**
 * V27-07 — entry point. Returns one candidate per in-window
 * correlatable endpoint. Endpoints that fall outside the action
 * settle window are NOT returned (the correlator has no opinion on
 * them). Endpoints in window but with a `noise` / `error` /
 * `unknown_candidate` semantic type are NOT returned (V27-06 already
 * classified them and we do not want to inflate false-positive risk).
 */
export function correlateDomEndpoints(
  input: CorrelateDomEndpointsInput,
): DomEndpointCorrelationCandidate[] {
  const { action, domChange } = input;
  const windowStart = action.observedAtMs;
  const windowEnd = action.observedAtMs + Math.max(0, action.settleWindowMs);

  // Step 1 — filter to in-window correlatable observations.
  const inWindow = input.observations.filter(
    (o) =>
      o.observedAtMs >= windowStart &&
      o.observedAtMs <= windowEnd &&
      CORRELATABLE_SEMANTIC_TYPES.has(o.semanticType),
  );
  if (inWindow.length === 0) return [];

  const multiEndpoint = inWindow.length > 1;
  const changedTags = uniqueOrdered(domChange.changedRegionTags);
  const noChange = changedTags.length === 0;
  const totalRegions = Math.max(0, domChange.totalRegionsObserved);
  const fullRerender = totalRegions > 0 && changedTags.length >= totalRegions;

  // Step 2 — short-circuit when the action kind is not yet armed for
  //          partial-update correlation. We still produce candidates
  //          (so V27-08 can see "we observed these endpoints after a
  //          fill action" instead of silently dropping them) but the
  //          source is `'unknown'` and no region attribution happens.
  const supportedActionKinds: ReadonlySet<ActionKind> = new Set(['click']);
  if (!supportedActionKinds.has(action.actionKind)) {
    return inWindow.map((o) =>
      buildCandidate(o, action, {
        signals: ['within_settle_window', 'action_kind_unsupported'],
        correlatedRegionId: null,
        correlationConfidence: 'unknown_candidate',
        correlationSource: 'unknown',
        falsePositiveRisk: 0.5,
      }),
    );
  }

  // Step 3 — full re-render is too noisy to attribute. Every endpoint
  //          becomes a metadata-only candidate.
  if (fullRerender) {
    return inWindow.map((o) =>
      buildCandidate(o, action, {
        signals: ['within_settle_window', 'full_rerender'],
        correlatedRegionId: null,
        correlationConfidence: 'unknown_candidate',
        correlationSource: 'metadata_only',
        falsePositiveRisk: 0.7,
      }),
    );
  }

  // Step 4 — no DOM change. We do NOT fabricate a region; we record
  //          the candidates as `metadata_only` so V27-08 can later
  //          report "endpoint observed after click, no DOM change".
  if (noChange) {
    return inWindow.map((o) =>
      buildCandidate(o, action, {
        signals: ['within_settle_window', 'no_region_change'],
        correlatedRegionId: null,
        correlationConfidence: 'unknown_candidate',
        correlationSource: 'metadata_only',
        falsePositiveRisk: 0.4,
      }),
    );
  }

  // Step 5 — multiple endpoints fired in the window. We cannot pick a
  //          winner inside one session. Every endpoint becomes
  //          `unknown_candidate` (NOT `low_confidence`) so V27-08
  //          refuses to escalate any of them.
  if (multiEndpoint) {
    const tagsHint = changedTags.length === 1 ? changedTags[0] : null;
    return inWindow.map((o) =>
      buildCandidate(o, action, {
        signals: tagsHint
          ? ['within_settle_window', 'multi_endpoint_in_window', 'single_region_changed']
          : ['within_settle_window', 'multi_endpoint_in_window', 'multi_region_changed'],
        correlatedRegionId: null,
        correlationConfidence: 'unknown_candidate',
        correlationSource: 'metadata_only',
        falsePositiveRisk: 0.6,
      }),
    );
  }

  // Step 6 — single endpoint, single region change. The cleanest case.
  //          We may upgrade to `low_confidence` and stamp the changed
  //          region as the correlated region. If the action carried a
  //          region tag and it matches the changed region, add the
  //          `action_region_tag_match` signal and lower the false-
  //          positive risk a touch.
  const obs = inWindow[0];
  if (changedTags.length === 1) {
    const changedTag = changedTags[0];
    const tagMatches = !!action.actionRegionTag && action.actionRegionTag === changedTag;
    return [
      buildCandidate(obs, action, {
        signals: tagMatches
          ? ['within_settle_window', 'single_region_changed', 'action_region_tag_match']
          : ['within_settle_window', 'single_region_changed'],
        correlatedRegionId: changedTag,
        correlationConfidence: 'low_confidence',
        correlationSource: 'click_partial_update',
        falsePositiveRisk: tagMatches ? 0.2 : 0.3,
      }),
    ];
  }

  // Step 7 — single endpoint, multi-region change (but not full
  //          re-render). Use the action region tag if present and it
  //          intersects the changed set, otherwise stay `null`.
  const intersect =
    action.actionRegionTag && changedTags.includes(action.actionRegionTag)
      ? action.actionRegionTag
      : null;
  return [
    buildCandidate(obs, action, {
      signals: intersect
        ? ['within_settle_window', 'multi_region_changed', 'action_region_tag_match']
        : ['within_settle_window', 'multi_region_changed'],
      correlatedRegionId: intersect,
      correlationConfidence: 'low_confidence',
      correlationSource: 'click_partial_update',
      falsePositiveRisk: intersect ? 0.4 : 0.5,
    }),
  ];
}

function buildCandidate(
  obs: EndpointObservation,
  action: ActionTimingDescriptor,
  parts: {
    signals: readonly CorrelationSignalTag[];
    correlatedRegionId: string | null;
    correlationConfidence: CorrelationConfidence;
    correlationSource: CorrelationSource;
    falsePositiveRisk: number;
  },
): DomEndpointCorrelationCandidate {
  return {
    actionId: action.actionId,
    endpointId: obs.endpointId,
    endpointPattern: obs.endpointPattern,
    semanticType: obs.semanticType,
    correlatedRegionId: parts.correlatedRegionId,
    correlationSignals: parts.signals,
    correlationConfidence: parts.correlationConfidence,
    correlationSource: parts.correlationSource,
    falsePositiveRisk: clamp01(parts.falsePositiveRisk),
  };
}

function uniqueOrdered<T>(xs: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
