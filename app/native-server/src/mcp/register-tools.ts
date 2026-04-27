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
  READ_PAGE_REQUESTED_LAYER_VALUES,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  getRequiredCapability,
  getToolRiskTier,
  isCapabilityGatedTool,
  isExplicitOptInTool,
  type ReadPageRequestedLayer,
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
import {
  readApiKnowledgeEndpointPlan,
  type ApiKnowledgeFetch,
  type ApiKnowledgeReadFallback,
} from '../api/api-knowledge';
import { mapDataSourceToLayerContract } from '../execution/layer-contract';
import { runPostProcessor } from './tool-post-processors';
import { getNativeToolHandler } from './native-tool-handlers';
import type {
  DispatchBridgedFn,
  ReplayOutcomeWriter,
  ReplayStepRecorder,
  SupportedReplayToolName,
} from './experience-replay';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bridgeRuntimeState, type BridgeRuntimeSnapshot } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { getDefaultPrimaryTabController } from '../runtime/primary-tab-controller';
import { collectRuntimeConsistencySnapshot } from '../scripts/runtime-consistency';
import {
  readPersistedBrowserLaunchConfig,
  resolveAndPersistBrowserLaunchConfig,
} from '../browser-launch-config';
import { BrowserType, resolveBrowserExecutable } from '../scripts/browser-config';
import { describeBridgeRecoveryGuidance } from '../scripts/bridge-recovery-guidance';

/**
 * Tools with elevated risk: arbitrary JS execution, data deletion, file system
 * interaction. When MCP_DISABLE_SENSITIVE_TOOLS=true, these are hidden from
 * the tool list unless explicitly allowed via ENABLE_MCP_TOOLS.
 */
export const SENSITIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'chrome_javascript',
  'chrome_bookmark_delete',
  'chrome_upload_file',
]);

function parseToolList(value?: string): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function estimateJsonTokens(value: unknown): number {
  try {
    return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4);
  } catch {
    return 0;
  }
}

function estimateApiRowsTokenSavings(args: {
  rows: unknown[];
  rowCount: number;
  recordedFullReadTokenEstimate: number;
}): {
  tokenEstimateChosen: number;
  tokenEstimateFullRead: number;
  tokensSavedEstimate: number;
  tokensSavedEstimateSource:
    | 'full_read_estimate_minus_api_rows'
    | 'api_rows_payload_floor'
    | 'unavailable_empty_api_rows';
} {
  const tokenEstimateChosen = estimateJsonTokens({
    kind: 'api_rows',
    rows: args.rows,
    rowCount: args.rowCount,
    compact: true,
  });
  if (args.recordedFullReadTokenEstimate > tokenEstimateChosen) {
    const tokenEstimateFullRead = Math.floor(args.recordedFullReadTokenEstimate);
    return {
      tokenEstimateChosen,
      tokenEstimateFullRead,
      tokensSavedEstimate: tokenEstimateFullRead - tokenEstimateChosen,
      tokensSavedEstimateSource: 'full_read_estimate_minus_api_rows',
    };
  }
  if (args.rowCount > 0) {
    const rowsOnlyEstimate = estimateJsonTokens(args.rows);
    const tokenEstimateFullRead = tokenEstimateChosen + rowsOnlyEstimate;
    return {
      tokenEstimateChosen,
      tokenEstimateFullRead,
      tokensSavedEstimate: rowsOnlyEstimate,
      tokensSavedEstimateSource: 'api_rows_payload_floor',
    };
  }
  return {
    tokenEstimateChosen,
    tokenEstimateFullRead: Math.max(0, Math.floor(args.recordedFullReadTokenEstimate)),
    tokensSavedEstimate: 0,
    tokensSavedEstimateSource: 'unavailable_empty_api_rows',
  };
}

type ApiReadFallbackCauseV26 = 'api_timeout' | 'semantic_mismatch' | 'api_unavailable';
type AcceptanceApiFaultV26 = 'network_timeout' | 'semantic_mismatch';

interface ApiReadFallbackEvidenceV26 {
  kind: 'read_page_fallback';
  readPageAvoided: false;
  sourceKind: 'dom_json';
  sourceRoute: string;
  fallbackCause: ApiReadFallbackCauseV26;
  fallbackUsed: 'dom_compact';
  fallbackEntryLayer: 'L0+L1';
  apiFamily?: string;
  apiTelemetry: ApiKnowledgeReadFallback['telemetry'];
}

function normalizeApiFallbackCause(reason: string | null | undefined): ApiReadFallbackCauseV26 {
  if (reason === 'network_timeout') return 'api_timeout';
  if (reason === 'semantic_mismatch') return 'semantic_mismatch';
  return 'api_unavailable';
}

function readAcceptanceApiFault(args: unknown): AcceptanceApiFaultV26 | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const value = (args as { __tabrixAcceptanceApiFault?: unknown }).__tabrixAcceptanceApiFault;
  return value === 'network_timeout' || value === 'semantic_mismatch' ? value : null;
}

function apiFaultFetchOverride(fault: AcceptanceApiFaultV26 | null): ApiKnowledgeFetch | undefined {
  if (fault !== 'network_timeout') return undefined;
  return () => new Promise(() => undefined);
}

function apiFaultDataPurposeOverride(
  fault: AcceptanceApiFaultV26 | null,
  current: string | undefined,
): string | undefined {
  if (fault !== 'semantic_mismatch') return current;
  return current === 'issue_list' ? 'search_list' : 'issue_list';
}

function stripInternalReadPageArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const out = { ...(args as Record<string, unknown>) };
  delete out.__tabrixAcceptanceApiFault;
  return out;
}

