/**
 * V26-FIX-04 — Knowledge-driven endpoint lookup.
 *
 * Pure function module. Given a `DataNeed` and a structural
 * `EndpointKnowledgeReader` (`KnowledgeApiRepository` satisfies it),
 * picks the highest-scoring usable endpoint for the requested
 * `(site, semanticTypeWanted)` pair.
 *
 * This is the *replacement entry point* for `direct-api-executor`:
 * pre-FIX-04 the executor ran with a hardcoded
 * `resolveApiKnowledgeCandidate` (GitHub/npmjs literal table); FIX-04
 * inverts that — the lookup is now driven by what the Knowledge DB
 * actually observed (FIX-03 captures any `usable` JSON GET into
 * Knowledge under `family='observed'`), and the V25 GitHub/npmjs
 * adapter is downgraded to "builder hint after lookup hits" in
 * `safe-request-builder.ts`.
 *
 * Lookup contract:
 *   1. The `site` is derived from `dataNeed.urlHint` host. When the
 *      hint is missing or unparseable, we cannot look up anything and
 *      return `null` — the caller falls through to the legacy
 *      candidate path (which V26-FIX-05 will further constrain to
 *      `seed_adapter` compatibility).
 *   2. We only consider rows that the repository's
 *      `scoreEndpointKnowledge` already marked as `usableForTask`.
 *      `deprecated_seed` rows remain stored as evidence, but are not
 *      executable candidates. A `mutation`/`asset`/`auth`/etc.
 *      semantic type is never a read candidate — those branches are
 *      handled exclusively by the legacy DOM `chrome_read_page` chain.
 *   3. When `semanticTypeWanted` is non-null, we prefer rows whose
 *      `semanticType` matches; rows with a different (but still
 *      usable) semanticType are only returned with
 *      `semanticValidation='fail'` so the caller can record the
 *      evidence even though it still issues the request.
 *   4. Among matching rows the highest `confidence` wins; ties break
 *      on `sampleCount` (more observations → more reliable). We never
 *      pick a row with `confidence < CONFIDENCE_FLOOR` — the executor
 *      collapses that into `skipped_low_confidence` so the chooser
 *      can still try the legacy path or fall through to DOM L0+L1.
 */

import type {
  DataNeed,
  EndpointKnowledgeReader,
  EndpointLookupChosenReason,
  EndpointMatch,
} from './types';
import type {
  EndpointSource,
  ScoredKnowledgeApiEndpoint,
} from '../memory/knowledge/knowledge-api-repository';

/**
 * Floor below which a Knowledge endpoint is treated as "we don't
 * trust this enough to skip the browser". Calibrated to match the V25
 * candidate threshold (`DIRECT_API_HIGH_CONFIDENCE_THRESHOLD = 0.7`)
 * so a knowledge-driven hit is at least as conservative as the
 * pre-FIX-04 path. A row that the repository scored ≥ 0.7 already
 * required a `2xx` status class + a structured response shape + a
 * read-only semantic type, which is the same trust profile.
 */
export const KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR = 0.7;

/**
 * V27-08 — minimum sample count an `observed` row must accumulate
 * before the lookup is allowed to retire a `seed_adapter` peer in its
 * favour. Calibrated to match the brief: "稳定命中 = multiple
 * session/sample". Two samples is the smallest number that proves
 * the endpoint was reproducible (one observation could be a fluke).
 *
 * NOTE: this is a *retirement* gate, NOT a usability gate. An
 * observed row with `sampleCount=1` is still returned — we just do
 * not let it de-prioritise a seed_adapter peer based on a single
 * observation.
 */
export const KNOWLEDGE_OBSERVED_RETIREMENT_SAMPLE_FLOOR = 2;

/**
 * Look up the best candidate endpoint for the caller's `dataNeed`.
 * Returns `null` when:
 *   - the urlHint is missing / unparseable
 *   - the repository has no usable rows for that site
 *   - the highest-scoring row is below `KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR`
 *
 * The function performs no IO beyond a single `listScoredBySite`
 * call. It does not consult `Date.now()` and is therefore safe to
 * unit-test deterministically.
 */
