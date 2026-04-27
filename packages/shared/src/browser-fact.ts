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
// V27-02 — Browser Fact Collector (Batch A)
// ---------------------------------------------------------------------------

/**
 * Closed-enum HTTP method bucket the v2.7 fact collector understands.
 * Anything outside the closed set lands in `'OTHER'` so a future
 * RFC-9110 verb does not need a schema-cite migration.
 */
export type NetworkFactMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OTHER' | 'unknown';

export const NETWORK_FACT_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OTHER',
  'unknown',
] as const satisfies ReadonlyArray<NetworkFactMethod>;

/**
 * Closed-enum response-size bucket. Identical to the legacy
 * `endpointCandidates.sizeClass` enum so the v2.7 fact collector can
 * be cross-checked against the existing on-demand capture tool
 * during owner-lane Gate B.
 */
export type NetworkFactSizeClass = 'empty' | 'small' | 'medium' | 'large' | 'unknown';

export const NETWORK_FACT_SIZE_CLASSES = [
  'empty',
  'small',
  'medium',
  'large',
  'unknown',
] as const satisfies ReadonlyArray<NetworkFactSizeClass>;

/**
 * Closed-enum noise classification reused from
 * `network-capture-web-request.ts` (v2.5/v2.6 EndpointNoiseClass) so
 * the new ambient observer never invents a parallel taxonomy. The
 * extension side classifies before sending; the runtime trusts the
 * closed-enum tag and never re-derives it from a raw URL.
 */
export type NetworkFactNoiseClass =
  | 'asset'
  | 'analytics'
  | 'auth'
  | 'private'
  | 'telemetry'
  | 'usable'
  | 'unknown';

export const NETWORK_FACT_NOISE_CLASSES = [
  'asset',
  'analytics',
  'auth',
  'private',
  'telemetry',
  'usable',
  'unknown',
] as const satisfies ReadonlyArray<NetworkFactNoiseClass>;

/**
 * V27-02 — pre-summarised network request metadata. Carries NO header
 * values, NO request/response body, NO raw URL — only the closed-enum
 * shape needed for endpoint candidacy reasoning. The producer (the
 * extension `observers/network-fact.ts` listener) is responsible for
 * stripping query strings into key-only form before emit; the runtime
 * V27-00 PrivacyGate is the persistence-side belt alongside this
 * suspenders.
 */
export interface NetworkRequestFact {
  /** Method bucket (closed enum). */
  method: NetworkFactMethod;
  /** Brand-neutral host string (lowercased, no port). */
  host: string;
  /** Path without query, fragment, or trailing dynamic segments. */
  pathPattern: string;
  /** Sorted array of query parameter keys. Values are NEVER carried. */
  queryKeys: string[];
  /** HTTP status code. `null` for fetch errors. */
  status: number | null;
  /** Request type bucket (`xmlhttprequest`, `fetch`, ...). */
  resourceType: string;
  /** Closed-enum content-type bucket. */
  contentType: string | null;
  /** Closed-enum response-size bucket. */
  sizeClass: NetworkFactSizeClass;
  /** Round-trip timing in milliseconds. `null` if unknown. */
  timingMs: number | null;
  /** Closed-enum noise classification. */
  noiseClass: NetworkFactNoiseClass;
  /** Producer wallclock for the request completion (ms). */
  observedAtMs: number;
}

/**
 * V27-02 — DOM region fingerprint. Carries NO raw HTML, NO innerText.
 * Producer normalises a small allowlist of region signals (e.g.
 * `header.title`, `list.itemCount`, `form.fieldNames`) into stable
 * deterministic strings, then the helper hashes them into
 * `regionHashes`. The runtime compares hashes between snapshots to
 * decide whether the visible structure changed.
 */
export interface DomRegionFingerprint {
  /**
   * Map of region tag (e.g. `'header'`, `'main_list'`) to a hash. Tag
   * keys are stable and brand-neutral; the hash is the SHA-1 of the
   * region's pre-summarised signal bag.
   */
  regionHashes: Record<string, string>;
  /** Deterministic hash of the entire `regionHashes` map (stable order). */
  domSnapshotHash: string;
  /** Producer wallclock (ms). */
  observedAtMs: number;
}

/**
 * V27-02 — readiness signal panel. Each signal is `true | false |
 * unknown` (closed enum, V27-00 invariant). The runtime composes these
 * with the lifecycle snapshot when answering "is this page ready for
 * a list-shaped read?".
 */
export interface ReadinessSignals {
  documentComplete: 'true' | 'false' | 'unknown';
  routeStable: 'true' | 'false' | 'unknown';
  keyRegionReady: 'true' | 'false' | 'unknown';
  networkQuiet: 'true' | 'false' | 'unknown';
  /** Producer wallclock (ms). */
  observedAtMs: number;
}

