/**
 * API Knowledge capture.
 *
 * Pure transformation layer between a `chrome_network_capture` (action="stop")
 * result blob and zero or more `UpsertKnowledgeApiEndpointInput` rows.
 *
 * Hard rules:
 *  - **No raw payloads ever leave this module.** Authorization, Cookie,
 *    Set-Cookie, X-CSRF/XSRF/api-key headers are dropped wholesale; their
 *    presence is reduced to two booleans (hasAuth / hasCookie).
 *  - Header *names* are stored lower-cased and sorted; values are never
 *    persisted, even non-sensitive ones (avoids "is this header value
 *    actually a token?" classifier games).
 *  - Query strings are reduced to *parameter keys*; values are dropped.
 *  - Request bodies are reduced to top-level JSON keys when JSON, otherwise
 *    skipped. Non-JSON bodies are not summarized.
 *  - Response bodies are reduced to a coarse shape descriptor (top-level
 *    keys / array length + sample item keys / scalar type). The largest
 *    string we keep is a short content-type, never the body text.
 *
 * Scope:
 *  - Only `api.github.com` URLs (host-prefix match). Same-origin
 *    `github.com/<owner>/<repo>/...` HTML/AJAX is intentionally out: it
 *    overlaps with page-snapshot logic and adds noise without unlocking
 *    new structured data.
 *  - Semantic tagging covers the representative endpoint families
 *    that drive the highest-value structured reading decisions: issues list +
 *    detail, pulls list + detail, actions runs list + detail,
 *    actions workflows list, search/issues, search/repositories, and
 *    repo metadata. Anything else under api.github.com is captured as
 *    `github.unclassified` with a path collapsed by
 *    `collapseUnknownPath` (identity-bearing prefixes are normalized;
 *    see that function for the exact rules — short un-listed segments
 *    DO survive on purpose so we keep some structural information).
 */

import type {
  EndpointSemanticType,
  KnowledgeApiRequestSummary,
  KnowledgeApiResponseShape,
  KnowledgeApiResponseSummary,
  UpsertKnowledgeApiEndpointInput,
} from './knowledge-api-repository';
import {
  classifyEndpointCandidate,
  classifyNetworkObserveEndpoint,
} from './network-observe-classifier';
import type {
  EndpointCandidate,
  EndpointContentTypeBucket,
  EndpointShapeFieldType,
  EndpointShapeSizeClass,
  EndpointShapeSummary,
} from './network-observe-classifier';

/**
 * Headers whose *values* would be a privacy / security regression to
 * persist. We never store the values — only their presence.
 */
const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token',
  'x-api-key',
]);

const AUTH_HEADER_NAMES: ReadonlySet<string> = new Set(['authorization', 'proxy-authorization']);
const COOKIE_HEADER_NAMES: ReadonlySet<string> = new Set(['cookie', 'set-cookie']);

const JSON_CONTENT_TYPE_RE = /\b(application\/json|application\/.*\+json|text\/json)\b/i;

const RESPONSE_OBJECT_KEY_LIMIT = 32;
const RESPONSE_ARRAY_SAMPLE_KEY_LIMIT = 16;
const REQUEST_BODY_KEY_LIMIT = 32;
const QUERY_KEY_LIMIT = 32;

/**
 * Shape of a single captured request as the network-capture extension
 * tools serialize them. Both `network-capture-web-request.ts` (status =
 * HTTP code) and `network-capture-debugger.ts` (status = lifecycle
 * label, `statusCode` = HTTP code) are supported.
 */
export interface CapturedNetworkRequest {
  url: string;
  method?: string;
  type?: string;
  status?: number | string;
  statusCode?: number;
  requestTime?: number;
  mimeType?: string;
  requestBody?: string | null;
  responseBody?: string | null;
  responseBodySource?: 'debugger_api' | 'not_available' | string;
  rawBodyPersisted?: false;
  bodyCompacted?: boolean;
  base64Encoded?: boolean;
  specificRequestHeaders?: Record<string, string>;
  specificResponseHeaders?: Record<string, string>;
  errorText?: string;
  safeResponseSummary?: CapturedSafeResponseSummary;
}

export interface CapturedNetworkBundle {
  requests?: readonly CapturedNetworkRequest[];
  commonRequestHeaders?: Record<string, string>;
  commonResponseHeaders?: Record<string, string>;
  tabUrl?: string;
  responseSummaryLifecycle?: CapturedResponseSummaryLifecycle;
  observationMode?: 'cdp_enhanced' | 'no_cdp' | string;
  cdpUsed?: boolean;
  cdpReason?: string | null;
  cdpAttachDurationMs?: number | null;
  cdpDetachSuccess?: boolean;
  debuggerConflict?: boolean;
  responseBodySource?: 'debugger_api' | 'not_available' | string;
  rawBodyPersisted?: false;
  bodyCompacted?: boolean;
  fallbackCause?: string | null;
}

