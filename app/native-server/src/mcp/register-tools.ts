import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import {
  NativeMessageType,
  TOOL_SCHEMAS,
  getToolRiskTier,
  isExplicitOptInTool,
} from '@tabrix/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  buildPolicyDeniedPayload,
  isToolAllowedByPolicy,
  resolveOptInAllowlist,
} from '../policy/phase0-opt-in';
import { sessionManager } from '../execution/session-manager';
import { normalizeToolCallResult } from '../execution/result-normalizer';
import { runPostProcessor } from './tool-post-processors';
import { getNativeToolHandler } from './native-tool-handlers';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bridgeRuntimeState, type BridgeRuntimeSnapshot } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
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
    if (!riskTier) {
      result.push(tool);
      continue;
    }
    const annotations = {
      ...(tool.annotations ?? {}),
      riskTier,
      ...(isExplicitOptInTool(tool.name) ? { requiresExplicitOptIn: true } : {}),
    } as Tool['annotations'];
    result.push({ ...tool, annotations });
  }
  return result;
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
    return { tools: filterToolsByPolicy(byEnv) };
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

    // Native-handled tools short-circuit the extension round-trip — see
    // `mcp/native-tool-handlers.ts`. Currently only Experience read-side
    // queries (B-013) qualify; everything else still goes through the
    // Chrome extension via `invokeExtensionCommand`.
    const nativeHandler = getNativeToolHandler(name);
    if (nativeHandler) {
      const nativeResult = await nativeHandler(args, { sessionManager });
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
    // 发送请求到Chrome扩展并等待响应
    const { response, bridgeFailure } = await callWithBridgeRecovery(
      () =>
        invokeExtensionCommand(
          'call_tool',
          {
            name,
            args,
          },
          120000,
        ),
      `tool:${name}`,
    );
    if (response.status === 'success') {
      const postResult = runPostProcessor({
        toolName: name,
        rawResult: response.data,
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
