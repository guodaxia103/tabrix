import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NativeMessageType } from 'chrome-mcp-shared';
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

function createChromeHarness(ports: ReturnType<typeof createMockPort>[]) {
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
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
    await connectPromise;

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
    harness.chromeMock.runtime.lastError = { message: 'Native host exited before startup' };
    firstPort.emitDisconnect();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(300);

    const connectResponse = await connectPromise;
    expect(connectResponse).toMatchObject({
      success: true,
      lastError: 'Native host exited before startup',
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(harness.connectNative).toHaveBeenCalledTimes(2);

    const statusAfterFailedConnect = await harness.sendRuntimeMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    expect(statusAfterFailedConnect.connected).toBe(true);
    expect(statusAfterFailedConnect.lastError).toBe('Native host exited before startup');
    expect(statusAfterFailedConnect.serverStatus.isRunning).toBe(false);
  });
});
