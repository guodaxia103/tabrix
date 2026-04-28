/**
 * V27-10R — current-task live observed API data selector.
 *
 * This module converts a just-stopped `chrome_network_capture` bundle
 * into safe compact rows for the same task. It never persists or
 * returns raw request/response bodies; the raw response body is parsed
 * in memory only long enough to build `ApiKnowledgeCompactRow[]`.
 */

import type { ApiKnowledgeCompactRow } from '../api/api-knowledge';
import {
  type CapturedNetworkBundle,
  type CapturedNetworkRequest,
  type CaptureKnowledgeContext,
  deriveEndpointCandidateFromRequest,
  deriveKnowledgeFromRequest,
} from '../memory/knowledge/api-knowledge-capture';
import type {
  EndpointCandidate,
  EndpointCandidateSemanticType,
} from '../memory/knowledge/network-observe-classifier';
import type {
  CorrelationConfidenceLevel,
  UpsertKnowledgeApiEndpointInput,
} from '../memory/knowledge/knowledge-api-repository';
import { compactGenericRows } from './knowledge-driven-reader';

const LIVE_OBSERVED_ROW_LIMIT = 10;
const LIVE_OBSERVED_CONFIDENCE_FLOOR = 0.7;
const LIVE_OBSERVED_TASK_QUERY_RELEVANCE_FLOOR = 0.72;
const LIVE_OBSERVED_DOM_CORRELATION_FLOOR = 0.9;

const READ_SHAPED_TYPES: ReadonlySet<EndpointCandidateSemanticType> = new Set([
  'search',
  'list',
  'pagination',
  'filter',
  'detail',
]);

export type LiveObservedSelectedDataSource = 'api_rows' | 'api_detail';

export interface LiveObservedApiEvidence {
  endpointSource: 'observed';
  liveObservedEndpointId: string | null;
  endpointSignature: string;
  semanticType: EndpointCandidateSemanticType;
  pageRegion: string;
  correlationScore: number;
  fieldShapeSummaryAvailable: boolean;
  privacyCheck: 'passed' | 'failed';
  fallbackCause: string | null;
  fallbackUsed: boolean;
  knowledgeUpserted: boolean;
}

export interface LiveObservedApiData extends LiveObservedApiEvidence {
  selectedDataSource: LiveObservedSelectedDataSource;
  endpointFamily: string;
  dataPurpose: string;
  rows: ApiKnowledgeCompactRow[];
  rowCount: number;
  emptyResult: boolean;
  emptyReason: 'no_matching_records' | null;
  emptyMessage: string | null;
  compact: true;
  rawBodyStored: false;
}

export interface DeriveLiveObservedApiDataInput {
  bundle: CapturedNetworkBundle;
  ctx: CaptureKnowledgeContext;
  upsertedBySignature: ReadonlyMap<
    string,
    {
      endpointId: string | null;
      knowledgeUpserted: boolean;
      correlationConfidence: CorrelationConfidenceLevel | null;
      correlatedRegionId: string | null;
    }
  >;
  selectorContext?: {
    currentPageUrl?: string | null;
    pageRole?: string | null;
    expectedTaskQueryKeys?: readonly string[];
  };
}

export interface DeriveLiveObservedApiDataResult {
  selected: LiveObservedApiData[];
  rejected: LiveObservedApiEvidence[];
}

export function deriveLiveObservedApiDataFromBundle(
  input: DeriveLiveObservedApiDataInput,
): DeriveLiveObservedApiDataResult {
  const selected: LiveObservedApiData[] = [];
  const rejected: LiveObservedApiEvidence[] = [];
  const commonReq = input.bundle.commonRequestHeaders ?? {};
  const commonRes = input.bundle.commonResponseHeaders ?? {};

  for (const req of input.bundle.requests ?? []) {
    const upsert = deriveKnowledgeFromRequest(req, commonReq, commonRes, input.ctx);
    const candidate = deriveEndpointCandidateFromRequest(req, commonRes);
    if (!upsert || !candidate) continue;
    if (upsert.endpointSource !== 'observed') continue;

    const upsertState = input.upsertedBySignature.get(upsert.endpointSignature);
    const relevance = buildRelevanceEvidence({
      req,
      candidate,
      upsertState,
      selectorContext: input.selectorContext,
    });
    const baseEvidence = buildEvidence({
      upsert,
      candidate,
      upsertState,
      pageRegion: relevance.pageRegion,
      correlationScore: relevance.correlationScore,
      fallbackCause: null,
      fallbackUsed: false,
      privacyCheck: 'passed',
    });

    const rowsResult = buildLiveRows(req, candidate);
    if (!rowsResult.ok) {
      rejected.push({
        ...baseEvidence,
        fallbackCause: rowsResult.cause,
        fallbackUsed: true,
      });
      continue;
    }
    if (!relevance.relevant) {
      rejected.push({
        ...baseEvidence,
        fallbackCause: relevance.fallbackCause,
        fallbackUsed: true,
      });
      continue;
    }

    selected.push({
      ...baseEvidence,
      selectedDataSource: rowsResult.selectedDataSource,
      endpointFamily: upsert.urlPattern,
      dataPurpose: `observed_${candidate.semanticType}`,
      rows: rowsResult.rows,
      rowCount: rowsResult.rows.length,
      emptyResult: rowsResult.rows.length === 0,
      emptyReason: rowsResult.rows.length === 0 ? 'no_matching_records' : null,
      emptyMessage:
        rowsResult.rows.length === 0
          ? `Observed API endpoint ${upsert.urlPattern} succeeded but returned no records.`
          : null,
      compact: true,
      rawBodyStored: false,
    });
  }

  selected.sort((a, b) => b.correlationScore - a.correlationScore);
  return { selected, rejected };
}

