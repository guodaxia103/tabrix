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

import { TOOL_NAMES } from '@tabrix/shared';
import nativeMessagingHostInstance from '../native-messaging-host';
import { handleToolCall } from './register-tools';
import { sessionManager } from '../execution/session-manager';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import type { ChooseContextDecisionSnapshot } from '../execution/skip-read-orchestrator';

const AUTO_DEFAULT_KEY = 'mcp:auto:tab:default';

describe('V26-03 choose_context → chrome_read_page skip-read execution loop', () => {
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

  afterEach(() => {
    jest.restoreAllMocks();
    bridgeRuntimeState.reset();
    sessionManager.reset();
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
    //   * V26-07/V26-08 not landed → apiCapability stays null.
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
