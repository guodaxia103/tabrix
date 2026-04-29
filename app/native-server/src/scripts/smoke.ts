#!/usr/bin/env node

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'crypto';
import { getChromeMcpUrl } from '../constant';
import {
  summariseV27RuntimeLogMonitoring,
  type V27RuntimeLogMonitoringSummary,
  type V27RuntimeLogSample,
  type V27RuntimeLogSource,
} from '../runtime/v27-runtime-log-monitoring';
import {
  assessClickOutcome,
  assessKeyboardOutcome,
  assessReadPagePayload,
  assessUploadOutcome,
} from './smoke-assertions';

const COMMAND_CHANNEL_RECOVERY_MODES = ['fail-next-send', 'fail-all-sends', 'unavailable'] as const;
type CommandChannelRecoveryMode = (typeof COMMAND_CHANNEL_RECOVERY_MODES)[number];

function isCommandChannelRecoveryMode(value: unknown): value is CommandChannelRecoveryMode {
  return (
    typeof value === 'string' &&
    COMMAND_CHANNEL_RECOVERY_MODES.includes(value as CommandChannelRecoveryMode)
  );
}

export interface SmokeOptions {
  json?: boolean;
  keepTab?: boolean;
  separateWindow?: boolean;
  url?: string;
  authToken?: string;
  protocolOnly?: boolean;
  allTools?: boolean;
  includeInteractiveTools?: boolean;
  bridgeRecovery?: boolean;
  browserPathUnavailable?: boolean;
  commandChannelRecovery?: CommandChannelRecoveryMode;
  repeat?: number;
  concurrency?: number;
}

interface SmokeStep {
  name: string;
  ok: boolean;
  detail: string;
}

interface SmokeResult {
  ok: boolean;
  baseUrl: string;
  mcpUrl: string;
  mode: 'protocol' | 'local-browser' | 'all-tools';
  steps: SmokeStep[];
  runtimeLogSummary?: V27RuntimeLogMonitoringSummary;
}

function emitSmokeResult(result: SmokeResult, json = false): void {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  process.stdout.write(`tabrix smoke\n\n`);
  process.stdout.write(
    `${result.mode === 'protocol' ? 'MCP endpoint' : 'Local test page'}: ${result.baseUrl}\n`,
  );
  for (const step of result.steps) {
    process.stdout.write(`${step.ok ? '[OK]' : '[FAIL]'} ${step.name}: ${step.detail}\n`);
  }
}

interface HttpProbeResult {
  ok: boolean;
  status?: number;
  detail: string;
}

interface StatusProbeResult extends HttpProbeResult {
  snapshot?: Record<string, unknown>;
}

export interface SmokeRuntimeLogSummaryInput {
  statusSnapshot?: Record<string, unknown>;
  pageConsoleResult?: unknown;
  operationLogStepCount?: number | null;
  operationLogFailureSteps?: number | null;
  unavailableSources?: V27RuntimeLogSource[] | null;
}

interface MpcCallResult {
  raw: any;
  parsed: any | null;
  sessionId?: string | null;
  durationMs?: number;
}

interface ProtocolSmokeSummary {
  ok: boolean;
  steps: SmokeStep[];
  sessionId: string | null;
  toolCount: number;
  latencyMs: number;
}

