/**
 * Structured "why" envelope for `operation_memory_logs`.
 *
 * The repository persists this envelope inside the existing
 * `tab_hygiene_blob` column (no `ALTER TABLE`, no schema migration —
 * the column has always been an opaque JSON blob). Persistence shape:
 *
 *   `{ schemaVersion: 2, tabHygiene, metadata }`
 *
 * Legacy rows written before the metadata envelope carry only the raw
 * `tabHygiene` object (no wrapper). The repository's read path
 * detects the presence of `schemaVersion === 2` and falls back to
 * `tabHygiene = legacyBlob, metadata = makeOperationLogMetadataDefaults()`
 * for legacy rows so historical operation logs keep round-tripping.
 *
 * Closed-vocabulary policy: every field of {@link OperationLogMetadata}
 * is REQUIRED at rest. Callers that do not have a value MUST pass
 * the literal string `'not_applicable'` (or the typed
 * {@link NOT_APPLICABLE} constant). This guarantees a single
 * `taskSessionId` join surfaces every step with a non-null why
 * field.
 *
 * Privacy boundary (unchanged from the existing `operation_memory_logs`
 * contract): no raw HTTP body, no cookie / authorization header,
 * no raw query string is ever stored in `metadata`. The fields are
 * pre-summarised closed enums or short codes; if a writer wants to
 * persist a free-form value it MUST first redact it.
 */

/**
 * Sentinel string every metadata writer uses when the field does
 * not apply to the step (for example, `apiTelemetry` on a pure DOM
 * read, or `observeReason` on an experience-replay step). Stored
 * verbatim so a SQL `WHERE metadata.x = 'not_applicable'` query is
 * trivial.
 */
export const NOT_APPLICABLE = 'not_applicable' as const;
export type NotApplicable = typeof NOT_APPLICABLE;

/**
 * Closed structural envelope for every per-step metadata write.
 *
 * Field semantics (kept short on purpose — long descriptions live
 * in the operation-memory design notes, not in code comments):
 *   - `externalTaskKey`  — caller-supplied task key (e.g. CI run id).
 *   - `runId`            — Tabrix benchmark / replay run id.
 *   - `scenarioId`       — bench/scenario id when applicable.
 *   - `decisionReason`   — closed-vocab why-the-step-took-this-shape.
 *   - `routerDecision`   — the DataSourceRouter `dataSource` selected.
 *   - `confidence`       — string-formatted confidence (or `'not_applicable'`).
 *   - `navigateSettleReason` — why a navigation settled (or `'not_applicable'`).
 *   - `observeReason`    — observeReason or `'not_applicable'`.
 *   - `fallbackPlan`     — short code for the fallback plan reason.
 *   - `apiTelemetry`     — short status code from the API reader.
 */