export function lookupEndpointFamily(
  dataNeed: DataNeed,
  repo: EndpointKnowledgeReader,
): EndpointMatch | null {
  const site = deriveSiteFromUrlHint(dataNeed.urlHint);
  if (!site) return null;

  // Cap: we only ever evaluate the top-50 most recently observed
  // endpoints for a site. The repository already orders by confidence
  // → sampleCount → lastSeenAt, so the head of the list is always
  // the strongest candidate set.
  const scored = repo.listScoredBySite(site, 50);
  if (scored.length === 0) return null;

  const usable = scored.filter(
    (row) => row.usableForTask && row.endpointSource !== 'deprecated_seed',
  );
  if (usable.length === 0) return null;

  const wanted = dataNeed.semanticTypeWanted;
  let pool = wanted ? usable.filter((row) => row.semanticType === wanted) : usable.slice();

  // V26-FIX-04 — when no semanticType-matching row exists, fall
  // through to "any usable" but mark `semanticValidation='fail'`. The
  // caller still gets a result and the evidence contract records the
  // mismatch so a downstream post-mortem can group by it.
  let semanticValidation: EndpointMatch['semanticValidation'] = 'pass';
  if (pool.length === 0) {
    pool = usable.slice();
    semanticValidation = 'fail';
  }

  pool.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  // V27-08 — observed-vs-seed_adapter retirement.
  //
  // Brief: "如果同一 site family 的 observed endpoint 在多个
  // session/sample 中稳定命中，且 fallback rate 低，observed 应优先
  // 于 seed_adapter."
  //
  // We implement this as a *re-ranking* pass on top of the existing
  // confidence-first sort, never as a deletion. The seed_adapter row
  // is still returned when no qualifying observed peer exists; it
  // is only displaced when an observed peer meets the retirement
  // criteria (confidence ≥ floor + sample_count ≥ 2 + same
  // semantic_type as the leader). This keeps the seed adapter alive
  // as a compatibility safety net while making the observed lineage
  // visible in `chosenReason` / `retiredPeer`.
  const top = selectV2RankedTop(pool);
  if (!top) return null;
  if (top.candidate.confidence < KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR) return null;

  // V26-FIX-04 — the score we return is a deliberate copy of the
  // repository's `confidence`, with a small penalty when we had to
  // widen the semantic match. The penalty is large enough to
  // de-prioritize a `semanticValidation='fail'` hit relative to a
  // pass-validated peer at the same confidence, and small enough that
  // a strong observed endpoint still beats the legacy candidate's
  // 0.7 floor.
  const score =
    semanticValidation === 'pass'
      ? top.candidate.confidence
      : Math.max(0, top.candidate.confidence - 0.05);
  if (score < KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR) return null;

  // V27-08 — single-session correlation never escalates. The lookup
  // surfaces whatever the row recorded, but caps `'high_confidence'`
  // back to `'low_confidence'` so a hypothetical mis-write at the
  // writer cannot leak through. V27-08 multi-session escalation is
  // out of scope for this task and would re-write the row at the
  // repository, not at the lookup.
  const correlationConfidence = capSingleSessionCorrelation(top.candidate.correlationConfidence);

  const retiredPeer = top.retired
    ? {
        endpointSource: top.retired.endpointSource,
        endpointSignature: top.retired.endpointSignature,
        confidence: top.retired.confidence,
        sampleCount: top.retired.sampleCount,
      }
    : null;

  return {
    endpoint: top.candidate,
    semanticValidation,
    score,
    endpointSource: top.candidate.endpointSource,
    correlationConfidence,
    retiredPeer,
    chosenReason: top.chosenReason,
  };
}

interface V2RankPick {
  candidate: ScoredKnowledgeApiEndpoint;
  retired: ScoredKnowledgeApiEndpoint | null;
  chosenReason: EndpointLookupChosenReason;
}

/**
 * V27-08 — pick the leader from a confidence-sorted pool, applying
 * the observed-vs-seed_adapter retirement criteria.
 *
 * Selection algorithm:
 *   1. The pool is already sorted by confidence → sampleCount →
 *      lastSeenAt (the legacy V26-FIX-04 sort).
 *   2. We classify rows by `endpointSource` and pull the strongest
 *      `observed` peer and the strongest `seed_adapter` peer.
 *   3. When both peers are present:
 *        - If the observed peer meets the retirement criteria
 *          (confidence ≥ floor + sample_count ≥ 2 + same
 *          semanticType as the seed peer's row), the observed peer
 *          wins and the seed peer is recorded as `retired`.
 *        - Otherwise we keep the legacy ordering: whichever the
 *          confidence-sorted pool already put first wins, and no
 *          row is retired.
 *   4. When only one peer is present (or only `manual_seed` /
 *      `unknown` rows), we return the pool's leader unchanged.
 */
