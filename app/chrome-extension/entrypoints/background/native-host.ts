import { NativeMessageType } from '@tabrix/shared';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { NATIVE_HOST, STORAGE_KEYS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '@/common/constants';
import { normalizeNativeLastError } from '@/common/normalize-native-last-error';
import { isNoServiceWorkerError } from '@/common/is-no-service-worker-error';
import { handleCallTool } from './tools';
import { listPublished, getFlow } from './record-replay/flow-store';
import { registerNativeBridgeForwarder, registerNativeBridgeRequester } from './native-bridge';
import { acquireKeepalive } from './keepalive-manager';

const LOG_PREFIX = '[NativeHost]';

let nativePort: chrome.runtime.Port | null = null;
export const HOST_NAME = NATIVE_HOST.NAME;

// ==================== Reconnect Configuration ====================

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 60_000;
const RECONNECT_MAX_FAST_ATTEMPTS = 8;
const RECONNECT_COOLDOWN_DELAY_MS = 5 * 60_000;

// ==================== Auto-connect State ====================

let keepaliveRelease: (() => void) | null = null;
let autoConnectEnabled = true;
let autoConnectLoaded = false;
let ensurePromise: Promise<boolean> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manualDisconnect = false;
let manualDisconnectConnectionId: number | null = null;
let activeNativeConnectionId = 0;
let nextNativeConnectionId = 0;

import type { ServerStatus } from '../../common/connection-state';

let lastNativeError: string | null = null;
const pendingNativeBridgeRequests = new Map<
  string,
  {
    resolve: (payload: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

let currentServerStatus: ServerStatus = {
  isRunning: false,
  lastUpdated: Date.now(),
};

/**
 * Save server status to chrome.storage
 */
async function saveServerStatus(status: ServerStatus): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.SERVER_STATUS]: status });
  } catch (error) {
    console.error(ERROR_MESSAGES.SERVER_STATUS_SAVE_FAILED, error);
  }
}

async function saveLastNativeError(error: string | null): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_NATIVE_ERROR]: error });
  } catch (storageError) {
    if (isNoServiceWorkerError(storageError)) {
      console.warn(`${LOG_PREFIX} Skipping last native error save during SW startup`, storageError);
    } else {
      console.error(`${LOG_PREFIX} Failed to save last native error`, storageError);
    }
  }
}

async function loadLastNativeError(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.LAST_NATIVE_ERROR]);
    const value = result[STORAGE_KEYS.LAST_NATIVE_ERROR];
    return normalizeNativeLastError(value);
  } catch (storageError) {
    if (isNoServiceWorkerError(storageError)) {
      console.warn(`${LOG_PREFIX} Last native error not available during SW startup`, storageError);
    } else {
      console.error(`${LOG_PREFIX} Failed to load last native error`, storageError);
    }
    return null;
  }
}

async function setLastNativeError(error: unknown): Promise<void> {
  const message = normalizeNativeLastError(error);
  lastNativeError = message;
  await saveLastNativeError(message);
}

async function clearLastNativeError(): Promise<void> {
  lastNativeError = null;
  await saveLastNativeError(null);
}

/**
 * Load server status from chrome.storage
 */
async function loadServerStatus(): Promise<ServerStatus> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.SERVER_STATUS]);
    if (result[STORAGE_KEYS.SERVER_STATUS]) {
      return result[STORAGE_KEYS.SERVER_STATUS];
    }
  } catch (error) {
    if (isNoServiceWorkerError(error)) {
      console.warn(`${ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED} (transient SW startup)`, error);
    } else {
      console.error(ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED, error);
    }
  }
  return {
    isRunning: false,
    lastUpdated: Date.now(),
  };
}

/**
 * Broadcast server status change to all listeners
 */
function broadcastServerStatusChange(status: ServerStatus): void {
  chrome.runtime
    .sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED,
      payload: status,
      connected: nativePort !== null,
      lastError: lastNativeError,
    })
    .catch(() => {
      // Ignore errors if no listeners are present
    });
}

