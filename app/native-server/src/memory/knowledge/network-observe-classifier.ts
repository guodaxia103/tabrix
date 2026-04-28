/**
 * V26-FIX-03 — Generic browser-network observe classifier.
 *
 * Produces a closed-enum `semantic type` + `usableForTask` + (when
 * not usable) `noiseReason` from the *metadata* of a captured
 * request. Pure module: no IO, no `Date.now()`, no env reads.
 *
 * Design contract (per V3 SoT V26-FIX-03):
 *
 *   - The classifier is **family-agnostic**. GitHub / npmjs URLs go
 *     through the same code path as any other host. Family hints
 *     (e.g. `family: 'github'`) may be passed in to *break ties* but
 *     MUST NOT be the deciding signal. Two reasons:
 *       (a) v2.6's main line is "browser observe → endpoint
 *           knowledge → on-demand reader". Hardcoding the classifier
 *           on family names re-creates the v2.5 mistake we are
 *           explicitly walking back.
 *       (b) Future MKEP rows from arbitrary sites (HN, Wikipedia,
 *           internal dashboards) need a usable classification before
 *           anyone curates a family adapter.
 *
 *   - The closed enum is documented in the plan and matches the
 *     `EndpointSemanticType` in `knowledge-api-repository.ts`.
 *     Every captured request must land in exactly one bucket.
 *
 *   - `usableForTask` is a derived boolean. It is `true` only for
 *     read-shaped semantic types that look like data (search / list
 *     / detail / pagination / filter) AND are GET/HEAD AND look like
 *     JSON. Everything else (mutation, asset, analytics, auth,
 *     private, telemetry, unknown) is `false` with a structured
 *     `noiseReason`.
 *
 *   - We never look at request/response *bodies* here — those are
 *     redacted by `api-knowledge-capture.ts`. Classification is
 *     purely from URL host/path, method, content-type, request type
 *     hint, and query keys (names only).
 */

export type NetworkObserveSemanticType =
  | 'search'
  | 'list'
  | 'detail'
  | 'pagination'
  | 'filter'
  | 'mutation'
  | 'asset'
  | 'analytics'
  | 'auth'
  | 'private'
  | 'telemetry'
  | 'unknown';

export interface NetworkObserveClassifierInput {
  url: string;
  method?: string;
  /** Chrome request type hint, e.g. `'xmlhttprequest' | 'fetch' | 'image' | 'stylesheet' | 'font' | 'document'`. */
  type?: string;
  /** Response Content-Type or extension-side mimeType hint. */
  mimeType?: string;
  /** Optional pre-extracted query keys. The classifier extracts them itself if absent. */
  queryKeys?: readonly string[];
}

export interface NetworkObserveClassification {
  semanticType: NetworkObserveSemanticType;
  usableForTask: boolean;
  /** Closed-enum-ish structured reason, populated when `usableForTask=false`. `null` when usable. */
  noiseReason: string | null;
  /** Sorted, deduped query keys used for the decision (and persisted as `query_params_shape`). */
  queryKeysSorted: readonly string[];
}

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const MUTATION_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const ANALYTICS_HOST_RE =
  /(doubleclick|google-analytics|googletagmanager|segment\.io|sentry\.io|amplitude|mixpanel|hotjar|fullstory|datadoghq|newrelic|cloudflareinsights)\./i;

const ASSET_EXT_RE =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|woff2?|ttf|otf|mp4|webm|mp3|wav|wasm)(\?|$)/i;
const ASSET_TYPES: ReadonlySet<string> = new Set([
  'image',
  'stylesheet',
  'font',
  'media',
  'object',
  'script',
  'imageset',
]);
const ASSET_MIME_PREFIX_RE = /^(image|font|audio|video)\//i;

const AUTH_PATH_RE = /\b(login|logout|oauth|authorize|signin|signup|sign-in|sign-out|saml|sso)\b/i;
const PRIVATE_PATH_RE = /(^|\/)_?private\//i;
const TELEMETRY_PATH_RE = /\b(beacon|collect|telemetry|metrics|stats|events?|heartbeat|ping)\b/i;

