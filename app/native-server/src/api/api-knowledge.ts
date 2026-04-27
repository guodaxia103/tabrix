/**
 * V26-FIX-05 — seed-adapter classification.
 *
 * Every symbol in this file is part of the V25 GitHub/npmjs *seed
 * adapter*: a hardcoded family table the v2.5 codebase used as the
 * sole API entry point. Starting with v2.6 the mainline reader is the
 * Knowledge-driven on-demand path (`api-knowledge/endpoint-lookup` +
 * `api-knowledge/safe-request-builder` + `api-knowledge/knowledge-driven-reader`),
 * which is fed by the generic `network-observe-classifier` (FIX-03).
 *
 * This file is therefore a *compatibility surface*, not the mainline:
 *   - `direct-api-executor.tryDirectApiExecute` ALWAYS tries
 *     `lookupEndpointFamily` first when given a `dataNeed` +
 *     `knowledgeRepo`, and only falls back to `resolveApiKnowledgeCandidate`
 *     when the lookup misses.
 *   - Every result that this adapter feeds to the executor is labelled
 *     `endpointSource='seed_adapter'` in
 *     `DirectApiExecutionTelemetry` so the FIX-08 Gate B transformer
 *     can split the run mix into `observed` (mainline) vs
 *     `seed_adapter` (compatibility) vs `manual_seed` (reserved).
 *
 * Do NOT add new platform `*Family` entries here. Any new endpoint a
 * v2.6 contributor wants to teach the reader about must go through
 * the network-observe classifier so it lands in the Memory DB as an
 * `observed` row first; the executor will then pick it up via the
 * lookup path.
 *
 * The `seed_adapter` lineage is the only kind this file emits; the
 * other two members of the `endpointSource` closed enum are produced
 * elsewhere:
 *   - `observed` — emitted by `api-knowledge/safe-request-builder` when
 *     the looked-up row was captured by `chrome_network_capture`.
 *   - `manual_seed` — reserved for an operator-curated catalog; not
 *     produced by any current code path. Documented in the closed
 *     enum so future contributors do not re-invent it.
 */
export type ApiEndpointFamily =
  | 'github_search_repositories'
  | 'github_issues_list'
  | 'github_workflow_runs_list'
  | 'npmjs_search_packages';

export type ApiDataPurpose = 'search_list' | 'issue_list' | 'workflow_runs_list' | 'package_search';

export type ApiKnowledgeFallbackReason =
  | 'unsupported_family'
  | 'unsupported_site_family'
  | 'method_denied'
  | 'invalid_request'
  | 'http_forbidden'
  | 'rate_limited'
  | 'http_error'
  | 'decode_error'
  | 'semantic_mismatch'
  | 'network_timeout'
  | 'network_error';

export interface ApiKnowledgeMetadataInput {
  url: string;
  method?: string | null;
  status?: number | null;
  timingMs?: number | null;
  sizeBytes?: number | null;
  contentType?: string | null;
}

export interface ApiKnowledgeMetadata {
  host: string;
  pathPattern: string;
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OTHER';
  statusClass: string | null;
  timingMs: number | null;
  sizeClass: 'empty' | 'small' | 'medium' | 'large' | 'unknown';
  contentType: string | null;
  endpointFamily: ApiEndpointFamily;
  confidence: number;
  dataPurpose: ApiDataPurpose;
  readAllowed: boolean;
}

export interface ApiKnowledgeCandidate {
  endpointFamily: ApiEndpointFamily;
  dataPurpose: ApiDataPurpose;
  confidence: number;
  method: 'GET';
  params: Record<string, string>;
}

export type ApiKnowledgeCompactRow = Record<string, string | number | boolean | null>;

/**
 * V26-PGB-01 — closed-enum reason for an API read that succeeded but
 * returned zero rows. Today the only producer is "the upstream API
 * answered 200 with an empty list", which we name explicitly so a
 * downstream consumer (operation log / Gate B / AI assistant prompt)
 * can render a deterministic "verified empty" message rather than
 * silently treat `rowCount === 0` as "the API failed". Adding new
 * values requires extending the V26-PGB evidence contract in
 * lockstep, so the union is intentionally narrow.
 */
