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
import type { UpsertKnowledgeApiEndpointInput } from '../memory/knowledge/knowledge-api-repository';
import { compactGenericRows } from './knowledge-driven-reader';

const LIVE_OBSERVED_ROW_LIMIT = 10;
const LIVE_OBSERVED_CONFIDENCE_FLOOR = 0.7;

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
    }
  >;
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
    const baseEvidence = buildEvidence({
      upsert,
      candidate,
      upsertState,
      fallbackCause: null,
      fallbackUsed: false,
      privacyCheck: 'passed',
    });

    const rowsResult = buildLiveRows(req, candidate);
    if (!rowsResult) {
      rejected.push({
        ...baseEvidence,
        fallbackCause: deriveRejectCause(candidate),
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
      }
    | undefined;
  privacyCheck: 'passed' | 'failed';
  fallbackCause: string | null;
  fallbackUsed: boolean;
}): LiveObservedApiEvidence {
  return {
    endpointSource: 'observed',
    liveObservedEndpointId: input.upsertState?.endpointId ?? null,
    endpointSignature: input.upsert.endpointSignature,
    semanticType: input.candidate.semanticType,
    pageRegion: 'current_page_network',
    correlationScore: input.candidate.confidence,
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
): {
  selectedDataSource: LiveObservedSelectedDataSource;
  rows: ApiKnowledgeCompactRow[];
} | null {
  if (candidate.confidence < LIVE_OBSERVED_CONFIDENCE_FLOOR) return null;
  if (!candidate.shapeSummaryAvailable) return null;

  const status =
    typeof req.statusCode === 'number'
      ? req.statusCode
      : typeof req.status === 'number'
        ? req.status
        : null;
  if (status !== null && (status < 200 || status >= 300)) return null;

  const body = typeof req.responseBody === 'string' ? req.responseBody : null;
  if (!body || req.base64Encoded === true) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (candidate.semanticType === 'empty') {
    return { selectedDataSource: 'api_rows', rows: [] };
  }
  if (!READ_SHAPED_TYPES.has(candidate.semanticType)) return null;

  const rows = compactGenericRows(parsed, LIVE_OBSERVED_ROW_LIMIT);
  if (rows.length === 0) return null;
  return {
    selectedDataSource: candidate.semanticType === 'detail' ? 'api_detail' : 'api_rows',
    rows,
  };
}

function deriveRejectCause(candidate: EndpointCandidate): string {
  if (!candidate.shapeSummaryAvailable) return 'field_shape_unavailable';
  if (candidate.confidence < LIVE_OBSERVED_CONFIDENCE_FLOOR) return 'low_confidence';
  if (candidate.semanticType === 'error') return candidate.noiseReason ?? 'endpoint_error';
  if (candidate.semanticType === 'noise') return candidate.noiseReason ?? 'noise_endpoint';
  if (candidate.semanticType === 'unknown_candidate') {
    return candidate.noiseReason ?? 'unknown_semantic_type';
  }
  return 'compact_rows_unavailable';
}