interface StabilityAttempt {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

const ALL_TOOL_NAMES = [
  'get_windows_and_tabs',
  'performance_start_trace',
  'performance_stop_trace',
  'performance_analyze_insight',
  'chrome_read_page',
  'chrome_computer',
  'chrome_navigate',
  'chrome_screenshot',
  'chrome_close_tabs',
  'chrome_switch_tab',
  'chrome_get_web_content',
  'chrome_network_request',
  'chrome_network_capture',
  'chrome_handle_download',
  'chrome_history',
  'chrome_bookmark_search',
  'chrome_bookmark_add',
  'chrome_bookmark_delete',
  'chrome_get_interactive_elements',
  'chrome_javascript',
  'chrome_click_element',
  'chrome_fill_or_select',
  'chrome_request_element_selection',
  'chrome_keyboard',
  'chrome_console',
  'chrome_upload_file',
  'chrome_handle_dialog',
  'chrome_gif_recorder',
] as const;

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function parseStreamableJson(text: string): any {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  const last = dataLines[dataLines.length - 1];
  if (!last) {
    throw new Error(`No JSON payload found in response: ${trimmed.slice(0, 200)}`);
  }

  return JSON.parse(last);
}

function parseToolText(result: any): any {
  const text = result?.content?.find((item: any) => item?.type === 'text')?.text;
  if (!text) return result;
  const extractStructuredToolError = (value: string): any | null => {
    const marker = 'Error calling tool:';
    const markerIndex = value.indexOf(marker);
    if (markerIndex < 0) return null;

    const start = value.indexOf('{', markerIndex);
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < value.length; i++) {
      const ch = value[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const jsonText = value.slice(start, i + 1);
          try {
            return JSON.parse(jsonText);
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  };

  const parseFallbackJson = (value: string): any | null => {
    try {
      const parsed = JSON.parse(value);
      return parsed;
    } catch {
      return null;
    }
  };
  const parsed = parseFallbackJson(text);
  if (parsed === null) return extractStructuredToolError(text) || text;
  if (typeof parsed === 'string') {
    return extractStructuredToolError(parsed) || parsed;
  }
  return parsed;
}

function createSmokeServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  tempFilePath: string;
}> {
  const tempFilePath = path.join(os.tmpdir(), `tabrix-smoke-${Date.now()}.txt`);
  fs.writeFileSync(tempFilePath, 'phase0 smoke upload');

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Chrome MCP Smoke Test</title>
    <style>
      body { font-family: sans-serif; padding: 24px; }
      .row { margin: 12px 0; }
    </style>
  </head>
  <body>
    <article id="article">
      <h1 id="title">Chrome MCP Smoke Test</h1>
      <p id="articleIntro">
        Chrome MCP Smoke Test verifies that readable main-content extraction stays healthy.
        This article block exists specifically so content extraction tools can detect a stable
        primary reading surface instead of falling back to navigation-only text.
      </p>
      <p>
        The smoke article includes enough plain text to satisfy readability-style extraction,
        while the rest of the page still contains buttons, form controls, downloads, and other
        interactive elements used by the broader browser validation flow.
      </p>
    </article>
    <div class="row">
      <button id="clickBtn" onclick="document.querySelector('#status').textContent='clicked'; console.log('click button triggered')">Click me</button>
      <span id="status">idle</span>
    </div>
    <div class="row">
      <input id="textInput" type="text" value="" />
      <select id="selectInput">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
      <input id="checkInput" type="checkbox" />
    </div>
    <div class="row">
      <button id="fetchBtn" onclick="fetch('/api/data?ts=' + Date.now()).then(r => r.json()).then(d => { document.querySelector('#fetchResult').textContent = d.message; console.log('fetch complete', d.message); });">Fetch data</button>
      <span id="fetchResult">none</span>
    </div>
    <div class="row">
          <button id="promptBtn" onclick="document.querySelector('#dialogResult').textContent = 'pending'; setTimeout(() => { const value = prompt('Enter value', 'default'); document.querySelector('#dialogResult').textContent = value || ''; console.log('dialog resolved', value); }, 50);">Prompt</button>
      <span id="dialogResult"></span>
    </div>
    <div class="row">
      <input id="fileInput" type="file" onchange="document.querySelector('#fileName').textContent = this.files[0]?.name || ''" />
      <span id="fileName"></span>
    </div>
    <div class="row">
      <a id="nextLink" href="/page2">Go to page 2</a>
      <a id="downloadLink" href="/download.txt" download="smoke-download.txt">Download text</a>
    </div>
  </body>
</html>`;

  const page2 = `<!doctype html><html><head><title>Smoke Page 2</title></head><body><h1 id="page2">Smoke Page 2</h1></body></html>`;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end('missing url');
        return;
      }

      if (req.url.startsWith('/api/data')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: 'network-ok' }));
        return;
      }

      if (req.url === '/page2') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(page2);
        return;
      }

      if (req.url === '/download.txt') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="smoke-download.txt"');
        res.end('download-ok');
        return;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine smoke server address'));
        return;
      }

      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        tempFilePath,
      });
    });

    server.on('error', reject);
  });
}

class StreamableHttpMcpClient {
  private sessionId: string | null = null;
  private requestId = 1;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(baseUrl: string, defaultHeaders: Record<string, string> = {}) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = defaultHeaders;
  }

  public async initialize(): Promise<void> {
    const response = await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'tabrix-smoke', version: '1.0.0' },
    });

    const sessionId = response.raw.headers.get('mcp-session-id');
    if (!sessionId) {
      throw new Error('No mcp-session-id returned from initialize');
    }
    this.sessionId = sessionId;
  }

  public async notifyInitialized(): Promise<void> {
    await this.rpc('notifications/initialized', {}, { notification: true, allowEmpty: true });
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(this.baseUrl, {
        method: 'DELETE',
        headers: {
          ...this.defaultHeaders,
          'mcp-session-id': this.sessionId,
        },
      });
    } finally {
      this.sessionId = null;
    }
  }

  public async listTools(): Promise<string[]> {
    const response = await this.rpc('tools/list', {});
    return response.parsed?.result?.tools?.map((tool: any) => tool.name) || [];
  }

  public async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const response = await this.rpc('tools/call', {
      name,
      arguments: args,
    });
    return response.parsed?.result;
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    options: { notification?: boolean; allowEmpty?: boolean } = {},
  ): Promise<MpcCallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    const startedAt = Date.now();
    try {
      res = await fetch(this.baseUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          ...this.defaultHeaders,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          ...(options.notification ? {} : { id: this.requestId++ }),
          method,
          params,
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = text.trim() ? parseStreamableJson(text) : null;

    if (!res.ok || parsed?.error) {
      throw new Error(
        `MCP ${method} failed: HTTP ${res.status} ${parsed?.error?.message || text.slice(0, 200)}`,
      );
    }

    if (!parsed && !options.allowEmpty) {
      throw new Error(`MCP ${method} returned no payload`);
    }

    return {
      raw: res,
      parsed,
      sessionId: res.headers.get('mcp-session-id'),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a condition until it returns a truthy value or timeout is reached.
 * Much more reliable than fixed sleep() for browser-side state changes.
 */
async function poll<T>(
  fn: () => Promise<T>,
  predicate: (val: T) => boolean,
  { interval = 200, timeout = 5000 }: { interval?: number; timeout?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T;
  do {
    last = await fn();
    if (predicate(last)) return last;
    if (Date.now() >= deadline) break;
    await sleep(interval);
  } while (Date.now() < deadline);
  return last;
}

function buildCompanionUrl(mcpUrl: string, endpoint: 'ping' | 'status'): string {
  const url = new URL(mcpUrl);
  if (url.pathname.endsWith('/mcp')) {
    url.pathname = `${url.pathname.slice(0, -4)}/${endpoint}`.replace(/\/{2,}/g, '/');
  } else {
    url.pathname = `/${endpoint}`;
  }
  return url.toString();
}

function buildDefaultMcpUrl(): string {
  return getChromeMcpUrl();
}

function buildAuthHeaders(token?: string): Record<string, string> {
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

async function probe(url: string, headers: Record<string, string> = {}): Promise<HttpProbeResult> {
  try {
    const response = await fetch(url, { headers });
    return {
      ok: response.ok,
      status: response.status,
      detail: `${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      detail: stringifyError(error),
    };
  }
}

function getBridgeSnapshot(
  snapshot?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return snapshot && typeof snapshot.bridge === 'object' && snapshot.bridge !== null
    ? (snapshot.bridge as Record<string, unknown>)
    : undefined;
}

function isBridgeReady(snapshot?: Record<string, unknown>): boolean {
  const bridge = getBridgeSnapshot(snapshot);
  if (!bridge) return false;
  const bridgeState = typeof bridge.bridgeState === 'string' ? bridge.bridgeState : 'unknown';
  return bridgeState === 'READY';
}

export function buildSmokeRuntimeLogSummary(
  input: SmokeRuntimeLogSummaryInput,
): V27RuntimeLogMonitoringSummary {
  const samples = extractConsoleSamples(input.pageConsoleResult);
  const unavailableSources = new Set<V27RuntimeLogSource>(input.unavailableSources ?? []);
  if (input.pageConsoleResult == null) unavailableSources.add('page_console');
  if (!input.statusSnapshot) unavailableSources.add('bridge_status');
  return summariseV27RuntimeLogMonitoring({
    runtimeLogMonitoringEnabled: true,
    nativeErrorCountDelta: 0,
    extensionErrorCountDelta: 0,
    pageConsoleErrorCountDelta: samples.filter((sample) => sample.level === 'error').length,
    bridgeReady: isBridgeReady(input.statusSnapshot),
    nativeMessageDisconnectCount: 0,
    debuggerAttachErrorCount: 0,
    debuggerDetachErrorCount: 0,
    unhandledPromiseRejectionCount: 0,
    logSourceUnavailable: Array.from(unavailableSources),
    samples,
    operationLogStepCount: input.operationLogStepCount,
    operationLogFailureSteps: input.operationLogFailureSteps,
  });
}

function extractConsoleSamples(value: unknown): V27RuntimeLogSample[] {
  const samples: V27RuntimeLogSample[] = [];
  collectConsoleSamples(value, samples);
  return samples;
}

function collectConsoleSamples(value: unknown, samples: V27RuntimeLogSample[]): void {
  if (samples.length >= 100 || value == null) return;
  if (typeof value === 'string') {
    if (value.trim()) {
      samples.push({ source: 'page_console', level: inferLogLevel(value), message: value });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConsoleSamples(item, samples);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const message =
    typeof record.message === 'string'
      ? record.message
      : typeof record.text === 'string'
        ? record.text
        : null;
  if (message) {
    samples.push({
      source: 'page_console',
      level: normalizeLogLevel(record.level),
      message,
    });
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key !== 'message' && key !== 'text' && key !== 'level')
      collectConsoleSamples(nested, samples);
  }
}

function normalizeLogLevel(value: unknown): V27RuntimeLogSample['level'] {
  if (value === 'error' || value === 'warning' || value === 'info' || value === 'debug')
    return value;
  return typeof value === 'string' ? inferLogLevel(value) : 'info';
}

function inferLogLevel(message: string): V27RuntimeLogSample['level'] {
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('exception')) return 'error';
  if (lower.includes('warn')) return 'warning';
  if (lower.includes('debug')) return 'debug';
  return 'info';
}

function buildSmokeResult(input: {
  ok: boolean;
  baseUrl: string;
  mcpUrl: string;
  mode: SmokeResult['mode'];
  steps: SmokeStep[];
  runtimeLogSummary?: V27RuntimeLogMonitoringSummary;
}): SmokeResult {
  return {
    ok: input.ok && (input.runtimeLogSummary ? input.runtimeLogSummary.status === 'pass' : true),
    baseUrl: input.baseUrl,
    mcpUrl: input.mcpUrl,
    mode: input.mode,
    steps: input.steps,
    ...(input.runtimeLogSummary ? { runtimeLogSummary: input.runtimeLogSummary } : {}),
  };
}
function describeBridgeFromStatus(snapshot?: Record<string, unknown>): string {
  const bridge = getBridgeSnapshot(snapshot);
  const bridgeState = typeof bridge?.bridgeState === 'string' ? bridge.bridgeState : 'unknown';
  const nativeAttached =
    typeof bridge?.nativeHostAttached === 'boolean' ? bridge.nativeHostAttached : undefined;
  const commandChannelConnected =
    typeof bridge?.commandChannelConnected === 'boolean'
      ? bridge.commandChannelConnected
      : undefined;
  const commandChannelType =
    typeof bridge?.commandChannelType === 'string' ? bridge.commandChannelType : undefined;
  const activeConnectionId =
    typeof bridge?.activeConnectionId === 'string' ? bridge.activeConnectionId : undefined;

  return [
    `bridge=${bridgeState}`,
    typeof nativeAttached === 'boolean' ? `nativeHostAttached=${nativeAttached}` : null,
    typeof commandChannelConnected === 'boolean'
      ? `commandChannelConnected=${commandChannelConnected}`
      : null,
    commandChannelConnected && commandChannelType
      ? `commandChannelType=${commandChannelType}`
      : null,
    commandChannelConnected && activeConnectionId ? `connectionId=${activeConnectionId}` : null,
  ]
    .filter(Boolean)
    .join('; ');
}

async function probeStatus(
  url: string,
  headers: Record<string, string> = {},
): Promise<StatusProbeResult> {
  try {
    const response = await fetch(url, { headers });
    const json = response.ok ? await response.json() : null;
    const snapshot =
      json && typeof json === 'object' && json.data && typeof json.data === 'object'
        ? (json.data as Record<string, unknown>)
        : undefined;
    return {
      ok: response.ok,
      status: response.status,
      detail: `${response.status} ${response.statusText}`.trim(),
      snapshot,
    };
  } catch (error) {
    return {
      ok: false,
      detail: stringifyError(error),
    };
  }
}

function hasSingleRecoveryAction(result: any): boolean {
  if (!result || typeof result !== 'object') return false;
  if (typeof result.nextAction !== 'string' || result.nextAction.trim().length === 0) {
    return false;
  }
  if (Array.isArray(result.suggestions) && result.suggestions.length > 1) {
    return false;
  }
  return true;
}

function terminateLocalBrowserProcesses(): { ok: boolean; detail: string } {
  const currentPlatform = platform();
  const attempts: Array<{ command: string; args: string[] }> =
    currentPlatform === 'win32'
      ? [
          { command: 'taskkill', args: ['/F', '/T', '/IM', 'chrome.exe'] },
          { command: 'taskkill', args: ['/F', '/T', '/IM', 'chromium.exe'] },
          { command: 'taskkill', args: ['/F', '/T', '/IM', 'msedge.exe'] },
        ]
      : currentPlatform === 'darwin'
        ? [
            { command: 'pkill', args: ['-x', 'Google Chrome'] },
            { command: 'pkill', args: ['-x', 'Chromium'] },
          ]
        : [
            { command: 'pkill', args: ['-x', 'chrome'] },
            { command: 'pkill', args: ['-x', 'google-chrome'] },
            { command: 'pkill', args: ['-x', 'google-chrome-stable'] },
            { command: 'pkill', args: ['-x', 'chromium'] },
            { command: 'pkill', args: ['-x', 'chromium-browser'] },
          ];

  const details = [];
  let hadAttempt = false;
  for (const attempt of attempts) {
    try {
      const result = spawnSync(attempt.command, attempt.args, {
        stdio: 'ignore',
        windowsHide: true,
      });
      hadAttempt = true;
      if (result.status === 0) {
        details.push(`${attempt.command} stopped`);
      } else if (result.error) {
        details.push(`${attempt.command} failed: ${result.error.message}`);
      } else {
        details.push(`${attempt.command} skipped`);
      }
    } catch (error) {
      details.push(`${attempt.command} error: ${String(error)}`);
    }
  }

  if (!hadAttempt) {
    return { ok: false, detail: 'No browser termination command is configured for this platform.' };
  }
  return { ok: true, detail: details.join('; ') };
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<HttpProbeResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      detail: `${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      detail: stringifyError(error),
    };
  }
}

async function setCommandChannelTestingMode(
  mcpUrl: string,
  mode: 'normal' | 'fail-next-send' | 'fail-all-sends' | 'unavailable',
): Promise<HttpProbeResult> {
  return await postJson(`${new URL('/bridge/testing/command-channel', mcpUrl)}`, { mode });
}

async function setBrowserLaunchOverride(
  mcpUrl: string,
  commands: string[] | null,
): Promise<HttpProbeResult> {
  return await postJson(`${new URL('/bridge/testing/browser-launch-override', mcpUrl)}`, {
    commands,
  });
}

async function runProtocolSequence(
  mcpUrl: string,
  authToken?: string,
): Promise<ProtocolSmokeSummary> {
  const steps: SmokeStep[] = [];
  const defaultHeaders = buildAuthHeaders(authToken);
  const pingUrl = buildCompanionUrl(mcpUrl, 'ping');
  const statusUrl = buildCompanionUrl(mcpUrl, 'status');
  const mcp = new StreamableHttpMcpClient(mcpUrl, defaultHeaders);
  const startedAt = Date.now();
  let sessionId: string | null = null;
  let toolCount = 0;

  const record = (name: string, ok: boolean, detail: string): void => {
    steps.push({ name, ok, detail });
  };

  try {
    const ping = await probe(pingUrl);
    record('runtime.ping', ping.ok, ping.ok ? `Bridge reachable (${ping.detail})` : ping.detail);
    if (!ping.ok) throw new Error(`Ping failed: ${ping.detail}`);

    const status = await probeStatus(statusUrl);
    record(
      'runtime.status',
      status.ok,
      status.ok
        ? `Status endpoint reachable (${status.detail}); ${describeBridgeFromStatus(status.snapshot)}`
        : status.detail,
    );
    if (!status.ok) throw new Error(`Status failed: ${status.detail}`);

    await mcp.initialize();
    sessionId = mcp.getSessionId();
    record('initialize', true, `Created MCP session ${sessionId}`);

    await mcp.notifyInitialized();
    record('notifications/initialized', true, 'Initialization notification accepted');

    const tools = await mcp.listTools();
    toolCount = tools.length;
    record(
      'tools/list',
      toolCount > 0 && tools.includes('get_windows_and_tabs'),
      `${toolCount} tools available`,
    );
    if (!tools.includes('get_windows_and_tabs')) {
      throw new Error('get_windows_and_tabs not found in tools/list');
    }

    const windows = parseToolText(await mcp.callTool('get_windows_and_tabs'));
    const summary =
      typeof windows === 'string'
        ? windows
        : JSON.stringify({
            windowCount: windows?.windowCount,
            tabCount: windows?.tabCount,
            activeTabTitle: windows?.activeTabTitle,
          });
    record(
      'tools/call:get_windows_and_tabs',
      String(summary).includes('windowCount') || Boolean(windows?.windowCount),
      `Browser control ready (${summary.slice(0, 160)})`,
    );

    return {
      ok: steps.every((step) => step.ok),
      steps,
      sessionId,
      toolCount,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    await mcp.close().catch(() => {
      // Ignore cleanup failures in smoke runs.
    });
  }
}

async function runProtocolStability(
  mcpUrl: string,
  authToken: string | undefined,
  repeat: number,
  concurrency: number,
): Promise<{ steps: SmokeStep[]; ok: boolean }> {
  const attempts: StabilityAttempt[] = [];
  const steps: SmokeStep[] = [];

  for (let offset = 0; offset < repeat; offset += concurrency) {
    const size = Math.min(concurrency, repeat - offset);
    const batch = await Promise.all(
      Array.from({ length: size }, async () => {
        try {
          const result = await runProtocolSequence(mcpUrl, authToken);
          return { ok: result.ok, latencyMs: result.latencyMs } satisfies StabilityAttempt;
        } catch (error) {
          return {
            ok: false,
            latencyMs: 0,
            error: stringifyError(error),
          } satisfies StabilityAttempt;
        }
      }),
    );
    attempts.push(...batch);
  }

  const successes = attempts.filter((attempt) => attempt.ok);
  const failures = attempts.filter((attempt) => !attempt.ok);
  const latencies = successes.map((attempt) => attempt.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number): number | null =>
    latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]
      : null;
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;

  steps.push({
    name: 'stability.summary',
    ok: failures.length === 0,
    detail: `${successes.length}/${attempts.length} attempts passed; concurrency ${concurrency}; avg ${avgLatency ?? 'n/a'}ms; p90 ${percentile(0.9) ?? 'n/a'}ms`,
  });

  failures.slice(0, 5).forEach((failure, index) => {
    steps.push({
      name: `stability.failure.${index + 1}`,
      ok: false,
      detail: failure.error || 'Unknown failure',
    });
  });

  return {
    steps,
    ok: failures.length === 0,
  };
}

async function locateTabIdByUrl(
  mcp: StreamableHttpMcpClient,
  prefixUrl: string,
): Promise<number | null> {
  const snap = parseToolText(await mcp.callTool('get_windows_and_tabs'));
  return (
    snap?.windows
      ?.flatMap((window: any) => window.tabs || [])
      .find((tab: any) => String(tab?.url || '').startsWith(prefixUrl))?.tabId || null
  );
}

async function runAllToolsValidation(
  mcp: StreamableHttpMcpClient,
  smokeServer: { baseUrl: string; tempFilePath: string },
  record: (name: string, ok: boolean, detail: string) => void,
  currentTabId: number | null,
  includeInteractiveTools: boolean,
): Promise<number | null> {
  const tools = await mcp.listTools();
  const toolNames = new Set(tools);
  const missing = ALL_TOOL_NAMES.filter((name) => !toolNames.has(name));
  record(
    'tools.coverage',
    missing.length === 0,
    missing.length === 0
      ? `All ${ALL_TOOL_NAMES.length} expected tools are registered`
      : `Missing tools: ${missing.join(', ')}`,
  );

  if (currentTabId == null) {
    throw new Error('Cannot run --all-tools validation without a resolved smoke tab');
  }

  const tabId = currentTabId;
  await mcp.callTool('chrome_switch_tab', { tabId });

  const interactive = parseToolText(
    await mcp.callTool('chrome_get_interactive_elements', {
      tabId,
      includeCoordinates: true,
    }),
  );
  record(
    'chrome_get_interactive_elements',
    JSON.stringify(interactive).length > 20,
    'Interactive element tree fetched',
  );

  await mcp.callTool('chrome_network_capture', {
    action: 'start',
    tabId,
    includeStatic: false,
    maxCaptureTime: 15000,
    inactivityTimeout: 3000,
  });
  await mcp.callTool('chrome_click_element', {
    tabId,
    selector: '#fetchBtn',
  });
  await sleep(1000);
  const captured = parseToolText(
    await mcp.callTool('chrome_network_capture', {
      action: 'stop',
      tabId,
    }),
  );
  record(
    'chrome_network_capture',
    JSON.stringify(captured).includes('/api/data'),
    'Network capture observed smoke fetch request',
  );

  const directRequest = parseToolText(
    await mcp.callTool('chrome_network_request', {
      tabId,
      url: `${smokeServer.baseUrl}/api/data`,
      method: 'GET',
    }),
  );
  record(
    'chrome_network_request',
    JSON.stringify(directRequest).includes('network-ok'),
    'Direct network request returned expected payload',
  );

  const allToolsUploadCall = await mcp.callTool('chrome_upload_file', {
    tabId,
    selector: '#fileInput',
    filePath: smokeServer.tempFilePath,
  });
  const allToolsExpectedUpload = path.basename(smokeServer.tempFilePath);
  const uploaded = await poll(
    async () =>
      parseToolText(
        await mcp.callTool('chrome_javascript', {
          tabId,
          code: "return document.querySelector('#fileName').textContent;",
        }),
      ),
    (value) => String(value?.result ?? value).includes(allToolsExpectedUpload),
    { timeout: 4000 },
  );
  const allToolsUploadAssessment = assessUploadOutcome(allToolsUploadCall, uploaded, {
    expectedFileName: allToolsExpectedUpload,
  });
  record(
    'chrome_upload_file',
    allToolsUploadAssessment.ok,
    `${allToolsUploadAssessment.reason}: ${allToolsUploadAssessment.detail}`,
  );

  if (includeInteractiveTools) {
    await mcp.callTool('chrome_click_element', {
      tabId,
      selector: '#promptBtn',
    });
    await sleep(200);
    const dialogCall = await mcp.callTool('chrome_handle_dialog', {
      action: 'accept',
      promptText: 'smoke-dialog-ok',
      tabId,
    });
    const dialogHandled = parseToolText(dialogCall);
    const dialogOk =
      dialogCall?.isError !== true && !String(dialogHandled).toLowerCase().includes('failed');
    record(
      'chrome_handle_dialog',
      dialogOk,
      dialogOk
        ? `Dialog accept command executed (${JSON.stringify(dialogHandled).slice(0, 48)})`
        : `Dialog handle failed (${String(dialogHandled).slice(0, 96)})`,
    );
    await sleep(120);
    await mcp
      .callTool('chrome_handle_dialog', {
        action: 'dismiss',
        tabId,
      })
      .catch(() => {
        // No dialog open is expected in most runs.
      });

    const downloadCall = await mcp.callTool('chrome_handle_download', {
      url: `${smokeServer.baseUrl}/download.txt`,
      filename: `smoke-download-${Date.now()}.txt`,
      waitForComplete: true,
      timeoutMs: 20000,
    });
    const downloadResult = parseToolText(downloadCall);
    const downloadOk =
      downloadCall?.isError !== true &&
      JSON.stringify(downloadResult).toLowerCase().includes('download');
    record(
      'chrome_handle_download',
      downloadOk,
      downloadOk
        ? 'Silent download capture confirmed'
        : `Silent download failed (${JSON.stringify(downloadResult).slice(0, 96)})`,
    );
  } else {
    record(
      'chrome_handle_dialog',
      true,
      'Skipped in non-interactive mode (avoids browser modal blocking)',
    );
    const downloadCall = await mcp.callTool('chrome_handle_download', {
      url: `${smokeServer.baseUrl}/download.txt`,
      filename: `smoke-download-${Date.now()}.txt`,
      waitForComplete: true,
      timeoutMs: 20000,
    });
    const downloadResult = parseToolText(downloadCall);
    const downloadOk =
      downloadCall?.isError !== true &&
      JSON.stringify(downloadResult).toLowerCase().includes('download');
    record(
      'chrome_handle_download',
      downloadOk,
      downloadOk
        ? 'Silent download capture confirmed (non-interactive mode)'
        : `Silent download failed (${JSON.stringify(downloadResult).slice(0, 96)})`,
    );
  }

  record('chrome_request_element_selection', true, 'Skipped (manual user interaction required)');

  const perfInsight = parseToolText(
    await mcp.callTool('performance_analyze_insight', {
      tabId,
      timeoutMs: 20000,
    }),
  );
  record(
    'performance_analyze_insight',
    JSON.stringify(perfInsight).length > 2,
    'Performance insight analyzed',
  );

  return tabId;
}

export async function runSmoke(options: SmokeOptions = {}): Promise<number> {
  const steps: SmokeStep[] = [];
  const mcpUrl = options.url || buildDefaultMcpUrl();
  const debugSmoke = process.env.DEBUG_TABRIX_SMOKE === '1';
  const protocolOnly =
    Boolean(options.protocolOnly) || Boolean(options.url) || Boolean(options.authToken);
  const repeat = Math.max(1, options.repeat || 1);
  const concurrency = Math.max(1, options.concurrency || 1);
  const smokeServer = protocolOnly ? null : await createSmokeServer();
  const mcp = new StreamableHttpMcpClient(mcpUrl, buildAuthHeaders(options.authToken));
  let tempTabId: number | null = null;
  let originalTabId: number | null = null;
  let originalWindowId: number | null = null;
  let latestStatusSnapshot: Record<string, unknown> | undefined;
  let pageConsoleResult: unknown;
  const mode: SmokeResult['mode'] = options.allTools
    ? 'all-tools'
    : protocolOnly
      ? 'protocol'
      : 'local-browser';

  const record = (name: string, ok: boolean, detail: string): void => {
    steps.push({ name, ok, detail });
  };
  const traceStep = (label: string): void => {
    if (!debugSmoke) return;
    process.stderr.write(`[smoke] ${label}\n`);
  };

  try {
    if (options.allTools && protocolOnly) {
      throw new Error(
        '--all-tools requires local smoke mode. Remove --url/--auth-token/--protocol-only and retry.',
      );
    }
    if (options.bridgeRecovery && protocolOnly) {
      throw new Error('--bridge-recovery requires local smoke mode.');
    }
    if (options.browserPathUnavailable && protocolOnly) {
      throw new Error('--browser-path-unavailable requires local smoke mode.');
    }
    if (options.commandChannelRecovery && protocolOnly) {
      throw new Error('--command-channel-recovery requires local smoke mode.');
    }
    if (
      options.commandChannelRecovery &&
      !isCommandChannelRecoveryMode(options.commandChannelRecovery)
    ) {
      throw new Error(
        `Unsupported value for --command-channel-recovery: ${options.commandChannelRecovery}.` +
          ` Supported values: ${COMMAND_CHANNEL_RECOVERY_MODES.join(' | ')}`,
      );
    }

    if (repeat > 1 || concurrency > 1) {
      const stability = await runProtocolStability(mcpUrl, options.authToken, repeat, concurrency);
      steps.push(...stability.steps);
      const result: SmokeResult = {
        ok: stability.ok,
        baseUrl: mcpUrl,
        mcpUrl,
        mode: 'protocol',
        steps,
      };

      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(`tabrix smoke\n\n`);
        process.stdout.write(`MCP endpoint: ${mcpUrl}\n`);
        for (const step of steps) {
          process.stdout.write(`${step.ok ? '[OK]' : '[FAIL]'} ${step.name}: ${step.detail}\n`);
        }
      }

      return result.ok ? 0 : 1;
    }

    if (protocolOnly) {
      const protocol = await runProtocolSequence(mcpUrl, options.authToken);
      steps.push(...protocol.steps);

      const result: SmokeResult = {
        ok: protocol.ok,
        baseUrl: mcpUrl,
        mcpUrl,
        mode: 'protocol',
        steps,
      };

      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(`tabrix smoke\n\n`);
        process.stdout.write(`MCP endpoint: ${mcpUrl}\n`);
        for (const step of steps) {
          process.stdout.write(`${step.ok ? '[OK]' : '[FAIL]'} ${step.name}: ${step.detail}\n`);
        }
      }

      return result.ok ? 0 : 1;
    }

    const defaultHeaders = buildAuthHeaders(options.authToken);
    const pingUrl = buildCompanionUrl(mcpUrl, 'ping');
    const statusUrl = buildCompanionUrl(mcpUrl, 'status');
    const ping = await probe(pingUrl, defaultHeaders);
    record('runtime.ping', ping.ok, ping.ok ? `Bridge reachable (${ping.detail})` : ping.detail);
    if (!ping.ok) throw new Error(`Ping failed: ${ping.detail}`);

    const status = await probeStatus(statusUrl, defaultHeaders);
    latestStatusSnapshot = status.snapshot;
    record(
      'runtime.status',
      status.ok,
      status.ok
        ? `Status endpoint reachable (${status.detail}); ${describeBridgeFromStatus(status.snapshot)}`
        : status.detail,
    );
    if (!status.ok) throw new Error(`Status failed: ${status.detail}`);

    await mcp.initialize();
    record('initialize', true, `Created MCP session ${mcp.getSessionId()}`);
    await mcp.notifyInitialized();
    record('notifications/initialized', true, 'Initialization notification accepted');
    const listedTools = await mcp.listTools();
    record(
      'tools/list',
      listedTools.length > 0 && listedTools.includes('get_windows_and_tabs'),
      `${listedTools.length} tools available`,
    );

    if (options.browserPathUnavailable) {
      const unavailableCommand =
        platform() === 'win32'
          ? 'C:\\__tabrix_missing_browser__\\chrome.exe'
          : '/__tabrix_missing_browser__/chrome';
      const browserStopped = terminateLocalBrowserProcesses();
      record(
        'browser_path_unavailable.stop_browser',
        browserStopped.ok,
        browserStopped.ok ? browserStopped.detail : browserStopped.detail,
      );
      const overrideSet = await setBrowserLaunchOverride(mcpUrl, [unavailableCommand]);
      record(
        'browser_path_unavailable.override_set',
        overrideSet.ok,
        overrideSet.ok
          ? `Injected unavailable browser launch candidate ${unavailableCommand}`
          : overrideSet.detail,
      );
      if (!overrideSet.ok) {
        throw new Error(`Failed to inject browser launch override: ${overrideSet.detail}`);
      }

      const unavailableResult = await mcp.callTool('chrome_navigate', {
        url: smokeServer!.baseUrl,
      });
      const unavailableParsed = parseToolText(unavailableResult);
      const returnedSingleAction =
        unavailableResult?.isError === true && hasSingleRecoveryAction(unavailableParsed);
      record(
        'browser_path_unavailable.tool_call',
        returnedSingleAction &&
          unavailableParsed?.code === 'TABRIX_BROWSER_NOT_RUNNING' &&
          unavailableParsed?.recoveryAttempted === true,
        returnedSingleAction
          ? `Returned ${unavailableParsed.code} with next action: ${unavailableParsed.nextAction}`
          : `Unexpected result: ${JSON.stringify(unavailableParsed).slice(0, 160)}`,
      );

      const overrideCleared = await setBrowserLaunchOverride(mcpUrl, null);
      record(
        'browser_path_unavailable.override_clear',
        overrideCleared.ok,
        overrideCleared.ok ? 'Cleared unavailable browser launch override' : overrideCleared.detail,
      );
      if (!overrideCleared.ok) {
        throw new Error(`Failed to clear browser launch override: ${overrideCleared.detail}`);
      }

      const result = buildSmokeResult({
        ok: steps.every((step) => step.ok),
        baseUrl: smokeServer?.baseUrl || mcpUrl,
        mcpUrl,
        mode,
        steps,
        runtimeLogSummary: buildSmokeRuntimeLogSummary({
          statusSnapshot: latestStatusSnapshot,
          unavailableSources: ['extension_service_worker', 'chrome_extensions', 'operation_log'],
        }),
      });
      emitSmokeResult(result, options.json);
      return result.ok ? 0 : 1;
    }

    const windows = parseToolText(await mcp.callTool('get_windows_and_tabs'));
    const originalActiveTab = windows?.windows
      ?.flatMap((window: any) =>
        (window.tabs || []).map((tab: any) => ({
          windowId: window.windowId,
          ...tab,
        })),
      )
      .find((tab: any) => tab.active);
    originalTabId = originalActiveTab?.tabId || null;
    originalWindowId = originalActiveTab?.windowId || null;
    record(
      'get_windows_and_tabs',
      Array.isArray(windows?.windows),
      originalTabId
        ? `Original active tab: ${originalTabId}`
        : 'Window/tab snapshot loaded; original active tab unavailable',
    );

    const navigateResult = parseToolText(
      await mcp.callTool('chrome_navigate', {
        url: smokeServer!.baseUrl,
        newWindow: options.separateWindow === true,
        windowId: options.separateWindow === true ? undefined : (originalWindowId ?? undefined),
      }),
    );
    tempTabId =
      navigateResult?.tabId ||
      navigateResult?.tabs?.[0]?.tabId ||
      navigateResult?.tabs?.find((tab: any) =>
        String(tab?.url || '').startsWith(smokeServer!.baseUrl),
      )?.tabId ||
      null;

    if (!tempTabId) {
      const findTab = async () => locateTabIdByUrl(mcp, smokeServer!.baseUrl);
      tempTabId = await poll(findTab, (id) => id != null, { timeout: 8000 });
    }
    record(
      'chrome_navigate',
      Boolean(tempTabId),
      `Smoke tab: ${tempTabId}; mode: ${navigateResult?.message || 'unknown'}`,
    );

    if (!tempTabId) {
      throw new Error('Could not locate smoke test tab after navigation');
    }

    await mcp.callTool('chrome_switch_tab', { tabId: tempTabId });
    record('chrome_switch_tab', true, `Switched to tab ${tempTabId}`);

    if (options.commandChannelRecovery) {
      const commandModeSet = await setCommandChannelTestingMode(
        mcpUrl,
        options.commandChannelRecovery,
      );
      record(
        'command_channel_recovery.inject_mode',
        commandModeSet.ok,
        commandModeSet.ok
          ? `Set command channel recovery mode to ${options.commandChannelRecovery}`
          : commandModeSet.detail,
      );
      if (!commandModeSet.ok) {
        throw new Error(`Failed to inject command-channel recovery mode: ${commandModeSet.detail}`);
      }

      const commandRecoveryRead = await mcp.callTool('chrome_read_page', { tabId: tempTabId });
      const commandRecoveryParsed = parseToolText(commandRecoveryRead);
      const commandRecoveryAssessment =
        commandRecoveryRead?.isError === true
          ? null
          : assessReadPagePayload(commandRecoveryParsed, {
              expectedUrlPrefix: smokeServer!.baseUrl,
            });
      const commandRecoverySucceeded = commandRecoveryAssessment?.ok === true;
      const commandRecoveryReturnedAction =
        commandRecoveryRead?.isError === true && hasSingleRecoveryAction(commandRecoveryParsed);
      const expectRecoverySuccess = options.commandChannelRecovery === 'fail-next-send';
      record(
        'command_channel_recovery.tool_call',
        expectRecoverySuccess ? commandRecoverySucceeded : commandRecoveryReturnedAction,
        expectRecoverySuccess
          ? commandRecoverySucceeded
            ? 'Command channel recovered transiently and original request succeeded'
            : `Unexpected command-channel recovery result: ${JSON.stringify(commandRecoveryParsed).slice(0, 160)}`
          : commandRecoveryReturnedAction
            ? `Recovery returned a single next action: ${commandRecoveryParsed.nextAction}`
            : `Unexpected command-channel recovery result: ${JSON.stringify(commandRecoveryParsed).slice(0, 160)}`,
      );

      if (!options.keepTab) {
        traceStep('chrome_close_tabs(command-channel):start');
        await mcp.callTool('chrome_close_tabs', {
          tabIds: [tempTabId],
        });
        record('chrome_close_tabs', true, `Closed smoke tab ${tempTabId}`);
        tempTabId = null;
      }

      if (originalTabId) {
        traceStep('chrome_switch_tab(original-command-channel):start');
        await mcp.callTool('chrome_switch_tab', { tabId: originalTabId });
      }

      const result = buildSmokeResult({
        ok: steps.every((step) => step.ok),
        baseUrl: smokeServer?.baseUrl || mcpUrl,
        mcpUrl,
        mode,
        steps,
        runtimeLogSummary: buildSmokeRuntimeLogSummary({
          statusSnapshot: latestStatusSnapshot,
          unavailableSources: ['extension_service_worker', 'chrome_extensions', 'operation_log'],
        }),
      });
      emitSmokeResult(result, options.json);
      return result.ok ? 0 : 1;
    }

    if (options.bridgeRecovery) {
      const recoveryStart = await postJson(`${new URL('/bridge/recovery/start', mcpUrl)}`, {
        action: 'smoke_injected_bridge_failure',
      });
      record(
        'bridge_recovery.inject_start',
        recoveryStart.ok,
        recoveryStart.ok ? 'Injected recovery start state' : recoveryStart.detail,
      );
      if (!recoveryStart.ok) {
        throw new Error(`Failed to inject bridge recovery start: ${recoveryStart.detail}`);
      }

      const recoveryFinish = await postJson(`${new URL('/bridge/recovery/finish', mcpUrl)}`, {
        success: false,
        errorCode: 'TABRIX_SMOKE_INJECTED_RECOVERY',
        errorMessage: 'smoke injected bridge failure',
      });
      record(
        'bridge_recovery.inject_finish',
        recoveryFinish.ok,
        recoveryFinish.ok ? 'Injected broken bridge state' : recoveryFinish.detail,
      );
      if (!recoveryFinish.ok) {
        throw new Error(`Failed to inject bridge recovery finish: ${recoveryFinish.detail}`);
      }

      const recoveryStatus = await probeStatus(buildCompanionUrl(mcpUrl, 'status'), defaultHeaders);
      latestStatusSnapshot = recoveryStatus.snapshot;
      const recoveryBridge =
        recoveryStatus.snapshot &&
        typeof recoveryStatus.snapshot.bridge === 'object' &&
        recoveryStatus.snapshot.bridge !== null
          ? (recoveryStatus.snapshot.bridge as Record<string, unknown>)
          : undefined;
      const injectedState =
        typeof recoveryBridge?.bridgeState === 'string' ? recoveryBridge.bridgeState : 'unknown';
      record(
        'bridge_recovery.inject_status',
        recoveryStatus.ok && (injectedState === 'BRIDGE_BROKEN' || injectedState === 'READY'),
        recoveryStatus.ok
          ? `Injected bridge state observed as ${injectedState}`
          : `Status probe failed: ${recoveryStatus.detail}`,
      );

      const recoveryRead = await mcp.callTool('chrome_read_page', { tabId: tempTabId });
      const recoveryParsed = parseToolText(recoveryRead);
      const recoveryAssessment =
        recoveryRead?.isError === true
          ? null
          : assessReadPagePayload(recoveryParsed, { expectedUrlPrefix: smokeServer!.baseUrl });
      const recoverySucceeded = recoveryAssessment?.ok === true;
      const recoveryReturnedAction =
        recoveryRead?.isError === true && hasSingleRecoveryAction(recoveryParsed);
      record(
        'bridge_recovery.tool_call',
        recoverySucceeded || recoveryReturnedAction,
        recoverySucceeded
          ? 'Injected bridge fault auto-recovered and original browser request succeeded'
          : recoveryReturnedAction
            ? `Recovery returned a single next action: ${recoveryParsed.nextAction}`
            : `Unexpected recovery result: ${JSON.stringify(recoveryParsed).slice(0, 160)}`,
      );

      if (!options.keepTab) {
        traceStep('chrome_close_tabs(recovery):start');
        await mcp.callTool('chrome_close_tabs', {
          tabIds: [tempTabId],
        });
        record('chrome_close_tabs', true, `Closed smoke tab ${tempTabId}`);
        tempTabId = null;
      }

      if (originalTabId) {
        traceStep('chrome_switch_tab(original-recovery):start');
        await mcp.callTool('chrome_switch_tab', { tabId: originalTabId });
      }

      const result = buildSmokeResult({
        ok: steps.every((step) => step.ok),
        baseUrl: smokeServer?.baseUrl || mcpUrl,
        mcpUrl,
        mode,
        steps,
        runtimeLogSummary: buildSmokeRuntimeLogSummary({
          statusSnapshot: latestStatusSnapshot,
          unavailableSources: ['extension_service_worker', 'chrome_extensions', 'operation_log'],
        }),
      });
      emitSmokeResult(result, options.json);
      return result.ok ? 0 : 1;
    }

    const pageCall = await mcp.callTool('chrome_read_page', { tabId: tempTabId });
    const page = parseToolText(pageCall);
    const readPageAssessment =
      pageCall?.isError === true
        ? {
            ok: false,
            reason: 'tool_returned_error' as const,
            detail: `chrome_read_page returned isError=true (${String(page).slice(0, 120)})`,
          }
        : assessReadPagePayload(page, { expectedUrlPrefix: smokeServer!.baseUrl });
    record(
      'chrome_read_page',
      readPageAssessment.ok,
      `${readPageAssessment.reason}: ${readPageAssessment.detail}`,
    );

    const content = parseToolText(
      await mcp.callTool('chrome_get_web_content', {
        tabId: tempTabId,
        textContent: true,
        htmlContent: false,
        selector: '#article',
      }),
    );
    const contentText = String(content?.textContent || content?.content || content);
    record(
      'chrome_get_web_content',
      Boolean(content?.success) && contentText.includes('Chrome MCP Smoke Test'),
      `Extracted text content from smoke page (${contentText.slice(0, 80)})`,
    );

    await mcp.callTool('chrome_fill_or_select', {
      tabId: tempTabId,
      selector: '#textInput',
      value: 'phase0',
    });
    await mcp.callTool('chrome_fill_or_select', {
      tabId: tempTabId,
      selector: '#selectInput',
      value: 'b',
    });
    await mcp.callTool('chrome_fill_or_select', {
      tabId: tempTabId,
      selector: '#checkInput',
      value: true,
    });
    record('chrome_fill_or_select', true, 'Filled text/select/checkbox inputs');

    const keyboardCall = await mcp.callTool('chrome_keyboard', {
      tabId: tempTabId,
      selector: '#textInput',
      keys: 'X',
      delay: 30,
    });
    // Poll the readback so a slow input event does not look like an
    // assertion failure. We require BOTH the prefilled `phase0` value
    // (proves chrome_fill_or_select did not regress) AND the typed `X`
    // (proves chrome_keyboard actually fired) so the keyboard assertion
    // cannot be silently satisfied by the leftover fill alone. We also
    // capture the LAST raw chrome_javascript call so the assessor can
    // distinguish a real keyboard regression from a readback failure
    // (e.g. chrome_javascript blocked by P3 policy).
    let keyboardReadbackCall: Awaited<ReturnType<typeof mcp.callTool>> | null = null;
    const textValue = await poll(
      async () => {
        keyboardReadbackCall = await mcp.callTool('chrome_javascript', {
          tabId: tempTabId,
          code: "return document.querySelector('#textInput').value;",
        });
        return parseToolText(keyboardReadbackCall);
      },
      (v) => {
        const s = String(v?.result ?? v);
        return s.includes('phase0') && s.includes('X');
      },
      { timeout: 4000 },
    );
    const keyboardAssessment = assessKeyboardOutcome(keyboardCall, textValue, {
      expectedExistingValue: 'phase0',
      expectedTypedSequence: 'X',
      observationCall: keyboardReadbackCall,
    });
    record(
      'chrome_keyboard',
      keyboardAssessment.ok,
      `${keyboardAssessment.reason}: ${keyboardAssessment.detail}`,
    );

    const clickCall = await mcp.callTool('chrome_click_element', {
      tabId: tempTabId,
      selector: '#clickBtn',
    });
    let clickReadbackCall: Awaited<ReturnType<typeof mcp.callTool>> | null = null;
    const clickedState = await poll(
      async () => {
        clickReadbackCall = await mcp.callTool('chrome_javascript', {
          tabId: tempTabId,
          code: "return document.querySelector('#status').textContent;",
        });
        return parseToolText(clickReadbackCall);
      },
      (v) => String(v?.result ?? v).includes('clicked'),
      { timeout: 4000 },
    );
    const clickAssessment = assessClickOutcome(clickCall, clickedState, {
      expectedStateSubstring: 'clicked',
      preClickIdleValue: 'idle',
      observationCall: clickReadbackCall,
    });
    record(
      'chrome_click_element',
      clickAssessment.ok,
      `${clickAssessment.reason}: ${clickAssessment.detail}`,
    );

    await mcp.callTool('chrome_network_capture', {
      action: 'start',
      tabId: tempTabId,
      includeStatic: false,
      maxCaptureTime: 15000,
      inactivityTimeout: 3000,
    });
    await mcp.callTool('chrome_click_element', {
      tabId: tempTabId,
      selector: '#fetchBtn',
    });
    await sleep(800);
    const networkResult = parseToolText(
      await mcp.callTool('chrome_network_capture', {
        action: 'stop',
        tabId: tempTabId,
      }),
    );
    record(
      'chrome_network_capture',
      JSON.stringify(networkResult).includes('/api/data'),
      'Captured local fetch request',
    );

    const directRequest = parseToolText(
      await mcp.callTool('chrome_network_request', {
        url: `${smokeServer!.baseUrl}/api/data`,
        method: 'GET',
      }),
    );
    record(
      'chrome_network_request',
      JSON.stringify(directRequest).includes('network-ok'),
      'Sent direct network request',
    );

    const screenshot = parseToolText(
      await mcp.callTool('chrome_screenshot', {
        tabId: tempTabId,
        fullPage: false,
        width: 1280,
        height: 800,
        storeBase64: true,
        savePng: false,
      }),
    );
    record(
      'chrome_screenshot',
      JSON.stringify(screenshot).length > 0,
      'Captured screenshot successfully',
    );

    const computerShot = parseToolText(
      await mcp.callTool('chrome_computer', {
        tabId: tempTabId,
        action: 'screenshot',
      }),
    );
    record(
      'chrome_computer',
      JSON.stringify(computerShot).length > 0,
      'chrome_computer screenshot action succeeded',
    );

    const consoleLogs = parseToolText(
      await mcp.callTool('chrome_console', {
        tabId: tempTabId,
        mode: 'buffer',
        clearAfterRead: true,
      }),
    );
    pageConsoleResult = consoleLogs;
    record(
      'chrome_console',
      JSON.stringify(consoleLogs).includes('click button triggered'),
      'Captured console buffer output',
    );

    traceStep('chrome_upload_file:start');
    const uploadCall = await mcp.callTool('chrome_upload_file', {
      tabId: tempTabId,
      selector: '#fileInput',
      filePath: smokeServer!.tempFilePath,
    });
    const expectedUploadName = path.basename(smokeServer!.tempFilePath);
    const uploaded = await poll(
      async () =>
        parseToolText(
          await mcp.callTool('chrome_javascript', {
            tabId: tempTabId,
            code: "return document.querySelector('#fileName').textContent;",
          }),
        ),
      (v) => String(v?.result ?? v).includes(expectedUploadName),
      { timeout: 4000 },
    );
    const uploadAssessment = assessUploadOutcome(uploadCall, uploaded, {
      expectedFileName: expectedUploadName,
    });
    record(
      'chrome_upload_file',
      uploadAssessment.ok,
      `${uploadAssessment.reason}: ${uploadAssessment.detail}`,
    );

    traceStep('chrome_click_element(download-intercept):start');
    const clickDownload = parseToolText(
      await mcp.callTool('chrome_click_element', {
        tabId: tempTabId,
        selector: '#downloadLink',
      }),
    );
    const clickDownloadOk =
      clickDownload?.clickMethod === 'intercepted-download' &&
      Boolean(clickDownload?.download?.savedPath);
    record(
      'chrome_click_element(download-intercept)',
      clickDownloadOk,
      clickDownloadOk
        ? `Intercepted page download into ${clickDownload.download.savedPath}`
        : `Download intercept failed (${JSON.stringify(clickDownload).slice(0, 120)})`,
    );

    record('chrome_handle_dialog', true, 'Skipped in default smoke run');

    traceStep('chrome_bookmark_add:start');
    await mcp.callTool('chrome_bookmark_add', {
      url: smokeServer!.baseUrl,
      title: 'Phase0 Smoke Bookmark',
      parentId: 'Bookmarks Bar',
      createFolder: false,
    });
    const bookmarkSearch = parseToolText(
      await mcp.callTool('chrome_bookmark_search', {
        query: 'Phase0 Smoke Bookmark',
        maxResults: 10,
      }),
    );
    record(
      'chrome_bookmark_add/search',
      JSON.stringify(bookmarkSearch).includes('Phase0 Smoke Bookmark'),
      'Added and found temporary bookmark',
    );

    traceStep('chrome_bookmark_delete:start');
    await mcp.callTool('chrome_bookmark_delete', {
      url: smokeServer!.baseUrl,
      title: 'Phase0 Smoke Bookmark',
    });
    record('chrome_bookmark_delete', true, 'Deleted temporary bookmark');

    const historyResult = parseToolText(
      await mcp.callTool('chrome_history', {
        text: 'Chrome MCP Smoke Test',
        maxResults: 10,
      }),
    );
    record('chrome_history', JSON.stringify(historyResult).length > 0, 'History query succeeded');

    traceStep('chrome_gif_recorder(status):start');
    const gifStatus = parseToolText(
      await mcp.callTool('chrome_gif_recorder', {
        action: 'status',
        tabId: tempTabId,
      }),
    );
    record(
      'chrome_gif_recorder',
      JSON.stringify(gifStatus).length > 0,
      'Queried GIF recorder status',
    );

    traceStep('performance_start_trace:start');
    await mcp.callTool('performance_start_trace', {
      reload: false,
      autoStop: true,
      durationMs: 1200,
    });
    await sleep(2000);
    traceStep('performance_stop_trace:start');
    const perfStop = parseToolText(
      await mcp.callTool('performance_stop_trace', {
        saveToDownloads: false,
      }),
    );
    record(
      'performance_trace',
      JSON.stringify(perfStop).length > 0,
      'Started and stopped performance trace',
    );

    if (options.allTools) {
      traceStep('all-tools-validation:start');
      tempTabId = await runAllToolsValidation(
        mcp,
        smokeServer!,
        record,
        tempTabId,
        options.includeInteractiveTools === true,
      );
    }

    if (!options.keepTab) {
      traceStep('chrome_close_tabs:start');
      await mcp.callTool('chrome_close_tabs', {
        tabIds: [tempTabId],
      });
      record('chrome_close_tabs', true, `Closed smoke tab ${tempTabId}`);
      tempTabId = null;
    }

    if (originalTabId) {
      traceStep('chrome_switch_tab(original):start');
      await mcp.callTool('chrome_switch_tab', { tabId: originalTabId });
    }
  } catch (error) {
    const detail = stringifyError(error);
    record(
      'fatal',
      false,
      detail === 'Bridge runtime is not reachable'
        ? 'The local MCP server is down. Open the extension popup, click Connect, then rerun smoke.'
        : detail,
    );
  } finally {
    traceStep('cleanup:start');
    if (options.browserPathUnavailable) {
      try {
        await setBrowserLaunchOverride(mcpUrl, null);
      } catch {
        // Ignore cleanup failures.
      }
    }
    if (options.commandChannelRecovery) {
      try {
        await setCommandChannelTestingMode(mcpUrl, 'normal');
      } catch {
        // Ignore cleanup failures.
      }
    }
    if (!options.keepTab && tempTabId) {
      try {
        await mcp.callTool('chrome_close_tabs', { tabIds: [tempTabId] });
      } catch {
        // Ignore cleanup failures.
      }
    }
    try {
      await mcp.close();
    } catch {
      // Ignore cleanup failures.
    }
    if (smokeServer) {
      smokeServer.server.close();
      if (fs.existsSync(smokeServer.tempFilePath)) {
        fs.rmSync(smokeServer.tempFilePath, { force: true });
      }
    }
  }

  const result = buildSmokeResult({
    ok: steps.every((step) => step.ok),
    baseUrl: smokeServer?.baseUrl || mcpUrl,
    mcpUrl,
    mode,
    steps,
    runtimeLogSummary: buildSmokeRuntimeLogSummary({
      statusSnapshot: latestStatusSnapshot,
      pageConsoleResult,
      unavailableSources: ['extension_service_worker', 'chrome_extensions', 'operation_log'],
    }),
  });

  emitSmokeResult(result, options.json);

  return result.ok ? 0 : 1;
}

function platform(): NodeJS.Platform {
  return process.platform;
}