export type ApiKnowledgeEmptyReason = 'no_matching_records';

export interface ApiKnowledgeReadOk {
  status: 'ok';
  kind: 'api_rows';
  endpointFamily: ApiEndpointFamily;
  dataPurpose: ApiDataPurpose;
  rows: ApiKnowledgeCompactRow[];
  rowCount: number;
  compact: true;
  rawBodyStored: false;
  /**
   * V26-PGB-01 — `true` iff the upstream API answered ok AND returned
   * zero rows. Always present (false on the non-empty happy path) so
   * downstream consumers can grep one stable boolean rather than
   * re-deriving it from `rowCount === 0`.
   */
  emptyResult: boolean;
  /**
   * V26-PGB-01 — closed-enum reason for the empty result; `null` on
   * the non-empty happy path. Today only one producer exists
   * (`no_matching_records`); the field is left open for future
   * empty-but-not-failure cases (e.g. "filtered out by row cap").
   */
  emptyReason: ApiKnowledgeEmptyReason | null;
  /**
   * V26-PGB-01 — human-readable message for the empty result, or
   * `null` on the non-empty happy path. Surfaces verbatim into the
   * `chrome_read_page` `kind:'api_rows'` envelope so an AI assistant
   * can quote it back to the user without re-rendering boilerplate.
   */
  emptyMessage: string | null;
  telemetry: ApiKnowledgeTelemetry;
}

export interface ApiKnowledgeReadFallback {
  status: 'fallback_required';
  endpointFamily?: ApiEndpointFamily;
  reason: ApiKnowledgeFallbackReason;
  fallbackEntryLayer: 'L0+L1';
  telemetry: ApiKnowledgeTelemetry;
}

export type ApiKnowledgeReadResult = ApiKnowledgeReadOk | ApiKnowledgeReadFallback;

export interface ApiKnowledgeTelemetry {
  endpointFamily?: ApiEndpointFamily;
  method: string;
  reason: string;
  status: number | null;
  waitedMs: number;
  readAllowed: boolean;
  fallbackEntryLayer: 'L0+L1' | 'none';
}

interface FetchHeadersLike {
  get(name: string): string | null;
}

interface FetchResponseLike {
  status: number;
  headers: FetchHeadersLike;
  json(): Promise<unknown>;
}

export type ApiKnowledgeFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export interface ApiKnowledgeReadInput {
  endpointFamily: ApiEndpointFamily | string;
  method?: string | null;
  params?: Record<string, string | number | null | undefined>;
  fetchFn?: ApiKnowledgeFetch;
  nowMs?: () => number;
  limit?: number;
}

export interface ApiKnowledgeEndpointReadPlan extends ApiKnowledgeReadInput {
  dataPurpose?: ApiDataPurpose | string | null;
}

export interface ApiKnowledgeIntentReadInput {
  intent: string;
  url?: string;
  pageRole?: string;
  method?: string | null;
  fetchFn?: ApiKnowledgeFetch;
  nowMs?: () => number;
  limit?: number;
}

const READ_METHODS = new Set(['GET', 'HEAD']);
const API_KNOWLEDGE_READ_TIMEOUT_MS = 2500;

export function classifyApiKnowledgeMetadata(
  input: ApiKnowledgeMetadataInput,
): ApiKnowledgeMetadata | null {
  const parsed = parseUrl(input.url);
  if (!parsed) return null;
  const method = normalizeMethod(input.method);
  const seed = classifySeedEndpoint(parsed, method);
  if (!seed) return null;
  return {
    host: parsed.hostname.toLowerCase(),
    pathPattern: seed.pathPattern,
    method,
    statusClass: statusClass(input.status),
    timingMs:
      typeof input.timingMs === 'number' && Number.isFinite(input.timingMs) && input.timingMs >= 0
        ? input.timingMs
        : null,
    sizeClass: sizeClass(input.sizeBytes),
    contentType: sanitizeContentType(input.contentType),
    endpointFamily: seed.endpointFamily,
    confidence: seed.confidence,
    dataPurpose: seed.dataPurpose,
    readAllowed: READ_METHODS.has(method),
  };
}

