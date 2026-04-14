jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock('../scripts/runtime-consistency', () => ({
  collectRuntimeConsistencySnapshot: jest.fn().mockResolvedValue({
    extensionBuild: {
      extensionId: 'njlidkjgkcccdoffkfcbgiefdpaipfdn',
    },
  }),
}));

import { spawn, spawnSync } from 'node:child_process';
import nativeMessagingHostInstance from '../native-messaging-host';
import { bridgeRuntimeState } from '../server/bridge-state';
import { sessionManager } from '../execution/session-manager';
import { handleToolCall } from './register-tools';

function mockTasklist(browserRunning: boolean) {
  (spawnSync as jest.Mock).mockImplementation(() => ({
    stdout: browserRunning ? 'chrome.exe 1234 Console 1 10,000 K' : '',
  }));
}

function createLaunchProcess(onLaunch?: () => void) {
  return {
    once: jest.fn((_event: string, _handler: (...args: any[]) => void) => {
      // No-op: launch path succeeds via timer in tryLaunchCommand.
    }),
    unref: jest.fn(() => {
      onLaunch?.();
    }),
  };
}

describe('bridge recovery orchestration', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    bridgeRuntimeState.reset();
    sessionManager.reset();
  });

  it('launches the browser and continues the tool call when bridge becomes ready', async () => {
    let browserRunning = false;
    mockTasklist(browserRunning);

    (spawn as jest.Mock).mockImplementation(() =>
      createLaunchProcess(() => {
        browserRunning = true;
        mockTasklist(browserRunning);
        bridgeRuntimeState.recordHeartbeat({
          sentAt: Date.now(),
          nativeConnected: true,
          extensionId: 'njlidkjgkcccdoffkfcbgiefdpaipfdn',
          connectionId: 'conn-1',
        });
        bridgeRuntimeState.setNativeHostAttached(true);
      }),
    );

    const nativeRequestSpy = jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({
        status: 'success',
        items: [],
      } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        },
      } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });

    expect(result.isError).toBe(false);
    expect(spawn).toHaveBeenCalled();
    expect(nativeRequestSpy).toHaveBeenCalledTimes(2);
    expect(bridgeRuntimeState.getSnapshot().bridgeState).toBe('READY');
  });

  it('returns a structured bridge error when extension heartbeat never recovers', async () => {
    jest.useFakeTimers();
    mockTasklist(true);
    bridgeRuntimeState.syncBrowserProcessNow();

    (spawn as jest.Mock).mockImplementation(() => createLaunchProcess());

    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);

    const resultPromise = handleToolCall('chrome_read_page', { tabId: 1 });
    await jest.advanceTimersByTimeAsync(31_000);
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload).toMatchObject({
      code: 'TABRIX_EXTENSION_HEARTBEAT_MISSING',
      bridgeState: 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE',
      recoveryAttempted: true,
    });
  });

  it('reconnects the extension without launching a new browser when Chrome is already running', async () => {
    mockTasklist(true);
    bridgeRuntimeState.syncBrowserProcessNow();

    (spawn as jest.Mock).mockImplementation((command: string, args: string[]) =>
      createLaunchProcess(() => {
        bridgeRuntimeState.recordHeartbeat({
          sentAt: Date.now(),
          nativeConnected: true,
          extensionId: 'njlidkjgkcccdoffkfcbgiefdpaipfdn',
          connectionId: 'conn-2',
        });
        bridgeRuntimeState.setNativeHostAttached(true);
      }),
    );

    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({
        status: 'success',
        items: [],
      } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        },
      } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 2 });

    expect(result.isError).toBe(false);
    expect(spawn).toHaveBeenCalled();
    const launchArgs = ((spawn as jest.Mock).mock.calls[0][1] as string[]).join(' ');
    expect(launchArgs).toContain('chrome-extension://');
    expect(launchArgs).toContain('connect.html');
    expect(launchArgs).not.toContain('about:blank');
  });
});
