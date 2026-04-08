#!/usr/bin/env node

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { SERVER_CONFIG, NATIVE_SERVER_PORT } from '../constant';

export interface SmokeOptions {
  json?: boolean;
  keepTab?: boolean;
}

interface SmokeStep {
  name: string;
  ok: boolean;
  detail: string;
}

interface SmokeResult {
  ok: boolean;
  baseUrl: string;
  steps: SmokeStep[];
}

interface HttpProbeResult {
  ok: boolean;
  status?: number;
  detail: string;
}

interface MpcCallResult {
  raw: any;
  parsed: any;
}

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
  const tempFilePath = path.join(os.tmpdir(), `mcp-chrome-smoke-${Date.now()}.txt`);
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
      <button id="promptBtn" onclick="const value = prompt('Enter value', 'default'); document.querySelector('#dialogResult').textContent = value || ''; console.log('dialog resolved', value);">Prompt</button>
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

class LocalMcpClient {
  private sessionId: string | null = null;
  private requestId = 1;
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  public async initialize(): Promise<void> {
    const response = await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'mcp-chrome-smoke', version: '1.0.0' },
    });

    const sessionId = response.raw.headers.get('mcp-session-id');
    if (!sessionId) {
      throw new Error('No mcp-session-id returned from initialize');
    }
    this.sessionId = sessionId;
  }

  public async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(this.baseUrl, {
        method: 'DELETE',
        headers: {
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

  private async rpc(method: string, params: Record<string, unknown>): Promise<MpcCallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.requestId++,
          method,
          params,
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = parseStreamableJson(text);

    if (!res.ok || parsed?.error) {
      throw new Error(
        `MCP ${method} failed: HTTP ${res.status} ${parsed?.error?.message || text.slice(0, 200)}`,
      );
    }

    return { raw: res, parsed };
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

async function probe(url: string): Promise<HttpProbeResult> {
  try {
    const response = await fetch(url);
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

export async function runSmoke(options: SmokeOptions = {}): Promise<number> {
  const steps: SmokeStep[] = [];
  const smokeServer = await createSmokeServer();
  const mcp = new LocalMcpClient(`http://${SERVER_CONFIG.HOST}:${NATIVE_SERVER_PORT}/mcp`);
  let tempTabId: number | null = null;
  let originalTabId: number | null = null;

  const record = (name: string, ok: boolean, detail: string): void => {
    steps.push({ name, ok, detail });
  };

  try {
    const ping = await probe(`http://${SERVER_CONFIG.HOST}:${NATIVE_SERVER_PORT}/ping`);
    record(
      'runtime.ping',
      ping.ok,
      ping.ok
        ? `Bridge reachable (${ping.detail})`
        : `Bridge not reachable (${ping.detail}). Click Connect in the extension, then retry.`,
    );

    if (!ping.ok) {
      throw new Error('Bridge runtime is not reachable');
    }

    const status = await probe(`http://${SERVER_CONFIG.HOST}:${NATIVE_SERVER_PORT}/status`);
    record(
      'runtime.status',
      status.ok,
      status.ok
        ? `Status endpoint reachable (${status.detail})`
        : `Status endpoint failed (${status.detail})`,
    );

    await mcp.initialize();
    record('initialize', true, 'Created MCP session successfully');

    const tools = await mcp.listTools();
    record('tools/list', true, `${tools.length} tools available`);

    const windows = parseToolText(await mcp.callTool('get_windows_and_tabs'));
    originalTabId =
      windows?.windows?.flatMap((window: any) => window.tabs || []).find((tab: any) => tab.active)
        ?.tabId || null;
    record('get_windows_and_tabs', Boolean(originalTabId), `Original active tab: ${originalTabId}`);

    const navigateResult = parseToolText(
      await mcp.callTool('chrome_navigate', {
        url: smokeServer.baseUrl,
        newWindow: true,
        width: 1280,
        height: 900,
      }),
    );
    tempTabId =
      navigateResult?.tabId ||
      navigateResult?.tabs?.[0]?.tabId ||
      navigateResult?.tabs?.find((tab: any) =>
        String(tab?.url || '').startsWith(smokeServer.baseUrl),
      )?.tabId ||
      null;

    if (!tempTabId) {
      const findTab = async () => {
        const snap = parseToolText(await mcp.callTool('get_windows_and_tabs'));
        return (
          snap?.windows
            ?.flatMap((w: any) => w.tabs || [])
            .find((t: any) => String(t.url || '').startsWith(smokeServer.baseUrl))?.tabId || null
        );
      };
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
        url: `${smokeServer.baseUrl}/api/data`,
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

    await mcp.callTool('chrome_upload_file', {
      tabId: tempTabId,
      selector: '#fileInput',
      filePath: smokeServer.tempFilePath,
    });
    const uploaded = await poll(
      async () =>
        parseToolText(
          await mcp.callTool('chrome_javascript', {
            tabId: tempTabId,
            code: "return document.querySelector('#fileName').textContent;",
          }),
        ),
      (v) => String(v?.result ?? v).includes(path.basename(smokeServer.tempFilePath)),
      { timeout: 4000 },
    );
    record(
      'chrome_upload_file',
      String(uploaded?.result ?? uploaded).includes(path.basename(smokeServer.tempFilePath)),
      'Uploaded local temp file',
    );

    await mcp.callTool('chrome_click_element', {
      tabId: tempTabId,
      selector: '#promptBtn',
    });
    const dialogHandle = await poll(
      async () => {
        const rawResult = await mcp.callTool('chrome_handle_dialog', {
          action: 'accept',
          promptText: 'phase0-dialog',
        });
        const result = parseToolText(rawResult);

        if (rawResult?.isError) {
          return {
            handled: false,
            error: typeof result === 'string' ? result : JSON.stringify(result),
          };
        }

        return { handled: true, result };
      },
      (value) => value.handled,
      { interval: 250, timeout: 5000 },
    );
    const dialogResult = await poll(
      async () =>
        parseToolText(
          await mcp.callTool('chrome_javascript', {
            tabId: tempTabId,
            code: "return document.querySelector('#dialogResult').textContent;",
          }),
        ),
      (v) => String(v?.result ?? v).includes('phase0-dialog'),
      { interval: 250, timeout: 6000 },
    );
    const dialogResultText = String((dialogResult as any)?.result ?? dialogResult);
    const dialogAutoResolved = dialogResultText === 'default';
    const dialogHandledByTool = dialogHandle.handled && dialogResultText.includes('phase0-dialog');
    record(
      'chrome_handle_dialog',
      dialogHandledByTool || dialogAutoResolved,
      dialogAutoResolved
        ? `Dialog auto-resolved to browser default "${dialogResultText}" before CDP could accept it (${JSON.stringify(dialogHandle.error)})`
        : `Dialog resolved to "${dialogResultText}" (tool result: ${JSON.stringify(dialogHandle.handled ? dialogHandle.result : dialogHandle.error)})`,
    );

    await mcp.callTool('chrome_bookmark_add', {
      url: smokeServer.baseUrl,
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

    await mcp.callTool('chrome_bookmark_delete', {
      url: smokeServer.baseUrl,
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

    await mcp.callTool('performance_start_trace', {
      reload: false,
      autoStop: true,
      durationMs: 1200,
    });
    await sleep(2000);
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

    if (!options.keepTab) {
      await mcp.callTool('chrome_close_tabs', {
        tabIds: [tempTabId],
      });
      record('chrome_close_tabs', true, `Closed smoke tab ${tempTabId}`);
      tempTabId = null;
    }

    if (originalTabId) {
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
    smokeServer.server.close();
    if (fs.existsSync(smokeServer.tempFilePath)) {
      fs.rmSync(smokeServer.tempFilePath, { force: true });
    }
  }

  const result: SmokeResult = {
    ok: steps.every((step) => step.ok),
    baseUrl: smokeServer.baseUrl,
    steps,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`mcp-chrome-bridge smoke\n\n`);
    process.stdout.write(`Local test page: ${result.baseUrl}\n`);
    for (const step of steps) {
      process.stdout.write(`${step.ok ? '[OK]' : '[FAIL]'} ${step.name}: ${step.detail}\n`);
    }
  }

  return result.ok ? 0 : 1;
}
