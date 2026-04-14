#!/usr/bin/env node

const fs = require('fs');

function parseArgs(argv) {
  const args = { prefixes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--config') {
      args.config = argv[index + 1];
      index += 1;
    } else if (part === '--prefix') {
      args.prefixes.push(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function parseStreamableJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return {};
  }

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

function parseToolText(result) {
  const text = result?.content?.find((item) => item?.type === 'text')?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

class StreamableHttpMcpClient {
  constructor(baseUrl, defaultHeaders = {}) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = defaultHeaders;
    this.sessionId = null;
    this.requestId = 1;
  }

  async initialize() {
    const response = await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'tabrix-acceptance-cleanup', version: '1.0.0' },
    });
    const sessionId = response.headers.get('mcp-session-id');
    if (!sessionId) {
      throw new Error('No mcp-session-id returned from initialize');
    }
    this.sessionId = sessionId;
  }

  async notifyInitialized() {
    await this.rpc('notifications/initialized', {}, { notification: true, allowEmpty: true });
  }

  async callTool(name, args = {}) {
    const response = await this.rpc('tools/call', { name, arguments: args });
    return parseStreamableJson(response.text)?.result;
  }

  async close() {
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

  async rpc(method, params, options = {}) {
    const body = options.notification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: this.requestId++, method, params };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        ...this.defaultHeaders,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok && !(options.allowEmpty && response.status === 202)) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    const text = options.allowEmpty ? '' : await response.text();
    return { headers: response.headers, text };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) {
    throw new Error('Missing --config');
  }

  const prefixes = args.prefixes.filter(Boolean);
  if (!prefixes.length) {
    console.log(JSON.stringify({ ok: true, closedTabIds: [], detail: 'No prefixes supplied' }));
    return;
  }

  const config = readJsonFile(args.config);
  const tabrix = config?.mcpServers?.tabrix;
  if (!tabrix?.url) {
    throw new Error('tabrix MCP config missing url');
  }

  const client = new StreamableHttpMcpClient(tabrix.url, tabrix.headers || {});
  try {
    await client.initialize();
    await client.notifyInitialized();
    const windows = parseToolText(await client.callTool('get_windows_and_tabs'));
    const tabIds = (windows?.windows || [])
      .flatMap((window) => window.tabs || [])
      .filter((tab) => prefixes.some((prefix) => String(tab?.url || '').startsWith(prefix)))
      .map((tab) => tab?.tabId)
      .filter((tabId) => typeof tabId === 'number');

    if (tabIds.length) {
      await client.callTool('chrome_close_tabs', { tabIds });
    }

    console.log(JSON.stringify({ ok: true, closedTabIds: tabIds, prefixes }));
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
