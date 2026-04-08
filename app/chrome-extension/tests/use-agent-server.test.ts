import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

type SendMessageMock = ReturnType<typeof vi.fn>;

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
  return {
    runtime: {
      sendMessage,
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
});
