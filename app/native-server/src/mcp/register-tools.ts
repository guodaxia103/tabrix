import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import {
  CAPABILITY_GATED_TOOLS,
  NativeMessageType,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  getRequiredCapability,
  getToolRiskTier,
  isCapabilityGatedTool,
  isExplicitOptInTool,
} from '@tabrix/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  buildPolicyDeniedPayload,
  isToolAllowedByPolicy,
  resolveOptInAllowlist,
} from '../policy/phase0-opt-in';
import {
  getCurrentCapabilityEnv,
  isCapabilityEnabled,
  type CapabilityEnv,
} from '../policy/capabilities';
import { sessionManager } from '../execution/session-manager';
import { normalizeToolCallResult } from '../execution/result-normalizer';
import { planSkipRead, type SkipReadPlan } from '../execution/skip-read-orchestrator';
import { readApiKnowledgeEndpointPlan } from '../api/api-knowledge';
import { mapDataSourceToLayerContract } from '../execution/layer-contract';
import { routeDataSource } from '../execution/data-source-router';
import { runPostProcessor } from './tool-post-processors';
import { getNativeToolHandler } from './native-tool-handlers';
import type {
  DispatchBridgedFn,
  ReplayOutcomeWriter,
  ReplayStepRecorder,
  SupportedReplayToolName,
} from './experience-replay';
import {
  callWithBridgeRecovery,
  getBridgeSnapshot,
  isRecoverableBridgeIssue,
  type GenericFailurePayload,
} from './bridge-recovery';
import {
  extractRequestedLayer,
  extractTabIdFromCallToolResult,
  READ_PAGE_DEFAULT_LAYER,
  resolveTaskContextKey,
} from './task-context-key';
import {
  buildDomRegionRowsRejectedLogHint,
  buildDomRegionRowsSuccessResult,
  buildVisibleRowsRejectionReason,
  inferDomRegionRowsTaskIntent,
  type ReadPageOperationLogHint,
} from './read-page-dom-region-rows-result';
import {
  apiFaultDataPurposeOverride,
  apiFaultFetchOverride,
  estimateApiRowsTokenSavings,
  normalizeApiFallbackCause,
  readAcceptanceApiFault,
  stripInternalReadPageArgs,
  withFallbackEvidence,
  type ApiReadFallbackEvidence,
} from './read-page-api-fallback';
import { buildKnowledgeApiRowsSuccessResult } from './read-page-api-rows-result';
import {
  buildLiveObservedApiRowsSuccessResult,
  buildLiveObservedRejectedLogHint,
} from './read-page-live-observed-result';
import { buildReadPageWarningResult } from './read-page-warning-result';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { getDefaultPrimaryTabController } from '../runtime/primary-tab-controller';

/**
 * Tools with elevated risk: arbitrary JS execution, data deletion, file system
 * interaction. When MCP_DISABLE_SENSITIVE_TOOLS=true, these are hidden from
 * the tool list unless explicitly allowed via ENABLE_MCP_TOOLS.
 */
export const SENSITIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.BROWSER.JAVASCRIPT,
  TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
  TOOL_NAMES.BROWSER.FILE_UPLOAD,
]);

function parseToolList(value?: string): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function filterToolsByEnvironment(tools: Tool[]): Tool[] {
  const enabledTools = parseToolList(process.env.ENABLE_MCP_TOOLS);
  const disabledTools = parseToolList(process.env.DISABLE_MCP_TOOLS);

  if (enabledTools.size > 0) {
    return tools.filter((tool) => enabledTools.has(tool.name));
  }

  if (disabledTools.size > 0) {
    return tools.filter((tool) => !disabledTools.has(tool.name));
  }

  if (process.env.MCP_DISABLE_SENSITIVE_TOOLS === 'true') {
    return tools.filter((tool) => !SENSITIVE_TOOL_NAMES.has(tool.name));
  }

  return tools;
}

function isToolAllowed(toolName: string, tools: Tool[]): boolean {
  return tools.some((tool) => tool.name === toolName);
}

/**
 * Phase 0 Policy view of the tools list. Removes P3 opt-in tools that have not been opted-in
 * and injects the Tabrix-private `riskTier` annotation so clients that choose to render it can.
 *
 * Also injects `requiresExplicitOptIn: true` for tools listed
 * in {@link CAPABILITY_GATED_TOOLS} (e.g. `experience_replay`), even
 * though they are NOT in `P3_EXPLICIT_OPT_IN_TOOLS`. This is the
 * first non-P3 use of that annotation; the actual filtering happens
 * in {@link filterToolsByCapability} below, downstream of this
 * function.
 *
 * Never mutates the input tool objects.
 */
function filterToolsByPolicy(tools: Tool[]): Tool[] {
  const optInAllow = resolveOptInAllowlist(process.env);
  const result: Tool[] = [];
  for (const tool of tools) {
    if (isExplicitOptInTool(tool.name) && !optInAllow.has(tool.name)) {
      continue;
    }
    const riskTier = getToolRiskTier(tool.name);
    const requiresOptIn = isExplicitOptInTool(tool.name) || isCapabilityGatedTool(tool.name);
    if (!riskTier && !requiresOptIn) {
      result.push(tool);
      continue;
    }
    const annotations = {
      ...(tool.annotations ?? {}),
      ...(riskTier ? { riskTier } : {}),
      ...(requiresOptIn ? { requiresExplicitOptIn: true } : {}),
    } as Tool['annotations'];
    result.push({ ...tool, annotations });
  }
  return result;
}

/**
 * Capability gate. Drops tools listed in
 * {@link CAPABILITY_GATED_TOOLS} when the matching capability is not
 * present in the active capability allowlist (`TABRIX_POLICY_CAPABILITIES`
 * — see {@link isCapabilityEnabled}).
 *
 * This is orthogonal to the P3 opt-in path: a tool can be capability-
 * gated without being P3 (e.g. `experience_replay` is P1 + capability
 * `experience_replay`). The gate runs AFTER `filterToolsByPolicy` so
 * the annotation injection above is always honoured for clients that
 * render the gate explanation.
 *
 * Never mutates the input tool objects.
 */
