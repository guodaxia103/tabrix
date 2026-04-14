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

export type BridgeWsMessage =
  | BridgeHelloMessage
  | BridgeHeartbeatMessage
  | BridgeCommandMessage
  | BridgeResultMessage;
