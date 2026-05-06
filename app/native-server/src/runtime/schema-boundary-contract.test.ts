/**
 * Invariants for the schema/boundary contract.
 *
 * What this pins:
 * 1. The frozen metadata-key set is still present on
 *    `OperationLogMetadata` (no rename / drop).
 * 2. The runtime metadata-keys allowlist (`METADATA_KEYS`) equals the
 *    explicit contract list (so a new key cannot be declared on
 *    the contract module without also being routed through the operation-log
 *    writer / replay reader).
 * 3. The `RequireUnknownFallback<T>` helper rejects a closed-enum that
 *    omits `'unknown'` at type level.
 * 4. The persisted operation-log wrapper version stays at the current value
 *    (additive-only metadata extension, not a wrapper bump).
 */
import {
  METADATA_KEYS,
  OPERATION_LOG_BLOB_SCHEMA_VERSION,
  type OperationLogMetadata,
} from '../memory/db/operation-log-metadata';
import {
  ALL_METADATA_KEYS,
  CONTRACT_GENERATION,
  CONTRACT_OPERATION_LOG_BLOB_SCHEMA_VERSION,
  EVIDENCE_METADATA_KEYS,
  FROZEN_METADATA_KEYS,
  OBSERVATION_METADATA_KEYS,
  UNKNOWN_ENUM_VALUE,
  type RequireUnknownFallback,
} from './schema-boundary-contract';

describe('schema-boundary contract invariants', () => {
  it('keeps every frozen metadata key on the OperationLogMetadata shape', () => {
    const sample: OperationLogMetadata = {
      externalTaskKey: 'not_applicable',
      runId: 'not_applicable',
      scenarioId: 'not_applicable',
      decisionReason: 'not_applicable',
      routerDecision: 'not_applicable',
      confidence: 'not_applicable',
      navigateSettleReason: 'not_applicable',
      observeReason: 'not_applicable',
      fallbackPlan: 'not_applicable',
      apiTelemetry: 'not_applicable',
      emptyResult: 'not_applicable',
      lifecycleState: 'not_applicable',
      lifecycleConfidence: 'not_applicable',
      actionOutcome: 'not_applicable',
      outcomeConfidence: 'not_applicable',
      contextInvalidationReason: 'not_applicable',
      readinessState: 'not_applicable',
      complexityKind: 'not_applicable',
      factSnapshotId: 'not_applicable',
      observerOverhead: 'not_applicable',
      decisionRuleId: 'not_applicable',
      responseSummarySource: 'not_applicable',
      capturedAfterArm: 'not_applicable',
      bridgePath: 'not_applicable',
      executionMode: 'not_applicable',
      readerMode: 'not_applicable',
      endpointSource: 'not_applicable',
      lookupChosenReason: 'not_applicable',
      correlationConfidence: 'not_applicable',
      retiredEndpointSource: 'not_applicable',
      semanticValidation: 'not_applicable',
      layerContractReason: 'not_applicable',
      fallbackEntryLayer: 'not_applicable',
      apiFinalReason: 'not_applicable',
      privacyCheck: 'not_applicable',
      relevanceCheck: 'not_applicable',
      observationMode: 'not_applicable',
      cdpUsed: 'not_applicable',
      cdpReason: 'not_applicable',
      cdpAttachDurationMs: 'not_applicable',
      cdpDetachSuccess: 'not_applicable',
      debuggerConflict: 'not_applicable',
      responseBodySource: 'not_applicable',
      bodyCompacted: 'not_applicable',
      visibleRegionRowsUsed: 'not_applicable',
      visibleRegionRowCount: 'not_applicable',
      visibleRegionRowsRejectedReason: 'not_applicable',
      apiRowsUnavailableReason: 'not_applicable',
      dataSourceDecisionReason: 'not_applicable',
      targetRefCoverageRate: 'not_applicable',
      regionQualityScore: 'not_applicable',
      rejectedRegionReasonDistribution: 'not_applicable',
    };
    for (const key of FROZEN_METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(sample, key)).toBe(true);
    }
    for (const key of OBSERVATION_METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(sample, key)).toBe(true);
    }
    for (const key of EVIDENCE_METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(sample, key)).toBe(true);
    }
  });

  it('keeps METADATA_KEYS == explicit contract keys (same set, same order)', () => {
    expect([...METADATA_KEYS]).toEqual([...ALL_METADATA_KEYS]);
    const frozen = new Set(FROZEN_METADATA_KEYS as readonly string[]);
    const observation = new Set(OBSERVATION_METADATA_KEYS as readonly string[]);
    const evidence = new Set(EVIDENCE_METADATA_KEYS as readonly string[]);
    for (const k of frozen) expect(observation.has(k)).toBe(false);
    for (const k of observation) expect(frozen.has(k)).toBe(false);
    for (const k of evidence) {
      expect(frozen.has(k)).toBe(false);
      expect(observation.has(k)).toBe(false);
    }
    expect(frozen.size + observation.size + evidence.size).toBe(METADATA_KEYS.length);
  });

  it('does NOT bump the persisted operation-log wrapper version', () => {
    expect(CONTRACT_OPERATION_LOG_BLOB_SCHEMA_VERSION).toBe(OPERATION_LOG_BLOB_SCHEMA_VERSION);
    expect(CONTRACT_OPERATION_LOG_BLOB_SCHEMA_VERSION).toBe(2);
  });

  it('declares a contract generation marker', () => {
    expect(CONTRACT_GENERATION).toBe(2);
  });

  it("RequireUnknownFallback<T> rejects an enum without 'unknown'", () => {
    type GoodEnum = 'a' | 'b' | 'unknown';
    type BadEnum = 'a' | 'b';
    const good: RequireUnknownFallback<GoodEnum> = UNKNOWN_ENUM_VALUE;
    expect(good).toBe('unknown');
    type BadCheck = RequireUnknownFallback<BadEnum>;
    const _badIsNever: BadCheck extends never ? true : false = true;
    expect(_badIsNever).toBe(true);
  });
});
