#!/usr/bin/env node

import { getChromeMcpPort, SERVER_CONFIG } from '../constant';
import { COMMAND_NAME } from './constant';

export interface ClientsOptions {
  json?: boolean;
  timeoutMs?: number;
}

interface ClientGroup {
  clientId?: string;
  sessionId?: string;
  sessionIds?: string[];
  sessionCount?: number;
  state?: string;
  kind?: string;
  clientIp?: string;
  clientName?: string;
  clientVersion?: string;
  userAgent?: string;
  connectedAt?: number;
  lastSeenAt?: number;
}

interface SessionEntry {
  sessionId?: string;
  clientId?: string;
  state?: string;
  kind?: string;
  clientIp?: string;
  clientName?: string;
  clientVersion?: string;
  userAgent?: string;
  connectedAt?: number;
  lastSeenAt?: number;
  endedAt?: number | null;
  disconnectReason?: string | null;
}

interface ClientsStatusPayload {
  status: string;
  data: {
    transports: {
      total?: number;
      streamableHttp?: number;
      sse?: number;
      clients?: ClientGroup[];
      sessions?: SessionEntry[];
      sessionStates?: {
        active?: number;
        stale?: number;
        disconnected?: number;
      };
    };
  };
}

type FetchFn = typeof globalThis.fetch;

function resolveFetch(): FetchFn | null {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as FetchFn;
  }
  try {
    const mod = require('node-fetch');
    return (mod.default ?? mod) as FetchFn;
  } catch {
    return null;
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function normalizeNumber(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeClients(value: unknown): ClientGroup[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is ClientGroup => typeof entry === 'object' && entry !== null)
    : [];
}

function normalizeSessions(value: unknown): SessionEntry[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is SessionEntry => typeof entry === 'object' && entry !== null)
    : [];
}

function formatTs(value?: number | null): string {
  return typeof value === 'number' ? new Date(value).toLocaleString() : 'unknown';
}

function renderPretty(payload: ClientsStatusPayload): string {
  const transports = payload.data.transports || {};
  const clients = normalizeClients(transports.clients);
  const sessions = normalizeSessions(transports.sessions);
  const inactive = sessions.filter((session) => session.state && session.state !== 'active');
  const lines = [
    `${COMMAND_NAME} clients`,
    '',
    `Active sessions: ${normalizeNumber(transports.total)} (streamable-http: ${normalizeNumber(transports.streamableHttp)}, sse: ${normalizeNumber(transports.sse)})`,
    `Active client groups: ${clients.length}`,
  ];

  if (clients.length === 0) {
    lines.push('No active MCP clients.');
  } else {
    lines.push('');
    lines.push('Active Clients');
    for (const client of clients) {
      const count = normalizeNumber(client.sessionCount);
      lines.push(
        `- ${client.clientName || 'unknown-client'} @ ${client.clientIp || 'unknown-ip'} (${count} session${count === 1 ? '' : 's'})`,
      );
      if (client.clientVersion) lines.push(`  version: ${client.clientVersion}`);
      if (client.kind) lines.push(`  transport: ${client.kind}`);
      if (Array.isArray(client.sessionIds) && client.sessionIds.length > 0) {
        lines.push(`  sessionIds: ${client.sessionIds.join(', ')}`);
      }
      lines.push(`  connectedAt: ${formatTs(client.connectedAt)}`);
      lines.push(`  lastSeenAt: ${formatTs(client.lastSeenAt)}`);
      if (client.userAgent) lines.push(`  userAgent: ${client.userAgent}`);
    }
  }

  if (inactive.length > 0) {
    lines.push('');
    lines.push('Recent Inactive Sessions');
    for (const session of inactive.slice(0, 10)) {
      lines.push(
        `- ${session.sessionId || 'unknown-session'}: ${session.state || 'unknown'} (${session.clientName || 'unknown-client'} @ ${session.clientIp || 'unknown-ip'})`,
      );
      if (session.disconnectReason) lines.push(`  disconnectReason: ${session.disconnectReason}`);
      lines.push(`  connectedAt: ${formatTs(session.connectedAt)}`);
      lines.push(`  lastSeenAt: ${formatTs(session.lastSeenAt)}`);
      lines.push(`  endedAt: ${formatTs(session.endedAt)}`);
    }
  }

  return lines.join('\n');
}

export async function runClients(options: ClientsOptions = {}): Promise<number> {
  const fetchFn = resolveFetch();
  if (!fetchFn) {
    process.stderr.write(
      'Clients failed: fetch is not available (requires Node.js >=18 or node-fetch)\n',
    );
    return 1;
  }

  const timeoutMs = options.timeoutMs ?? 1500;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

  try {
    const requestHost =
      SERVER_CONFIG.HOST === '0.0.0.0' || SERVER_CONFIG.HOST === '::'
        ? '127.0.0.1'
        : SERVER_CONFIG.HOST;
    const response = await fetchFn(`http://${requestHost}:${getChromeMcpPort()}/status`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      process.stderr.write(`Clients failed: HTTP ${response.status}\n`);
      return 1;
    }
    const payload = (await response.json()) as ClientsStatusPayload;
    const output = options.json
      ? JSON.stringify(payload.data.transports || {}, null, 2)
      : renderPretty(payload);
    process.stdout.write(output + '\n');
    return 0;
  } catch (error) {
    process.stderr.write(`Clients failed: ${stringifyError(error)}\n`);
    process.stderr.write(
      `Hint: run "${COMMAND_NAME} daemon start" or "${COMMAND_NAME} doctor --fix"\n`,
    );
    return 1;
  } finally {
    clearTimeout(timeout);
  }
}
