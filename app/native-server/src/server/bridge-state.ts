import { spawnSync } from 'node:child_process';

export type BridgeState =
  | 'READY'
  | 'BROWSER_NOT_RUNNING'
  | 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE'
  | 'BRIDGE_CONNECTING'
  | 'BRIDGE_DEGRADED'
  | 'BRIDGE_BROKEN';

export interface BridgeRuntimeSnapshot {
  bridgeState: BridgeState;
  browserProcessRunning: boolean;
  browserProcessDetectedAt: number | null;
  extensionHeartbeatAt: number | null;
  heartbeat: {
    extensionId: string | null;
    connectionId: string | null;
    browserVersion: string | null;
    tabCount: number | null;
    windowCount: number | null;
    autoConnectEnabled: boolean | null;
  };
  nativeHostAttached: boolean;
  commandChannelConnected: boolean;
  commandChannelType: string | null;
  activeConnectionId: string | null;
  lastCommandChannelAt: number | null;
  lastBridgeReadyAt: number | null;
  lastBridgeErrorCode: string | null;
  lastBridgeErrorMessage: string | null;
  lastRecoveryAction: string | null;
  lastRecoveryAt: number | null;
  recoveryAttempts: number;
  recoveryInFlight: boolean;
  /**
   * Primary tab id Tabrix has been driving navigations through during
   * the current process. `null` when the controller has not seen any
   * navigation yet OR when V26-02 enforcement is off and no navigation
   * has been observed by an opt-in caller. Source of truth:
   * `runtime/primary-tab-controller.ts::getSnapshot()`.
   */
  primaryTabId: number | null;
  /**
   * `samePrimaryTabNavigations / expectedPrimaryTabNavigations` over
   * the lifetime of the current process, excluding allowlisted
   * navigations. `null` when no qualifying navigations have been
   * observed yet. Mirrors the v25 benchmark's
   * `BenchmarkTabHygieneSummaryV25.primaryTabReuseRate`.
   */
  primaryTabReuseRate: number | null;
  /**
   * Distinct tabIds Tabrix has driven navigations through. The v25
   * "benchmark-owned" name is preserved for report-consumer
   * compatibility — at runtime this is "tabs Tabrix has touched"
   * because the runtime has no notion of pre-existing baseline tabs.
   */
  benchmarkOwnedTabCount: number;
}

interface RecordHeartbeatOptions {
  sentAt?: number | null;
  nativeConnected?: boolean;
  extensionId?: string | null;
  connectionId?: string | null;
  browserVersion?: string | null;
  tabCount?: number | null;
  windowCount?: number | null;
  autoConnectEnabled?: boolean | null;
}

const BROWSER_WATCH_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const DEGRADED_WINDOW_MS = 60_000;

