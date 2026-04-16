#!/usr/bin/env node

import { getChromeMcpPort, getChromeMcpUrl, SERVER_CONFIG } from '../constant';
import { COMMAND_NAME } from './constant';

export interface ConfigOptions {
  json?: boolean;
  timeoutMs?: number;
}

interface RuntimeStatusPayload {
  status: string;
  data: {
    isRunning: boolean;
    host: string;
    port: number | null;
    networkAddresses?: string[];
    authEnabled?: boolean;
  };
}

interface AuthTokenPayload {
  status: string;
  data: {
    token: string;
    createdAt: number;
    expiresAt: number | null;
    fromEnv: boolean;
    ttlDays: number | null;
  } | null;
}

interface ConfigView {
  runtime: {
    running: boolean;
    host: string;
    port: number;
    remoteEnabled: boolean;
    networkAddresses: string[];
  };
  streamableHttp: {
    local: {
      type: 'streamableHttp';
      url: string;
    };
    remote: {
      type: 'streamableHttp';
      url: string;
      headers: {
        Authorization: string;
      };
    } | null;
  };
  stdio: {
    command: 'tabrix-stdio';
  };
  auth: {
    token: string;
    authorizationHeader: string;
    createdAt: number;
    expiresAt: number | null;
    fromEnv: boolean;
    ttlDays: number | null;
  } | null;
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

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

function normalizeNetworkAddresses(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

async function fetchJson<T>(
  fetchFn: FetchFn,
  url: string,
  timeoutMs: number,
): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    return { ok: true, body: (await response.json()) as T };
  } catch (error) {
    return { ok: false, error: stringifyError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function buildConfigView(
  statusPayload: RuntimeStatusPayload | null,
  tokenPayload: AuthTokenPayload['data'] | null,
): ConfigView {
  const fallbackHost = SERVER_CONFIG.HOST;
  const host = statusPayload?.data.host || fallbackHost;
  const port = statusPayload?.data.port ?? getChromeMcpPort();
  const networkAddresses = normalizeNetworkAddresses(statusPayload?.data.networkAddresses);
  const remoteEnabled = isWildcardHost(host);
  const localUrl = getChromeMcpUrl();
  const remoteUrl =
    remoteEnabled && networkAddresses.length > 0
      ? `http://${networkAddresses[0]}:${port}/mcp`
      : remoteEnabled
        ? `http://<LAN_IP>:${port}/mcp`
        : null;
  const auth =
    tokenPayload && typeof tokenPayload.token === 'string'
      ? {
          token: tokenPayload.token,
          authorizationHeader: `Bearer ${tokenPayload.token}`,
          createdAt: tokenPayload.createdAt,
          expiresAt: tokenPayload.expiresAt,
          fromEnv: tokenPayload.fromEnv,
          ttlDays: tokenPayload.ttlDays,
        }
      : null;

  return {
    runtime: {
      running: statusPayload?.data.isRunning === true,
      host,
      port,
      remoteEnabled,
      networkAddresses,
    },
    streamableHttp: {
      local: {
        type: 'streamableHttp',
        url: localUrl,
      },
      remote:
        remoteUrl && auth
          ? {
              type: 'streamableHttp',
              url: remoteUrl,
              headers: {
                Authorization: auth.authorizationHeader,
              },
            }
          : null,
    },
    stdio: {
      command: 'tabrix-stdio',
    },
    auth,
  };
}

function renderPretty(view: ConfigView): string {
  const lines = [
    `${COMMAND_NAME} config`,
    '',
    `Running: ${view.runtime.running ? 'yes' : 'no'}`,
    `Host: ${view.runtime.host}`,
    `Port: ${view.runtime.port}`,
    `Remote access: ${view.runtime.remoteEnabled ? 'enabled' : 'disabled'}`,
  ];

  if (view.runtime.networkAddresses.length > 0) {
    lines.push(`LAN IPs: ${view.runtime.networkAddresses.join(', ')}`);
  }

  lines.push('');
  lines.push('Streamable HTTP (local)');
  lines.push(`  type: ${view.streamableHttp.local.type}`);
  lines.push(`  url: ${view.streamableHttp.local.url}`);

  lines.push('');
  lines.push('Streamable HTTP (remote)');
  if (view.streamableHttp.remote) {
    lines.push(`  type: ${view.streamableHttp.remote.type}`);
    lines.push(`  url: ${view.streamableHttp.remote.url}`);
    lines.push(`  Authorization: ${view.streamableHttp.remote.headers.Authorization}`);
  } else if (view.runtime.remoteEnabled) {
    lines.push('  unavailable: no LAN IP or token detected');
  } else {
    lines.push('  disabled: service is in local-only mode');
  }

  lines.push('');
  lines.push('stdio');
  lines.push(`  command: ${view.stdio.command}`);

  if (view.auth) {
    lines.push('');
    lines.push('Auth Token');
    lines.push(`  token: ${view.auth.token}`);
    lines.push(`  Authorization: ${view.auth.authorizationHeader}`);
    lines.push(`  source: ${view.auth.fromEnv ? 'environment' : 'persisted'}`);
    lines.push(`  createdAt: ${new Date(view.auth.createdAt).toLocaleString()}`);
    lines.push(
      `  expiresAt: ${view.auth.expiresAt === null ? 'never' : new Date(view.auth.expiresAt).toLocaleString()}`,
    );
    lines.push(`  ttlDays: ${view.auth.ttlDays ?? 'unknown'}`);
  }

  return lines.join('\n');
}

export async function runConfig(options: ConfigOptions = {}): Promise<number> {
  const fetchFn = resolveFetch();
  if (!fetchFn) {
    process.stderr.write(
      'Config failed: fetch is not available (requires Node.js >=18 or node-fetch)\n',
    );
    return 1;
  }

  const timeoutMs = options.timeoutMs ?? 1500;
  const requestHost =
    SERVER_CONFIG.HOST === '0.0.0.0' || SERVER_CONFIG.HOST === '::'
      ? '127.0.0.1'
      : SERVER_CONFIG.HOST;
  const baseUrl = `http://${requestHost}:${getChromeMcpPort()}`;

  const [statusResponse, tokenResponse] = await Promise.all([
    fetchJson<RuntimeStatusPayload>(fetchFn, `${baseUrl}/status`, timeoutMs),
    fetchJson<AuthTokenPayload>(fetchFn, `${baseUrl}/auth/token`, timeoutMs),
  ]);

  const statusPayload = statusResponse.ok ? statusResponse.body : null;
  const tokenPayload = tokenResponse.ok ? tokenResponse.body.data : null;
  const view = buildConfigView(statusPayload, tokenPayload);

  const output = options.json ? JSON.stringify(view, null, 2) : renderPretty(view);
  process.stdout.write(output + '\n');

  if (!statusResponse.ok) {
    process.stderr.write(
      `Config note: runtime status unavailable (${statusResponse.error}). Some fields may be fallback values.\n`,
    );
  }

  return 0;
}
