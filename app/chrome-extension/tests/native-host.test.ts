import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NativeMessageType } from '@tabrix/shared';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { STORAGE_KEYS } from '@/common/constants';

vi.mock('@/entrypoints/background/tools', () => ({
  handleCallTool: vi.fn(),
}));

vi.mock('@/entrypoints/background/record-replay/flow-store', () => ({
  listPublished: vi.fn().mockResolvedValue([]),
  getFlow: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/entrypoints/background/keepalive-manager', () => ({
  acquireKeepalive: vi.fn(() => vi.fn()),
}));

type RuntimeMessageHandler = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => boolean | void;

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function createMockPort() {
  const messageListeners: Array<(message: any) => void | Promise<void>> = [];
  const disconnectListeners: Array<() => void> = [];

  return {
    onMessage: {
      addListener: vi.fn((listener: (message: any) => void | Promise<void>) => {
        messageListeners.push(listener);
      }),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => {
        disconnectListeners.push(listener);
      }),
      removeListener: vi.fn(),
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(() => {
      disconnectListeners.forEach((listener) => listener());
    }),
    async emitMessage(message: any) {
      for (const listener of messageListeners) {
        await listener(message);
      }
    },
    emitDisconnect() {
      disconnectListeners.forEach((listener) => listener());
    },
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createChromeHarness(
  ports: ReturnType<typeof createMockPort>[],
  options?: {
    onStorageSet?: (value: Record<string, unknown>) => Promise<void> | void;
  },
) {
  const runtimeMessageListeners: RuntimeMessageHandler[] = [];
  const storageState: Record<string, unknown> = {
    [STORAGE_KEYS.NATIVE_AUTO_CONNECT_ENABLED]: false,
  };

  const connectNative = vi.fn(() => {
    const port = ports.shift();
    if (!port) {
      throw new Error('No mock native ports remaining');
    }
    return port;
  });

  const chromeMock = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined as { message: string } | undefined,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      connectNative,
      onMessage: {
        addListener: vi.fn((listener: RuntimeMessageHandler) => {
          runtimeMessageListeners.push(listener);
        }),
        removeListener: vi.fn(),
      },
      onStartup: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storageState[key]]));
          }
          return { [keys]: storageState[keys] };
        }),
        set: vi.fn(async (value: Record<string, unknown>) => {
          await options?.onStorageSet?.(value);
          Object.assign(storageState, value);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) {
            delete storageState[key];
          }
        }),
      },
    },
  };

  return {
    chromeMock,
    connectNative,
    storageState,
    async sendRuntimeMessage(message: any) {
      const listener = runtimeMessageListeners.at(-1);
      if (!listener) {
        throw new Error('No runtime message listener registered');
      }

      return await new Promise<any>((resolve, reject) => {
        let responded = false;
        try {
          const result = listener(message, {} as chrome.runtime.MessageSender, (response) => {
            responded = true;
            resolve(response);
          });
          if (result !== true && !responded) {
            resolve(undefined);
          }
        } catch (error) {
          reject(error);
        }
      });
    },
  };
}