// ==================== Port Normalization ====================

/**
 * Normalize a port value to a valid port number or null.
 */
function normalizePort(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  const port = Math.floor(n);
  if (port <= 0 || port > 65535) return null;
  return port;
}

function isAddressInUseError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('eaddrinuse') || normalized.includes('address already in use');
}

function parseAddressInUsePort(message: string): number | null {
  const explicitHostMatch = message.match(/:(\d{2,5})(?:\b|$)/);
  if (explicitHostMatch?.[1]) {
    const parsed = normalizePort(explicitHostMatch[1]);
    if (parsed) return parsed;
  }

  const genericPortMatch = message.match(/\bport\s*[:=]?\s*(\d{2,5})\b/i);
  if (genericPortMatch?.[1]) {
    return normalizePort(genericPortMatch[1]);
  }

  return null;
}

// ==================== Reconnect Utilities ====================

/**
 * Add jitter to a delay value to avoid thundering herd.
 */
function withJitter(ms: number): number {
  const ratio = 0.7 + Math.random() * 0.6;
  return Math.max(0, Math.round(ms * ratio));
}

/**
 * Calculate reconnect delay based on attempt number.
 * Uses exponential backoff with jitter, then switches to cooldown interval.
 */
function getReconnectDelayMs(attempt: number): number {
  if (attempt >= RECONNECT_MAX_FAST_ATTEMPTS) {
    return withJitter(RECONNECT_COOLDOWN_DELAY_MS);
  }
  const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt), RECONNECT_MAX_DELAY_MS);
  return withJitter(delay);
}

/**
 * Clear the reconnect timer if active.
 */
function clearReconnectTimer(): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function isActiveNativeConnection(connectionId: number, port: chrome.runtime.Port | null): boolean {
  return activeNativeConnectionId === connectionId && nativePort === port;
}

function hasNewerActiveConnection(connectionId?: number): boolean {
  return (
    connectionId !== undefined &&
    activeNativeConnectionId !== 0 &&
    activeNativeConnectionId !== connectionId
  );
}

/**
 * Reset reconnect state after successful connection.
 */
function resetReconnectState(): void {
  reconnectAttempts = 0;
  clearReconnectTimer();
}

// ==================== Keepalive Management ====================

/**
 * Sync keepalive hold based on autoConnectEnabled state.
 * When auto-connect is enabled, we hold a keepalive reference to keep SW alive.
 */
function syncKeepaliveHold(): void {
  if (autoConnectEnabled) {
    if (!keepaliveRelease) {
      keepaliveRelease = acquireKeepalive('native-host');
      console.debug(`${LOG_PREFIX} Acquired keepalive`);
    }
    return;
  }
  if (keepaliveRelease) {
    try {
      keepaliveRelease();
      console.debug(`${LOG_PREFIX} Released keepalive`);
    } catch {
      // Ignore
    }
    keepaliveRelease = null;
  }
}

// ==================== Auto-connect Settings ====================

/**
 * Load the nativeAutoConnectEnabled setting from storage.
 */
async function loadNativeAutoConnectEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.NATIVE_AUTO_CONNECT_ENABLED]);
    const raw = result[STORAGE_KEYS.NATIVE_AUTO_CONNECT_ENABLED];
    if (typeof raw === 'boolean') return raw;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to load nativeAutoConnectEnabled`, error);
  }
  return true; // Default to enabled
}

/**
 * Set the nativeAutoConnectEnabled setting and persist to storage.
 */
async function setNativeAutoConnectEnabled(enabled: boolean): Promise<void> {
  autoConnectEnabled = enabled;
  autoConnectLoaded = true;
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.NATIVE_AUTO_CONNECT_ENABLED]: enabled });
    console.debug(`${LOG_PREFIX} Set nativeAutoConnectEnabled=${enabled}`);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to persist nativeAutoConnectEnabled`, error);
  }
  syncKeepaliveHold();
}

