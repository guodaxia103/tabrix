/**
 * Lifecycle State Machine (pure).
 *
 * What this module is:
 * - A pure state machine that consumes typed lifecycle events
 *   (`LifecycleEventPayload` from `@tabrix/shared`) and produces
 *   `LifecycleStateSnapshot` values.
 * - Per-tab state. Each `tabId` has its own machine instance; the
 *   manager keeps a small map.
 *
 * What this module is NOT:
 * - It does NOT read from / write to the bridge. The extension-side
 *   observer (`app/chrome-extension/entrypoints/background/observers/lifecycle.ts`)
 *   pumps events into this machine via the manager API; the machine
 *   itself has zero I/O.
 * - It does NOT touch the operation log. V27-05 ContextManager will
 *   pick up snapshots from this manager and feed the runtime path
 *   via metadata; this batch only lands the state machine.
 * - It does NOT decide policy. "Should we fetch L0 or L1 here?" is the
 *   Router's job. The lifecycle machine only answers "where is this
 *   tab in its document lifecycle right now, and how confident are we?".
 *
 * Privacy:
 * - The machine carries `urlPattern` (path-only, brand-neutral) and
 *   never raw URLs. A future bug in the observer that leaks a query
 *   string is caught by the V27-00 PrivacyGate before persistence.
 *
 * Cross-ref:
 * - Public types: `packages/shared/src/browser-fact.ts`.
 * - Bridge envelope: `packages/shared/src/bridge-ws.ts`
 *   (`BridgeObservationMessage` with `kind: 'lifecycle_event'`).
 */

import type {
  LifecycleEventKind,
  LifecycleEventPayload,
  LifecycleFlag,
  LifecycleState,
  LifecycleStateSnapshot,
  NavigationIntent,
} from '@tabrix/shared';

const DEFAULT_NAVIGATION_INTENT: NavigationIntent = 'unknown';

/**
 * Confidence values per state. Tuned conservatively: a transition that
 * had only one corroborating signal sits below 0.85; a transition that
 * was confirmed by both `committed` and `document_complete` reaches
 * `>= 0.9`. The exact numbers are SoT-pinned (see
 * `.claude/strategy/TABRIX_V2_7_CONTRACT_V1_zh.md` §5) so any future
 * tweak shows up in the snapshot test for `lifecycle-state-machine.test.ts`.
 */
const STATE_CONFIDENCE: Readonly<Record<LifecycleState, number>> = Object.freeze({
  idle: 0.5,
  navigating: 0.5,
  document_loading: 0.7,
  document_ready: 0.85,
  route_stable: 0.95,
  unloading: 0.6,
  closed: 1.0,
  unknown: 0.0,
});

/** Internal per-tab record. */
interface TabLifecycleRecord {
  tabId: number;
  lifecycleState: LifecycleState;
  lifecycleFlag: LifecycleFlag;
  navigationIntent: NavigationIntent;
  urlPattern: string | null;
  observedAtMs: number;
  /** Bookkeeping: did we see `committed` after the last `before_navigate`? */
  sawCommitted: boolean;
  /** Bookkeeping: did `dom_content_loaded` fire? */
  sawDomContentLoaded: boolean;
  /** Bookkeeping: did `document_complete` fire? */
  sawDocumentComplete: boolean;
  /** Bookkeeping: history-state pulses since last cold load. */
  historyStateUpdates: number;
}

function makeInitialRecord(tabId: number): TabLifecycleRecord {
  return {
    tabId,
    lifecycleState: 'unknown',
    lifecycleFlag: 'unknown',
    navigationIntent: 'unknown',
    urlPattern: null,
    observedAtMs: 0,
    sawCommitted: false,
    sawDomContentLoaded: false,
    sawDocumentComplete: false,
    historyStateUpdates: 0,
  };
}

function flagFromIntent(intent: NavigationIntent): LifecycleFlag {
  switch (intent) {
    case 'forward_back':
      return 'back_forward';
    case 'reload':
      return 'reload';
    case 'redirect':
      return 'cold_load';
    case 'user_initiated':
      return 'cold_load';
    case 'auto':
      return 'cold_load';
    case 'unknown':
    default:
      return 'unknown';
  }
}

/**
 * Apply a single event to a per-tab record. Returns the mutated record
 * (mutation is fine — the manager owns the records and the snapshot
 * factory deep-copies before exposing them).
 */
