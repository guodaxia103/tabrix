import type { ServerStatus } from './connection-state';

export interface PopupConnectionSnapshot {
  nativeConnectionStatus: 'unknown' | 'connected' | 'disconnected';
  serverStatus: ServerStatus;
  connectedClients: unknown[];
  lastNativeError: string | null;
}

/**
 * Fall back to a disconnected popup snapshot when background status refresh fails.
 * Preserve the last known port and metadata for diagnostics, but clear any UI that
 * would incorrectly suggest the MCP server is still live.
 */
export function createDisconnectedPopupSnapshot(
  previousServerStatus: ServerStatus,
): PopupConnectionSnapshot {
  return {
    nativeConnectionStatus: 'disconnected',
    serverStatus: {
      ...previousServerStatus,
      isRunning: false,
      lastUpdated: Date.now(),
    },
    connectedClients: [],
    lastNativeError: null,
  };
}
