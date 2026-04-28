/**
 * V26-FIX-04 — internal DTOs for the knowledge-driven on-demand reader.
 *
 * These types live in the new `api-knowledge/` namespace (not under
 * `api/api-knowledge.ts`, which is the V25 hardcoded seed adapter) and
 * are shared by `endpoint-lookup.ts`, `safe-request-builder.ts`, and
 * the upgraded `direct-api-executor.ts`. They are explicitly NOT
 * exported from `packages/shared` — every type here is a process-local
 * implementation detail.
 *
 * Privacy contract: every public field below is shape-only. `params`
 * carries user-supplied query *values* (e.g. a search string the user
 * typed into the chooser), but never raw cookie / auth / response
 * bodies, and the executor never persists them past the in-memory
 * request build. The lookup never reads request/response *bodies* —
 * it only consumes the redacted `KnowledgeApiEndpoint` rows already
 * stored in the Memory DB.
 */

import type {
  CorrelationConfidenceLevel,
  EndpointSemanticType,
  EndpointSource,
  KnowledgeApiEndpoint,
} from '../memory/knowledge/knowledge-api-repository';

/**
 * Coarse "what does the caller want to read" descriptor. Mirrors the
 * V25-02 layer-dispatch hints but stays internal to the api-knowledge
 * layer so a future strategy-table change does not leak into the
 * public chooser schema.
 *
 * `semanticTypeWanted` is a *closed-enum hint* — the lookup uses it to
 * pick between e.g. `search` and `list` rows for the same site. When
 * `null`, the lookup falls back to "any usable read" semantics.
 */
export interface DataNeed {
  /** Lower-cased intent text the chooser already normalized. */
  intent: string;
  /** Same closed enum the executor's gate already uses. */
  intentClass: 'read_only' | 'action' | 'unknown';
  /** Closed-enum semantic type the caller is looking for; `null` = any. */
  semanticTypeWanted: 'search' | 'list' | 'detail' | 'pagination' | 'filter' | null;
  /** URL the user is already on. Used to derive the `site` for lookup. */
  urlHint: string | null;
  /** Optional V25-02 page-role hint (`issues_list`, `package_detail`, …). */
  pageRole: string | null;
  /**
   * Optional caller-supplied parameter map (e.g. `{ query: 'tabrix' }`).
   * The safe-request-builder maps these into the looked-up endpoint's
   * actual query keys; never persisted.
   */
  params?: Readonly<Record<string, string | number | null | undefined>>;
}

/**
 * V26-FIX-04 — minimal subset of `KnowledgeApiRepository` the lookup
 * actually needs. Declared as a structural type so unit tests can
 * inject an in-memory fixture without spinning up SQLite.
 */
export interface EndpointKnowledgeReader {
  listScoredBySite(
    site: string,
    limit?: number,
  ): ReadonlyArray<
    KnowledgeApiEndpoint & {
      semanticType: EndpointSemanticType;
      confidence: number;
      usableForTask: boolean;
      fallbackReason: string | null;
    }
  >;
}

/**
 * Result of `lookupEndpointFamily`. Carries enough context for both
 * the request builder (urlPattern, queryKeys, family) and the evidence
 * contract (semanticValidation, score).
 *
 * V27-08 additive surface:
 *   - `endpointSource` — closed enum lineage (`observed` |
 *     `seed_adapter` | `manual_seed` | `unknown`). The executor and
 *     telemetry layer surface this so a downstream report can tell
 *     "we hit an observed endpoint" from "we fell back to the V25
 *     seed_adapter".
 *   - `correlationConfidence` — closed enum from V27-07. Single-
 *     session results are capped at `'low_confidence'`.
 *   - `retiredPeer` — when the lookup deferred to an `observed` row
 *     instead of a same-site `seed_adapter` peer that *would* have
 *     matched, this carries the lineage of the de-prioritised
 *     `seed_adapter`. NEVER deletes the seed row; just makes the
 *     decision visible to a future Gate B / observability report.
 *   - `chosenReason` — short closed-enum reason describing the
 *     ranking decision. See `EndpointLookupChosenReason` below.
 */
export interface EndpointMatch {
  endpoint: KnowledgeApiEndpoint & {
    semanticType: EndpointSemanticType;
    confidence: number;
  };
  /** Whether the endpoint's actual semanticType matches `semanticTypeWanted`. */
  semanticValidation: 'pass' | 'fail';
  /** Final confidence score (after the optional semantic-validation penalty). */
  score: number;
  endpointSource: EndpointSource;
  correlationConfidence: CorrelationConfidenceLevel | null;
  retiredPeer: {
    endpointSource: EndpointSource;
    endpointSignature: string;
    confidence: number;
    sampleCount: number;
  } | null;
  chosenReason: EndpointLookupChosenReason;
}

/**
 * V27-08 — closed-enum reason for why the lookup picked one row
 * over another. The values are stable; consumers (telemetry,
 * report dashboards, retirement counters) treat them as a closed
 * set.
 *
 *   - `'observed_high_confidence'` — observed row matched all
 *     thresholds (confidence floor + sample_count ≥ 2 + same
 *     semanticType) and won outright.
 *   - `'observed_preferred_over_seed_adapter'` — observed row
 *     met the retirement criteria and de-prioritised a
 *     same-site seed_adapter peer that also matched.
 *   - `'seed_adapter_fallback'` — no qualifying observed row was
 *     available (or it failed retirement criteria); the
 *     seed_adapter row was the best remaining option.
 *   - `'observed_only_match'` — only observed rows were available
 *     for the site; no seed_adapter peer existed.
 *   - `'best_available'` — fallback for rows whose source is
 *     `'manual_seed'` / `'unknown'` (e.g. a legacy row with no
 *     family hint).
 */
export type EndpointLookupChosenReason =
  | 'observed_high_confidence'
  | 'observed_preferred_over_seed_adapter'
  | 'seed_adapter_fallback'
  | 'observed_only_match'
  | 'best_available';

/**
 * Outcome of `buildSafeRequest`. `builderHint='seed_adapter'` means we
 * matched a known GitHub/npmjs urlPattern and reused the V25 seed
 * builder; `builderHint='generic'` means we built the URL purely from
 * the persisted `urlPattern` + `queryKeys`.
 */
export interface SafeRequestPlan {
  url: string;
  method: 'GET';
  /**
   * V25 closed-enum `dataPurpose` when `builderHint='seed_adapter'`.
   * Free-form `'observed_<semanticType>'` for the generic branch — the
   * executor uses this only as evidence, never as a routing key.
   */
  dataPurpose: string;
  /** Sorted list of query keys actually emitted into the URL. */
  requestShapeUsed: ReadonlyArray<string>;
  builderHint: 'seed_adapter' | 'generic';
}

/**
 * V26-FIX-04 — closed-enum reader mode the executor surfaces back to
 * telemetry / the operation-log. `'knowledge_driven'` is the FIX-04
 * happy path; `'legacy_candidate'` is the existing V25 candidate path
 * that FIX-05 will deprecate.
 */
export type ReaderMode = 'knowledge_driven' | 'legacy_candidate';
