import { describe, expect, it, vi } from 'vitest';
import { createDisconnectedPopupSnapshot } from '@/common/popup-connection-state';

describe('popup connection fallback snapshot', () => {
  it('marks the popup disconnected and clears connected clients', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));

    const snapshot = createDisconnectedPopupSnapshot({
      isRunning: true,
      port: 12306,
      host: '127.0.0.1',
      networkAddresses: ['192.168.1.100'],
      authEnabled: true,
      lastUpdated: 1,
    });

    expect(snapshot.nativeConnectionStatus).toBe('disconnected');
    expect(snapshot.connectedClients).toEqual([]);
    expect(snapshot.lastNativeError).toBe(null);
    expect(snapshot.serverStatus).toMatchObject({
      isRunning: false,
      port: 12306,
      host: '127.0.0.1',
      networkAddresses: ['192.168.1.100'],
      authEnabled: true,
      lastUpdated: Date.now(),
    });

    vi.useRealTimers();
  });

  it('keeps a known port even if the server was already stopped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:05:00.000Z'));

    const snapshot = createDisconnectedPopupSnapshot({
      isRunning: false,
      port: 12306,
      lastUpdated: 10,
    });

    expect(snapshot.serverStatus).toEqual({
      isRunning: false,
      port: 12306,
      lastUpdated: Date.now(),
    });
    expect(snapshot.lastNativeError).toBe(null);

    vi.useRealTimers();
  });
});
