import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { runClients } from './clients';
import { NATIVE_SERVER_PORT } from '../constant';

type FetchMock = typeof globalThis.fetch;

describe('clients script', () => {
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

  test('prints active clients and recent inactive sessions', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        data: {
          transports: {
            total: 2,
            streamableHttp: 2,
            sse: 0,
            clients: [
              {
                clientId: 'client-1',
                sessionIds: ['session-1', 'session-2'],
                sessionCount: 2,
                kind: 'streamable-http',
                clientIp: '127.0.0.1',
                clientName: 'codex',
                clientVersion: '1.0.0',
                userAgent: 'ua',
                connectedAt: 1710000000000,
                lastSeenAt: 1710000005000,
              },
            ],
            sessions: [
              {
                sessionId: 'session-3',
                state: 'stale',
                clientIp: '127.0.0.1',
                clientName: 'codex',
                connectedAt: 1710000000000,
                lastSeenAt: 1710000005000,
                endedAt: 1710000007000,
                disconnectReason: 'stale-timeout',
              },
            ],
          },
        },
      }),
    })) as unknown as FetchMock;

    const code = await runClients();

    expect(code).toBe(0);
    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('Active client groups: 1');
    expect(output).toContain('- codex @ 127.0.0.1 (2 sessions)');
    expect(output).toContain('sessionIds: session-1, session-2');
    expect(output).toContain('Recent Inactive Sessions');
    expect(output).toContain('session-3: stale');
    expect(output).toContain('disconnectReason: stale-timeout');
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