function buildEvidence(input: {
  upsert: UpsertKnowledgeApiEndpointInput;
  candidate: EndpointCandidate;
  upsertState:
    | {
        endpointId: string | null;
        knowledgeUpserted: boolean;
        correlationConfidence: CorrelationConfidenceLevel | null;
        correlatedRegionId: string | null;
      }
    | undefined;
  pageRegion: string;
  correlationScore: number;
  privacyCheck: 'passed' | 'failed';
  fallbackCause: string | null;
  fallbackUsed: boolean;
}): LiveObservedApiEvidence {
  return {
    endpointSource: 'observed',
    liveObservedEndpointId: input.upsertState?.endpointId ?? null,
    endpointSignature: input.upsert.endpointSignature,
    semanticType: input.candidate.semanticType,
    pageRegion: input.pageRegion,
    correlationScore: input.correlationScore,
    fieldShapeSummaryAvailable: input.candidate.shapeSummaryAvailable,
    privacyCheck: input.privacyCheck,
    fallbackCause: input.fallbackCause,
    fallbackUsed: input.fallbackUsed,
    knowledgeUpserted: input.upsertState?.knowledgeUpserted === true,
  };
}

function buildLiveRows(
  req: CapturedNetworkRequest,
  candidate: EndpointCandidate,
):
  | {
      ok: true;
      selectedDataSource: LiveObservedSelectedDataSource;
      rows: ApiKnowledgeCompactRow[];
    }
  | {
      ok: false;
      cause: string;
    } {
  const status =
    typeof req.statusCode === 'number'
      ? req.statusCode
      : typeof req.status === 'number'
        ? req.status
        : null;
  if (status !== null && (status < 200 || status >= 300)) {
    if (candidate.semanticType === 'error') {
      return { ok: false, cause: candidate.noiseReason ?? 'endpoint_error' };
    }
    return { ok: false, cause: 'endpoint_error' };
  }

  const body = typeof req.responseBody === 'string' ? req.responseBody : null;
  if (!body || req.base64Encoded === true) {
    return {
      ok: false,
      cause: candidate.responseBodyUnavailable
        ? 'metadata_only_capture'
        : 'response_body_unavailable',
    };
  }
  if (candidate.confidence < LIVE_OBSERVED_CONFIDENCE_FLOOR) {
    return { ok: false, cause: 'low_confidence' };
  }
  if (!candidate.shapeSummaryAvailable) {
    return { ok: false, cause: 'field_shape_unavailable' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, cause: 'compact_rows_unavailable' };
  }

  if (candidate.semanticType === 'empty') {
    return { ok: true, selectedDataSource: 'api_rows', rows: [] };
  }
  if (!READ_SHAPED_TYPES.has(candidate.semanticType)) {
    if (candidate.semanticType === 'noise') {
      return { ok: false, cause: candidate.noiseReason ?? 'noise_endpoint' };
    }
    if (candidate.semanticType === 'unknown_candidate') {
      return { ok: false, cause: candidate.noiseReason ?? 'unknown_semantic_type' };
    }
    return { ok: false, cause: 'compact_rows_unavailable' };
  }

  const rows = compactGenericRows(parsed, LIVE_OBSERVED_ROW_LIMIT);
  if (rows.length === 0) {
    return { ok: false, cause: 'compact_rows_unavailable' };
  }
  return {
    ok: true,
    selectedDataSource: candidate.semanticType === 'detail' ? 'api_detail' : 'api_rows',
    rows,
  };
}

