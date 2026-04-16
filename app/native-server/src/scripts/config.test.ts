import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { runConfig } from './config';
import { MCP_HTTP_HOST_ENV, NATIVE_SERVER_PORT } from '../constant';

type FetchMock = typeof globalThis.fetch;

describe('config script', () => {
  const originalFetch = globalThis.fetch;
  const originalPort = process.env.CHROME_MCP_PORT;
  const originalHost = process.env[MCP_HTTP_HOST_ENV];
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.CHROME_MCP_PORT = String(NATIVE_SERVER_PORT);
    process.env[MCP_HTTP_HOST_ENV] = '0.0.0.0';
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

  test('prints local, remote, stdio, and token details', async () => {
    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: async () => ({
            status: 'ok',
            data: {
              isRunning: true,
              host: '0.0.0.0',
              port: NATIVE_SERVER_PORT,
              networkAddresses: ['192.168.31.132'],
              authEnabled: true,
            },
          }),
        };
      }
      if (url.endsWith('/auth/token')) {
        return {
          ok: true,
          json: async () => ({
            status: 'ok',
            data: {
              token: 'test-token',
              createdAt: 1710000000000,
              expiresAt: null,
              fromEnv: false,
              ttlDays: 0,
            },
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as FetchMock;

    const code = await runConfig();

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('Streamable HTTP (local)');
    expect(output).toContain(`url: http://127.0.0.1:${NATIVE_SERVER_PORT}/mcp`);
    expect(output).toContain(`url: http://192.168.31.132:${NATIVE_SERVER_PORT}/mcp`);
    expect(output).toContain('command: tabrix-stdio');
    expect(output).toContain('token: test-token');
    expect(output).toContain('Authorization: Bearer test-token');
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
