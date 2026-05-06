import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  readPersistedBrowserLaunchConfig,
  resolveAndPersistBrowserLaunchConfig,
} from '../browser-launch-config';
import { BrowserType, resolveBrowserExecutable } from '../scripts/browser-config';
import { describeBridgeRecoveryGuidance } from '../scripts/bridge-recovery-guidance';
import { collectRuntimeConsistencySnapshot } from '../scripts/runtime-consistency';
import { bridgeRuntimeState, type BridgeRuntimeSnapshot } from '../server/bridge-state';

export interface BridgeRecoveryResult {
  attempted: boolean;
  launched: boolean;
  action: 'launch_browser' | 'extension_reconnect' | 'wait_for_extension' | 'none';
  command?: string;
  waitMs: number;
  bridgeStateBefore: string;
  bridgeStateAfter?: string;
  failureCodeHint?: string;
}

export interface BridgeFailurePayload {
  code: string;
  message: string;
  bridgeState: string;
  recoveryAttempted: boolean;
  summary: string;
  hint: string;
  nextAction: string | null;
}

export interface GenericFailurePayload {
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

export function isRecoverableBridgeIssue(error: unknown): boolean {
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

export function getBridgeSnapshot(): BridgeRuntimeSnapshot {
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

export async function callWithBridgeRecovery(
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