export interface CapturedSafeResponseSummary {
  responseSummarySource?: 'browser_context_summary' | string;
  bridgePath?: 'main_world_to_content_to_native' | string;
  capturedAfterArm?: boolean;
  rawBodyPersisted?: false;
  privacyCheck?: 'passed' | 'failed' | string;
  rejectedReason?: string | null;
  status?: number | null;
  contentType?: string | null;
  rows?: readonly Record<string, string | number | boolean | null>[];
  rowCount?: number;
  emptyResult?: boolean;
  fieldShapeSummaryAvailable?: boolean;
  fieldNames?: readonly string[];
  taskQueryValueMatched?: boolean | null;
  samplerArmedAt?: number | null;
  capturedAt?: number | null;
}

export interface CapturedResponseSummaryLifecycle {
  samplerArmedAt?: number | null;
  samplerDisarmedAt?: number | null;
  samplerDisarmReason?: string | null;
  responseSummarySource?: string | null;
  responseSummaryRejectedReason?: string | null;
  capturedAfterArm?: boolean | null;
  bridgePath?: string | null;
  rawBodyPersisted?: false;
}

export interface CaptureKnowledgeContext {
  sessionId: string | null;
  stepId: string | null;
  observedAt: string;
}

/**
 * Cap on the number of endpoints we will derive from a single capture
 * result. Real-world `chrome_network_capture` runs already cap raw
 * requests at the extension layer (see MAX_REQUESTS_PER_CAPTURE), but a
 * second cap here keeps us honest: even a misconfigured upstream cannot
 * stuff Knowledge with thousands of rows in one shot.
 */
export const KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT = 50;

export type CaptureKnowledgeNoiseClass =
  | 'asset'
  | 'analytics'
  | 'auth'
  | 'private'
  | 'telemetry'
  | 'usable'
  | 'unknown';

export interface CaptureKnowledgeDiagnostics {
  totalRequests: number;
  filteredCounts: Record<CaptureKnowledgeNoiseClass, number>;
  usableCandidateCount: number;
  upsertCandidateCount: number;
  reason: 'usable_endpoint_found' | 'no_usable_endpoint_found';
}

export interface CaptureKnowledgeAnalysis {
  upserts: UpsertKnowledgeApiEndpointInput[];
  diagnostics: CaptureKnowledgeDiagnostics;
}

/**
 * Top-level entry point. Walks `bundle.requests`, classifies each one
 * against the GitHub family, and returns at most
 * `KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT` ready-to-upsert rows. Pure — no
 * IO, no `Date.now()`, no `process.env` reads.
 */
export function deriveKnowledgeFromBundle(
  bundle: CapturedNetworkBundle,
  ctx: CaptureKnowledgeContext,
): UpsertKnowledgeApiEndpointInput[] {
  return analyzeKnowledgeCaptureBundle(bundle, ctx).upserts;
}

export function analyzeKnowledgeCaptureBundle(
  bundle: CapturedNetworkBundle,
  ctx: CaptureKnowledgeContext,
): CaptureKnowledgeAnalysis {
  const out: UpsertKnowledgeApiEndpointInput[] = [];
  const filteredCounts = createEmptyFilteredCounts();
  if (!bundle?.requests || bundle.requests.length === 0) {
    return {
      upserts: out,
      diagnostics: {
        totalRequests: 0,
        filteredCounts,
        usableCandidateCount: 0,
        upsertCandidateCount: 0,
        reason: 'no_usable_endpoint_found',
      },
    };
  }
  const commonReq = bundle.commonRequestHeaders ?? {};
  const commonRes = bundle.commonResponseHeaders ?? {};

  for (const req of bundle.requests) {
    const noiseClass = classifyCapturedRequestNoise(req);
    filteredCounts[noiseClass] += 1;
    if (out.length >= KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT) break;
    const derived = deriveKnowledgeFromRequest(req, commonReq, commonRes, ctx);
    if (derived) out.push(derived);
  }
  return {
    upserts: out,
    diagnostics: {
      totalRequests: bundle.requests.length,
      filteredCounts,
      usableCandidateCount: filteredCounts.usable,
      upsertCandidateCount: out.length,
      reason: filteredCounts.usable > 0 ? 'usable_endpoint_found' : 'no_usable_endpoint_found',
    },
  };
}