function filterToolsByCapability(tools: Tool[], env: CapabilityEnv): Tool[] {
  if (CAPABILITY_GATED_TOOLS.size === 0) return tools;
  return tools.filter((tool) => {
    const cap = getRequiredCapability(tool.name);
    if (!cap) return true;
    return isCapabilityEnabled(cap, env);
  });
}

/**
 * Production wiring for the `experience_replay` handler.
 * Binds:
 *   - `dispatchBridged` to the existing `invokeExtensionCommand`
 *     round-trip (with the same recovery-aware wrapper used for
 *     ordinary tool calls).
 *   - `recorder` to `sessionManager.startStep` / `completeStep`
 *     against the wrapper-owned session, so each replayed sub-step
 *     gets its own `memory_steps` row carrying the underlying
 *     tool name.
 *   - `updateTaskIntent` to `sessionManager.updateTaskIntent` so the
 *     wrapper-owned session is re-tagged with
 *     `experience_replay:<actionPathId>`.
 *
 * Lookup of the wrapper-owned session/task happens inside the
 * recorder closure (instead of capturing the live `ExecutionSession`
 * object) so the production code path stays compatible with future
 * persistence-mode changes (`'off'` does not produce a real session,
 * but the handler short-circuits before we reach that branch).
 */
function buildReplayDeps(wrapperSessionId: string): {
  dispatchBridged: DispatchBridgedFn;
  recorder: ReplayStepRecorder;
  updateTaskIntent: (intent: string) => void;
  outcomeWriter: ReplayOutcomeWriter;
} {
  const dispatchBridged: DispatchBridgedFn = async (toolName, toolArgs) => {
    const { response, bridgeFailure } = await callWithBridgeRecovery(
      () => invokeExtensionCommand('call_tool', { name: toolName, args: toolArgs }, 120000),
      `tool:${toolName}`,
    );
    if (response?.status === 'success') {
      const normalized = normalizeToolCallResult(toolName, response.data);
      // Pass through the underlying tool's CallToolResult shape so
      // the ReplayEngine can extract `historyRef` from its content.
      return (
        response.data ?? {
          content: [{ type: 'text' as const, text: normalized.stepSummary ?? '' }],
          isError: false,
        }
      );
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: bridgeFailure
            ? JSON.stringify(bridgeFailure)
            : JSON.stringify({
                code: 'TABRIX_TOOL_CALL_FAILED',
                message: String(response?.error ?? 'Unknown tool error'),
              }),
        },
      ],
      isError: true,
    };
  };

  const recorder: ReplayStepRecorder = {
    startStep(input) {
      const child = sessionManager.startStep({
        sessionId: wrapperSessionId,
        toolName: input.toolName,
        stepType: 'tool_call',
        inputSummary: input.inputSummary,
      });
      return child.stepId;
    },
    completeStep(stepId, update) {
      sessionManager.completeStep(wrapperSessionId, stepId, {
        status: 'completed',
        resultSummary: update.resultSummary,
        artifactRefs: update.artifactRefs,
      });
    },
    failStep(stepId, update) {
      sessionManager.completeStep(wrapperSessionId, stepId, {
        status: 'failed',
        errorCode: update.failureCode,
        errorSummary: update.errorSummary,
      });
    },
  };

  const updateTaskIntent = (intent: string) => {
    // Resolve the live wrapper session → its taskId and forward to
    // the SessionManager. Wrapped in try/catch because tagging is
    // best-effort: a missing session must never mask the real
    // experience_replay outcome.
    try {
      const wrapperSession = sessionManager.getSession(wrapperSessionId);
      sessionManager.updateTaskIntent(wrapperSession.taskId, intent);
    } catch {
      // Session no longer present (e.g. test fixture reset between
      // invocation and tagging) — ignore.
    }
  };

  // Per-step write-back hook. Isolation is enforced TWICE:
  //   1. here, where any thrown SQLite error is caught and downgraded
  //      to a structured warning row (so the user's replay path stays
  //      alive); and
  //   2. inside `ReplayEngine.tryWriteOutcome`, which already wraps
  //      the call in its own try/catch as defense-in-depth.
  // We deliberately swallow the inner `recordWritebackWarning` failure
  // for the same reason the score-step handler does — at that point even
  // the warning row could not land, but throwing would defeat the
  // isolation contract.
  const outcomeWriter: ReplayOutcomeWriter = {
    recordReplayStepOutcome(input) {
      const experience = sessionManager.experience;
      if (!experience) return;
      const nowIso = new Date().toISOString();
      try {
        experience.recordReplayStepOutcome({
          actionPathId: input.actionPathId,
          stepIndex: input.stepIndex,
          observedOutcome: input.observedOutcome,
          nowIso,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const warningId = `warn_replay_outcome_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
        try {
          experience.recordWritebackWarning({
            warningId,
            source: 'experience_score_step',
            actionPathId: input.actionPathId,
            stepIndex: input.stepIndex,
            sessionId: wrapperSessionId,
            replayId: null,
            observedOutcome: input.observedOutcome,
            errorCode: 'replay_outcome_write_failed',
            errorMessage: message.slice(0, 512),
            payloadBlob: null,
            createdAt: nowIso,
          });
        } catch {
          // Warning row also failed — stay silent by isolation
          // contract. Operator-side telemetry will surface the
          // underlying SQLite issue separately.
        }
      }
    },
  };

  return { dispatchBridged, recorder, updateTaskIntent, outcomeWriter };
}

function createCapabilityDeniedResult(toolName: string, capability: string): CallToolResult {
  // Mirrors the experience_replay handler's `denied / capability_off`
  // payload so callers do not have to branch on whether the gate
  // fired pre- or post-handler.
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: 'denied',
          evidenceRefs: [],
          error: {
            code: 'capability_off',
            message: `Tool "${toolName}" requires the '${capability}' capability (set TABRIX_POLICY_CAPABILITIES=${capability} or =all)`,
          },
        }),
      },
    ],
    isError: true,
  };
}

function createPolicyDeniedResult(toolName: string): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(buildPolicyDeniedPayload(toolName)),
      },
    ],
    isError: true,
  };
}

function createErrorResult(text: string): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
    isError: true,
  };
}

function buildGenericFailurePayload(
  code: string,
  message: string,
  recoveryAttempted: boolean,
): GenericFailurePayload {
  const snapshot = getBridgeSnapshot();
  return {
    code,
    message,
    bridgeState: snapshot.bridgeState,
    recoveryAttempted,
    summary: code === 'TABRIX_TOOL_CALL_EXCEPTION' ? '工具调用发生异常。' : '工具调用失败。',
    hint:
      code === 'TABRIX_TOOL_CALL_EXCEPTION'
        ? '请记录当前错误信息后重试，若持续失败可重新执行一次请求。'
        : '请根据提示内容进行一次重试，必要时联系支持核实环境。',
    nextAction: null,
  };
}

async function invokeExtensionCommand(
  action: 'call_tool' | 'list_published_flows',
  payload: any,
  timeoutMs: number,
): Promise<any> {
  const snapshot = getBridgeSnapshot();
  if (snapshot.commandChannelConnected && bridgeCommandChannel.isConnected()) {
    return await bridgeCommandChannel.sendCommand(action, payload, timeoutMs);
  }

  if (action === 'call_tool') {
    return await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      payload,
      NativeMessageType.CALL_TOOL,
      timeoutMs,
    );
  }

  return await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
    {},
    'rr_list_published_flows',
    timeoutMs,
  );
}

async function listDynamicFlowTools(): Promise<Tool[]> {
  try {
    const response = await invokeExtensionCommand('list_published_flows', {}, 20000);
    if (response && response.status === 'success' && Array.isArray(response.items)) {
      const tools: Tool[] = [];
      for (const item of response.items) {
        const name = `flow.${item.slug}`;
        const description =
          (item.meta && item.meta.tool && item.meta.tool.description) ||
          item.description ||
          'Recorded flow';
        const properties: Record<string, any> = {};
        const required: string[] = [];
        for (const v of item.variables || []) {
          const desc = v.label || v.key;
          const typ = (v.type || 'string').toLowerCase();
          const prop: any = { description: desc };
          if (typ === 'boolean') prop.type = 'boolean';
          else if (typ === 'number') prop.type = 'number';
          else if (typ === 'enum') {
            prop.type = 'string';
            if (v.rules && Array.isArray(v.rules.enum)) prop.enum = v.rules.enum;
          } else if (typ === 'array') {
            // default array of strings; can extend with itemType later
            prop.type = 'array';
            prop.items = { type: 'string' };
          } else {
            prop.type = 'string';
          }
          if (v.default !== undefined) prop.default = v.default;
          if (v.rules && v.rules.required) required.push(v.key);
          properties[v.key] = prop;
        }
        // Run options
        properties['tabTarget'] = { type: 'string', enum: ['current', 'new'], default: 'current' };
        properties['refresh'] = { type: 'boolean', default: false };
        properties['captureNetwork'] = { type: 'boolean', default: false };
        properties['returnLogs'] = { type: 'boolean', default: false };
        properties['timeoutMs'] = { type: 'number', minimum: 0 };
        const tool: Tool = {
          name,
          description,
          inputSchema: { type: 'object', properties, required },
        };
        tools.push(tool);
      }
      return tools;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export const setupTools = (server: McpServer) => {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const dynamicTools = await listDynamicFlowTools();
    const byEnv = filterToolsByEnvironment([...TOOL_SCHEMAS, ...dynamicTools]);
    const byPolicy = filterToolsByPolicy(byEnv);
    return { tools: filterToolsByCapability(byPolicy, getCurrentCapabilityEnv()) };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

export const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  const task = sessionManager.createTask({
    taskType: name.startsWith('flow.') ? 'flow-call' : 'tool-call',
    title: `Execute ${name}`,
    intent: `Run MCP tool ${name}`,
    origin: 'mcp',
    labels: ['mcp', name.startsWith('flow.') ? 'flow' : 'tool'],
  });
  const session = sessionManager.startSession({
    taskId: task.taskId,
    transport: 'mcp',
    clientName: 'mcp-server',
  });
  const step = sessionManager.startStep({
    sessionId: session.sessionId,
    toolName: name,
    stepType: name.startsWith('flow.') ? 'flow_call' : 'tool_call',
    inputSummary: JSON.stringify(args ?? {}),
  });

  try {
    const dynamicTools = await listDynamicFlowTools();
    const allowedTools = filterToolsByEnvironment([...TOOL_SCHEMAS, ...dynamicTools]);

    if (!isToolAllowed(name, allowedTools)) {
      const result = createErrorResult(
        `Tool "${name}" is disabled or not available in the current server configuration.`,
      );
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'tool_not_available',
        errorSummary: `Tool "${name}" is disabled or unavailable`,
        resultSummary: 'Tool rejected by current configuration',
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} rejected by configuration`,
      });
      return result;
    }

    if (!isToolAllowedByPolicy(name, process.env)) {
      const result = createPolicyDeniedResult(name);
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'policy_denied_p3',
        errorSummary: `Tool "${name}" blocked by Tabrix Policy (P3 opt-in required)`,
        resultSummary: 'Tool rejected by Tabrix Policy',
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} rejected by Tabrix Policy`,
      });
      return result;
    }

    // Capability gate (defense-in-depth — `filterToolsByCapability`
    // already removed disabled tools from `listTools`, but a curious
    // client may still try to call one directly). Returns the same
    // `denied / capability_off` payload shape the experience_replay
    // handler would produce, so callers branch on `error.code` not on
    // the source of the denial.
    const requiredCapability = getRequiredCapability(name);
    if (requiredCapability && !isCapabilityEnabled(requiredCapability, getCurrentCapabilityEnv())) {
      const result = createCapabilityDeniedResult(name, requiredCapability);
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'capability_off',
        errorSummary: `Tool "${name}" denied — capability '${requiredCapability}' is not enabled`,
        resultSummary: `Tool ${name} denied by capability gate`,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} denied by capability gate`,
      });
      return result;
    }

    // Resolve the task context BEFORE we branch into the native handler
    // so `tabrix_choose_context` (a native-handled tool) can write its
    // decision into the same `TaskSessionContext` the `chrome_read_page`
    // shim later peeks. Auto-keying covers the schema-strict client case
    // (chooser's public schema does not advertise `taskSessionId /
    // tabId`) so the pair lands on the same `mcp:auto:tab:<id|default>`
    // key without spying on `getTaskContext`. Tools outside the auto set
    // still get the freshly-minted internal `taskId` fallback so their
    // contract is preserved bit-for-bit.
    const bridgeForKeyEarly = bridgeRuntimeState.getSnapshot();
    const externalTaskKeyEarly = resolveTaskContextKey(name, args, {
      primaryTabId: bridgeForKeyEarly.primaryTabId,
    });
    const taskContextEarly = externalTaskKeyEarly
      ? sessionManager.getOrCreateExternalTaskContext(externalTaskKeyEarly)
      : sessionManager.getTaskContext(task.taskId);

    // Native-handled tools short-circuit the extension round-trip — see
    // `mcp/native-tool-handlers.ts`. Currently Experience read-side
    // queries, the context selector, and the `experience_replay`
    // write-side tool qualify; everything else still goes through the
    // Chrome extension via `invokeExtensionCommand`.
    const nativeHandler = getNativeToolHandler(name);
    if (nativeHandler) {
      // Only the experience_replay handler needs the bridge adapter +
      // per-step recorder + intent re-tagger. The other native handlers
      // ignore them, but always passing them keeps the deps shape
      // uniform.
      const replayDeps =
        name === TOOL_NAMES.EXPERIENCE.REPLAY ? buildReplayDeps(session.sessionId) : {};
      const nativeResult = await nativeHandler(args, {
        sessionManager,
        capabilityEnv: getCurrentCapabilityEnv(),
        // Carries the `TaskSessionContext` the `tabrix_choose_context`
        // handler writes into via `noteChooseContextDecision`. `null`
        // for tools outside the auto-key set when there is no live
        // external context; handlers that do not need it (e.g.
        // experience suggest / record-outcome) ignore the field.
        taskContext: taskContextEarly,
        ...replayDeps,
      });
      if (nativeResult.isError) {
        let errorSummary = `Native tool ${name} failed`;
        const firstContent = nativeResult.content?.[0];
        if (firstContent && firstContent.type === 'text') {
          const text = String(firstContent.text ?? '');
          if (text) {
            try {
              const parsed = JSON.parse(text) as { message?: string };
              if (parsed && typeof parsed.message === 'string') errorSummary = parsed.message;
            } catch {
              // Non-JSON error payload — fall back to the generic summary.
            }
          }
        }
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'failed',
          errorCode: 'native_tool_error',
          errorSummary,
          resultSummary: `Native tool ${name} failed`,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'failed',
          summary: `Native tool ${name} failed`,
        });
        return nativeResult;
      }
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'completed',
        resultSummary: `Native tool ${name} completed`,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'completed',
        summary: `Native tool ${name} completed`,
      });
      return nativeResult;
    }

    // If calling a dynamic flow tool (name starts with flow.), proxy to common flow-run tool
    if (name && name.startsWith('flow.')) {
      // We need to resolve flow by slug to ID
      try {
        const resp = await invokeExtensionCommand('list_published_flows', {}, 20000);
        const items = (resp && resp.items) || [];
        const slug = name.slice('flow.'.length);
        const match = items.find((it: any) => it.slug === slug);
        if (!match) throw new Error(`Flow not found for tool ${name}`);
        const flowArgs = { flowId: match.id, args };
        const { response: proxyRes, bridgeFailure } = await callWithBridgeRecovery(
          () =>
            invokeExtensionCommand(
              'call_tool',
              { name: 'record_replay_flow_run', args: flowArgs },
              120000,
            ),
          `flow:${name}`,
        );
        if (proxyRes.status === 'success') {
          const postResult = runPostProcessor({
            toolName: name,
            rawResult: proxyRes.data,
            stepId: step.stepId,
            sessionId: session.sessionId,
            sessionManager,
            args,
          });
          const normalized = normalizeToolCallResult(name, postResult.rawResult);
          sessionManager.completeStep(session.sessionId, step.stepId, {
            status: 'completed',
            resultSummary: normalized.stepSummary,
            artifactRefs:
              postResult.extraArtifactRefs.length > 0 ? postResult.extraArtifactRefs : undefined,
          });
          sessionManager.finishSession(session.sessionId, {
            status: 'completed',
            summary: normalized.executionResult.summary,
          });
          return postResult.rawResult;
        }
        const result = createErrorResult(
          bridgeFailure
            ? JSON.stringify(bridgeFailure)
            : `Error calling dynamic flow tool: ${proxyRes.error}`,
        );
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'failed',
          errorCode: bridgeFailure ? bridgeFailure.code.toLowerCase() : 'dynamic_flow_error',
          errorSummary: bridgeFailure
            ? bridgeFailure.message
            : String(proxyRes.error || 'Unknown dynamic flow error'),
          resultSummary: `Dynamic flow ${name} failed`,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'failed',
          summary: `Dynamic flow ${name} failed`,
        });
        return result;
      } catch (err: any) {
        const result = createErrorResult(
          `Error resolving dynamic flow tool: ${err?.message || String(err)}`,
        );
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'failed',
          errorCode: 'dynamic_flow_resolution_error',
          errorSummary: err?.message || String(err),
          resultSummary: `Dynamic flow ${name} could not be resolved`,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'failed',
          summary: `Dynamic flow ${name} resolution failed`,
        });
        return result;
      }
    }
    // Primary Tab Controller hook. When
    // `TABRIX_PRIMARY_TAB_ENFORCE=true`, inject `tabId: primaryTabId`
    // into `chrome_navigate` args before forwarding to the extension so
    // multi-site flows reuse the primary tab. When the env flag is off
    // (default), `getInjectedTabId()` returns null and `args` is
    // forwarded unchanged — bit-identical to legacy behaviour. The
    // `args.tabId` caller-provided value always wins so allowlisted
    // scenarios that explicitly want a fresh tab still get it.
    const primaryTabController = getDefaultPrimaryTabController();
    let outgoingArgs: any = args;
    if (name === 'chrome_navigate') {
      const callerSuppliedTabId =
        args && typeof args === 'object' && Number.isInteger((args as any).tabId);
      if (!callerSuppliedTabId) {
        const injected = primaryTabController.getInjectedTabId();
        if (injected !== null) {
          outgoingArgs = { ...args, tabId: injected };
        }
      }
    }
    // Task Session Context read-budget gate. Only the `chrome_read_page`
    // hot path is gated; everything else passes through. The gate is
    // fail-soft: when no task context is attached (persistence off, or
    // `startSession` was bypassed) we forward the call unchanged so the
    // legacy happy path is preserved bit-for-bit.
    //
    // Resolve the gate's task key from a ladder that BOTH honours an
    // explicit caller-supplied key AND remains usable for
    // schema-following MCP clients that cannot see `taskSessionId /
    // taskId / clientTaskId` (those names are not in the public
    // `chrome_read_page` schema, so a strict client may strip them on
    // the wire). See `resolveTaskContextKey` above for the full ladder;
    // the short version is: explicit > args.tabId > bridge.primaryTabId
    // > single-process `mcp:auto:tab:default`. Auto-keying only fires
    // for `chrome_read_page` and `chrome_navigate`, so click/fill /
    // navigate-adjacent tools cannot mint phantom contexts.
    //
    // When `resolveTaskContextKey` returns null (only possible for
    // tools outside the auto set without an explicit key), we fall
    // back to the freshly-minted internal `taskId` so the contract for
    // those tools is preserved bit-for-bit.
    //
    // Decisions returned by `shouldAllowReadPage`:
    //   * `read_budget_exceeded` → return a structured warning
    //     CallToolResult immediately, WITHOUT a bridge round-trip.
    //   * `read_redundant`       → same: avoid the round-trip and
    //     point the agent at its previous projection.
    //   * `layer_demotion` / `''` → forward to the bridge as usual.
    //
    // `chrome_navigate` resolves the SAME key so a navigate followed
    // by a read on the same tab shares one context — `noteUrlChange`
    // wipes `lastReadLayer` / `targetRefsSeen` and the next read is
    // treated as a fresh first read on the new page.
    // Reuse the same `TaskSessionContext` we resolved before the
    // native-handler branch. Re-resolving here would be functionally
    // equivalent under the current
    // `getOrCreateExternalTaskContext` LRU semantics, but the fewer
    // resolution sites the harder it is for a future edit to drift
    // the chooser-write and reader-peek apart.
    const taskContext = taskContextEarly;
    // When the orchestrator returns `'fallback_required'` we MUST
    // forward to the bridge with the clamped fallback entry layer (`L0`
    // / `L0+L1`), never the caller's original `requestedLayer`.
    // Otherwise an upstream `requestedLayer='L0+L1+L2'` (the schema
    // default) would silently re-widen the read on the failure path.
    // `null` means "no fallback fired, keep the caller's original layer
    // bit-identical to the legacy path".
    let forcedReadPageLayer: 'L0' | 'L0+L1' | null = null;
    let operationLogHint: ReadPageOperationLogHint | null = null;
    let apiFallbackEvidence: ApiReadFallbackEvidence | null = null;
    if (taskContext && name === 'chrome_read_page') {
      const acceptanceApiFaultForLiveObserved = readAcceptanceApiFault(args);
      const liveObserved = acceptanceApiFaultForLiveObserved
        ? null
        : taskContext.peekLiveObservedApiData();
      if (liveObserved) {
        taskContext.noteSkipRead({
          source: liveObserved.selectedDataSource === 'api_detail' ? 'api_detail' : 'api_list',
          layer: 'L0+L1',
          tokensSavedEstimate: 0,
          actionPathId: null,
          apiFamily: liveObserved.endpointFamily,
        });
        const totals = taskContext.getTaskTotals();
        const { result: apiCallResult, operationLog } = buildLiveObservedApiRowsSuccessResult({
          liveObserved,
          taskTotals: totals,
        });
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'completed',
          resultSummary: 'chrome_read_page fulfilled via current-task observed API data',
          operationLog,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'completed',
          summary: 'chrome_read_page fulfilled via current-task observed API data',
        });
        return apiCallResult;
      }
      const liveObservedEvidence = taskContext.peekLiveObservedApiEvidence();
      if (liveObservedEvidence.length > 0) {
        operationLogHint = buildLiveObservedRejectedLogHint(liveObservedEvidence);
      }
      // Skip-read orchestrator hook. We consult it BEFORE the existing
      // budget gate because a `'skip'` plan means we never round-trip
      // the bridge AND never spend the budget on a read we proved we
      // could avoid.
      //
      // Hard rules:
      //   * The orchestrator only fires when `choose_context` has
      //     ALREADY recorded a decision into this task context. Any
      //     in-flight read without a recorded decision keeps the
      //     legacy happy path bit-identical.
      //   * On `'skip'` we return a STRUCTURED skip envelope —
      //     never a synthetic `chrome_read_page` compact payload.
      //     A consumer can tell the read was avoided by the explicit
      //     `kind: 'read_page_skipped'` discriminator.
      //   * On `'fallback_required'` / `'forward'` we drop straight
      //     into the existing budget gate so the legacy short-circuit
      //     warnings still fire.
      const recordedDecision = taskContext.peekChooseContextDecision();
      if (recordedDecision !== null) {
        const skipPlan: SkipReadPlan = planSkipRead({
          decision: recordedDecision,
          taskCtx: {
            readPageCount: taskContext.readPageCount,
            readBudget: taskContext.readBudget,
            lastReadLayer: taskContext.lastReadLayer,
            currentUrl: taskContext.currentUrl,
          },
        });
        if (skipPlan.action === 'skip') {
          if (skipPlan.requiresApiCall) {
            const cap = recordedDecision.apiCapability;
            const acceptanceApiFault = readAcceptanceApiFault(args);
            // When `tabrix_choose_context` already executed the API
            // inline (executionMode='direct_api'), reuse the cached rows
            // verbatim instead of re-issuing the request. One
            // user-visible task maps to one API round-trip. The
            // acceptance-fault override is only honoured when the cached
            // result is absent so tests can still simulate a fresh-API
            // failure path.
            const cachedDirect =
              recordedDecision.executionMode === 'direct_api' &&
              recordedDecision.directApiResult &&
              !acceptanceApiFault
                ? recordedDecision.directApiResult
                : null;
            const apiResult = cachedDirect
              ? ({
                  status: 'ok' as const,
                  endpointFamily: cachedDirect.endpointFamily,
                  dataPurpose: cachedDirect.dataPurpose,
                  rows: cachedDirect.rows,
                  rowCount: cachedDirect.rowCount,
                  compact: cachedDirect.compact,
                  rawBodyStored: cachedDirect.rawBodyStored,
                  // Surface the cached empty-result envelope so the
                  // shim consumes the same closed shape regardless of
                  // whether the chooser executed inline or the shim
                  // issued the read here.
                  emptyResult: cachedDirect.emptyResult,
                  emptyReason: cachedDirect.emptyReason,
                  emptyMessage: cachedDirect.emptyMessage,
                  telemetry: cachedDirect.telemetry,
                } as Awaited<ReturnType<typeof readApiKnowledgeEndpointPlan>>)
              : await readApiKnowledgeEndpointPlan({
                  endpointFamily: cap?.family ?? '',
                  dataPurpose: apiFaultDataPurposeOverride(acceptanceApiFault, cap?.dataPurpose),
                  method: 'GET',
                  params: cap?.params ?? {},
                  fetchFn: apiFaultFetchOverride(acceptanceApiFault),
                });
            if (apiResult.status === 'ok') {
              const tokenSavings = estimateApiRowsTokenSavings({
                rows: apiResult.rows,
                rowCount: apiResult.rowCount,
                recordedFullReadTokenEstimate: recordedDecision.fullReadTokenEstimate,
                // When the API returned a verified-empty result we
                // MUST NOT inflate `tokensSavedEstimate` off a
                // hypothetical full-read estimate; pin it to the
                // conservative `unavailable_empty_api_rows` bucket.
                emptyResult: apiResult.emptyResult ?? false,
              });
              taskContext.noteSkipRead({
                source: skipPlan.sourceKind,
                layer: recordedDecision.chosenLayer,
                tokensSavedEstimate: tokenSavings.tokensSavedEstimate,
                actionPathId: null,
                apiFamily: apiResult.endpointFamily,
              });
              const totals = taskContext.getTaskTotals();
              const { result: apiCallResult, operationLog } = buildKnowledgeApiRowsSuccessResult({
                recordedDecision,
                skipPlan,
                apiResult,
                tokenSavings,
                endpointSource: cachedDirect?.endpointSource ?? 'seed_adapter',
                taskTotals: totals,
              });
              sessionManager.completeStep(session.sessionId, step.stepId, {
                status: 'completed',
                resultSummary: `chrome_read_page fulfilled via ${skipPlan.sourceKind} (saved ~${tokenSavings.tokensSavedEstimate} tok)`,
                operationLog,
              });
              sessionManager.finishSession(session.sessionId, {
                status: 'completed',
                summary: `chrome_read_page fulfilled via ${skipPlan.sourceKind}`,
              });
              return apiCallResult;
            }
            const fallbackCause = normalizeApiFallbackCause(apiResult.reason);
            forcedReadPageLayer = apiResult.fallbackEntryLayer;
            apiFallbackEvidence = {
              kind: 'read_page_fallback',
              readPageAvoided: false,
              sourceKind: 'dom_json',
              sourceRoute: skipPlan.sourceRoute,
              fallbackCause,
              fallbackUsed: 'dom_compact',
              fallbackEntryLayer: apiResult.fallbackEntryLayer,
              apiFamily: apiResult.endpointFamily,
              apiTelemetry: apiResult.telemetry,
            };
            operationLogHint = {
              requestedLayer: apiResult.fallbackEntryLayer,
              selectedDataSource: 'dom_json',
              sourceRoute: skipPlan.sourceRoute,
              decisionReason: fallbackCause,
              resultKind: 'read_page_fallback',
              fallbackUsed: 'dom_compact',
            };
          } else {
            taskContext.noteSkipRead({
              source: skipPlan.sourceKind,
              layer: recordedDecision.chosenLayer,
              tokensSavedEstimate: skipPlan.tokensSavedEstimate,
              actionPathId: recordedDecision.replayCandidate?.actionPathId ?? null,
              apiFamily: recordedDecision.apiCapability?.family ?? null,
            });
            const totals = taskContext.getTaskTotals();
            const skipPayload = {
              kind: 'read_page_skipped',
              readPageAvoided: skipPlan.readPageAvoided,
              sourceKind: skipPlan.sourceKind,
              sourceRoute: skipPlan.sourceRoute,
              chosenSource: recordedDecision.chosenSource ?? skipPlan.sourceKind,
              dataSource: recordedDecision.dataSource ?? skipPlan.sourceKind,
              decisionReason: recordedDecision.decisionReason ?? skipPlan.diagnostic,
              dispatcherInputSource: recordedDecision.dispatcherInputSource ?? null,
              fallbackPlan:
                recordedDecision.fallbackPlan ??
                ({
                  dataSource: 'dom_json',
                  entryLayer: skipPlan.fallbackEntryLayer,
                  reason: skipPlan.diagnostic,
                } as const),
              tokensSavedEstimate: skipPlan.tokensSavedEstimate,
              fallbackUsed: skipPlan.fallbackUsed,
              fallbackEntryLayer: skipPlan.fallbackEntryLayer,
              requiresApiCall: skipPlan.requiresApiCall,
              requiresExperienceReplay: skipPlan.requiresExperienceReplay,
              actionPathId: recordedDecision.replayCandidate?.actionPathId ?? null,
              apiFamily: recordedDecision.apiCapability?.family ?? null,
              diagnostic: skipPlan.diagnostic,
              taskTotals: totals,
            };
            const skipResult: CallToolResult = {
              content: [{ type: 'text', text: JSON.stringify(skipPayload) }],
            };
            sessionManager.completeStep(session.sessionId, step.stepId, {
              status: 'completed',
              resultSummary: `chrome_read_page skipped via ${skipPlan.sourceKind} (saved ~${skipPlan.tokensSavedEstimate} tok)`,
              operationLog: {
                requestedLayer: recordedDecision.chosenLayer,
                selectedDataSource: skipPlan.sourceKind,
                sourceRoute: skipPlan.sourceRoute,
                decisionReason: recordedDecision.decisionReason ?? skipPlan.diagnostic,
                resultKind: 'read_page_skipped',
                fallbackUsed: skipPlan.fallbackUsed,
                readCount: totals.readPageAvoidedCount,
                tokensSaved: skipPlan.tokensSavedEstimate,
              },
            });
            sessionManager.finishSession(session.sessionId, {
              status: 'completed',
              summary: `chrome_read_page skipped via ${skipPlan.sourceKind}`,
            });
            return skipResult;
          }
        }
        // `fallback_required` / `forward` falls through to the existing
        // budget gate path below. The chooser decision stays recorded so
        // a follow-up read on the same page can re-evaluate API
        // availability without needing a fresh chooser run.
        if (skipPlan.action === 'fallback_required') {
          // Pin the bridge-side `requestedLayer` to the orchestrator's
          // clamped fallback entry layer. Used below by the budget gate,
          // the bridge `call_tool` payload, and the post-success
          // `noteReadPage` bookkeeping so the three sites cannot drift
          // back to `'L0+L1+L2'`.
          forcedReadPageLayer = skipPlan.fallbackEntryLayer;
          if (skipPlan.sourceRoute === 'knowledge_supported_read') {
            apiFallbackEvidence = {
              kind: 'read_page_fallback',
              readPageAvoided: false,
              sourceKind: 'dom_json',
              sourceRoute: skipPlan.sourceRoute,
              fallbackCause: 'api_unavailable',
              fallbackUsed: 'dom_compact',
              fallbackEntryLayer: 'L0+L1',
              apiTelemetry: {
                method: 'GET',
                reason: skipPlan.fallbackCause || 'fallback_required',
                status: null,
                waitedMs: 0,
                readAllowed: false,
                fallbackEntryLayer: 'L0+L1',
              },
            };
          }
          operationLogHint = {
            requestedLayer: skipPlan.fallbackEntryLayer,
            selectedDataSource: 'dom_json',
            sourceRoute: skipPlan.sourceRoute,
            decisionReason: skipPlan.diagnostic,
            resultKind: 'read_page_fallback',
            fallbackUsed: skipPlan.fallbackUsed,
          };
        }
      }
      // Read the public `requestedLayer` field (with legacy `layer`
      // fallback) instead of `(args as any).layer`, and default to the
      // MCP-schema default `'L0+L1+L2'` when nothing is supplied. When
      // the orchestrator demanded a fallback, override the
      // caller-supplied layer with the clamped fallback entry layer so
      // the gate decision matches what we are about to forward to the
      // bridge.
      const requestedLayer =
        forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
      const decision = taskContext.shouldAllowReadPage({ requestedLayer });
      if (!decision.allowed || decision.reason === 'read_redundant') {
        const {
          result: warningResult,
          warning,
          operationLog,
        } = buildReadPageWarningResult({
          decision,
          requestedLayer,
          operationLogHint,
        });
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'completed',
          resultSummary: `chrome_read_page short-circuited (${warning})`,
          operationLog,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'completed',
          summary: `chrome_read_page short-circuited (${warning})`,
        });
        return warningResult;
      }
    }
    if (taskContext && name === 'chrome_navigate') {
      const url =
        args && typeof args === 'object' && typeof (args as any).url === 'string'
          ? ((args as any).url as string)
          : null;
      taskContext.noteUrlChange(url);
    }
    // When the orchestrator demanded a fallback for `chrome_read_page`,
    // replace the caller's `requestedLayer` (which may be the schema
    // default `'L0+L1+L2'`) with the clamped fallback entry layer (`L0`
    // / `L0+L1`). Every other field on `args` (`tabId` / `windowId` /
    // `refId` / …) is preserved verbatim so call-site contracts that
    // rely on them are unaffected.
    if (name === 'chrome_read_page' && forcedReadPageLayer) {
      outgoingArgs = {
        ...(outgoingArgs && typeof outgoingArgs === 'object' ? outgoingArgs : {}),
        requestedLayer: forcedReadPageLayer,
      };
    }
    if (name === 'chrome_read_page') {
      outgoingArgs = stripInternalReadPageArgs(outgoingArgs);
    }
    const { response, bridgeFailure } = await callWithBridgeRecovery(
      () =>
        invokeExtensionCommand(
          'call_tool',
          {
            name,
            args: outgoingArgs,
          },
          120000,
        ),
      `tool:${name}`,
    );
    // Regardless of the enforcement gate, observe every
    // `chrome_navigate` outcome so the bridge runtime snapshot exposes
    // hygiene metrics (`primaryTabReuseRate`, `benchmarkOwnedTabCount`)
    // that benchmark transformers and any operator UI can read.
    // Defensive: tolerate missing / malformed `tabId` in the response
    // without throwing.
    if (name === 'chrome_navigate') {
      const responseTabId =
        response &&
        response.status === 'success' &&
        response.data &&
        typeof response.data === 'object'
          ? extractTabIdFromCallToolResult(response.data)
          : null;
      const url =
        args && typeof args === 'object' && typeof (args as any).url === 'string'
          ? ((args as any).url as string)
          : null;
      primaryTabController.recordNavigation({ returnedTabId: responseTabId, url });
      const ptSnapshot = primaryTabController.getSnapshot();
      bridgeRuntimeState.setPrimaryTabSnapshot({
        primaryTabId: ptSnapshot.primaryTabId,
        primaryTabReuseRate: ptSnapshot.primaryTabReuseRate,
        benchmarkOwnedTabCount: ptSnapshot.benchmarkOwnedTabCount,
      });
    }
    if (response.status === 'success') {
      const postResult = runPostProcessor({
        toolName: name,
        rawResult: response.data,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager,
        taskContext: taskContextEarly,
        args,
      });
      const rawResultWithEvidence = withFallbackEvidence(postResult.rawResult, apiFallbackEvidence);
      let readPageRecorded = false;
      const recordSuccessfulReadPage = (
        source: 'unknown' | 'dom_region_rows',
        targetRefs?: ReadonlyArray<string> | null,
      ): void => {
        if (readPageRecorded || name !== 'chrome_read_page' || !taskContext) return;
        if (postResult.rawResult.isError === true) return;
        const requestedLayer =
          forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
        taskContext.noteReadPage({
          layer: requestedLayer,
          source,
          targetRefs,
        });
        readPageRecorded = true;
      };
      if (name === 'chrome_read_page' && taskContext && rawResultWithEvidence.isError !== true) {
        const visibleRows = taskContext.peekVisibleRegionRows();
        if (visibleRows) {
          const requestedLayer =
            forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
          const recordedDecisionForRows = taskContext.peekChooseContextDecision();
          const apiUnavailableReason =
            apiFallbackEvidence?.fallbackCause ??
            operationLogHint?.decisionReason ??
            'api_rows_unavailable_dom_region_rows_available';
          const routerDecision = routeDataSource({
            sourceRoute: recordedDecisionForRows?.sourceRoute ?? 'read_page_required',
            chosenLayer: recordedDecisionForRows?.chosenLayer ?? requestedLayer,
            layerDispatchReason: recordedDecisionForRows?.decisionReason,
            apiCandidateAvailable: false,
            dispatcherInputSource: recordedDecisionForRows?.dispatcherInputSource ?? null,
            taskIntent: inferDomRegionRowsTaskIntent(recordedDecisionForRows, visibleRows),
            readinessVerdict: 'ready',
            domRegionRowsEvidence: taskContext.peekVisibleRegionRowsEvidence(),
          });

          if (routerDecision.selectedDataSource === 'dom_region_rows') {
            recordSuccessfulReadPage(
              'dom_region_rows',
              visibleRows.rows
                .map((row) => row.targetRef)
                .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0),
            );
            const layerContract = mapDataSourceToLayerContract({
              dataSource: 'dom_region_rows',
              requestedLayer,
              fallbackEntryLayer: 'L0+L1',
            });
            const { result: domRowsResult, operationLog } = buildDomRegionRowsSuccessResult({
              requestedLayer,
              routerDecision,
              layerContract,
              visibleRows,
              apiRowsUnavailableReason: apiUnavailableReason,
              readCount: taskContext.readPageCount,
            });
            sessionManager.completeStep(session.sessionId, step.stepId, {
              status: 'completed',
              resultSummary: 'chrome_read_page fulfilled via visible DOM region rows',
              artifactRefs:
                postResult.extraArtifactRefs.length > 0 ? postResult.extraArtifactRefs : undefined,
              operationLog,
            });
            sessionManager.finishSession(session.sessionId, {
              status: 'completed',
              summary: 'chrome_read_page fulfilled via visible DOM region rows',
            });
            return domRowsResult;
          }

          const rejectedReason = buildVisibleRowsRejectionReason(visibleRows);
          operationLogHint = buildDomRegionRowsRejectedLogHint({
            existing: operationLogHint,
            visibleRows,
            rejectedReason,
            apiRowsUnavailableReason: apiUnavailableReason,
            routerDecision,
          });
        }
      }
      // Record a successful chrome_read_page so the budget reflects
      // bridge-confirmed reads (failed reads do NOT consume the budget).
      // dom_region_rows may replace the payload, but it is still one
      // bridge-confirmed read_page call.
      recordSuccessfulReadPage('unknown');
      const normalized = normalizeToolCallResult(name, rawResultWithEvidence);
      const toolResultFailed = rawResultWithEvidence.isError === true;
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'completed',
        resultSummary: normalized.stepSummary,
        artifactRefs:
          postResult.extraArtifactRefs.length > 0 ? postResult.extraArtifactRefs : undefined,
        operationLog:
          name === 'chrome_read_page'
            ? {
                ...(operationLogHint ?? {}),
                requestedLayer:
                  operationLogHint?.requestedLayer ??
                  extractRequestedLayer(outgoingArgs) ??
                  READ_PAGE_DEFAULT_LAYER,
                selectedDataSource: operationLogHint?.selectedDataSource ?? 'dom_json',
                resultKind:
                  operationLogHint?.resultKind ??
                  (toolResultFailed ? 'read_page_failed' : 'read_page'),
                success: operationLogHint?.success ?? (toolResultFailed ? false : undefined),
                decisionReason:
                  operationLogHint?.decisionReason ??
                  (toolResultFailed ? 'read_page_tool_error' : undefined),
              }
            : undefined,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'completed',
        summary: normalized.executionResult.summary,
      });
      return rawResultWithEvidence;
    } else {
      const responseError = String(response.error || 'Unknown tool error');
      const isBridgeError =
        Boolean(bridgeFailure) ||
        responseError.includes('TABRIX_BRIDGE_') ||
        isRecoverableBridgeIssue(responseError);
      const failurePayload = bridgeFailure
        ? bridgeFailure
        : buildGenericFailurePayload(
            isBridgeError ? 'TABRIX_BRIDGE_OPERATION_ERROR' : 'TABRIX_TOOL_CALL_FAILED',
            responseError,
            false,
          );
      const result = createErrorResult(JSON.stringify(failurePayload));
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: bridgeFailure
          ? bridgeFailure.code.toLowerCase()
          : isBridgeError
            ? 'browser_bridge_not_ready'
            : 'tool_call_error',
        errorSummary: bridgeFailure ? bridgeFailure.message : responseError,
        resultSummary: `Tool ${name} failed`,
        operationLog:
          name === 'chrome_read_page'
            ? {
                ...(operationLogHint ?? {}),
                requestedLayer:
                  operationLogHint?.requestedLayer ??
                  extractRequestedLayer(outgoingArgs) ??
                  READ_PAGE_DEFAULT_LAYER,
                selectedDataSource: operationLogHint?.selectedDataSource ?? 'dom_json',
                resultKind: 'read_page_failed',
                decisionReason:
                  operationLogHint?.decisionReason ??
                  (bridgeFailure ? bridgeFailure.code : 'tool_call_error'),
                success: false,
              }
            : undefined,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} failed`,
      });
      return result;
    }
  } catch (error: any) {
    const result = createErrorResult(
      JSON.stringify(
        buildGenericFailurePayload(
          'TABRIX_TOOL_CALL_EXCEPTION',
          error?.message || String(error),
          false,
        ),
      ),
    );
    sessionManager.completeStep(session.sessionId, step.stepId, {
      status: 'failed',
      errorCode: 'tool_call_exception',
      errorSummary: error.message,
      resultSummary: `Tool ${name} threw an exception`,
    });
    sessionManager.finishSession(session.sessionId, {
      status: 'failed',
      summary: `Tool ${name} threw an exception`,
    });
    return result;
  }
};
