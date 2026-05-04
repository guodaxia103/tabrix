/**
 * V27-00 — Tabrix v2.7 schema/boundary contract module.
 *
 * SoT for the per-key semantics is the maintainer-private doc
 * `.claude/strategy/TABRIX_V2_7_CONTRACT_V1_zh.md`. This module is the
 * machine-readable companion: it freezes the v2.6 metadata-key set so any
 * accidental rename/drop is caught by `v27-contract.test.ts`, and it
 * declares the v2.7 metadata-key surface + the "every new closed enum MUST
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
 * The exact v2.6 metadata-key set that V27-00 freezes. The invariant
 * test in `v27-contract.test.ts` asserts every value in this tuple is
 * still present on `OperationLogMetadata` so a future v2.7 batch cannot
 * drop or rename a v2.6 key without a deliberate contract bump.
 *
 * Cross-ref: `app/native-server/src/memory/db/operation-log-metadata.ts`
 * (`METADATA_KEYS` constant, FIX-07 + PGB-01 baseline).
 */
export const V26_FROZEN_METADATA_KEYS = [
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

export type V26FrozenMetadataKey = (typeof V26_FROZEN_METADATA_KEYS)[number];

/**
 * The first v2.7 additive metadata keys V27-00 lands. Every key is
 * `string | NotApplicable` at rest (the operation-log writer trims empty
 * values to `'not_applicable'` uniformly). Producers ship with the v2.7
 * batches that own them — see the SoT doc table for the producer batch.
 *
 * NOTE: this list is reflected into the runtime allowlist via
 * `app/native-server/src/memory/db/operation-log-metadata.ts`. The two
 * MUST stay in sync; the invariant test below pins both lists.
 */
export const V27_ADDITIVE_METADATA_KEYS = [
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

export type V27AdditiveMetadataKey = (typeof V27_ADDITIVE_METADATA_KEYS)[number];

/**
 * Later v2.7 evidence metadata keys introduced by V27-10R2, V27-13,
 * V27-CDP-01, and PG real-gate work. Keeping these in a second list
 * preserves the meaning of the original V27-00 additive set while still
 * making the full operation-log evidence surface explicit and ordered.
 */
export const V27_EVIDENCE_METADATA_KEYS = [
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

export type V27EvidenceMetadataKey = (typeof V27_EVIDENCE_METADATA_KEYS)[number];

/**
 * Combined allowlist v2.7 readers/writers can reference when iterating
 * the full metadata surface. Order: v2.6 frozen keys first, then the
 * V27-00 additive keys, then later v2.7 evidence keys, so a JSON dump
 * remains diff-friendly and matches `METADATA_KEYS`.
 */
export const V27_ALL_METADATA_KEYS = [
  ...V26_FROZEN_METADATA_KEYS,
  ...V27_ADDITIVE_METADATA_KEYS,
  ...V27_EVIDENCE_METADATA_KEYS,
] as const satisfies ReadonlyArray<keyof OperationLogMetadata>;

/**
 * Persisted operation-log wrapper version.  v2.7 keeps the wrapper at
 * v2.6's value (`2`) because every v2.7 metadata key is additive and the
 * existing parser falls back to `'not_applicable'` for missing keys.
 * Re-exporting it here lets the invariant test pin "v2.7 did not bump
 * the wrapper" without giving callers a second source of truth.
 */
export const V27_OPERATION_LOG_BLOB_SCHEMA_VERSION = OPERATION_LOG_BLOB_SCHEMA_VERSION;

/**
 * v2.7 contract generation marker. Generation 2 reflects the later evidence
 * metadata keys that landed after the V27-00 contract seed. Persistence does
 * NOT consume this; it is purely a maintainer-facing audit hint that release
 * review can cite.
 */
export const V27_CONTRACT_GENERATION = 2 as const;

/**
 * Invariant helper: every closed-enum string union introduced in v2.7
 * MUST include the literal `'unknown'` value as the safe fallback. The
 * helper is enforced at type level — assigning an enum that omits
 * `'unknown'` to `RequireUnknownFallback<E>` produces a compile error.
 *
 * Usage from a v2.7 enum declaration:
 *
 *   export type LifecycleState =
 *     | 'navigating'
 *     | 'document_loading'
 *     | ...
 *     | 'unknown';
 *   const _check: RequireUnknownFallback<LifecycleState> = 'unknown';
 *
 * The runtime invariant test below also pins this rule for the v2.7
 * enum-key registry, so a closed-enum that lands without `'unknown'`
 * is rejected at unit-test time as well.
 */
export type RequireUnknownFallback<T extends string> = 'unknown' extends T ? T : never;

/**
 * Canonical "I do not know" literal. Re-exporting `NOT_APPLICABLE`
 * keeps a single import surface for v2.7 modules that need both the
 * metadata sentinel and the closed-enum sentinel.
 */
export const V27_UNKNOWN = 'unknown' as const;
export type V27Unknown = typeof V27_UNKNOWN;

export { NOT_APPLICABLE };
