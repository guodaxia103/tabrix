#!/usr/bin/env node

import * as fs from 'fs';
import { getChromeMcpUrl } from '../constant';
import { COMMAND_NAME } from './constant';

export const DEFAULT_MCP_TOOLS_TIMEOUT_MS = 15_000;
export const DEFAULT_MCP_CALL_TIMEOUT_MS = 120_000;

export interface McpInspectOptions {
  json?: boolean;
  url?: string;
  authToken?: string;
  timeoutMs?: number;
}

export interface McpCallOptions extends McpInspectOptions {
  args?: string;
  arg?: string[];
  argsFile?: string;
}

type FetchFn = typeof globalThis.fetch;

interface RpcResult {
  raw: Response;
  parsed: any;
}

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
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Request timed out or was aborted';
    return err.message;
  }
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

function buildDefaultHeaders(authToken?: string): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

function parseToolResult(result: any): any {
  const text = result?.content?.find((item: any) => item?.type === 'text')?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseJsonObject(raw: string, source: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`Tool arguments from ${source} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function parseArgPair(raw: string): { key: string; value: unknown } {
  const eqPos = raw.indexOf('=');
  if (eqPos <= 0) {
    throw new Error(`Tool arguments from --arg must use key=value format, got: ${raw}`);
  }

  const key = raw.slice(0, eqPos).trim();
  const valueText = raw.slice(eqPos + 1);
  if (!key || valueText.length === 0) {
    throw new Error(`Tool arguments from --arg must use key=value format, got: ${raw}`);
  }

  try {
    return { key, value: JSON.parse(valueText) };
  } catch {
    return { key, value: valueText };
  }
}

function parseArguments(
  options: {
    args?: string;
    arg?: string[];
    argsFile?: string;
  } = {},
): Record<string, unknown> {
  let merged: Record<string, unknown> = {};

  if (options.argsFile) {
    const fileContent = fs.readFileSync(options.argsFile, 'utf8').trim();
    if (!fileContent) {
      throw new Error(`Tool arguments file is empty: ${options.argsFile}`);
    }
    merged = parseJsonObject(fileContent, `--args-file ${options.argsFile}`);
  }

  if (options.args && options.args.trim() !== '') {
    merged = {
      ...merged,
      ...parseJsonObject(options.args, '--args'),
    };
  }

  for (const rawArg of options.arg ?? []) {
    const parsed = parseArgPair(rawArg);
    merged[parsed.key] = parsed.value;
  }

  return merged;
}

class StreamableHttpMcpClient {
  private sessionId: string | null = null;
  private requestId = 1;

  constructor(
    private readonly baseUrl: string,
    private readonly defaultHeaders: Record<string, string>,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn,
  ) {}

  async initialize(): Promise<void> {
    const response = await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'tabrix-cli-mcp-inspect', version: '1.0.0' },
    });

    const sessionId = response.raw.headers.get('mcp-session-id');
    if (!sessionId) {
      throw new Error('No mcp-session-id returned from initialize');
    }
    this.sessionId = sessionId;
  }

  async notifyInitialized(): Promise<void> {
    await this.rpc('notifications/initialized', {}, { notification: true, allowEmpty: true });
  }

  async listTools(): Promise<any[]> {
    const response = await this.rpc('tools/list', {});
    return Array.isArray(response.parsed?.result?.tools) ? response.parsed.result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const response = await this.rpc('tools/call', {
      name,
      arguments: args,
    });
    return response.parsed?.result;
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.fetchFn(this.baseUrl, {
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

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    options: { notification?: boolean; allowEmpty?: boolean } = {},
  ): Promise<RpcResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timeout.unref === 'function') {
      timeout.unref();
    }

    try {
      const response = await this.fetchFn(this.baseUrl, {
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
      const text = await response.text();
      const parsed = text.trim() ? parseStreamableJson(text) : null;

      if (!response.ok || parsed?.error) {
        throw new Error(
          `MCP ${method} failed: HTTP ${response.status} ${parsed?.error?.message || text.slice(0, 200)}`,
        );
      }

      if (!parsed && !options.allowEmpty) {
        throw new Error(`MCP ${method} returned no payload`);
      }

      return {
        raw: response,
        parsed,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function renderToolsPretty(tools: any[]): string {
  const lines = [`${COMMAND_NAME} mcp tools`, '', `Available tools: ${tools.length}`];

  for (const tool of tools) {
    lines.push(`- ${tool.name}`);
    if (tool.description) {
      lines.push(`  ${tool.description}`);
    }
  }

  return lines.join('\n');
}

function renderCallPretty(toolName: string, args: Record<string, unknown>, payload: any): string {
  const lines = [`${COMMAND_NAME} mcp call ${toolName}`];

  if (Object.keys(args).length > 0) {
    lines.push('');
    lines.push('Arguments');
    lines.push(JSON.stringify(args, null, 2));
  }

  lines.push('');
  lines.push('Result');
  lines.push(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
  return lines.join('\n');
}

export async function runMcpTools(options: McpInspectOptions = {}): Promise<number> {
  const fetchFn = resolveFetch();
  if (!fetchFn) {
    process.stderr.write(
      'MCP tools failed: fetch is not available (requires Node.js >=18 or node-fetch)\n',
    );
    return 1;
  }

  const client = new StreamableHttpMcpClient(
    options.url || getChromeMcpUrl(),
    buildDefaultHeaders(options.authToken),
    options.timeoutMs ?? DEFAULT_MCP_TOOLS_TIMEOUT_MS,
    fetchFn,
  );

  try {
    await client.initialize();
    await client.notifyInitialized();
    const tools = await client.listTools();
    const output = options.json ? JSON.stringify(tools, null, 2) : renderToolsPretty(tools);
    process.stdout.write(output + '\n');
    return 0;
  } catch (error) {
    process.stderr.write(`MCP tools failed: ${stringifyError(error)}\n`);
    process.stderr.write(
      `Hint: verify the runtime with "${COMMAND_NAME} status" and "${COMMAND_NAME} doctor --fix"\n`,
    );
    return 1;
  } finally {
    await client.close();
  }
}

export async function runMcpCall(toolName: string, options: McpCallOptions = {}): Promise<number> {
  const fetchFn = resolveFetch();
  if (!fetchFn) {
    process.stderr.write(
      'MCP call failed: fetch is not available (requires Node.js >=18 or node-fetch)\n',
    );
    return 1;
  }

  let args: Record<string, unknown>;
  try {
    args = parseArguments(options);
  } catch (error) {
    process.stderr.write(`MCP call failed: ${stringifyError(error)}\n`);
    return 1;
  }

  const client = new StreamableHttpMcpClient(
    options.url || getChromeMcpUrl(),
    buildDefaultHeaders(options.authToken),
    options.timeoutMs ?? DEFAULT_MCP_CALL_TIMEOUT_MS,
    fetchFn,
  );

  try {
    await client.initialize();
    await client.notifyInitialized();
    const result = await client.callTool(toolName, args);
    const parsed = parseToolResult(result);

    const output = options.json
      ? JSON.stringify({ toolName, args, raw: result, parsed }, null, 2)
      : renderCallPretty(toolName, args, parsed);
    process.stdout.write(output + '\n');

    return result?.isError ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `MCP call failed after ${options.timeoutMs ?? DEFAULT_MCP_CALL_TIMEOUT_MS}ms: ${stringifyError(error)}\n`,
    );
    process.stderr.write(
      `Hint: verify the runtime with "${COMMAND_NAME} status" and "${COMMAND_NAME} doctor --fix"\n`,
    );
    return 1;
  } finally {
    await client.close();
  }
}