function applyEvent(record: TabLifecycleRecord, event: LifecycleEventPayload): TabLifecycleRecord {
  const intent = event.navigationIntent ?? DEFAULT_NAVIGATION_INTENT;
  record.observedAtMs = event.observedAtMs;
  record.tabId = event.tabId;

  switch (event.eventKind as LifecycleEventKind) {
    case 'before_navigate': {
      record.lifecycleState = 'navigating';
      record.lifecycleFlag = flagFromIntent(intent);
      record.navigationIntent = intent;
      record.urlPattern = event.urlPattern ?? null;
      record.sawCommitted = false;
      record.sawDomContentLoaded = false;
      record.sawDocumentComplete = false;
      record.historyStateUpdates = 0;
      break;
    }
    case 'committed': {
      record.lifecycleState = 'document_loading';
      record.lifecycleFlag =
        record.lifecycleFlag === 'unknown' ? 'cold_load' : record.lifecycleFlag;
      record.sawCommitted = true;
      if (event.urlPattern) record.urlPattern = event.urlPattern;
      break;
    }
    case 'dom_content_loaded': {
      record.lifecycleState = 'document_ready';
      record.sawDomContentLoaded = true;
      if (event.urlPattern) record.urlPattern = event.urlPattern;
      break;
    }
    case 'document_complete': {
      record.lifecycleState = 'route_stable';
      record.sawDocumentComplete = true;
      if (event.urlPattern) record.urlPattern = event.urlPattern;
      break;
    }
    case 'history_state_updated': {
      // SPA route change: do NOT downgrade past document_ready. Keep
      // route_stable if we were stable; bump the lifecycleFlag so
      // downstream consumers can tell SPA from cold load. Reset
      // `sawDocumentComplete` because the new SPA route has not been
      // confirmed by a fresh `document_complete` signal — the snapshot
      // factory uses this to shade confidence back from 0.95 to 0.7.
      record.historyStateUpdates += 1;
      record.lifecycleFlag = 'spa_route_change';
      record.lifecycleState =
        record.lifecycleState === 'unknown' || record.lifecycleState === 'idle'
          ? 'document_ready'
          : record.lifecycleState;
      record.sawDocumentComplete = false;
      if (event.urlPattern) record.urlPattern = event.urlPattern;
      break;
    }
    case 'tab_removed': {
      record.lifecycleState = 'closed';
      record.lifecycleFlag = 'tab_closed';
      break;
    }
    case 'unknown':
    default: {
      record.lifecycleState = 'unknown';
      record.lifecycleFlag = 'unknown';
      break;
    }
  }
  return record;
}

function snapshotFromRecord(record: TabLifecycleRecord): LifecycleStateSnapshot {
  // Confidence shading: once we are stable, a corroborated transition
  // (`sawCommitted && sawDocumentComplete`) keeps the high confidence;
  // a route_stable that came only from a history-state pulse is shaded
  // back to 0.7.
  let confidence = STATE_CONFIDENCE[record.lifecycleState];
  if (
    record.lifecycleState === 'route_stable' &&
    record.lifecycleFlag === 'spa_route_change' &&
    !record.sawDocumentComplete
  ) {
    confidence = 0.7;
  }
  if (
    record.lifecycleState === 'document_ready' &&
    record.lifecycleFlag === 'spa_route_change' &&
    record.historyStateUpdates >= 1
  ) {
    confidence = 0.7;
  }
  return {
    lifecycleState: record.lifecycleState,
    lifecycleFlag: record.lifecycleFlag,
    navigationIntent: record.navigationIntent,
    lifecycleConfidence: clampUnit(confidence),
    urlPattern: record.urlPattern,
    producedAtMs: record.observedAtMs,
    tabId: record.tabId,
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Public manager API. The extension's lifecycle observer calls
 * `ingest(event)` on each `chrome.webNavigation.*` / `chrome.tabs.*`
 * notification; the runtime caller (V27-05 in the next batch task)
 * calls `getSnapshot(tabId)` to read the current per-tab snapshot.
 */
export interface LifecycleStateMachine {
  ingest(event: LifecycleEventPayload): LifecycleStateSnapshot;
  getSnapshot(tabId: number): LifecycleStateSnapshot;
  /** Test/owner-lane helper — drops every tab record. */
  reset(): void;
}

/**
 * Build a fresh state machine. Most callers want
 * `getDefaultLifecycleStateMachine()`; the constructor exists for
 * tests and for benchmark runners that want a scoped instance.
 */
export function createLifecycleStateMachine(): LifecycleStateMachine {
  const records = new Map<number, TabLifecycleRecord>();

  return {
    ingest(event: LifecycleEventPayload): LifecycleStateSnapshot {
      const tabId = Number.isInteger(event.tabId) ? event.tabId : -1;
      let record = records.get(tabId);
      if (!record) {
        record = makeInitialRecord(tabId);
        records.set(tabId, record);
      }
      applyEvent(record, event);
      return snapshotFromRecord(record);
    },
    getSnapshot(tabId: number): LifecycleStateSnapshot {
      const record = records.get(tabId);
      if (!record) return snapshotFromRecord(makeInitialRecord(tabId));
      return snapshotFromRecord(record);
    },
    reset(): void {
      records.clear();
    },
  };
}

let defaultMachine: LifecycleStateMachine | null = null;

/** Process-wide singleton. Created lazily so test files can `reset()`. */
export function getDefaultLifecycleStateMachine(): LifecycleStateMachine {
  if (!defaultMachine) defaultMachine = createLifecycleStateMachine();
  return defaultMachine;
}

/** Drop the singleton. Test-only. */
export function resetDefaultLifecycleStateMachine(): void {
  defaultMachine = null;
}
