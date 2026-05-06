/**
 * Tabrix schema/boundary contract module.
 *
 * SoT for the per-key semantics is the maintainer-private contract doc.
 * This module is the machine-readable companion: it freezes the legacy metadata-key set so any
 * accidental rename/drop is caught by `schema-boundary-contract.test.ts`, and it
 * declares the additive metadata-key surface + the "every new closed enum MUST
 * include `'unknown'`" rule.
 *
 * Privacy / persistence boundary: this module is types + constants only.
 * It does not import the repository, the privacy gate, or any I/O. It is
 * safe to import from both the runtime and the tests.
 */

import {
  NOT_APPLICABLE,
  OPERATION_LOG_BLOB_SCHEMA_VERSION,
  type OperationLogMetadata,
} from '../memory/db/operation-log-metadata';

/**
 * The exact legacy metadata-key set frozen before additive evidence keys. The invariant
 * test in `schema-boundary-contract.test.ts` asserts every value in this tuple is
 * still present on `OperationLogMetadata` so a future task cannot drop or
 * rename a legacy key without a deliberate contract bump.
 *
 * Cross-ref: `app/native-server/src/memory/db/operation-log-metadata.ts`
 * (`METADATA_KEYS` constant, operation-log metadata baseline).
 */
export const FROZEN_METADATA_KEYS = [
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
] as const satisfies ReadonlyArray<keyof OperationLogMetadata>;

export type FrozenMetadataKey = (typeof FROZEN_METADATA_KEYS)[number];

/**
 * The first additive metadata keys introduced after the frozen baseline. Every key is
 * `string | NotApplicable` at rest (the operation-log writer trims empty
 * values to `'not_applicable'` uniformly). Producers ship with the tasks
 * that own them — see the SoT doc table for the producer.
 *
 * NOTE: this list is reflected into the runtime allowlist via
 * `app/native-server/src/memory/db/operation-log-metadata.ts`. The two
 * MUST stay in sync; the invariant test below pins both lists.
 */
export const OBSERVATION_METADATA_KEYS = [
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
] as const satisfies ReadonlyArray<keyof OperationLogMetadata>;

export type ObservationMetadataKey = (typeof OBSERVATION_METADATA_KEYS)[number];

/**
 * Later evidence metadata keys introduced by live-observation, controlled
 * CDP, and product-gate work. Keeping these in a second list preserves
 * the meaning of the original additive set while still
 * making the full operation-log evidence surface explicit and ordered.
 */
export const EVIDENCE_METADATA_KEYS = [
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

export type EvidenceMetadataKey = (typeof EVIDENCE_METADATA_KEYS)[number];

/**
 * Combined allowlist readers/writers can reference when iterating the
 * full metadata surface. Order: frozen keys first, then the additive
 * keys, then later evidence keys, so a JSON dump
 * remains diff-friendly and matches `METADATA_KEYS`.
 */
export const ALL_METADATA_KEYS = [
  ...FROZEN_METADATA_KEYS,
  ...OBSERVATION_METADATA_KEYS,
  ...EVIDENCE_METADATA_KEYS,
] as const satisfies ReadonlyArray<keyof OperationLogMetadata>;

/**
 * Persisted operation-log wrapper version. The current contract keeps the wrapper at
 * the legacy value (`2`) because every later metadata key is additive and the
 * existing parser falls back to `'not_applicable'` for missing keys.
 * Re-exporting it here lets the invariant test pin "this did not bump
 * the wrapper" without giving callers a second source of truth.
 */
export const CONTRACT_OPERATION_LOG_BLOB_SCHEMA_VERSION = OPERATION_LOG_BLOB_SCHEMA_VERSION;

/**
 * Contract generation marker. Generation 2 reflects the later evidence
 * metadata keys that landed after the original contract seed. Persistence does
 * NOT consume this; it is purely a maintainer-facing audit hint that release
 * review can cite.
 */
export const CONTRACT_GENERATION = 2 as const;

/**
 * Invariant helper: every closed-enum string union introduced here
 * MUST include the literal `'unknown'` value as the safe fallback. The
 * helper is enforced at type level — assigning an enum that omits
 * `'unknown'` to `RequireUnknownFallback<E>` produces a compile error.
 *
 * Usage from a closed enum declaration:
 *
 *   export type LifecycleState =
 *     | 'navigating'
 *     | 'document_loading'
 *     | ...
 *     | 'unknown';
 *   const _check: RequireUnknownFallback<LifecycleState> = 'unknown';
 *
 * The runtime invariant test below also pins this rule for the
 * enum-key registry, so a closed-enum that lands without `'unknown'`
 * is rejected at unit-test time as well.
 */
export type RequireUnknownFallback<T extends string> = 'unknown' extends T ? T : never;

/**
 * Canonical "I do not know" literal. Re-exporting `NOT_APPLICABLE`
 * keeps a single import surface for modules that need both the
 * metadata sentinel and the closed-enum sentinel.
 */
export const UNKNOWN_ENUM_VALUE = 'unknown' as const;
export type UnknownEnumValue = typeof UNKNOWN_ENUM_VALUE;

export { NOT_APPLICABLE };
