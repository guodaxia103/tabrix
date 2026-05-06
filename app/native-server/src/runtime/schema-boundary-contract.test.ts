/**
 * Invariants for the schema/boundary contract.
 *
 * What this pins:
 * 1. The v2.6 frozen metadata-key set is still present on
 *    `OperationLogMetadata` (no rename / drop).
 * 2. The runtime metadata-keys allowlist (`METADATA_KEYS`) equals the
 *    explicit v2.7 contract list (so a v2.7 key cannot be declared on
 *    the contract module without also being routed through the operation-log
 *    writer / replay reader).
 * 3. The `RequireUnknownFallback<T>` helper rejects a closed-enum that
 *    omits `'unknown'` at type level.
 * 4. The persisted operation-log wrapper version stays at v2.6's value
 *    (additive-only metadata extension, not a wrapper bump).
 */
import {
  METADATA_KEYS,
  OPERATION_LOG_BLOB_SCHEMA_VERSION,
  type OperationLogMetadata,
} from '../memory/db/operation-log-metadata';
import {
  V26_FROZEN_METADATA_KEYS,
  V27_ADDITIVE_METADATA_KEYS,
  V27_ALL_METADATA_KEYS,
  V27_EVIDENCE_METADATA_KEYS,
  V27_OPERATION_LOG_BLOB_SCHEMA_VERSION,
  V27_CONTRACT_GENERATION,
  V27_UNKNOWN,
  type RequireUnknownFallback,
} from './schema-boundary-contract';

describe('schema-boundary contract invariants', () => {
  it('keeps every v2.6 metadata key on the OperationLogMetadata shape', () => {
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
    for (const key of V26_FROZEN_METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(sample, key)).toBe(true);
    }
    for (const key of V27_ADDITIVE_METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(sample, key)).toBe(true);
    }
    for (const key of V27_EVIDENCE_METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(sample, key)).toBe(true);
    }
  });

  it('keeps METADATA_KEYS == explicit v27 contract keys (same set, same order)', () => {
    expect([...METADATA_KEYS]).toEqual([...V27_ALL_METADATA_KEYS]);
    const v26 = new Set(V26_FROZEN_METADATA_KEYS as readonly string[]);
    const v27 = new Set(V27_ADDITIVE_METADATA_KEYS as readonly string[]);
    const evidence = new Set(V27_EVIDENCE_METADATA_KEYS as readonly string[]);
    for (const k of v26) expect(v27.has(k)).toBe(false);
    for (const k of v27) expect(v26.has(k)).toBe(false);
    for (const k of evidence) {
      expect(v26.has(k)).toBe(false);
      expect(v27.has(k)).toBe(false);
    }
    expect(v26.size + v27.size + evidence.size).toBe(METADATA_KEYS.length);
  });

  it('does NOT bump the persisted operation-log wrapper version', () => {
    expect(V27_OPERATION_LOG_BLOB_SCHEMA_VERSION).toBe(OPERATION_LOG_BLOB_SCHEMA_VERSION);
    expect(V27_OPERATION_LOG_BLOB_SCHEMA_VERSION).toBe(2);
  });

  it('declares a contract generation marker', () => {
    expect(V27_CONTRACT_GENERATION).toBe(2);
  });

  it("RequireUnknownFallback<T> rejects an enum without 'unknown'", () => {
    type GoodEnum = 'a' | 'b' | 'unknown';
    type BadEnum = 'a' | 'b';
    const good: RequireUnknownFallback<GoodEnum> = V27_UNKNOWN;
    expect(good).toBe('unknown');
    type BadCheck = RequireUnknownFallback<BadEnum>;
    const _badIsNever: BadCheck extends never ? true : false = true;
    expect(_badIsNever).toBe(true);
  });
});
