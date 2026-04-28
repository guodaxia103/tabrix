/**
 * V27 runtime observation ingestion arm.
 *
 * Single funnel between `bridge-command-channel.ts` (websocket handler)
 * and the four V27 default runtime singletons (lifecycle state machine,
 * fact collector, action outcome classifier, tab/window context manager).
 *
 * This module is deliberately tiny on purpose: the bridge channel must
 * stay thin and only know "an observation arrived"; all routing,
 * shape-checking, and best-effort error swallowing lives here. The
 * dispatch is purely in-memory — no persistence is performed; raw
 * payloads are never written to disk by this module. Persistence-side
 * redaction stays the operation log's responsibility through V27-00
 * `PrivacyGate`.
 *
 * Boundary:
 * - No I/O, no MCP tool surface change.
 * - Unknown / malformed envelopes are dropped silently. The closed-enum
 *   discriminators on `BridgeObservationMessage.payload.kind` are the
 *   only branches we honour; anything else is treated as forward-compat
 *   noise.
 * - Each branch is independently try/catch-wrapped: a producer-side
 *   schema bug in one observation kind must not be allowed to take
 *   down ingestion of the other three.
 */
import type { BridgeObservationMessage } from '@tabrix/shared';
import { getDefaultContextManager, type ContextManager } from './v27-context-manager';
import { getDefaultLifecycleStateMachine, type LifecycleStateMachine } from './v27-lifecycle';
import { getDefaultFactCollector, type FactCollector } from './v27-fact-collector';
import { classifyActionOutcome } from './v27-action-outcome';
import {
  recordV27ObservationActionOutcome,
  recordV27ObservationFactSnapshot,
  recordV27ObservationLifecycle,
  recordV27ObservationTabEvent,
  recordV27ObservationUnknown,
} from './v27-observation-diagnostics';

interface IngestDeps {
  lifecycle: LifecycleStateMachine;
  factCollector: FactCollector;
  contextManager: ContextManager;
}

function defaultDeps(): IngestDeps {
  return {
    lifecycle: getDefaultLifecycleStateMachine(),
    factCollector: getDefaultFactCollector(),
    contextManager: getDefaultContextManager(),
  };
}

/**
 * Dispatch a `BridgeObservationMessage` to the matching default
 * runtime singletons. Returns nothing — observation ingestion is fire
 * and forget from the bridge's perspective.
 *
 * `deps` exists purely for unit tests; production calls the zero-arg
 * form so the singletons are wired automatically.
 */
export function ingestBridgeObservation(
  message: BridgeObservationMessage,
  deps: IngestDeps = defaultDeps(),
): void {
  const payload = message?.payload;
  if (!payload || typeof payload !== 'object' || typeof payload.kind !== 'string') {
    recordV27ObservationUnknown(null);
    return;
  }

  switch (payload.kind) {
    case 'lifecycle_event': {
      try {
        const data = payload.data;
        if (!data || typeof data !== 'object') {
          recordV27ObservationUnknown(payload.kind);
          return;
        }
        const tabId = typeof data.tabId === 'number' ? data.tabId : null;
        const before = tabId !== null ? deps.contextManager.getContext(tabId) : null;
        const snap = deps.lifecycle.ingest(data);
        // The context manager owns the version bump policy; it accepts
        // a `tabId: null` snapshot and returns an "ambient" tombstone.
        const after = deps.contextManager.applyLifecycleSnapshot(snap);
        recordV27ObservationLifecycle({
          observedAt: snap.producedAtMs,
          contextVersionBumped:
            after.version > 0 &&
            (!before ||
              after.contextId !== before.contextId ||
              after.version > before.version ||
              after.lastInvalidationReason !== before.lastInvalidationReason),
          lastContextInvalidationReason: after.version > 0 ? after.lastInvalidationReason : null,
        });
      } catch {
        // Producer schema drift in one branch must not poison the
        // websocket. Best-effort.
        recordV27ObservationUnknown(payload.kind);
      }
      return;
    }
    case 'fact_snapshot': {
      try {
        const data = payload.data;
        if (!data || typeof data !== 'object') {
          recordV27ObservationUnknown(payload.kind);
          return;
        }
        const snap = deps.factCollector.ingestFactObservation(data);
        recordV27ObservationFactSnapshot({
          observedAt: snap.producedAtMs,
          factSnapshotId: snap.factSnapshotId,
          fresh: true,
        });
      } catch {
        // Best-effort — fact_snapshot is an observation feed, not a
        // command. Drop on shape error.
        recordV27ObservationUnknown(payload.kind);
      }
      return;
    }
    case 'action_outcome': {
      try {
        const data = payload.data;
        if (!data || typeof data !== 'object') {
          recordV27ObservationUnknown(payload.kind);
          return;
        }
        const tabId = typeof data.tabId === 'number' ? data.tabId : null;
        const before = tabId !== null ? deps.contextManager.getContext(tabId) : null;
        const snapshot = classifyActionOutcome(data);
        const after =
          tabId !== null ? deps.contextManager.applyActionOutcome(snapshot, tabId) : null;
        recordV27ObservationActionOutcome({
          observedAt: snapshot.producedAtMs,
          outcome: snapshot.outcome,
          contextVersionBumped:
            !!after &&
            (!before ||
              after.contextId !== before.contextId ||
              after.version > before.version ||
              after.lastInvalidationReason !== before.lastInvalidationReason),
          lastContextInvalidationReason: after?.lastInvalidationReason ?? null,
        });
      } catch {
        // Best-effort.
        recordV27ObservationUnknown(payload.kind);
      }
      return;
    }
    case 'tab_event': {
      try {
        const data = payload.data;
        if (!data || typeof data !== 'object') {
          recordV27ObservationUnknown(payload.kind);
          return;
        }
        const tabId = typeof data.tabId === 'number' ? data.tabId : null;
        const before = tabId !== null ? deps.contextManager.getContext(tabId) : null;
        const after = deps.contextManager.applyTabEvent(data);
        recordV27ObservationTabEvent({
          observedAt: data.observedAtMs,
          contextVersionBumped:
            !!after &&
            (!before ||
              after.contextId !== before.contextId ||
              after.version > before.version ||
              after.lastInvalidationReason !== before.lastInvalidationReason),
          lastContextInvalidationReason: after?.lastInvalidationReason ?? null,
        });
      } catch {
        // Best-effort.
        recordV27ObservationUnknown(payload.kind);
      }
      return;
    }
    case 'unknown':
    default:
      // Forward-compat: unknown observation kinds are intentionally
      // dropped without error so a v2.7+ extension paired with this
      // native server does not crash ingestion.
      recordV27ObservationUnknown(payload.kind);
      return;
  }
}