export function deriveKnowledgeFromRequest(
  req: CapturedNetworkRequest,
  commonRequestHeaders: Record<string, string>,
  commonResponseHeaders: Record<string, string>,
  ctx: CaptureKnowledgeContext,
): UpsertKnowledgeApiEndpointInput | null {
  if (!req?.url || typeof req.url !== 'string') return null;
  if (classifyCapturedRequestNoise(req) !== 'usable') return null;

  const method = normalizeMethod(req.method);
  // First try the family-aware GitHub classifier; if it
  // doesn't apply, fall back to a generic host-and-path normalizer
  // so non-platform URLs (HN, Wikipedia, …) can still seed Knowledge.
  const githubClassification = classifyGitHubFamily(req.url, method);
  const classification = githubClassification ?? classifyGenericFamily(req.url, method);
  if (!classification) return null;

  const mergedRequestHeaders = mergeHeaders(commonRequestHeaders, req.specificRequestHeaders);
  const mergedResponseHeaders = mergeHeaders(commonResponseHeaders, req.specificResponseHeaders);

  const requestSummary = buildRequestSummary({
    url: req.url,
    headers: mergedRequestHeaders,
    body: req.requestBody ?? null,
  });

  const contentType = pickHeader(mergedResponseHeaders, 'content-type') || req.mimeType || null;
  const responseSummary =
    buildResponseSummaryFromSafeSummary(req.safeResponseSummary, contentType) ??
    buildResponseSummary({
      contentType,
      body: req.responseBody ?? null,
      base64Encoded: req.base64Encoded === true,
    });

  // Generic semantic classifier. Family-agnostic; runs
  // for GitHub rows too so the persisted `semantic_type` stays
  // consistent across families.
  const observed = classifyNetworkObserveEndpoint({
    url: req.url,
    method,
    type: req.type,
    mimeType: contentType ?? undefined,
    queryKeys: requestSummary.queryKeys,
  });

  // Derive `endpointSource` from the family
  // hint. `family='observed'` (any non-GitHub host) -> 'observed';
  // `family='github'` -> 'seed_adapter' (the GitHub family adapter
  // is the seed adapter we are gradually retiring); any
  // other / future family -> 'unknown'. The repository performs
  // the same back-derivation on read for legacy NULL rows, so this
  // path stays in lockstep with `deriveEndpointSource()`.
  const endpointSource =
    classification.family === 'observed'
      ? 'observed'
      : classification.family === 'github' || classification.family === 'npmjs'
        ? 'seed_adapter'
        : 'unknown';

  return {
    site: classification.site,
    family: classification.family,
    method: classification.method,
    urlPattern: classification.urlPattern,
    endpointSignature: classification.endpointSignature,
    semanticTag: classification.semanticTag,
    statusClass: deriveStatusClass(req),
    requestSummary,
    responseSummary,
    sourceSessionId: ctx.sessionId,
    sourceStepId: ctx.stepId,
    sourceHistoryRef: null,
    observedAt: ctx.observedAt,
    semanticType: observed.semanticType as EndpointSemanticType,
    queryParamsShape: observed.queryKeysSorted.join(','),
    responseShapeSummary: summarizeResponseShape(responseSummary.shape),
    usableForTask: observed.usableForTask,
    noiseReason: observed.noiseReason,
    // Additive lineage. Single-session capture never
    // produces correlation evidence, so `correlationConfidence` and
    // `correlatedRegionId` stay null here. The DOM-endpoint correlator
    // path is the only writer that bumps them. The lineage breadcrumb
    // explicitly records that this row came from `api-knowledge-capture`
    // (semanticSource='capture').
    endpointSource,
    correlationConfidence: null,
    correlatedRegionId: null,
    confidenceReason: null,
    retirementCandidate: null,
    sourceLineage: {
      semanticSource: 'capture',
      observationCount: 1,
      correlationReason:
        endpointSource === 'seed_adapter' ? 'seed_adapter_default' : 'metadata_only',
    },
  };
}

/**
 * Short, deterministic stringification of the redacted
 * response shape descriptor. Stays well under any reasonable column
 * size and never includes raw values; only counts and key-counts.
 */
function summarizeResponseShape(shape: KnowledgeApiResponseShape): string {
  switch (shape.kind) {
    case 'object':
      return `object:keys=${shape.topLevelKeys.length}`;
    case 'array':
      return `array:n=${shape.itemCount},keys=${shape.sampleItemKeys.length}`;
    case 'scalar':
      return `scalar:${shape.valueType}`;
    default:
      return 'unknown';
  }
}

/**
 * Generic, non-GitHub URL→pattern collapser. Produces a
 * deterministic `urlPattern` / `endpointSignature` for any host so
 * dedup still works without a curated family adapter. Reuses the
 * same identity-prefix and id/slug rules as `collapseUnknownPath`.
 */
function classifyGenericFamily(rawUrl: string, method: string): ClassifiedEndpoint | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  // Skip GitHub host — the family-aware classifier owns it. We never
  // want two parallel rows for the same endpoint.
  if (host === GITHUB_API_HOST) return null;
  const path = parsed.pathname.length === 0 ? '/' : parsed.pathname;
  const collapsed = collapseUnknownPath(path);
  const urlPattern = `${host}${collapsed}`;
  return {
    site: host,
    family: 'observed',
    method,
    urlPattern,
    endpointSignature: `${method} ${urlPattern}`,
    semanticTag: null,
  };
}

