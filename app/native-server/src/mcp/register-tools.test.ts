import nativeMessagingHostInstance from '../native-messaging-host';
import { handleToolCall } from './register-tools';
import { sessionManager } from '../execution/session-manager';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { TaskSessionContext } from '../execution/task-session-context';

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
    delete process.env.TABRIX_POLICY_ALLOW_P3;
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

  it('persists a memory_actions row and injects historyRef for chrome_click_element', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Clicked e-1',
              elementInfo: { role: 'button', name: 'Submit' },
              navigationOccurred: false,
              clickMethod: 'dom',
            }),
          },
        ],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_click_element', { tabId: 1, ref: 'e-1' });

    expect(result.isError).toBe(false);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body.historyRef).toMatch(/^memory:\/\/action\/[0-9a-f-]+$/);

    const sessions = sessionManager.listSessions();
    const step = sessions[0].steps[0];
    expect(step.artifactRefs).toHaveLength(1);
    expect(step.artifactRefs![0]).toBe(body.historyRef);

    const actions = sessionManager.actions!.listByStep(step.stepId);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionKind).toBe('click');
    expect(actions[0].tabId).toBe(1);
    expect(actions[0].targetRef).toBe('e-1');
    expect(actions[0].status).toBe('success');
  });

  it('redacts fill value and omits result_blob for chrome_fill_or_select', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: 'Filled input#user' }),
          },
        ],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_fill_or_select', {
      tabId: 1,
      ref: 'e-1',
      value: 'hunter2',
    });

    expect(result.isError).toBe(false);
    const sessions = sessionManager.listSessions();
    const step = sessions[0].steps[0];
    const actions = sessionManager.actions!.listByStep(step.stepId);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionKind).toBe('fill');
    expect(actions[0].resultBlob).toBeNull();
    expect(actions[0].argsBlob).not.toContain('hunter2');
    expect(actions[0].argsBlob).toContain('[redacted]');
    const summary = JSON.parse(actions[0].valueSummary!);
    expect(summary.kind).toBe('redacted');
    expect(summary.length).toBe('hunter2'.length);
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

  it('denies P3 opt-in tools by default Tabrix policy with TABRIX_POLICY_DENIED_P3', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_javascript', { code: 'noop()' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload).toMatchObject({
      code: 'TABRIX_POLICY_DENIED_P3',
      riskTier: 'P3',
      requiresExplicitOptIn: true,
    });
    expect(payload.hint).toContain('TABRIX_POLICY_ALLOW_P3');

    const sessions = sessionManager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('failed');
    expect(sessions[0].steps[0].errorCode).toBe('policy_denied_p3');
  });

  it('allows P3 opt-in tools when TABRIX_POLICY_ALLOW_P3=all', async () => {
    markBridgeReady();
    process.env.TABRIX_POLICY_ALLOW_P3 = 'all';
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

    const result = await handleToolCall('chrome_javascript', { code: 'noop()' });

    expect(result.isError).toBe(false);
  });

  it('allows a specific P3 tool when listed in TABRIX_POLICY_ALLOW_P3', async () => {
    markBridgeReady();
    process.env.TABRIX_POLICY_ALLOW_P3 = 'chrome_javascript';
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

    const result = await handleToolCall('chrome_javascript', { code: 'noop()' });

    expect(result.isError).toBe(false);
  });

  it('still denies other P3 tools when TABRIX_POLICY_ALLOW_P3 is narrow', async () => {
    markBridgeReady();
    process.env.TABRIX_POLICY_ALLOW_P3 = 'chrome_javascript';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_computer', { action: 'screenshot' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload.code).toBe('TABRIX_POLICY_DENIED_P3');
  });

  describe('experience_suggest_plan does not pollute Experience (B-013 P1 regression)', () => {
    // Stub out the dynamic-flow-list extension call only — the native
    // handler short-circuits the actual tool invocation, so we never
    // need bridge readiness for the experience_suggest_plan call itself.
    const stubDynamicFlowList = () => {
      jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
        status: 'success',
        items: [],
      } as never);
    };

    it('a successful suggest call leaves experience_action_paths empty and marks the session aggregated', async () => {
      stubDynamicFlowList();

      const result = await handleToolCall('experience_suggest_plan', { intent: 'open issues' });
      expect(result.isError).toBe(false);
      const body = JSON.parse(String(result.content[0].text));
      expect(body.status).toBe('no_match');
      expect(body.plans).toEqual([]);

      // Memory audit-trail is preserved.
      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('completed');
      expect(sessions[0].steps).toHaveLength(1);
      expect(sessions[0].steps[0].toolName).toBe('experience_suggest_plan');

      const experience = sessionManager.experience;
      expect(experience).not.toBeNull();
      // No bucket for the meaningful intent the caller asked about.
      expect(experience!.suggestActionPaths({ intentSignature: 'open issues', limit: 5 })).toEqual(
        [],
      );
      // No self-pollution bucket either (the task-intent string the
      // wrapper synthesizes for every tool call).
      expect(
        experience!.suggestActionPaths({
          intentSignature: 'run mcp tool experience_suggest_plan',
          limit: 5,
        }),
      ).toEqual([]);

      // Replaying the aggregator must be a no-op — i.e. the skipped
      // session was actually marked, not stuck in pending.
      const replay = await handleToolCall('experience_suggest_plan', { intent: 'open issues' });
      expect(replay.isError).toBe(false);
      expect(
        experience!.suggestActionPaths({
          intentSignature: 'run mcp tool experience_suggest_plan',
          limit: 5,
        }),
      ).toEqual([]);
    });

    it('a bad-input suggest call also does not pollute Experience', async () => {
      stubDynamicFlowList();

      const result = await handleToolCall('experience_suggest_plan', {} as never);
      expect(result.isError).toBe(true);

      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('failed');
      expect(sessions[0].steps[0].toolName).toBe('experience_suggest_plan');

      const experience = sessionManager.experience;
      expect(experience).not.toBeNull();
      expect(
        experience!.suggestActionPaths({
          intentSignature: 'run mcp tool experience_suggest_plan',
          limit: 5,
        }),
      ).toEqual([]);
    });
  });

  it('prefers tool_not_available over policy denial when a P3 tool is disabled by MCP_DISABLE_SENSITIVE_TOOLS', async () => {
    markBridgeReady();
    process.env.MCP_DISABLE_SENSITIVE_TOOLS = 'true';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_javascript', { code: 'noop()' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('disabled'),
    });
  });

  // -------------------------------------------------------------------
  // V26-05 (B-028) — Task Session Context + Read Budget integration.
  //
  // The current `handleToolCall` shape mints a fresh task per call, so
  // the only way to drive the task-context state across the gate is to
  // pin `getTaskContext` to a shared instance via spy. That is the
  // contract these tests pin: when a context exists and is over budget
  // (or about to flip from a fresh URL), the gate fires correctly and
  // the bridge round-trip is skipped.
  // -------------------------------------------------------------------
  describe('V26-05 read-budget gate', () => {
    it('chrome_read_page returns a structured warning without a bridge call when budget is exceeded', async () => {
      markBridgeReady();
      const ctx = new TaskSessionContext({ readBudget: 2 });
      ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
      ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
      jest.spyOn(sessionManager, 'getTaskContext').mockReturnValue(ctx);
      const dynamicFlowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);

      const result = await handleToolCall('chrome_read_page', { tabId: 1 });

      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(String(result.content[0].text));
      expect(payload).toEqual({
        warning: 'read_budget_exceeded',
        readPageCount: 2,
        readBudget: 2,
        suggestedLayer: 'L0+L1',
      });
      // Critical contract: the bridge `call_tool` round-trip MUST NOT
      // happen on a budget-blocked read. The dynamic-flow-list call
      // (mocked above) is the only allowed extension call.
      expect(dynamicFlowSpy).toHaveBeenCalledTimes(1);
      expect(dynamicFlowSpy.mock.calls[0]).toBeDefined();
    });

    it('chrome_navigate URL change unblocks a follow-up read in the same task', async () => {
      markBridgeReady();
      // Prime the context as if a previous read exhausted the page's
      // L0+L1 layer at the OLD URL. After noteUrlChange the gate
      // should treat the next read as a brand-new first read.
      const ctx = new TaskSessionContext({ readBudget: 6 });
      ctx.noteUrlChange('https://old.example/foo', 'role_old');
      ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
      jest.spyOn(sessionManager, 'getTaskContext').mockReturnValue(ctx);

      // chrome_navigate to a new URL — the gate must call
      // `noteUrlChange` so the follow-up read is "first on this page".
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text: 'navigated' }], isError: false },
        } as never);
      await handleToolCall('chrome_navigate', { url: 'https://new.example/bar', tabId: 1 });
      expect(ctx.currentUrl).toBe('https://new.example/bar');
      expect(ctx.lastReadLayer).toBeNull();

      // Follow-up chrome_read_page — bridge call must go through.
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text: 'read' }], isError: false },
        } as never);
      const result = await handleToolCall('chrome_read_page', { tabId: 1 });
      expect(result.isError).toBeFalsy();
      // The post-success hook should have advanced readPageCount.
      expect(ctx.readPageCount).toBe(2);
      expect(ctx.lastReadLayer).toBe('L0+L1');
    });
  });
});
