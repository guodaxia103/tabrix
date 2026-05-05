import { findSensitivePaths } from './privacy-gate';

export type V27RuntimeLogSource =
  | 'native_mcp'
  | 'extension_service_worker'
  | 'page_console'
  | 'chrome_extensions'
  | 'bridge_status'
  | 'operation_log';

export type V27RuntimeLogGateStatus = 'pass' | 'blocked';

export interface V27RuntimeLogSample {
  source: V27RuntimeLogSource;
  level: 'error' | 'warning' | 'info' | 'debug';
  message: string;
}

export interface V27RuntimeLogMonitoringInput {
  runtimeLogMonitoringEnabled?: boolean;
  nativeErrorCountDelta?: number | null;
  extensionErrorCountDelta?: number | null;
  pageConsoleErrorCountDelta?: number | null;
  bridgeReady?: boolean | null;
  nativeMessageDisconnectCount?: number | null;
  debuggerAttachErrorCount?: number | null;
  debuggerDetachErrorCount?: number | null;
  unhandledPromiseRejectionCount?: number | null;
  logSourceUnavailable?: V27RuntimeLogSource[] | null;
  samples?: V27RuntimeLogSample[] | null;
  operationLogStepCount?: number | null;
  operationLogFailureSteps?: number | null;
}

export interface V27RuntimeLogMonitoringSummary {
  runtimeLogMonitoringEnabled: boolean;
  nativeErrorCountDelta: number;
  extensionErrorCountDelta: number;
  pageConsoleErrorCountDelta: number;
  bridgeReady: boolean;
  nativeMessageDisconnectCount: number;
  debuggerAttachErrorCount: number;
  debuggerDetachErrorCount: number;
  unhandledPromiseRejectionCount: number;
  sensitiveLogLeakCount: number;
  logSourceUnavailable: V27RuntimeLogSource[];
  operationLogStepCount: number;
  operationLogFailureSteps: number;
  status: V27RuntimeLogGateStatus;
  blockedReasons: string[];
}

const REQUIRED_SOURCES: V27RuntimeLogSource[] = [
  'native_mcp',
  'extension_service_worker',
  'page_console',
  'chrome_extensions',
  'bridge_status',
  'operation_log',
];

