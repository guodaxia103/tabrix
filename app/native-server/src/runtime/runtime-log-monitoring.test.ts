import { describe, expect, it } from '@jest/globals';

import {
  summariseV27RuntimeLogMonitoring,
  toPublicSafeV27RuntimeLogMonitoringSummary,
} from './runtime-log-monitoring';

/** V27-OBS-00 — runtime log monitoring gate for real/simulated browser acceptance. */
describe('summariseV27RuntimeLogMonitoring — V27-OBS-00', () => {
  it('passes when all required runtime log sources are present and clean', () => {
    const summary = summariseV27RuntimeLogMonitoring({
      runtimeLogMonitoringEnabled: true,
      bridgeReady: true,
      operationLogStepCount: 3,
    });

    expect(summary).toMatchObject({
      runtimeLogMonitoringEnabled: true,
      nativeErrorCountDelta: 0,
      extensionErrorCountDelta: 0,
      pageConsoleErrorCountDelta: 0,
      bridgeReady: true,
      nativeMessageDisconnectCount: 0,
      debuggerAttachErrorCount: 0,
      debuggerDetachErrorCount: 0,
      unhandledPromiseRejectionCount: 0,
      sensitiveLogLeakCount: 0,
      logSourceUnavailable: [],
      operationLogStepCount: 3,
      operationLogFailureSteps: 0,
      status: 'pass',
      blockedReasons: [],
    });
  });

  it('blocks product-grade pass when runtime log monitoring is missing or a source is unavailable', () => {
    const summary = summariseV27RuntimeLogMonitoring({
      runtimeLogMonitoringEnabled: false,
      bridgeReady: true,
      logSourceUnavailable: ['extension_service_worker', 'operation_log'],
    });

    expect(summary.status).toBe('blocked');
    expect(summary.blockedReasons).toEqual([
      'runtime_log_monitoring_disabled',
      'log_source_unavailable:extension_service_worker',
      'log_source_unavailable:operation_log',
    ]);
  });

  it('blocks on new native, extension, page, bridge, debugger, promise, and operation-log errors', () => {
    const summary = summariseV27RuntimeLogMonitoring({
      runtimeLogMonitoringEnabled: true,
      nativeErrorCountDelta: 1,
      extensionErrorCountDelta: 2,
      pageConsoleErrorCountDelta: 3,
      bridgeReady: false,
      nativeMessageDisconnectCount: 4,
      debuggerAttachErrorCount: 5,
      debuggerDetachErrorCount: 6,
      unhandledPromiseRejectionCount: 7,
      operationLogFailureSteps: 8,
    });

    expect(summary.status).toBe('blocked');
    expect(summary.blockedReasons).toEqual([
      'native_error_count_delta:1',
      'extension_error_count_delta:2',
      'page_console_error_count_delta:3',
      'bridge_not_ready',
      'native_message_disconnect_count:4',
      'debugger_attach_error_count:5',
      'debugger_detach_error_count:6',
      'unhandled_promise_rejection_count:7',
      'operation_log_failure_steps:8',
    ]);
  });

  it('counts sensitive-looking log samples without exposing raw log text in the public-safe summary', () => {
    const summary = summariseV27RuntimeLogMonitoring({
      runtimeLogMonitoringEnabled: true,
      bridgeReady: true,
      samples: [
        { source: 'native_mcp', level: 'error', message: 'Authorization: Bearer secret-token' },
        { source: 'page_console', level: 'warning', message: 'ordinary warning' },
      ],
    });
    const publicSafe = toPublicSafeV27RuntimeLogMonitoringSummary(summary);

    expect(publicSafe.sensitiveLogLeakCount).toBe(1);
    expect(publicSafe.status).toBe('blocked');
    expect(publicSafe.blockedReasons).toContain('sensitive_log_leak_count:1');
    expect(JSON.stringify(publicSafe)).not.toContain('secret-token');
    expect(JSON.stringify(publicSafe)).not.toContain('ordinary warning');
  });

  it('normalizes invalid counters and ignores unknown unavailable sources', () => {
    const summary = summariseV27RuntimeLogMonitoring({
      runtimeLogMonitoringEnabled: true,
      nativeErrorCountDelta: -1,
      extensionErrorCountDelta: Number.NaN,
      pageConsoleErrorCountDelta: 1.9,
      bridgeReady: true,
      logSourceUnavailable: ['native_mcp', 'unknown' as never],
    });

    expect(summary.nativeErrorCountDelta).toBe(0);
    expect(summary.extensionErrorCountDelta).toBe(0);
    expect(summary.pageConsoleErrorCountDelta).toBe(1);
    expect(summary.logSourceUnavailable).toEqual(['native_mcp']);
    expect(summary.blockedReasons).toEqual([
      'log_source_unavailable:native_mcp',
      'page_console_error_count_delta:1',
    ]);
  });
});