describe('native host reconnect behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          isRunning: true,
          port: 12306,
          bridge: {
            bridgeState: 'READY',
          },
        },
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as any).fetch;
  });

  it('reconnects after unexpected native disconnect and preserves last error', async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const harness = createChromeHarness([firstPort, secondPort]);
    (globalThis as any).chrome = harness.chromeMock;

    const nativeHostModule = await import('@/entrypoints/background/native-host');
    nativeHostModule.initNativeHostListener();
    await flushMicrotasks();

    const connectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.CONNECT_NATIVE,
      port: 12306,
    });
    await flushMicrotasks();
    await firstPort.emitMessage({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: 12306 },
    });
    await vi.advanceTimersByTimeAsync(300);
    const connectResponse = await connectPromise;

    expect(connectResponse).toMatchObject({ success: true, connected: true });
    expect(harness.connectNative).toHaveBeenCalledTimes(1);
    expect(firstPort.postMessage).toHaveBeenCalledWith({
      type: NativeMessageType.START,
      payload: { port: 12306 },
    });

    harness.chromeMock.runtime.lastError = { message: 'Native host crashed' };
    firstPort.emitDisconnect();
    await flushMicrotasks();

    const statusAfterDisconnect = await harness.sendRuntimeMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    expect(statusAfterDisconnect.connected).toBe(false);
    expect(statusAfterDisconnect.lastError).toBe('Native host crashed');
    expect(statusAfterDisconnect.serverStatus.isRunning).toBe(false);
    expect(harness.chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED,
        connected: false,
        lastError: 'Native host crashed',
      }),
    );

    await vi.advanceTimersByTimeAsync(400);
    await flushMicrotasks();

    expect(harness.connectNative).toHaveBeenCalledTimes(2);
    expect(secondPort.postMessage).toHaveBeenCalledWith({
      type: NativeMessageType.START,
      payload: { port: 12306 },
    });
  });

  it('does not schedule reconnect after an explicit manual disconnect', async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const harness = createChromeHarness([firstPort, secondPort]);
    (globalThis as any).chrome = harness.chromeMock;

    const nativeHostModule = await import('@/entrypoints/background/native-host');
    nativeHostModule.initNativeHostListener();
    await flushMicrotasks();

    const connectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.CONNECT_NATIVE,
      port: 12306,
    });
    await flushMicrotasks();
    await firstPort.emitMessage({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: 12306 },
    });
    await vi.advanceTimersByTimeAsync(300);
    await connectPromise;
    harness.chromeMock.runtime.lastError = { message: 'Manual disconnect should not persist' };

    const disconnectResponse = await harness.sendRuntimeMessage({
      type: NativeMessageType.DISCONNECT_NATIVE,
    });
    await flushMicrotasks();

    expect(disconnectResponse).toMatchObject({ success: true, lastError: null });

    const statusAfterManualDisconnect = await harness.sendRuntimeMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    expect(statusAfterManualDisconnect.connected).toBe(false);
    expect(statusAfterManualDisconnect.lastError).toBe(null);
    expect(statusAfterManualDisconnect.serverStatus.isRunning).toBe(false);
    expect(harness.chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED,
        connected: false,
        lastError: null,
      }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    expect(harness.connectNative).toHaveBeenCalledTimes(1);
    expect(secondPort.postMessage).not.toHaveBeenCalled();
  });

  it('preserves startup errors and retries when the port drops before startup settles', async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const harness = createChromeHarness([firstPort, secondPort]);
    (globalThis as any).chrome = harness.chromeMock;

    const nativeHostModule = await import('@/entrypoints/background/native-host');
    nativeHostModule.initNativeHostListener();
    await flushMicrotasks();

    const connectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.CONNECT_NATIVE,
      port: 12306,
    });

    await flushMicrotasks();
    await flushMicrotasks();
    expect(firstPort.onDisconnect.addListener).toHaveBeenCalled();
    harness.chromeMock.runtime.lastError = { message: 'Native host exited before startup' };
    firstPort.disconnect();
    await flushMicrotasks();

    const statusAfterStartupDrop = await harness.sendRuntimeMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    expect(statusAfterStartupDrop.connected).toBe(false);
    expect(statusAfterStartupDrop.lastError).toBe('Native host exited before startup');
    expect(statusAfterStartupDrop.serverStatus.isRunning).toBe(false);

    await vi.advanceTimersByTimeAsync(400);
    expect(harness.connectNative).toHaveBeenCalledTimes(2);

    await secondPort.emitMessage({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: 12306 },
    });
    await vi.advanceTimersByTimeAsync(300);

    const connectResponse = await connectPromise;
    expect(connectResponse).toMatchObject({
      success: true,
      connected: true,
    });

    const statusAfterFailedConnect = await harness.sendRuntimeMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    expect(statusAfterFailedConnect.connected).toBe(true);
    expect(statusAfterFailedConnect.lastError).toBe(null);
    expect(statusAfterFailedConnect.serverStatus.isRunning).toBe(true);
  });

  it('ignores stale disconnect cleanup after a newer connection has already started', async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const clearErrorDeferred = createDeferred();
    let holdNextClearError = false;
    const harness = createChromeHarness([firstPort, secondPort], {
      onStorageSet(value) {
        if (holdNextClearError && value[STORAGE_KEYS.LAST_NATIVE_ERROR] === null) {
          holdNextClearError = false;
          return clearErrorDeferred.promise;
        }
      },
    });
    (globalThis as any).chrome = harness.chromeMock;

    const nativeHostModule = await import('@/entrypoints/background/native-host');
    nativeHostModule.initNativeHostListener();
    await flushMicrotasks();

    const firstConnectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.CONNECT_NATIVE,
      port: 12306,
    });
    await flushMicrotasks();
    await firstPort.emitMessage({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: 12306 },
    });
    await vi.advanceTimersByTimeAsync(300);
    await firstConnectPromise;

    holdNextClearError = true;
    const disconnectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.DISCONNECT_NATIVE,
    });
    await flushMicrotasks();

    const reconnectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.CONNECT_NATIVE,
      port: 12306,
    });
    await flushMicrotasks();
    await flushMicrotasks();
    await secondPort.emitMessage({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: 12306 },
    });
    await vi.advanceTimersByTimeAsync(300);
    const reconnectResponse = await reconnectPromise;
    expect(reconnectResponse).toMatchObject({ success: true, connected: true });

    clearErrorDeferred.resolve();
    await disconnectPromise;
    await flushMicrotasks();

    const finalStatus = await harness.sendRuntimeMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    expect(finalStatus.connected).toBe(true);
    expect(finalStatus.lastError).toBe(null);
    expect(finalStatus.serverStatus.isRunning).toBe(true);
    expect(finalStatus.serverStatus.port).toBe(12306);
  });

  it('keeps auto-reconnect working after manual disconnect callback arrives late', async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const thirdPort = createMockPort();
    const harness = createChromeHarness([firstPort, secondPort, thirdPort]);
    (globalThis as any).chrome = harness.chromeMock;

    const nativeHostModule = await import('@/entrypoints/background/native-host');
    nativeHostModule.initNativeHostListener();
    await flushMicrotasks();

    const firstConnectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.CONNECT_NATIVE,
      port: 12306,
    });
    await flushMicrotasks();
    await firstPort.emitMessage({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: 12306 },
    });
    await vi.advanceTimersByTimeAsync(300);
    await firstConnectPromise;

    firstPort.disconnect.mockImplementation(() => {
      setTimeout(() => {
        firstPort.emitDisconnect();
      }, 0);
    });

    const manualDisconnectResponse = await harness.sendRuntimeMessage({
      type: NativeMessageType.DISCONNECT_NATIVE,
    });
    expect(manualDisconnectResponse).toMatchObject({ success: true });

    const reconnectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.CONNECT_NATIVE,
      port: 12306,
    });
    await flushMicrotasks();
    await secondPort.emitMessage({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: 12306 },
    });
    await vi.advanceTimersByTimeAsync(300);
    await reconnectPromise;

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();

    harness.chromeMock.runtime.lastError = { message: 'Second connection dropped unexpectedly' };
    secondPort.emitDisconnect();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(400);
    await flushMicrotasks();

    expect(harness.connectNative).toHaveBeenCalledTimes(3);
    expect(thirdPort.postMessage).toHaveBeenCalledWith({
      type: NativeMessageType.START,
      payload: { port: 12306 },
    });
  });

  it('posts bridge heartbeat after server start', async () => {
    const firstPort = createMockPort();
    const harness = createChromeHarness([firstPort]);
    (globalThis as any).chrome = harness.chromeMock;

    const nativeHostModule = await import('@/entrypoints/background/native-host');
    nativeHostModule.initNativeHostListener();
    await flushMicrotasks();

    const connectPromise = harness.sendRuntimeMessage({
      type: NativeMessageType.CONNECT_NATIVE,
      port: 12306,
    });
    await flushMicrotasks();
    await firstPort.emitMessage({
      type: NativeMessageType.SERVER_STARTED,
      payload: { port: 12306, host: '127.0.0.1' },
    });
    await vi.advanceTimersByTimeAsync(300);
    await connectPromise;
    await flushMicrotasks();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:12306/bridge/heartbeat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
});