const SEARCH_PATH_RE = /\b(search|query|lookup|autocomplete|suggest)\b/i;
const SEARCH_QUERY_KEYS: ReadonlySet<string> = new Set(['q', 'query', 'search', 'keyword', 'k']);
/**
 * Permissive substring sniff for query keys. Catches MediaWiki's
 * `srsearch`, Algolia's `searchQuery`, etc. Intentionally loose:
 * a false positive only inflates the search bucket, which is the
 * *most* useful Knowledge bucket for v2.6 lookups.
 */
const SEARCH_QUERY_KEY_RE = /(search|query|keyword|term)/;

const PAGINATION_QUERY_KEYS: ReadonlySet<string> = new Set([
  'page',
  'per_page',
  'pagesize',
  'page_size',
  'cursor',
  'after',
  'before',
  'offset',
  'limit',
]);

const FILTER_QUERY_KEYS: ReadonlySet<string> = new Set([
  'filter',
  'state',
  'sort',
  'order',
  'orderby',
  'order_by',
  'direction',
  'category',
  'tag',
  'tags',
  'type',
]);

/**
 * Heuristic signal that the path *ends* on an identifier — numeric
 * id, long opaque slug, UUID-shaped, etc. Used to classify
 * single-resource detail endpoints. Family-agnostic on purpose. The
 * optional `.<ext>` tail catches `.json` / `.xml` / `.html` style
 * URLs that some non-REST APIs (e.g. Firebase, MediaWiki action
 * exports) use.
 */
const DETAIL_TAIL_RE =
  /\/(\d+|[A-Za-z0-9_-]{20,}|[0-9a-fA-F]{8,}-[0-9a-fA-F-]{4,})(\.[a-z0-9]{2,5})?\/?$/;

const COLLECTION_PATH_RE =
  /\/(items|posts|articles|stories|comments|users|orgs|repos|issues|pulls|packages|search\/[a-z]+|catalog|index|topics|threads)\/?$/i;

