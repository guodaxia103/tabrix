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

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });

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
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      expect(result.isError).toBeFalsy();
      // The post-success hook should have advanced readPageCount.
      expect(ctx.readPageCount).toBe(2);
      expect(ctx.lastReadLayer).toBe('L0+L1');
    });
  });

  // -------------------------------------------------------------------
  // v2.6 S1 review fixes (P1-1, P1-2). These tests deliberately do
  // NOT spy on `sessionManager.getTaskContext` — they exercise the
  // real production path the agent walks today: `handleToolCall`
  // mints a fresh internal task per call, but the externally-keyed
  // context registry keeps state alive across calls when the args
  // carry a stable `taskSessionId` (or alias).
  // -------------------------------------------------------------------
  describe('v2.6 S1 P1-1 — externally-keyed task context survives across handleToolCall', () => {
    function mockReadPageRoundTrip(text: string): void {
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text }], isError: false },
        } as never);
    }

    it('accumulates readPageCount across consecutive chrome_read_page calls sharing taskSessionId', async () => {
      markBridgeReady();
      // Three calls with budget=2 → first two pass through, third
      // is short-circuited by the gate. Real production path:
      // stable `taskSessionId` only, no `getTaskContext` spy.
      const ctx = sessionManager.getOrCreateExternalTaskContext('shared-task');
      // Override the env-resolved budget on the shared context so
      // the test does not have to mutate process.env.
      Object.defineProperty(ctx, 'readBudget', { value: 2, writable: false });

      mockReadPageRoundTrip('first');
      const r1 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'shared-task',
        requestedLayer: 'L0+L1',
      });
      expect(r1.isError).toBeFalsy();

      mockReadPageRoundTrip('second');
      const r2 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'shared-task',
        requestedLayer: 'L0+L1+L2',
      });
      expect(r2.isError).toBeFalsy();

      // Third call: budget exhausted. NO bridge round-trip; only
      // the dynamic-flow listing is allowed. We `mockClear()` the
      // shared spy so the post-call delta cleanly reflects this
      // invocation only — `jest.spyOn` reuses the existing spy and
      // would otherwise carry the call counts from r1/r2.
      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const r3 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'shared-task',
        requestedLayer: 'L0+L1+L2',
      });
      expect(r3.isError).toBeFalsy();
      const payload = JSON.parse(String(r3.content[0].text));
      expect(payload).toMatchObject({
        warning: 'read_budget_exceeded',
        readPageCount: 2,
        readBudget: 2,
      });
      // Only the dynamic-flow probe was called for this third
      // invocation — the bridge `call_tool` request never fired.
      expect(flowSpy).toHaveBeenCalledTimes(1);

      // External registry must reflect the two real reads exactly.
      const persisted = sessionManager.peekExternalTaskContext('shared-task');
      expect(persisted).toBe(ctx);
      expect(persisted!.readPageCount).toBe(2);
    });

    it('does NOT cross-contaminate budgets between distinct taskSessionIds', async () => {
      markBridgeReady();
      const ctxA = sessionManager.getOrCreateExternalTaskContext('task-A');
      const ctxB = sessionManager.getOrCreateExternalTaskContext('task-B');
      Object.defineProperty(ctxA, 'readBudget', { value: 1, writable: false });
      Object.defineProperty(ctxB, 'readBudget', { value: 3, writable: false });

      // Burn task-A's budget.
      mockReadPageRoundTrip('a1');
      await handleToolCall('chrome_read_page', { tabId: 1, taskSessionId: 'task-A' });
      expect(ctxA.readPageCount).toBe(1);

      // task-B must still allow a read (budget intact).
      mockReadPageRoundTrip('b1');
      const rb1 = await handleToolCall('chrome_read_page', {
        tabId: 2,
        taskSessionId: 'task-B',
      });
      expect(rb1.isError).toBeFalsy();
      expect(ctxB.readPageCount).toBe(1);
      expect(ctxA.readPageCount).toBe(1);

      // task-A is now over budget; the gate fires WITHOUT a bridge
      // round-trip even though task-B is healthy. `mockClear` so
      // the post-call assertion reflects this invocation only.
      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const ra2 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'task-A',
      });
      const payload = JSON.parse(String(ra2.content[0].text));
      expect(payload.warning).toBe('read_budget_exceeded');
      expect(flowSpy).toHaveBeenCalledTimes(1);
    });

    it('alias precedence: taskSessionId beats taskId beats clientTaskId', async () => {
      markBridgeReady();
      const primary = sessionManager.getOrCreateExternalTaskContext('primary-key');

      // taskSessionId wins over taskId/clientTaskId aliases.
      mockReadPageRoundTrip('p1');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'primary-key',
        taskId: 'should-be-ignored',
        clientTaskId: 'also-ignored',
      });
      expect(primary.readPageCount).toBe(1);
      expect(sessionManager.peekExternalTaskContext('should-be-ignored')).toBeNull();
      expect(sessionManager.peekExternalTaskContext('also-ignored')).toBeNull();

      // taskId is honoured when taskSessionId is absent.
      const fromTaskId = sessionManager.getOrCreateExternalTaskContext('legacy-task');
      mockReadPageRoundTrip('p2');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskId: 'legacy-task',
        clientTaskId: 'still-ignored',
      });
      expect(fromTaskId.readPageCount).toBe(1);
      expect(sessionManager.peekExternalTaskContext('still-ignored')).toBeNull();

      // clientTaskId is the last-resort alias.
      const fromClient = sessionManager.getOrCreateExternalTaskContext('client-side');
      mockReadPageRoundTrip('p3');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        clientTaskId: 'client-side',
      });
      expect(fromClient.readPageCount).toBe(1);
    });

    it('absence of any task key preserves v2.5/v2.6 behaviour (no cross-call accumulation)', async () => {
      markBridgeReady();
      // Two consecutive reads without any taskSessionId. Each
      // mints a fresh internal task → fresh internal context →
      // gate is effectively a no-op past the first call. The
      // external registry must remain empty for these calls.
      mockReadPageRoundTrip('legacy-1');
      const r1 = await handleToolCall('chrome_read_page', { tabId: 1 });
      expect(r1.isError).toBeFalsy();

      mockReadPageRoundTrip('legacy-2');
      const r2 = await handleToolCall('chrome_read_page', { tabId: 1 });
      expect(r2.isError).toBeFalsy();

      // No external context should have been created by these
      // legacy-shape calls — the registry is keyed by externally
      // supplied stable keys, not by the internal taskId.
      for (const probe of ['', 'tabId', '1', 'undefined', 'null']) {
        expect(sessionManager.peekExternalTaskContext(probe)).toBeNull();
      }
    });

    it('whitespace-only / non-string task keys fall back to internal context (defensive)', async () => {
      markBridgeReady();
      mockReadPageRoundTrip('ws-1');
      await handleToolCall('chrome_read_page', { tabId: 1, taskSessionId: '   ' });
      mockReadPageRoundTrip('ws-2');
      await handleToolCall('chrome_read_page', { tabId: 1, taskSessionId: 42 as never });
      // No external entries materialised under degenerate keys.
      expect(sessionManager.peekExternalTaskContext('   ')).toBeNull();
      expect(sessionManager.peekExternalTaskContext('42')).toBeNull();
    });
  });

  describe('v2.6 S1 P1-2 — chrome_read_page reads requestedLayer (not legacy `layer`)', () => {
    function mockReadPageRoundTrip(text: string): void {
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text }], isError: false },
        } as never);
    }

    it('routes requestedLayer=L0+L1+L2 into shouldAllowReadPage / noteReadPage', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('layer-test');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('layer-1');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'layer-test',
        requestedLayer: 'L0+L1+L2',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1+L2');
      expect(ctx.readPageCount).toBe(1);

      // A second call at the same layer on the same page becomes
      // `read_redundant` and short-circuits — proves the gate
      // received the requested layer (not the buggy default).
      // `mockClear` so the assertion isolates this invocation.
      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const r2 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'layer-test',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(r2.content[0].text));
      expect(payload.warning).toBe('read_redundant');
      expect(flowSpy).toHaveBeenCalledTimes(1);
    });

    it('requestedLayer takes precedence over the legacy `layer` field', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('precedence');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('precedence');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'precedence',
        requestedLayer: 'L0',
        layer: 'L0+L1+L2',
      });
      // Recorded layer must be the one named by the public schema.
      expect(ctx.lastReadLayer).toBe('L0');
    });

    it('legacy `layer`-only callers still flow through (graceful fallback)', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('legacy-layer');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('legacy-layer');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'legacy-layer',
        layer: 'L0+L1',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1');
    });

    it('omitting both fields defaults to L0+L1+L2 (matches MCP schema)', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('default-layer');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('default-layer');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'default-layer',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1+L2');
    });

    it('invalid layer string is ignored and falls back to the schema default', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('invalid-layer');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('invalid-layer');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'invalid-layer',
        requestedLayer: 'NOT_A_REAL_LAYER',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1+L2');
    });
  });
});