export function resolveApiKnowledgeCandidate(input: {
  intent: string;
  url?: string;
  pageRole?: string;
}): ApiKnowledgeCandidate | null {
  const intent = normalizeText(input.intent);
  const parsed = input.url ? parseUrl(input.url) : null;
  const host = parsed?.hostname.toLowerCase() ?? '';
  const pageRole = normalizeText(input.pageRole ?? '');

  if (host === 'github.com' || host.endsWith('.github.com')) {
    const repo = parsed ? parseGithubRepo(parsed) : null;
    const issueSearch = parsed ? parseGithubIssueSearch(parsed) : null;
    const wantsIssues =
      pageRole.includes('issues') ||
      /\bissues?\b/.test(intent) ||
      issueSearch !== null ||
      parsed?.searchParams.get('type')?.toLowerCase() === 'issues';
    if (issueSearch && wantsIssues) {
      const params: Record<string, string> = {
        owner: issueSearch.owner,
        repo: issueSearch.repo,
        state: issueSearch.state ?? 'open',
      };
      if (issueSearch.query) params.query = issueSearch.query;
      return {
        endpointFamily: 'github_issues_list',
        dataPurpose: 'issue_list',
        confidence: 0.86,
        method: 'GET',
        params,
      };
    }
    if (repo && wantsIssues) {
      return {
        endpointFamily: 'github_issues_list',
        dataPurpose: 'issue_list',
        confidence: 0.86,
        method: 'GET',
        params: { owner: repo.owner, repo: repo.repo, state: 'open' },
      };
    }
    if (wantsIssues) return null;
    const wantsActions =
      pageRole.includes('actions') ||
      pageRole.includes('workflow') ||
      /\b(actions?|workflow|workflows?|runs?)\b/.test(intent);
    if (repo && wantsActions) {
      return {
        endpointFamily: 'github_workflow_runs_list',
        dataPurpose: 'workflow_runs_list',
        confidence: 0.84,
        method: 'GET',
        params: { owner: repo.owner, repo: repo.repo },
      };
    }
    if (wantsActions) return null;
    if (isSearchListIntent(intent, input.intent, 'github')) {
      const params: Record<string, string> = { query: extractSearchQuery(input.intent) };
      if (isGithubHotSearchIntent(intent, input.intent)) {
        params.sort = 'stars';
        params.order = 'desc';
      }
      return {
        endpointFamily: 'github_search_repositories',
        dataPurpose: 'search_list',
        confidence: 0.82,
        method: 'GET',
        params,
      };
    }
  }

  if (
    host === 'www.npmjs.com' ||
    host === 'npmjs.com' ||
    host === 'registry.npmjs.org' ||
    /\b(npm|npmjs|package|packages?)\b/.test(intent)
  ) {
    if (isSearchListIntent(intent, input.intent, 'npmjs')) {
      return {
        endpointFamily: 'npmjs_search_packages',
        dataPurpose: 'package_search',
        confidence: 0.8,
        method: 'GET',
        params: { query: extractSearchQuery(input.intent) },
      };
    }
  }

  return null;
}

