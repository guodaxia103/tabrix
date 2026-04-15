/**
 * Session Registry — manages MCP transport sessions (Streamable HTTP only).
 *
 * Extracted from server/index.ts (A2) to centralize session lifecycle:
 *   register / get / remove / disconnect / snapshot / closeAll
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { createHash } from 'node:crypto';

// ============================================================
// Types
// ============================================================

export type SessionState = 'active' | 'stale' | 'disconnected';
export type DisconnectReason =
  | 'manual'
  | 'client-closed'
  | 'stale-timeout'
  | 'initialize-failed'
  | 'server-shutdown';

export interface TransportMeta {
  clientIp: string;
  clientName: string;
  clientVersion: string;
  userAgent: string;
  connectedAt: number;
}

export type ManagedTransport = {
  kind: 'streamable-http';
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  clientId: string;
  lastSeenAt: number;
} & TransportMeta;

export interface ConnectedClient {
  clientId: string;
  sessionId: string;
  sessionIds: string[];
  sessionCount: number;
  state: 'active';
  kind: 'streamable-http';
  clientIp: string;
  clientName: string;
  clientVersion: string;
  userAgent: string;
  connectedAt: number;
  lastSeenAt: number;
}

export interface SessionSnapshot {
  sessionId: string;
  clientId: string;
  state: SessionState;
  kind: 'streamable-http';
  clientIp: string;
  clientName: string;
  clientVersion: string;
  userAgent: string;
  connectedAt: number;
  lastSeenAt: number;
  endedAt: number | null;
  disconnectReason: DisconnectReason | null;
}

export interface SessionCleanupSnapshot {
  staleAfterMs: number;
  disconnectedRetentionMs: number;
  lastSweepAt: number | null;
  staleRemoved: number;
  disconnectedPurged: number;
}

export interface SessionStateCounts {
  active: number;
  stale: number;
  disconnected: number;
}

export interface TransportsSnapshot {
  total: number;
  streamableHttp: number;
  sessionIds: string[];
  clients: ConnectedClient[];
  sessions: SessionSnapshot[];
  sessionStates: SessionStateCounts;
  cleanup: SessionCleanupSnapshot;
}

interface SessionRegistryOptions {
  staleAfterMs?: number;
  disconnectedRetentionMs?: number;
  now?: () => number;
}

interface SessionSweepResult {
  staleRemoved: number;
  disconnectedPurged: number;
}

const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_DISCONNECTED_RETENTION_MS = 60_000;

// ============================================================
// SessionRegistry
// ============================================================

export class SessionRegistry {
  private transports: Map<string, ManagedTransport> = new Map();
  private terminalSessions: Map<string, SessionSnapshot> = new Map();
  private staleAfterMs: number;
  private disconnectedRetentionMs: number;
  private now: () => number;
  private lastSweepAt: number | null = null;
  private lastSweepResult: SessionSweepResult = { staleRemoved: 0, disconnectedPurged: 0 };

  constructor(options: SessionRegistryOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.disconnectedRetentionMs =
      options.disconnectedRetentionMs ?? DEFAULT_DISCONNECTED_RETENTION_MS;
    this.now = options.now ?? (() => Date.now());
  }

  get(sessionId: string): ManagedTransport | undefined {
    this.sweep();
    return this.transports.get(sessionId);
  }

  has(sessionId: string): boolean {
    this.sweep();
    return this.transports.has(sessionId);
  }

  get size(): number {
    this.sweep();
    return this.transports.size;
  }

  register(sessionId: string, entry: Omit<ManagedTransport, 'clientId' | 'lastSeenAt'>): void {
    this.sweep();
    const clientId = this.computeClientId(entry.clientIp, entry.clientName, entry.clientVersion);
    this.transports.set(sessionId, {
      ...entry,
      clientId,
      lastSeenAt: entry.connectedAt,
    });
  }

  /**
   * Remove a session and close its MCP server.
   * Safe to call multiple times for the same sessionId.
   */
  remove(sessionId: string, reason: DisconnectReason = 'client-closed'): void {
    const entry = this.transports.get(sessionId);
    if (!entry) return;
    this.transports.delete(sessionId);
    this.recordTerminalSession(
      this.createSessionSnapshot(sessionId, entry, {
        state: reason === 'stale-timeout' ? 'stale' : 'disconnected',
        endedAt: this.now(),
        disconnectReason: reason,
      }),
    );
    void (async () => {
      try {
        await entry.transport.close();
      } catch {
        // Ignore transport cleanup failures during disconnect/teardown.
      }
      try {
        await entry.server.close();
      } catch {
        // Ignore MCP server cleanup failures during disconnect/teardown.
      }
    })();
  }

  /**
   * Force-disconnect a session. Returns true if the session existed.
   */
  disconnect(sessionId: string, reason: DisconnectReason = 'manual'): boolean {
    this.sweep();
    if (!this.transports.has(sessionId)) return false;
    this.remove(sessionId, reason);
    return true;
  }

  disconnectClient(clientId: string, reason: DisconnectReason = 'manual'): number {
    this.sweep();
    const sessionIds = [...this.transports.entries()]
      .filter(([, entry]) => entry.clientId === clientId)
      .map(([sessionId]) => sessionId);

    for (const sessionId of sessionIds) {
      this.remove(sessionId, reason);
    }

    return sessionIds.length;
  }

  touch(sessionId: string): void {
    this.sweep();
    const entry = this.transports.get(sessionId);
    if (!entry) return;
    entry.lastSeenAt = this.now();
  }

  /**
   * Close all sessions (used during server shutdown).
   */
  async closeAll(): Promise<void> {
    const entries = [...this.transports.entries()];
    this.transports.clear();
    this.terminalSessions.clear();
    this.lastSweepAt = this.now();
    this.lastSweepResult = { staleRemoved: 0, disconnectedPurged: 0 };
    await Promise.allSettled(
      entries.map(async ([, entry]) => {
        try {
          await entry.transport.close();
        } catch {
          // Ignore transport cleanup failures during shutdown.
        }
        await entry.server.close();
      }),
    );
  }

  /**
   * Update client metadata from an initialize request body.
   */
  updateClientInfo(sessionId: string, body: unknown): void {
    this.sweep();
    const entry = this.transports.get(sessionId);
    if (!entry) return;
    const msg = body as { params?: { clientInfo?: { name?: string; version?: string } } };
    if (msg?.params?.clientInfo) {
      entry.clientName = msg.params.clientInfo.name ?? '';
      entry.clientVersion = msg.params.clientInfo.version ?? '';
      entry.clientId = this.computeClientId(entry.clientIp, entry.clientName, entry.clientVersion);
      entry.lastSeenAt = this.now();
    }
  }

  /**
   * Build a snapshot of all active transport sessions.
   */
  snapshot(): TransportsSnapshot {
    this.sweep();
    const sessionIds = [...this.transports.keys()];
    const sessions = [...this.transports.entries()]
      .map(([sessionId, entry]) => this.createSessionSnapshot(sessionId, entry))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    const clients = this.buildConnectedClients(sessions);
    const terminalSessions = [...this.terminalSessions.values()].sort((a, b) => {
      const timeA = a.endedAt ?? a.lastSeenAt;
      const timeB = b.endedAt ?? b.lastSeenAt;
      return timeB - timeA;
    });
    const allSessions = [...sessions, ...terminalSessions];
    const sessionStates: SessionStateCounts = {
      active: sessions.length,
      stale: terminalSessions.filter((session) => session.state === 'stale').length,
      disconnected: terminalSessions.filter((session) => session.state === 'disconnected').length,
    };

    return {
      total: sessionIds.length,
      streamableHttp: sessionIds.length,
      sessionIds,
      clients,
      sessions: allSessions,
      sessionStates,
      cleanup: {
        staleAfterMs: this.staleAfterMs,
        disconnectedRetentionMs: this.disconnectedRetentionMs,
        lastSweepAt: this.lastSweepAt,
        staleRemoved: this.lastSweepResult.staleRemoved,
        disconnectedPurged: this.lastSweepResult.disconnectedPurged,
      },
    };
  }

  private computeClientId(clientIp: string, clientName: string, clientVersion: string): string {
    const fingerprint = JSON.stringify({
      clientIp: clientIp || 'unknown-ip',
      clientName: clientName || 'unknown-client',
      clientVersion: clientVersion || 'unknown-version',
    });
    return createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
  }

  private createSessionSnapshot(
    sessionId: string,
    entry: ManagedTransport,
    overrides: Partial<SessionSnapshot> = {},
  ): SessionSnapshot {
    return {
      sessionId,
      clientId: entry.clientId,
      state: 'active',
      kind: entry.kind,
      clientIp: entry.clientIp,
      clientName: entry.clientName,
      clientVersion: entry.clientVersion,
      userAgent: entry.userAgent,
      connectedAt: entry.connectedAt,
      lastSeenAt: entry.lastSeenAt,
      endedAt: null,
      disconnectReason: null,
      ...overrides,
    };
  }

  private buildConnectedClients(sessions: SessionSnapshot[]): ConnectedClient[] {
    const grouped = new Map<string, ConnectedClient>();

    for (const session of sessions) {
      const existing = grouped.get(session.clientId);
      if (!existing) {
        grouped.set(session.clientId, {
          clientId: session.clientId,
          sessionId: session.sessionId,
          sessionIds: [session.sessionId],
          sessionCount: 1,
          state: 'active',
          kind: session.kind,
          clientIp: session.clientIp,
          clientName: session.clientName,
          clientVersion: session.clientVersion,
          userAgent: session.userAgent,
          connectedAt: session.connectedAt,
          lastSeenAt: session.lastSeenAt,
        });
        continue;
      }

      existing.sessionIds.push(session.sessionId);
      existing.sessionCount += 1;
      if (session.lastSeenAt > existing.lastSeenAt) {
        existing.sessionId = session.sessionId;
        existing.lastSeenAt = session.lastSeenAt;
        existing.clientName = session.clientName;
        existing.clientVersion = session.clientVersion;
        existing.userAgent = session.userAgent;
      }
      if (session.connectedAt < existing.connectedAt) {
        existing.connectedAt = session.connectedAt;
      }
    }

    return [...grouped.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  private recordTerminalSession(snapshot: SessionSnapshot): void {
    this.terminalSessions.set(snapshot.sessionId, snapshot);
  }

  private sweep(): void {
    const now = this.now();
    let staleRemoved = 0;

    for (const [sessionId, entry] of [...this.transports.entries()]) {
      if (now - entry.lastSeenAt <= this.staleAfterMs) continue;
      staleRemoved += 1;
      this.remove(sessionId, 'stale-timeout');
    }

    let disconnectedPurged = 0;
    for (const [sessionId, session] of [...this.terminalSessions.entries()]) {
      const endedAt = session.endedAt ?? session.lastSeenAt;
      if (now - endedAt <= this.disconnectedRetentionMs) continue;
      this.terminalSessions.delete(sessionId);
      disconnectedPurged += 1;
    }

    this.lastSweepAt = now;
    this.lastSweepResult = { staleRemoved, disconnectedPurged };
  }
}
