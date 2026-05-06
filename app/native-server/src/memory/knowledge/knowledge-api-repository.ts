/**
 * Knowledge API endpoint repository.
 *
 * Storage side of API Knowledge capture. The shape of
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
  /**
   * Generic classifier output, persisted alongside the original
   * `semanticTag`. `null` for rows written before the classifier
   * columns were introduced; populated for every row written through
   * `api-knowledge-capture.ts` after that point.
   */
  semanticTypePersisted: EndpointSemanticType | null;
  queryParamsShape: string | null;
  responseShapeSummary: string | null;
  usableForTaskPersisted: boolean | null;
  noiseReason: string | null;
  /**
   * Endpoint Knowledge lineage. Always populated on read:
   *  - `endpointSource` — closed enum, derived from the persisted
   *    column when present; otherwise back-derived from `family`
   *    (`'observed'` ↔ observed; `'github' | 'npmjs'` ↔ seed_adapter;
   *    everything else ↔ `'unknown'`).
   *  - `correlationConfidence` — closed enum from the DOM-endpoint correlator. Single-
   *    session writes are capped at `'low_confidence'`.
   *  - `schemaVersion` — `1` for legacy rows, `2` for lineage-aware
   *    rows. Reader collapses `null` → `1`.
   */
  endpointSource: EndpointSource;
  correlationConfidence: CorrelationConfidenceLevel | null;
  correlatedRegionId: string | null;
  confidenceReason: string | null;
  retirementCandidate: boolean;
  sourceLineage: EndpointSourceLineage | null;
  schemaVersion: 1 | 2;
  /**
   * Explicit evidence-contract field. Closed-enum
   * reason for the most recent failure observed against this row
   * (timeout / status_4xx / status_5xx / semantic_mismatch /
   * shape_drift / empty_response / unknown). `null` when no failure
   * evidence is on file. The reader never invents a value here —
   * absence is meaningful for older rows.
   */
  lastFailureReason: EndpointLastFailureReason | null;
  /**
   * Derived from `endpointSource` + `retirementCandidate`.
   * The evidence contract requires a stand-alone field for
   * the seed-adapter retirement state so consumers do not have to
   * compose two columns to answer "is this seed adapter still
   * authoritative?". Derivation rules:
   *
   *   - `endpointSource='deprecated_seed'` → `'deprecated'`
   *   - `endpointSource='seed_adapter'` + `retirementCandidate=true` → `'retirement_candidate'`
   *   - `endpointSource='seed_adapter'` + `retirementCandidate=false` → `'active'`
   *   - all other endpointSource values → `'not_applicable'`
   *
   * Never persisted as its own column — the writer cannot drift
   * relative to the two source columns because the reader recomputes
   * the value on every load.
   */
  seedAdapterRetirementState: SeedAdapterRetirementState;
}

/**
 * Closed enum for "where did this row originate". The legal values are aligned with
 * `safe-request-builder.ts`:
 *   - `observed` — captured via `chrome_network_capture` and a
 *     endpoint candidate classifier verdict.
 *   - `seed_adapter` — backed by a hardcoded GitHub/npmjs
 *     seed entry under `app/native-server/src/api/api-knowledge.ts`.
 *   - `manual_seed` — operator-curated row (currently unused; kept
 *     for forward-compat so a future maintainer-private seed import
 *     does not need a schema bump).
 *   - `unknown` — legacy row with no derivable hint.
 *   - `deprecated_seed` — a seed_adapter row that has
 *     been explicitly retired by the retirement-state writer
 *     because a same-site observed peer has stably outperformed it.
 *     The row is NEVER deleted; the value lets the lookup ranker
 *     drop it below all live sources without losing the lineage.
 */
export type EndpointSource =
  | 'observed'
  | 'seed_adapter'
  | 'manual_seed'
  | 'unknown'
  | 'deprecated_seed';