export function classifyCapturedRequestNoise(
  req: CapturedNetworkRequest,
): CaptureKnowledgeNoiseClass {
  let parsed: URL;
  try {
    parsed = new URL(req.url);
  } catch {
    return 'unknown';
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const method = normalizeMethod(req.method);
  const type = (req.type || '').toLowerCase();
  const mimeType = (req.mimeType || '').toLowerCase();
  const url = req.url.toLowerCase();

  if (/(doubleclick|google-analytics|googletagmanager|segment|sentry|amplitude)\./.test(url)) {
    return 'analytics';
  }
  if (path.includes('/_private/') || path.includes('/private/')) return 'private';
  if (/\b(login|logout|session|oauth|token|authorize|auth)\b/.test(path)) return 'auth';
  if (/\b(stats|telemetry|metrics|collect|beacon|events?)\b/.test(path)) return 'telemetry';
  if (
    type === 'image' ||
    type === 'stylesheet' ||
    type === 'font' ||
    /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|otf)$/i.test(path) ||
    /^(image|font|audio|video)\//.test(mimeType)
  ) {
    return 'asset';
  }
  if (host === GITHUB_API_HOST) return 'usable';
  if ((method === 'GET' || method === 'HEAD') && (type === 'xmlhttprequest' || type === 'fetch')) {
    return 'usable';
  }
  if ((method === 'GET' || method === 'HEAD') && mimeType.includes('json')) return 'usable';
  return 'unknown';
}

function createEmptyFilteredCounts(): Record<CaptureKnowledgeNoiseClass, number> {
  return {
    asset: 0,
    analytics: 0,
    auth: 0,
    private: 0,
    telemetry: 0,
    usable: 0,
    unknown: 0,
  };
}

// ---------------------------------------------------------------------
// GitHub-family classifier
// ---------------------------------------------------------------------

interface ClassifiedEndpoint {
  site: string;
  /**
   * Widened from the original GitHub-only literal to a
   * string so the generic, non-platform branch can write `'observed'`
   * (or any future family adapter the chooser learns) without a
   * second classifier interface.
   */
  family: string;
  method: string;
  urlPattern: string;
  endpointSignature: string;
  /** Nullable for the generic branch, where no curated tag exists. */
  semanticTag: string | null;
}

const GITHUB_API_HOST = 'api.github.com';

interface GithubRule {
  pattern: RegExp;
  template: string;
  semanticTag: string;
  methods?: ReadonlySet<string>;
}

const GITHUB_API_RULES: readonly GithubRule[] = [
  {
    pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/\d+(?:\/comments)?\/?$/,
    template: '/repos/:owner/:repo/issues/:number',
    semanticTag: 'github.issue_detail',
  },
  {
    pattern: /^\/repos\/[^/]+\/[^/]+\/issues\/?$/,
    template: '/repos/:owner/:repo/issues',
    semanticTag: 'github.issues_list',
  },
  {
    pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+(?:\/[^/]+)?\/?$/,
    template: '/repos/:owner/:repo/pulls/:number',
    semanticTag: 'github.pull_detail',
  },
  {
    pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/?$/,
    template: '/repos/:owner/:repo/pulls',
    semanticTag: 'github.pulls_list',
  },
  {
    pattern: /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/?$/,
    template: '/repos/:owner/:repo/actions/runs/:run_id',
    semanticTag: 'github.workflow_run_detail',
  },
  {
    pattern: /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/?$/,
    template: '/repos/:owner/:repo/actions/runs',
    semanticTag: 'github.workflow_runs_list',
  },
  {
    pattern: /^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/?$/,
    template: '/repos/:owner/:repo/actions/workflows',
    semanticTag: 'github.workflow_list',
  },
  {
    pattern: /^\/search\/issues\/?$/,
    template: '/search/issues',
    semanticTag: 'github.search_issues',
  },
  {
    pattern: /^\/search\/repositories\/?$/,
    template: '/search/repositories',
    semanticTag: 'github.search_repositories',
  },
  {
    pattern: /^\/repos\/[^/]+\/[^/]+\/?$/,
    template: '/repos/:owner/:repo',
    semanticTag: 'github.repo_metadata',
  },
];

function classifyGitHubFamily(rawUrl: string, method: string): ClassifiedEndpoint | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== GITHUB_API_HOST) return null;
  // Strip trailing slash variations into a canonical path for matching.
  const path = parsed.pathname.length === 0 ? '/' : parsed.pathname;
  let chosenTemplate: string | null = null;
  let semanticTag = 'github.unclassified';
  for (const rule of GITHUB_API_RULES) {
    if (rule.methods && !rule.methods.has(method)) continue;
    if (rule.pattern.test(path)) {
      chosenTemplate = rule.template;
      semanticTag = rule.semanticTag;
      break;
    }
  }
  if (!chosenTemplate) {
    // Unmatched api.github.com endpoints are still useful as "this exists";
    // we keep them under a synthesized template so dedup still works.
    chosenTemplate = collapseUnknownPath(path);
  }
  const urlPattern = `${parsed.hostname.toLowerCase()}${chosenTemplate}`;
  const endpointSignature = `${method} ${urlPattern}`;
  return {
    site: parsed.hostname.toLowerCase(),
    family: 'github',
    method,
    urlPattern,
    endpointSignature,
    semanticTag,
  };
}

