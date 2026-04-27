/**
 * V27-01 — Tabrix v2.7 browser-observation public types.
 *
 * Scope of this file (Batch A): closed-enum type bag shared between the
 * Chrome extension observers (producers) and the native-server runtime
 * modules (consumers). The runtime payloads themselves (snapshot blobs,
 * fact-collector ring entries) live behind these types so a v2.7 enum
 * can never drift between extension and server.
 *
 * Boundary:
 * - This module defines TYPES + CONSTANTS only. No I/O, no bridge calls.
 * - Every closed-enum string union here MUST include `'unknown'` per
 *   the V27-00 contract invariant (`RequireUnknownFallback<T>`).
 * - The types travel over the bridge inside the additive `observation`
 *   union member declared in `bridge-ws.ts`. They are **internal bridge
 *   protocol**, NOT public MCP tool schema — public MCP tools
 *   (`packages/shared/src/tools.ts`) are not modified by Batch A.
 */

// ---------------------------------------------------------------------------
// V27-01 — Lifecycle state machine (Batch A)
// ---------------------------------------------------------------------------

/**
 * Closed-enum lifecycle state observed by the v2.7 state machine.
 *
 * - `idle`              — no active navigation; baseline state.
 * - `navigating`        — navigation requested but not yet committed.
 * - `document_loading`  — main frame committed, document still loading.
 * - `document_ready`    — `DOMContentLoaded` fired.
 * - `route_stable`      — `document_complete` fired AND no in-flight
 *                         SPA route change. Default "ready for action".
 * - `unloading`         — page is unloading (back/forward navigation
 *                         start, beforeunload).
 * - `closed`            — tab/frame removed.
 * - `unknown`           — V27-00 invariant fallback. Default for a
 *                         freshly-created snapshot before any event.
 */
export type LifecycleState =
  | 'idle'
  | 'navigating'
  | 'document_loading'
  | 'document_ready'
  | 'route_stable'
  | 'unloading'
  | 'closed'
  | 'unknown';

/** Tuple form for tests / iteration. Order matches the type union above. */
export const LIFECYCLE_STATES = [
  'idle',
  'navigating',
  'document_loading',
  'document_ready',
  'route_stable',
  'unloading',
  'closed',
  'unknown',
] as const satisfies ReadonlyArray<LifecycleState>;

/**
 * Closed-enum descriptor of *why* a particular lifecycle transition
 * happened. Useful for the operation-log `lifecycleState` evidence
 * field — the snapshot pairs `lifecycleState` (where) with one of
 * these flags (how-we-got-here).
 *
 * Always includes `'unknown'` per V27-00 invariant.
 */
export type LifecycleFlag =
  | 'cold_load'
  | 'spa_route_change'
  | 'history_state_update'
  | 'back_forward'
  | 'reload'
  | 'tab_replaced'
  | 'tab_closed'
  | 'unknown';

export const LIFECYCLE_FLAGS = [
  'cold_load',
  'spa_route_change',
  'history_state_update',
  'back_forward',
  'reload',
  'tab_replaced',
  'tab_closed',
  'unknown',
] as const satisfies ReadonlyArray<LifecycleFlag>;

/**
 * Closed-enum classification of how a navigation was initiated. Maps
 * roughly to `chrome.webNavigation.TransitionQualifier` + the
 * `transitionType` field, but pre-summarised so the runtime does not
 * have to parse raw Chrome enums.
 *
 * Always includes `'unknown'`.
 */
export type NavigationIntent =
  | 'user_initiated'
  | 'redirect'
  | 'forward_back'
  | 'reload'
  | 'auto'
  | 'unknown';

export const NAVIGATION_INTENTS = [
  'user_initiated',
  'redirect',
  'forward_back',
  'reload',
  'auto',
  'unknown',
] as const satisfies ReadonlyArray<NavigationIntent>;

/**
 * Snapshot of the v2.7 lifecycle state machine. Producer: V27-01
 * `v27-lifecycle.ts`. Consumer: V27-05 `v27-context-manager.ts` (next
 * batch task) + the operation-log writer.
 *
 * Privacy: this snapshot carries NO raw URL. The `urlPattern` field is
 * the path-only, query-stripped, brand-neutral form already used by
 * the operation log (`OperationMemoryLog.urlPattern`).
 */
