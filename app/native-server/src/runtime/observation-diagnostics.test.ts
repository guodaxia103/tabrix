import { describe, expect, test, beforeEach } from '@jest/globals';
import type { BridgeObservationMessage } from '@tabrix/shared';
import { resetDefaultContextManager } from './browser-context-manager';
import { resetDefaultFactCollector } from './browser-fact-collector';
import { resetDefaultLifecycleStateMachine } from './lifecycle-state-machine';
import { ingestBridgeObservation } from './observation-ingest';
import {
  getV27ObservationDiagnosticsSnapshot,
  resetV27ObservationDiagnostics,
} from './observation-diagnostics';

describe('V27-05R observation diagnostics', () => {
  beforeEach(() => {
    resetDefaultLifecycleStateMachine();
    resetDefaultFactCollector();
    resetDefaultContextManager();
    resetV27ObservationDiagnostics();
  });

  test('starts with an explicit none source and zero sensitive persistence', () => {
    expect(getV27ObservationDiagnosticsSnapshot()).toMatchObject({
      observationDiagnosticSource: 'none',
      observationIngestedCount: 0,
      sensitivePersistedCount: 0,
    });
  });

  test('counts lifecycle, fact, action, and tab observations through the real ingest funnel', () => {
    const base = 1_710_000_000_000;
    ingestBridgeObservation({
      type: 'observation',
      kind: 'lifecycle_event',
      connectionId: 'conn',
      extensionId: 'ext',
      sentAt: base,
      payload: {
        kind: 'lifecycle_event',
        data: {
          eventKind: 'committed',
          tabId: 101,
          urlPattern: 'example.com/list',
          navigationIntent: 'user_initiated',
          observedAtMs: base,
        },
      },
    } satisfies BridgeObservationMessage);

    ingestBridgeObservation({
      type: 'observation',
      kind: 'fact_snapshot',
      connectionId: 'conn',
      extensionId: 'ext',
      sentAt: base + 1,
      payload: {
        kind: 'fact_snapshot',
        data: {
          factSnapshotId: 'tab:101',
          observedAtMs: base + 1,
          payload: {
            eventKind: 'network_request',
            tabId: 101,
            urlPattern: 'example.com/list',
            sessionId: null,
            fact: {
              method: 'GET',
              host: 'example.com',
              pathPattern: '/api/items',
              queryKeys: ['q'],
              status: 200,
              resourceType: 'fetch',
              contentType: 'application/json',
              sizeClass: 'small',
              timingMs: 12,
              noiseClass: 'usable',
              observedAtMs: base + 1,
            },
          },
        },
      },
    } satisfies BridgeObservationMessage);

    ingestBridgeObservation({
      type: 'observation',
      kind: 'action_outcome',
      connectionId: 'conn',
      extensionId: 'ext',
      sentAt: base + 2,
      payload: {
        kind: 'action_outcome',
        data: {
          actionId: 'act-1',
          actionKind: 'click',
          tabId: 101,
          urlPattern: 'example.com/list',
          observedAtMs: base + 2,
          signals: [{ kind: 'dom_region_changed', observedAtMs: base + 10 }],
        },
      },
    } satisfies BridgeObservationMessage);

    ingestBridgeObservation({
      type: 'observation',
      kind: 'tab_event',
      connectionId: 'conn',
      extensionId: 'ext',
      sentAt: base + 3,
      payload: {
        kind: 'tab_event',
        data: {
          eventKind: 'bfcache_restored',
          tabId: 101,
          observedAtMs: base + 3,
          urlPattern: 'example.com/list',
          stableRefRevalidation: {
            outcome: 'stale',
            liveCount: 0,
            staleCount: 1,
            observedAtMs: base + 3,
          },
        },
      },
    } satisfies BridgeObservationMessage);

    expect(
      getV27ObservationDiagnosticsSnapshot({
        factSnapshotCount: 1,
        trackedContextCount: 1,
      }),
    ).toMatchObject({
      observationDiagnosticSource: 'runtime_ingest',
      observationIngestedCount: 4,
      lifecycleEventIngestedCount: 1,
      factSnapshotFreshCount: 1,
      actionOutcomeClassifiedCount: 1,
      tabEventIngestedCount: 1,
      contextVersionBumpCount: 3,
      lastObservationKind: 'tab_event',
      lastFactSnapshotId: 'tab:101',
      lastActionOutcome: 'spa_partial_update',
      lastContextInvalidationReason: 'bfcache_restored',
      factSnapshotCount: 1,
      trackedContextCount: 1,
      sensitivePersistedCount: 0,
    });
  });

  test('counts unknown and malformed observations without counting them as ingested', () => {
    ingestBridgeObservation({
      type: 'observation',
      kind: 'unknown',
      connectionId: 'conn',
      extensionId: 'ext',
      sentAt: Date.now(),
      payload: { kind: 'unknown', data: {} },
    } satisfies BridgeObservationMessage);

    ingestBridgeObservation({
      type: 'observation',
      kind: 'lifecycle_event',
      connectionId: 'conn',
      extensionId: 'ext',
      sentAt: Date.now(),
      payload: { kind: 'lifecycle_event', data: null as never },
    } satisfies BridgeObservationMessage);

    expect(getV27ObservationDiagnosticsSnapshot()).toMatchObject({
      observationDiagnosticSource: 'none',
      observationIngestedCount: 0,
      unknownObservationDroppedCount: 1,
      malformedObservationDroppedCount: 1,
    });
  });
});