/**
 * Path normalization for `api.github.com` endpoints that did not match
 * any explicit `GITHUB_API_RULES` template above.
 *
 * Goals (in order):
 *  1. Never persist obvious identity-bearing path segments —
 *     usernames, org slugs, repo names — into `urlPattern` /
 *     `endpointSignature`. These are cross-user / cross-tenant
 *     identifiers that would (a) bloat the dedup space and
 *     (b) leak per-user identity into a table that other accounts
 *     might later import through experience flows. We collapse
 *     the known identity-bearing prefixes:
 *       /users/<name>/...      → /users/:user/...
 *       /orgs/<name>/...       → /orgs/:org/...
 *       /repos/<owner>/<repo>/... → /repos/:owner/:repo/...
 *  2. Numeric segments → `:id` (e.g. issue / run / installation IDs).
 *  3. Long opaque slugs (> 24 chars, single token) → `:slug`
 *     (commit SHAs, base64ish handles).
 *  4. Anything else passes through unchanged. We do NOT try to
 *     classify every possible GitHub path — endpoints we genuinely
 *     care about belong in `GITHUB_API_RULES`. This function is the
 *     "honestly unknown" fallback.
 *
 * NOT a general taxonomy framework. If a new identity prefix needs
 * normalizing, add it explicitly to `IDENTITY_PREFIX_RULES` below.
 */
const IDENTITY_PREFIX_RULES: ReadonlyArray<{
  prefix: string;
  /** how many segments after the prefix are identity placeholders */
  identitySegmentCount: number;
  /** placeholder names, applied in order */
  placeholders: readonly string[];
}> = [
  { prefix: 'users', identitySegmentCount: 1, placeholders: [':user'] },
  { prefix: 'orgs', identitySegmentCount: 1, placeholders: [':org'] },
  { prefix: 'repos', identitySegmentCount: 2, placeholders: [':owner', ':repo'] },
];

function collapseUnknownPath(path: string): string {
  const segments = path.split('/');
  if (segments.length >= 2) {
    const firstNonEmptyIdx = segments[0] === '' ? 1 : 0;
    const head = segments[firstNonEmptyIdx];
    const rule = IDENTITY_PREFIX_RULES.find((r) => r.prefix === head);
    if (rule) {
      for (let i = 0; i < rule.identitySegmentCount; i += 1) {
        const targetIdx = firstNonEmptyIdx + 1 + i;
        if (targetIdx < segments.length && segments[targetIdx].length > 0) {
          segments[targetIdx] = rule.placeholders[i];
        }
      }
    }
  }
  return segments
    .map((seg) => {
      if (seg.length === 0) return seg;
      if (seg.startsWith(':')) return seg; // already a placeholder
      if (/^\d+$/.test(seg)) return ':id';
      if (seg.length > 24 && /^[A-Za-z0-9_-]+$/.test(seg)) return ':slug';
      return seg;
    })
    .join('/');
}

// ---------------------------------------------------------------------
// Header / body redaction
// ---------------------------------------------------------------------

function buildRequestSummary(input: {
  url: string;
  headers: Record<string, string>;
  body: string | null;
}): KnowledgeApiRequestSummary {
  const headerKeys = Object.keys(input.headers || {})
    .map((k) => k.toLowerCase())
    .filter((k) => k.length > 0);
  let hasAuth = false;
  let hasCookie = false;
  for (const k of headerKeys) {
    if (AUTH_HEADER_NAMES.has(k)) hasAuth = true;
    if (COOKIE_HEADER_NAMES.has(k)) hasCookie = true;
  }
  const safeHeaderKeys = headerKeys.filter((k) => !SENSITIVE_HEADER_NAMES.has(k));
  const dedupedHeaderKeys = Array.from(new Set(safeHeaderKeys)).sort();

  const queryKeys = extractQueryKeys(input.url);
  const bodyKeys = extractBodyKeys(input.body);

  return {
    headerKeys: dedupedHeaderKeys,
    queryKeys,
    bodyKeys,
    hasAuth,
    hasCookie,
  };
}

function extractQueryKeys(url: string): readonly string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const keys = new Set<string>();
  for (const key of parsed.searchParams.keys()) {
    if (key.length > 0) keys.add(key);
  }
  return Array.from(keys).sort().slice(0, QUERY_KEY_LIMIT);
}

function extractBodyKeys(body: string | null): readonly string[] {
  if (!body || typeof body !== 'string') return [];
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.keys(parsed as Record<string, unknown>)
        .sort()
        .slice(0, REQUEST_BODY_KEY_LIMIT);
    }
  } catch {
    // Non-JSON bodies are intentionally skipped.
  }
  return [];
}

function buildResponseSummary(input: {
  contentType: string | null;
  body: string | null;
  base64Encoded: boolean;
}): KnowledgeApiResponseSummary {
  const contentType = input.contentType ? input.contentType.split(';')[0].trim() : null;
  const sizeBytes = input.body ? input.body.length : null;
  const shape = computeResponseShape({
    contentType,
    body: input.body,
    base64Encoded: input.base64Encoded,
  });
  return {
    contentType: contentType || null,
    sizeBytes,
    shape,
  };
}

