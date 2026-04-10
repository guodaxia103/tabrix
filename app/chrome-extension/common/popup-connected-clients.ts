export interface ConnectedClientsResponseGuardInput {
  requestedBaseUrl: string;
  currentBaseUrl: string;
  showMcpConfig: boolean;
}

/**
 * Ignore connected-client responses that arrive after the popup has switched
 * away from the original running server snapshot.
 */
export function shouldApplyConnectedClientsResponse(
  input: ConnectedClientsResponseGuardInput,
): boolean {
  return input.showMcpConfig && input.requestedBaseUrl === input.currentBaseUrl;
}