/**
 * Derived view of where a row sits on the seed-adapter
 * retirement state machine. See `KnowledgeApiEndpoint.seedAdapterRetirementState`.
 *
 *   - `'not_applicable'`     — endpointSource is not a seed-flavoured row.
 *   - `'active'`             — `seed_adapter` row that has not (yet) been flagged.
 *   - `'retirement_candidate'` — `seed_adapter` row flagged by the lookup as
 *                                 about-to-be-retired (an observed peer
 *                                 met the retirement criteria for this
 *                                 site/semantic_type).
 *   - `'deprecated'`         — `deprecated_seed` row; observed peer wins.
 */
export type SeedAdapterRetirementState =
  | 'not_applicable'
  | 'active'
  | 'retirement_candidate'
  | 'deprecated';

/**
 * Closed-enum failure reason carried in the evidence contract.
 * The repository persists exactly the values the
 * writer supplies; the reader never invents one. Adding a new value
 * here is a schema-cite event.
 */
export type EndpointLastFailureReason =
  | 'timeout'
  | 'status_4xx'
  | 'status_5xx'
  | 'semantic_mismatch'
  | 'shape_drift'
  | 'empty_response'
  | 'rate_limited'
  | 'unknown';

/**
 * Closed-enum migration mode emitted by `upsertWithEvidence` so evidence
 * consumers can tell whether an upsert was a legacy no-op, an additive
 * upgrade of a legacy row, or a first lineage-aware write.
 *
 *   - `'legacy_no_op'`     — input did not carry any lineage
 *                             field; the row stays at schemaVersion=1.
 *                             (Existing callers that have not been
 *                             migrated to lineage-aware writes take this path.)
 *   - `'additive_upgrade'` — existing schemaVersion=1 row gained
 *                             lineage fields on this upsert; row now
 *                             reports schemaVersion=2.
 *   - `'virgin_v2_write'`  — brand-new row written with schemaVersion=2
 *                             from the first upsert.
 *   - `'v2_refresh'`       — existing schemaVersion=2 row was re-observed;
 *                             lineage merged, no migration occurred.
 *   - `'unknown'`          — fallback. Should never happen in
 *                             production; reserved so a future
 *                             unanticipated path does not throw.
 */
export type EndpointMigrationMode =
  | 'legacy_no_op'
  | 'additive_upgrade'
  | 'virgin_v2_write'
  | 'v2_refresh'
  | 'unknown';

/**
 * Evidence object returned alongside the upserted row by `upsertWithEvidence`.
 * Carries the evidence contract
 * fields (`confidenceBefore`, `confidenceAfter`, `migrationMode`)
 * the row alone cannot express. The legacy `upsert(input)` path
 * still returns just the row for backward compatibility.
 */
export interface UpsertEndpointEvidence {
  confidenceBefore: number | null;
  confidenceAfter: number;
  /** True when the upsert produced a strictly different confidence value. */
  confidenceChanged: boolean;
  migrationMode: EndpointMigrationMode;
  endpointSource: EndpointSource;
  seedAdapterRetirementState: SeedAdapterRetirementState;
  schemaVersion: 1 | 2;
  lastFailureReason: EndpointLastFailureReason | null;
  usableForTask: boolean;
}

/**
 * Closed enum for the correlation confidence carried over
 * from `dom-endpoint-correlator.ts`. The single-session correlator
 * NEVER writes `'high_confidence'` — that bucket is reserved for
 * multi-session escalation.
 */
export type CorrelationConfidenceLevel = 'unknown_candidate' | 'low_confidence' | 'high_confidence';

/**
 * Small structured lineage breadcrumb persisted alongside a
 * row. Closed-enum fields only; never raw values, never user input.
 *
 * `semanticSource` records the producer of the semantic verdict:
 *   - `'capture'` — derived from `api-knowledge-capture.ts`.
 *   - `'classifier_v2'` — derived from the endpoint candidate classifier.
 *   - `'correlator_v2'` — derived from the DOM-endpoint correlator.
 *   - `'seed_adapter'` — copied from the seed table.
 *   - `'unknown'` — fallback.
 */