function buildResponseSummaryFromSafeSummary(
  summary: CapturedSafeResponseSummary | undefined,
  fallbackContentType: string | null,
): KnowledgeApiResponseSummary | null {
  if (!summary || summary.responseSummarySource !== 'browser_context_summary') return null;
  if (summary.privacyCheck === 'failed') return null;
  const contentType =
    (summary.contentType || fallbackContentType || null)?.split(';')[0]?.trim() || null;
  const fieldNames = Array.from(
    new Set(
      (summary.fieldNames ?? [])
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim()),
    ),
  ).sort();
  if (summary.emptyResult === true) {
    return {
      contentType,
      sizeBytes: null,
      shape: {
        kind: 'array',
        itemCount: 0,
        sampleItemKeys: fieldNames,
      },
    };
  }
  const rowCount =
    typeof summary.rowCount === 'number' && Number.isFinite(summary.rowCount)
      ? Math.max(0, Math.floor(summary.rowCount))
      : Array.isArray(summary.rows)
        ? summary.rows.length
        : 0;
  if (fieldNames.length === 0 && rowCount === 0) return null;
  return {
    contentType,
    sizeBytes: null,
    shape: {
      kind: 'array',
      itemCount: rowCount,
      sampleItemKeys: fieldNames.slice(0, RESPONSE_ARRAY_SAMPLE_KEY_LIMIT),
    },
  };
}

function computeResponseShape(input: {
  contentType: string | null;
  body: string | null;
  base64Encoded: boolean;
}): KnowledgeApiResponseShape {
  if (input.base64Encoded) return { kind: 'unknown' };
  if (!input.body || input.body.length === 0) return { kind: 'unknown' };
  if (input.contentType && !JSON_CONTENT_TYPE_RE.test(input.contentType)) {
    return { kind: 'unknown' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return { kind: 'unknown' };
  }
  if (parsed === null) return { kind: 'scalar', valueType: 'null' };
  if (Array.isArray(parsed)) {
    const sampleKeys = new Set<string>();
    for (const item of parsed.slice(0, 5)) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          sampleKeys.add(key);
          if (sampleKeys.size >= RESPONSE_ARRAY_SAMPLE_KEY_LIMIT) break;
        }
      }
      if (sampleKeys.size >= RESPONSE_ARRAY_SAMPLE_KEY_LIMIT) break;
    }
    return {
      kind: 'array',
      itemCount: parsed.length,
      sampleItemKeys: Array.from(sampleKeys).sort(),
    };
  }
  if (typeof parsed === 'object') {
    const keys = Object.keys(parsed as Record<string, unknown>).sort();
    return {
      kind: 'object',
      topLevelKeys: keys.slice(0, RESPONSE_OBJECT_KEY_LIMIT),
    };
  }
  if (typeof parsed === 'string') return { kind: 'scalar', valueType: 'string' };
  if (typeof parsed === 'number') return { kind: 'scalar', valueType: 'number' };
  if (typeof parsed === 'boolean') return { kind: 'scalar', valueType: 'boolean' };
  return { kind: 'unknown' };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function mergeHeaders(
  common: Record<string, string> | undefined,
  specific: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (common) for (const k of Object.keys(common)) out[k] = common[k];
  if (specific) for (const k of Object.keys(specific)) out[k] = specific[k];
  return out;
}

function pickHeader(headers: Record<string, string>, name: string): string | null {
  const target = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === target) return headers[k];
  }
  return null;
}

function normalizeMethod(method: string | undefined): string {
  if (!method || typeof method !== 'string') return 'GET';
  return method.trim().toUpperCase() || 'GET';
}

function deriveStatusClass(req: CapturedNetworkRequest): string | null {
  const code =
    typeof req.statusCode === 'number'
      ? req.statusCode
      : typeof req.status === 'number'
        ? req.status
        : null;
  if (code === null || !Number.isFinite(code)) return null;
  if (code >= 100 && code < 600) {
    return `${Math.floor(code / 100)}xx`;
  }
  return null;
}

// ---------------------------------------------------------------------
// Endpoint Candidate derivation
// ---------------------------------------------------------------------
//
// These helpers are pure-additive readers over the same captured
// network bundle that the persistence path already consumes. They
// produce an `EndpointCandidate` view (closed-enum
// search/list/detail/pagination/filter/document/empty/error/noise/unknown_candidate)
// that the DOM-Endpoint correlator and Endpoint Knowledge lineage
// will consume. This view does NOT change the
// persistence path, the repository schema, or any public MCP tool.
//
// Privacy invariant: every field exposed in `EndpointShapeSummary` is
// either a *closed-enum bucket* (sizeClass, contentTypeBucket, kind,
// fieldType) or a *name list* (top-level keys, sample item keys). No
// raw values, no header values, no body, no query *values*. The
// existing `RESPONSE_OBJECT_KEY_LIMIT` / `RESPONSE_ARRAY_SAMPLE_KEY_LIMIT`
// caps remain authoritative — the endpoint candidate summariser composes
// them, never raises them.

const SHAPE_SIZE_SMALL_BYTES = 4 * 1024; // 4 KiB
const SHAPE_SIZE_MEDIUM_BYTES = 64 * 1024; // 64 KiB
const SHAPE_SIZE_LARGE_BYTES = 1024 * 1024; // 1 MiB

