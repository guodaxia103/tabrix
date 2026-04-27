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
