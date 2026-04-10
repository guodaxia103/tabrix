import type { ServerStatus } from './connection-state';

interface PopupServerStatusMessageGuardParams {
  desiredPort: number;
  isBusy: boolean;
  serverStatus: ServerStatus;
  connected?: boolean;
}

export function shouldApplyPopupServerStatusMessage(
  params: PopupServerStatusMessageGuardParams,
): boolean {
  const { desiredPort, isBusy, serverStatus, connected } = params;

  if (!isBusy) {
    return true;
  }

  if (!connected || !serverStatus.isRunning) {
    return true;
  }

  if (!serverStatus.port) {
    return true;
  }

  return serverStatus.port === desiredPort;
}