function classifySizeClass(byteLen: number | null): EndpointShapeSizeClass {
  if (byteLen === null || !Number.isFinite(byteLen)) return 'unknown';
  if (byteLen <= 0) return 'empty';
  if (byteLen < SHAPE_SIZE_SMALL_BYTES) return 'small';
  if (byteLen < SHAPE_SIZE_MEDIUM_BYTES) return 'medium';
  if (byteLen < SHAPE_SIZE_LARGE_BYTES) return 'large';
  return 'large';
}

function classifyContentTypeBucketFromString(
  contentType: string | null | undefined,
): EndpointContentTypeBucket {
  if (!contentType) return 'unknown';
  const m = contentType.toLowerCase();
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

function fieldTypeOf(value: unknown): EndpointShapeFieldType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') {
    return t as EndpointShapeFieldType;
  }
  // undefined / function / symbol — treat as null for shape purposes.
  return 'null';
}

/**
 * Produce an `EndpointShapeSummary` from a single captured
 * request. Reuses the existing `computeResponseShape` for the
 * structural sniff (so row persistence and candidate classification
 * can never disagree on `kind` for the same body) and
 * adds:
 *   - bounded per-key field types (names → closed enum)
 *   - bucketed size class
 *   - closed-enum content-type bucket
 *   - `available=false` when the body could not be summarised
 *
 * `available=false` is the metadata-only signal that the
 * classifier reads — body absence MUST NOT be treated as
 * "endpoint unusable".
 */
export function summarizeEndpointShapeFromCapturedRequest(
  req: CapturedNetworkRequest,
  commonResponseHeaders: Record<string, string>,
): EndpointShapeSummary {
  const mergedResponseHeaders = mergeHeaders(commonResponseHeaders, req.specificResponseHeaders);
  const contentTypeRaw = pickHeader(mergedResponseHeaders, 'content-type') || req.mimeType || null;
  const contentType = contentTypeRaw ? contentTypeRaw.split(';')[0].trim() : null;
  const contentTypeBucket = classifyContentTypeBucketFromString(contentType);
  const safeSummary = req.safeResponseSummary;
  if (
    safeSummary?.responseSummarySource === 'browser_context_summary' &&
    safeSummary.privacyCheck !== 'failed' &&
    safeSummary.capturedAfterArm === true
  ) {
    const fieldNames = Array.from(
      new Set(
        (safeSummary.fieldNames ?? []).filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0,
        ),
      ),
    ).sort();
    const fieldTypes: Record<string, EndpointShapeFieldType> = {};
    const firstRow = Array.isArray(safeSummary.rows) ? safeSummary.rows[0] : null;
    for (const key of fieldNames) {
      fieldTypes[key] = fieldTypeOf(firstRow ? firstRow[key] : null);
    }
    return {
      kind: 'array',
      topLevelKeys: [],
      rowCount:
        typeof safeSummary.rowCount === 'number' && Number.isFinite(safeSummary.rowCount)
          ? Math.max(0, Math.floor(safeSummary.rowCount))
          : Array.isArray(safeSummary.rows)
            ? safeSummary.rows.length
            : null,
      sampleItemKeys: fieldNames,
      fieldTypes,
      sizeClass: 'unknown',
      contentTypeBucket,
      available: safeSummary.fieldShapeSummaryAvailable === true || fieldNames.length > 0,
    };
  }

  const body = typeof req.responseBody === 'string' ? req.responseBody : null;
  // Size measurement is independent of availability: an explicit
  // empty-string body still measures 0 bytes, even though we cannot
  // summarise its shape. This lets lineage distinguish "0 bytes seen"
  // from "we never saw a body".
  const sizeClass = classifySizeClass(body === null ? null : body.length);

  // Body absent or empty or base64 → metadata-only candidate. Caller
  // must treat this as "we have not seen a parseable shape yet", not
  // "endpoint is broken".
  if (!body || req.base64Encoded === true) {
    return {
      kind: 'unknown',
      topLevelKeys: [],
      rowCount: null,
      sampleItemKeys: [],
      fieldTypes: {},
      sizeClass,
      contentTypeBucket,
      available: false,
    };
  }

  // Reuse the shared structural sniff so kind never disagrees across
  // classifiers. The shared sniff already enforces JSON-only structural parsing;
  // for non-JSON bodies it returns `kind: 'unknown'` and we surface
  // that as an `available` summary with no rowCount/keys.
  // The early-return above already eliminates `base64Encoded === true`.
  const responseShape = computeResponseShape({
    contentType,
    body,
    base64Encoded: false,
  });

  if (responseShape.kind === 'unknown') {
    return {
      kind: 'unknown',
      topLevelKeys: [],
      rowCount: null,
      sampleItemKeys: [],
      fieldTypes: {},
      sizeClass,
      contentTypeBucket,
      available: true,
    };
  }
  if (responseShape.kind === 'scalar') {
    return {
      kind: 'scalar',
      topLevelKeys: [],
      rowCount: null,
      sampleItemKeys: [],
      fieldTypes: {},
      sizeClass,
      contentTypeBucket,
      available: true,
    };
  }

  // Re-parse for fieldType extraction. We already paid the JSON.parse
  // cost in `responseShape`; widening the persistence-facing return type
  // would force a schema migration. Cheaper to re-parse: this
  // path only runs from chrome_network_capture stop, never per-tab.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // The shared sniff succeeded; if we lose the race it is metadata-only.
    return {
      kind: responseShape.kind,
      topLevelKeys: [],
      rowCount: null,
      sampleItemKeys: [],
      fieldTypes: {},
      sizeClass,
      contentTypeBucket,
      available: true,
    };
  }

  if (responseShape.kind === 'array' && Array.isArray(parsed)) {
    // Array body: the shared sniff already sampled item keys (capped). Field types
    // for arrays are recorded only against the *sample* keys. We do
    // NOT record per-item field types — that would risk schema
    // explosion for heterogeneous arrays.
    const fieldTypes: Record<string, EndpointShapeFieldType> = {};
    for (const item of parsed.slice(0, 5)) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const k of responseShape.sampleItemKeys) {
          if (fieldTypes[k]) continue;
          const v = (item as Record<string, unknown>)[k];
          if (v !== undefined) fieldTypes[k] = fieldTypeOf(v);
        }
      }
    }
    return {
      kind: 'array',
      topLevelKeys: [],
      rowCount: parsed.length,
      sampleItemKeys: responseShape.sampleItemKeys,
      fieldTypes,
      sizeClass,
      contentTypeBucket,
      available: true,
    };
  }

  if (
    responseShape.kind === 'object' &&
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed)
  ) {
    const parsedObject = parsed as Record<string, unknown>;
    const fieldTypes: Record<string, EndpointShapeFieldType> = {};
    for (const k of responseShape.topLevelKeys) {
      const v = parsedObject[k];
      if (v !== undefined) fieldTypes[k] = fieldTypeOf(v);
    }
    // rowCount derivation for envelope-shaped responses.
    // {items:[], total_count: 0} / {results:[], hits:[]} → rowCount =
    // length of the canonical inner array (preferred over total_count
    // because total_count can lie about the actual page size).
    let rowCount: number | null = null;
    const arrayKey = responseShape.topLevelKeys.find((k) => fieldTypes[k] === 'array');
    if (arrayKey) {
      const arr = parsedObject[arrayKey];
      if (Array.isArray(arr)) rowCount = arr.length;
    } else {
      const totalKey = responseShape.topLevelKeys.find(
        (k) => fieldTypes[k] === 'number' && /^(total_?count|count|total)$/i.test(k),
      );
      if (totalKey) {
        const n = parsedObject[totalKey];
        if (typeof n === 'number' && Number.isFinite(n)) rowCount = n;
      }
    }
    return {
      kind: 'object',
      topLevelKeys: responseShape.topLevelKeys,
      rowCount,
      sampleItemKeys: [],
      fieldTypes,
      sizeClass,
      contentTypeBucket,
      available: true,
    };
  }

  return {
    kind: responseShape.kind,
    topLevelKeys: [],
    rowCount: null,
    sampleItemKeys: [],
    fieldTypes: {},
    sizeClass,
    contentTypeBucket,
    available: true,
  };
}