/**
 * V27-02 — top-level fact snapshot. The fact collector hands these out
 * by `factSnapshotId` to V27-04 / V27-05 consumers.
 *
 * Privacy posture: every field is either a closed-enum bucket, a
 * brand-neutral path-only string, a deterministic hash, or a count.
 * The runtime PrivacyGate `assertNoSensitive` runs on every snapshot
 * before persistence as a defence-in-depth check.
 */
export interface BrowserFactSnapshot {
  /** Producer-side opaque id (stable per producer per snapshot). */
  factSnapshotId: string;
  /** Sub-id for the network arm of the snapshot. `null` if no network
   *  facts were attached. */
  networkSnapshotId: string | null;
  /** Sub-id for the DOM arm of the snapshot. `null` if no DOM
   *  fingerprint was attached. */
  domSnapshotId: string | null;
  /** Producer-side session id; lets a consumer correlate snapshots
   *  produced during the same task. */
  sessionId: string | null;
  /** Closed-enum signals (`'unknown'` is allowed). */
  readiness: ReadinessSignals;
  /** Brand-neutral urlPattern (host+path only, no query, no
   *  fragment). */
  urlPattern: string | null;
  /** Tab id is producer-side state. The runtime keeps it for
   *  bookkeeping but the V27-00 PrivacyGate strips it before
   *  persistence. */
  tabId: number | null;
  /** Producer wallclock (ms). */
  producedAtMs: number;
  /** TTL after which the fact collector treats this snapshot as
   *  stale. The runtime rejects `getFactSnapshot(id)` once the TTL
   *  expires. */
  ttlMs: number;
  /** Closed-enum, redaction-safe array of network request facts.
   *  May be empty. */
  networkFacts: NetworkRequestFact[];
  /** DOM region fingerprint, or `null` if none. */
  domFingerprint: DomRegionFingerprint | null;
}

/**
 * V27-02 — wire envelope the extension `observers/network-fact.ts` /
 * `observers/dom-fact.ts` / `observers/readiness.ts` push over the
 * bridge. The native fact collector ingests these and folds them into
 * a single `BrowserFactSnapshot`.
 */
export type FactObservationEventKind =
  | 'network_request'
  | 'dom_fingerprint'
  | 'readiness_signal'
  | 'unknown';

export const FACT_OBSERVATION_EVENT_KINDS = [
  'network_request',
  'dom_fingerprint',
  'readiness_signal',
  'unknown',
] as const satisfies ReadonlyArray<FactObservationEventKind>;

export type FactObservationPayload =
  | {
      eventKind: 'network_request';
      fact: NetworkRequestFact;
      tabId: number;
      urlPattern: string | null;
      sessionId: string | null;
    }
  | {
      eventKind: 'dom_fingerprint';
      fingerprint: DomRegionFingerprint;
      tabId: number;
      urlPattern: string | null;
      sessionId: string | null;
    }
  | {
      eventKind: 'readiness_signal';
      signals: ReadinessSignals;
      tabId: number;
      urlPattern: string | null;
      sessionId: string | null;
    }
  | {
      eventKind: 'unknown';
      tabId: number;
      urlPattern: string | null;
      sessionId: string | null;
      observedAtMs: number;
    };

/** Bridge envelope outer type for the V27-02 fact arm. */
export interface BrowserFactSnapshotEnvelope {
  factSnapshotId: string;
  observedAtMs: number;
  payload: FactObservationPayload;
}

// ---------------------------------------------------------------------------
// V27-03 — Action outcome classifier (Batch A)
// ---------------------------------------------------------------------------

/**
 * Closed-enum kind of action being classified. The runtime keeps the
 * set narrow on purpose: the v2.7 outcome classifier only cares whether
 * something likely-mutating happened, not the exact UI affordance.
 *
 * Always includes `'unknown'` per V27-00 invariant.
 */
export type ActionKind = 'click' | 'fill' | 'submit' | 'navigate' | 'keyboard' | 'unknown';

export const ACTION_KINDS = [
  'click',
  'fill',
  'submit',
  'navigate',
  'keyboard',
  'unknown',
] as const satisfies ReadonlyArray<ActionKind>;

/**
 * Closed-enum signal kinds the V27-03 race observer emits during the
 * post-action settle window. Each signal is small, brand-neutral, and
 * pre-classified — the runtime never re-derives a signal kind from a
 * raw URL or DOM string.
 *
 * Always includes `'unknown'`.
 */
export type ActionSignalKind =
  | 'lifecycle_committed'
  | 'tab_created'
  | 'dom_region_changed'
  | 'network_completed'
  | 'dialog_opened'
  | 'unknown';