export async function readApiKnowledgeRows(
  input: ApiKnowledgeReadInput,
): Promise<ApiKnowledgeReadResult> {
  const startedAt = input.nowMs?.() ?? Date.now();
  const elapsed = () => Math.max(0, (input.nowMs?.() ?? Date.now()) - startedAt);
  const method = normalizeMethod(input.method);
  const endpointFamily = normalizeEndpointFamily(input.endpointFamily);
  if (!endpointFamily) {
    return fallback({
      reason: 'unsupported_family',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily: undefined,
    });
  }
  if (method !== 'GET') {
    return fallback({
      reason: 'method_denied',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily,
    });
  }

  const request = buildPublicRequest(endpointFamily, input.params ?? {}, input.limit);
  if (!request) {
    return fallback({
      reason: 'invalid_request',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily,
    });
  }
  try {
    const fetchFn = input.fetchFn ?? resolveFetch();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve('timeout');
        controller?.abort();
      }, API_KNOWLEDGE_READ_TIMEOUT_MS);
    });
    const fetched = fetchFn(request.url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'tabrix-api-knowledge/1.0',
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const responseOrTimeout = await Promise.race([fetched, timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    if (responseOrTimeout === 'timeout') {
      return fallback({
        reason: 'network_timeout',
        method,
        status: null,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    const response = responseOrTimeout;
    if (response.status === 429) {
      return fallback({
        reason: 'rate_limited',
        method,
        status: response.status,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    if (response.status === 403) {
      return fallback({
        reason: 'http_forbidden',
        method,
        status: response.status,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    if (response.status >= 400) {
      return fallback({
        reason: 'http_error',
        method,
        status: response.status,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fallback({
        reason: 'decode_error',
        method,
        status: response.status,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    const rows = compactRows(endpointFamily, body, request.limit);
    const emptyResult = rows.length === 0;
    return {
      status: 'ok',
      kind: 'api_rows',
      endpointFamily,
      dataPurpose: request.dataPurpose,
      rows,
      rowCount: rows.length,
      compact: true,
      rawBodyStored: false,
      // V26-PGB-01 — when the upstream API answered ok but returned
      // zero rows, mark the result explicitly as "verified empty"
      // rather than silently surface a 0-row list. This is NOT a
      // fallback condition — the API call succeeded — so we keep
      // `status: 'ok'` and let the caller decide how to render it.
      emptyResult,
      emptyReason: emptyResult ? 'no_matching_records' : null,
      emptyMessage: emptyResult
        ? `API call succeeded but returned no records for the requested ${request.dataPurpose} query.`
        : null,
      telemetry: {
        endpointFamily,
        method,
        reason: 'api_rows',
        status: response.status,
        waitedMs: elapsed(),
        readAllowed: true,
        fallbackEntryLayer: 'none',
      },
    };
  } catch {
    return fallback({
      reason: 'network_error',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily,
    });
  }
}

export async function readApiKnowledgeEndpointPlan(
  input: ApiKnowledgeEndpointReadPlan,
): Promise<ApiKnowledgeReadResult> {
  const startedAt = input.nowMs?.() ?? Date.now();
  const elapsed = () => Math.max(0, (input.nowMs?.() ?? Date.now()) - startedAt);
  const method = normalizeMethod(input.method);
  const endpointFamily = normalizeEndpointFamily(input.endpointFamily);
  if (!endpointFamily) {
    return fallback({
      reason: 'unsupported_family',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily: undefined,
    });
  }
  const expectedPurpose = normalizeDataPurpose(input.dataPurpose);
  const actualPurpose = dataPurposeForFamily(endpointFamily);
  if (expectedPurpose && expectedPurpose !== actualPurpose) {
    return fallback({
      reason: 'semantic_mismatch',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily,
    });
  }
  return readApiKnowledgeRows(input);
}

export async function readApiKnowledgeRowsForIntent(
  input: ApiKnowledgeIntentReadInput,
): Promise<ApiKnowledgeReadResult> {
  const startedAt = input.nowMs?.() ?? Date.now();
  const elapsed = () => Math.max(0, (input.nowMs?.() ?? Date.now()) - startedAt);
  const candidate = resolveApiKnowledgeCandidate({
    intent: input.intent,
    url: input.url,
    pageRole: input.pageRole,
  });
  if (!candidate) {
    return fallback({
      reason: 'unsupported_site_family',
      method: normalizeMethod(input.method),
      status: null,
      waitedMs: elapsed(),
      endpointFamily: undefined,
    });
  }
  return readApiKnowledgeRows({
    endpointFamily: candidate.endpointFamily,
    method: input.method ?? candidate.method,
    params: candidate.params,
    fetchFn: input.fetchFn,
    nowMs: input.nowMs,
    limit: input.limit,
  });
}

function classifySeedEndpoint(parsed: URL, method: ApiKnowledgeMetadata['method']) {
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  if (host === 'api.github.com' && path === '/search/repositories') {
    return {
      endpointFamily: 'github_search_repositories' as const,
      dataPurpose: 'search_list' as const,
      pathPattern: '/search/repositories',
      confidence: method === 'GET' || method === 'HEAD' ? 0.96 : 0.7,
    };
  }
  if (host === 'api.github.com' && /^\/repos\/[^/]+\/[^/]+\/issues\/?$/.test(path)) {
    return {
      endpointFamily: 'github_issues_list' as const,
      dataPurpose: 'issue_list' as const,
      pathPattern: '/repos/:owner/:repo/issues',
      confidence: method === 'GET' || method === 'HEAD' ? 0.94 : 0.7,
    };
  }
  if (host === 'api.github.com' && /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/?$/.test(path)) {
    return {
      endpointFamily: 'github_workflow_runs_list' as const,
      dataPurpose: 'workflow_runs_list' as const,
      pathPattern: '/repos/:owner/:repo/actions/runs',
      confidence: method === 'GET' || method === 'HEAD' ? 0.93 : 0.7,
    };
  }
  if (host === 'registry.npmjs.org' && path === '/-/v1/search') {
    return {
      endpointFamily: 'npmjs_search_packages' as const,
      dataPurpose: 'package_search' as const,
      pathPattern: '/-/v1/search',
      confidence: method === 'GET' || method === 'HEAD' ? 0.94 : 0.7,
    };
  }
  return null;
}

function normalizeEndpointFamily(value: string): ApiEndpointFamily | null {
  if (
    value === 'github_search_repositories' ||
    value === 'github_issues_list' ||
    value === 'github_workflow_runs_list' ||
    value === 'npmjs_search_packages'
  ) {
    return value;
  }
  return null;
}

function normalizeDataPurpose(value: unknown): ApiDataPurpose | null {
  if (
    value === 'search_list' ||
    value === 'issue_list' ||
    value === 'workflow_runs_list' ||
    value === 'package_search'
  ) {
    return value;
  }
  return null;
}

function dataPurposeForFamily(endpointFamily: ApiEndpointFamily): ApiDataPurpose {
  switch (endpointFamily) {
    case 'github_search_repositories':
      return 'search_list';
    case 'github_issues_list':
      return 'issue_list';
    case 'github_workflow_runs_list':
      return 'workflow_runs_list';
    case 'npmjs_search_packages':
      return 'package_search';
  }
}

function buildPublicRequest(
  endpointFamily: ApiEndpointFamily,
  params: Record<string, string | number | null | undefined>,
  limit?: number,
): { url: string; limit: number; dataPurpose: ApiDataPurpose } | null {
  const requestedLimit = Number(limit ?? 10);
  const boundedLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(10, Math.floor(requestedLimit)))
    : 10;
  switch (endpointFamily) {
    case 'github_search_repositories': {
      const q = cleanParam(params.query);
      if (!q) return null;
      const url = new URL('https://api.github.com/search/repositories');
      url.searchParams.set('q', q);
      if (cleanParam(params.sort).toLowerCase() === 'stars') {
        url.searchParams.set('sort', 'stars');
        url.searchParams.set(
          'order',
          cleanParam(params.order).toLowerCase() === 'asc' ? 'asc' : 'desc',
        );
      }
      url.searchParams.set('per_page', String(boundedLimit));
      return { url: url.toString(), limit: boundedLimit, dataPurpose: 'search_list' };
    }
    case 'github_issues_list': {
      const owner = cleanParam(params.owner);
      const repo = cleanParam(params.repo);
      if (!owner || !repo) return null;
      const state = cleanParam(params.state) || 'open';
      const query = cleanParam(params.query);
      const url = new URL('https://api.github.com/search/issues');
      url.searchParams.set(
        'q',
        [`repo:${owner}/${repo}`, 'is:issue', `state:${state}`, query].filter(Boolean).join(' '),
      );
      url.searchParams.set('sort', 'created');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('per_page', String(boundedLimit));
      return { url: url.toString(), limit: boundedLimit, dataPurpose: 'issue_list' };
    }
    case 'github_workflow_runs_list': {
      const owner = cleanParam(params.owner);
      const repo = cleanParam(params.repo);
      if (!owner || !repo) return null;
      const url = new URL(`https://api.github.com/repos/${owner}/${repo}/actions/runs`);
      url.searchParams.set('per_page', String(boundedLimit));
      return { url: url.toString(), limit: boundedLimit, dataPurpose: 'workflow_runs_list' };
    }
    case 'npmjs_search_packages': {
      const text = cleanParam(params.query);
      if (!text) return null;
      const url = new URL('https://registry.npmjs.org/-/v1/search');
      url.searchParams.set('text', text);
      url.searchParams.set('size', String(boundedLimit));
      return { url: url.toString(), limit: boundedLimit, dataPurpose: 'package_search' };
    }
  }
}

function compactRows(
  endpointFamily: ApiEndpointFamily,
  body: unknown,
  limit: number,
): ApiKnowledgeCompactRow[] {
  switch (endpointFamily) {
    case 'github_search_repositories': {
      const items = asArray((body as { items?: unknown })?.items).slice(0, limit);
      return items.map((item) => {
        const obj = asRecord(item);
        return {
          name: stringOrNull(obj.name),
          fullName: stringOrNull(obj.full_name),
          description: stringOrNull(obj.description),
          language: stringOrNull(obj.language),
          stars: numberOrZero(obj.stargazers_count),
          url: stringOrNull(obj.html_url),
        };
      });
    }
    case 'github_issues_list': {
      const bodyRecord = asRecord(body);
      const items = Array.isArray(body) ? body : asArray(bodyRecord.items);
      return items.slice(0, limit).map((item) => {
        const obj = asRecord(item);
        const labels = asArray(obj.labels)
          .map((label) => stringOrNull(asRecord(label).name))
          .filter((label): label is string => !!label)
          .join(',');
        return {
          number: numberOrZero(obj.number),
          title: stringOrNull(obj.title),
          state: stringOrNull(obj.state),
          labels,
          url: stringOrNull(obj.html_url),
        };
      });
    }
    case 'github_workflow_runs_list': {
      const bodyRecord = asRecord(body);
      const runs = Array.isArray(body) ? body : asArray(bodyRecord.workflow_runs);
      return runs.slice(0, limit).map((item) => {
        const obj = asRecord(item);
        return {
          name: stringOrNull(obj.name),
          status: stringOrNull(obj.status),
          conclusion: stringOrNull(obj.conclusion),
          branch: stringOrNull(obj.head_branch),
          event: stringOrNull(obj.event),
          title: stringOrNull(obj.display_title),
          createdAt: stringOrNull(obj.created_at),
          url: stringOrNull(obj.html_url),
        };
      });
    }
    case 'npmjs_search_packages': {
      const objects = asArray((body as { objects?: unknown })?.objects).slice(0, limit);
      return objects.map((entry) => {
        const pkg = asRecord(asRecord(entry).package);
        const links = asRecord(pkg.links);
        const scoreDetail = asRecord(asRecord(asRecord(entry).score).detail);
        const quality = scoreDetail.quality;
        return {
          name: stringOrNull(pkg.name),
          version: stringOrNull(pkg.version),
          description: stringOrNull(pkg.description),
          url: stringOrNull(links.npm),
          quality: typeof quality === 'number' ? quality : null,
        };
      });
    }
  }
}

function fallback(args: {
  reason: ApiKnowledgeFallbackReason;
  method: string;
  status: number | null;
  waitedMs: number;
  endpointFamily?: ApiEndpointFamily;
}): ApiKnowledgeReadFallback {
  return {
    status: 'fallback_required',
    endpointFamily: args.endpointFamily,
    reason: args.reason,
    fallbackEntryLayer: 'L0+L1',
    telemetry: {
      endpointFamily: args.endpointFamily,
      method: args.method,
      reason: args.reason,
      status: args.status,
      waitedMs: args.waitedMs,
      readAllowed: false,
      fallbackEntryLayer: 'L0+L1',
    },
  };
}

function resolveFetch(): ApiKnowledgeFetch {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as unknown as ApiKnowledgeFetch;
  }

  const mod = require('node-fetch');
  return (mod.default ?? mod) as ApiKnowledgeFetch;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeMethod(value: unknown): ApiKnowledgeMetadata['method'] {
  const method = typeof value === 'string' ? value.trim().toUpperCase() : 'GET';
  if (
    method === 'GET' ||
    method === 'HEAD' ||
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE'
  ) {
    return method;
  }
  return 'OTHER';
}

function statusClass(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 100) return null;
  return `${Math.floor(value / 100)}xx`;
}

function sizeClass(value: unknown): ApiKnowledgeMetadata['sizeClass'] {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'unknown';
  if (value === 0) return 'empty';
  if (value <= 16 * 1024) return 'small';
  if (value <= 256 * 1024) return 'medium';
  return 'large';
}

function sanitizeContentType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.split(';')[0]?.trim().toLowerCase().slice(0, 80) || null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isSearchListIntent(
  normalizedIntent: string,
  rawIntent: string,
  family: 'github' | 'npmjs',
): boolean {
  if (/\b(search|find|list|repositories|repos?|projects?|packages?)\b/.test(normalizedIntent)) {
    return true;
  }
  if (/搜索|查找|检索|列出|热门|前\s*\d+\s*个/.test(rawIntent)) {
    return true;
  }
  if (family === 'github') {
    return /仓库|代码库|项目/.test(rawIntent);
  }
  return /软件包|依赖包|npm\s*包|包/.test(rawIntent);
}

function isGithubHotSearchIntent(normalizedIntent: string, rawIntent: string): boolean {
  return (
    /热门|star\s*最多|前\s*\d+\s*个热门项目/i.test(rawIntent) ||
    /\b(top|most starred|stars?|starred)\b/.test(normalizedIntent)
  );
}

function extractSearchQuery(intent: string): string {
  const cleaned = intent
    .replace(
      /\b(search|find|list|top|most\s+starred|starred|stars?|repositories|repos|repository|packages|package|npmjs|npm)\b/gi,
      ' ',
    )
    .replace(/\b(first|top)\s+\d+\b/gi, ' ')
    .replace(/前\s*\d+\s*个/g, ' ')
    .replace(
      /搜索|查找|检索|列出|热门|star\s*最多|相关|项目|仓库|代码库|软件包|依赖包|npm\s*包|包|上|的|和|以及/gi,
      ' ',
    )
    .replace(/GitHub|github|NPMJS|npmjs|NPM|npm/g, ' ')
    .replace(/[，。；：、]/g, ' ')
    .replace(/\b(on|about|related|by|for)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || intent.trim().slice(0, 80) || 'javascript';
}

function parseGithubRepo(parsed: URL): { owner: string; repo: string } | null {
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] === 'search') return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}

function parseGithubIssueSearch(
  parsed: URL,
): { owner: string; repo: string; state: string | null; query: string | null } | null {
  if (parsed.pathname !== '/search') return null;
  const type = parsed.searchParams.get('type')?.toLowerCase();
  const q = parsed.searchParams.get('q') ?? '';
  if (type !== 'issues' && !/\bis:issue\b/i.test(q)) return null;

  const repoMatch = q.match(/\brepo:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!repoMatch) return null;
  const stateMatch = q.match(/\bstate:(open|closed|all)\b/i);
  const query = q
    .replace(repoMatch[0], ' ')
    .replace(/\bis:issue\b/gi, ' ')
    .replace(/\btype:issue\b/gi, ' ')
    .replace(/\bstate:(open|closed|all)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    owner: repoMatch[1],
    repo: repoMatch[2],
    state: stateMatch ? stateMatch[1].toLowerCase() : null,
    query: query || null,
  };
}

function cleanParam(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, 160);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
