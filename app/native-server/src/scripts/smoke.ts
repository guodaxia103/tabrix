#!/usr/bin/env node

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { getChromeMcpUrl } from '../constant';

export interface SmokeOptions {
  json?: boolean;
  keepTab?: boolean;
  url?: string;
  authToken?: string;
  protocolOnly?: boolean;
  allTools?: boolean;
  includeInteractiveTools?: boolean;
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
}

interface HttpProbeResult {
  ok: boolean;
  status?: number;
  detail: string;
}

interface StatusProbeResult extends HttpProbeResult {
  snapshot?: Record<string, unknown>;
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
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
          <button id="promptBtn" onclick="document.querySelector('#dialogResult').textContent = 'pending'; setTimeout(() => { const value = prompt('Enter value', 'default'); document.querySelector('#dialogResult').textContent = value || ''; console.log('dialog resolved', value); }, 1000);">Prompt</button>
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

function describeBridgeFromStatus(snapshot?: Record<string, unknown>): string {
  const bridge =
    snapshot && typeof snapshot.bridge === 'object' && snapshot.bridge !== null
      ? (snapshot.bridge as Record<string, unknown>)
      : undefined;
  const bridgeState = typeof bridge?.bridgeState === 'string' ? bridge.bridgeState : 'unknown';
  const nativeAttached =
    typeof bridge?.nativeHostAttached === 'boolean' ? bridge.nativeHostAttached : undefined;
  return `bridge=${bridgeState}${typeof nativeAttached === 'boolean' ? `; nativeHostAttached=${nativeAttached}` : ''}`;
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

  await mcp.callTool('chrome_upload_file', {
    tabId,
    selector: '#fileInput',
    filePath: smokeServer.tempFilePath,
  });
  const uploaded = await poll(
    async () =>
      parseToolText(
        await mcp.callTool('chrome_javascript', {
          tabId,
          code: "return document.querySelector('#fileName').textContent;",
        }),
      ),
    (value) => String(value?.result ?? value).includes(path.basename(smokeServer.tempFilePath)),
    { timeout: 4000 },
  );
  record(
    'chrome_upload_file',
    String(uploaded?.result ?? uploaded).includes(path.basename(smokeServer.tempFilePath)),
    'Local file upload succeeded',
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

    const windows = parseToolText(await mcp.callTool('get_windows_and_tabs'));
    originalTabId =
      windows?.windows?.flatMap((window: any) => window.tabs || []).find((tab: any) => tab.active)
        ?.tabId || null;
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
        newWindow: true,
        width: 1280,
        height: 900,
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

    const page = parseToolText(await mcp.callTool('chrome_read_page', { tabId: tempTabId }));
    record(
      'chrome_read_page',
      String(page?.pageContent || '').includes('Chrome MCP Smoke Test'),
      'Read page content from smoke page',
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

    await mcp.callTool('chrome_keyboard', {
      tabId: tempTabId,
      selector: '#textInput',
      keys: 'X',
      delay: 30,
    });
    const textValue = parseToolText(
      await mcp.callTool('chrome_javascript', {
        tabId: tempTabId,
        code: "return document.querySelector('#textInput').value;",
      }),
    );
    record(
      'chrome_keyboard',
      String(textValue?.result ?? textValue).includes('phase0'),
      'Keyboard input executed on text input',
    );

    await mcp.callTool('chrome_click_element', {
      tabId: tempTabId,
      selector: '#clickBtn',
    });
    const clickedState = await poll(
      async () =>
        parseToolText(
          await mcp.callTool('chrome_javascript', {
            tabId: tempTabId,
            code: "return document.querySelector('#status').textContent;",
          }),
        ),
      (v) => String(v?.result ?? v).includes('clicked'),
      { timeout: 4000 },
    );
    record(
      'chrome_click_element',
      String(clickedState?.result ?? clickedState).includes('clicked'),
      'Button click changed page state',
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
    record(
      'chrome_console',
      JSON.stringify(consoleLogs).includes('click button triggered'),
      'Captured console buffer output',
    );

    traceStep('chrome_upload_file:start');
    await mcp.callTool('chrome_upload_file', {
      tabId: tempTabId,
      selector: '#fileInput',
      filePath: smokeServer!.tempFilePath,
    });
    const uploaded = await poll(
      async () =>
        parseToolText(
          await mcp.callTool('chrome_javascript', {
            tabId: tempTabId,
            code: "return document.querySelector('#fileName').textContent;",
          }),
        ),
      (v) => String(v?.result ?? v).includes(path.basename(smokeServer!.tempFilePath)),
      { timeout: 4000 },
    );
    record(
      'chrome_upload_file',
      String(uploaded?.result ?? uploaded).includes(path.basename(smokeServer!.tempFilePath)),
      'Uploaded local temp file',
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

  const result: SmokeResult = {
    ok: steps.every((step) => step.ok),
    baseUrl: smokeServer?.baseUrl || mcpUrl,
    mcpUrl,
    mode,
    steps,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`tabrix smoke\n\n`);
    process.stdout.write(
      `${result.mode === 'protocol' ? 'MCP endpoint' : 'Local test page'}: ${result.baseUrl}\n`,
    );
    for (const step of steps) {
      process.stdout.write(`${step.ok ? '[OK]' : '[FAIL]'} ${step.name}: ${step.detail}\n`);
    }
  }

  return result.ok ? 0 : 1;
}