// ==================== Port Preference ====================

/**
 * Get the preferred port for connecting to native server.
 * Priority: explicit override > user preference > last known port > default
 */
async function getPreferredPort(override?: unknown): Promise<number> {
  const explicit = normalizePort(override);
  if (explicit) return explicit;

  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.NATIVE_SERVER_PORT,
      STORAGE_KEYS.SERVER_STATUS,
    ]);

    const userPort = normalizePort(result[STORAGE_KEYS.NATIVE_SERVER_PORT]);
    if (userPort) return userPort;

    const status = result[STORAGE_KEYS.SERVER_STATUS] as Partial<ServerStatus> | undefined;
    const statusPort = normalizePort(status?.port);
    if (statusPort) return statusPort;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to read preferred port`, error);
  }

  const inMemoryPort = normalizePort(currentServerStatus.port);
  if (inMemoryPort) return inMemoryPort;

  return NATIVE_HOST.DEFAULT_PORT;
}

// ==================== Reconnect Scheduling ====================

/**
 * Schedule a reconnect attempt with exponential backoff.
 */
function scheduleReconnect(reason: string): void {
  if (nativePort) return;
  if (manualDisconnect) return;
  if (!autoConnectEnabled) return;
  if (reconnectTimer) return;

  const delay = getReconnectDelayMs(reconnectAttempts);
  console.debug(
    `${LOG_PREFIX} Reconnect scheduled in ${delay}ms (attempt=${reconnectAttempts}, reason=${reason})`,
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (nativePort) return;
    if (manualDisconnect || !autoConnectEnabled) return;

    reconnectAttempts += 1;
    void ensureNativeConnected(`reconnect:${reason}`).catch(() => {});
  }, delay);
}

// ==================== Server Status Update ====================

/**
 * Mark server as stopped and broadcast the change.
 */
async function markServerStopped(reason: string, connectionId?: number): Promise<void> {
  if (hasNewerActiveConnection(connectionId)) {
    console.debug(`${LOG_PREFIX} Ignoring stale stopped state before save (${reason})`);
    return;
  }

  const nextStatus: ServerStatus = {
    isRunning: false,
    port: currentServerStatus.port,
    lastUpdated: Date.now(),
  };
  currentServerStatus = nextStatus;
  try {
    await saveServerStatus(nextStatus);
  } catch {
    // Ignore
  }

  if (hasNewerActiveConnection(connectionId)) {
    console.debug(`${LOG_PREFIX} Ignoring stale stopped state after save (${reason})`);
    return;
  }

  broadcastServerStatusChange(nextStatus);
  console.debug(`${LOG_PREFIX} Server marked stopped (${reason})`);
}

async function probeRunningServerStatus(port: number): Promise<ServerStatus | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as
      | {
          status?: string;
          data?: {
            isRunning?: boolean;
            port?: number;
            host?: string;
            networkAddresses?: string[];
            authEnabled?: boolean;
          };
        }
      | undefined;

    if (!payload?.data?.isRunning) return null;

    return {
      isRunning: true,
      port: normalizePort(payload.data.port) ?? port,
      host: payload.data.host,
      networkAddresses: payload.data.networkAddresses,
      authEnabled: payload.data.authEnabled,
      lastUpdated: Date.now(),
    };
  } catch {
    return null;
  }
}

async function tryRecoverAddressInUseStatus(nativeError: string): Promise<boolean> {
  if (!isAddressInUseError(nativeError)) return false;

  const parsedPort = parseAddressInUsePort(nativeError);
  const fallbackPort = normalizePort(currentServerStatus.port) ?? NATIVE_HOST.DEFAULT_PORT;
  const candidatePort = parsedPort ?? fallbackPort;
  const recoveredStatus = await probeRunningServerStatus(candidatePort);
  if (!recoveredStatus) return false;

  currentServerStatus = recoveredStatus;
  await clearLastNativeError();
  await saveServerStatus(recoveredStatus);
  broadcastServerStatusChange(recoveredStatus);
  resetReconnectState();
  console.info(
    `${LOG_PREFIX} Detected existing server on port ${recoveredStatus.port}; treated as running.`,
  );
  return true;
}

function getEffectiveServerStatus(): ServerStatus {
  if (!nativePort && currentServerStatus.isRunning) {
    return {
      isRunning: false,
      port: currentServerStatus.port,
      lastUpdated: currentServerStatus.lastUpdated,
    };
  }

  return currentServerStatus;
}

async function waitForServerStatusSettle(timeoutMs: number = 1200): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!nativePort) return;
    if (currentServerStatus.isRunning) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function getSettledNativeConnectionState(
  expectedPort: chrome.runtime.Port | null,
  timeoutMs: number = 250,
): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (nativePort !== expectedPort) return false;
    if (!nativePort) return false;
    if (currentServerStatus.isRunning) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return nativePort === expectedPort && nativePort !== null;
}

// ==================== Core Ensure Function ====================

/**
 * Ensure native connection is established.
 * This is the main entry point for auto-connect logic.
 *
 * @param trigger - Description of what triggered this call (for logging)
 * @param portOverride - Optional explicit port to use
 * @returns Whether the connection is now established
 */
async function ensureNativeConnected(trigger: string, portOverride?: unknown): Promise<boolean> {
  // Concurrency protection: only one ensure flow at a time
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    // Load auto-connect setting if not yet loaded
    if (!autoConnectLoaded) {
      autoConnectEnabled = await loadNativeAutoConnectEnabled();
      autoConnectLoaded = true;
      syncKeepaliveHold();
    }

    // If auto-connect is disabled, do nothing
    if (!autoConnectEnabled) {
      console.debug(`${LOG_PREFIX} Auto-connect disabled, skipping ensure (trigger=${trigger})`);
      return false;
    }

    // Sync keepalive hold
    syncKeepaliveHold();

    // Already connected
    if (nativePort) {
      console.debug(`${LOG_PREFIX} Already connected (trigger=${trigger})`);
      return true;
    }

    // Get the port to use
    const port = await getPreferredPort(portOverride);
    console.debug(`${LOG_PREFIX} Attempting connection on port ${port} (trigger=${trigger})`);

    // Attempt connection
    const ok = connectNativeHost(port);
    if (!ok) {
      console.warn(`${LOG_PREFIX} Connection failed (trigger=${trigger})`);
      scheduleReconnect(`connect_failed:${trigger}`);
      return false;
    }

    console.debug(`${LOG_PREFIX} Connection initiated successfully (trigger=${trigger})`);
    // Note: Don't reset reconnect state here. Wait for SERVER_STARTED confirmation.
    // Chrome may return a Port but disconnect immediately if native host is missing.
    return true;
  })().finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

/**
 * Connect to the native messaging host
 * @returns Whether the connection was initiated successfully
 */
export function connectNativeHost(port: number = NATIVE_HOST.DEFAULT_PORT): boolean {
  if (nativePort) {
    return true;
  }

  try {
    const portHandle = chrome.runtime.connectNative(HOST_NAME);
    const connectionId = ++nextNativeConnectionId;
    nativePort = portHandle;
    activeNativeConnectionId = connectionId;

    portHandle.onMessage.addListener(async (message) => {
      if (!isActiveNativeConnection(connectionId, portHandle)) {
        console.debug(`${LOG_PREFIX} Ignoring message from stale native connection`, message?.type);
        return;
      }

      if (message.type === NativeMessageType.PROCESS_DATA && message.requestId) {
        const requestId = message.requestId;
        const requestPayload = message.payload;

        portHandle.postMessage({
          responseToRequestId: requestId,
          payload: {
            status: 'success',
            message: SUCCESS_MESSAGES.TOOL_EXECUTED,
            data: requestPayload,
          },
        });
      } else if (message.type === NativeMessageType.CALL_TOOL && message.requestId) {
        const requestId = message.requestId;
        try {
          const result = await handleCallTool(message.payload);
          if (!isActiveNativeConnection(connectionId, portHandle)) return;
          portHandle.postMessage({
            responseToRequestId: requestId,
            payload: {
              status: 'success',
              message: SUCCESS_MESSAGES.TOOL_EXECUTED,
              data: result,
            },
          });
        } catch (error) {
          if (!isActiveNativeConnection(connectionId, portHandle)) return;
          portHandle.postMessage({
            responseToRequestId: requestId,
            payload: {
              status: 'error',
              message: ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      } else if (message.type === 'rr_list_published_flows' && message.requestId) {
        const requestId = message.requestId;
        try {
          const published = await listPublished();
          const items = [] as any[];
          for (const p of published) {
            const flow = await getFlow(p.id);
            if (!flow) continue;
            items.push({
              id: p.id,
              slug: p.slug,
              version: p.version,
              name: p.name,
              description: p.description || flow.description || '',
              variables: flow.variables || [],
              meta: flow.meta || {},
            });
          }
          if (!isActiveNativeConnection(connectionId, portHandle)) return;
          portHandle.postMessage({
            responseToRequestId: requestId,
            payload: { status: 'success', items },
          });
        } catch (error: any) {
          if (!isActiveNativeConnection(connectionId, portHandle)) return;
          portHandle.postMessage({
            responseToRequestId: requestId,
            payload: { status: 'error', error: error?.message || String(error) },
          });
        }
      } else if (message.type === NativeMessageType.SERVER_STARTED) {
        const port = message.payload?.port;
        currentServerStatus = {
          isRunning: true,
          port: port,
          host: message.payload?.host,
          networkAddresses: message.payload?.networkAddresses,
          authEnabled: message.payload?.authEnabled ?? false,
          lastUpdated: Date.now(),
        };
        await clearLastNativeError();
        await saveServerStatus(currentServerStatus);
        broadcastServerStatusChange(currentServerStatus);
        // Server is confirmed running - now we can reset reconnect state
        resetReconnectState();
        console.log(`${SUCCESS_MESSAGES.SERVER_STARTED} on port ${port}`);
      } else if (message.type === NativeMessageType.SERVER_STOPPED) {
        currentServerStatus = {
          isRunning: false,
          port: currentServerStatus.port, // Keep last known port for reconnection
          lastUpdated: Date.now(),
        };
        await saveServerStatus(currentServerStatus);
        broadcastServerStatusChange(currentServerStatus);
        console.log(SUCCESS_MESSAGES.SERVER_STOPPED);
      } else if (message.type === 'remote_access_changed') {
        currentServerStatus = {
          isRunning: true,
          port: message.payload?.port,
          host: message.payload?.host,
          networkAddresses: message.payload?.networkAddresses,
          authEnabled: message.payload?.authEnabled ?? false,
          lastUpdated: Date.now(),
        };
        await saveServerStatus(currentServerStatus);
        broadcastServerStatusChange(currentServerStatus);
        console.log(
          `[NativeHost] Remote access ${message.payload?.enabled ? 'enabled' : 'disabled'}, host=${message.payload?.host}`,
        );
      } else if (message.type === NativeMessageType.ERROR_FROM_NATIVE_HOST) {
        const nativeError = message.payload?.message || 'Unknown error';
        const recovered = await tryRecoverAddressInUseStatus(nativeError);
        if (!recovered) {
          console.error('Error from native host:', nativeError);
          void setLastNativeError(nativeError);
        }
      } else if (message.type === 'file_operation_response') {
        const pendingRequestId = String(message.responseToRequestId || '');
        const pendingRequest = pendingNativeBridgeRequests.get(pendingRequestId);
        if (pendingRequest) {
          pendingNativeBridgeRequests.delete(pendingRequestId);
          if (message.error) {
            pendingRequest.reject(new Error(String(message.error)));
          } else {
            pendingRequest.resolve((message.payload || {}) as any);
          }
        }
        // Forward file operation response back to the requesting tool
        chrome.runtime.sendMessage(message).catch(() => {
          // Ignore if no listeners
        });
      }
    });

    portHandle.onDisconnect.addListener(() => {
      const isManualDisconnectForThisConnection =
        manualDisconnect &&
        manualDisconnectConnectionId !== null &&
        manualDisconnectConnectionId === connectionId;

      if (isManualDisconnectForThisConnection) {
        manualDisconnect = false;
        manualDisconnectConnectionId = null;
      }

      if (!isActiveNativeConnection(connectionId, portHandle)) {
        return;
      }

      const lastError = chrome.runtime.lastError?.message || null;
      const wasManualDisconnect = isManualDisconnectForThisConnection;
      manualDisconnect = false;
      manualDisconnectConnectionId = null;
      nativePort = null;
      activeNativeConnectionId = 0;

      for (const [requestId, pendingRequest] of pendingNativeBridgeRequests.entries()) {
        pendingNativeBridgeRequests.delete(requestId);
        clearTimeout(pendingRequest.timer);
        pendingRequest.reject(new Error('Native connection disconnected during file operation'));
      }

      if (wasManualDisconnect) {
        return;
      }

      console.warn(ERROR_MESSAGES.NATIVE_DISCONNECTED, chrome.runtime.lastError);

      if (lastError) {
        lastNativeError = lastError;
        void saveLastNativeError(lastError);
      }

      // Mark server as stopped since native host disconnection means server is down
      void markServerStopped('native_port_disconnected', connectionId);

      // Handle reconnection based on disconnect reason
      if (!autoConnectEnabled) return;
      scheduleReconnect('native_port_disconnected');
    });

    portHandle.postMessage({ type: NativeMessageType.START, payload: { port } });
    // Note: Don't reset reconnect state here. Wait for SERVER_STARTED confirmation.
    // Chrome may return a Port but disconnect immediately if native host is missing.
    return true;
  } catch (error) {
    console.warn(ERROR_MESSAGES.NATIVE_CONNECTION_FAILED, error);
    nativePort = null;
    void setLastNativeError(error);
    return false;
  }
}

async function forwardMessageToNativeHost(message: any): Promise<void> {
  if (!nativePort) {
    if (!autoConnectEnabled) {
      await setNativeAutoConnectEnabled(true);
    }
    const ensured = await ensureNativeConnected('forward_to_native');
    if (!ensured) {
      const port = await getPreferredPort();
      const connected = connectNativeHost(port);
      if (!connected) {
        throw new Error('Native host not connected');
      }
    }
  }

  if (nativePort && !currentServerStatus.isRunning) {
    await waitForServerStatusSettle(800);
  }

  if (!nativePort) {
    throw new Error('Native host not connected');
  }

  nativePort.postMessage(message);
}

async function requestMessageViaNativeHost(request: {
  requestId: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}): Promise<any> {
  const { requestId, payload, timeoutMs } = request;

  if (!nativePort) {
    if (!autoConnectEnabled) {
      await setNativeAutoConnectEnabled(true);
    }
    const ensured = await ensureNativeConnected('native_bridge_request');
    if (!ensured) {
      const port = await getPreferredPort();
      const connected = connectNativeHost(port);
      if (!connected) {
        throw new Error('Native host not connected');
      }
    }
  }

  if (nativePort && !currentServerStatus.isRunning) {
    await waitForServerStatusSettle(800);
  }

  if (!nativePort) {
    throw new Error('Native host not connected');
  }

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingNativeBridgeRequests.delete(requestId);
      reject(new Error(`Native file operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingNativeBridgeRequests.set(requestId, {
      resolve: (responsePayload) => {
        clearTimeout(timer);
        resolve(responsePayload);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      timer,
    });

    try {
      nativePort!.postMessage({
        type: 'file_operation',
        requestId,
        payload,
      });
    } catch (error) {
      pendingNativeBridgeRequests.delete(requestId);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Initialize native host listeners and load initial state
 */
export const initNativeHostListener = () => {
  registerNativeBridgeForwarder((message) => forwardMessageToNativeHost(message));
  registerNativeBridgeRequester((request) => requestMessageViaNativeHost(request));
  // Initialize server status from storage
  loadServerStatus()
    .then((status) => {
      currentServerStatus = status;
    })
    .catch((error) => {
      console.error(ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED, error);
    });
  loadLastNativeError()
    .then((error) => {
      lastNativeError = error;
    })
    .catch((error) => {
      console.error(`${LOG_PREFIX} Failed to initialize last native error`, error);
    });

  // Auto-connect on SW activation (covers SW restart after idle termination).
  // Self-heal persisted "auto connect disabled" state so unattended flows can recover after restarts.
  void (async () => {
    if (!autoConnectLoaded) {
      autoConnectEnabled = await loadNativeAutoConnectEnabled();
      autoConnectLoaded = true;
      syncKeepaliveHold();
    }
    if (!autoConnectEnabled) {
      console.info(`${LOG_PREFIX} Auto-connect was disabled; re-enabling on startup for recovery.`);
      await setNativeAutoConnectEnabled(true);
    }
    await ensureNativeConnected('sw_startup');
  })().catch(() => {});

  // Auto-connect on Chrome browser startup
  chrome.runtime.onStartup.addListener(() => {
    void ensureNativeConnected('onStartup').catch(() => {});
  });

  // Auto-connect on extension install/update
  chrome.runtime.onInstalled.addListener(() => {
    void ensureNativeConnected('onInstalled').catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Allow UI to call tools directly
    if (message && message.type === 'call_tool' && message.name) {
      handleCallTool({ name: message.name, args: message.args })
        .then((res) => sendResponse({ success: true, result: res }))
        .catch((err) =>
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true;
    }

    const msgType = typeof message === 'string' ? message : message?.type;

    // ENSURE_NATIVE: Trigger ensure without changing autoConnectEnabled
    if (msgType === NativeMessageType.ENSURE_NATIVE) {
      const portOverride = typeof message === 'object' ? message.port : undefined;
      ensureNativeConnected('ui_ensure', portOverride)
        .then(async (connected) => {
          const expectedPort = nativePort;
          const settledConnected =
            connected && nativePort && !currentServerStatus.isRunning
              ? await getSettledNativeConnectionState(expectedPort)
              : connected;
          sendResponse({
            success: true,
            connected: settledConnected,
            autoConnectEnabled,
            lastError: lastNativeError,
          });
        })
        .catch((e) => {
          sendResponse({
            success: false,
            connected: nativePort !== null,
            error: String(e),
            lastError: lastNativeError,
          });
        });
      return true;
    }

    // CONNECT_NATIVE: Explicit user connect, re-enables auto-connect
    if (msgType === NativeMessageType.CONNECT_NATIVE) {
      const portOverride = typeof message === 'object' ? message.port : undefined;
      const normalized = normalizePort(portOverride);

      (async () => {
        // Explicit user connect: re-enable auto-connect
        await setNativeAutoConnectEnabled(true);

        if (normalized) {
          // Best-effort: persist preferred port
          try {
            await chrome.storage.local.set({ [STORAGE_KEYS.NATIVE_SERVER_PORT]: normalized });
          } catch {
            // Ignore
          }
        }

        return ensureNativeConnected('ui_connect', normalized ?? undefined);
      })()
        .then(async (connected) => {
          const expectedPort = nativePort;
          const settledConnected =
            connected && nativePort && !currentServerStatus.isRunning
              ? await getSettledNativeConnectionState(expectedPort)
              : connected;
          sendResponse({ success: true, connected: settledConnected, lastError: lastNativeError });
        })
        .catch((e) => {
          sendResponse({
            success: false,
            connected: nativePort !== null,
            error: String(e),
            lastError: lastNativeError,
          });
        });
      return true;
    }

    if (msgType === NativeMessageType.PING_NATIVE) {
      const connected = nativePort !== null;
      sendResponse({ connected, autoConnectEnabled });
      return true;
    }

    if (msgType === 'set_remote_access') {
      const enable = typeof message === 'object' ? !!message.enable : false;
      (async () => {
        if (!nativePort) {
          await ensureNativeConnected('ui_set_remote_access');
        }

        if (!nativePort) {
          sendResponse({ success: false, error: 'Native host not connected' });
          return;
        }

        try {
          nativePort.postMessage({
            type: 'set_remote_access',
            payload: { enable },
          });
          sendResponse({ success: true });
        } catch (error) {
          await setLastNativeError(error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })().catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return true;
    }

    // DISCONNECT_NATIVE: Explicit user disconnect, disables auto-connect
    if (msgType === NativeMessageType.DISCONNECT_NATIVE) {
      (async () => {
        // Explicit user disconnect: disable auto-connect and stop reconnect loop
        await setNativeAutoConnectEnabled(false);
        clearReconnectTimer();
        reconnectAttempts = 0;
        syncKeepaliveHold();

        const disconnectedConnectionId = activeNativeConnectionId || undefined;
        if (nativePort) {
          // Only set manualDisconnect if we actually have a port to disconnect.
          // This prevents the flag from persisting when there's no active connection.
          manualDisconnect = true;
          manualDisconnectConnectionId = disconnectedConnectionId ?? null;
          try {
            nativePort.disconnect();
          } catch {
            manualDisconnect = false;
            manualDisconnectConnectionId = null;
            // Ignore
          }
          nativePort = null;
          activeNativeConnectionId = 0;
        } else {
          manualDisconnect = false;
          manualDisconnectConnectionId = null;
        }
        await clearLastNativeError();
        await markServerStopped('manual_disconnect', disconnectedConnectionId);
      })()
        .then(() => {
          sendResponse({ success: true, lastError: null });
        })
        .catch((e) => {
          sendResponse({ success: false, error: String(e), lastError: lastNativeError });
        });
      return true;
    }

    if (message.type === BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS) {
      sendResponse({
        success: true,
        serverStatus: getEffectiveServerStatus(),
        connected: nativePort !== null,
        lastError: lastNativeError,
      });
      return true;
    }

    if (message.type === BACKGROUND_MESSAGE_TYPES.REFRESH_SERVER_STATUS) {
      (async () => {
        const storedStatus = await loadServerStatus();
        currentServerStatus = storedStatus;

        if (!nativePort) {
          await ensureNativeConnected('ui_refresh_status').catch(() => false);
        }

        if (nativePort && !currentServerStatus.isRunning) {
          await waitForServerStatusSettle();
        }

        if (!nativePort && currentServerStatus.isRunning) {
          await markServerStopped('refresh_without_native_port');
        }

        return {
          success: true,
          serverStatus: getEffectiveServerStatus(),
          connected: nativePort !== null,
          lastError: lastNativeError,
        };
      })()
        .then((payload) => {
          sendResponse({
            ...payload,
          });
        })
        .catch((error) => {
          console.error(ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED, error);
          sendResponse({
            success: false,
            error: ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED,
            serverStatus: getEffectiveServerStatus(),
            connected: nativePort !== null,
            lastError: lastNativeError,
          });
        });
      return true;
    }

    // Forward file operation messages to native host
    if (message.type === 'forward_to_native' && message.message) {
      forwardMessageToNativeHost(message.message)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }
  });
};
