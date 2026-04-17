import type { BridgeRuntimeSnapshot } from '../server/bridge-state';
import { COMMAND_NAME } from './constant';

interface BridgeRuntimeInfo {
  bridgeState?: string;
  lastBridgeErrorCode?: string | null;
  commandChannelConnected?: boolean;
}

export interface BridgeRecoveryGuidance {
  summary: string;
  hint: string;
  nextAction: string | null;
  nextSteps: string[];
  fix: string[];
}

function normalizeAction(action: string | undefined | null): string | null {
  if (!action) return null;
  const trimmed = action.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildAdvice(
  summary: string,
  hint: string,
  nextAction: string | undefined,
): BridgeRecoveryGuidance {
  const action = normalizeAction(nextAction);
  return {
    summary,
    hint,
    nextAction: action,
    fix: action ? [action] : [],
    nextSteps: action ? [action] : [],
  };
}

function describeByFailureHint(
  failureCodeHint: string | null | undefined,
  _errorMessage: string | null | undefined,
): string | null {
  if (!failureCodeHint) return null;
  switch (failureCodeHint) {
    case 'TABRIX_BROWSER_GUI_SESSION_UNAVAILABLE':
      return `${COMMAND_NAME}：请在有图形会话的环境中（DISPLAY/WAYLAND_DISPLAY）重试`;
    case 'TABRIX_EXTENSION_NOT_INSTALLED_OR_DISABLED':
      return `在 chrome://extensions 中确认 Tabrix 扩展已安装并启用`;
    case 'TABRIX_EXTENSION_NOT_CONNECTED':
      return '打开 Tabrix 扩展并触发一次连接后重试';
    case 'TABRIX_EXTENSION_HEARTBEAT_MISSING':
      return '等待扩展心跳恢复后重试一次';
    case 'TABRIX_BRIDGE_COMMAND_CHANNEL_MISSING':
      return '等待执行通道重建后重试一次';
    case 'TABRIX_BRIDGE_RECOVERY_FAILED':
      return `${COMMAND_NAME} doctor --fix 后重试`;
    default:
      return null;
  }
}

function describeFromState(
  bridgeState: BridgeRuntimeSnapshot['bridgeState'] | undefined,
  commandChannelConnected: boolean,
): string | null {
  switch (bridgeState) {
    case 'BROWSER_NOT_RUNNING':
      return '等待自动启动完成后重试一次';
    case 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE':
      return commandChannelConnected ? '等待扩展连接恢复后重试一次' : '等待扩展自动重连后重试一次';
    case 'BRIDGE_DEGRADED':
      return commandChannelConnected ? '等待桥接稳定后重试一次' : '等待执行通道恢复后重试一次';
    case 'BRIDGE_CONNECTING':
      return '恢复流程进行中，请稍后重试一次';
    case 'BRIDGE_BROKEN':
      return `无法自动恢复该链路，请先运行 ${COMMAND_NAME} doctor --fix 后重试`;
    default:
      return null;
  }
}

export function describeBridgeRecoveryGuidance(
  snapshot?: BridgeRuntimeInfo,
  failureCodeHint?: string | null,
): BridgeRecoveryGuidance {
  const bridgeState =
    snapshot && typeof snapshot.bridgeState === 'string'
      ? (snapshot.bridgeState as BridgeRuntimeSnapshot['bridgeState'])
      : undefined;
  const commandChannelConnected =
    typeof snapshot?.commandChannelConnected === 'boolean'
      ? snapshot.commandChannelConnected
      : false;
  const lastErrorCode =
    typeof snapshot?.lastBridgeErrorCode === 'string' ? snapshot.lastBridgeErrorCode : null;

  const stateSummary = bridgeState
    ? (() => {
        switch (bridgeState) {
          case 'READY':
            return '桥接可用';
          case 'BROWSER_NOT_RUNNING':
            return '浏览器未运行';
          case 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE':
            return '浏览器已运行但扩展不可用';
          case 'BRIDGE_CONNECTING':
            return '桥接恢复中';
          case 'BRIDGE_DEGRADED':
            return '桥接降级';
          case 'BRIDGE_BROKEN':
            return '桥接损坏';
          default:
            return '桥接状态未知';
        }
      })()
    : '桥接状态未知';

  const hint =
    bridgeState === 'READY'
      ? '浏览器、扩展与本地服务主链路已就绪。'
      : bridgeState === 'BROWSER_NOT_RUNNING'
        ? 'Chrome 未运行时，Tabrix 不会在普通状态检查中自启动。'
        : bridgeState === 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE'
          ? '当前桥接故障通常与扩展连接路径相关，可继续重试后观察恢复进度。'
          : bridgeState === 'BRIDGE_CONNECTING'
            ? '正在执行自动恢复流程，请稍后重试。'
            : bridgeState === 'BRIDGE_DEGRADED'
              ? '桥接仍可恢复，优先建议重试请求触发恢复。'
              : '无法确认自动恢复是否会恢复，建议先采集 report 进行核查。';

  const nextAction =
    describeByFailureHint(lastErrorCode, null) ||
    describeByFailureHint(failureCodeHint, null) ||
    describeFromState(bridgeState, commandChannelConnected);
  if (bridgeState === 'READY') {
    return buildAdvice(stateSummary, hint, undefined);
  }
  const fallback = `${COMMAND_NAME} doctor --fix 后重试`;
  return buildAdvice(stateSummary, hint, nextAction || fallback);
}
