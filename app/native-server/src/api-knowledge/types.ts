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
  EndpointSemanticType,
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
}

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
