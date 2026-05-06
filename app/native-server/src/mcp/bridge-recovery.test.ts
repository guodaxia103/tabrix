jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(() => true),
}));

jest.mock('../scripts/runtime-consistency', () => ({
  collectRuntimeConsistencySnapshot: jest.fn().mockResolvedValue({
    extensionBuild: {
      extensionId: 'njlidkjgkcccdoffkfcbgiefdpaipfdn',
    },
  }),
}));

import { spawn, spawnSync } from 'node:child_process';
import * as browserLaunchConfig from '../browser-launch-config';
import nativeMessagingHostInstance from '../native-messaging-host';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { bridgeRuntimeState } from '../server/bridge-state';
import { COMMAND_NAME } from '../scripts/constant';
import { sessionManager } from '../execution/session-manager';
import { __bridgeLaunchInternals } from './bridge-recovery';
import { handleToolCall } from './register-tools';

function mockTasklist(browserRunning: boolean) {
  (spawnSync as jest.Mock).mockImplementation(() => ({
    stdout: browserRunning ? 'chrome.exe 1234 Console 1 10,000 K' : '',
  }));
}

function mockLinuxPgrep(browserRunning: boolean) {
  (spawnSync as jest.Mock).mockImplementation(() => ({
    stdout: browserRunning ? '1234\n' : '',
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

function mockCurrentPlatform(platform: NodeJS.Platform) {
  return jest
    .spyOn(__bridgeLaunchInternals.platformRuntime, 'getCurrentPlatform')
    .mockReturnValue(platform);
}

function mockBridgeBrowserProcess(getRunning: () => boolean) {
  return jest.spyOn(bridgeRuntimeState, 'syncBrowserProcessNow').mockImplementation(() => {
    const running = getRunning();
    bridgeRuntimeState.setBrowserProcessRunning(running);
    return running;
  });
}

describe('bridge recovery orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    jest.restoreAllMocks();
    __bridgeLaunchInternals.setBrowserLaunchTestOverride(null);
    bridgeRuntimeState.reset();
    sessionManager.reset();
  });

  it('launches the browser and continues the tool call when bridge becomes ready', async () => {
    mockCurrentPlatform('win32');
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
    expect((spawn as jest.Mock).mock.calls[0][0]).toMatch(/chrome|chromium/i);
    expect((spawn as jest.Mock).mock.calls[0][0]).not.toBe('cmd');
    expect(nativeRequestSpy).toHaveBeenCalledTimes(2);
    expect(bridgeRuntimeState.getSnapshot().bridgeState).toBe('READY');
  });

  it('returns a structured bridge error when extension heartbeat never recovers', async () => {
    jest.useFakeTimers();
    mockCurrentPlatform('win32');
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
      nextAction: '等待扩展心跳恢复后重试一次',
    });
  });

  it('reconnects the extension without launching a new browser when Chrome is already running', async () => {
    mockCurrentPlatform('win32');
    mockTasklist(true);
    bridgeRuntimeState.syncBrowserProcessNow();

    (spawn as jest.Mock).mockImplementation((_command: string, _args: string[]) =>
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
    expect((spawn as jest.Mock).mock.calls[0][0]).toMatch(/chrome|chromium/i);
    expect((spawn as jest.Mock).mock.calls[0][0]).not.toBe('cmd');
    const launchArgs = ((spawn as jest.Mock).mock.calls[0][1] as string[]).join(' ');
    expect(launchArgs).toContain('chrome-extension://');
    expect(launchArgs).toContain('connect.html');
    expect(launchArgs).not.toContain('about:blank');
  });

  it('uses the persisted Linux browser executable when launching a browser', async () => {
    mockCurrentPlatform('linux');
    const previousDisplay = process.env.DISPLAY;
    process.env.DISPLAY = ':0';
    try {
      let browserRunning = false;
      mockBridgeBrowserProcess(() => browserRunning);
      mockLinuxPgrep(browserRunning);
      jest.spyOn(browserLaunchConfig, 'readPersistedBrowserLaunchConfig').mockReturnValue({
        preferredBrowser: 'chrome',
        executablePath: '/opt/google/chrome/chrome',
        source: 'linux-which',
        detectedAt: new Date().toISOString(),
      });
      jest.spyOn(browserLaunchConfig, 'resolveAndPersistBrowserLaunchConfig').mockReturnValue(null);

      (spawn as jest.Mock).mockImplementation(() =>
        createLaunchProcess(() => {
          browserRunning = true;
          mockLinuxPgrep(browserRunning);
          bridgeRuntimeState.recordHeartbeat({
            sentAt: Date.now(),
            nativeConnected: true,
            extensionId: 'njlidkjgkcccdoffkfcbgiefdpaipfdn',
            connectionId: 'conn-linux-1',
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

      const result = await handleToolCall('chrome_read_page', { tabId: 3 });

      expect(result.isError).toBe(false);
      expect(spawn).toHaveBeenCalled();
      expect((spawn as jest.Mock).mock.calls[0][0]).toBe('/opt/google/chrome/chrome');
      expect(((spawn as jest.Mock).mock.calls[0][1] as string[]).join(' ')).toContain(
        'chrome-extension://',
      );
    } finally {
      if (previousDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = previousDisplay;
    }
  });

  it('returns a Linux GUI-session error when no graphical session is available', async () => {
    mockCurrentPlatform('linux');
    const previousDisplay = process.env.DISPLAY;
    const previousWayland = process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    try {
      mockBridgeBrowserProcess(() => false);
      mockLinuxPgrep(false);
      jest.spyOn(browserLaunchConfig, 'readPersistedBrowserLaunchConfig').mockReturnValue({
        preferredBrowser: 'chrome',
        executablePath: '/opt/google/chrome/chrome',
        source: 'linux-which',
        detectedAt: new Date().toISOString(),
      });
      jest.spyOn(browserLaunchConfig, 'resolveAndPersistBrowserLaunchConfig').mockReturnValue(null);

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({
          status: 'success',
          items: [],
        } as never);

      const result = await handleToolCall('chrome_read_page', { tabId: 4 });

      expect(result.isError).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
      const payload = JSON.parse(String(result.content[0].text));
      expect(payload).toMatchObject({
        code: 'TABRIX_BROWSER_GUI_SESSION_UNAVAILABLE',
        nextAction: expect.stringContaining('图形会话'),
      });
    } finally {
      if (previousDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = previousDisplay;
      if (previousWayland === undefined) delete process.env.WAYLAND_DISPLAY;
      else process.env.WAYLAND_DISPLAY = previousWayland;
    }
  });

  it('returns a browser-not-running error when launch candidates are overridden to an unavailable path', async () => {
    jest.useFakeTimers();
    mockCurrentPlatform('win32');
    mockBridgeBrowserProcess(() => false);
    bridgeRuntimeState.setCommandChannelConnected(false);
    bridgeRuntimeState.setNativeHostAttached(false);
    expect(bridgeRuntimeState.getSnapshot().bridgeState).toBe('BROWSER_NOT_RUNNING');
    __bridgeLaunchInternals.setBrowserLaunchTestOverride([
      'C:\\__tabrix_missing_browser__\\chrome.exe',
    ]);

    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);

    const resultPromise = handleToolCall('chrome_read_page', { tabId: 5 });
    await jest.advanceTimersByTimeAsync(31_000);
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(spawn).toHaveBeenCalled();
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload).toMatchObject({
      code: 'TABRIX_BROWSER_NOT_RUNNING',
      bridgeState: 'BROWSER_NOT_RUNNING',
      recoveryAttempted: true,
      nextAction: '等待自动启动完成后重试一次',
    });
  });

  it('returns recover-failed when command channel is restored but retry still fails', async () => {
    mockCurrentPlatform('win32');
    mockTasklist(true);
    bridgeRuntimeState.syncBrowserProcessNow();
    bridgeRuntimeState.setNativeHostAttached(true);

    (spawn as jest.Mock).mockImplementation(() =>
      createLaunchProcess(() => {
        bridgeRuntimeState.recordHeartbeat({
          sentAt: Date.now(),
          nativeConnected: true,
          extensionId: 'njlidkjgkcccdoffkfcbgiefdpaipfdn',
          connectionId: 'conn-recovery-channel',
        });
        bridgeRuntimeState.setCommandChannelConnected(true, {
          type: 'websocket',
          connectionId: 'conn-recovery-channel',
        });
      }),
    );

    jest.spyOn(bridgeCommandChannel, 'isConnected').mockReturnValue(true);
    const commandSendMock = jest.spyOn(bridgeCommandChannel, 'sendCommand').mockResolvedValue({
      status: 'error',
      error: 'bridge is unavailable',
    } as never);

    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({
        status: 'error',
        error: 'request timed out',
      } as never)
      .mockResolvedValue({
        status: 'error',
        error: 'tool call not available',
      } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload).toMatchObject({
      code: 'TABRIX_BRIDGE_RECOVERY_FAILED',
      bridgeState: 'READY',
      recoveryAttempted: true,
      nextAction: `${COMMAND_NAME} doctor --fix 后重试`,
    });
    expect(commandSendMock).toHaveBeenCalled();
  });
});
