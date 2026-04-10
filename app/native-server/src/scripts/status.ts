#!/usr/bin/env node

import { COMMAND_NAME } from './constant';
import { NATIVE_SERVER_PORT, SERVER_CONFIG } from '../constant';

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
    transports: {
      total: number;
      sse: number;
      streamableHttp: number;
      sessionIds: string[];
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

function renderPretty(payload: StatusPayload): string {
  const { data } = payload;
  const lines = [
    `${COMMAND_NAME} status`,
    '',
    `Running: ${data.isRunning ? 'yes' : 'no'}`,
    `Host: ${data.host}`,
    `Port: ${data.port ?? 'unknown'}`,
    `Native host attached: ${data.nativeHostAttached ? 'yes' : 'no'}`,
    `Active sessions: ${data.transports.total} (streamable-http: ${data.transports.streamableHttp}, sse: ${data.transports.sse})`,
  ];

  if (data.transports.sessionIds.length > 0) {
    lines.push(`Session IDs: ${data.transports.sessionIds.join(', ')}`);
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
    const response = await fetchFn(
      `http://${SERVER_CONFIG.HOST}:${process.env.CHROME_MCP_PORT || NATIVE_SERVER_PORT}/status`,
      {
        method: 'GET',
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      process.stderr.write(`Status failed: HTTP ${response.status}\n`);
      return 1;
    }

    const payload = (await response.json()) as StatusPayload;
    const output = options.json ? JSON.stringify(payload, null, 2) : renderPretty(payload);
    process.stdout.write(output + '\n');
    return 0;
  } catch (error) {
    process.stderr.write(`Status failed: ${stringifyError(error)}\n`);
    return 1;
  } finally {
    clearTimeout(timeout);
  }
}
