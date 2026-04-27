/**
 * V26-FIX-04 — generic safe-request builder for the knowledge-driven
 * on-demand reader.
 *
 * Pure function module. Given an `EndpointMatch` (output of
 * `endpoint-lookup.ts`) and the caller's `DataNeed`, produces a
 * `SafeRequestPlan` that the executor can hand to the underlying
 * fetcher. Two builder branches:
 *
 *   1. `seed_adapter` — the looked-up `urlPattern` matches one of the
 *      V25 hardcoded GitHub/npmjs builders. We delegate to the
 *      existing `buildPublicRequest`-style helpers so the produced
 *      URL is bit-identical to the pre-FIX-04 path. This is
 *      intentional: V26-FIX-05 will then label these rows
 *      `endpointSource=seed_adapter` to make the lineage visible in
 *      Gate B reports without breaking any currently-green test.
 *
 *   2. `generic` — for `family='observed'` rows (FIX-03 capture
 *      output) and any future family the chooser learns. We assemble
 *      `https://${site}${pathPattern}?<param>=<value>` from the
 *      persisted `urlPattern` + `requestSummary.queryKeys`, mapping
 *      the caller's `dataNeed.params` onto whichever query key is the
 *      most likely "primary search/text/q" key. We never invent new
 *      query keys — only ones the repository row already observed.
 *
 * Hard rules:
 *   - GET only. Mutation/POST/etc. returns `null`; the executor
 *     collapses that to `fallback_required` so the legacy
 *     `chrome_read_page` chain handles it.
 *   - We never emit cookie / auth / `Authorization` query
 *     parameters. The only values that flow through are
 *     `dataNeed.params` keys explicitly supplied by the caller.
 *   - The output `url` is always an absolute `https://` URL — the
 *     executor must not consume a relative URL.
 *   - `requestShapeUsed` records the *sorted, deduped* list of query
 *     keys actually emitted. The executor surfaces this in the
 *     evidence contract; nothing else owns its shape.
 */

import type { EndpointMatch, DataNeed, SafeRequestPlan } from './types';

/** Capacity hint mirrored from the V25 builder. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;
const MAX_PARAM_VALUE_LENGTH = 160;

/**
 * Map a `<host><path>` urlPattern back to the V25 seed family when
 * possible. `null` ⇒ we will use the generic builder branch.
 *
 * Pattern keys here MUST stay in lockstep with
 * `app/native-server/src/api/api-knowledge.ts` `classifySeedEndpoint`
 * — both modules are about the same physical endpoints; FIX-04 is
 * about reading them through Knowledge, not about adding new ones.
 */
const SEED_PATTERN_MAP: ReadonlyMap<
  string,
  | 'github_search_repositories'
  | 'github_issues_list'
  | 'github_workflow_runs_list'
  | 'npmjs_search_packages'
> = new Map([
  ['api.github.com/search/repositories', 'github_search_repositories'],
  ['api.github.com/repos/:owner/:repo/issues', 'github_issues_list'],
  ['api.github.com/repos/:owner/:repo/actions/runs', 'github_workflow_runs_list'],
  ['registry.npmjs.org/-/v1/search', 'npmjs_search_packages'],
]);

/**
 * Build a safe GET request for the looked-up endpoint, given the
 * caller's `DataNeed`. Returns `null` when:
 *   - the row is not GET
 *   - the seed-adapter branch is required but the caller did not
 *     supply enough parameters (e.g. owner/repo for issues_list)
 *   - the generic branch cannot pick a primary query key for the
 *     supplied params
 */
export function buildSafeRequest(match: EndpointMatch, dataNeed: DataNeed): SafeRequestPlan | null {
  const endpoint = match.endpoint;
  if (endpoint.method !== 'GET') return null;

  const seedFamily = SEED_PATTERN_MAP.get(endpoint.urlPattern.toLowerCase());
  if (seedFamily) {
    return buildSeedAdapterRequest(seedFamily, dataNeed);
  }
  return buildGenericRequest(endpoint, dataNeed);
}