export interface OperationLogMetadata {
  externalTaskKey: string | NotApplicable;
  runId: string | NotApplicable;
  scenarioId: string | NotApplicable;
  decisionReason: string | NotApplicable;
  routerDecision: string | NotApplicable;
  confidence: string | NotApplicable;
  navigateSettleReason: string | NotApplicable;
  observeReason: string | NotApplicable;
  fallbackPlan: string | NotApplicable;
  apiTelemetry: string | NotApplicable;
  /**
   * Closed-vocab marker that the API call answered ok
   * but with zero rows. Callers MUST pass the literal string
   * `'true'` or `'false'`; `'not_applicable'` is the default for
   * steps that did not reach a reader (DOM-only reads, replay
   * steps, …). The runtime type is `string | NotApplicable` so that
   * {@link buildOperationLogMetadata} (which trims partial values
   * uniformly) stays type-correct; the closed vocabulary is
   * enforced by the writers, not the storage type.
   */
  emptyResult: string | NotApplicable;
  /**
   * Closed-enum lifecycle state observed at this step.
   * Producer: LifecycleStateMachine. Stored as the string form
   * of `LifecycleState` (always includes `'unknown'`).
   */
  lifecycleState: string | NotApplicable;
  /**
   * Confidence in the lifecycle state, formatted as
   * `'0.00'..'1.00'`.
   */
  lifecycleConfidence: string | NotApplicable;
  /**
   * Closed-enum action outcome. Producer:
   * ActionOutcomeClassifier.
   */
  actionOutcome: string | NotApplicable;
  /** Confidence in the action outcome (`'0.00'..'1.00'`). */
  outcomeConfidence: string | NotApplicable;
  /**
   * Closed-enum reason the context tree was invalidated before this step.
   * Producer: ContextManager.
   */
  contextInvalidationReason: string | NotApplicable;
  /** Closed-enum readiness state. */
  readinessState: string | NotApplicable;
  /** Closed-enum page-complexity kind. */
  complexityKind: string | NotApplicable;
  /**
   * Opaque short id pointing at the in-memory fact-collector snapshot that
   * backed this step. Never persists the snapshot itself.
   */
  factSnapshotId: string | NotApplicable;
  /**
   * Synthetic per-event observer overhead (`'<N>ms'`). Evidence-only; the
   * production path does not block on this value.
   */
  observerOverhead: string | NotApplicable;
  /**
   * Opaque short id of the executable-budget rule that produced this step.
   */
  decisionRuleId: string | NotApplicable;
  /** Source of same-task response summary evidence. */
  responseSummarySource: string | NotApplicable;
  /** Whether the summary came from a request after sampler arm ack. */
  capturedAfterArm: string | NotApplicable;
  /** Closed bridge path for the browser-context sampler. */
  bridgePath: string | NotApplicable;
  /** Direct execution mode that produced the step. */
  executionMode: string | NotApplicable;
  /** Reader path used by the step (`knowledge_driven`, legacy candidate, etc.). */
  readerMode: string | NotApplicable;
  /** Endpoint lineage selected by lookup / live observed reuse. */
  endpointSource: string | NotApplicable;
  /** Lookup ranking reason for the selected endpoint. */
  lookupChosenReason: string | NotApplicable;
  /** Capped DOM/API correlation confidence. */
  correlationConfidence: string | NotApplicable;
  /** Lineage of the peer de-prioritised by observed reuse. */
  retiredEndpointSource: string | NotApplicable;
  /** Semantic validation outcome for the selected endpoint. */
  semanticValidation: string | NotApplicable;
  /** Layer-contract reason attached to the selected data source. */
  layerContractReason: string | NotApplicable;
  /** Clamped fallback entry layer, or `none` on success. */
  fallbackEntryLayer: string | NotApplicable;
  /** Post-retry API reason, or `none` on success. */
  apiFinalReason: string | NotApplicable;
  /** Privacy gate result before AI output / persistence. */
  privacyCheck: string | NotApplicable;
  /** Task relevance gate result before AI output. */
  relevanceCheck: string | NotApplicable;
  /** Network observation mode used by this step. */
  observationMode: string | NotApplicable;
  /** Whether controlled CDP/debugger capture backed this step. */
  cdpUsed: string | NotApplicable;
  /** Closed reason for enabling CDP, or not_applicable. */
  cdpReason: string | NotApplicable;
  /** CDP attach duration in milliseconds, stringified integer. */
  cdpAttachDurationMs: string | NotApplicable;
  /** Whether CDP detach completed cleanly. */
  cdpDetachSuccess: string | NotApplicable;
  /** Whether an existing debugger attachment forced fallback. */
  debuggerConflict: string | NotApplicable;
  /** Response body evidence source, never the body itself. */
  responseBodySource: string | NotApplicable;
  /** Whether response body data was compacted before output. */
  bodyCompacted: string | NotApplicable;
  /** Whether visible DOM/AX rows were selected for this step. */
  visibleRegionRowsUsed: string | NotApplicable;
  /** Visible DOM/AX row count, stringified integer. */
  visibleRegionRowCount: string | NotApplicable;
  /** Why visible DOM/AX rows were rejected, or `none`. */
  visibleRegionRowsRejectedReason: string | NotApplicable;
  /** Why API rows were unavailable before DOM fallback. */
  apiRowsUnavailableReason: string | NotApplicable;
  /** Closed reason for the final data-source decision. */
  dataSourceDecisionReason: string | NotApplicable;
  /** Selected visible row target-ref coverage, or unknown. */
  targetRefCoverageRate: string | NotApplicable;
  /** Visible DOM/card region quality score, or unknown. */
  regionQualityScore: string | NotApplicable;
  /** Compact closed-enum rejection distribution JSON. */
  rejectedRegionReasonDistribution: string | NotApplicable;
}

