import type {
  ActionOutcomeEventEnvelope,
  BrowserFactSnapshotEnvelope,
  LifecycleEventPayload,
  ObservationKind,
  TabWindowContextEventEnvelope,
} from './browser-fact';

export type BridgeCommandAction = 'call_tool' | 'list_published_flows';

export interface BridgeHelloMessage {
  type: 'hello';
  connectionId: string;
  extensionId: string;
  sentAt: number;
  browserVersion?: string | null;
  nativeConnected?: boolean;
  autoConnectEnabled?: boolean | null;
}

export interface BridgeHeartbeatMessage {
  type: 'heartbeat';
  connectionId: string;
  extensionId: string;
  sentAt: number;
  nativeConnected: boolean;
  browserVersion?: string | null;
  tabCount?: number | null;
  windowCount?: number | null;
  autoConnectEnabled?: boolean | null;
}

export interface BridgeCommandMessage {
  type: 'command';
  requestId: string;
  connectionId: string;
  sentAt: number;
  command: {
    action: BridgeCommandAction;
    payload: any;
    timeoutMs?: number;
  };
}

export interface BridgeResultMessage {
  type: 'result';
  requestId: string;
  connectionId: string;
  extensionId?: string;
  sentAt: number;
  success: boolean;
  payload?: any;
  error?: string;
}

/**
 * V27-01 — Additive bridge message member for v2.7 browser observations.
 *
 * Goal: ship the extension-side observer signal stream (lifecycle
 * events first, action outcomes / fact snapshots / tab events later in
 * V27-02..V27-05) over the existing bridge socket without minting a
 * new public MCP tool. This member is **internal bridge protocol** —
 * it is consumed by `app/native-server/src/runtime/v27-*.ts` and is
 * NOT surfaced through `packages/shared/src/tools.ts`.
 *
 * Backward compatibility: a v2.6 native server that receives this
 * `type: 'observation'` message ignores it (the existing message
 * dispatcher in `app/native-server/src/server/bridge-command-channel.ts`
 * only handles `hello / heartbeat / result`; unknown types are silently
 * dropped). Adding more `kind` values in V27-02..V27-05 is therefore
 * also additive and does not break a partial-rollout extension.
 */
export interface BridgeObservationMessage {
  type: 'observation';
  /** Discriminator — closed enum, always includes `'unknown'`. */
  kind: ObservationKind;
  /** Producer connection id (mirrors hello/heartbeat). */
  connectionId: string;
  /** Producer extension id (mirrors hello/heartbeat). */
  extensionId: string;
  /** Producer wallclock (ms). */
  sentAt: number;
  /**
   * Discriminated payload. The runtime selects the parser based on
   * `kind`. Each payload is a pre-summarised, brand-neutral envelope —
   * raw URLs, headers, bodies, and browser ids never travel here.
   */
  payload:
    | { kind: 'lifecycle_event'; data: LifecycleEventPayload }
    | { kind: 'fact_snapshot'; data: BrowserFactSnapshotEnvelope }
    | { kind: 'action_outcome'; data: ActionOutcomeEventEnvelope }
    | { kind: 'tab_event'; data: TabWindowContextEventEnvelope }
    | { kind: 'unknown'; data: Record<string, never> };
}

export type BridgeWsMessage =
  | BridgeHelloMessage
  | BridgeHeartbeatMessage
  | BridgeCommandMessage
  | BridgeResultMessage
  | BridgeObservationMessage;