function withFallbackEvidence(
  rawResult: CallToolResult,
  evidence: ApiReadFallbackEvidenceV26 | null,
): CallToolResult {
  if (!evidence || !Array.isArray(rawResult.content)) return rawResult;

  let attached = false;
  const content = rawResult.content.map((item) => {
    if (
      attached ||
      !item ||
      typeof item !== 'object' ||
      (item as { type?: unknown }).type !== 'text' ||
      typeof (item as { text?: unknown }).text !== 'string'
    ) {
      return item;
    }

    try {
      const parsed = JSON.parse((item as { text: string }).text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return item;
      attached = true;
      return {
        ...item,
        text: JSON.stringify({
          ...parsed,
          ...evidence,
        }),
      };
    } catch {
      return item;
    }
  });

  return attached ? { ...rawResult, content } : rawResult;
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
 * V24-01: also injects `requiresExplicitOptIn: true` for tools listed
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
 * V24-01 capability gate. Drops tools listed in
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
 * V24-01 production wiring for the `experience_replay` handler.
 * Binds:
 *   - `dispatchBridged` to the existing `invokeExtensionCommand`
 *     round-trip (with the same recovery-aware wrapper used for
 *     ordinary tool calls).
 *   - `recorder` to `sessionManager.startStep` / `completeStep`
 *     against the wrapper-owned session, so each replayed sub-step
 *     gets its own `memory_steps` row carrying the underlying
 *     tool name (brief §7).
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

  // V24-02: per-step write-back hook. Isolation is enforced TWICE:
  //   1. here, where any thrown SQLite error is caught and downgraded
  //      to a structured warning row (so the user's replay path stays
  //      alive); and
  //   2. inside `ReplayEngine.tryWriteOutcome`, which already wraps
  //      the call in its own try/catch as defense-in-depth.
  // We deliberately swallow the inner `recordWritebackWarning` failure
  // for the same reason the V24-02 handler does — at that point even
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

interface BridgeRecoveryResult {
  attempted: boolean;
  launched: boolean;
  action: 'launch_browser' | 'extension_reconnect' | 'wait_for_extension' | 'none';
  command?: string;
  waitMs: number;
  bridgeStateBefore: string;
  bridgeStateAfter?: string;
  failureCodeHint?: string;
}

interface BridgeFailurePayload {
  code: string;
  message: string;
  bridgeState: string;
  recoveryAttempted: boolean;
  summary: string;
  hint: string;
  nextAction: string | null;
}

interface GenericFailurePayload {
  code: string;
  message: string;
  bridgeState: string;
  recoveryAttempted: boolean;
  summary: string;
  hint: string;
  nextAction: string | null;
}

interface LaunchAttemptResult {
  launched: boolean;
  command?: string;
}

interface LaunchCandidate {
  command: string;
  args: string[];
}

let browserLaunchTestOverride: string[] | null = null;

const platformRuntime = {
  getCurrentPlatform(): NodeJS.Platform {
    return process.platform;
  },
};

const BRIDGE_LAUNCH_WAIT_MS = 12_000;
const BRIDGE_HEARTBEAT_WAIT_MS = 15_000;
const BRIDGE_ATTACH_WAIT_MS = 10_000;
const BRIDGE_RECOVERY_TOTAL_BUDGET_MS = 30_000;
const BRIDGE_RECOVERY_POLL_MS = 500;

function stringifyUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isBrowserAutomationTool(name: string): boolean {
  return name.startsWith('chrome_') || name.startsWith('flow.');
}

function isBrowserAutomationContext(context: string): boolean {
  if (context.startsWith('tool:')) {
    return isBrowserAutomationTool(context.slice('tool:'.length));
  }
  if (context.startsWith('flow:')) {
    return true;
  }
  return false;
}

function isRecoverableBridgeIssue(error: unknown): boolean {
  const message = stringifyUnknownError(error).toLowerCase();
  return (
    message.includes('bridge is unavailable') ||
    message.includes('native host connection not established') ||
    message.includes('native host is shutting down') ||
    message.includes('chrome disconnected') ||
    message.includes('request timed out') ||
    message.includes('not connected')
  );
}

function responseNeedsBridgeRecovery(response: any): boolean {
  if (!response || response.status === 'success') return false;
  return isRecoverableBridgeIssue(response.error || response.message || '');
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getBridgeSnapshot(): BridgeRuntimeSnapshot {
  bridgeRuntimeState.syncBrowserProcessNow();
  return bridgeRuntimeState.getSnapshot();
}

function isHeartbeatFresh(snapshot: BridgeRuntimeSnapshot): boolean {
  return (
    typeof snapshot.extensionHeartbeatAt === 'number' &&
    Date.now() - snapshot.extensionHeartbeatAt <= BRIDGE_HEARTBEAT_WAIT_MS
  );
}

function hasExecutableBridge(snapshot: BridgeRuntimeSnapshot): boolean {
  return snapshot.commandChannelConnected || snapshot.nativeHostAttached;
}

/**
 * v2.6 S1 P1-1 fix — extract a stable, externally-supplied task /
 * session key from a tool-call's `args`. Lookup precedence:
 *
 *   1. `taskSessionId` (preferred — explicit naming)
 *   2. `taskId`        (alias for legacy MCP clients)
 *   3. `clientTaskId`  (alias for clients that already key their
 *                       work by a client-side request id)
 *
 * Returns `null` when nothing usable is found, in which case
 * `handleToolCall` falls back to the v2.5/v2.6 behaviour of using
 * the freshly-minted internal `taskId` (i.e. no cross-call
 * accumulation — strictly preserves the prior contract).
 *
 * Pure: tolerates `null`/non-object args, non-string values, and
 * whitespace-only strings without throwing.
 */
function extractStableTaskKey(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  for (const key of ['taskSessionId', 'taskId', 'clientTaskId'] as const) {
    const raw = obj[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

/**
 * v2.6 S1 P1-2 fix — read the `chrome_read_page` requested layer
 * from tool args using the public schema name (`requestedLayer`)
 * with the legacy `layer` field as a graceful fallback for any
 * historical client. Returns `null` when neither field carries a
 * value belonging to the closed
 * {@link READ_PAGE_REQUESTED_LAYER_VALUES} enum, which the caller
 * turns into the MCP-schema default (`'L0+L1+L2'`).
 *
 * The pre-fix code read `(args as any).layer` exclusively, which
 * silently downgraded every real client request to the gate's
 * internal default and sent the wrong layer to `noteReadPage`. The
 * gate decisions and post-success bookkeeping were therefore
 * decoupled from what the caller actually asked for.
 */
function extractRequestedLayer(args: unknown): ReadPageRequestedLayer | null {
  if (!args || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  for (const key of ['requestedLayer', 'layer'] as const) {
    const raw = obj[key];
    if (typeof raw !== 'string') continue;
    if ((READ_PAGE_REQUESTED_LAYER_VALUES as readonly string[]).includes(raw)) {
      return raw as ReadPageRequestedLayer;
    }
  }
  return null;
}

/**
 * MCP schema default per `packages/shared/src/tools.ts`:
 * "Optional; when omitted preserves the legacy full L0+L1+L2
 * payload." Centralised so the pre-gate and post-success sites
 * cannot drift apart on the default again.
 */
const READ_PAGE_DEFAULT_LAYER: ReadPageRequestedLayer = 'L0+L1+L2';

/**
 * v2.6 S1 last-mile P1 fix — make the read-budget task key visible
 * to schema-following MCP clients that DO NOT (and cannot) pass
 * `taskSessionId / taskId / clientTaskId`, since those fields are
 * not part of the public `chrome_read_page` schema (a strict client
 * may even strip unknown fields).
 *
 * Only `chrome_read_page` (the gated tool), `chrome_navigate` (the
 * tool that invalidates the gate's lastReadLayer / targetRefsSeen
 * via `noteUrlChange`), and `tabrix_choose_context` (V26-03 — the
 * decision writer that the `chrome_read_page` shim consumes via
 * `peekChooseContextDecision`) participate in auto-keying. Every
 * other tool returns `null`, so click/fill/screenshot/etc. cannot
 * accidentally mint phantom external task contexts or pollute the
 * LRU map.
 *
 * V26-03 (B-026) — `tabrix_choose_context` joins the auto set so a
 * chooser → reader pair issued back-to-back without an explicit
 * `taskSessionId` lands on the SAME `TaskSessionContext`. This is
 * the only way the orchestrator can read what the chooser wrote
 * without the test having to spy on `getTaskContext`. The chooser's
 * public schema does not advertise `tabId` either, so the auto
 * fallback (primary tab → `mcp:auto:tab:default`) is what makes the
 * pairing work in the schema-strict path.
 *
 * Resolution order (highest precedence first):
 *
 *   1. Explicit `extractStableTaskKey(args)` — caller already
 *      threaded a stable id through; honour it verbatim. This
 *      preserves the c21ac8b precedence contract bit-for-bit.
 *   2. Auto-key from `args.tabId` (positive integer) — strict
 *      schema clients pass this and the public schema documents it.
 *      Yields `mcp:auto:tab:<id>` so different tabs get isolated
 *      contexts (no cross-tab redundant pollution).
 *   3. Auto-key from `bridgeRuntimeState.primaryTabId` — when the
 *      caller omitted `tabId` and the bridge knows which tab is
 *      primary (e.g. set by an earlier `chrome_navigate`). Same
 *      `mcp:auto:tab:<id>` shape.
 *   4. Auto-key fallback `mcp:auto:tab:default` — single-tab
 *      session, or pre-bridge-ready cold start. URL invalidation
 *      via `chrome_navigate` still keeps redundancy honest inside
 *      this single context.
 *
 * Returning `null` (only possible for tools outside the auto set
 * with no explicit key) preserves the v2.5/v2.6 internal-taskId
 * fallback path in `handleToolCall`.
 */
function resolveTaskContextKey(
  toolName: string,
  args: unknown,
  bridge: { primaryTabId: number | null },
): string | null {
  const explicit = extractStableTaskKey(args);
  if (explicit) return explicit;

  const autoEligible =
    toolName === 'chrome_read_page' ||
    toolName === 'chrome_navigate' ||
    toolName === 'tabrix_choose_context';
  if (!autoEligible) return null;

  const argTabId =
    args && typeof args === 'object' ? (args as Record<string, unknown>).tabId : undefined;
  if (typeof argTabId === 'number' && Number.isInteger(argTabId) && argTabId > 0) {
    return `mcp:auto:tab:${argTabId}`;
  }

  const primary = bridge.primaryTabId;
  if (typeof primary === 'number' && Number.isInteger(primary) && primary > 0) {
    return `mcp:auto:tab:${primary}`;
  }

  return 'mcp:auto:tab:default';
}

/**
 * V26-02 (B-026) — defensively walk a `chrome_navigate` extension
 * response and extract the resulting `tabId`. The extension may
 * return the tabId directly on the data object OR embed it in a
 * stringified JSON content payload (CallToolResult shape). Returns
 * `null` when no integer-valued `tabId` is found anywhere.
 *
 * Pure function. Tolerates malformed inputs (returns `null`) so the
 * controller observation hook in `handleToolCall` cannot throw.
 */
function extractTabIdFromCallToolResult(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const direct = (data as Record<string, unknown>).tabId;
  if (Number.isInteger(direct)) return direct as number;
  const content = (data as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const entry of content) {
      if (entry && typeof entry === 'object') {
        const text = (entry as { text?: unknown }).text;
        if (typeof text === 'string' && text.length > 0) {
          try {
            const parsed = JSON.parse(text);
            if (
              parsed &&
              typeof parsed === 'object' &&
              Number.isInteger((parsed as Record<string, unknown>).tabId)
            ) {
              return (parsed as Record<string, number>).tabId;
            }
          } catch {
            // Not JSON — skip.
          }
        }
      }
    }
  }
  return null;
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

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs: number = BRIDGE_RECOVERY_POLL_MS,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await wait(pollMs);
  }
  return predicate();
}

async function tryLaunchCommand(command: string, args: string[]): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      child.once('error', () => done(false));
      child.once('exit', () => done(false));
      setTimeout(() => {
        try {
          child.unref();
        } catch {
          // Ignore unref errors.
        }
        done(true);
      }, 200);
    } catch {
      done(false);
    }
  });
}

function getResolvedBrowserExecutables(
  targetBrowsers: BrowserType[] = [BrowserType.CHROME, BrowserType.CHROMIUM],
): string[] {
  if (browserLaunchTestOverride) {
    const seen = new Set<string>();
    return browserLaunchTestOverride.filter((candidate) => {
      const normalized = candidate.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  const persisted = readPersistedBrowserLaunchConfig();
  const persistedCandidate =
    persisted &&
    (!path.isAbsolute(persisted.executablePath) || existsSync(persisted.executablePath))
      ? [persisted.executablePath]
      : [];
  const preferred = resolveAndPersistBrowserLaunchConfig(targetBrowsers);
  const preferredCandidate = preferred ? [preferred.executablePath] : [];
  const discoveredCandidates = targetBrowsers
    .map((browser) => resolveBrowserExecutable(browser)?.executablePath)
    .filter((candidate): candidate is string => Boolean(candidate));
  const candidates = [...persistedCandidate, ...preferredCandidate, ...discoveredCandidates];

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalized = candidate.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return !path.isAbsolute(candidate) || existsSync(candidate);
  });
}

function getWindowsBrowserExecutables(): string[] {
  return getResolvedBrowserExecutables();
}

function getMacBrowserExecutables(): string[] {
  return getResolvedBrowserExecutables();
}

function getLinuxBrowserExecutables(): string[] {
  return getResolvedBrowserExecutables();
}

function hasLinuxGraphicalSession(): boolean {
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function getWindowsReconnectCandidates(connectUrl: string): LaunchCandidate[] {
  return getWindowsBrowserExecutables().map((command) => ({
    command,
    args: [connectUrl],
  }));
}

function getMacReconnectCandidates(connectUrl: string): LaunchCandidate[] {
  const directCandidates = getMacBrowserExecutables().map((command) => ({
    command,
    args: [connectUrl],
  }));
  if (directCandidates.length > 0) return directCandidates;
  return [
    { command: 'open', args: ['-a', 'Google Chrome', connectUrl] },
    { command: 'open', args: ['-a', 'Chromium', connectUrl] },
  ];
}

function getLinuxReconnectCandidates(connectUrl: string): LaunchCandidate[] {
  const directCandidates = getLinuxBrowserExecutables().map((command) => ({
    command,
    args: [connectUrl],
  }));
  if (directCandidates.length > 0) return directCandidates;
  return [
    { command: 'google-chrome', args: [connectUrl] },
    { command: 'google-chrome-stable', args: [connectUrl] },
    { command: 'chromium', args: [connectUrl] },
    { command: 'chromium-browser', args: [connectUrl] },
  ];
}

function getWindowsBrowserLaunchCandidates(): LaunchCandidate[] {
  return getWindowsBrowserExecutables().map((command) => ({
    command,
    args: ['--new-window', 'about:blank'],
  }));
}

function getMacBrowserLaunchCandidates(): LaunchCandidate[] {
  const directCandidates = getMacBrowserExecutables().map((command) => ({
    command,
    args: ['--new-window', 'about:blank'],
  }));
  if (directCandidates.length > 0) return directCandidates;
  return [
    { command: 'open', args: ['-a', 'Google Chrome', 'about:blank'] },
    { command: 'open', args: ['-a', 'Chromium', 'about:blank'] },
  ];
}

function getLinuxBrowserLaunchCandidates(): LaunchCandidate[] {
  const directCandidates = getLinuxBrowserExecutables().map((command) => ({
    command,
    args: ['--new-window', 'about:blank'],
  }));
  if (directCandidates.length > 0) return directCandidates;
  return [
    { command: 'google-chrome', args: ['about:blank'] },
    { command: 'google-chrome-stable', args: ['about:blank'] },
    { command: 'chromium', args: ['about:blank'] },
    { command: 'chromium-browser', args: ['about:blank'] },
  ];
}

async function requestExtensionReconnectBestEffort(): Promise<LaunchAttemptResult> {
  try {
    const consistency = await collectRuntimeConsistencySnapshot();
    const extensionId = consistency.extensionBuild.extensionId;
    if (!extensionId) {
      return { launched: false, command: 'skip:no_extension_id' };
    }

    const connectUrl = `chrome-extension://${extensionId}/connect.html`;
    const candidates =
      platformRuntime.getCurrentPlatform() === 'win32'
        ? getWindowsReconnectCandidates(connectUrl)
        : platformRuntime.getCurrentPlatform() === 'darwin'
          ? getMacReconnectCandidates(connectUrl)
          : getLinuxReconnectCandidates(connectUrl);

    if (platformRuntime.getCurrentPlatform() === 'linux' && !hasLinuxGraphicalSession()) {
      return { launched: false, command: 'skip:no_gui_session' };
    }

    for (const candidate of candidates) {
      const launched = await tryLaunchCommand(candidate.command, candidate.args);
      if (launched) {
        return {
          launched: true,
          command: `${candidate.command} ${candidate.args.join(' ')}`.trim(),
        };
      }
    }
  } catch {
    // Fall through to a failed reconnect attempt.
  }

  return { launched: false, command: 'skip:extension_reconnect_unavailable' };
}

async function launchBrowserBestEffort(): Promise<LaunchAttemptResult> {
  if (platformRuntime.getCurrentPlatform() === 'linux' && !hasLinuxGraphicalSession()) {
    return { launched: false, command: 'skip:no_gui_session' };
  }

  const candidates =
    platformRuntime.getCurrentPlatform() === 'win32'
      ? getWindowsBrowserLaunchCandidates()
      : platformRuntime.getCurrentPlatform() === 'darwin'
        ? getMacBrowserLaunchCandidates()
        : getLinuxBrowserLaunchCandidates();

  for (const candidate of candidates) {
    const launched = await tryLaunchCommand(candidate.command, candidate.args);
    if (launched) {
      return {
        launched: true,
        command: `${candidate.command} ${candidate.args.join(' ')}`.trim(),
      };
    }
  }
  return { launched: false };
}

export const __bridgeLaunchInternals = {
  platformRuntime,
  getBrowserLaunchTestOverride(): string[] | null {
    return browserLaunchTestOverride ? [...browserLaunchTestOverride] : null;
  },
  setBrowserLaunchTestOverride(commands: string[] | null): void {
    browserLaunchTestOverride = commands ? [...commands] : null;
  },
  getResolvedBrowserExecutables,
  getWindowsBrowserExecutables,
  getWindowsReconnectCandidates,
  getWindowsBrowserLaunchCandidates,
  getMacBrowserExecutables,
  getMacReconnectCandidates,
  getMacBrowserLaunchCandidates,
  getLinuxBrowserExecutables,
  getLinuxReconnectCandidates,
  getLinuxBrowserLaunchCandidates,
  hasLinuxGraphicalSession,
};

function hasBrowserProcessRunning(): boolean {
  try {
    if (platformRuntime.getCurrentPlatform() === 'win32') {
      const chrome = spawnSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const chromium = spawnSync('tasklist', ['/FI', 'IMAGENAME eq chromium.exe'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const output = `${chrome.stdout || ''}\n${chromium.stdout || ''}`.toLowerCase();
      return output.includes('chrome.exe') || output.includes('chromium.exe');
    }
    if (platformRuntime.getCurrentPlatform() === 'darwin') {
      const chrome = spawnSync('pgrep', ['-x', 'Google Chrome'], { encoding: 'utf8' });
      const chromium = spawnSync('pgrep', ['-x', 'Chromium'], { encoding: 'utf8' });
      return Boolean((chrome.stdout || '').trim() || (chromium.stdout || '').trim());
    }
    const chrome = spawnSync('pgrep', ['-x', 'google-chrome'], { encoding: 'utf8' });
    const chromeStable = spawnSync('pgrep', ['-x', 'google-chrome-stable'], { encoding: 'utf8' });
    const chromium = spawnSync('pgrep', ['-x', 'chromium'], { encoding: 'utf8' });
    const chromiumBrowser = spawnSync('pgrep', ['-x', 'chromium-browser'], { encoding: 'utf8' });
    return Boolean(
      (chrome.stdout || '').trim() ||
      (chromeStable.stdout || '').trim() ||
      (chromium.stdout || '').trim() ||
      (chromiumBrowser.stdout || '').trim(),
    );
  } catch {
    return false;
  }
}

function shouldSkipBrowserLaunchForError(error: unknown): boolean {
  const message = stringifyUnknownError(error).toLowerCase();
  // Native bridge / extension detach usually cannot be fixed by launching a new browser window.
  return message.includes('forward_to_native rejected');
}

function buildBridgeFailurePayload(
  snapshot: BridgeRuntimeSnapshot,
  recoveryAttempted: boolean,
  recovery?: BridgeRecoveryResult,
): BridgeFailurePayload {
  let code = 'TABRIX_BRIDGE_RECOVERY_TIMEOUT';
  let message = 'Tabrix 桥接恢复超时，浏览器自动化尚未达到可执行状态。';

  if (recovery?.failureCodeHint === 'TABRIX_BROWSER_GUI_SESSION_UNAVAILABLE') {
    code = 'TABRIX_BROWSER_GUI_SESSION_UNAVAILABLE';
    message = '当前 Linux 会话缺少可用的图形桌面环境，Tabrix 无法自动拉起浏览器。';
  } else if (!snapshot.browserProcessRunning) {
    code = 'TABRIX_BROWSER_NOT_RUNNING';
    message = 'Chrome 浏览器未运行，Tabrix 已尝试恢复但未检测到可用浏览器进程。';
  } else if (recovery?.failureCodeHint === 'TABRIX_EXTENSION_NOT_INSTALLED_OR_DISABLED') {
    code = 'TABRIX_EXTENSION_NOT_INSTALLED_OR_DISABLED';
    message =
      'Chrome 已运行，但未检测到可用的 Tabrix 扩展连接入口，可能未安装、被禁用或未加载最新构建。';
  } else if (recovery?.failureCodeHint === 'TABRIX_EXTENSION_NOT_CONNECTED') {
    code = 'TABRIX_EXTENSION_NOT_CONNECTED';
    message = 'Chrome 已运行，但 Tabrix 扩展尚未与本地服务建立连接。';
  } else if (!isHeartbeatFresh(snapshot)) {
    code = 'TABRIX_EXTENSION_HEARTBEAT_MISSING';
    message = 'Chrome 已运行，但 Tabrix 扩展心跳未恢复，浏览器自动化暂不可用。';
  } else if (!hasExecutableBridge(snapshot)) {
    code = 'TABRIX_BRIDGE_COMMAND_CHANNEL_MISSING';
    message = 'Tabrix 扩展已恢复心跳，但浏览器执行通道尚未就绪。';
  } else if (
    recoveryAttempted &&
    snapshot.bridgeState === 'READY' &&
    hasExecutableBridge(snapshot)
  ) {
    code = 'TABRIX_BRIDGE_RECOVERY_FAILED';
    message = 'Tabrix 已完成桥接恢复，但原始浏览器操作仍未成功执行。';
  }

  const guidance = describeBridgeRecoveryGuidance(snapshot, recovery?.failureCodeHint ?? code);

  return {
    code,
    message,
    bridgeState: snapshot.bridgeState,
    recoveryAttempted,
    summary: guidance.summary,
    hint: guidance.hint,
    nextAction: guidance.nextAction,
  };
}

async function waitForBridgeRecoveryReady(totalBudgetMs: number): Promise<boolean> {
  const startedAt = Date.now();

  const browserReady = await waitForCondition(
    () => getBridgeSnapshot().browserProcessRunning,
    Math.min(BRIDGE_LAUNCH_WAIT_MS, totalBudgetMs),
  );
  if (!browserReady) return false;

  const heartbeatBudget = Math.max(
    0,
    Math.min(BRIDGE_HEARTBEAT_WAIT_MS, totalBudgetMs - (Date.now() - startedAt)),
  );
  const heartbeatReady = await waitForCondition(
    () => isHeartbeatFresh(getBridgeSnapshot()),
    heartbeatBudget,
  );
  if (!heartbeatReady) return false;

  const attachBudget = Math.max(
    0,
    Math.min(BRIDGE_ATTACH_WAIT_MS, totalBudgetMs - (Date.now() - startedAt)),
  );
  return await waitForCondition(() => hasExecutableBridge(getBridgeSnapshot()), attachBudget);
}

async function attemptBridgeRecovery(
  _context: string,
  firstError: unknown,
  initialSnapshot?: BridgeRuntimeSnapshot,
): Promise<BridgeRecoveryResult> {
  const recoveryStartedAt = Date.now();
  const snapshotBefore = initialSnapshot ?? getBridgeSnapshot();
  if (!isRecoverableBridgeIssue(firstError) && snapshotBefore.bridgeState === 'READY') {
    return {
      attempted: false,
      launched: false,
      action: 'none',
      waitMs: 0,
      bridgeStateBefore: snapshotBefore.bridgeState,
      bridgeStateAfter: snapshotBefore.bridgeState,
    };
  }

  const browserAlreadyRunning = snapshotBefore.browserProcessRunning;
  const shouldLaunchBrowser =
    !browserAlreadyRunning &&
    !shouldSkipBrowserLaunchForError(firstError) &&
    snapshotBefore.bridgeState === 'BROWSER_NOT_RUNNING';

  const action: BridgeRecoveryResult['action'] = shouldLaunchBrowser
    ? 'launch_browser'
    : browserAlreadyRunning
      ? 'extension_reconnect'
      : 'wait_for_extension';

  bridgeRuntimeState.markRecoveryStarted(action);

  let launch: LaunchAttemptResult = { launched: false };
  let failureCodeHint: string | undefined;
  if (shouldLaunchBrowser) {
    launch = await requestExtensionReconnectBestEffort();
    if (!launch.launched) {
      launch = await launchBrowserBestEffort();
      if (launch.command === 'skip:no_gui_session') {
        failureCodeHint = 'TABRIX_BROWSER_GUI_SESSION_UNAVAILABLE';
      }
    }
  } else if (browserAlreadyRunning) {
    launch = await requestExtensionReconnectBestEffort();
    if (!launch.launched) {
      failureCodeHint =
        launch.command === 'skip:no_extension_id'
          ? 'TABRIX_EXTENSION_NOT_INSTALLED_OR_DISABLED'
          : launch.command === 'skip:no_gui_session'
            ? 'TABRIX_BROWSER_GUI_SESSION_UNAVAILABLE'
            : 'TABRIX_EXTENSION_NOT_CONNECTED';
    }
  }

  if (failureCodeHint === 'TABRIX_BROWSER_GUI_SESSION_UNAVAILABLE') {
    const snapshotAfter = getBridgeSnapshot();
    const recoveryContext: BridgeRecoveryResult = {
      attempted: true,
      launched: false,
      action,
      command: launch.command,
      waitMs: Date.now() - recoveryStartedAt,
      bridgeStateBefore: snapshotBefore.bridgeState,
      bridgeStateAfter: snapshotAfter.bridgeState,
      failureCodeHint,
    };
    const failure = buildBridgeFailurePayload(snapshotAfter, true, recoveryContext);
    bridgeRuntimeState.markRecoveryFinished(false, failure.code, failure.message);
    return recoveryContext;
  }

  const ready = await waitForBridgeRecoveryReady(BRIDGE_RECOVERY_TOTAL_BUDGET_MS);
  const snapshotAfter = getBridgeSnapshot();
  const recoveryContext: BridgeRecoveryResult = {
    attempted: true,
    launched: launch.launched,
    action,
    command: launch.command,
    waitMs: Date.now() - recoveryStartedAt,
    bridgeStateBefore: snapshotBefore.bridgeState,
    bridgeStateAfter: snapshotAfter.bridgeState,
    failureCodeHint,
  };
  const failure = ready ? null : buildBridgeFailurePayload(snapshotAfter, true, recoveryContext);
  bridgeRuntimeState.markRecoveryFinished(
    ready,
    ready ? null : (failure?.code ?? null),
    ready ? null : (failure?.message ?? null),
  );

  return recoveryContext;
}

function formatRecoveryError(
  failure: BridgeFailurePayload,
  recovery: BridgeRecoveryResult | undefined,
): string {
  const launchPart = recovery?.attempted
    ? ` launch=${recovery.launched ? 'ok' : 'failed'}`
    : ' launch=skipped';
  const commandPart = recovery?.command ? ` command="${recovery.command}"` : '';
  const recoveryPart = recovery
    ? ` recoveryAttempted=${recovery.attempted}; waitMs=${recovery.waitMs}; action=${recovery.action};`
    : ' recoveryAttempted=false;';
  return `${JSON.stringify(failure)};${recoveryPart}${launchPart}${commandPart}`;
}

async function callWithBridgeRecovery(
  invoker: () => Promise<any>,
  context: string,
): Promise<{
  response: any;
  recovery?: BridgeRecoveryResult;
  bridgeFailure?: BridgeFailurePayload;
}> {
  const precheckSnapshot = getBridgeSnapshot();
  if (isBrowserAutomationContext(context) && precheckSnapshot.bridgeState !== 'READY') {
    const recovery = await attemptBridgeRecovery(
      context,
      'bridge is unavailable',
      precheckSnapshot,
    );
    const afterRecovery = getBridgeSnapshot();
    if (afterRecovery.bridgeState !== 'READY' || !hasExecutableBridge(afterRecovery)) {
      const failure = buildBridgeFailurePayload(afterRecovery, true, recovery);
      return {
        response: { status: 'error', error: formatRecoveryError(failure, recovery) },
        recovery,
        bridgeFailure: failure,
      };
    }
  }

  try {
    const response = await invoker();
    if (!responseNeedsBridgeRecovery(response)) {
      return { response };
    }
    const recovery = await attemptBridgeRecovery(context, response.error || response.message);
    const retry = await invoker();
    if (responseNeedsBridgeRecovery(retry)) {
      const failure = buildBridgeFailurePayload(getBridgeSnapshot(), recovery.attempted, recovery);
      return {
        response: {
          ...retry,
          error: formatRecoveryError(failure, recovery),
        },
        recovery,
        bridgeFailure: failure,
      };
    }
    return { response: retry, recovery };
  } catch (error) {
    const errorText = stringifyUnknownError(error).toLowerCase();
    if (errorText.includes('transient test injection')) {
      const retry = await invoker();
      return {
        response: retry,
      };
    }

    if (!isRecoverableBridgeIssue(error)) {
      throw error;
    }
    const recovery = await attemptBridgeRecovery(context, error);
    try {
      const retry = await invoker();
      if (responseNeedsBridgeRecovery(retry)) {
        const failure = buildBridgeFailurePayload(
          getBridgeSnapshot(),
          recovery.attempted,
          recovery,
        );
        return {
          response: {
            ...retry,
            error: formatRecoveryError(failure, recovery),
          },
          recovery,
          bridgeFailure: failure,
        };
      }
      return { response: retry, recovery };
    } catch (retryError) {
      const failure = buildBridgeFailurePayload(getBridgeSnapshot(), recovery.attempted, recovery);
      throw new Error(formatRecoveryError(failure, recovery));
    }
  }
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

    // V24-01 capability gate (defense-in-depth — `filterToolsByCapability`
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

    // V26-03 (B-026) — resolve the task context BEFORE we branch into
    // the native handler so `tabrix_choose_context` (a native-handled
    // tool) can write its decision into the same `TaskSessionContext`
    // the `chrome_read_page` shim later peeks. Auto-keying covers the
    // schema-strict client case (chooser's public schema does not
    // advertise `taskSessionId / tabId`) so the pair lands on the
    // same `mcp:auto:tab:<id|default>` key without spying on
    // `getTaskContext`. Tools outside the auto set still get the
    // freshly-minted internal `taskId` fallback so their v2.5/v2.6
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
    // queries (B-013), the context selector (B-018 v1), and the V24-01
    // `experience_replay` write-side tool qualify; everything else
    // still goes through the Chrome extension via
    // `invokeExtensionCommand`.
    const nativeHandler = getNativeToolHandler(name);
    if (nativeHandler) {
      // V24-01: only the experience_replay handler needs the bridge
      // adapter + per-step recorder + intent re-tagger. The other
      // native handlers ignore them, but always passing them keeps
      // the deps shape uniform.
      const replayDeps =
        name === TOOL_NAMES.EXPERIENCE.REPLAY ? buildReplayDeps(session.sessionId) : {};
      const nativeResult = await nativeHandler(args, {
        sessionManager,
        capabilityEnv: getCurrentCapabilityEnv(),
        // V26-03 (B-026): carries the `TaskSessionContext` the
        // `tabrix_choose_context` handler writes into via
        // `noteChooseContextDecision`. `null` for tools outside the
        // auto-key set when there is no live external context;
        // handlers that do not need it (e.g. experience suggest /
        // record-outcome) ignore the field.
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
    // V26-02 (B-026) — Primary Tab Controller hook. When
    // `TABRIX_PRIMARY_TAB_ENFORCE=true`, inject `tabId: primaryTabId`
    // into `chrome_navigate` args before forwarding to the extension
    // so multi-site flows reuse the primary tab. When the env flag is
    // off (default), `getInjectedTabId()` returns null and `args` is
    // forwarded unchanged — bit-identical to v2.5 behaviour. The
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
    // V26-05 (B-028) — Task Session Context read-budget gate. Only the
    // `chrome_read_page` hot path is gated; everything else passes
    // through. The gate is fail-soft: when no task context is attached
    // (persistence off, or `startSession` was bypassed) we forward the
    // call unchanged so the v2.5 happy path is preserved bit-for-bit.
    //
    // v2.6 S1 last-mile P1 fix: resolve the gate's task key from a
    // ladder that BOTH honours an explicit caller-supplied key AND
    // remains usable for schema-following MCP clients that cannot
    // see `taskSessionId / taskId / clientTaskId` (those names are
    // not in the public `chrome_read_page` schema, so a strict
    // client may strip them on the wire). See
    // `resolveTaskContextKey` above for the full ladder; the short
    // version is: explicit > args.tabId > bridge.primaryTabId >
    // single-process `mcp:auto:tab:default`. Auto-keying only fires
    // for `chrome_read_page` and `chrome_navigate`, so click/fill/
    // navigate-adjacent tools cannot mint phantom contexts.
    //
    // When `resolveTaskContextKey` returns null (only possible for
    // tools outside the auto set without an explicit key), we fall
    // back to the freshly-minted internal `taskId` so the v2.5/v2.6
    // contract for those tools is preserved bit-for-bit.
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
    // native-handler branch (V26-03 wiring). Re-resolving here would
    // be functionally equivalent under the current
    // `getOrCreateExternalTaskContext` LRU semantics, but the fewer
    // resolution sites the harder it is for a future edit to drift
    // the chooser-write and reader-peek apart.
    const taskContext = taskContextEarly;
    // V26-03 review closeout: when the orchestrator returns
    // `'fallback_required'` we MUST forward to the bridge with the
    // clamped fallback entry layer (`'L0'` / `'L0+L1'`), never the
    // caller's original `requestedLayer`. Otherwise an upstream
    // `requestedLayer='L0+L1+L2'` (the schema default) would silently
    // re-widen the read on the failure path — exactly the regression
    // V26-03 §0.1 forbids. `null` means "no fallback fired, keep the
    // caller's original layer bit-identical to the pre-V26-03 path".
    let forcedReadPageLayer: 'L0' | 'L0+L1' | null = null;
    let operationLogHint: {
      requestedLayer?: string | null;
      selectedDataSource?: string | null;
      sourceRoute?: string | null;
      decisionReason?: string | null;
      resultKind?: string | null;
      fallbackUsed?: string | null;
      readCount?: number | null;
      tokensSaved?: number | null;
    } | null = null;
    let apiFallbackEvidence: ApiReadFallbackEvidenceV26 | null = null;
    if (taskContext && name === 'chrome_read_page') {
      // V26-03 (B-026) — skip-read orchestrator hook. We consult it
      // BEFORE the existing budget gate because a `'skip'` plan
      // means we never round-trip the bridge AND never spend the
      // budget on a read we proved we could avoid.
      //
      // Hard rules (session corrections #2/#3/#4):
      //   * The orchestrator only fires when `choose_context` has
      //     ALREADY recorded a decision into this task context. Any
      //     in-flight read without a recorded decision keeps the
      //     v2.5 happy path bit-identical.
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
            // V26-FIX-01: when `tabrix_choose_context` already executed
            // the API inline (executionMode='direct_api'), reuse the
            // cached rows verbatim instead of re-issuing the request.
            // One user-visible task ↔ one API round-trip — that's the
            // whole point of FIX-01. The acceptance-fault override is
            // only honoured when the cached result is absent so tests
            // can still simulate a fresh-API failure path.
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
              });
              taskContext.noteSkipRead({
                source: skipPlan.sourceKind,
                layer: recordedDecision.chosenLayer,
                tokensSavedEstimate: tokenSavings.tokensSavedEstimate,
                actionPathId: null,
                apiFamily: apiResult.endpointFamily,
              });
              const totals = taskContext.getTaskTotals();
              const apiPayload = {
                kind: 'api_rows',
                readPageAvoided: true,
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
                layerContract: mapDataSourceToLayerContract({
                  dataSource: 'api_rows',
                  requestedLayer: recordedDecision.chosenLayer,
                  fallbackEntryLayer: skipPlan.fallbackEntryLayer,
                }),
                chosenLayer: recordedDecision.chosenLayer,
                tokenEstimateChosen: tokenSavings.tokenEstimateChosen,
                tokenEstimateFullRead: tokenSavings.tokenEstimateFullRead,
                tokensSavedEstimate: tokenSavings.tokensSavedEstimate,
                tokensSavedEstimateSource: tokenSavings.tokensSavedEstimateSource,
                fallbackUsed: 'none',
                fallbackEntryLayer: skipPlan.fallbackEntryLayer,
                requiresApiCall: true,
                requiresExperienceReplay: false,
                apiFamily: apiResult.endpointFamily,
                dataPurpose: apiResult.dataPurpose,
                rows: apiResult.rows,
                rowCount: apiResult.rowCount,
                compact: apiResult.compact,
                rawBodyStored: apiResult.rawBodyStored,
                apiTelemetry: apiResult.telemetry,
                diagnostic: skipPlan.diagnostic,
                taskTotals: totals,
              };
              const apiCallResult: CallToolResult = {
                content: [{ type: 'text', text: JSON.stringify(apiPayload) }],
              };
              sessionManager.completeStep(session.sessionId, step.stepId, {
                status: 'completed',
                resultSummary: `chrome_read_page fulfilled via ${skipPlan.sourceKind} (saved ~${tokenSavings.tokensSavedEstimate} tok)`,
                operationLog: {
                  requestedLayer: recordedDecision.chosenLayer,
                  selectedDataSource: 'api_rows',
                  sourceRoute: skipPlan.sourceRoute,
                  decisionReason: recordedDecision.decisionReason ?? skipPlan.diagnostic,
                  resultKind: 'api_rows',
                  fallbackUsed: 'none',
                  readCount: totals.readPageAvoidedCount,
                  tokensSaved: tokenSavings.tokensSavedEstimate,
                },
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
        // `fallback_required` / `forward` falls through to the
        // existing budget gate path below. The chooser decision
        // stays recorded so a follow-up read on the same page can
        // re-evaluate (e.g. once V26-07 wires capability we may
        // upgrade `api_layer_not_available` → skip without needing
        // a fresh chooser run).
        if (skipPlan.action === 'fallback_required') {
          // V26-03 review closeout: pin the bridge-side
          // `requestedLayer` to the orchestrator's clamped
          // fallback entry layer. Used below by the budget gate,
          // the bridge `call_tool` payload, and the post-success
          // `noteReadPage` bookkeeping so the three sites cannot
          // drift back to `'L0+L1+L2'`.
          forcedReadPageLayer = skipPlan.fallbackEntryLayer;
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
      // P1-2 fix: read the public `requestedLayer` field (with
      // legacy `layer` fallback) instead of `(args as any).layer`,
      // and default to the MCP-schema default `'L0+L1+L2'` when
      // nothing is supplied. When the orchestrator demanded a
      // fallback, override the caller-supplied layer with the
      // clamped fallback entry layer so the gate decision matches
      // what we are about to forward to the bridge.
      const requestedLayer =
        forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
      const decision = taskContext.shouldAllowReadPage({ requestedLayer });
      if (!decision.allowed || decision.reason === 'read_redundant') {
        const warningPayload = {
          warning: decision.reason || 'read_budget_exceeded',
          readPageCount: decision.readPageCount,
          readBudget: decision.readBudget,
          suggestedLayer: decision.suggestedLayer,
        };
        const warningResult: CallToolResult = {
          content: [{ type: 'text', text: JSON.stringify(warningPayload) }],
        };
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'completed',
          resultSummary: `chrome_read_page short-circuited (${warningPayload.warning})`,
          operationLog: {
            ...(operationLogHint ?? {}),
            requestedLayer,
            resultKind: 'read_page_warning',
            decisionReason: warningPayload.warning,
          },
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'completed',
          summary: `chrome_read_page short-circuited (${warningPayload.warning})`,
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
    // V26-03 review closeout: when the orchestrator demanded a
    // fallback for `chrome_read_page`, replace the caller's
    // `requestedLayer` (which may be the schema default
    // `'L0+L1+L2'`) with the clamped fallback entry layer
    // (`'L0'` / `'L0+L1'`). Every other field on `args`
    // (`tabId` / `windowId` / `refId` / …) is preserved verbatim
    // so call-site contracts that rely on them are unaffected.
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
    // V26-02: regardless of the enforcement gate, observe every
    // `chrome_navigate` outcome so the bridge runtime snapshot
    // exposes hygiene metrics (`primaryTabReuseRate`,
    // `benchmarkOwnedTabCount`) that the v26-benchmark transformer
    // and any operator UI can read. Defensive: tolerate missing /
    // malformed `tabId` in the response without throwing.
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
        args,
      });
      // V26-05 (B-028): record a successful chrome_read_page so the
      // budget reflects bridge-confirmed reads (failed reads do NOT
      // consume the budget — V4.1 §6 "honest budget" rule). The
      // taskContext lookup is repeated here because the post-processor
      // may have produced a tabId/URL update we want to honour.
      // v2.6 S1 P1-2 fix: read `requestedLayer` (with legacy `layer`
      // fallback) so the bookkeeping matches what the gate decided.
      // V26-03 review closeout: when a fallback layer was forced
      // upstream, the budget gate already saw the clamped layer —
      // record the same value here so the post-success bookkeeping
      // cannot drift back to the caller's original layer.
      if (name === 'chrome_read_page' && taskContext) {
        const requestedLayer =
          forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
        taskContext.noteReadPage({
          layer: requestedLayer,
          source: 'unknown',
        });
      }
      const rawResultWithEvidence = withFallbackEvidence(postResult.rawResult, apiFallbackEvidence);
      const normalized = normalizeToolCallResult(name, rawResultWithEvidence);
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
                resultKind: operationLogHint?.resultKind ?? 'read_page',
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
