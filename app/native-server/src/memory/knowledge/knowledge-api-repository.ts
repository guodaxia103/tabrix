/**
 * Knowledge API endpoint repository (B-017).
 *
 * Storage side of GitHub-first API Knowledge capture v1. The shape of
 * what lands here is curated by `api-knowledge-capture.ts` — this file
 * only owns persistence and dedup-by-signature semantics.
 *
 * Idempotent upsert contract: `(site, endpoint_signature)` is unique.
 * Re-observing the same endpoint:
 *   - increments `sample_count`
 *   - refreshes `last_seen_at` and `status_class`
 *   - replaces `request_summary_blob` / `response_summary_blob` with
 *     the latest (these are already redacted shape-only views)
 *   - keeps the original `first_seen_at` / `source_session_id` /
 *     `source_step_id` / `source_history_ref` (provenance sticks to the
 *     first observation).
 */

import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../db/client';

export interface KnowledgeApiRequestSummary {
  /** Lower-cased header *names* only — never values. Sorted for determinism. */
  headerKeys: readonly string[];
  /** Distinct query parameter *keys*, sorted. */
  queryKeys: readonly string[];
  /**
   * Top-level keys of a structured request body (JSON), sorted. Empty when
   * body is absent / non-JSON. Only the *names* are stored, never values.
   */
  bodyKeys: readonly string[];
  hasAuth: boolean;
  hasCookie: boolean;
}

export interface KnowledgeApiResponseSummary {
  contentType: string | null;
  sizeBytes: number | null;
  /**
   * Coarse shape descriptor:
   *  - 'object' with sorted top-level keys
   *  - 'array' with item count
   *  - 'scalar' for primitive responses
   *  - 'unknown' when the body shape was not recoverable
   */
  shape: KnowledgeApiResponseShape;
}

export type KnowledgeApiResponseShape =
  | { kind: 'object'; topLevelKeys: readonly string[] }
  | { kind: 'array'; itemCount: number; sampleItemKeys: readonly string[] }
  | { kind: 'scalar'; valueType: 'string' | 'number' | 'boolean' | 'null' }
  | { kind: 'unknown' };

export interface KnowledgeApiEndpoint {
  endpointId: string;
  site: string;
  family: string;
  method: string;
  urlPattern: string;
  endpointSignature: string;
  semanticTag: string | null;
  statusClass: string | null;
  requestSummary: KnowledgeApiRequestSummary;
  responseSummary: KnowledgeApiResponseSummary;
  sourceSessionId: string | null;
  sourceStepId: string | null;
  sourceHistoryRef: string | null;
  sampleCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type EndpointSemanticType =
  | 'search'
  | 'list'
  | 'detail'
  | 'pagination'
  | 'filter'
  | 'noise'
  | 'unknown';

export interface ScoredKnowledgeApiEndpoint extends KnowledgeApiEndpoint {
  semanticType: EndpointSemanticType;
  confidence: number;
  usableForTask: boolean;
  fallbackReason: string | null;
}

export interface UpsertKnowledgeApiEndpointInput {
  site: string;
  family: string;
  method: string;
  urlPattern: string;
  endpointSignature: string;
  semanticTag?: string | null;
  statusClass?: string | null;
  requestSummary: KnowledgeApiRequestSummary;
  responseSummary: KnowledgeApiResponseSummary;
  sourceSessionId?: string | null;
  sourceStepId?: string | null;
  sourceHistoryRef?: string | null;
  observedAt: string;
}

interface KnowledgeApiEndpointRow {
  endpoint_id: string;
  site: string;
  family: string;
  method: string;
  url_pattern: string;
  endpoint_signature: string;
  semantic_tag: string | null;
  status_class: string | null;
  request_summary_blob: string;
  response_summary_blob: string;
  source_session_id: string | null;
  source_step_id: string | null;
  source_history_ref: string | null;
  sample_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

function rowToEndpoint(row: KnowledgeApiEndpointRow): KnowledgeApiEndpoint {
  return {
    endpointId: row.endpoint_id,
    site: row.site,
    family: row.family,
    method: row.method,
    urlPattern: row.url_pattern,
    endpointSignature: row.endpoint_signature,
    semanticTag: row.semantic_tag,
    statusClass: row.status_class,
    requestSummary: JSON.parse(row.request_summary_blob) as KnowledgeApiRequestSummary,
    responseSummary: JSON.parse(row.response_summary_blob) as KnowledgeApiResponseSummary,
    sourceSessionId: row.source_session_id,
    sourceStepId: row.source_step_id,
    sourceHistoryRef: row.source_history_ref,
    sampleCount: row.sample_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class KnowledgeApiRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Insert-or-merge a captured endpoint. Returns the resulting row.
   *
   * Concurrency: better-sqlite3 is synchronous; the SELECT + INSERT/UPDATE
   * pair is wrapped in an immediate transaction so concurrent post-processor
   * invocations (within a single Node process) cannot tear an upsert.
   */
  upsert(input: UpsertKnowledgeApiEndpointInput): KnowledgeApiEndpoint {
    const requestBlob = JSON.stringify(input.requestSummary);
    const responseBlob = JSON.stringify(input.responseSummary);
    const semanticTag = input.semanticTag ?? null;
    const statusClass = input.statusClass ?? null;
    const sourceSessionId = input.sourceSessionId ?? null;
    const sourceStepId = input.sourceStepId ?? null;
    const sourceHistoryRef = input.sourceHistoryRef ?? null;

    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare(`SELECT * FROM knowledge_api_endpoints WHERE site = ? AND endpoint_signature = ?`)
        .get(input.site, input.endpointSignature) as KnowledgeApiEndpointRow | undefined;

      if (existing) {
        this.db
          .prepare(
            `UPDATE knowledge_api_endpoints
             SET method = ?,
                 url_pattern = ?,
                 family = ?,
                 semantic_tag = ?,
                 status_class = ?,
                 request_summary_blob = ?,
                 response_summary_blob = ?,
                 sample_count = sample_count + 1,
                 last_seen_at = ?
             WHERE endpoint_id = ?`,
          )
          .run(
            input.method,
            input.urlPattern,
            input.family,
            semanticTag,
            statusClass,
            requestBlob,
            responseBlob,
            input.observedAt,
            existing.endpoint_id,
          );
        return existing.endpoint_id;
      }

      const endpointId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO knowledge_api_endpoints (
             endpoint_id, site, family, method, url_pattern, endpoint_signature,
             semantic_tag, status_class, request_summary_blob, response_summary_blob,
             source_session_id, source_step_id, source_history_ref,
             sample_count, first_seen_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          endpointId,
          input.site,
          input.family,
          input.method,
          input.urlPattern,
          input.endpointSignature,
          semanticTag,
          statusClass,
          requestBlob,
          responseBlob,
          sourceSessionId,
          sourceStepId,
          sourceHistoryRef,
          input.observedAt,
          input.observedAt,
        );
      return endpointId;
    });

    const endpointId = tx();
    const row = this.db
      .prepare(`SELECT * FROM knowledge_api_endpoints WHERE endpoint_id = ?`)
      .get(endpointId) as KnowledgeApiEndpointRow;
    return rowToEndpoint(row);
  }