export interface EndpointSourceLineage {
  semanticSource: 'capture' | 'classifier_v2' | 'correlator_v2' | 'seed_adapter' | 'unknown';
  observationCount: number;
  /**
   * Closed-enum reason describing why the writer set
   * `correlationConfidence`. NULL when no correlator was involved.
   */
  correlationReason:
    | 'metadata_only'
    | 'click_partial_update'
    | 'multi_session_stable'
    | 'seed_adapter_default'
    | null;
}

/**
 * Closed-enum semantic type produced by the generic
 * network-observe classifier (`network-observe-classifier.ts`).
 *
 * Older rows used a smaller enum derived from `semantic_tag`
 * heuristics. The generic classifier widened it to the values
 * persisted to the `semantic_type` column. The legacy value
 * `'noise'` is kept here as an *accepted-on-read* synonym so legacy
 * scoring rows still load; new writes never use it (the classifier
 * picks the more specific bucket instead).
 */
export type EndpointSemanticType =
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
  /**
   * Generic classifier outputs. Optional for backward
   * compatibility (e.g. fixture builders in tests); the production
   * writer in `api-knowledge-capture.ts` always supplies them.
   */
  semanticType?: EndpointSemanticType | null;
  queryParamsShape?: string | null;
  responseShapeSummary?: string | null;
  usableForTask?: boolean | null;
  noiseReason?: string | null;
  /**
   * Additive lineage inputs. All optional for back-compat;
   * `api-knowledge-capture.ts` populates them for new rows.
   * Setting `endpointSource` or another lineage field
   * implicitly bumps the persisted `schemaVersion` to `2`.
   *
   * Rules:
   *  - `correlationConfidence === 'high_confidence'` is REJECTED at
   *    the writer for single-session inputs; callers that need
   *    multi-session escalation must do so via a dedicated path
   *    through a dedicated path. Repository accepts the value but
   *    single-session callers do not produce it.
   *  - `sourceLineage` is JSON-serialised via `JSON.stringify`; no
   *    raw values or user-supplied strings are allowed in it.
   */
  endpointSource?: EndpointSource | null;
  correlationConfidence?: CorrelationConfidenceLevel | null;
  correlatedRegionId?: string | null;
  confidenceReason?: string | null;
  retirementCandidate?: boolean | null;
  sourceLineage?: EndpointSourceLineage | null;
  /**
   * Closed-enum failure reason for the most recent upsert.
   * Optional so callers without failure evidence keep working.
   * The repository persists the value verbatim; rejecting unknown values
   * is the closed-enum validator's job (see `LAST_FAILURE_REASON_VALUES`).
   */
  lastFailureReason?: EndpointLastFailureReason | null;
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
  semantic_type: string | null;
  query_params_shape: string | null;
  response_shape_summary: string | null;
  usable_for_task: number | null;
  noise_reason: string | null;
  endpoint_source: string | null;
  correlation_confidence: string | null;
  correlated_region_id: string | null;
  confidence_reason: string | null;
  retirement_candidate: number | null;
  source_lineage_blob: string | null;
  schema_version: number | null;
  last_failure_reason: string | null;
}

const PERSISTED_SEMANTIC_TYPE_VALUES: ReadonlySet<string> = new Set<EndpointSemanticType>([
  'search',
  'list',
  'detail',
  'pagination',
  'filter',
  'mutation',
  'asset',
  'analytics',
  'auth',
  'private',
  'telemetry',
  'noise',
  'unknown',
]);

function coercePersistedSemanticType(value: string | null): EndpointSemanticType | null {
  if (value === null) return null;
  return PERSISTED_SEMANTIC_TYPE_VALUES.has(value) ? (value as EndpointSemanticType) : null;
}