function buildSeedAdapterRequest(
  family:
    | 'github_search_repositories'
    | 'github_issues_list'
    | 'github_workflow_runs_list'
    | 'npmjs_search_packages',
  dataNeed: DataNeed,
): SafeRequestPlan | null {
  const params = dataNeed.params ?? {};
  const limit = clampLimit(numericParam(params.limit), defaultLimitForSeedFamily(family));

  switch (family) {
    case 'github_search_repositories': {
      const q = stringParam(params.query) || stringParam(params.q);
      if (!q) return null;
      const url = new URL('https://api.github.com/search/repositories');
      url.searchParams.set('q', q);
      const sort = stringParam(params.sort).toLowerCase();
      if (sort === 'stars') {
        url.searchParams.set('sort', 'stars');
        url.searchParams.set(
          'order',
          stringParam(params.order).toLowerCase() === 'asc' ? 'asc' : 'desc',
        );
      }
      url.searchParams.set('per_page', String(limit));
      return {
        url: url.toString(),
        method: 'GET',
        dataPurpose: 'search_list',
        requestShapeUsed: sortedDistinctKeys([
          'q',
          ...(sort === 'stars' ? ['sort', 'order'] : []),
          'per_page',
        ]),
        builderHint: 'seed_adapter',
      };
    }
    case 'github_issues_list': {
      const owner = stringParam(params.owner);
      const repo = stringParam(params.repo);
      if (!owner || !repo) return null;
      const state = stringParam(params.state) || 'open';
      const query = stringParam(params.query);
      const url = new URL('https://api.github.com/search/issues');
      url.searchParams.set(
        'q',
        [`repo:${owner}/${repo}`, 'is:issue', `state:${state}`, query].filter(Boolean).join(' '),
      );
      url.searchParams.set('sort', 'created');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('per_page', String(limit));
      return {
        url: url.toString(),
        method: 'GET',
        dataPurpose: 'issue_list',
        requestShapeUsed: sortedDistinctKeys([
          'q',
          ...(query ? ['query'] : []),
          'sort',
          'order',
          'per_page',
        ]),
        builderHint: 'seed_adapter',
      };
    }
    case 'github_workflow_runs_list': {
      const owner = stringParam(params.owner);
      const repo = stringParam(params.repo);
      if (!owner || !repo) return null;
      const url = new URL(`https://api.github.com/repos/${owner}/${repo}/actions/runs`);
      url.searchParams.set('per_page', String(limit));
      return {
        url: url.toString(),
        method: 'GET',
        dataPurpose: 'workflow_runs_list',
        requestShapeUsed: sortedDistinctKeys(['per_page']),
        builderHint: 'seed_adapter',
      };
    }
    case 'npmjs_search_packages': {
      const text = stringParam(params.query) || stringParam(params.text);
      if (!text) return null;
      const url = new URL('https://registry.npmjs.org/-/v1/search');
      url.searchParams.set('text', text);
      url.searchParams.set('size', String(limit));
      return {
        url: url.toString(),
        method: 'GET',
        dataPurpose: 'package_search',
        requestShapeUsed: sortedDistinctKeys(['text', 'size']),
        builderHint: 'seed_adapter',
      };
    }
  }
}

/**
 * Generic builder for `family='observed'` rows. The repository row
 * already carries:
 *   - `urlPattern = '<host><path>'` (host+path, no scheme, no query)
 *   - `requestSummary.queryKeys = sorted distinct keys we observed`
 *
 * We rebuild a URL by:
 *   1. Splitting the urlPattern back into host + path.
 *   2. Choosing a *primary query key* among the observed keys —
 *      preferring `q`/`query`/`text`/`search` style names — and
 *      mapping `dataNeed.params.query` onto it.
 *   3. Optionally adding a `limit/per_page/size` style key when the
 *      observed shape contains one.
 *
 * Anything we cannot resolve (no primary key for a query intent, no
 * params at all) returns `null` so the executor falls back to DOM.
 */
