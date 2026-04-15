export interface ConnectedClientsResponseGuardInput {
  requestedBaseUrl: string;
  currentBaseUrl: string;
  showMcpConfig: boolean;
}

export interface PopupConnectedClient {
  clientId: string;
  sessionId: string;
  sessionIds: string[];
  sessionCount: number;
  state: 'active';
  kind: 'sse' | 'streamable-http';
  clientIp: string;
  clientName: string;
  clientVersion: string;
  userAgent: string;
  connectedAt: number;
  lastSeenAt: number;
}

export type PopupClientOriginScope = 'local' | 'remote';
export type PopupClientTransport = 'http' | 'sse';

export interface PopupClientOriginDescriptor {
  scope: PopupClientOriginScope;
  transport: PopupClientTransport;
  address: string;
}

const GENERIC_CLIENT_NAMES = new Set(['mcp', 'client', 'sdk', 'unknown-client', 'unknown client']);

export function isGenericPopupClientName(name: string): boolean {
  return GENERIC_CLIENT_NAMES.has((name || '').trim().toLowerCase());
}

export function inferPopupClientProduct(
  client: Pick<PopupConnectedClient, 'clientName' | 'userAgent'>,
): string | null {
  if (!isGenericPopupClientName(client.clientName || '')) return null;

  const userAgent = (client.userAgent || '').toLowerCase();
  if (!userAgent) return null;

  if (userAgent.includes('claude-code') || userAgent.includes('claude code')) {
    return 'Claude Code';
  }
  if (userAgent.includes('claude')) {
    return 'Claude';
  }
  if (userAgent.includes('codex')) {
    return 'Codex';
  }
  if (userAgent.includes('cline')) {
    return 'Cline';
  }
  if (userAgent.includes('cursor')) {
    return 'Cursor';
  }
  if (userAgent.includes('qwen')) {
    return 'Qwen';
  }
  if (userAgent.includes('copaw')) {
    return 'CoPaw';
  }

  return null;
}

export function shouldPopupAutoConnect(search: string | URLSearchParams): boolean {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;
  return params.get('autoconnect') === '1';
}

export function isLoopbackClientIp(clientIp: string): boolean {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes((clientIp || '').trim());
}

export function describePopupClientOrigin(
  client: Pick<PopupConnectedClient, 'clientIp' | 'kind'>,
): PopupClientOriginDescriptor {
  return {
    scope: isLoopbackClientIp(client.clientIp) ? 'local' : 'remote',
    transport: client.kind === 'streamable-http' ? 'http' : 'sse',
    address: client.clientIp || '',
  };
}

export function normalizePopupConnectedClients(value: unknown): PopupConnectedClient[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      clientId: typeof item.clientId === 'string' ? item.clientId : '',
      sessionId: typeof item.sessionId === 'string' ? item.sessionId : '',
      sessionIds: Array.isArray(item.sessionIds)
        ? item.sessionIds.filter((sessionId): sessionId is string => typeof sessionId === 'string')
        : [],
      sessionCount: Number.isFinite(item.sessionCount) ? Number(item.sessionCount) : 0,
      state: 'active' as const,
      kind: (item.kind === 'sse' ? 'sse' : 'streamable-http') as PopupConnectedClient['kind'],
      clientIp: typeof item.clientIp === 'string' ? item.clientIp : '',
      clientName: typeof item.clientName === 'string' ? item.clientName : '',
      clientVersion: typeof item.clientVersion === 'string' ? item.clientVersion : '',
      userAgent: typeof item.userAgent === 'string' ? item.userAgent : '',
      connectedAt: Number.isFinite(item.connectedAt) ? Number(item.connectedAt) : 0,
      lastSeenAt: Number.isFinite(item.lastSeenAt) ? Number(item.lastSeenAt) : 0,
    }))
    .filter((client) => client.clientId && client.sessionId)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function summarizePopupConnectedClients(clients: PopupConnectedClient[]): {
  activeClients: number;
  activeSessions: number;
} {
  return {
    activeClients: clients.length,
    activeSessions: clients.reduce(
      (total, client) => total + Math.max(1, client.sessionCount || client.sessionIds.length || 0),
      0,
    ),
  };
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