export const METADATA_KEYS = [
  'externalTaskKey',
  'runId',
  'scenarioId',
  'decisionReason',
  'routerDecision',
  'confidence',
  'navigateSettleReason',
  'observeReason',
  'fallbackPlan',
  'apiTelemetry',
  'emptyResult',
  // Additive keys. All default to `not_applicable` so older rows replay with
  // these as sentinel-filled metadata, and newer rows can stamp concrete values
  // as they become available.
  'lifecycleState',
  'lifecycleConfidence',
  'actionOutcome',
  'outcomeConfidence',
  'contextInvalidationReason',
  'readinessState',
  'complexityKind',
  'factSnapshotId',
  'observerOverhead',
  'decisionRuleId',
  'responseSummarySource',
  'capturedAfterArm',
  'bridgePath',
  'executionMode',
  'readerMode',
  'endpointSource',
  'lookupChosenReason',
  'correlationConfidence',
  'retiredEndpointSource',
  'semanticValidation',
  'layerContractReason',
  'fallbackEntryLayer',
  'apiFinalReason',
  'privacyCheck',
  'relevanceCheck',
  'observationMode',
  'cdpUsed',
  'cdpReason',
  'cdpAttachDurationMs',
  'cdpDetachSuccess',
  'debuggerConflict',
  'responseBodySource',
  'bodyCompacted',
  'visibleRegionRowsUsed',
  'visibleRegionRowCount',
  'visibleRegionRowsRejectedReason',
  'apiRowsUnavailableReason',
  'dataSourceDecisionReason',
  'targetRefCoverageRate',
  'regionQualityScore',
  'rejectedRegionReasonDistribution',
] as const satisfies ReadonlyArray<keyof OperationLogMetadata>;

/**
 * Wrapper schema marker stored alongside `tabHygiene` and `metadata`
 * inside the `tab_hygiene_blob` column. Legacy rows omit the
 * marker; the repository read path uses its presence to decide
 * whether to parse a structured envelope or to treat the blob as a
 * legacy `tabHygiene` value.
 */
export const OPERATION_LOG_BLOB_SCHEMA_VERSION = 2 as const;
export type OperationLogBlobSchemaVersion = typeof OPERATION_LOG_BLOB_SCHEMA_VERSION;

export interface OperationLogBlobV2 {
  schemaVersion: OperationLogBlobSchemaVersion;
  tabHygiene: unknown;
  metadata: OperationLogMetadata;
}

/**
 * Build a fresh `OperationLogMetadata` whose every field is
 * `'not_applicable'`. Writers compose their concrete metadata by
 * spreading their known fields on top of the defaults, never the
 * other way round, so any future-added field defaults to the safe
 * sentinel.
 */