const SENSITIVE_LOG_PATTERNS = [
  /\b(cookie|set-cookie|authorization|proxy-authorization)\s*[:=]/i,
  /\b(rawBody|responseBody|requestBody|rawResponse|rawRequest)\b/i,
  /https?:\/\/[^\s?#]+\?[^\s]+/i,
];

export function summariseV27RuntimeLogMonitoring(
  input: V27RuntimeLogMonitoringInput,
): V27RuntimeLogMonitoringSummary {
  const logSourceUnavailable = normalizeUnavailableSources(input.logSourceUnavailable);
  const sensitiveLogLeakCount = countSensitiveLogLeaks(input.samples ?? []);
  const summary: V27RuntimeLogMonitoringSummary = {
    runtimeLogMonitoringEnabled: input.runtimeLogMonitoringEnabled === true,
    nativeErrorCountDelta: nonNegativeInteger(input.nativeErrorCountDelta),
    extensionErrorCountDelta: nonNegativeInteger(input.extensionErrorCountDelta),
    pageConsoleErrorCountDelta: nonNegativeInteger(input.pageConsoleErrorCountDelta),
    bridgeReady: input.bridgeReady === true,
    nativeMessageDisconnectCount: nonNegativeInteger(input.nativeMessageDisconnectCount),
    debuggerAttachErrorCount: nonNegativeInteger(input.debuggerAttachErrorCount),
    debuggerDetachErrorCount: nonNegativeInteger(input.debuggerDetachErrorCount),
    unhandledPromiseRejectionCount: nonNegativeInteger(input.unhandledPromiseRejectionCount),
    sensitiveLogLeakCount,
    logSourceUnavailable,
    operationLogStepCount: nonNegativeInteger(input.operationLogStepCount),
    operationLogFailureSteps: nonNegativeInteger(input.operationLogFailureSteps),
    status: 'pass',
    blockedReasons: [],
  };

  const blockedReasons = buildBlockedReasons(summary);
  return {
    ...summary,
    status: blockedReasons.length === 0 ? 'pass' : 'blocked',
    blockedReasons,
  };
}

export function toPublicSafeV27RuntimeLogMonitoringSummary(
  summary: V27RuntimeLogMonitoringSummary,
): V27RuntimeLogMonitoringSummary {
  return {
    runtimeLogMonitoringEnabled: summary.runtimeLogMonitoringEnabled,
    nativeErrorCountDelta: summary.nativeErrorCountDelta,
    extensionErrorCountDelta: summary.extensionErrorCountDelta,
    pageConsoleErrorCountDelta: summary.pageConsoleErrorCountDelta,
    bridgeReady: summary.bridgeReady,
    nativeMessageDisconnectCount: summary.nativeMessageDisconnectCount,
    debuggerAttachErrorCount: summary.debuggerAttachErrorCount,
    debuggerDetachErrorCount: summary.debuggerDetachErrorCount,
    unhandledPromiseRejectionCount: summary.unhandledPromiseRejectionCount,
    sensitiveLogLeakCount: summary.sensitiveLogLeakCount,
    logSourceUnavailable: summary.logSourceUnavailable.slice(),
    operationLogStepCount: summary.operationLogStepCount,
    operationLogFailureSteps: summary.operationLogFailureSteps,
    status: summary.status,
    blockedReasons: summary.blockedReasons.slice(),
  };
}

function buildBlockedReasons(summary: V27RuntimeLogMonitoringSummary): string[] {
  const reasons: string[] = [];
  if (!summary.runtimeLogMonitoringEnabled) reasons.push('runtime_log_monitoring_disabled');
  for (const source of summary.logSourceUnavailable)
    reasons.push(`log_source_unavailable:${source}`);
  if (summary.nativeErrorCountDelta > 0) {
    reasons.push(`native_error_count_delta:${summary.nativeErrorCountDelta}`);
  }
  if (summary.extensionErrorCountDelta > 0) {
    reasons.push(`extension_error_count_delta:${summary.extensionErrorCountDelta}`);
  }
  if (summary.pageConsoleErrorCountDelta > 0) {
    reasons.push(`page_console_error_count_delta:${summary.pageConsoleErrorCountDelta}`);
  }
  if (!summary.bridgeReady) reasons.push('bridge_not_ready');
  if (summary.nativeMessageDisconnectCount > 0) {
    reasons.push(`native_message_disconnect_count:${summary.nativeMessageDisconnectCount}`);
  }
  if (summary.debuggerAttachErrorCount > 0) {
    reasons.push(`debugger_attach_error_count:${summary.debuggerAttachErrorCount}`);
  }
  if (summary.debuggerDetachErrorCount > 0) {
    reasons.push(`debugger_detach_error_count:${summary.debuggerDetachErrorCount}`);
  }
  if (summary.unhandledPromiseRejectionCount > 0) {
    reasons.push(`unhandled_promise_rejection_count:${summary.unhandledPromiseRejectionCount}`);
  }
  if (summary.sensitiveLogLeakCount > 0) {
    reasons.push(`sensitive_log_leak_count:${summary.sensitiveLogLeakCount}`);
  }
  if (summary.operationLogFailureSteps > 0) {
    reasons.push(`operation_log_failure_steps:${summary.operationLogFailureSteps}`);
  }
  return reasons;
}

function normalizeUnavailableSources(
  sources: V27RuntimeLogMonitoringInput['logSourceUnavailable'],
): V27RuntimeLogSource[] {
  const set = new Set<V27RuntimeLogSource>();
  for (const source of sources ?? []) {
    if (REQUIRED_SOURCES.includes(source)) set.add(source);
  }
  return REQUIRED_SOURCES.filter((source) => set.has(source));
}

function countSensitiveLogLeaks(samples: readonly V27RuntimeLogSample[]): number {
  let count = 0;
  for (const sample of samples) {
    if (
      findSensitivePaths({ message: sample.message }).length > 0 ||
      SENSITIVE_LOG_PATTERNS.some((pattern) => pattern.test(sample.message))
    ) {
      count += 1;
    }
  }
  return count;
}

function nonNegativeInteger(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value as number));
}
