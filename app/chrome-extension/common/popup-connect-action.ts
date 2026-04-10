import { ConnectionState } from './connection-state';

export interface PopupConnectActionState {
  action: 'connect' | 'disconnect';
  busy: boolean;
}

/**
 * Keep the popup action button aligned with the status banner above it.
 * During bootstrap or an active connect/disconnect request, the button should
 * stay in a neutral busy state instead of briefly advertising the wrong action.
 */
export function resolvePopupConnectAction(
  connectionState: ConnectionState,
  isConnecting: boolean,
  isBootstrapping: boolean,
): PopupConnectActionState {
  if (isConnecting || isBootstrapping || connectionState === ConnectionState.UNKNOWN) {
    return {
      action: 'connect',
      busy: true,
    };
  }

  if (
    connectionState === ConnectionState.CONNECTED ||
    connectionState === ConnectionState.RUNNING
  ) {
    return {
      action: 'disconnect',
      busy: false,
    };
  }

  return {
    action: 'connect',
    busy: false,
  };
}
