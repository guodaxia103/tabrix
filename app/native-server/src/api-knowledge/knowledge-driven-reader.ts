/**
 * V26-FIX-04 — knowledge-driven on-demand reader.
 *
 * Pure async module. Given a `SafeRequestPlan` (output of
 * `safe-request-builder.ts`) and the corresponding `EndpointMatch`,
 * issues exactly one GET request, decodes JSON, and compacts the
 * result into the same shape `readApiKnowledgeRows` already returns
 * for the V25 seed families.
 *
 * Compactor strategy:
 *   1. When the row's `urlPattern` matches one of the V25 seed
 *      families, we delegate to the existing
 *      `readApiKnowledgeRows({ endpointFamily, params })` so the
 *      output is bit-identical to the legacy GitHub/npmjs Gate B
 *      path. This is the FIX-05 transition story: same wire
 *      behaviour today, with the lineage label flip coming next.
 *   2. For `family='observed'` rows we use a small generic
 *      compactor that pulls the top-level array (or `data` /
 *      `items` / `results` / `objects` / `hits`), emits one row per
 *      element, and only keeps primitive fields (string/number/
 *      boolean/null). String values are truncated to a hard cap so
 *      a misbehaving upstream response cannot blow up the rows
 *      payload.
 *
 * Hard rules (mirroring `readApiKnowledgeRows`):
 *   - GET only.
 *   - Single attempt; no retry. (FIX-09 will add bounded retry on
 *     top of this — it is intentionally not in FIX-04.)
 *   - 2.5 s timeout (`KNOWLEDGE_READ_TIMEOUT_MS`).
 *   - Never persists raw bodies; the only output is a redacted row
 *     array + telemetry.
 *   - Emits the same closed-enum `ApiKnowledgeFallbackReason` as
 *     the V25 reader so downstream telemetry stays aligned.
 */

import type {
  ApiKnowledgeCompactRow,
  ApiKnowledgeFallbackReason,
  ApiKnowledgeFetch,
  ApiKnowledgeReadResult,
} from '../api/api-knowledge';
import { readApiKnowledgeRows } from '../api/api-knowledge';
import type { EndpointMatch, SafeRequestPlan } from './types';

const KNOWLEDGE_READ_TIMEOUT_MS = 2500;
const GENERIC_ROW_LIMIT = 10;
const GENERIC_KEYS_PER_ROW = 12;
const GENERIC_STRING_VALUE_CAP = 240;

/** Mirror of the V25 SEED_PATTERN_MAP; kept private to avoid coupling. */
const SEED_PATTERN_FAMILY: ReadonlyMap<
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

export interface KnowledgeDrivenReaderInput {
  match: EndpointMatch;
  plan: SafeRequestPlan;
  /** V25-style param dictionary the seed-family branch needs. */
  seedParams?: Record<string, string | number | null | undefined>;
  fetchFn?: ApiKnowledgeFetch;
  nowMs?: () => number;
  limit?: number;
}

export async function readKnowledgeDrivenEndpoint(
  input: KnowledgeDrivenReaderInput,
): Promise<ApiKnowledgeReadResult> {
  const seedFamily = SEED_PATTERN_FAMILY.get(input.match.endpoint.urlPattern.toLowerCase());
  if (seedFamily) {
    return readApiKnowledgeRows({
      endpointFamily: seedFamily,
      method: 'GET',
      params: input.seedParams ?? {},
      fetchFn: input.fetchFn,
      nowMs: input.nowMs,
      limit: input.limit ?? readLimitFromPlan(input.plan),
    });
  }
  return readGenericEndpoint(input);
}