/**
 * Produce an `EndpointCandidate[]` view of the captured
 * bundle. Pure: no IO, no `Date.now()`, no env reads.
 *
 * Capped at `KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT` to mirror the
 * persistence path. The two paths share the same cap on purpose so
 * lineage rows and correlation candidates always agree
 * on which requests were "in scope" for a given capture.
 */
export function deriveEndpointCandidatesFromBundle(
  bundle: CapturedNetworkBundle,
): EndpointCandidate[] {
  if (!bundle?.requests || bundle.requests.length === 0) return [];
  const commonRes = bundle.commonResponseHeaders ?? {};
  const out: EndpointCandidate[] = [];
  for (const req of bundle.requests) {
    if (!req?.url || typeof req.url !== 'string') continue;
    if (out.length >= KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT) break;
    const candidate = deriveEndpointCandidateFromRequest(req, commonRes);
    if (candidate) out.push(candidate);
  }
  return out;
}

/**
 * Single-request variant. Useful for correlator
 * flows that already have one captured request and want the
 * candidate verdict without rebuilding a bundle.
 */
export function deriveEndpointCandidateFromRequest(
  req: CapturedNetworkRequest,
  commonResponseHeaders: Record<string, string>,
): EndpointCandidate | null {
  if (!req?.url || typeof req.url !== 'string') return null;
  const mergedResponseHeaders = mergeHeaders(commonResponseHeaders, req.specificResponseHeaders);
  const contentType =
    pickHeader(mergedResponseHeaders, 'content-type') || req.mimeType || undefined;
  const status =
    typeof req.statusCode === 'number'
      ? req.statusCode
      : typeof req.status === 'number'
        ? req.status
        : null;
  const shape = summarizeEndpointShapeFromCapturedRequest(req, commonResponseHeaders);
  return classifyEndpointCandidate({
    url: req.url,
    method: normalizeMethod(req.method),
    type: req.type,
    mimeType: contentType,
    status,
    shape,
  });
}
