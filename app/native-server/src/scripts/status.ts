#!/usr/bin/env node

import { COMMAND_NAME } from './constant';
import { SERVER_CONFIG, getChromeMcpPort } from '../constant';
import { collectRuntimeConsistencySnapshot } from './runtime-consistency';

export interface StatusOptions {
  json?: boolean;
  timeoutMs?: number;
}

interface StatusPayload {
  status: string;
  data: {
    isRunning: boolean;
    host: string;
    port: number | null;
    nativeHostAttached: boolean;
    bridge?: {
      bridgeState?: string;
      browserProcessRunning?: boolean;
      extensionHeartbeatAt?: number | null;
      nativeHostAttached?: boolean;
      lastBridgeErrorCode?: string | null;
      lastBridgeErrorMessage?: string | null;
    };
    transports: {
      total: number;
      sse?: number;
      streamableHttp?: number;
      sessionIds?: string[];
    };
  };
}

interface EnrichedStatusPayload extends StatusPayload {
  runtimeConsistency?: Awaited<ReturnType<typeof collectRuntimeConsistencySnapshot>>;
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

function normalizeCount(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeSessionIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

function normalizeTransports(payload: StatusPayload['data']['transports']): {
  total: number;
  streamableHttp: number;
  sse: number;
  sessionIds: string[];
} {
  return {
    total: normalizeCount(payload.total),
    streamableHttp: normalizeCount(payload.streamableHttp),
    sse: normalizeCount(payload.sse),
    sessionIds: normalizeSessionIds(payload.sessionIds),
  };
}

function formatBridgeStateLabel(state?: string): string {
  switch (state) {
    case 'READY':
      return 'ready';
    case 'BROWSER_NOT_RUNNING':
      return 'browser-not-running';
    case 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE':
      return 'extension-unavailable';
    case 'BRIDGE_CONNECTING':
      return 'connecting';
    case 'BRIDGE_DEGRADED':
      return 'degraded';
    case 'BRIDGE_BROKEN':
      return 'broken';
    default:
      return state || 'unknown';
  }
}

function describeBridge(payload: StatusPayload['data']['bridge']): string[] {
  if (!payload) return [];

  const lines = [
    `Bridge state: ${formatBridgeStateLabel(payload.bridgeState)}`,
    `Browser process: ${payload.browserProcessRunning ? 'running' : 'not-running'}`,
  ];

  if (typeof payload.extensionHeartbeatAt === 'number') {
    lines.push(`Extension heartbeat: ${new Date(payload.extensionHeartbeatAt).toLocaleString()}`);
  } else {
    lines.push('Extension heartbeat: missing');
  }

  if (payload.lastBridgeErrorCode || payload.lastBridgeErrorMessage) {
    lines.push(
      `Bridge last error: ${payload.lastBridgeErrorCode || 'unknown'}${payload.lastBridgeErrorMessage ? ` - ${payload.lastBridgeErrorMessage}` : ''}`,
    );
  }

  return lines;
}

function renderPretty(payload: EnrichedStatusPayload): string {
  const { data } = payload;
  const transports = normalizeTransports(data.transports);
  const lines = [
    `${COMMAND_NAME} status`,
    '',
    `Running: ${data.isRunning ? 'yes' : 'no'}`,
    `Host: ${data.host}`,
    `Port: ${data.port ?? 'unknown'}`,
    `Native host attached: ${data.nativeHostAttached ? 'yes' : 'no'}`,
    `Active sessions: ${transports.total} (streamable-http: ${transports.streamableHttp}, sse: ${transports.sse})`,
  ];
  lines.push(...describeBridge(data.bridge));

  if (transports.sessionIds.length > 0) {
    lines.push(`Session IDs: ${transports.sessionIds.join(', ')}`);
  }

  if (payload.runtimeConsistency) {
    const consistency = payload.runtimeConsistency;
    lines.push('');
    lines.push('Runtime Consistency');
    lines.push(`  Verdict: ${consistency.verdict}`);
    lines.push(`  Summary: ${consistency.summary}`);
    lines.push(`  CLI source: ${consistency.cli.sourcePath || 'unknown'}`);
    lines.push(
      `  Daemon: ${
        consistency.daemon.running
          ? `running (pid=${consistency.daemon.pid ?? 'unknown'}, started=${consistency.daemon.startedAt || 'unknown'})`
          : 'stopped'
      }`,
    );
    lines.push(
      `  Native dist: ${consistency.nativeDist.cliPath} (${consistency.nativeDist.modifiedAt || 'missing'})`,
    );
    lines.push(
      `  Extension build: ${consistency.extensionBuild.buildId || 'unknown'} (loaded=${consistency.extensionBuild.loadedPath || 'unknown'})`,
    );
    if (consistency.reasons.length > 0) {
      for (const reason of consistency.reasons) {
        lines.push(`  Reason: ${reason}`);
      }
    }
  }

  return lines.join('\n');
}

export async function runStatus(options: StatusOptions = {}): Promise<number> {
  const fetchFn = resolveFetch();
  if (!fetchFn) {
    process.stderr.write(
      'Status failed: fetch is not available (requires Node.js >=18 or node-fetch)\n',
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
    const listenHost = SERVER_CONFIG.HOST;
    const requestHost = listenHost === '0.0.0.0' || listenHost === '::' ? '127.0.0.1' : listenHost;
    const requestPort = getChromeMcpPort();

    const response = await fetchFn(`http://${requestHost}:${requestPort}/status`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      process.stderr.write(`Status failed: HTTP ${response.status}\n`);
      return 1;
    }

    const payload = (await response.json()) as StatusPayload;
    let runtimeConsistency:
      | Awaited<ReturnType<typeof collectRuntimeConsistencySnapshot>>
      | undefined;
    try {
      runtimeConsistency = await collectRuntimeConsistencySnapshot();
    } catch {
      runtimeConsistency = undefined;
    }
    const enrichedPayload: EnrichedStatusPayload = {
      ...payload,
      ...(runtimeConsistency ? { runtimeConsistency } : {}),
    };
    const output = options.json
      ? JSON.stringify(enrichedPayload, null, 2)
      : renderPretty(enrichedPayload);
    process.stdout.write(output + '\n');
    return 0;
  } catch (error) {
    const message = stringifyError(error);
    process.stderr.write(`Status failed: ${message}\n`);

    if (/fetch failed|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|network|abort/i.test(message)) {
      process.stderr.write(
        `Hint: run "${COMMAND_NAME} daemon start" or "${COMMAND_NAME} doctor --fix"\n`,
      );
    }

    return 1;
  } finally {
    clearTimeout(timeout);
  }
}