export function detectBrowserProcessRunning(): boolean {
  try {
    if (process.platform === 'win32') {
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

    if (process.platform === 'darwin') {
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

export class BridgeStateManager {
  constructor(private readonly detectBrowserProcess: () => boolean = detectBrowserProcessRunning) {}

  private snapshot: BridgeRuntimeSnapshot = {
    bridgeState: 'BROWSER_NOT_RUNNING',
    browserProcessRunning: false,
    browserProcessDetectedAt: null,
    extensionHeartbeatAt: null,
    heartbeat: {
      extensionId: null,
      connectionId: null,
      browserVersion: null,
      tabCount: null,
      windowCount: null,
      autoConnectEnabled: null,
    },
    nativeHostAttached: false,
    commandChannelConnected: false,
    commandChannelType: null,
    activeConnectionId: null,
    lastCommandChannelAt: null,
    lastBridgeReadyAt: null,
    lastBridgeErrorCode: null,
    lastBridgeErrorMessage: null,
    lastRecoveryAction: null,
    lastRecoveryAt: null,
    recoveryAttempts: 0,
    recoveryInFlight: false,
    primaryTabId: null,
    primaryTabReuseRate: null,
    benchmarkOwnedTabCount: 0,
  };

  private watchTimer: NodeJS.Timeout | null = null;

  reset(): void {
    this.stopWatching();
    this.snapshot = {
      bridgeState: 'BROWSER_NOT_RUNNING',
      browserProcessRunning: false,
      browserProcessDetectedAt: null,
      extensionHeartbeatAt: null,
      heartbeat: {
        extensionId: null,
        connectionId: null,
        browserVersion: null,
        tabCount: null,
        windowCount: null,
        autoConnectEnabled: null,
      },
      nativeHostAttached: false,
      commandChannelConnected: false,
      commandChannelType: null,
      activeConnectionId: null,
      lastCommandChannelAt: null,
      lastBridgeReadyAt: null,
      lastBridgeErrorCode: null,
      lastBridgeErrorMessage: null,
      lastRecoveryAction: null,
      lastRecoveryAt: null,
      recoveryAttempts: 0,
      recoveryInFlight: false,
      primaryTabId: null,
      primaryTabReuseRate: null,
      benchmarkOwnedTabCount: 0,
    };
  }

  /**
   * Patch the snapshot's primary-tab hygiene fields. Called by the
   * `chrome_navigate` hot path in `register-tools.ts` after every
   * navigation. Idempotent — replaces all three fields atomically so
   * snapshot consumers never see a half-applied update.
   */
  setPrimaryTabSnapshot(input: {
    primaryTabId: number | null;
    primaryTabReuseRate: number | null;
    benchmarkOwnedTabCount: number;
  }): void {
    this.snapshot.primaryTabId = Number.isInteger(input.primaryTabId)
      ? (input.primaryTabId as number)
      : null;
    this.snapshot.primaryTabReuseRate =
      typeof input.primaryTabReuseRate === 'number' && Number.isFinite(input.primaryTabReuseRate)
        ? input.primaryTabReuseRate
        : null;
    this.snapshot.benchmarkOwnedTabCount =
      Number.isInteger(input.benchmarkOwnedTabCount) && input.benchmarkOwnedTabCount >= 0
        ? input.benchmarkOwnedTabCount
        : 0;
  }

  startWatching(): void {
    this.syncBrowserProcessNow();
    if (this.watchTimer) return;

    this.watchTimer = setInterval(() => {
      this.syncBrowserProcessNow();
    }, BROWSER_WATCH_INTERVAL_MS);

    this.watchTimer.unref?.();
  }

  stopWatching(): void {
    if (!this.watchTimer) return;
    clearInterval(this.watchTimer);
    this.watchTimer = null;
  }

  syncBrowserProcessNow(): boolean {
    const running = this.detectBrowserProcess();
    this.setBrowserProcessRunning(running);
    return running;
  }

  setBrowserProcessRunning(running: boolean): void {
    this.snapshot.browserProcessRunning = running;
    this.snapshot.browserProcessDetectedAt = running ? Date.now() : null;
    this.refreshDerivedState();
  }

  setNativeHostAttached(attached: boolean): void {
    this.snapshot.nativeHostAttached = attached;
    if (attached) {
      this.snapshot.lastBridgeReadyAt = Date.now();
      this.snapshot.lastBridgeErrorCode = null;
      this.snapshot.lastBridgeErrorMessage = null;
    }
    this.refreshDerivedState();
  }

  setCommandChannelConnected(
    connected: boolean,
    options: {
      type?: string | null;
      connectionId?: string | null;
      seenAt?: number | null;
    } = {},
  ): void {
    this.snapshot.commandChannelConnected = connected;
    if (connected) {
      this.snapshot.commandChannelType =
        this.normalizeNullableString(options.type) ??
        this.snapshot.commandChannelType ??
        'websocket';
      this.snapshot.activeConnectionId = this.normalizeNullableString(options.connectionId);
      this.snapshot.lastCommandChannelAt =
        this.normalizeNullableNumber(options.seenAt) ?? Date.now();
      this.snapshot.lastBridgeReadyAt = Date.now();
      this.snapshot.lastBridgeErrorCode = null;
      this.snapshot.lastBridgeErrorMessage = null;
    } else {
      this.snapshot.commandChannelType = null;
      this.snapshot.activeConnectionId = null;
    }
    this.refreshDerivedState();
  }

  recordCommandChannelActivity(
    options: {
      type?: string | null;
      connectionId?: string | null;
      seenAt?: number | null;
    } = {},
  ): void {
    this.snapshot.commandChannelConnected = true;
    this.snapshot.commandChannelType =
      this.normalizeNullableString(options.type) ?? this.snapshot.commandChannelType ?? 'websocket';
    this.snapshot.activeConnectionId =
      this.normalizeNullableString(options.connectionId) ?? this.snapshot.activeConnectionId;
    this.snapshot.lastCommandChannelAt = this.normalizeNullableNumber(options.seenAt) ?? Date.now();
    this.snapshot.lastBridgeReadyAt = Date.now();
    this.snapshot.lastBridgeErrorCode = null;
    this.snapshot.lastBridgeErrorMessage = null;
    this.refreshDerivedState();
  }

  recordHeartbeat(options: RecordHeartbeatOptions = {}): void {
    const sentAt = Number.isFinite(options.sentAt) ? Number(options.sentAt) : Date.now();
    this.snapshot.extensionHeartbeatAt = sentAt;
    this.snapshot.heartbeat = {
      extensionId: this.normalizeNullableString(options.extensionId),
      connectionId: this.normalizeNullableString(options.connectionId),
      browserVersion: this.normalizeNullableString(options.browserVersion),
      tabCount: this.normalizeNullableNumber(options.tabCount),
      windowCount: this.normalizeNullableNumber(options.windowCount),
      autoConnectEnabled:
        typeof options.autoConnectEnabled === 'boolean' ? options.autoConnectEnabled : null,
    };
    if (options.nativeConnected === true) {
      this.snapshot.lastBridgeReadyAt = Date.now();
      this.snapshot.lastBridgeErrorCode = null;
      this.snapshot.lastBridgeErrorMessage = null;
    }
    this.refreshDerivedState();
  }

  markRecoveryStarted(action: string): void {
    this.snapshot.recoveryInFlight = true;
    this.snapshot.recoveryAttempts += 1;
    this.snapshot.lastRecoveryAction = action;
    this.snapshot.lastRecoveryAt = Date.now();
    this.refreshDerivedState();
  }

  markRecoveryFinished(
    success: boolean,
    errorCode?: string | null,
    errorMessage?: string | null,
  ): void {
    this.snapshot.recoveryInFlight = false;
    this.snapshot.lastRecoveryAt = Date.now();
    if (success) {
      this.snapshot.lastBridgeReadyAt = Date.now();
      this.snapshot.lastBridgeErrorCode = null;
      this.snapshot.lastBridgeErrorMessage = null;
    } else {
      this.snapshot.lastBridgeErrorCode = errorCode ?? this.snapshot.lastBridgeErrorCode;
      this.snapshot.lastBridgeErrorMessage = errorMessage ?? this.snapshot.lastBridgeErrorMessage;
    }
    this.refreshDerivedState();
  }

  setBridgeError(code: string, message: string): void {
    this.snapshot.lastBridgeErrorCode = code;
    this.snapshot.lastBridgeErrorMessage = message;
    this.refreshDerivedState();
  }

  getSnapshot(): BridgeRuntimeSnapshot {
    this.refreshDerivedState();
    return {
      ...this.snapshot,
      heartbeat: { ...this.snapshot.heartbeat },
    };
  }

  private normalizeNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private normalizeNullableNumber(value: unknown): number | null {
    return Number.isFinite(value) ? Number(value) : null;
  }

  private refreshDerivedState(now: number = Date.now()): void {
    const heartbeatFresh =
      this.snapshot.extensionHeartbeatAt !== null &&
      now - this.snapshot.extensionHeartbeatAt <= HEARTBEAT_TIMEOUT_MS;
    const commandReady = this.snapshot.commandChannelConnected || this.snapshot.nativeHostAttached;
    const bridgeReady = commandReady && heartbeatFresh;

    if (this.snapshot.recoveryInFlight) {
      this.snapshot.bridgeState = 'BRIDGE_CONNECTING';
      return;
    }

    if (!this.snapshot.browserProcessRunning) {
      this.snapshot.bridgeState = 'BROWSER_NOT_RUNNING';
      return;
    }

    if (bridgeReady) {
      this.snapshot.bridgeState = 'READY';
      return;
    }

    if (
      (heartbeatFresh && !commandReady) ||
      (this.snapshot.commandChannelConnected && !heartbeatFresh)
    ) {
      this.snapshot.bridgeState = 'BRIDGE_DEGRADED';
      return;
    }

    const recentlyReady =
      this.snapshot.lastBridgeReadyAt !== null &&
      now - this.snapshot.lastBridgeReadyAt <= DEGRADED_WINDOW_MS;
    const recentlyHadCommandChannel =
      this.snapshot.lastCommandChannelAt !== null &&
      now - this.snapshot.lastCommandChannelAt <= DEGRADED_WINDOW_MS;
    const recoveryFailedAfterReady =
      this.snapshot.lastRecoveryAt !== null &&
      this.snapshot.lastBridgeReadyAt !== null &&
      this.snapshot.lastRecoveryAt >= this.snapshot.lastBridgeReadyAt &&
      !!this.snapshot.lastBridgeErrorCode;

    if (recoveryFailedAfterReady) {
      this.snapshot.bridgeState = 'BRIDGE_BROKEN';
      return;
    }

    if (recentlyReady || recentlyHadCommandChannel) {
      this.snapshot.bridgeState = 'BRIDGE_DEGRADED';
      return;
    }

    this.snapshot.bridgeState = 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE';
  }
}

export const bridgeRuntimeState = new BridgeStateManager();
