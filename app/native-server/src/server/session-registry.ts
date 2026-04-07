/**
 * Session Registry — manages MCP transport sessions (SSE & Streamable HTTP).
 *
 * Extracted from server/index.ts (A2) to centralize session lifecycle:
 *   register / get / remove / disconnect / snapshot / closeAll
 */
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';

// ============================================================
// Types
// ============================================================

export interface TransportMeta {
  clientIp: string;
  clientName: string;
  clientVersion: string;
  connectedAt: number;
}

export type ManagedTransport = (
  | {
      kind: 'sse';
      transport: SSEServerTransport;
      server: McpServer;
    }
  | {
      kind: 'streamable-http';
      transport: StreamableHTTPServerTransport;
      server: McpServer;
    }
) &
  TransportMeta;

export interface ConnectedClient {
  sessionId: string;
  kind: 'sse' | 'streamable-http';
  clientIp: string;
  clientName: string;
  clientVersion: string;
  connectedAt: number;
}

export interface TransportsSnapshot {
  total: number;
  sse: number;
  streamableHttp: number;
  sessionIds: string[];
  clients: ConnectedClient[];
}

// ============================================================
// SessionRegistry
// ============================================================

export class SessionRegistry {
  private transports: Map<string, ManagedTransport> = new Map();

  get(sessionId: string): ManagedTransport | undefined {
    return this.transports.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.transports.has(sessionId);
  }

  get size(): number {
    return this.transports.size;
  }

  register(sessionId: string, entry: ManagedTransport): void {
    this.transports.set(sessionId, entry);
  }

  /**
   * Remove a session and close its MCP server.
   * Safe to call multiple times for the same sessionId.
   */
  remove(sessionId: string): void {
    const entry = this.transports.get(sessionId);
    if (!entry) return;
    this.transports.delete(sessionId);
    void entry.server.close().catch(() => {
      // Ignore cleanup failures during disconnect/teardown.
    });
  }

  /**
   * Force-disconnect a session. Returns true if the session existed.
   */
  disconnect(sessionId: string): boolean {
    if (!this.transports.has(sessionId)) return false;
    this.remove(sessionId);
    return true;
  }

  /**
   * Close all sessions (used during server shutdown).
   */
  async closeAll(): Promise<void> {
    const entries = [...this.transports.entries()];
    this.transports.clear();
    await Promise.allSettled(entries.map(([, entry]) => entry.server.close()));
  }

  /**
   * Update client metadata from an initialize request body.
   */
  updateClientInfo(sessionId: string, body: unknown): void {
    const entry = this.transports.get(sessionId);
    if (!entry) return;
    const msg = body as { params?: { clientInfo?: { name?: string; version?: string } } };
    if (msg?.params?.clientInfo) {
      entry.clientName = msg.params.clientInfo.name ?? '';
      entry.clientVersion = msg.params.clientInfo.version ?? '';
    }
  }

  /**
   * Build a snapshot of all active transport sessions.
   */
  snapshot(): TransportsSnapshot {
    const sessionIds = [...this.transports.keys()];
    let sse = 0;
    let streamableHttp = 0;
    const clients: ConnectedClient[] = [];

    for (const [sid, entry] of this.transports.entries()) {
      if (entry.kind === 'sse') {
        sse += 1;
      } else {
        streamableHttp += 1;
      }
      clients.push({
        sessionId: sid,
        kind: entry.kind,
        clientIp: entry.clientIp,
        clientName: entry.clientName,
        clientVersion: entry.clientVersion,
        connectedAt: entry.connectedAt,
      });
    }

    return { total: sessionIds.length, sse, streamableHttp, sessionIds, clients };
  }
}
