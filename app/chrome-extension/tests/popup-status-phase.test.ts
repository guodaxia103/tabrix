import { describe, expect, it } from 'vitest';
import { ConnectionState } from '@/common/connection-state';
import { resolvePopupConnectionState } from '@/common/popup-status-phase';

describe('popup status bootstrap phase', () => {
  it('keeps the popup in connecting state while initial probing is still running', () => {
    expect(
      resolvePopupConnectionState({
        nativeStatus: 'disconnected',
        serverRunning: false,
        isConnecting: false,
        lastError: 'Old native error',
        isBootstrapping: true,
      }),
    ).toBe(ConnectionState.CONNECTING);
  });

  it('falls back to the normal state machine after bootstrap completes', () => {
    expect(
      resolvePopupConnectionState({
        nativeStatus: 'disconnected',
        serverRunning: false,
        isConnecting: false,
        lastError: 'Old native error',
        isBootstrapping: false,
      }),
    ).toBe(ConnectionState.ERROR);
  });
});
