import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { runMcpCall, runMcpTools } from './mcp-inspect';
import { NATIVE_SERVER_PORT } from '../constant';
import fs from 'fs';
import os from 'os';
import path from 'path';

type FetchMock = typeof globalThis.fetch;

function createResponse({
  status = 200,
  headers,
  body = '',
}: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => body,
  };
}

describe('mcp inspect script', () => {
  const originalFetch = globalThis.fetch;
  const originalPort = process.env.CHROME_MCP_PORT;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;
  let tempFiles: string[] = [];

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.CHROME_MCP_PORT = String(NATIVE_SERVER_PORT);
    tempFiles = [];
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    for (const file of tempFiles) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true, recursive: true });
      }
    }
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: FetchMock }).fetch;
    }
    if (originalPort === undefined) {
      delete process.env.CHROME_MCP_PORT;
    } else {
      process.env.CHROME_MCP_PORT = originalPort;
    }
  });

  test('lists tools for a remote GitHub troubleshooting workflow', async () => {
    const remoteUrl = 'http://192.168.1.50:12306/mcp';
    const authToken = 'tabrix-test-token';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          headers: { 'mcp-session-id': 'session-1' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-03-26' },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ body: '' }))
      .mockResolvedValueOnce(
        createResponse({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [
                { name: 'get_windows_and_tabs', description: 'List current tabs' },
                { name: 'chrome_read_page', description: 'Read current page' },
                { name: 'chrome_get_web_content', description: 'Get page text content' },
                { name: 'chrome_console', description: 'Read console logs' },
              ],
            },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ status: 204 }));
    globalThis.fetch = fetchMock as unknown as FetchMock;

    const code = await runMcpTools({
      url: remoteUrl,
      authToken,
    });

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('Available tools: 4');
    expect(output).toContain('get_windows_and_tabs');
    expect(output).toContain('chrome_read_page');
    expect(output).toContain('chrome_get_web_content');
    expect(output).toContain('chrome_console');
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const initializeCall = (fetchMock as unknown as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const deleteCall = (fetchMock as unknown as jest.Mock).mock.calls[3] as [string, RequestInit];
    expect(initializeCall[0]).toBe(remoteUrl);
    expect(initializeCall[1].headers).toMatchObject({
      Authorization: `Bearer ${authToken}`,
    });
    expect(deleteCall[1].headers).toMatchObject({
      Authorization: `Bearer ${authToken}`,
      'mcp-session-id': 'session-1',
    });
  });

  test('calls chrome_read_page with GitHub repo style args and prints parsed result', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          headers: { 'mcp-session-id': 'session-2' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-03-26' },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ body: '' }))
      .mockResolvedValueOnce(
        createResponse({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    filter: 'interactive',
                    pageContent:
                      '- link "Code" [ref=ref_1]\n- link "Issues" [ref=ref_2]\n- link "Pull requests" [ref=ref_3]\n- link "Actions" [ref=ref_4]',
                    contentSummary: {
                      lineCount: 4,
                      quality: 'usable',
                    },
                  }),
                },
              ],
            },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ status: 204 }));
    globalThis.fetch = fetchMock as unknown as FetchMock;

    const code = await runMcpCall('chrome_read_page', {
      args: '{"tabId":1850319377,"filter":"interactive","depth":2}',
    });

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('"tabId": 1850319377');
    expect(output).toContain('"filter": "interactive"');
    expect(output).toContain('Pull requests');
    expect(output).toContain('Actions');
    expect(stderrSpy).not.toHaveBeenCalled();

    const toolCall = (fetchMock as unknown as jest.Mock).mock.calls[2] as [string, RequestInit];
    expect(toolCall[0]).toBe(`http://127.0.0.1:${NATIVE_SERVER_PORT}/mcp`);
    expect(String(toolCall[1].body)).toContain('"name":"chrome_read_page"');
    expect(String(toolCall[1].body)).toContain('"tabId":1850319377');
    expect(String(toolCall[1].body)).toContain('"depth":2');
  });

  test('calls tool with JSON args and prints parsed result', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          headers: { 'mcp-session-id': 'session-3' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-03-26' },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ body: '' }))
      .mockResolvedValueOnce(
        createResponse({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ windowCount: 1, tabCount: 3 }) }],
            },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ status: 204 }));
    globalThis.fetch = fetchMock as unknown as FetchMock;

    const code = await runMcpCall('get_windows_and_tabs', {
      args: '{"windowId":123}',
    });

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('"windowId": 123');
    expect(output).toContain('"windowCount": 1');
    expect(stderrSpy).not.toHaveBeenCalled();

    const thirdCall = (fetchMock as unknown as jest.Mock).mock.calls[2] as [string, RequestInit];
    expect(thirdCall[0]).toBe(`http://127.0.0.1:${NATIVE_SERVER_PORT}/mcp`);
    expect(String(thirdCall[1].body)).toContain('"name":"get_windows_and_tabs"');
    expect(String(thirdCall[1].body)).toContain('"windowId":123');
  });

  test('supports --arg style key=value entries', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          headers: { 'mcp-session-id': 'session-arg-1' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-03-26' },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ body: '' }))
      .mockResolvedValueOnce(
        createResponse({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
            },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ status: 204 }));
    globalThis.fetch = fetchMock as unknown as FetchMock;

    const code = await runMcpCall('chrome_read_page', {
      arg: [
        'tabId=1850319377',
        'filter=interactive',
        'depth=2',
        'meta={"source":"tabrix","enabled":true}',
      ],
    });

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('"tabId": 1850319377');
    expect(output).toContain('"filter": "interactive"');
    expect(output).toContain('"depth": 2');
    expect(output).toContain('"source": "tabrix"');
    expect(output).toContain('"enabled": true');

    const toolCall = (fetchMock as unknown as jest.Mock).mock.calls[2] as [string, RequestInit];
    expect(toolCall[0]).toBe(`http://127.0.0.1:${NATIVE_SERVER_PORT}/mcp`);
    expect(String(toolCall[1].body)).toContain('"meta":{"source":"tabrix","enabled":true}');
  });

  test('loads args from --args-file and lets --arg override file values', async () => {
    const argsFileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-args-file-'));
    const argsFile = path.join(argsFileDir, 'mcp-args.json');
    tempFiles.push(argsFileDir);
    tempFiles.push(argsFile);
    fs.writeFileSync(
      argsFile,
      JSON.stringify({ tabId: 111, filter: 'all', depth: 1, nested: { value: 'file' } }),
      'utf8',
    );

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          headers: { 'mcp-session-id': 'session-arg-file-1' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-03-26' },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ body: '' }))
      .mockResolvedValueOnce(
        createResponse({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] },
          }),
        }),
      )
      .mockResolvedValueOnce(createResponse({ status: 204 }));
    globalThis.fetch = fetchMock as unknown as FetchMock;

    const code = await runMcpCall('chrome_read_page', {
      argsFile,
      arg: ['filter=interactive', 'depth=2'],
    });

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('"filter": "interactive"');
    expect(output).toContain('"depth": 2');
    expect(output).toContain('"value": "file"');

    const toolCall = (fetchMock as unknown as jest.Mock).mock.calls[2] as [string, RequestInit];
    expect(String(toolCall[1].body)).toContain('"filter":"interactive"');
    expect(String(toolCall[1].body)).toContain('"depth":2');
    expect(String(toolCall[1].body)).not.toContain('"filter":"all"');
    expect(String(toolCall[1].body)).toContain('"tabId":111');
  });

  test('fails fast on invalid --arg format', async () => {
    const code = await runMcpCall('get_windows_and_tabs', {
      arg: ['tabId'],
    });

    expect(code).toBe(1);
    const errorOutput = stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(errorOutput).toContain('MCP call failed');
    expect(errorOutput).toContain('key=value');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test('fails fast on invalid JSON args', async () => {
    const code = await runMcpCall('get_windows_and_tabs', {
      args: 'not-json',
    });

    expect(code).toBe(1);
    const errorOutput = stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(errorOutput).toContain('MCP call failed');
    expect(errorOutput).toContain('Unexpected token');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