function readLimitFromPlan(plan: SafeRequestPlan): number | undefined {
  try {
    const url = new URL(plan.url);
    const raw = url.searchParams.get('per_page') ?? url.searchParams.get('size');
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readGenericEndpoint(
  input: KnowledgeDrivenReaderInput,
): Promise<ApiKnowledgeReadResult> {
  const startedAt = input.nowMs?.() ?? Date.now();
  const elapsed = () => Math.max(0, (input.nowMs?.() ?? Date.now()) - startedAt);
  const fetchFn = input.fetchFn ?? resolveFetch();
  const url = input.plan.url;
  const dataPurpose = input.plan.dataPurpose;

  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve('timeout');
        controller?.abort();
      }, KNOWLEDGE_READ_TIMEOUT_MS);
    });
    const fetched = fetchFn(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'tabrix-knowledge-driven/1.0',
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const responseOrTimeout = await Promise.race([fetched, timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    if (responseOrTimeout === 'timeout') {
      return genericFallback('network_timeout', null, elapsed());
    }
    const response = responseOrTimeout;
    if (response.status === 429) return genericFallback('rate_limited', response.status, elapsed());
    if (response.status === 403)
      return genericFallback('http_forbidden', response.status, elapsed());
    if (response.status >= 400) return genericFallback('http_error', response.status, elapsed());

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return genericFallback('decode_error', response.status, elapsed());
    }

    const rows = compactGenericRows(body, input.limit ?? GENERIC_ROW_LIMIT);
    const emptyResult = rows.length === 0;
    return {
      status: 'ok',
      kind: 'api_rows',
      // Cast: the V25 ApiEndpointFamily union is closed; for generic
      // observed rows we surface the urlPattern as a free-form string
      // via the executor's `endpointFamily` field downstream. Here we
      // intentionally drop the field so legacy seed-family consumers
      // do not silently match a generic row by family name.
      endpointFamily: undefined as unknown as ApiKnowledgeReadResult extends {
        endpointFamily: infer F;
      }
        ? F
        : never,
      dataPurpose: dataPurpose as never,
      rows,
      rowCount: rows.length,
      compact: true,
      rawBodyStored: false,
      // V26-PGB-01 — same closed semantics as the V25 seed-family
      // path: 200 + empty list is "verified empty", not a fallback.
      // Generic observed endpoints take the same envelope so the
      // downstream consumer (chrome_read_page shim, operation log,
      // Gate B transformer) does not need to special-case the
      // observed branch.
      emptyResult,
      emptyReason: emptyResult ? 'no_matching_records' : null,
      emptyMessage: emptyResult
        ? `Observed API endpoint succeeded but returned no records for the requested ${dataPurpose} query.`
        : null,
      telemetry: {
        method: 'GET',
        reason: 'api_rows',
        status: response.status,
        waitedMs: elapsed(),
        readAllowed: true,
        fallbackEntryLayer: 'none',
      },
    };
  } catch {
    return genericFallback('network_error', null, elapsed());
  }
}

function genericFallback(
  reason: ApiKnowledgeFallbackReason,
  status: number | null,
  waitedMs: number,
): ApiKnowledgeReadResult {
  return {
    status: 'fallback_required',
    reason,
    fallbackEntryLayer: 'L0+L1',
    telemetry: {
      method: 'GET',
      reason,
      status,
      waitedMs,
      readAllowed: false,
      fallbackEntryLayer: 'L0+L1',
    },
  };
}

const GENERIC_ARRAY_KEYS = [
  'items',
  'data',
  'results',
  'objects',
  'hits',
  'records',
  'list',
  'pages',
  'edges',
];

function compactGenericRows(body: unknown, limit: number): ApiKnowledgeCompactRow[] {
  const list = pickArrayField(body);
  if (!list) return [];
  const cap = Math.max(1, Math.min(GENERIC_ROW_LIMIT, limit));
  const out: ApiKnowledgeCompactRow[] = [];
  for (const raw of list.slice(0, cap)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const keys = Object.keys(row).slice(0, GENERIC_KEYS_PER_ROW);
    const compact: ApiKnowledgeCompactRow = {};
    for (const key of keys) {
      const value = row[key];
      compact[key] = compactPrimitive(value);
    }
    out.push(compact);
  }
  return out;
}

function pickArrayField(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (body === null || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  for (const key of GENERIC_ARRAY_KEYS) {
    const candidate = obj[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function compactPrimitive(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.length > GENERIC_STRING_VALUE_CAP
      ? value.slice(0, GENERIC_STRING_VALUE_CAP)
      : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  // Drop nested objects/arrays — the V25 contract forbids nested values
  // in compact rows; preserving structural depth here would re-open
  // the privacy boundary that FIX-03 pinned shut.
  return null;
}

function resolveFetch(): ApiKnowledgeFetch {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as unknown as ApiKnowledgeFetch;
  }

  const mod = require('node-fetch');
  return (mod.default ?? mod) as ApiKnowledgeFetch;
}
