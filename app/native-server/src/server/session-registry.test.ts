import { describe, expect, test } from '@jest/globals';
import { SessionRegistry, type ManagedTransport } from './session-registry';

function createManagedTransport(
  overrides: Partial<Omit<ManagedTransport, 'clientId' | 'lastSeenAt'>> = {},
): Omit<ManagedTransport, 'clientId' | 'lastSeenAt'> {
  return {
    kind: 'streamable-http',
    transport: {
      close: async () => undefined,
    } as ManagedTransport['transport'],
    server: {
      close: async () => undefined,
    } as ManagedTransport['server'],
    clientIp: '127.0.0.1',
    clientName: 'Claude CLI',
    clientVersion: '1.0.0',
    userAgent: 'claude-code/1.0.0',
    connectedAt: 1_000,
    ...overrides,
  };
}

describe('SessionRegistry', () => {
  test('groups repeated sessions from the same active client', () => {
    let now = 1_000;
    const registry = new SessionRegistry({
      staleAfterMs: 10_000,
      disconnectedRetentionMs: 10_000,
      now: () => now,
    });

    registry.register('session-1', createManagedTransport());
    now = 1_500;
    registry.register('session-2', createManagedTransport({ connectedAt: now }));

    const snapshot = registry.snapshot();

    expect(snapshot.total).toBe(2);
    expect(snapshot.clients).toHaveLength(1);
    expect(snapshot.clients[0]).toMatchObject({
      clientName: 'Claude CLI',
      sessionCount: 2,
      sessionIds: ['session-2', 'session-1'],
      userAgent: 'claude-code/1.0.0',
      state: 'active',
    });
    expect(snapshot.sessionStates).toEqual({
      active: 2,
      stale: 0,
      disconnected: 0,
    });
  });

  test('moves stale sessions out of the active list and keeps a recent stale record', () => {
    let now = 1_000;
    const registry = new SessionRegistry({
      staleAfterMs: 100,
      disconnectedRetentionMs: 1_000,
      now: () => now,
    });

    registry.register('session-stale', createManagedTransport({ connectedAt: now }));

    now = 1_250;
    const snapshot = registry.snapshot();

    expect(snapshot.total).toBe(0);
    expect(snapshot.clients).toHaveLength(0);
    expect(snapshot.sessionStates).toEqual({
      active: 0,
      stale: 1,
      disconnected: 0,
    });
    expect(snapshot.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'session-stale',
          state: 'stale',
          disconnectReason: 'stale-timeout',
          endedAt: 1_250,
        }),
      ]),
    );
    expect(snapshot.cleanup.staleRemoved).toBe(1);
  });

  test('manual client disconnect removes it from the main list and records disconnected state', () => {
    let now = 1_000;
    const registry = new SessionRegistry({
      staleAfterMs: 10_000,
      disconnectedRetentionMs: 5_000,
      now: () => now,
    });

    registry.register('session-1', createManagedTransport({ connectedAt: now }));
    const clientId = registry.snapshot().clients[0]?.clientId;

    expect(clientId).toBeTruthy();
    expect(registry.disconnectClient(String(clientId))).toBe(1);

    now = 1_100;
    const snapshot = registry.snapshot();

    expect(snapshot.total).toBe(0);
    expect(snapshot.clients).toHaveLength(0);
    expect(snapshot.sessionStates).toEqual({
      active: 0,
      stale: 0,
      disconnected: 1,
    });
    expect(snapshot.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId,
          sessionId: 'session-1',
          state: 'disconnected',
          disconnectReason: 'manual',
        }),
      ]),
    );
  });
});