function buildRelevanceEvidence(args: {
  req: CapturedNetworkRequest;
  candidate: EndpointCandidate;
  upsertState:
    | {
        endpointId: string | null;
        knowledgeUpserted: boolean;
        correlationConfidence: CorrelationConfidenceLevel | null;
        correlatedRegionId: string | null;
      }
    | undefined;
  selectorContext:
    | {
        currentPageUrl?: string | null;
        pageRole?: string | null;
        expectedTaskQueryKeys?: readonly string[];
      }
    | undefined;
}): {
  relevant: boolean;
  fallbackCause: string;
  pageRegion: string;
  correlationScore: number;
} {
  const domRegionId = sanitizeRegion(args.upsertState?.correlatedRegionId ?? null);
  const correlationConfidence = args.upsertState?.correlationConfidence ?? null;
  const hasConcreteDomRegion = domRegionId !== null && domRegionId !== 'current_page_network';
  if (hasConcreteDomRegion && correlationConfidence === 'low_confidence') {
    return {
      relevant: false,
      fallbackCause: 'low_correlation_confidence',
      pageRegion: domRegionId,
      correlationScore: args.candidate.confidence,
    };
  }
  if (hasConcreteDomRegion && correlationConfidence === 'high_confidence') {
    return {
      relevant: true,
      fallbackCause: '',
      pageRegion: domRegionId,
      correlationScore: Math.max(args.candidate.confidence, LIVE_OBSERVED_DOM_CORRELATION_FLOOR),
    };
  }

  const taskQueryRelevance = evaluateTaskQueryRelevance(args.req, args.selectorContext);
  if (taskQueryRelevance.status === 'matched') {
    return {
      relevant: true,
      fallbackCause: '',
      pageRegion: 'task_query_network',
      correlationScore: Math.max(
        args.candidate.confidence,
        LIVE_OBSERVED_TASK_QUERY_RELEVANCE_FLOOR,
      ),
    };
  }

  return {
    relevant: false,
    fallbackCause:
      taskQueryRelevance.status === 'value_unproven'
        ? 'task_query_value_unproven'
        : args.selectorContext?.currentPageUrl
          ? 'relevance_unproven'
          : 'dom_region_correlation_missing',
    pageRegion: 'current_page_network',
    correlationScore: args.candidate.confidence,
  };
}

function sanitizeRegion(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type TaskQueryRelevance =
  | { status: 'matched' }
  | { status: 'value_unproven' }
  | { status: 'missing' };

function evaluateTaskQueryRelevance(
  req: CapturedNetworkRequest,
  selectorContext:
    | {
        currentPageUrl?: string | null;
        pageRole?: string | null;
        expectedTaskQueryKeys?: readonly string[];
      }
    | undefined,
): TaskQueryRelevance {
  const currentUrl = parseUrl(selectorContext?.currentPageUrl ?? null);
  const requestUrl = parseUrl(req.url);
  if (!currentUrl || !requestUrl) return { status: 'missing' };
  if (!hostLooksRelated(currentUrl.hostname, requestUrl.hostname)) return { status: 'missing' };

  const requestSearchValues = extractComparableSearchValues(requestUrl);
  const currentSearchValues = extractComparableSearchValues(currentUrl);
  if (requestSearchValues.length > 0 && currentSearchValues.length > 0) {
    return intersects(requestSearchValues, currentSearchValues)
      ? { status: 'matched' }
      : { status: 'value_unproven' };
  }

  const requestRelevant = filterRelevantKeys(extractQueryKeys(requestUrl));
  const currentRelevant = filterRelevantKeys(extractQueryKeys(currentUrl));
  const expectedTaskQueryKeys = filterRelevantKeys(
    normalizeKeys(selectorContext?.expectedTaskQueryKeys ?? []),
  );
  if (
    requestRelevant.length > 0 &&
    (currentRelevant.length > 0 || expectedTaskQueryKeys.length > 0)
  ) {
    return { status: 'value_unproven' };
  }

  const pagePathLooksLikeSearch = /(?:^|\/)(search|query|discover)(?:\/|$)/i.test(
    currentUrl.pathname,
  );
  const requestPathLooksLikeSearch = /(?:^|\/)(search|query|list)(?:\/|$)/i.test(
    requestUrl.pathname,
  );
  return pagePathLooksLikeSearch && requestPathLooksLikeSearch
    ? { status: 'value_unproven' }
    : { status: 'missing' };
}

function parseUrl(value: string | null | undefined): URL | null {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function extractQueryKeys(url: URL): string[] {
  const keys: string[] = [];
  for (const key of url.searchParams.keys()) {
    keys.push(key.toLowerCase());
  }
  return Array.from(new Set(keys)).sort();
}

function normalizeKeys(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0)),
  ).sort();
}

function extractComparableSearchValues(url: URL): string[] {
  const SEARCH_VALUE_KEYS = new Set(['q', 'query', 'search', 'keyword', 'keywords', 'term']);
  const values: string[] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!SEARCH_VALUE_KEYS.has(key.toLowerCase())) continue;
    const normalized = normalizeQueryValue(value);
    if (normalized.length > 0) values.push(normalized);
  }
  return Array.from(new Set(values)).sort();
}

function normalizeQueryValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hostLooksRelated(currentHost: string, requestHost: string): boolean {
  if (currentHost === requestHost) return true;
  return currentHost.endsWith(`.${requestHost}`) || requestHost.endsWith(`.${currentHost}`);
}

function filterRelevantKeys(keys: readonly string[]): string[] {
  const RELEVANT_KEYS = new Set([
    'q',
    'query',
    'search',
    'keyword',
    'keywords',
    'term',
    'filter',
    'sort',
    'order',
    'tag',
    'tags',
    'page',
    'cursor',
  ]);
  return keys.filter((key) => RELEVANT_KEYS.has(key));
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(right);
  for (const item of left) {
    if (set.has(item)) return true;
  }
  return false;
}
