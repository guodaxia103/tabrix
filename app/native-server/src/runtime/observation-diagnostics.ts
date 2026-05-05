/**
 * In-memory diagnostics for the browser observation spine.
 *
 * This is intentionally a diagnostic surface, not a persistence path:
 * it records only counters, closed-enum reason fields, ids, and
 * context metadata that are already query-stripped by the producers.
 * It lets owner-lane real-browser gates prove that extension
 * observations reached the native runtime before downstream readers
 * build on those facts.
 */
import type { ContextInvalidationReason, ObservationKind } from '@tabrix/shared';

export type V27ObservationDiagnosticSource = 'runtime_ingest' | 'none' | 'unknown';

export interface V27ObservationDiagnosticsSnapshot {
  observationDiagnosticSource: V27ObservationDiagnosticSource;
  observationIngestedCount: number;
  lifecycleEventIngestedCount: number;
  factSnapshotFreshCount: number;
  actionOutcomeClassifiedCount: number;
  tabEventIngestedCount: number;
  contextVersionBumpCount: number;
  unknownObservationDroppedCount: number;
  malformedObservationDroppedCount: number;
  lastObservedAt: number | null;
  lastObservationKind: ObservationKind | null;
  lastFactSnapshotId: string | null;
  lastActionOutcome: string | null;
  lastContextInvalidationReason: ContextInvalidationReason | null;
  factSnapshotCount: number;
  trackedContextCount: number;
  sensitivePersistedCount: 0;
}

interface MutableDiagnostics {
  observationIngestedCount: number;
  lifecycleEventIngestedCount: number;
  factSnapshotFreshCount: number;
  actionOutcomeClassifiedCount: number;
  tabEventIngestedCount: number;
  contextVersionBumpCount: number;
  unknownObservationDroppedCount: number;
  malformedObservationDroppedCount: number;
  lastObservedAt: number | null;
  lastObservationKind: ObservationKind | null;
  lastFactSnapshotId: string | null;
  lastActionOutcome: string | null;
  lastContextInvalidationReason: ContextInvalidationReason | null;
}

const diagnostics: MutableDiagnostics = {
  observationIngestedCount: 0,
  lifecycleEventIngestedCount: 0,
  factSnapshotFreshCount: 0,
  actionOutcomeClassifiedCount: 0,
  tabEventIngestedCount: 0,
  contextVersionBumpCount: 0,
  unknownObservationDroppedCount: 0,
  malformedObservationDroppedCount: 0,
  lastObservedAt: null,
  lastObservationKind: null,
  lastFactSnapshotId: null,
  lastActionOutcome: null,
  lastContextInvalidationReason: null,
};

function markSeen(kind: ObservationKind, observedAt: number | null): void {
  diagnostics.observationIngestedCount += 1;
  diagnostics.lastObservationKind = kind;
  diagnostics.lastObservedAt = Number.isFinite(observedAt) ? Number(observedAt) : Date.now();
}

export function recordV27ObservationLifecycle(
  input: {
    observedAt?: number | null;
    contextVersionBumped?: boolean;
    lastContextInvalidationReason?: ContextInvalidationReason | null;
  } = {},
): void {
  markSeen('lifecycle_event', input.observedAt ?? null);
  diagnostics.lifecycleEventIngestedCount += 1;
  recordContextBump(input.contextVersionBumped, input.lastContextInvalidationReason);
}

export function recordV27ObservationFactSnapshot(
  input: {
    observedAt?: number | null;
    factSnapshotId?: string | null;
    fresh?: boolean;
  } = {},
): void {
  markSeen('fact_snapshot', input.observedAt ?? null);
  if (input.fresh !== false) diagnostics.factSnapshotFreshCount += 1;
  diagnostics.lastFactSnapshotId =
    typeof input.factSnapshotId === 'string' && input.factSnapshotId.trim()
      ? input.factSnapshotId
      : diagnostics.lastFactSnapshotId;
}

