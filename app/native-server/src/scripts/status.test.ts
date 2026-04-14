import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { runStatus } from './status';
import { MCP_HTTP_HOST_ENV, NATIVE_SERVER_PORT, SERVER_CONFIG } from '../constant';

type FetchMock = typeof globalThis.fetch;

describe('status script', () => {
  const originalFetch = globalThis.fetch;
  const originalPort = process.env.CHROME_MCP_PORT;
  const originalHost = process.env[MCP_HTTP_HOST_ENV];
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.CHROME_MCP_PORT = String(NATIVE_SERVER_PORT);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
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
    if (originalHost === undefined) {
      delete process.env[MCP_HTTP_HOST_ENV];
    } else {
      process.env[MCP_HTTP_HOST_ENV] = originalHost;
    }
  });

  test('prints sse as 0 when status payload omits sse', async () => {
    const json = {
      status: 'ok',
      data: {
        isRunning: true,
        host: SERVER_CONFIG.HOST,
        port: NATIVE_SERVER_PORT,
        nativeHostAttached: true,
        bridge: {
          bridgeState: 'READY',
          browserProcessRunning: true,
          extensionHeartbeatAt: 1710000000000,
          nativeHostAttached: true,
        },
        transports: {
          total: 1,
          streamableHttp: 1,
        },
      },
    };

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => json,
    })) as unknown as FetchMock;

    const code = await runStatus();

    expect(code).toBe(0);
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('Active sessions: 1 (streamable-http: 1, sse: 0)');
    expect(output).toContain('Bridge state: ready');
    expect(output).not.toContain('undefined');
  });

  test('prints session ids when present', async () => {
    const json = {
      status: 'ok',
      data: {
        isRunning: true,
        host: SERVER_CONFIG.HOST,
        port: NATIVE_SERVER_PORT,
        nativeHostAttached: true,
        bridge: {
          bridgeState: 'READY',
          browserProcessRunning: true,
          extensionHeartbeatAt: 1710000000000,
          nativeHostAttached: true,
        },
        transports: {
          total: 2,
          sse: 0,
          streamableHttp: 2,
          sessionIds: ['session-1', 'session-2'],
        },
      },
    };

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => json,
    })) as unknown as FetchMock;

    const code = await runStatus();

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('Session IDs: session-1, session-2');
  });

  test('uses localhost when server listens on wildcard host', async () => {
    process.env[MCP_HTTP_HOST_ENV] = '0.0.0.0';

    const json = {
      status: 'ok',
      data: {
        isRunning: true,
        host: '0.0.0.0',
        port: NATIVE_SERVER_PORT,
        nativeHostAttached: true,
        bridge: {
          bridgeState: 'READY',
          browserProcessRunning: true,
          extensionHeartbeatAt: 1710000000000,
          nativeHostAttached: true,
        },
        transports: {
          total: 1,
          sse: 0,
          streamableHttp: 1,
        },
      },
    };

    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => json,
    })) as unknown as FetchMock;
    globalThis.fetch = fetchMock;

    const code = await runStatus();

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalled();
    const [url] = (fetchMock as unknown as jest.Mock).mock.calls[0] as [string, unknown];
    expect(url).toBe(`http://127.0.0.1:${process.env.CHROME_MCP_PORT}/status`);
  });

  test('prints actionable hint when fetch fails', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('fetch failed');
    }) as unknown as FetchMock;

    const code = await runStatus();

    expect(code).toBe(1);
    const errorOutput = stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(errorOutput).toContain('Status failed: fetch failed');
    expect(errorOutput).toContain('doctor --fix');
  });

  test('prints bridge diagnostics when extension is unavailable', async () => {
    const json = {
      status: 'ok',
      data: {
        isRunning: true,
        host: SERVER_CONFIG.HOST,
        port: NATIVE_SERVER_PORT,
        nativeHostAttached: false,
        bridge: {
          bridgeState: 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE',
          browserProcessRunning: true,
          extensionHeartbeatAt: null,
          nativeHostAttached: false,
          lastBridgeErrorCode: 'TABRIX_EXTENSION_NOT_CONNECTED',
          lastBridgeErrorMessage: 'Chrome 已运行，但 Tabrix 扩展尚未与本地服务建立连接。',
        },
        transports: {
          total: 0,
          streamableHttp: 0,
          sse: 0,
        },
      },
    };

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => json,
    })) as unknown as FetchMock;

    const code = await runStatus();

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('Bridge state: extension-unavailable');
    expect(output).toContain('Extension heartbeat: missing');
    expect(output).toContain('Bridge last error: TABRIX_EXTENSION_NOT_CONNECTED');
  });
});
