import { ConnectionState, resolveConnectionState } from './connection-state';

export interface PopupConnectionStateInput {
  nativeStatus: 'unknown' | 'connected' | 'disconnected';
  serverRunning: boolean;
  isConnecting: boolean;
  lastError: string | null;
  isBootstrapping: boolean;
}

/**
 * Keep the popup in a neutral probing state while the initial status bootstrap
 * is still in flight, so the UI doesn't briefly flash a disconnected/error
 * state before the server status call settles.
 */
export function resolvePopupConnectionState(input: PopupConnectionStateInput): ConnectionState {
  return resolveConnectionState(
    input.nativeStatus,
    input.serverRunning,
    input.isConnecting || input.isBootstrapping,
    input.lastError,
  );
}