  findBySignature(site: string, endpointSignature: string): KnowledgeApiEndpoint | null {
    const row = this.db
      .prepare(`SELECT * FROM knowledge_api_endpoints WHERE site = ? AND endpoint_signature = ?`)
      .get(site, endpointSignature) as KnowledgeApiEndpointRow | undefined;
    return row ? rowToEndpoint(row) : null;
  }

  listBySite(site: string, limit = 100): KnowledgeApiEndpoint[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM knowledge_api_endpoints
         WHERE site = ?
         ORDER BY last_seen_at DESC
         LIMIT ?`,
      )
      .all(site, Math.max(1, Math.min(limit, 1000))) as KnowledgeApiEndpointRow[];
    return rows.map(rowToEndpoint);
  }

  listScoredBySite(site: string, limit = 100): ScoredKnowledgeApiEndpoint[] {
    return this.listBySite(site, limit)
      .map(scoreEndpointKnowledge)
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      });
  }

  countAll(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM knowledge_api_endpoints`).get() as {
      n: number;
    };
    return row.n;
  }
}

export function scoreEndpointKnowledge(endpoint: KnowledgeApiEndpoint): ScoredKnowledgeApiEndpoint {
  const semanticType = classifyEndpointSemanticType(endpoint);
  const fallbackReason = deriveEndpointFallbackReason(endpoint, semanticType);
  return {
    ...endpoint,
    semanticType,
    confidence: computeEndpointConfidence(endpoint, semanticType, fallbackReason),
    usableForTask: fallbackReason === null,
    fallbackReason,
  };
}

function classifyEndpointSemanticType(endpoint: KnowledgeApiEndpoint): EndpointSemanticType {
  const tag = (endpoint.semanticTag || '').toLowerCase();
  if (tag.includes('search')) return 'search';
  if (tag.includes('list') || tag.endsWith('_runs') || tag.endsWith('_workflows')) return 'list';
  if (tag.includes('detail') || tag.includes('metadata')) return 'detail';
  if (
    endpoint.requestSummary.queryKeys.some((key) =>
      /^(page|per_page|cursor|after|before)$/.test(key),
    )
  ) {
    return 'pagination';
  }
  if (
    endpoint.requestSummary.queryKeys.some((key) => /^(q|query|filter|state|sort|order)$/.test(key))
  ) {
    return 'filter';
  }
  if (tag.includes('private') || tag.includes('telemetry') || tag.includes('analytics')) {
    return 'noise';
  }
  return 'unknown';
}

function deriveEndpointFallbackReason(
  endpoint: KnowledgeApiEndpoint,
  semanticType: EndpointSemanticType,
): string | null {
  if (semanticType === 'noise') return 'noise_endpoint';
  if (endpoint.method !== 'GET' && endpoint.method !== 'HEAD') return 'non_read_method';
  if (endpoint.statusClass && endpoint.statusClass !== '2xx' && endpoint.statusClass !== '3xx') {
    return `status_${endpoint.statusClass}`;
  }
  if (semanticType === 'unknown') return 'unknown_semantic_type';
  return null;
}

function computeEndpointConfidence(
  endpoint: KnowledgeApiEndpoint,
  semanticType: EndpointSemanticType,
  fallbackReason: string | null,
): number {
  if (fallbackReason) return 0.1;
  let score = 0.4;
  if (semanticType === 'search' || semanticType === 'list') score += 0.25;
  else if (semanticType === 'detail') score += 0.2;
  else if (semanticType === 'pagination' || semanticType === 'filter') score += 0.12;

  if (endpoint.statusClass === '2xx') score += 0.15;
  else if (endpoint.statusClass === '3xx') score += 0.05;

  if (endpoint.responseSummary.shape.kind !== 'unknown') score += 0.1;
  if (endpoint.sampleCount > 1) score += Math.min(0.1, Math.log2(endpoint.sampleCount) * 0.03);
  return Math.max(0, Math.min(0.99, Number(score.toFixed(2))));
}