export function makeOperationLogMetadataDefaults(): OperationLogMetadata {
  return {
    externalTaskKey: NOT_APPLICABLE,
    runId: NOT_APPLICABLE,
    scenarioId: NOT_APPLICABLE,
    decisionReason: NOT_APPLICABLE,
    routerDecision: NOT_APPLICABLE,
    confidence: NOT_APPLICABLE,
    navigateSettleReason: NOT_APPLICABLE,
    observeReason: NOT_APPLICABLE,
    fallbackPlan: NOT_APPLICABLE,
    apiTelemetry: NOT_APPLICABLE,
    emptyResult: NOT_APPLICABLE,
    lifecycleState: NOT_APPLICABLE,
    lifecycleConfidence: NOT_APPLICABLE,
    actionOutcome: NOT_APPLICABLE,
    outcomeConfidence: NOT_APPLICABLE,
    contextInvalidationReason: NOT_APPLICABLE,
    readinessState: NOT_APPLICABLE,
    complexityKind: NOT_APPLICABLE,
    factSnapshotId: NOT_APPLICABLE,
    observerOverhead: NOT_APPLICABLE,
    decisionRuleId: NOT_APPLICABLE,
    responseSummarySource: NOT_APPLICABLE,
    capturedAfterArm: NOT_APPLICABLE,
    bridgePath: NOT_APPLICABLE,
    executionMode: NOT_APPLICABLE,
    readerMode: NOT_APPLICABLE,
    endpointSource: NOT_APPLICABLE,
    lookupChosenReason: NOT_APPLICABLE,
    correlationConfidence: NOT_APPLICABLE,
    retiredEndpointSource: NOT_APPLICABLE,
    semanticValidation: NOT_APPLICABLE,
    layerContractReason: NOT_APPLICABLE,
    fallbackEntryLayer: NOT_APPLICABLE,
    apiFinalReason: NOT_APPLICABLE,
    privacyCheck: NOT_APPLICABLE,
    relevanceCheck: NOT_APPLICABLE,
    observationMode: NOT_APPLICABLE,
    cdpUsed: NOT_APPLICABLE,
    cdpReason: NOT_APPLICABLE,
    cdpAttachDurationMs: NOT_APPLICABLE,
    cdpDetachSuccess: NOT_APPLICABLE,
    debuggerConflict: NOT_APPLICABLE,
    responseBodySource: NOT_APPLICABLE,
    bodyCompacted: NOT_APPLICABLE,
    visibleRegionRowsUsed: NOT_APPLICABLE,
    visibleRegionRowCount: NOT_APPLICABLE,
    visibleRegionRowsRejectedReason: NOT_APPLICABLE,
    apiRowsUnavailableReason: NOT_APPLICABLE,
    dataSourceDecisionReason: NOT_APPLICABLE,
    targetRefCoverageRate: NOT_APPLICABLE,
    regionQualityScore: NOT_APPLICABLE,
    rejectedRegionReasonDistribution: NOT_APPLICABLE,
  };
}

/**
 * Compose a complete metadata envelope from a partial caller
 * payload. Every field defaults to `'not_applicable'`; any caller
 * value that is `null`, `undefined`, or the empty string is also
 * coerced to the sentinel so the operation log never carries an
 * empty string masquerading as evidence.
 */
export function buildOperationLogMetadata(
  partial?: Partial<OperationLogMetadata> | null,
): OperationLogMetadata {
  const defaults = makeOperationLogMetadataDefaults();
  if (!partial) return defaults;
  const result: OperationLogMetadata = { ...defaults };
  for (const key of METADATA_KEYS) {
    const candidate = partial[key];
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;
    result[key] = trimmed;
  }
  return result;
}

/**
 * Parse a value previously stored in `tab_hygiene_blob`.
 *
 * - When the value is the schema-v2 wrapper, returns the parsed
 *   `tabHygiene` and `metadata` verbatim, with any missing metadata
 *   field filled in via defaults.
 * - When the value is a legacy raw blob (no `schemaVersion: 2`
 *   marker), returns `{ tabHygiene: rawValue, metadata: defaults() }`
 *   so historical rows stay readable.
 * - When the value is `null` / unparsable, returns
 *   `{ tabHygiene: null, metadata: defaults() }`.
 */
export function parseOperationLogBlob(value: unknown): {
  tabHygiene: unknown;
  metadata: OperationLogMetadata;
} {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === OPERATION_LOG_BLOB_SCHEMA_VERSION
  ) {
    const wrapper = value as Partial<OperationLogBlobV2>;
    return {
      tabHygiene: wrapper.tabHygiene ?? null,
      metadata: buildOperationLogMetadata(wrapper.metadata),
    };
  }
  return { tabHygiene: value ?? null, metadata: makeOperationLogMetadataDefaults() };
}

/**
 * Serialize a `tabHygiene` + `metadata` pair to the JSON wrapper
 * stored under `tab_hygiene_blob`. Always emits the schema-v2
 * marker so future readers can tell new rows from legacy blobs.
 */
export function buildOperationLogBlobV2(input: {
  tabHygiene: unknown;
  metadata: OperationLogMetadata;
}): OperationLogBlobV2 {
  return {
    schemaVersion: OPERATION_LOG_BLOB_SCHEMA_VERSION,
    tabHygiene: input.tabHygiene ?? null,
    metadata: input.metadata,
  };
}