export interface LifecycleStateSnapshot {
  /** Current state (closed enum, always includes `'unknown'`). */
  lifecycleState: LifecycleState;
  /** Most recent transition flag (closed enum). */
  lifecycleFlag: LifecycleFlag;
  /** Closed-enum navigation intent for the latest transition. */
  navigationIntent: NavigationIntent;
  /**
   * Confidence in the state, formatted as a clamped float in `[0, 1]`.
   * Higher when more independent signals corroborate the state. The
   * lifecycle writer stamps the formatted `'0.00'..'1.00'` string into
   * `OperationLogMetadata.lifecycleConfidence`.
   */
  lifecycleConfidence: number;
  /**
   * Path-only urlPattern (no query, no fragment). Always brand-neutral.
   */
  urlPattern: string | null;
  /** Producer wallclock for the snapshot (ms). */
  producedAtMs: number;
  /** Tab/frame this snapshot describes. Stays inside the runtime; the
   *  operation-log writer never persists this — see V27-00 PrivacyGate. */
  tabId: number | null;
}

// ---------------------------------------------------------------------------
// V27-01 — Lifecycle bridge events (extension -> native server)
// ---------------------------------------------------------------------------

/**
 * Closed-enum kinds of lifecycle events the extension observer emits
 * over the bridge. Every event type is small and pre-summarised — no
 * raw URL, no header, no body.
 */
export type LifecycleEventKind =
  | 'before_navigate'
  | 'committed'
  | 'dom_content_loaded'
  | 'document_complete'
  | 'history_state_updated'
  | 'tab_removed'
  | 'unknown';

export const LIFECYCLE_EVENT_KINDS = [
  'before_navigate',
  'committed',
  'dom_content_loaded',
  'document_complete',
  'history_state_updated',
  'tab_removed',
  'unknown',
] as const satisfies ReadonlyArray<LifecycleEventKind>;

/**
 * Wire shape the extension's `observers/lifecycle.ts` emits to the
 * native server. Lives inside the v2.7 additive `observation` bridge
 * union member; see `bridge-ws.ts`.
 */
export interface LifecycleEventPayload {
  eventKind: LifecycleEventKind;
  tabId: number;
  /** Path-only urlPattern; brand-neutral. */
  urlPattern: string | null;
  /** Pre-summarised navigation intent. Optional — defaults to `'unknown'`. */
  navigationIntent?: NavigationIntent;
  /** Producer wallclock (ms). */
  observedAtMs: number;
}

// ---------------------------------------------------------------------------
// V27-02..05 — placeholders (declared in V27-01 so downstream tasks can
// extend them without re-opening this file's enum allowlist). They will be
// fleshed out in their respective batch task; the type surface here is the
// minimum needed so V27-01's `bridge-ws.ts` extension is internally
// consistent.
// ---------------------------------------------------------------------------

/**
 * Placeholder for V27-02 fact snapshots. Declared as an opaque shape
 * here so the bridge `observation` union member can reference it; the
 * concrete fields land in V27-02's commit.
 */
export interface BrowserFactSnapshotEnvelope {
  factSnapshotId: string;
  observedAtMs: number;
}

/**
 * Placeholder for V27-03 action outcomes. Shape is finalised in V27-03.
 */
export interface ActionOutcomeEventEnvelope {
  actionId: string;
  observedAtMs: number;
}

/**
 * Placeholder for V27-05 tab/window context events. Shape is finalised
 * in V27-05.
 */
export interface TabWindowContextEventEnvelope {
  tabId: number;
  observedAtMs: number;
}

/** Closed-enum discriminator for the bridge `observation` union member. */
export type ObservationKind =
  | 'lifecycle_event'
  | 'fact_snapshot'
  | 'action_outcome'
  | 'tab_event'
  | 'unknown';

export const OBSERVATION_KINDS = [
  'lifecycle_event',
  'fact_snapshot',
  'action_outcome',
  'tab_event',
  'unknown',
] as const satisfies ReadonlyArray<ObservationKind>;
