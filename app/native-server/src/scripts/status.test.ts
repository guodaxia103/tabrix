import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { runStatus } from './status';
import { NATIVE_SERVER_PORT, SERVER_CONFIG } from '../constant';

type FetchMock = typeof globalThis.fetch;

describe('status script', () => {
  const originalFetch = globalThis.fetch;
  const originalPort = process.env.CHROME_MCP_PORT;
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
  });

  test('prints sse as 0 when status payload omits sse', async () => {
    const json = {
      status: 'ok',
      data: {
        isRunning: true,
        host: SERVER_CONFIG.HOST,
        port: NATIVE_SERVER_PORT,
        nativeHostAttached: true,
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
});