function selectV2RankedTop(pool: ScoredKnowledgeApiEndpoint[]): V2RankPick | null {
  const leader = pool[0];
  if (!leader) return null;

  const observedPeer = pool.find((row) => row.endpointSource === 'observed') ?? null;
  const seedPeer = pool.find((row) => row.endpointSource === 'seed_adapter') ?? null;

  // Nothing to compare — return the leader with a generic reason.
  if (!observedPeer && !seedPeer) {
    return { candidate: leader, retired: null, chosenReason: 'best_available' };
  }

  // Only an observed peer (or observed leader) is available.
  if (observedPeer && !seedPeer) {
    if (leader.endpointSource === 'observed') {
      return {
        candidate: leader,
        retired: null,
        chosenReason:
          leader.confidence >= KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR
            ? 'observed_only_match'
            : 'best_available',
      };
    }
    // The leader is e.g. a `manual_seed` / `unknown` row that out-scores
    // the observed peer. Keep the leader; lineage will surface as the
    // leader's own `endpointSource`.
    return { candidate: leader, retired: null, chosenReason: 'best_available' };
  }

  // Only a seed_adapter peer is available — the legacy V26-FIX-04
  // path. Keep the leader (which is the seed_adapter row when it is
  // the strongest in the pool).
  if (!observedPeer && seedPeer) {
    return {
      candidate: leader,
      retired: null,
      chosenReason:
        leader.endpointSource === 'seed_adapter' ? 'seed_adapter_fallback' : 'best_available',
    };
  }

  // Both observed and seed peers exist — apply the retirement gate.
  // TypeScript narrowing: both are non-null in this branch.
  const obs = observedPeer as ScoredKnowledgeApiEndpoint;
  const seed = seedPeer as ScoredKnowledgeApiEndpoint;

  const observedQualifiesForRetirement =
    obs.confidence >= KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR &&
    obs.sampleCount >= KNOWLEDGE_OBSERVED_RETIREMENT_SAMPLE_FLOOR &&
    obs.semanticType === seed.semanticType;

  if (observedQualifiesForRetirement) {
    // Promote the observed peer over the seed peer, regardless of
    // who the legacy sort put first. The seed row is recorded as
    // retired but not deleted.
    return {
      candidate: obs,
      retired: seed,
      chosenReason: 'observed_preferred_over_seed_adapter',
    };
  }

  // Observed peer did not qualify — fall back to the legacy
  // confidence-sorted leader. When the leader is the seed peer
  // (because the observed peer's sampleCount or confidence is too
  // low), surface that with the `seed_adapter_fallback` reason so
  // the report can tell why we did not retire.
  if (leader.endpointSource === 'seed_adapter') {
    return {
      candidate: leader,
      retired: null,
      chosenReason: 'seed_adapter_fallback',
    };
  }
  if (leader.endpointSource === 'observed') {
    return {
      candidate: leader,
      retired: null,
      chosenReason:
        leader.confidence >= KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR
          ? 'observed_high_confidence'
          : 'best_available',
    };
  }
  return { candidate: leader, retired: null, chosenReason: 'best_available' };
}

function capSingleSessionCorrelation(
  value: EndpointMatch['correlationConfidence'],
): EndpointMatch['correlationConfidence'] {
  if (value === 'high_confidence') return 'low_confidence';
  return value;
}

/**
 * V27-08 — exported for tests / future telemetry. The lookup
 * normalises an `EndpointSource` value before publishing so a
 * legacy NULL stored at the row level still ranks correctly.
 */
export function isObservedSource(value: EndpointSource | null | undefined): boolean {
  return value === 'observed';
}

/**
 * Internal — derives the `site` Knowledge row key from the URL the
 * user is currently on. `KnowledgeApiRepository` keys on the *host*
 * (lower-cased), and `api-knowledge-capture.ts` writes the same key,
 * so this normalisation must stay in lockstep.
 *
 * Returns `null` when the url is missing / unparseable so the caller
 * can fall back to the legacy candidate path.
 */
function deriveSiteFromUrlHint(urlHint: string | null): string | null {
  if (!urlHint) return null;
  try {
    const parsed = new URL(urlHint);
    const host = parsed.hostname.trim().toLowerCase();
    if (!host) return null;
    return host;
  } catch {
    return null;
  }
}