export const ACTION_SIGNAL_KINDS = [
  'lifecycle_committed',
  'tab_created',
  'dom_region_changed',
  'network_completed',
  'dialog_opened',
  'unknown',
] as const satisfies ReadonlyArray<ActionSignalKind>;

/**
 * V27-03 — single signal in the post-action timeline. Carries closed-enum
 * descriptors only; the producer is responsible for stripping URL
 * query/fragment, raw HTML, and header values before emit. The
 * persistence-side V27-00 PrivacyGate is the belt-and-suspenders defence.
 */
export interface ActionSignal {
  kind: ActionSignalKind;
  /** Producer wallclock for the signal (ms). */
  observedAtMs: number;
  /** Optional brand-neutral region tag (DOM signals only). */
  regionTag?: string | null;
  /** Optional brand-neutral host (network signals only). */
  host?: string | null;
  /** Optional path-only pattern (network signals only). */
  pathPattern?: string | null;
  /** Optional new-tab id (tab_created signals only). */
  newTabId?: number | null;
}

/**
 * Closed-enum classification of an action's observed effect. Includes
 * `'multiple_signals'` (several non-overlapping signals fired, e.g.
 * navigation + new-tab) and `'ambiguous'` (signals fired but the
 * confidence is too low to commit to a verdict). Always includes
 * `'unknown'` per V27-00 invariant.
 */
export type ActionOutcome =
  | 'navigated_same_tab'
  | 'navigated_new_tab'
  | 'spa_partial_update'
  | 'modal_opened'
  | 'no_observed_change'
  | 'multiple_signals'
  | 'ambiguous'
  | 'unknown';

export const ACTION_OUTCOMES = [
  'navigated_same_tab',
  'navigated_new_tab',
  'spa_partial_update',
  'modal_opened',
  'no_observed_change',
  'multiple_signals',
  'ambiguous',
  'unknown',
] as const satisfies ReadonlyArray<ActionOutcome>;

/**
 * V27-03 — wire envelope the extension `observers/action-outcome.ts`
 * emits over the bridge. Carries the action descriptor + the closed-enum
 * signal timeline. The native classifier is pure: given this envelope,
 * it returns `ActionOutcomeSnapshot` deterministically.
 */
export interface ActionOutcomeEventEnvelope {
  /** Producer-side opaque id, stable across retries. */
  actionId: string;
  /** Closed-enum action kind. */
  actionKind: ActionKind;
  /** Tab the action was dispatched against. */
  tabId: number;
  /** Path-only urlPattern at the time of the action; brand-neutral. */
  urlPattern: string | null;
  /** Producer wallclock for the action itself (ms). */
  observedAtMs: number;
  /** Pre-summarised signal timeline (closed-enum kinds only). */
  signals: ActionSignal[];
}

/**
 * V27-03 — output of `v27-action-outcome.ts`. Lives inside the
 * runtime; the operation-log writer copies `outcome` and the
 * formatted confidence into `actionOutcome` / `outcomeConfidence`
 * metadata keys (already declared by V27-00).
 */
export interface ActionOutcomeSnapshot {
  actionId: string;
  outcome: ActionOutcome;
  /** Clamped float in `[0, 1]`. */
  outcomeConfidence: number;
  /** Closed-enum signal kinds that fired during the settle window
   *  (deduplicated). Useful for the operation-log evidence trail. */
  observedSignalKinds: ActionSignalKind[];
  /** Producer wallclock for the snapshot (ms). */
  producedAtMs: number;
}

// ---------------------------------------------------------------------------
// V27-04 — Readiness + Complexity profilers (Batch A)
// ---------------------------------------------------------------------------

/**
 * Closed-enum readiness state the V27-04 readiness profiler emits. The
 * states are deliberately orthogonal to complexity — the profiler asks
 * "is the page in a state where a list-shaped read would be wasted?",
 * not "what kind of page is this?".
 *
 * Ordering reflects increasing readiness: `error` and `empty` are
 * terminal-style states the runtime should treat as "do not bother
 * reading"; `route_stable` is the strongest "yes, ready" signal.
 *
 * Always includes `'unknown'` per V27-00 invariant.
 */
export type ReadinessState =
  | 'error'
  | 'empty'
  | 'document_complete'
  | 'key_region_ready'
  | 'network_key_done'
  | 'route_stable'
  | 'unknown';

export const READINESS_STATES = [
  'error',
  'empty',
  'document_complete',
  'key_region_ready',
  'network_key_done',
  'route_stable',
  'unknown',
] as const satisfies ReadonlyArray<ReadinessState>;

/**
 * V27-04 — output of the readiness profiler. Lives inside the runtime;
 * the operation-log writer copies `state` into the existing
 * `readinessState` metadata key (already declared by V27-00).
 */