export function recordV27ObservationActionOutcome(
  input: {
    observedAt?: number | null;
    outcome?: string | null;
    contextVersionBumped?: boolean;
    lastContextInvalidationReason?: ContextInvalidationReason | null;
  } = {},
): void {
  markSeen('action_outcome', input.observedAt ?? null);
  diagnostics.actionOutcomeClassifiedCount += 1;
  diagnostics.lastActionOutcome =
    typeof input.outcome === 'string' && input.outcome.trim()
      ? input.outcome
      : diagnostics.lastActionOutcome;
  recordContextBump(input.contextVersionBumped, input.lastContextInvalidationReason);
}

export function recordV27ObservationTabEvent(
  input: {
    observedAt?: number | null;
    contextVersionBumped?: boolean;
    lastContextInvalidationReason?: ContextInvalidationReason | null;
  } = {},
): void {
  markSeen('tab_event', input.observedAt ?? null);
  diagnostics.tabEventIngestedCount += 1;
  recordContextBump(input.contextVersionBumped, input.lastContextInvalidationReason);
}

export function recordV27ObservationUnknown(kind: ObservationKind | string | null): void {
  if (kind === 'unknown') {
    diagnostics.unknownObservationDroppedCount += 1;
    diagnostics.lastObservationKind = 'unknown';
    diagnostics.lastObservedAt = Date.now();
    return;
  }
  diagnostics.malformedObservationDroppedCount += 1;
  diagnostics.lastObservedAt = Date.now();
}

function recordContextBump(
  bumped: boolean | undefined,
  reason: ContextInvalidationReason | null | undefined,
): void {
  if (bumped) diagnostics.contextVersionBumpCount += 1;
  if (reason) diagnostics.lastContextInvalidationReason = reason;
}

export function getV27ObservationDiagnosticsSnapshot(
  input: {
    factSnapshotCount?: number;
    trackedContextCount?: number;
  } = {},
): V27ObservationDiagnosticsSnapshot {
  return {
    observationDiagnosticSource:
      diagnostics.observationIngestedCount > 0 ? 'runtime_ingest' : 'none',
    observationIngestedCount: diagnostics.observationIngestedCount,
    lifecycleEventIngestedCount: diagnostics.lifecycleEventIngestedCount,
    factSnapshotFreshCount: diagnostics.factSnapshotFreshCount,
    actionOutcomeClassifiedCount: diagnostics.actionOutcomeClassifiedCount,
    tabEventIngestedCount: diagnostics.tabEventIngestedCount,
    contextVersionBumpCount: diagnostics.contextVersionBumpCount,
    unknownObservationDroppedCount: diagnostics.unknownObservationDroppedCount,
    malformedObservationDroppedCount: diagnostics.malformedObservationDroppedCount,
    lastObservedAt: diagnostics.lastObservedAt,
    lastObservationKind: diagnostics.lastObservationKind,
    lastFactSnapshotId: diagnostics.lastFactSnapshotId,
    lastActionOutcome: diagnostics.lastActionOutcome,
    lastContextInvalidationReason: diagnostics.lastContextInvalidationReason,
    factSnapshotCount: Number.isInteger(input.factSnapshotCount) ? input.factSnapshotCount! : 0,
    trackedContextCount: Number.isInteger(input.trackedContextCount)
      ? input.trackedContextCount!
      : 0,
    sensitivePersistedCount: 0,
  };
}

export function resetV27ObservationDiagnostics(): void {
  diagnostics.observationIngestedCount = 0;
  diagnostics.lifecycleEventIngestedCount = 0;
  diagnostics.factSnapshotFreshCount = 0;
  diagnostics.actionOutcomeClassifiedCount = 0;
  diagnostics.tabEventIngestedCount = 0;
  diagnostics.contextVersionBumpCount = 0;
  diagnostics.unknownObservationDroppedCount = 0;
  diagnostics.malformedObservationDroppedCount = 0;
  diagnostics.lastObservedAt = null;
  diagnostics.lastObservationKind = null;
  diagnostics.lastFactSnapshotId = null;
  diagnostics.lastActionOutcome = null;
  diagnostics.lastContextInvalidationReason = null;
}
