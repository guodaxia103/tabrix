import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

type SendMessageMock = ReturnType<typeof vi.fn>;
type RuntimeMessageListener = (
  message: any,
  sender?: any,
  sendResponse?: (response?: any) => void,
) => void;

class MockEventSource {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  readyState = MockEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  emitOpen(): void {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  emitError(): void {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }
}

function createChromeMock(sendMessage: SendMessageMock) {
  const runtimeMessageListeners: RuntimeMessageListener[] = [];
  return {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: RuntimeMessageListener) => {
          runtimeMessageListeners.push(listener);
        }),
        removeListener: vi.fn((listener: RuntimeMessageListener) => {
          const index = runtimeMessageListeners.indexOf(listener);
          if (index >= 0) {
            runtimeMessageListeners.splice(index, 1);
          }
        }),
      },
    },
    emitRuntimeMessage(message: any) {
      for (const listener of runtimeMessageListeners) {
        listener(message, {}, () => {});
      }
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

describe('useAgentServer SSE recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ engines: [] }),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('re-establishes SSE after ensuring native server during retry', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'ping_native') {
        return { connected: false };
      }
      if (message.type === 'ensure_native') {
        return { connected: true };
      }
      if (message.type === 'get_server_status') {
        return {
          connected: true,
          serverStatus: { isRunning: true, port: 12306 },
        };
      }
      return {};
    });
    (globalThis as any).chrome = createChromeMock(sendMessage);

    const { useAgentServer } = await import('@/entrypoints/sidepanel/composables/useAgentServer');

    const agentServer = useAgentServer({
      getSessionId: () => 'session-1',
      onError: vi.fn(),
    });

    agentServer.serverPort.value = 12306;
    agentServer.nativeConnected.value = true;
    agentServer.serverStatus.value = { isRunning: true, port: 12306 };
    agentServer.openEventSource();

    expect(MockEventSource.instances).toHaveLength(1);
    const firstStream = MockEventSource.instances[0];

    firstStream.emitError();
    await vi.advanceTimersByTimeAsync(1500);

    expect(sendMessage).toHaveBeenCalledWith({ type: 'ping_native' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'ensure_native' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'get_server_status' });
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toContain('/agent/chat/session-1/stream');
  });

  it('reports an error after exhausting SSE reconnect attempts', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'ping_native') {
        return { connected: false };
      }
      if (message.type === 'ensure_native') {
        return { connected: false };
      }
      if (message.type === 'get_server_status') {
        return {
          connected: false,
          serverStatus: { isRunning: false, port: undefined },
        };
      }
      return {};
    });
    const onError = vi.fn();
    (globalThis as any).chrome = createChromeMock(sendMessage);

    const { useAgentServer } = await import('@/entrypoints/sidepanel/composables/useAgentServer');

    const agentServer = useAgentServer({
      getSessionId: () => 'session-1',
      onError,
    });

    agentServer.serverPort.value = 12306;
    agentServer.nativeConnected.value = true;
    agentServer.serverStatus.value = { isRunning: true, port: 12306 };

    agentServer.openEventSource();
    expect(MockEventSource.instances).toHaveLength(1);

    MockEventSource.instances[0].emitError();

    await vi.advanceTimersByTimeAsync(31_000);

    expect(onError).toHaveBeenCalledWith('SSE connection failed after multiple attempts');
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('exposes connecting state while ensuring the native server', async () => {
    let releaseEnsure: (() => void) | null = null;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'ping_native') {
        return Promise.resolve({ connected: false });
      }
      if (message.type === 'ensure_native') {
        return new Promise((resolve) => {
          releaseEnsure = () => resolve({ connected: true });
        });
      }
      if (message.type === 'get_server_status') {
        return Promise.resolve({
          connected: true,
          serverStatus: { isRunning: true, port: 12306 },
        });
      }
      return Promise.resolve({});
    });
    (globalThis as any).chrome = createChromeMock(sendMessage);

    const { useAgentServer } = await import('@/entrypoints/sidepanel/composables/useAgentServer');

    const agentServer = useAgentServer({
      getSessionId: () => 'session-1',
    });

    const ensurePromise = agentServer.ensureNativeServer();
    await flushMicrotasks();

    expect(agentServer.connecting.value).toBe(true);
    expect(agentServer.connectionState.value).toBe('connecting');
    expect(releaseEnsure).toBeTypeOf('function');

    releaseEnsure?.();
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    await ensurePromise;

    expect(agentServer.connecting.value).toBe(false);
    expect(agentServer.connectionState.value).toBe('ready');
  });

  it('tracks last native error from background status responses', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'ping_native') {
        return { connected: false };
      }
      if (message.type === 'ensure_native') {
        return { connected: false, lastError: 'Native host manifest missing' };
      }
      if (message.type === 'get_server_status') {
        return {
          connected: false,
          lastError: 'Native host manifest missing',
          serverStatus: { isRunning: false, port: undefined },
        };
      }
      return {};
    });
    (globalThis as any).chrome = createChromeMock(sendMessage);

    const { useAgentServer } = await import('@/entrypoints/sidepanel/composables/useAgentServer');
    const agentServer = useAgentServer();

    const ready = await agentServer.ensureNativeServer();

    expect(ready).toBe(false);
    expect(agentServer.lastError.value).toBe('Native host manifest missing');
    expect(agentServer.connectionState.value).toBe('disconnected');
  });

  it('clears stale native errors after the server recovers', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'ping_native') {
        return { connected: false };
      }
      if (message.type === 'ensure_native') {
        return { connected: true, lastError: 'Old startup error' };
      }
      if (message.type === 'get_server_status') {
        return {
          connected: true,
          lastError: 'Old startup error',
          serverStatus: { isRunning: true, port: 12306 },
        };
      }
      return {};
    });
    (globalThis as any).chrome = createChromeMock(sendMessage);

    const { useAgentServer } = await import('@/entrypoints/sidepanel/composables/useAgentServer');
    const agentServer = useAgentServer({
      getSessionId: () => 'session-1',
    });

    const ensurePromise = agentServer.ensureNativeServer();
    await vi.advanceTimersByTimeAsync(500);
    const ready = await ensurePromise;

    expect(ready).toBe(true);
    expect(agentServer.connectionState.value).toBe('ready');
    expect(agentServer.lastError.value).toBe(null);
  });

  it('updates sidepanel state immediately from background server status broadcasts', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const chromeMock = createChromeMock(sendMessage);
    (globalThis as any).chrome = chromeMock;

    const { useAgentServer } = await import('@/entrypoints/sidepanel/composables/useAgentServer');
    const agentServer = useAgentServer({
      getSessionId: () => 'session-1',
    });

    agentServer.nativeConnected.value = true;
    agentServer.serverPort.value = 12306;
    agentServer.serverStatus.value = { isRunning: true, port: 12306 };
    agentServer.lastError.value = 'Old disconnect error';

    chromeMock.emitRuntimeMessage({
      type: 'server_status_changed',
      payload: {
        isRunning: false,
        port: 12306,
        lastUpdated: Date.now(),
      },
      connected: false,
      lastError: 'Native host disconnected',
    });

    expect(agentServer.connectionState.value).toBe('disconnected');
    expect(agentServer.nativeConnected.value).toBe(false);
    expect(agentServer.lastError.value).toBe('Native host disconnected');

    chromeMock.emitRuntimeMessage({
      type: 'server_status_changed',
      payload: {
        isRunning: true,
        port: 12307,
        lastUpdated: Date.now(),
      },
      connected: true,
      lastError: 'Transient error should clear',
    });

    expect(agentServer.connectionState.value).toBe('ready');
    expect(agentServer.nativeConnected.value).toBe(true);
    expect(agentServer.serverPort.value).toBe(12307);
    expect(agentServer.lastError.value).toBe(null);
  });
});
