import nativeMessagingHostInstance from '../native-messaging-host';
import { handleToolCall } from './register-tools';
import { sessionManager } from '../execution/session-manager';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';

describe('handleToolCall execution wrapper', () => {
  const markBridgeReady = () => {
    jest.spyOn(bridgeRuntimeState, 'syncBrowserProcessNow').mockImplementation(() => {
      bridgeRuntimeState.setBrowserProcessRunning(true);
      return true;
    });
    jest.spyOn(bridgeCommandChannel, 'isConnected').mockReturnValue(false);
    bridgeRuntimeState.setBrowserProcessRunning(true);
    bridgeRuntimeState.setCommandChannelConnected(true, {
      type: 'websocket',
      connectionId: 'test-connection',
    });
    bridgeRuntimeState.recordHeartbeat({
      sentAt: Date.now(),
      nativeConnected: true,
      extensionId: 'test-extension',
      connectionId: 'test-connection',
    });
    bridgeRuntimeState.setNativeHostAttached(true);
  };

  afterEach(() => {
    jest.restoreAllMocks();
    bridgeRuntimeState.reset();
    sessionManager.reset();
    delete process.env.ENABLE_MCP_TOOLS;
    delete process.env.DISABLE_MCP_TOOLS;
    delete process.env.MCP_DISABLE_SENSITIVE_TOOLS;
  });

  it('tracks a successful tool call as a completed execution session', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });

    expect(result.isError).toBe(false);
    const sessions = sessionManager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('completed');
    expect(sessions[0].steps).toHaveLength(1);
    expect(sessions[0].steps[0].toolName).toBe('chrome_read_page');
    expect(sessions[0].steps[0].status).toBe('completed');
    expect(sessionManager.listTasks()[0].status).toBe('completed');
  });

  it('returns structured error payload when extension returns a non-recoverable error', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'error',
      error: 'tool execution failed',
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });
    const payload = JSON.parse(String(result.content[0].text));

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      code: 'TABRIX_TOOL_CALL_FAILED',
      message: 'tool execution failed',
      recoveryAttempted: false,
    });
  });

  it('returns structured error payload when tool invocation throws', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockRejectedValueOnce(new Error('unhandled tool transport failure'));

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });
    const payload = JSON.parse(String(result.content[0].text));

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      code: 'TABRIX_TOOL_CALL_EXCEPTION',
      message: 'unhandled tool transport failure',
      recoveryAttempted: false,
    });
  });

  it('tracks a rejected tool call as a failed execution session', async () => {
    markBridgeReady();
    process.env.ENABLE_MCP_TOOLS = 'chrome_read_page';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_close_tabs', {});

    expect(result.isError).toBe(true);
    const sessions = sessionManager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('failed');
    expect(sessions[0].steps[0].errorCode).toBe('tool_not_available');
    expect(sessionManager.listTasks()[0].status).toBe('failed');
  });

  it('blocks sensitive tools when MCP_DISABLE_SENSITIVE_TOOLS is set', async () => {
    markBridgeReady();
    process.env.MCP_DISABLE_SENSITIVE_TOOLS = 'true';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_javascript', { code: 'alert(1)' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('disabled'),
    });
  });

  it('persists a page snapshot and injects historyRef for chrome_read_page', async () => {
    markBridgeReady();
    const readPageBody = {
      mode: 'compact',
      page: {
        url: 'https://github.com/openclaw/openclaw',
        title: 'openclaw/openclaw',
        pageType: 'web_page',
      },
      summary: { pageRole: 'github_repo_home', primaryRegion: 'main', quality: 'usable' },
      interactiveElements: [
        { ref: 'e1', role: 'link', name: 'Code' },
        { ref: 'e2', role: 'link', name: 'Issues' },
      ],
      artifactRefs: [{ kind: 'dom_snapshot', ref: 'artifact://read_page/1/t' }],
      highValueObjects: [],
      historyRef: null,
    };
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: JSON.stringify(readPageBody) }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });

    expect(result.isError).toBe(false);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body.historyRef).toMatch(/^memory:\/\/snapshot\/[0-9a-f-]+$/);

    const sessions = sessionManager.listSessions();
    const step = sessions[0].steps[0];
    expect(step.artifactRefs).toHaveLength(1);
    expect(step.artifactRefs![0]).toBe(body.historyRef);
  });

  it('allows non-sensitive tools when MCP_DISABLE_SENSITIVE_TOOLS is set', async () => {
    markBridgeReady();
    process.env.MCP_DISABLE_SENSITIVE_TOOLS = 'true';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });

    expect(result.isError).toBe(false);
  });
});