/** Lower-case-only JSON content-type sniff. Tolerates `+json`. */
function looksLikeJson(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const m = mimeType.toLowerCase();
  return m.includes('json');
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function normalizeMethod(method: string | undefined): string {
  if (!method || typeof method !== 'string') return 'GET';
  return method.trim().toUpperCase() || 'GET';
}

function extractQueryKeysFromUrl(parsed: URL): string[] {
  const keys = new Set<string>();
  for (const k of parsed.searchParams.keys()) {
    if (k.length > 0) keys.add(k.toLowerCase());
  }
  return Array.from(keys).sort();
}

/**
 * V26-FIX-03 — main entry. Returns one of the 12 closed-enum
 * semantic types plus a derived `usableForTask` boolean.
 *
 * Decision order (first match wins):
 *
 *   1. Invalid URL → `unknown` / `invalid_url`.
 *   2. Asset hint (chrome request type / extension / mime prefix) → `asset`.
 *   3. Analytics host → `analytics`.
 *   4. Path screams `_private` → `private`.
 *   5. Path screams telemetry words → `telemetry`.
 *   6. Path screams auth words → `auth`.
 *   7. Mutation method → `mutation`.
 *   8. From here on, only GET/HEAD survive. Non-JSON-looking
 *      responses are punted to `unknown` so we don't pollute Knowledge
 *      with HTML/text crawlers (the read-page side handles those).
 *   9. Query keys / path words decide `search` > `pagination` > `filter`.
 *  10. Path looks like a single-resource tail → `detail`.
 *  11. Path looks like a collection (plural-ish leaves) → `list`.
 *  12. Otherwise → `unknown`.
 */
export function classifyNetworkObserveEndpoint(
  input: NetworkObserveClassifierInput,
): NetworkObserveClassification {
  const parsed = safeUrl(input.url);
  if (!parsed) {
    return {
      semanticType: 'unknown',
      usableForTask: false,
      noiseReason: 'invalid_url',
      queryKeysSorted: [],
    };
  }

  const method = normalizeMethod(input.method);
  const type = (input.type || '').toLowerCase();
  const mimeType = (input.mimeType || '').toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const queryKeysSorted = input.queryKeys
    ? Array.from(new Set(input.queryKeys.map((k) => k.toLowerCase()))).sort()
    : extractQueryKeysFromUrl(parsed);

  if (ASSET_TYPES.has(type) || ASSET_EXT_RE.test(path) || ASSET_MIME_PREFIX_RE.test(mimeType)) {
    return {
      semanticType: 'asset',
      usableForTask: false,
      noiseReason: 'asset_resource',
      queryKeysSorted,
    };
  }

  if (ANALYTICS_HOST_RE.test(host)) {
    return {
      semanticType: 'analytics',
      usableForTask: false,
      noiseReason: 'analytics_host',
      queryKeysSorted,
    };
  }

  if (PRIVATE_PATH_RE.test(path)) {
    return {
      semanticType: 'private',
      usableForTask: false,
      noiseReason: 'private_path',
      queryKeysSorted,
    };
  }

  if (TELEMETRY_PATH_RE.test(path)) {
    return {
      semanticType: 'telemetry',
      usableForTask: false,
      noiseReason: 'telemetry_path',
      queryKeysSorted,
    };
  }

  if (AUTH_PATH_RE.test(path)) {
    return {
      semanticType: 'auth',
      usableForTask: false,
      noiseReason: 'auth_path',
      queryKeysSorted,
    };
  }

  if (MUTATION_METHODS.has(method)) {
    return {
      semanticType: 'mutation',
      usableForTask: false,
      noiseReason: 'non_read_method',
      queryKeysSorted,
    };
  }

  // From here on we expect read-shaped traffic. Non-JSON-looking
  // GETs can still be valid HTML page loads or HTML API responses
  // (e.g. ?_data= partials), but they don't belong in Knowledge —
  // the read-page side handles those. Only `text/html` is rejected
  // outright; absent mime defaults to "trust the URL shape".
  if (!READ_METHODS.has(method)) {
    return {
      semanticType: 'unknown',
      usableForTask: false,
      noiseReason: 'unsupported_method',
      queryKeysSorted,
    };
  }
  if (mimeType && !looksLikeJson(mimeType) && !mimeType.includes('xml')) {
    return {
      semanticType: 'unknown',
      usableForTask: false,
      noiseReason: 'non_structured_response',
      queryKeysSorted,
    };
  }

  const hasSearchKey = queryKeysSorted.some(
    (k) => SEARCH_QUERY_KEYS.has(k) || SEARCH_QUERY_KEY_RE.test(k),
  );
  const hasPaginationKey = queryKeysSorted.some((k) => PAGINATION_QUERY_KEYS.has(k));
  const hasFilterKey = queryKeysSorted.some((k) => FILTER_QUERY_KEYS.has(k));
  const pathSearchHit = SEARCH_PATH_RE.test(path);

  if (hasSearchKey || pathSearchHit) {
    return {
      semanticType: 'search',
      usableForTask: true,
      noiseReason: null,
      queryKeysSorted,
    };
  }

  if (DETAIL_TAIL_RE.test(parsed.pathname)) {
    return {
      semanticType: 'detail',
      usableForTask: true,
      noiseReason: null,
      queryKeysSorted,
    };
  }

  if (hasPaginationKey) {
    return {
      semanticType: 'pagination',
      usableForTask: true,
      noiseReason: null,
      queryKeysSorted,
    };
  }

  if (hasFilterKey) {
    return {
      semanticType: 'filter',
      usableForTask: true,
      noiseReason: null,
      queryKeysSorted,
    };
  }

  if (COLLECTION_PATH_RE.test(parsed.pathname)) {
    return {
      semanticType: 'list',
      usableForTask: true,
      noiseReason: null,
      queryKeysSorted,
    };
  }

  return {
    semanticType: 'unknown',
    usableForTask: false,
    noiseReason: 'no_signal',
    queryKeysSorted,
  };
}

// ---------------------------------------------------------------------
// V27-06 — Endpoint Candidate Classifier v2
// ---------------------------------------------------------------------
//
// The v1 `classifyNetworkObserveEndpoint` above is the persisted-row
// classifier — its closed enum is wired through SQLite (see
// `EndpointSemanticType` in `knowledge-api-repository.ts`) and is
// frozen by the v2.6 schema. V27-06 needs a **higher-level candidate
// classification** that adds:
//
//   - `error`             — 4xx/5xx response status
//   - `empty`             — successful response but rowCount=0 / empty
//                           top-level shape
//   - `document`          — HTML / text / markdown / PDF response
//                           (doc-shaped, not API-shaped)
//   - `noise`             — single bucket folding v1's
//                           asset/analytics/auth/private/telemetry/mutation
//                           plus favicon + source-map noise
//   - `unknown_candidate` — replaces v1's `unknown` so a v2 consumer
//                           can tell "we considered this and walked
//                           away" from "we never observed this"
//
// The v2 classifier is a pure wrapper. It does NOT mutate the v1 row
// classification, does NOT add columns to the repository, and does
// NOT bypass v1 noise rules. It composes the v1 verdict with an
// optional `EndpointShapeSummary` (provided by V27-06 capture-side
// summariser) and the HTTP status code, then folds the result into
// the brief's closed enum.

/**
 * V27-06 closed-enum candidate semantic type. Always include
 * `'unknown_candidate'` so a downstream V27-07 correlator never has
 * to infer "we have no opinion".
 */
export type EndpointCandidateSemanticType =
  | 'search'
  | 'list'
  | 'detail'
  | 'pagination'
  | 'filter'
  | 'document'
  | 'empty'
  | 'error'
  | 'noise'
  | 'unknown_candidate';

export const ENDPOINT_CANDIDATE_SEMANTIC_TYPES = [
  'search',
  'list',
  'detail',
  'pagination',
  'filter',
  'document',
  'empty',
  'error',
  'noise',
  'unknown_candidate',
] as const satisfies ReadonlyArray<EndpointCandidateSemanticType>;

/**
 * V27-06 — coarse content-type bucket. Closed enum so the candidate
 * classifier can decide `document` vs `error` vs `noise` from a
 * brand-neutral string.
 */
export type EndpointContentTypeBucket = 'json' | 'xml' | 'html' | 'text' | 'binary' | 'unknown';

/**
 * V27-06 — closed-enum response-size bucket. Mirrors the v2.7 fact
 * collector's `NetworkFactSizeClass` so the two can be cross-checked
 * during owner-lane Gate B.
 */
export type EndpointShapeSizeClass = 'empty' | 'small' | 'medium' | 'large' | 'unknown';

/**
 * V27-06 — closed-enum response-shape kind. Same vocabulary as the v1
 * `KnowledgeApiResponseShape` so persistence can keep its existing
 * column without a migration.
 */
export type EndpointShapeKind = 'object' | 'array' | 'scalar' | 'unknown';

/**
 * V27-06 — closed-enum field types the shape summariser is allowed to
 * record. Strictly types only — never values.
 */
export type EndpointShapeFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

/**
 * V27-06 — privacy-safe response-shape descriptor. Carries:
 *   - top-level keys (names only, no values)
 *   - array `rowCount` and a sample of item-keys (names only)
 *   - per-key `fieldTypes` (closed enum, never values)
 *   - bucketed `sizeClass`
 *   - `available=false` when the producer could not see the body
 *     (e.g. CORS-opaque, stream still in progress, web_request side
 *     captured headers only). Such candidates are still classified —
 *     `metadata_only` evidence — and never treated as "endpoint
 *     unusable".
 *
 * ALL list / map members in this type are bounded — see the constants
 * in `api-knowledge-capture.ts` (`RESPONSE_*_KEY_LIMIT`) — and contain
 * names only. The PrivacyGate test suite asserts this.
 */
export interface EndpointShapeSummary {
  kind: EndpointShapeKind;
  topLevelKeys: readonly string[];
  rowCount: number | null;
  sampleItemKeys: readonly string[];
  fieldTypes: Readonly<Record<string, EndpointShapeFieldType>>;
  sizeClass: EndpointShapeSizeClass;
  contentTypeBucket: EndpointContentTypeBucket;
  /** False when no response body was available; classifier still runs. */
  available: boolean;
}

/**
 * V27-06 — input bag for the v2 candidate classifier. Every field is
 * either a closed-enum bucket, a brand-neutral path/host, a count, or
 * a key list. No raw values, no header values, no body.
 */
export interface EndpointCandidateClassifierInput {
  url: string;
  method?: string;
  /** Chrome request type hint (`'xmlhttprequest' | 'fetch' | ...`). */
  type?: string;
  /** Response Content-Type header (header value is allowed because it is a closed-enum-ish string). */
  mimeType?: string;
  /** HTTP status code, when known. `null` for fetch errors. */
  status?: number | null;
  /** V27-06 shape summary, when the producer could see the body. */
  shape?: EndpointShapeSummary | null;
  /** Optional pre-extracted query keys. */
  queryKeys?: readonly string[];
}

/**
 * V27-06 — output of the v2 candidate classifier. The
 * `evidenceLevel` field lets V27-07 / V27-08 reason about whether the
 * candidate was shape-evidenced (response body was available and
 * summarised) or only metadata-evidenced (URL + method + status + mime
 * only). V27-08 uses this to refuse high confidence on metadata-only
 * candidates.
 */
export interface EndpointCandidate {
  semanticType: EndpointCandidateSemanticType;
  /** Closed-enum-ish reason populated for `noise` / `error` / `empty` /
   *  `unknown_candidate`; `null` for the read-shaped buckets. */
  noiseReason: string | null;
  /** Floor confidence the classifier has in this verdict. The Knowledge
   *  layer composes this with sample count / correlation evidence — the
   *  classifier itself never claims `> 0.9`. */
  confidence: number;
  /** `'shape_evidenced'` only when both the response shape was
   *  available AND the verdict actually depended on shape evidence.
   *  Otherwise `'metadata_only'`. */
  evidenceLevel: 'shape_evidenced' | 'metadata_only';
  /** Echoes back the input shape so consumers (V27-07 correlator,
   *  V27-08 repository) do not have to re-summarise. `null` only when
   *  the producer did not supply one. */
  shape: EndpointShapeSummary | null;
  /** Sorted, deduped query keys actually considered in the verdict. */
  queryKeysSorted: readonly string[];
  /** Underlying v1 row-classifier verdict. Carried so V27-08 lineage
   *  can still cite the existing `EndpointSemanticType` column. */
  rowClassification: NetworkObserveClassification;
}

/**
 * V27-06 — additive noise patterns the v2 classifier rejects on top of
 * the v1 rules. `favicon.ico`, `*.map` (source maps), and the
 * platform-specific `_private/browser/stats` shape that we already
 * filter at v1 are all collapsed into the `noise` bucket here.
 */
const FAVICON_PATH_RE = /(^|\/)favicon\.(ico|png|svg|gif|webp)(\?|$)/i;
const SOURCE_MAP_PATH_RE = /\.map(\?|$)/i;

/** Map a v1 `NetworkObserveSemanticType` to the v2 candidate enum. */
function v1ToV2Semantic(v1: NetworkObserveSemanticType): EndpointCandidateSemanticType {
  switch (v1) {
    case 'search':
    case 'list':
    case 'detail':
    case 'pagination':
    case 'filter':
      return v1;
    case 'mutation':
    case 'asset':
    case 'analytics':
    case 'auth':
    case 'private':
    case 'telemetry':
      return 'noise';
    case 'unknown':
    default:
      return 'unknown_candidate';
  }
}

function classifyContentTypeBucket(mimeType: string | null | undefined): EndpointContentTypeBucket {
  if (!mimeType) return 'unknown';
  const m = mimeType.toLowerCase();
  if (m.includes('json')) return 'json';
  if (m.includes('xml')) return 'xml';
  if (m.includes('html')) return 'html';
  if (m.startsWith('text/')) return 'text';
  if (
    m.startsWith('image/') ||
    m.startsWith('font/') ||
    m.startsWith('audio/') ||
    m.startsWith('video/') ||
    m.includes('octet-stream') ||
    m.includes('pdf')
  ) {
    return 'binary';
  }
  return 'unknown';
}

/**
 * V27-06 — entry point. Pure: returns one of the 10 closed-enum
 * candidate types from URL/method/status/shape (shape optional).
 *
 * Decision order (first match wins):
 *
 *   1. Invalid URL          → `unknown_candidate` / `invalid_url`.
 *   2. Favicon / source-map → `noise` / `noise_*`. (additive over v1)
 *   3. v1 noise verdict     → `noise` / v1's noiseReason.
 *      (asset / analytics / auth / private / telemetry / mutation)
 *   4. status 4xx/5xx       → `error` / `status_<class>`.
 *   5. Document content-type → `document` / `document_response`.
 *   6. Shape says empty     → `empty` / `empty_response`.
 *   7. v1 read-shaped verdict (search/list/detail/pagination/filter)
 *                            → carry through, evidence elevated when
 *                              shape confirms a non-empty body.
 *   8. Otherwise            → `unknown_candidate` / v1's noiseReason.
 *
 * The classifier never assigns `> 0.85` confidence — V27-08 is the
 * authority on whether a candidate becomes a high-confidence row.
 */
export function classifyEndpointCandidate(
  input: EndpointCandidateClassifierInput,
): EndpointCandidate {
  const v1 = classifyNetworkObserveEndpoint({
    url: input.url,
    method: input.method,
    type: input.type,
    mimeType: input.mimeType,
    queryKeys: input.queryKeys,
  });
  const queryKeysSorted = v1.queryKeysSorted;
  const shape = input.shape ?? null;
  const evidenceLevel: EndpointCandidate['evidenceLevel'] =
    shape && shape.available ? 'shape_evidenced' : 'metadata_only';

  // 1. Invalid URL — v1 already returned `unknown` / `invalid_url`.
  if (v1.semanticType === 'unknown' && v1.noiseReason === 'invalid_url') {
    return {
      semanticType: 'unknown_candidate',
      noiseReason: 'invalid_url',
      confidence: 0,
      evidenceLevel: 'metadata_only',
      shape,
      queryKeysSorted,
      rowClassification: v1,
    };
  }

  // 2. Favicon / source-map — additive noise filter on top of v1.
  let parsed: URL | null = null;
  try {
    parsed = new URL(input.url);
  } catch {
    parsed = null;
  }
  const path = parsed ? parsed.pathname : '';
  if (FAVICON_PATH_RE.test(path)) {
    return {
      semanticType: 'noise',
      noiseReason: 'noise_favicon',
      confidence: 0.6,
      evidenceLevel,
      shape,
      queryKeysSorted,
      rowClassification: v1,
    };
  }
  if (SOURCE_MAP_PATH_RE.test(path)) {
    return {
      semanticType: 'noise',
      noiseReason: 'noise_source_map',
      confidence: 0.6,
      evidenceLevel,
      shape,
      queryKeysSorted,
      rowClassification: v1,
    };
  }

  // 3. v1 noise verdicts collapse into `noise`.
  if (
    v1.semanticType === 'asset' ||
    v1.semanticType === 'analytics' ||
    v1.semanticType === 'auth' ||
    v1.semanticType === 'private' ||
    v1.semanticType === 'telemetry' ||
    v1.semanticType === 'mutation'
  ) {
    return {
      semanticType: 'noise',
      noiseReason: v1.noiseReason ?? `noise_${v1.semanticType}`,
      confidence: 0.6,
      evidenceLevel,
      shape,
      queryKeysSorted,
      rowClassification: v1,
    };
  }

  // 4. status 4xx/5xx → `error` regardless of v1 verdict.
  const status = typeof input.status === 'number' ? input.status : null;
  if (status !== null && Number.isFinite(status) && status >= 400 && status < 600) {
    const statusClass = `${Math.floor(status / 100)}xx`;
    return {
      semanticType: 'error',
      noiseReason: `status_${statusClass}`,
      confidence: 0.7,
      evidenceLevel,
      shape,
      queryKeysSorted,
      rowClassification: v1,
    };
  }

  // 5. document content-type → `document`. We use the explicit mime
  //    bucket so a HTML response on a "search-y" URL still classifies
  //    as a document (page-snapshot territory, not API).
  const ctBucket = classifyContentTypeBucket(input.mimeType);
  if (ctBucket === 'html' || ctBucket === 'text' || ctBucket === 'xml') {
    // XML is doc-ish unless v1 already tagged it as a read-shaped JSON
    // peer (i.e. JSON+XML mix); v1 lets `xml` through to read-shaped
    // typing but we treat raw XML as document in v2 — APIs in 2026
    // very rarely return raw XML.
    if (ctBucket !== 'xml' || v1.semanticType === 'unknown') {
      return {
        semanticType: 'document',
        noiseReason: 'document_response',
        confidence: 0.65,
        evidenceLevel,
        shape,
        queryKeysSorted,
        rowClassification: v1,
      };
    }
  }
  // PDF / binary → noise (not interesting as a Knowledge candidate).
  if (ctBucket === 'binary') {
    return {
      semanticType: 'noise',
      noiseReason: 'noise_binary_response',
      confidence: 0.55,
      evidenceLevel,
      shape,
      queryKeysSorted,
      rowClassification: v1,
    };
  }

  // 6. Shape says empty — only when shape evidence is available AND
  //    no v1 noise verdict already dominated. We avoid second-
  //    guessing `unknown` v1 verdicts: an empty shape on a
  //    `no_signal` URL is still `unknown_candidate`, not `empty`.
  if (
    shape &&
    shape.available &&
    isEmptyShape(shape) &&
    (v1.usableForTask || v1.semanticType === 'unknown')
  ) {
    // We only flag `empty` when the underlying URL/query looks like
    // it WAS asking for read-shaped data; a shapeless GET with no
    // signal that happens to return `[]` stays `unknown_candidate`.
    if (v1.usableForTask) {
      return {
        semanticType: 'empty',
        noiseReason: 'empty_response',
        confidence: 0.7,
        evidenceLevel: 'shape_evidenced',
        shape,
        queryKeysSorted,
        rowClassification: v1,
      };
    }
  }

  // 7. v1 read-shaped verdict — promote into v2 candidate enum.
  if (v1.usableForTask) {
    const baseConfidence =
      evidenceLevel === 'shape_evidenced' && shape && !isEmptyShape(shape) ? 0.8 : 0.65;
    return {
      semanticType: v1ToV2Semantic(v1.semanticType),
      noiseReason: null,
      confidence: baseConfidence,
      evidenceLevel,
      shape,
      queryKeysSorted,
      rowClassification: v1,
    };
  }

  // 8. Default — v1 walked away with `unknown`. We surface it as
  //    `unknown_candidate` with v1's reason so V27-07 / V27-08 can
  //    still cite the underlying signal.
  return {
    semanticType: 'unknown_candidate',
    noiseReason: v1.noiseReason ?? 'no_signal',
    confidence: 0.3,
    evidenceLevel,
    shape,
    queryKeysSorted,
    rowClassification: v1,
  };
}

/**
 * V27-06 — `true` when the shape descriptor describes a response that
 * carries no usable rows.
 */
function isEmptyShape(shape: EndpointShapeSummary): boolean {
  if (!shape.available) return false;
  if (shape.kind === 'array') return shape.rowCount === 0;
  if (shape.kind === 'object') {
    if (shape.topLevelKeys.length === 0) return true;
    // Objects that look like {items:[], total_count:0} — surface a
    // scalar `*count*` zero or an empty top-level array as empty.
    // We restrict the heuristic to *common* envelope keys to avoid
    // false positives on `{status:'ok'}`.
    const totalKey = shape.topLevelKeys.find((k) => /^(total_?count|count|total)$/i.test(k));
    if (totalKey && shape.fieldTypes[totalKey] === 'number' && shape.rowCount === 0) {
      return true;
    }
    const arrayKey = shape.topLevelKeys.find(
      (k) => shape.fieldTypes[k] === 'array' && /^(items|results|data|rows|hits|edges)$/i.test(k),
    );
    if (arrayKey && shape.rowCount === 0) return true;
  }
  return false;
}
