/**
 * API Knowledge capture v1 — GitHub-first (B-017).
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
 * Scope (v1):
 *  - Only `api.github.com` URLs (host-prefix match). Same-origin
 *    `github.com/<owner>/<repo>/...` HTML/AJAX is intentionally out: it
 *    overlaps with page-snapshot logic and adds noise without unlocking
 *    new structured data.
 *  - Semantic tagging covers the four representative endpoint families
 *    that drive the highest-value B-018 decisions: issues list, pulls
 *    list, actions runs list, search/issues. Anything else under
 *    api.github.com is captured as `github.unclassified`.
 */

import type {
  KnowledgeApiRequestSummary,
  KnowledgeApiResponseShape,
  KnowledgeApiResponseSummary,
  UpsertKnowledgeApiEndpointInput,
} from './knowledge-api-repository';

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
  status?: number | string;
  statusCode?: number;
  mimeType?: string;
  requestBody?: string | null;
  responseBody?: string | null;
  base64Encoded?: boolean;
  specificRequestHeaders?: Record<string, string>;
  specificResponseHeaders?: Record<string, string>;
  errorText?: string;
}

export interface CapturedNetworkBundle {
  requests?: readonly CapturedNetworkRequest[];
  commonRequestHeaders?: Record<string, string>;
  commonResponseHeaders?: Record<string, string>;
  tabUrl?: string;
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
  const out: UpsertKnowledgeApiEndpointInput[] = [];
  if (!bundle?.requests || bundle.requests.length === 0) return out;
  const commonReq = bundle.commonRequestHeaders ?? {};
  const commonRes = bundle.commonResponseHeaders ?? {};

  for (const req of bundle.requests) {
    if (out.length >= KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT) break;
    const derived = deriveKnowledgeFromRequest(req, commonReq, commonRes, ctx);
    if (derived) out.push(derived);
  }
  return out;
}

export function deriveKnowledgeFromRequest(
  req: CapturedNetworkRequest,
  commonRequestHeaders: Record<string, string>,
  commonResponseHeaders: Record<string, string>,
  ctx: CaptureKnowledgeContext,
): UpsertKnowledgeApiEndpointInput | null {
  if (!req?.url || typeof req.url !== 'string') return null;
  const classification = classifyGitHubFamily(req.url, normalizeMethod(req.method));
  if (!classification) return null;

  const mergedRequestHeaders = mergeHeaders(commonRequestHeaders, req.specificRequestHeaders);
  const mergedResponseHeaders = mergeHeaders(commonResponseHeaders, req.specificResponseHeaders);

  const requestSummary = buildRequestSummary({
    url: req.url,
    headers: mergedRequestHeaders,
    body: req.requestBody ?? null,
  });

  const contentType = pickHeader(mergedResponseHeaders, 'content-type');
  const responseSummary = buildResponseSummary({
    contentType,
    body: req.responseBody ?? null,
    base64Encoded: req.base64Encoded === true,
  });

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
  };
}

// ---------------------------------------------------------------------
// GitHub-family classifier
// ---------------------------------------------------------------------

interface ClassifiedEndpoint {
  site: string;
  family: 'github';
  method: string;
  urlPattern: string;
  endpointSignature: string;
  semanticTag: string;
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
 * Replace numeric path segments with `:id` and large opaque slugs with
 * `:slug`. Never echoes back raw segments — keeps the signature space
 * small even for endpoints we have not classified yet.
 */
function collapseUnknownPath(path: string): string {
  const segments = path.split('/').map((seg) => {
    if (seg.length === 0) return seg;
    if (/^\d+$/.test(seg)) return ':id';
    if (seg.length > 24 && /^[A-Za-z0-9_-]+$/.test(seg)) return ':slug';
    return seg;
  });
  return segments.join('/');
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