const ENDPOINT_SOURCE_VALUES: ReadonlySet<string> = new Set<EndpointSource>([
  'observed',
  'seed_adapter',
  'manual_seed',
  'unknown',
  'deprecated_seed',
]);

const LAST_FAILURE_REASON_VALUES: ReadonlySet<string> = new Set<EndpointLastFailureReason>([
  'timeout',
  'status_4xx',
  'status_5xx',
  'semantic_mismatch',
  'shape_drift',
  'empty_response',
  'rate_limited',
  'unknown',
]);

function coerceLastFailureReason(value: string | null): EndpointLastFailureReason | null {
  if (value === null) return null;
  return LAST_FAILURE_REASON_VALUES.has(value) ? (value as EndpointLastFailureReason) : null;
}

/**
 * Derive the evidence-contract value from the two
 * persisted columns. Pure: no IO, no row mutation. The reader is the
 * single source of truth for `seedAdapterRetirementState` so the
 * writer cannot drift relative to it.
 */
function deriveSeedAdapterRetirementState(
  endpointSource: EndpointSource,
  retirementCandidate: boolean,
): SeedAdapterRetirementState {
  if (endpointSource === 'deprecated_seed') return 'deprecated';
  if (endpointSource === 'seed_adapter') {
    return retirementCandidate ? 'retirement_candidate' : 'active';
  }
  return 'not_applicable';
}

const CORRELATION_CONFIDENCE_VALUES: ReadonlySet<string> = new Set<CorrelationConfidenceLevel>([
  'unknown_candidate',
  'low_confidence',
  'high_confidence',
]);

/**
 * Derive `endpointSource` for a row.
 *
 * Order of authority:
 *   1. Persisted `endpoint_source` column.
 *   2. Back-compat heuristic on `family`: legacy rows captured by
 *      `api-knowledge-capture.ts` use `family='observed'` for
 *      browser-observed endpoints and `family='github' | 'npmjs'` for
 *      seed-adapter rows.
 *   3. `'unknown'` otherwise. The reader never invents `manual_seed`
 *      from heuristics.
 */
function deriveEndpointSource(row: KnowledgeApiEndpointRow): EndpointSource {
  const persisted = row.endpoint_source;
  if (persisted && ENDPOINT_SOURCE_VALUES.has(persisted)) {
    return persisted as EndpointSource;
  }
  // Legacy back-compat. We never invent `deprecated_seed`
  // from the family column because retirement is a writer-only state
  // transition; legacy rows fall back to
  // `seed_adapter` (active) so the lookup still considers them.
  const family = (row.family || '').toLowerCase();
  if (family === 'observed') return 'observed';
  if (family === 'github' || family === 'npmjs') return 'seed_adapter';
  return 'unknown';
}

function coerceCorrelationConfidence(value: string | null): CorrelationConfidenceLevel | null {
  if (value === null) return null;
  return CORRELATION_CONFIDENCE_VALUES.has(value) ? (value as CorrelationConfidenceLevel) : null;
}

function parseSourceLineageBlob(value: string | null): EndpointSourceLineage | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<EndpointSourceLineage> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const semanticSource = parsed.semanticSource;
    if (
      semanticSource !== 'capture' &&
      semanticSource !== 'classifier_v2' &&
      semanticSource !== 'correlator_v2' &&
      semanticSource !== 'seed_adapter' &&
      semanticSource !== 'unknown'
    ) {
      return null;
    }
    const observationCount =
      typeof parsed.observationCount === 'number' && Number.isFinite(parsed.observationCount)
        ? Math.max(0, Math.floor(parsed.observationCount))
        : 0;
    const correlationReason = parsed.correlationReason;
    const correlationReasonOk =
      correlationReason === null ||
      correlationReason === undefined ||
      correlationReason === 'metadata_only' ||
      correlationReason === 'click_partial_update' ||
      correlationReason === 'multi_session_stable' ||
      correlationReason === 'seed_adapter_default';
    if (!correlationReasonOk) return null;
    return {
      semanticSource,
      observationCount,
      correlationReason: correlationReason ?? null,
    };
  } catch {
    return null;
  }
}

