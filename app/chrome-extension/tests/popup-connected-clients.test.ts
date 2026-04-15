import { describe, expect, it } from 'vitest';
import {
  describePopupClientOrigin,
  isLoopbackClientIp,
  normalizePopupConnectedClients,
  shouldPopupAutoConnect,
  shouldApplyConnectedClientsResponse,
  summarizePopupConnectedClients,
} from '@/common/popup-connected-clients';

describe('popup connected client response guard', () => {
  it('accepts responses from the current visible MCP server endpoint', () => {
    expect(
      shouldApplyConnectedClientsResponse({
        requestedBaseUrl: 'http://127.0.0.1:12306',
        currentBaseUrl: 'http://127.0.0.1:12306',
        showMcpConfig: true,
      }),
    ).toBe(true);
  });

  it('rejects responses after the popup leaves the MCP-ready state', () => {
    expect(
      shouldApplyConnectedClientsResponse({
        requestedBaseUrl: 'http://127.0.0.1:12306',
        currentBaseUrl: 'http://127.0.0.1:12306',
        showMcpConfig: false,
      }),
    ).toBe(false);
  });

  it('rejects responses from an outdated server endpoint', () => {
    expect(
      shouldApplyConnectedClientsResponse({
        requestedBaseUrl: 'http://127.0.0.1:12306',
        currentBaseUrl: 'http://127.0.0.1:12307',
        showMcpConfig: true,
      }),
    ).toBe(false);
  });

  it('only enables popup autoconnect when explicitly requested', () => {
    expect(shouldPopupAutoConnect('')).toBe(false);
    expect(shouldPopupAutoConnect('?autoconnect=0')).toBe(false);
    expect(shouldPopupAutoConnect('?autoconnect=1')).toBe(true);
  });

  it('normalizes only active grouped clients for the popup main list', () => {
    expect(
      normalizePopupConnectedClients([
        {
          clientId: 'client-1',
          sessionId: 'session-1',
          sessionIds: ['session-1', 'session-2'],
          sessionCount: 2,
          state: 'active',
          kind: 'streamable-http',
          clientIp: '192.168.1.9',
          clientName: 'Claude CLI',
          clientVersion: '1.0.0',
          connectedAt: 100,
          lastSeenAt: 200,
        },
        {
          clientId: '',
          sessionId: 'invalid',
        },
      ]),
    ).toEqual([
      {
        clientId: 'client-1',
        sessionId: 'session-1',
        sessionIds: ['session-1', 'session-2'],
        sessionCount: 2,
        state: 'active',
        kind: 'streamable-http',
        clientIp: '192.168.1.9',
        clientName: 'Claude CLI',
        clientVersion: '1.0.0',
        connectedAt: 100,
        lastSeenAt: 200,
      },
    ]);
  });

  it('summarizes active client groups and session counts for header copy', () => {
    expect(
      summarizePopupConnectedClients([
        {
          clientId: 'client-1',
          sessionId: 'session-1',
          sessionIds: ['session-1', 'session-2'],
          sessionCount: 2,
          state: 'active',
          kind: 'streamable-http',
          clientIp: '127.0.0.1',
          clientName: 'Claude CLI',
          clientVersion: '1.0.0',
          connectedAt: 100,
          lastSeenAt: 200,
        },
        {
          clientId: 'client-2',
          sessionId: 'session-3',
          sessionIds: ['session-3'],
          sessionCount: 1,
          state: 'active',
          kind: 'streamable-http',
          clientIp: '127.0.0.1',
          clientName: 'Codex',
          clientVersion: '1.0.0',
          connectedAt: 150,
          lastSeenAt: 220,
        },
      ]),
    ).toEqual({
      activeClients: 2,
      activeSessions: 3,
    });
  });

  it('treats loopback IPs as local HTTP clients', () => {
    expect(isLoopbackClientIp('127.0.0.1')).toBe(true);
    expect(isLoopbackClientIp('::1')).toBe(true);
    expect(isLoopbackClientIp('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackClientIp('192.168.5.9')).toBe(false);
  });

  it('describes popup client origin for local and remote sessions', () => {
    expect(
      describePopupClientOrigin({
        clientIp: '127.0.0.1',
        kind: 'streamable-http',
      }),
    ).toEqual({
      scope: 'local',
      transport: 'http',
      address: '127.0.0.1',
    });

    expect(
      describePopupClientOrigin({
        clientIp: '192.168.5.23',
        kind: 'streamable-http',
      }),
    ).toEqual({
      scope: 'remote',
      transport: 'http',
      address: '192.168.5.23',
    });
  });
});
