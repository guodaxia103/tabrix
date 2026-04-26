/**
 * V26-03 (B-026) — choose_context → TaskSessionContext → chrome_read_page
 * skip-read execution loop. Integration tests against the real
 * `handleToolCall` entry point.
 *
 * What these tests prove (and why the unit tests do NOT):
 *
 *   - `skip-read-orchestrator.test.ts` only exercises `planSkipRead`
 *     against hand-built `ChooseContextDecisionSnapshot` fixtures. It
 *     never proves that the live chooser actually writes a snapshot
 *     into the task context, nor that `chrome_read_page` actually
 *     reads it back.
 *   - `task-session-context.test.ts` proves the storage primitives
 *     (`noteChooseContextDecision` / `peekChooseContextDecision` /
 *     `noteUrlChange` invalidation) but does not run the chooser or
 *     the reader.
 *   - The tests below run BOTH halves through the production
 *     `handleToolCall` path. The chooser → reader pair is bound by
 *     the real `resolveTaskContextKey` auto-key fallback
 *     (`mcp:auto:tab:default` when no `tabId` / `taskSessionId` is
 *     supplied) — NO `jest.spyOn(sessionManager.getTaskContext)` is
 *     used. Per the V26-03 brief that exclusion is mandatory.
 *
 * Test surface map:
 *
 *   1. chooser writes a decision into the auto-keyed external task
 *      context (sourceRoute / chosenLayer / fullReadTokenEstimate /
 *      replayCandidate=null / apiCapability=null).
 *   2. chrome_read_page short-circuits to `read_page_skipped` when
 *      the chooser recorded an executable `experience_replay_skip_read`
 *      decision — and the skip payload contains NONE of
 *      `pageContent` / `L0` / `L1` / `targetRef` / `locator`.
 *   3. chrome_read_page falls back to the bridge round-trip when no
 *      chooser decision is on the context (legacy v2.5 path).
 *   4. `experience_replay_skip_read` with `replayCandidate=null`
 *      forces fallback (orchestrator surfaces
 *      `'replay_candidate_missing'` and the bridge IS called).
 *   5. `knowledge_supported_read` with no `apiCapability` forces
 *      fallback (orchestrator surfaces `'api_layer_not_available'`
 *      and the bridge IS called) — pins the V26-07/V26-08 deferral.
 *   6. chrome_navigate to a different URL clears a prior
 *      experience_replay decision so the next read goes to the
 *      bridge (URL change MUST invalidate the decision).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { TOOL_NAMES } from '@tabrix/shared';
import nativeMessagingHostInstance from '../native-messaging-host';
import { handleToolCall } from './register-tools';
import { sessionManager } from '../execution/session-manager';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { __hostConfigInternals, setPersistedPolicyCapabilities } from '../host-config';
import type { ChooseContextDecisionSnapshot } from '../execution/skip-read-orchestrator';
import type { ExperienceQueryService } from '../memory/experience';
import type { ExperienceActionPathRow } from '../memory/experience/experience-repository';

const AUTO_DEFAULT_KEY = 'mcp:auto:tab:default';
const CAPABILITIES_ENV_KEY = 'TABRIX_POLICY_CAPABILITIES';

describe('V26-03 choose_context → chrome_read_page skip-read execution loop', () => {
  let configDir: string;
  let previousCapabilities: string | undefined;

  function markBridgeReady(): void {
    jest.spyOn(bridgeRuntimeState, 'syncBrowserProcessNow').mockImplementation(() => {
      bridgeRuntimeState.setBrowserProcessRunning(true);
      return true;
    });
    jest.spyOn(bridgeCommandChannel, 'isConnected').mockReturnValue(false);
    bridgeRuntimeState.setBrowserProcessRunning(true);
    bridgeRuntimeState.setCommandChannelConnected(true, {
      type: 'websocket',
      connectionId: 'v26-03-skip-read-test',
    });
    bridgeRuntimeState.recordHeartbeat({
      sentAt: Date.now(),
      nativeConnected: true,
      extensionId: 'test-extension',
      connectionId: 'v26-03-skip-read-test',
    });
    bridgeRuntimeState.setNativeHostAttached(true);
  }

  /**
   * Mirrors the helper in `register-tools.test.ts`. The first
   * `mockResolvedValueOnce` answers the dynamic-flow / readiness
   * round-trip the bridge precheck makes; the second is the actual
   * `chrome_read_page` (or `chrome_navigate`) extension reply.
   */
  function mockBridgeRoundTrip(text: string): jest.SpyInstance {
    return jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: { content: [{ type: 'text', text }], isError: false },
      } as never);
  }

  /**
   * Hard guard for the skip path: assert the bridge `call_tool`
   * round-trip was NEVER invoked. The orchestrator MUST short-circuit
   * inside the shim — no extension call, no synthetic page payload.
   * The dynamic-flow precheck call is allowed (some code paths warm
   * the extension list before the gate fires) so we assert the
   * `call_tool` shape specifically.
   */
  function assertNoCallToolInvocation(spy: jest.SpyInstance): void {
    const callToolInvocations = spy.mock.calls.filter((call) => {
      const messageType = call[1];
      return typeof messageType === 'string' && messageType.toLowerCase().includes('call_tool');
    });
    expect(callToolInvocations).toHaveLength(0);
  }

  beforeEach(() => {
    previousCapabilities = process.env[CAPABILITIES_ENV_KEY];
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-skip-read-capabilities-'));
    __hostConfigInternals.setConfigFileForTesting(path.join(configDir, 'config.json'));
    delete process.env[CAPABILITIES_ENV_KEY];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    bridgeRuntimeState.reset();
    sessionManager.reset();
    if (previousCapabilities === undefined) {
      delete process.env[CAPABILITIES_ENV_KEY];
    } else {
      process.env[CAPABILITIES_ENV_KEY] = previousCapabilities;
    }
    __hostConfigInternals.setConfigFileForTesting(null);
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // (a) chooser writes a decision into the auto-keyed task context
  // ------------------------------------------------------------------
  it('tabrix_choose_context writes a decision into the SAME auto-keyed external context the reader will resolve', async () => {
    markBridgeReady();
    // Pre-create the auto-key context so the test can override its
    // budget AFTER the chooser ran. We do not pre-write a decision —
    // the chooser must write it.
    const ctx = sessionManager.getOrCreateExternalTaskContext(AUTO_DEFAULT_KEY);
    expect(ctx.peekChooseContextDecision()).toBeNull();

    const result = await handleToolCall(TOOL_NAMES.CONTEXT.CHOOSE, {
      intent: 'inspect repo issues',
      url: 'https://github.com/octocat/repo/issues',
      pageRole: 'issues_list',
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as {
      status: string;
      sourceRoute?: string;
      chosenLayer?: string;
    };
    expect(payload.status).toBe('ok');
    expect(typeof payload.sourceRoute).toBe('string');
    expect(typeof payload.chosenLayer).toBe('string');

    // The chooser must have written into the SAME auto-key context the
    // `chrome_read_page` shim will later look up. No `getTaskContext`
    // spy is involved — this is the real production key resolution.
    const decision = ctx.peekChooseContextDecision();
    expect(decision).not.toBeNull();
    if (!decision) throw new Error('decision unexpectedly null');
    // Mirrors the chooser tool result.
    expect(decision.sourceRoute).toBe(payload.sourceRoute);
    expect(decision.chosenLayer).toBe(payload.chosenLayer);
    // Honest defaults (V26-03 session corrections #2/#3/#4):
    //   * No Experience repo wired → no replay candidate.
    //   * api_knowledge default-off → apiCapability stays null.
    //   * fullReadTokenEstimate must be a non-negative integer (0
    //     when the dispatcher had no byte estimate to ground it).
    expect(decision.replayCandidate ?? null).toBeNull();
    expect(decision.apiCapability ?? null).toBeNull();
    expect(Number.isInteger(decision.fullReadTokenEstimate)).toBe(true);
    expect(decision.fullReadTokenEstimate).toBeGreaterThanOrEqual(0);
    // URL / pageRole synced by `noteUrlChange` inside the chooser.
    expect(ctx.currentUrl).toBe('https://github.com/octocat/repo/issues');
    expect(ctx.pageRole).toBe('issues_list');
  });

  // ------------------------------------------------------------------
  // (b) skip path: chrome_read_page returns read_page_skipped envelope
  // ------------------------------------------------------------------
  it('chrome_read_page returns a read_page_skipped envelope when the chooser recorded an executable experience_replay decision', async () => {
    markBridgeReady();
    // Pre-seed the SAME auto-key context the reader will resolve.
    // We use the production `getOrCreateExternalTaskContext` API
    // (the chooser handler uses the same one) so the test does not
    // spy on `getTaskContext`.
    const ctx = sessionManager.getOrCreateExternalTaskContext(AUTO_DEFAULT_KEY);
    ctx.noteUrlChange('https://github.com/octocat/repo/issues', 'issues_list');
    const decision: ChooseContextDecisionSnapshot = {
      sourceRoute: 'experience_replay_skip_read',
      chosenLayer: 'L0+L1',
      fullReadTokenEstimate: 4096,
      replayCandidate: {
        actionPathId: 'ap_skip_read_test',
        portableArgsOk: true,
        policyOk: true,
      },
      apiCapability: null,
    };
    ctx.noteChooseContextDecision(decision);

    const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');

    const result = await handleToolCall('chrome_read_page', { requestedLayer: 'L0+L1' });

    expect(result.isError).toBeFalsy();
    const text = String(result.content[0].text);
    const payload = JSON.parse(text) as Record<string, unknown>;

    // Skip-envelope schema (V26-03 hard contract; matches the V4.1
    // §3.1 source taxonomy + §6 read-budget bookkeeping).
    expect(payload).toMatchObject({
      kind: 'read_page_skipped',
      readPageAvoided: true,
      sourceKind: 'experience_replay',
      sourceRoute: 'experience_replay_skip_read',
      tokensSavedEstimate: 4096,
      fallbackUsed: 'none',
      fallbackEntryLayer: 'L0+L1',
      requiresApiCall: false,
      requiresExperienceReplay: true,
      actionPathId: 'ap_skip_read_test',
      apiFamily: null,
    });
    // task totals advanced by `noteSkipRead`.
    expect(payload.taskTotals).toEqual({
      readPageAvoidedCount: 1,
      tokensSavedEstimateTotal: 4096,
    });

    // Hard contract: a skip MUST NOT manufacture a synthetic
    // `chrome_read_page` payload. None of the layered DOM keys may
    // appear in the envelope.
    for (const forbiddenKey of [
      'pageContent',
      'L0',
      'L1',
      'L2',
      'targetRef',
      'targetRefs',
      'locator',
      'page',
      'interactiveElements',
      'highValueObjects',
      'summary',
    ]) {
      expect(payload).not.toHaveProperty(forbiddenKey);
    }

    // The bridge `call_tool` round-trip MUST NOT have happened.
    assertNoCallToolInvocation(bridgeSpy);

    // Read budget MUST NOT have advanced — the whole point of V26-03
    // is that a skipped read does not consume the per-task budget.
    expect(ctx.readPageCount).toBe(0);
    // But the avoided-count MUST have advanced.
    expect(ctx.getTaskTotals()).toEqual({
      readPageAvoidedCount: 1,
      tokensSavedEstimateTotal: 4096,
    });
  });

  // ------------------------------------------------------------------
  // (c) legacy path preserved when no chooser decision is on the ctx
  // ------------------------------------------------------------------
  it('chrome_read_page follows the legacy bridge path when no chooser decision is recorded', async () => {
    markBridgeReady();
    // No pre-seeded decision. The auto-key context exists (the gate
    // creates it on demand) but `peekChooseContextDecision` returns
    // null, so the orchestrator never runs and the shim falls
    // through to the existing bridge round-trip.
    const bridgeSpy = mockBridgeRoundTrip(
      JSON.stringify({ kind: 'page', pageContent: 'legacy-bridge' }),
    );

    const result = await handleToolCall('chrome_read_page', { requestedLayer: 'L0+L1' });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as Record<string, unknown>;
    // Bridge response is forwarded verbatim — NOT a skip envelope.
    expect(payload).not.toHaveProperty('kind', 'read_page_skipped');
    expect(payload).not.toHaveProperty('readPageAvoided');
    expect(payload.pageContent).toBe('legacy-bridge');
    // The bridge `call_tool` round-trip MUST have happened (one
    // dynamic-flow precheck + one actual call_tool invocation).
    const callToolInvocations = bridgeSpy.mock.calls.filter((call) => {
      const messageType = call[1];
      return typeof messageType === 'string' && messageType.toLowerCase().includes('call_tool');
    });
    expect(callToolInvocations).toHaveLength(1);
  });

  // ------------------------------------------------------------------
  // (d) experience_replay_skip_read + replayCandidate=null → fallback
  // ------------------------------------------------------------------
  it('experience_replay_skip_read with no replayCandidate forces fallback to the bridge (no skip envelope)', async () => {
    markBridgeReady();
    const ctx = sessionManager.getOrCreateExternalTaskContext(AUTO_DEFAULT_KEY);
    ctx.noteUrlChange('https://github.com/octocat/repo/issues', 'issues_list');
    ctx.noteChooseContextDecision({
      sourceRoute: 'experience_replay_skip_read',
      chosenLayer: 'L0+L1',
      fullReadTokenEstimate: 8192,
      // The chooser may pick `experience_replay_skip_read` even when
      // the per-row eligibility filter rejected every candidate — in
      // that case `replayCandidate` is null and the orchestrator
      // MUST surface `'replay_candidate_missing'` instead of skipping.
      replayCandidate: null,
      apiCapability: null,
    });

    const bridgeSpy = mockBridgeRoundTrip(
      JSON.stringify({ kind: 'page', pageContent: 'fallback-replay' }),
    );

    const result = await handleToolCall('chrome_read_page', { requestedLayer: 'L0+L1' });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as Record<string, unknown>;
    // Forward path: bridge response, not a skip envelope.
    expect(payload).not.toHaveProperty('kind', 'read_page_skipped');
    expect(payload.pageContent).toBe('fallback-replay');
    // Bridge `call_tool` MUST have happened.
    const callToolInvocations = bridgeSpy.mock.calls.filter((call) => {
      const messageType = call[1];
      return typeof messageType === 'string' && messageType.toLowerCase().includes('call_tool');
    });
    expect(callToolInvocations).toHaveLength(1);
    // Avoided-count MUST NOT have advanced.
    expect(ctx.getTaskTotals().readPageAvoidedCount).toBe(0);
  });

  // ------------------------------------------------------------------
  // (e) knowledge_supported_read + no apiCapability → fallback
  // ------------------------------------------------------------------
  it('knowledge_supported_read with no apiCapability forces fallback (V26-07/V26-08 deferral pinned)', async () => {
    markBridgeReady();
    const ctx = sessionManager.getOrCreateExternalTaskContext(AUTO_DEFAULT_KEY);
    ctx.noteUrlChange('https://github.com/octocat/repo/issues', 'issues_list');
    ctx.noteChooseContextDecision({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0+L1',
      fullReadTokenEstimate: 12000,
      replayCandidate: null,
      // Until V26-07/V26-08 wires `knowledge_call_api` the chooser
      // MUST leave `apiCapability` null. The orchestrator then
      // surfaces `'api_layer_not_available'` and the read is forwarded.
      apiCapability: null,
    });

    const bridgeSpy = mockBridgeRoundTrip(
      JSON.stringify({ kind: 'page', pageContent: 'fallback-knowledge' }),
    );

    const result = await handleToolCall('chrome_read_page', { requestedLayer: 'L0+L1' });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('kind', 'read_page_skipped');
    expect(payload.pageContent).toBe('fallback-knowledge');
    const callToolInvocations = bridgeSpy.mock.calls.filter((call) => {
      const messageType = call[1];
      return typeof messageType === 'string' && messageType.toLowerCase().includes('call_tool');
    });
    expect(callToolInvocations).toHaveLength(1);
    expect(ctx.getTaskTotals().readPageAvoidedCount).toBe(0);
  });

  it('production chooser→reader path uses persisted api_knowledge capability for Chinese GitHub search', async () => {
    markBridgeReady();
    setPersistedPolicyCapabilities('api_knowledge');
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      headers: { get: jest.fn().mockReturnValue('application/json') },
      json: jest.fn().mockResolvedValue({
        items: [
          {
            name: 'ai-assistant',
            full_name: 'octocat/ai-assistant',
            description: 'AI assistant demo',
            language: 'TypeScript',
            stargazers_count: 123,
            html_url: 'https://github.com/octocat/ai-assistant',
          },
        ],
      }),
    } as never);
    const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');

    const choose = await handleToolCall(TOOL_NAMES.CONTEXT.CHOOSE, {
      intent: '搜索 GitHub 上 AI助手 相关热门项目，列出前10个',
      url: 'https://github.com/search',
    });
    expect(choose.isError).toBeFalsy();
    const choosePayload = JSON.parse(String(choose.content[0].text)) as Record<string, unknown>;
    expect(choosePayload.sourceRoute).toBe('knowledge_supported_read');
    expect(choosePayload.chosenSource).toBe('api_list');
    expect(choosePayload.dispatcherInputSource).toBe('api_knowledge');
    expect(choosePayload.decisionReason).toBe('api_knowledge_candidate_available');

    const ctx = sessionManager.getOrCreateExternalTaskContext(AUTO_DEFAULT_KEY);
    const decision = ctx.peekChooseContextDecision();
    expect(decision?.apiCapability).toMatchObject({
      available: true,
      family: 'github_search_repositories',
      params: { query: 'AI助手', sort: 'stars', order: 'desc' },
    });

    const result = await handleToolCall('chrome_read_page', { requestedLayer: 'L0+L1+L2' });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: 'api_rows',
      readPageAvoided: true,
      sourceKind: 'api_list',
      sourceRoute: 'knowledge_supported_read',
      apiFamily: 'github_search_repositories',
      dataPurpose: 'search_list',
      rowCount: 1,
      compact: true,
      rawBodyStored: false,
      chosenSource: 'api_list',
      dispatcherInputSource: 'api_knowledge',
      decisionReason: 'api_knowledge_candidate_available',
      taskTotals: { readPageAvoidedCount: 1 },
    });
    expect(payload.fallbackPlan).toMatchObject({
      dataSource: 'dom_json',
      entryLayer: 'L0',
    });
    expect(payload.tokensSavedEstimate).toEqual(expect.any(Number));
    expect(payload.tokensSavedEstimate as number).toBeGreaterThan(0);
    expect(
      (payload.taskTotals as { tokensSavedEstimateTotal?: number }).tokensSavedEstimateTotal,
    ).toEqual(expect.any(Number));
    expect(
      (payload.taskTotals as { tokensSavedEstimateTotal: number }).tokensSavedEstimateTotal,
    ).toBeGreaterThan(0);
    expect(payload.tokenEstimateChosen).toEqual(expect.any(Number));
    expect(payload.tokenEstimateFullRead).toEqual(expect.any(Number));
    expect(payload.tokensSavedEstimateSource).toEqual(expect.any(String));
    expect(payload).not.toHaveProperty('targetRef');
    expect(payload).not.toHaveProperty('locator');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      'https://api.github.com/search/repositories',
    );
    assertNoCallToolInvocation(bridgeSpy);
  });

  it('API failure falls back to bridge chrome_read_page at L0+L1 and does not count as avoided', async () => {
    markBridgeReady();
    const ctx = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:7');
    ctx.noteUrlChange('https://github.com/search', null);
    ctx.noteChooseContextDecision({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0+L1+L2',
      fullReadTokenEstimate: 12000,
      replayCandidate: null,
      apiCapability: {
        available: true,
        family: 'github_search_repositories',
        dataPurpose: 'search_list',
        params: { query: 'tabrix' },
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 403,
      headers: { get: jest.fn().mockReturnValue('application/json') },
      json: jest.fn().mockResolvedValue({ message: 'forbidden' }),
    } as never);
    const bridgeSpy = mockBridgeRoundTrip(
      JSON.stringify({ kind: 'page', pageContent: 'api-fallback-dom' }),
    );

    const result = await handleToolCall('chrome_read_page', {
      requestedLayer: 'L0+L1+L2',
      tabId: 7,
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('kind', 'api_rows');
    expect(payload.pageContent).toBe('api-fallback-dom');
    const callToolInvocations = bridgeSpy.mock.calls.filter((call) => {
      const messageType = call[1];
      return typeof messageType === 'string' && messageType.toLowerCase().includes('call_tool');
    });
    expect(callToolInvocations).toHaveLength(1);
    const forwarded = callToolInvocations[0]?.[0] as {
      name: string;
      args: Record<string, unknown>;
    };
    expect(forwarded.name).toBe('chrome_read_page');
    expect(forwarded.args.requestedLayer).toBe('L0+L1');
    expect(ctx.getTaskTotals()).toEqual({
      readPageAvoidedCount: 0,
      tokensSavedEstimateTotal: 0,
    });
  });

  it('API semantic mismatch falls back to bridge L0+L1 without calling public fetch', async () => {
    markBridgeReady();
    const ctx = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:9');
    ctx.noteUrlChange('https://github.com/search', null);
    ctx.noteChooseContextDecision({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0+L1+L2',
      fullReadTokenEstimate: 12000,
      replayCandidate: null,
      apiCapability: {
        available: true,
        family: 'github_search_repositories',
        dataPurpose: 'issue_list',
        params: { query: 'tabrix' },
      },
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const bridgeSpy = mockBridgeRoundTrip(
      JSON.stringify({ kind: 'page', pageContent: 'api-semantic-fallback-dom' }),
    );

    const result = await handleToolCall('chrome_read_page', {
      requestedLayer: 'L0+L1+L2',
      tabId: 9,
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as Record<string, unknown>;
    expect(payload.pageContent).toBe('api-semantic-fallback-dom');
    expect(fetchSpy).not.toHaveBeenCalled();
    const callToolInvocations = bridgeSpy.mock.calls.filter((call) => {
      const messageType = call[1];
      return typeof messageType === 'string' && messageType.toLowerCase().includes('call_tool');
    });
    expect(callToolInvocations).toHaveLength(1);
    const forwarded = callToolInvocations[0]?.[0] as {
      name: string;
      args: Record<string, unknown>;
    };
    expect(forwarded.args.requestedLayer).toBe('L0+L1');
    expect(ctx.getTaskTotals()).toEqual({
      readPageAvoidedCount: 0,
      tokensSavedEstimateTotal: 0,
    });
  });

  // ------------------------------------------------------------------
  // (e2) fallback_required clamps the bridge requestedLayer to L0+L1
  //      even when the caller asked for L0+L1+L2. V26-03 review
  //      closeout — pins the V26-03 §0.1 hard rule (a fallback MUST
  //      NOT silently re-widen back to a full DOM read).
  // ------------------------------------------------------------------
  it('fallback_required forwards chrome_read_page to the bridge with requestedLayer clamped to L0+L1 (never the original L0+L1+L2)', async () => {
    markBridgeReady();
    // V26-03 review closeout: when `chrome_read_page` is called with
    // `tabId: 7` the production `resolveTaskContextKey` ladder pins
    // the lookup to `mcp:auto:tab:7` (not `mcp:auto:tab:default`), so
    // we MUST seed the decision against the same key the shim will
    // peek into. Using `getOrCreateExternalTaskContext('mcp:auto:tab:7')`
    // exercises the real key resolution rather than spying on it.
    const ctx = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:7');
    ctx.noteUrlChange('https://github.com/octocat/repo/issues', 'issues_list');
    // Chooser said `experience_replay_skip_read` but no executable
    // candidate landed on the snapshot — the orchestrator MUST surface
    // `'fallback_required' / 'replay_candidate_missing'` and the
    // bridge MUST be called with the clamped fallback layer, not the
    // caller's original `'L0+L1+L2'`.
    ctx.noteChooseContextDecision({
      sourceRoute: 'experience_replay_skip_read',
      // Even when the chooser picked `'L0+L1+L2'` upstream, the
      // orchestrator clamps the fallback entry layer to `'L0+L1'`
      // (V4.1 §0.1 hard rule).
      chosenLayer: 'L0+L1+L2',
      fullReadTokenEstimate: 16384,
      replayCandidate: null,
      apiCapability: null,
    });

    const bridgeSpy = mockBridgeRoundTrip(
      JSON.stringify({ kind: 'page', pageContent: 'fallback-clamped-layer' }),
    );

    const result = await handleToolCall('chrome_read_page', {
      // Caller asks for the schema default — full layered read.
      requestedLayer: 'L0+L1+L2',
      // Unrelated args MUST survive verbatim through the fallback
      // path so caller contracts that key off `tabId` / `windowId` /
      // `refId` are not silently broken.
      tabId: 7,
      windowId: 11,
      refId: 'tgt_clamped_fallback',
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as Record<string, unknown>;
    // Forward path: bridge response, not a skip envelope.
    expect(payload).not.toHaveProperty('kind', 'read_page_skipped');
    expect(payload.pageContent).toBe('fallback-clamped-layer');

    const callToolInvocations = bridgeSpy.mock.calls.filter((call) => {
      const messageType = call[1];
      return typeof messageType === 'string' && messageType.toLowerCase().includes('call_tool');
    });
    expect(callToolInvocations).toHaveLength(1);
    const forwarded = callToolInvocations[0]?.[0] as {
      name: string;
      args: Record<string, unknown>;
    };
    expect(forwarded.name).toBe('chrome_read_page');
    // V26-03 review closeout hard contract: the bridge MUST receive
    // the clamped fallback layer, NOT the caller's original
    // `'L0+L1+L2'`.
    expect(forwarded.args.requestedLayer).toBe('L0+L1');
    // And every other arg MUST be preserved bit-identically.
    expect(forwarded.args.tabId).toBe(7);
    expect(forwarded.args.windowId).toBe(11);
    expect(forwarded.args.refId).toBe('tgt_clamped_fallback');
    // The post-success bookkeeping MUST also reflect the clamped
    // layer so a subsequent redundant-read gate decision does not
    // drift back to the caller's original layer.
    expect(ctx.lastReadLayer).toBe('L0+L1');
    // Read budget consumed by the (forwarded) bridge call.
    expect(ctx.readPageCount).toBe(1);
    expect(ctx.getTaskTotals().readPageAvoidedCount).toBe(0);
  });

  // ------------------------------------------------------------------
  // (real-chooser) end-to-end skip via the production chooser path
  //
  // Pre-seeding `noteChooseContextDecision(...)` is BANNED here.
  // Instead we stub `sessionManager.experience` with a query service
  // that returns one replay-eligible row, run the real
  // `tabrix_choose_context` MCP tool, and assert that the FOLLOW-UP
  // `chrome_read_page` returns the skip envelope without invoking
  // the bridge. Pins that the chooser-side write actually flows
  // through `persistChooseContextDecision`.
  // ------------------------------------------------------------------
  it('real chooser path: tabrix_choose_context writes experience_replay_skip_read + replayCandidate, follow-up chrome_read_page skips without bridge call', async () => {
    markBridgeReady();
    // Enable the `experience_replay` capability so the chooser is
    // allowed to mark the row replay-eligible. Restored by the
    // `afterEach` `restoreAllMocks`/`reset` pair plus the
    // `delete process.env...` in the finally below.
    const previousCapabilitiesForReplay = process.env[CAPABILITIES_ENV_KEY];
    process.env[CAPABILITIES_ENV_KEY] = 'experience_replay';
    try {
      // Replay-eligible Experience row: a single
      // `chrome_click_element` step whose args extract to a portable
      // shape, on a GitHub pageRole the v1 allowlist accepts, with
      // success counters above
      // {EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT, _RATE}.
      const ACTION_PATH_ID = 'action_path_' + 'a'.repeat(64);
      const replayableRow: ExperienceActionPathRow = {
        actionPathId: ACTION_PATH_ID,
        pageRole: 'issues_list',
        intentSignature: 'browse repository issues',
        stepSequence: [
          {
            toolName: 'chrome_click_element',
            status: 'completed',
            historyRef: null,
            args: { selector: '#issues-tab' },
          },
        ],
        successCount: 9,
        failureCount: 1,
        lastUsedAt: '2026-04-22T00:00:00.000Z',
        lastReplayAt: '2026-04-22T00:00:00.000Z',
        compositeScoreDecayed: 0.9,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-22T00:00:00.000Z',
      };
      const fakeExperience: Pick<ExperienceQueryService, 'suggestActionPaths'> = {
        suggestActionPaths: jest.fn().mockReturnValue([replayableRow]),
      };
      // Stub the `experience` getter on the singleton so the live
      // chooser handler reads our fake row. We DO NOT spy on
      // `getTaskContext` — the chooser ↔ reader pair lands on the
      // SAME `mcp:auto:tab:default` key purely via the production
      // `resolveTaskContextKey` ladder.
      jest
        .spyOn(sessionManager, 'experience', 'get')
        .mockReturnValue(fakeExperience as unknown as ExperienceQueryService);

      // Pre-create the auto-key context so we can introspect it
      // AFTER the chooser ran. We do NOT pre-write a decision —
      // the chooser must do that itself.
      const ctx = sessionManager.getOrCreateExternalTaskContext(AUTO_DEFAULT_KEY);
      expect(ctx.peekChooseContextDecision()).toBeNull();

      // Intentionally OMIT `pageRole` from the chooser's MCP args.
      // The dispatcher's priority-4 page-complexity rule
      // (`simple_page_low_density` / `medium_page_overview` /
      // `complex_page_detail_required`) only fires when
      // `pageRole.length > 0`; with the chooser's own pageRole left
      // unset the dispatcher falls through to the priority-5 MKEP
      // rule and emits `'experience_replay_skip_read'`. The mocked
      // row's `pageRole='issues_list'` is what gates ROW-side
      // replay eligibility (`TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES`),
      // and that path is independent of the chooser-input pageRole.
      // Pick an `intent` whose `classifyIntentForLayerDispatch`
      // bucket is `'unknown'` — `inspect` / `details` / `summary`
      // / `open` / `click` / `fill` / `search` etc. all collapse
      // into a higher-priority dispatcher rule that emits
      // `'read_page_required'` BEFORE the MKEP rule. `'browse'`
      // is in none of those keyword sets and produces
      // `taskType='unknown'`, which is exactly the path the
      // priority-5 MKEP rule was designed for.
      const chooserResult = await handleToolCall(TOOL_NAMES.CONTEXT.CHOOSE, {
        intent: 'browse repository issues',
        url: 'https://github.com/octocat/repo/issues',
      });
      expect(chooserResult.isError).toBeFalsy();
      const chooserPayload = JSON.parse(String(chooserResult.content[0].text)) as {
        status: string;
        strategy?: string;
        sourceRoute?: string;
        chosenLayer?: string;
      };
      expect(chooserPayload.status).toBe('ok');
      expect(chooserPayload.strategy).toBe('experience_replay');
      expect(chooserPayload.sourceRoute).toBe('experience_replay_skip_read');

      // The decision MUST have landed on the SAME auto-key context the
      // reader will resolve, with a real replay candidate — written
      // by `persistChooseContextDecision`, NOT by the test.
      const decision = ctx.peekChooseContextDecision();
      expect(decision).not.toBeNull();
      if (!decision) throw new Error('decision unexpectedly null');
      expect(decision.sourceRoute).toBe('experience_replay_skip_read');
      expect(decision.replayCandidate).toEqual({
        actionPathId: ACTION_PATH_ID,
        portableArgsOk: true,
        policyOk: true,
      });
      expect(decision.apiCapability).toBeNull();

      // Now spy on the bridge and run the follow-up `chrome_read_page`.
      // The orchestrator MUST short-circuit and the bridge `call_tool`
      // round-trip MUST NOT happen.
      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');

      const readResult = await handleToolCall('chrome_read_page', {
        requestedLayer: decision.chosenLayer,
      });

      expect(readResult.isError).toBeFalsy();
      const readPayload = JSON.parse(String(readResult.content[0].text)) as Record<string, unknown>;
      expect(readPayload.kind).toBe('read_page_skipped');
      expect(readPayload.readPageAvoided).toBe(true);
      expect(readPayload.sourceKind).toBe('experience_replay');
      expect(readPayload.sourceRoute).toBe('experience_replay_skip_read');
      expect(readPayload.actionPathId).toBe(ACTION_PATH_ID);
      // Hard contract: skip envelope MUST NOT carry layered DOM keys.
      for (const forbiddenKey of [
        'pageContent',
        'L0',
        'L1',
        'L2',
        'targetRef',
        'targetRefs',
        'locator',
      ]) {
        expect(readPayload).not.toHaveProperty(forbiddenKey);
      }

      assertNoCallToolInvocation(bridgeSpy);

      // Read budget MUST stay at zero — the skip MUST NOT consume it.
      expect(ctx.readPageCount).toBe(0);
      expect(ctx.getTaskTotals().readPageAvoidedCount).toBe(1);
    } finally {
      if (previousCapabilitiesForReplay === undefined) {
        delete process.env[CAPABILITIES_ENV_KEY];
      } else {
        process.env[CAPABILITIES_ENV_KEY] = previousCapabilitiesForReplay;
      }
    }
  });

  // ------------------------------------------------------------------
  // (f) chrome_navigate URL change clears a prior decision
  // ------------------------------------------------------------------
  it('chrome_navigate to a new URL clears a prior experience_replay decision so the next read goes to the bridge', async () => {
    markBridgeReady();
    const ctx = sessionManager.getOrCreateExternalTaskContext(AUTO_DEFAULT_KEY);
    ctx.noteUrlChange('https://github.com/octocat/repo/issues', 'issues_list');
    ctx.noteChooseContextDecision({
      sourceRoute: 'experience_replay_skip_read',
      chosenLayer: 'L0+L1',
      fullReadTokenEstimate: 4096,
      replayCandidate: {
        actionPathId: 'ap_should_be_invalidated',
        portableArgsOk: true,
        policyOk: true,
      },
      apiCapability: null,
    });
    expect(ctx.peekChooseContextDecision()).not.toBeNull();

    // chrome_navigate → noteUrlChange fires BEFORE the bridge call
    // and wipes the prior decision because the URL changed. We
    // intentionally OMIT `tabId` from the navigate response so
    // `primaryTabController.recordNavigation` does not set
    // `bridgeRuntimeState.primaryTabId` — otherwise the follow-up
    // `chrome_read_page` would auto-key to `mcp:auto:tab:<id>`
    // instead of `mcp:auto:tab:default` and miss the pre-seeded
    // context. The schema-strict client path is exactly this:
    // single-tab cold-start, no bridge-known primary tab.
    mockBridgeRoundTrip(JSON.stringify({ ok: true }));
    await handleToolCall('chrome_navigate', { url: 'https://other.example/dashboard' });
    expect(ctx.currentUrl).toBe('https://other.example/dashboard');
    expect(ctx.peekChooseContextDecision()).toBeNull();

    // Follow-up chrome_read_page MUST NOT skip — the decision is gone.
    const readSpy = mockBridgeRoundTrip(
      JSON.stringify({ kind: 'page', pageContent: 'post-navigate-read' }),
    );
    const result = await handleToolCall('chrome_read_page', { requestedLayer: 'L0+L1' });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.content[0].text)) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('kind', 'read_page_skipped');
    expect(payload.pageContent).toBe('post-navigate-read');
    const callToolInvocations = readSpy.mock.calls.filter((call) => {
      const messageType = call[1];
      return typeof messageType === 'string' && messageType.toLowerCase().includes('call_tool');
    });
    expect(callToolInvocations.length).toBeGreaterThanOrEqual(1);
    // Read budget consumed by the real bridge call.
    expect(ctx.readPageCount).toBe(1);
    // Avoided count MUST stay at zero (no skip happened).
    expect(ctx.getTaskTotals().readPageAvoidedCount).toBe(0);
  });
});