function rowToEndpoint(row: KnowledgeApiEndpointRow): KnowledgeApiEndpoint {
  const schemaVersion: 1 | 2 = row.schema_version === 2 ? 2 : 1;
  const endpointSource = deriveEndpointSource(row);
  const retirementCandidate = row.retirement_candidate === 1;
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
    semanticTypePersisted: coercePersistedSemanticType(row.semantic_type),
    queryParamsShape: row.query_params_shape,
    responseShapeSummary: row.response_shape_summary,
    usableForTaskPersisted: row.usable_for_task === null ? null : row.usable_for_task === 1,
    noiseReason: row.noise_reason,
    endpointSource,
    correlationConfidence: coerceCorrelationConfidence(row.correlation_confidence),
    correlatedRegionId: row.correlated_region_id,
    confidenceReason: row.confidence_reason,
    retirementCandidate,
    sourceLineage: parseSourceLineageBlob(row.source_lineage_blob),
    schemaVersion,
    lastFailureReason: coerceLastFailureReason(row.last_failure_reason),
    seedAdapterRetirementState: deriveSeedAdapterRetirementState(
      endpointSource,
      retirementCandidate,
    ),
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
   *
   * This is the legacy entry point. Evidence-aware callers
   * that need access to `confidenceBefore` / `confidenceAfter` /
   * `migrationMode` should use `upsertWithEvidence` instead. This
   * method is implemented as a thin wrapper that drops the evidence
   * object so existing call sites stay binary-compatible.
   */
  upsert(input: UpsertKnowledgeApiEndpointInput): KnowledgeApiEndpoint {
    return this.upsertWithEvidence(input).endpoint;
  }

  /**
   * Evidence-aware variant of `upsert`. Returns the
   * resulting row alongside an `UpsertEndpointEvidence` object that
   * carries the evidence-contract fields the row alone cannot
   * express:
   *
   *   - `confidenceBefore` / `confidenceAfter` — the row's
   *     `scoreEndpointKnowledge` confidence before and after this
   *     upsert. `null` for a brand-new row.
   *   - `migrationMode` — closed-enum classification of the
   *     write (legacy_no_op / additive_upgrade / virgin_v2_write /
   *     v2_refresh).
   *   - `seedAdapterRetirementState` — derived from the resulting row.
   *   - `lastFailureReason` — closed-enum reason persisted on this
   *     write (or carried over from the existing row).
   *
   * The evidence object is deterministic and contains no raw values;
   * it is safe for downstream telemetry/report consumers.
   */
  upsertWithEvidence(input: UpsertKnowledgeApiEndpointInput): {
    endpoint: KnowledgeApiEndpoint;
    evidence: UpsertEndpointEvidence;
  } {
    const requestBlob = JSON.stringify(input.requestSummary);
    const responseBlob = JSON.stringify(input.responseSummary);
    const semanticTag = input.semanticTag ?? null;
    const statusClass = input.statusClass ?? null;
    const sourceSessionId = input.sourceSessionId ?? null;
    const sourceStepId = input.sourceStepId ?? null;
    const sourceHistoryRef = input.sourceHistoryRef ?? null;
    const semanticType = input.semanticType ?? null;
    const queryParamsShape = input.queryParamsShape ?? null;
    const responseShapeSummary = input.responseShapeSummary ?? null;
    const usableForTask =
      input.usableForTask === undefined || input.usableForTask === null
        ? null
        : input.usableForTask
          ? 1
          : 0;
    const noiseReason = input.noiseReason ?? null;

    // Lineage inputs. Coerce to NULL when absent so the SQL
    // bindings stay aligned with the (idempotent CREATE) column list.
    // Setting any of these implicitly bumps `schema_version` to `2`
    // so a downstream consumer can tell lineage-aware rows from legacy ones
    // by inspecting a single field.
    const endpointSource = input.endpointSource ?? null;
    if (endpointSource && !ENDPOINT_SOURCE_VALUES.has(endpointSource)) {
      throw new Error(
        `[knowledge-api-repository] invalid endpointSource '${endpointSource}'. Expected closed enum.`,
      );
    }
    const correlationConfidence = input.correlationConfidence ?? null;
    if (correlationConfidence && !CORRELATION_CONFIDENCE_VALUES.has(correlationConfidence)) {
      throw new Error(
        `[knowledge-api-repository] invalid correlationConfidence '${correlationConfidence}'. Expected closed enum.`,
      );
    }
    const correlatedRegionId = input.correlatedRegionId ?? null;
    const confidenceReason = input.confidenceReason ?? null;
    const retirementCandidate =
      input.retirementCandidate === undefined || input.retirementCandidate === null
        ? null
        : input.retirementCandidate
          ? 1
          : 0;
    const sourceLineageBlob = input.sourceLineage ? JSON.stringify(input.sourceLineage) : null;
    const lastFailureReason = input.lastFailureReason ?? null;
    if (lastFailureReason && !LAST_FAILURE_REASON_VALUES.has(lastFailureReason)) {
      throw new Error(
        `[knowledge-api-repository] invalid lastFailureReason '${lastFailureReason}'. Expected closed enum.`,
      );
    }
    const writesEvidenceSchema =
      endpointSource !== null ||
      correlationConfidence !== null ||
      correlatedRegionId !== null ||
      confidenceReason !== null ||
      retirementCandidate !== null ||
      sourceLineageBlob !== null ||
      lastFailureReason !== null;
    const schemaVersion = writesEvidenceSchema ? 2 : null;

    let previousRow: KnowledgeApiEndpointRow | undefined;
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare(`SELECT * FROM knowledge_api_endpoints WHERE site = ? AND endpoint_signature = ?`)
        .get(input.site, input.endpointSignature) as KnowledgeApiEndpointRow | undefined;
      previousRow = existing;

      if (existing) {
        // For re-observations we keep the prior lineage when
        // the new write does not supply one (so a classifier-only capture
        // of an existing lineage-aware row does not silently downgrade
        // `endpoint_source` back to NULL). When the new write does
        // supply a value, it wins (a fresh classifier_v2 / correlator
        // verdict is more authoritative than a stale lineage).
        const nextEndpointSource = endpointSource ?? existing.endpoint_source;
        const nextCorrelationConfidence = correlationConfidence ?? existing.correlation_confidence;
        const nextCorrelatedRegionId = correlatedRegionId ?? existing.correlated_region_id;
        const nextConfidenceReason = confidenceReason ?? existing.confidence_reason;
        const nextRetirementCandidate = retirementCandidate ?? existing.retirement_candidate;
        const nextSourceLineageBlob = sourceLineageBlob ?? existing.source_lineage_blob;
        const nextLastFailureReason = lastFailureReason ?? existing.last_failure_reason;
        const nextSchemaVersion =
          schemaVersion ??
          existing.schema_version ??
          (nextEndpointSource ||
          nextCorrelationConfidence ||
          nextCorrelatedRegionId ||
          nextConfidenceReason ||
          nextRetirementCandidate !== null ||
          nextSourceLineageBlob ||
          nextLastFailureReason
            ? 2
            : null);

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
                 last_seen_at = ?,
                 semantic_type = ?,
                 query_params_shape = ?,
                 response_shape_summary = ?,
                 usable_for_task = ?,
                 noise_reason = ?,
                 endpoint_source = ?,
                 correlation_confidence = ?,
                 correlated_region_id = ?,
                 confidence_reason = ?,
                 retirement_candidate = ?,
                 source_lineage_blob = ?,
                 schema_version = ?,
                 last_failure_reason = ?
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
            semanticType,
            queryParamsShape,
            responseShapeSummary,
            usableForTask,
            noiseReason,
            nextEndpointSource,
            nextCorrelationConfidence,
            nextCorrelatedRegionId,
            nextConfidenceReason,
            nextRetirementCandidate,
            nextSourceLineageBlob,
            nextSchemaVersion,
            nextLastFailureReason,
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
             sample_count, first_seen_at, last_seen_at,
             semantic_type, query_params_shape, response_shape_summary,
             usable_for_task, noise_reason,
             endpoint_source, correlation_confidence, correlated_region_id,
             confidence_reason, retirement_candidate, source_lineage_blob,
             schema_version, last_failure_reason
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          semanticType,
          queryParamsShape,
          responseShapeSummary,
          usableForTask,
          noiseReason,
          endpointSource,
          correlationConfidence,
          correlatedRegionId,
          confidenceReason,
          retirementCandidate,
          sourceLineageBlob,
          schemaVersion,
          lastFailureReason,
        );
      return endpointId;
    });

    const endpointId = tx();
    const row = this.db
      .prepare(`SELECT * FROM knowledge_api_endpoints WHERE endpoint_id = ?`)
      .get(endpointId) as KnowledgeApiEndpointRow;
    const endpoint = rowToEndpoint(row);

    // Derive the evidence-contract fields.
    // `confidenceBefore` is the score the row would have had right
    // before this upsert (null for a brand-new row); `confidenceAfter`
    // is the score of the just-written row. Both are computed via
    // `scoreEndpointKnowledge` so the lookup ranker and the evidence
    // contract agree on the number.
    const confidenceBefore = previousRow
      ? scoreEndpointKnowledge(rowToEndpoint(previousRow)).confidence
      : null;
    const confidenceAfter = scoreEndpointKnowledge(endpoint).confidence;
    const confidenceChanged = confidenceBefore === null || confidenceBefore !== confidenceAfter;

    let migrationMode: EndpointMigrationMode;
    if (!previousRow) {
      migrationMode = writesEvidenceSchema ? 'virgin_v2_write' : 'legacy_no_op';
    } else {
      const hadEvidenceSchema = previousRow.schema_version === 2;
      const hasEvidenceSchema = endpoint.schemaVersion === 2;
      if (!hadEvidenceSchema && hasEvidenceSchema) migrationMode = 'additive_upgrade';
      else if (hadEvidenceSchema && hasEvidenceSchema) migrationMode = 'v2_refresh';
      else if (!hadEvidenceSchema && !hasEvidenceSchema) migrationMode = 'legacy_no_op';
      else migrationMode = 'unknown';
    }

    const evidence: UpsertEndpointEvidence = {
      confidenceBefore,
      confidenceAfter,
      confidenceChanged,
      migrationMode,
      endpointSource: endpoint.endpointSource,
      seedAdapterRetirementState: endpoint.seedAdapterRetirementState,
      schemaVersion: endpoint.schemaVersion,
      lastFailureReason: endpoint.lastFailureReason,
      usableForTask: scoreEndpointKnowledge(endpoint).usableForTask,
    };

    return { endpoint, evidence };
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
  // Prefer the persisted classifier output when present.
  // This is the canonical path for new rows; older rows
  // fall through to the original `semantic_tag`-derived heuristic.
  if (endpoint.semanticTypePersisted) return endpoint.semanticTypePersisted;
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
  // When the classifier already wrote a noise_reason on
  // the row, that is the authoritative answer; we don't try to
  // re-derive a different one.
  if (endpoint.usableForTaskPersisted === false && endpoint.noiseReason) {
    return endpoint.noiseReason;
  }
  if (
    semanticType === 'noise' ||
    semanticType === 'asset' ||
    semanticType === 'analytics' ||
    semanticType === 'auth' ||
    semanticType === 'private' ||
    semanticType === 'telemetry'
  ) {
    return 'noise_endpoint';
  }
  if (semanticType === 'mutation') return 'non_read_method';
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
