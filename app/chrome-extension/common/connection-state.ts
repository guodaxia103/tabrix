/**
 * Shared connection state machine for popup / sidepanel / background.
 *
 * Single source of truth for ServerStatus type and the canonical
 * ConnectionState derivation logic.
 *
 * ## State Transitions
 *
 *   UNKNOWN ──→ DISCONNECTED   (ping failed)
 *   UNKNOWN ──→ CONNECTED      (ping ok, server not running)
 *   UNKNOWN ──→ RUNNING        (ping ok, server running)
 *   DISCONNECTED ──→ CONNECTING (user clicks "Connect")
 *   CONNECTING ──→ RUNNING     (connect success + server started)
 *   CONNECTING ──→ CONNECTED   (connect ok, server not yet running)
 *   CONNECTING ──→ ERROR       (connect failed with error)
 *   CONNECTED ──→ RUNNING      (server started)
 *   CONNECTED ──→ DISCONNECTED (native disconnected)
 *   RUNNING ──→ CONNECTED      (server stopped)
 *   RUNNING ──→ DISCONNECTED   (native disconnected)
 *   ERROR ──→ CONNECTING       (user retries)
 *   * ──→ DISCONNECTED         (user clicks "Disconnect")
 */

export interface ServerStatus {
  isRunning: boolean;
  port?: number;
  host?: string;
  networkAddresses?: string[];
  authEnabled?: boolean;
  lastUpdated: number;
}

export enum ConnectionState {
  /** Initial — still probing native host */
  UNKNOWN = 'unknown',
  /** Native host not connected */
  DISCONNECTED = 'disconnected',
  /** User clicked connect, waiting for response */
  CONNECTING = 'connecting',
  /** Native host connected but MCP server not yet running */
  CONNECTED = 'connected',
  /** Fully operational: native connected AND MCP server running */
  RUNNING = 'running',
  /** Last connection attempt failed with an error */
  ERROR = 'error',
}

/**
 * Derive the canonical ConnectionState from runtime signals.
 * Pure function — no side effects, easy to test.
 */
export function resolveConnectionState(
  nativeStatus: 'unknown' | 'connected' | 'disconnected',
  serverRunning: boolean,
  isConnecting: boolean,
  lastError: string | null,
): ConnectionState {
  if (isConnecting) return ConnectionState.CONNECTING;
  if (nativeStatus === 'unknown') return ConnectionState.UNKNOWN;
  if (nativeStatus === 'disconnected') {
    return lastError ? ConnectionState.ERROR : ConnectionState.DISCONNECTED;
  }
  return serverRunning ? ConnectionState.RUNNING : ConnectionState.CONNECTED;
}

/** Map ConnectionState → CSS class for the status indicator dot. */
export function stateToStatusClass(state: ConnectionState): string {
  switch (state) {
    case ConnectionState.RUNNING:
      return 'bg-emerald-500';
    case ConnectionState.CONNECTED:
      return 'bg-yellow-500';
    case ConnectionState.DISCONNECTED:
    case ConnectionState.ERROR:
      return 'bg-red-500';
    case ConnectionState.CONNECTING:
    case ConnectionState.UNKNOWN:
    default:
      return 'bg-gray-500';
  }
}
