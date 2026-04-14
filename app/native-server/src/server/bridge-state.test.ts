import { describe, expect, test, jest } from '@jest/globals';
import { BridgeStateManager } from './bridge-state';

describe('BridgeStateManager', () => {
  test('reports browser not running when no browser process is detected', () => {
    const manager = new BridgeStateManager(() => false);

    manager.syncBrowserProcessNow();

    expect(manager.getSnapshot()).toMatchObject({
      bridgeState: 'BROWSER_NOT_RUNNING',
      browserProcessRunning: false,
      nativeHostAttached: false,
    });
  });

  test('reports browser running but extension unavailable without heartbeat or native host', () => {
    const manager = new BridgeStateManager(() => true);

    manager.syncBrowserProcessNow();

    expect(manager.getSnapshot()).toMatchObject({
      bridgeState: 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE',
      browserProcessRunning: true,
      nativeHostAttached: false,
    });
  });

  test('reports ready when native host is attached', () => {
    const manager = new BridgeStateManager(() => true);

    manager.syncBrowserProcessNow();
    manager.setNativeHostAttached(true);

    expect(manager.getSnapshot()).toMatchObject({
      bridgeState: 'READY',
      browserProcessRunning: true,
      nativeHostAttached: true,
    });
  });

  test('reports ready when a fresh heartbeat says native is connected', () => {
    const manager = new BridgeStateManager(() => true);

    manager.syncBrowserProcessNow();
    manager.recordHeartbeat({ sentAt: Date.now(), nativeConnected: true });

    expect(manager.getSnapshot()).toMatchObject({
      bridgeState: 'READY',
      browserProcessRunning: true,
      extensionHeartbeatAt: expect.any(Number),
    });
  });

  test('moves to bridge connecting while recovery is in flight', () => {
    const manager = new BridgeStateManager(() => true);

    manager.syncBrowserProcessNow();
    manager.markRecoveryStarted('test-recovery');

    expect(manager.getSnapshot()).toMatchObject({
      bridgeState: 'BRIDGE_CONNECTING',
      recoveryInFlight: true,
      recoveryAttempts: 1,
      lastRecoveryAction: 'test-recovery',
    });
  });

  test('moves to bridge broken after a failed recovery following a ready state', () => {
    jest.useFakeTimers();
    const manager = new BridgeStateManager(() => true);

    manager.syncBrowserProcessNow();
    manager.setNativeHostAttached(true);
    manager.setNativeHostAttached(false);
    manager.markRecoveryStarted('reconnect');
    manager.markRecoveryFinished(false, 'TABRIX_BRIDGE_RECOVERY_FAILED', 'bridge retry failed');

    expect(manager.getSnapshot()).toMatchObject({
      bridgeState: 'BRIDGE_BROKEN',
      lastBridgeErrorCode: 'TABRIX_BRIDGE_RECOVERY_FAILED',
      lastBridgeErrorMessage: 'bridge retry failed',
    });

    jest.useRealTimers();
  });
});