export interface ReadinessProfile {
  /** Closed-enum readiness state (always includes `'unknown'`). */
  state: ReadinessState;
  /** Confidence in the verdict, clamped to `[0, 1]`. */
  confidence: number;
  /** Closed-enum readiness signals the verdict was derived from. The
   *  list is order-stable and deduplicated; consumers MUST NOT rely on
   *  the order of signals carrying the same observation timestamp. */
  contributingSignals: ReadinessState[];
  /** Producer wallclock (ms). Same as the input snapshot's
   *  `producedAtMs` for determinism. */
  producedAtMs: number;
}

/**
 * Closed-enum complexity classification. The V27-04 complexity
 * profiler categorises a page by its dominant "shape", not by site
 * brand. Ordering goes from cheapest read to most expensive, which is
 * helpful for tests and for the layer-budget composer.
 *
 * Always includes `'unknown'` per V27-00 invariant.
 */
export type ComplexityKind =
  | 'simple'
  | 'list_or_search'
  | 'detail'
  | 'document'
  | 'transactional'
  | 'media'
  | 'complex_app'
  | 'unknown';

export const COMPLEXITY_KINDS = [
  'simple',
  'list_or_search',
  'detail',
  'document',
  'transactional',
  'media',
  'complex_app',
  'unknown',
] as const satisfies ReadonlyArray<ComplexityKind>;

/**
 * V27-04 — output of the complexity profiler. Like the readiness arm,
 * this snapshot is orthogonal: complexity does NOT consume readiness
 * signals, and readiness does NOT consume complexity. They compose only
 * inside `RecommendedLayerBudget`.
 */
export interface ComplexityProfile {
  /** Closed-enum complexity kind. Always includes `'unknown'`. */
  kind: ComplexityKind;
  /** Confidence in the verdict, clamped to `[0, 1]`. */
  confidence: number;
  /** Producer wallclock (ms). */
  producedAtMs: number;
}

/**
 * Closed-enum recommendation for which Tabrix layer (L0/L1/L2) the
 * Router/Policy should consult next. The recommendation is advisory —
 * the Router consumes it together with privacy/risk policy, the active
 * task intent, and the latency budget before committing.
 *
 * Always includes `'unknown'` per V27-00 invariant.
 */
export type RecommendedLayer = 'L0' | 'L1' | 'L2' | 'unknown';

export const RECOMMENDED_LAYERS = [
  'L0',
  'L1',
  'L2',
  'unknown',
] as const satisfies ReadonlyArray<RecommendedLayer>;

/**
 * Closed-enum reason the layer-budget composer picked the recommended
 * layer. Mostly mirrors `ComplexityKind` but adds dedicated states for
 * "readiness was negative" and "we have no data".
 */
export type RecommendedLayerReason =
  | 'simple_shell'
  | 'list_or_search'
  | 'detail'
  | 'document'
  | 'transactional'
  | 'media'
  | 'complex_app'
  | 'not_ready'
  | 'unknown';

export const RECOMMENDED_LAYER_REASONS = [
  'simple_shell',
  'list_or_search',
  'detail',
  'document',
  'transactional',
  'media',
  'complex_app',
  'not_ready',
  'unknown',
] as const satisfies ReadonlyArray<RecommendedLayerReason>;

/**
 * V27-04 — composed advisory output. Pairs the readiness profile with
 * the complexity profile and the resulting `RecommendedLayer`. The
 * Router/Policy is the only consumer; this batch declares the type but
 * does not yet wire it onto the production decision path.
 *
 * The three boolean hints (`needsApi`, `needsMarkdown`, `needsL2`) are
 * NOT independent flags — the composer MUST set them consistently with
 * `recommendedLayer` so a downstream consumer can pick whichever
 * representation is most convenient.
 */
export interface RecommendedLayerBudget {
  recommendedLayer: RecommendedLayer;
  reason: RecommendedLayerReason;
  /** Closed-enum sub-flags echoing `recommendedLayer`. */
  needsApi: boolean;
  needsMarkdown: boolean;
  needsL2: boolean;
  /** The readiness/complexity arms that produced the recommendation. */
  readiness: ReadinessProfile;
  complexity: ComplexityProfile;
  /** Confidence in the recommendation, clamped to `[0, 1]`. The
   *  composer takes the lower of the two arm confidences so callers
   *  can reason about it as a min-bound. */
  confidence: number;
  /** Producer wallclock (ms). */
  producedAtMs: number;
}

// ---------------------------------------------------------------------------
// V27-05 — placeholders (declared here so downstream batch tasks can
// extend them without re-opening this file's enum allowlist). The
// concrete fields land in their respective batch task.
// ---------------------------------------------------------------------------

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