function buildGenericRequest(
  endpoint: EndpointMatch['endpoint'],
  dataNeed: DataNeed,
): SafeRequestPlan | null {
  const urlPattern = endpoint.urlPattern;
  const split = splitHostPath(urlPattern);
  if (!split) return null;
  const { host, path } = split;
  // Identity placeholders (`:owner`, `:user`, etc.) cannot be filled
  // generically — we only persist them as shape; the safe builder
  // refuses to ship a URL with literal `:foo` segments.
  if (path.includes('/:')) return null;

  const observedKeys = endpoint.requestSummary.queryKeys ?? [];
  const params = dataNeed.params ?? {};
  const url = new URL(`https://${host}${path}`);
  const emitted: string[] = [];

  const primaryQueryKey = pickPrimaryQueryKey(observedKeys);
  const queryValue =
    stringParam(params.query) ||
    stringParam(params.q) ||
    stringParam(params.text) ||
    stringParam(params.search);
  if (primaryQueryKey && queryValue) {
    url.searchParams.set(primaryQueryKey, queryValue);
    emitted.push(primaryQueryKey);
  } else if (queryValue && observedKeys.length === 0) {
    // No observed query keys at all — we cannot guess a key name
    // safely. Refuse rather than invent one.
    return null;
  } else if (
    !queryValue &&
    (dataNeed.semanticTypeWanted === 'search' || dataNeed.semanticTypeWanted === 'filter')
  ) {
    // The caller asked for a search/filter but did not supply a
    // value. Without a value we cannot produce a meaningful URL.
    return null;
  }

  const limitKey = pickLimitKey(observedKeys);
  if (limitKey) {
    url.searchParams.set(limitKey, String(clampLimit(numericParam(params.limit))));
    emitted.push(limitKey);
  }

  const semantic = endpoint.semanticType ?? 'unknown';
  return {
    url: url.toString(),
    method: 'GET',
    dataPurpose: `observed_${semantic}`,
    requestShapeUsed: sortedDistinctKeys(emitted),
    builderHint: 'generic',
  };
}

const PRIMARY_QUERY_KEY_PRIORITY: ReadonlyArray<RegExp> = [
  /^q$/i,
  /^query$/i,
  /^text$/i,
  /^search$/i,
  /^term$/i,
  /^keyword$/i,
];

function pickPrimaryQueryKey(observedKeys: ReadonlyArray<string>): string | null {
  for (const re of PRIMARY_QUERY_KEY_PRIORITY) {
    const hit = observedKeys.find((k) => re.test(k));
    if (hit) return hit;
  }
  return null;
}

const LIMIT_KEY_PRIORITY: ReadonlyArray<RegExp> = [
  /^per_page$/i,
  /^perPage$/i,
  /^pageSize$/i,
  /^page_size$/i,
  /^hitsPerPage$/i,
  /^hits_per_page$/i,
  /^size$/i,
  /^limit$/i,
];

function pickLimitKey(observedKeys: ReadonlyArray<string>): string | null {
  for (const re of LIMIT_KEY_PRIORITY) {
    const hit = observedKeys.find((k) => re.test(k));
    if (hit) return hit;
  }
  return null;
}

function splitHostPath(urlPattern: string): { host: string; path: string } | null {
  const slashIdx = urlPattern.indexOf('/');
  if (slashIdx <= 0) {
    // No path or empty host — refuse rather than invent one.
    return urlPattern.length > 0 && slashIdx === -1 ? { host: urlPattern, path: '/' } : null;
  }
  return {
    host: urlPattern.slice(0, slashIdx),
    path: urlPattern.slice(slashIdx) || '/',
  };
}

function stringParam(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, MAX_PARAM_VALUE_LENGTH);
}

function numericParam(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function defaultLimitForSeedFamily(
  _family:
    | 'github_search_repositories'
    | 'github_issues_list'
    | 'github_workflow_runs_list'
    | 'npmjs_search_packages',
): number {
  return DEFAULT_LIMIT;
}

function clampLimit(value: number | null, defaultLimit = DEFAULT_LIMIT): number {
  if (value === null) return defaultLimit;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function sortedDistinctKeys(keys: ReadonlyArray<string>): ReadonlyArray<string> {
  return Array.from(new Set(keys)).sort();
}
