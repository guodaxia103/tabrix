/**
 * HTTP Server - Core server implementation.
 *
 * Responsibilities:
 * - Fastify instance management
 * - Plugin registration (CORS, etc.)
 * - Route delegation to specialized modules
 * - MCP transport handling
 * - Server lifecycle management
 */
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import os from 'os';
import { Duplex } from 'node:stream';
import {
  NATIVE_SERVER_PORT,
  TIMEOUTS,
  SERVER_CONFIG,
  HTTP_STATUS,
  ERROR_MESSAGES,
} from '../constant';
import { tokenManager } from './auth';
import { NativeMessagingHost } from '../native-messaging-host';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../mcp/mcp-server';
import { __bridgeLaunchInternals } from '../mcp/register-tools';
import { sessionManager } from '../execution/session-manager';
import { SessionRegistry, type ConnectedClient, type TransportsSnapshot } from './session-registry';
import { bridgeRuntimeState, type BridgeRuntimeSnapshot } from './bridge-state';
import {
  bridgeCommandChannel,
  __bridgeCommandChannelInternals,
  type BridgeCommandChannelTestMode,
} from './bridge-command-channel';
import fileHandler from '../file-handler';
import {
  describeBridgeRecoveryGuidance,
  type BridgeRecoveryGuidance,
} from '../scripts/bridge-recovery-guidance';

// Compatibility guard:
// @hono/node-server may call socket.destroySoon() while draining incoming requests.
// Some socket-like streams in Node 22 environments don't implement destroySoon().
// Provide a conservative fallback to avoid uncaught TypeError during shutdown.
const duplexPrototype = Duplex.prototype as Duplex & {
  destroySoon?: () => void;
  end?: () => void;
  destroy?: () => void;
};
if (typeof duplexPrototype.destroySoon !== 'function') {
  duplexPrototype.destroySoon = function destroySoonFallback() {
    try {
      this.end?.();
    } catch {
      // ignore
    }
    try {
      this.destroy?.();
    } catch {
      // ignore
    }
  };
}

// ============================================================
// Types
// ============================================================

interface ExtensionRequestPayload {
  data?: unknown;
}

interface BridgeHeartbeatPayload {
  extensionId?: unknown;
  connectionId?: unknown;
  sentAt?: unknown;
  nativeConnected?: unknown;
  browserVersion?: unknown;
  tabCount?: unknown;
  windowCount?: unknown;
  autoConnectEnabled?: unknown;
}

interface BridgeFileOperationPayload {
  requestId?: unknown;
  payload?: unknown;
}

interface BridgeRecoveryStartPayload {
  action?: unknown;
}

interface BridgeRecoveryFinishPayload {
  success?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
}

interface BridgeTestingBrowserLaunchOverridePayload {
  commands?: unknown;
}

interface BridgeTestingCommandChannelPayload {
  mode?: unknown;
}

interface ServerStatusSnapshot {
  isRunning: boolean;
  host: string;
  port: number | null;
  networkAddresses?: string[];
  authEnabled: boolean;
  securityWarning?: string;
  nativeHostAttached: boolean;
  bridge: BridgeRuntimeSnapshot & {
    guidance: BridgeRecoveryGuidance;
  };
  transports: TransportsSnapshot;
  execution: {
    tasks: {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
      cancelled: number;
    };
    sessions: {
      total: number;
      starting: number;
      running: number;
      completed: number;
      failed: number;
      aborted: number;
    };
    lastSessionId: string | null;
    persistenceMode: 'disk' | 'memory' | 'off';
  };
}

export type { ConnectedClient };

function canWriteReply(reply: FastifyReply): boolean {
  return !reply.sent && !reply.raw.writableEnded && !reply.raw.headersSent;
}

function getLocalNetworkAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const virtualPatterns =
    /^(vEthernet|Tailscale|Meta|VMware|VirtualBox|docker|br-|virbr|tun|tap|utun|wg)/i;
  const results: Array<{ name: string; address: string; priority: number }> = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      let priority = 50;
      if (virtualPatterns.test(name)) priority = 90;
      else if (/^(WLAN|Wi-Fi|wlan|en0|eth)/i.test(name)) priority = 10;
      else if (/^(Ethernet|eth|en)/i.test(name)) priority = 20;
      if (/^192\.168\./.test(entry.address)) priority -= 5;
      else if (/^10\./.test(entry.address)) priority -= 3;
      results.push({ name, address: entry.address, priority });
    }
  }

  results.sort((a, b) => a.priority - b.priority);
  return results.map((r) => r.address);
}

// ============================================================
// Server Class
// ============================================================

export class Server {
  private fastify: FastifyInstance;
  public isRunning = false;
  private nativeHost: NativeMessagingHost | null = null;
  private sessions = new SessionRegistry();
  private listeningPort: number | null = null;
  private bridgeState = bridgeRuntimeState;

  constructor() {
    this.fastify = Fastify({ logger: SERVER_CONFIG.LOGGER_ENABLED });
    bridgeCommandChannel.attach(this.fastify.server);
    this.setupPlugins();
    this.setupRoutes();
  }

  /**
   * Associate NativeMessagingHost instance.
   */
  public setNativeHost(nativeHost: NativeMessagingHost): void {
    this.nativeHost = nativeHost;
    this.bridgeState.setNativeHostAttached(true);
  }

  public clearNativeHost(nativeHost?: NativeMessagingHost): void {
    if (nativeHost && this.nativeHost !== nativeHost) return;
    this.nativeHost = null;
    this.bridgeState.setNativeHostAttached(false);
  }

  public recordBridgeHeartbeat(
    heartbeat: {
      sentAt?: number | null;
      nativeConnected?: boolean;
      extensionId?: string | null;
      connectionId?: string | null;
      browserVersion?: string | null;
      tabCount?: number | null;
      windowCount?: number | null;
      autoConnectEnabled?: boolean | null;
    } = {},
  ): BridgeRuntimeSnapshot {
    this.bridgeState.recordHeartbeat(heartbeat);
    return this.bridgeState.getSnapshot();
  }

  public markBridgeRecoveryStarted(action: string): void {
    this.bridgeState.markRecoveryStarted(action);
  }

  public markBridgeRecoveryFinished(
    success: boolean,
    errorCode?: string | null,
    errorMessage?: string | null,
  ): void {
    this.bridgeState.markRecoveryFinished(success, errorCode, errorMessage);
  }

  public setBridgeError(code: string, message: string): void {
    this.bridgeState.setBridgeError(code, message);
  }

  private async setupPlugins(): Promise<void> {
    await this.fastify.register(cors, {
      origin: (origin, cb) => {
        // Allow requests with no origin (e.g., curl, server-to-server)
        if (!origin) {
          return cb(null, true);
        }
        // Check if origin matches any pattern in whitelist
        const allowed = SERVER_CONFIG.CORS_ORIGIN.some((pattern) =>
          pattern instanceof RegExp ? pattern.test(origin) : origin.startsWith(pattern),
        );
        cb(null, allowed);
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      credentials: true,
    });
  }

  private setupRoutes(): void {
    const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
    const AUTH_PUBLIC_PATHS = new Set(['/ping', '/status', '/auth/token', '/auth/refresh']);

    this.fastify.addHook('onRequest', async (request, reply) => {
      if (!tokenManager.enabled) return;
      if (AUTH_PUBLIC_PATHS.has(request.url.split('?')[0])) return;
      if (LOCALHOST_IPS.has(request.ip)) return;

      const authHeader = request.headers.authorization;
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const result = tokenManager.verify(bearer);

      if (result === 'expired') {
        reply.status(HTTP_STATUS.UNAUTHORIZED).send({
          status: 'error',
          message:
            'Token expired – refresh via extension popup or POST /auth/refresh from localhost.',
        });
      } else if (result === 'invalid') {
        reply.status(HTTP_STATUS.UNAUTHORIZED).send({
          status: 'error',
          message: 'Unauthorized – provide a valid Bearer token via the Authorization header.',
        });
      }
    });

    // Health check
    this.setupHealthRoutes();

    // Auth token management (localhost only)
    this.setupAuthRoutes();

    // Extension communication
    this.setupExtensionRoutes();

    // MCP routes
    this.setupMcpRoutes();
  }

  // ============================================================
  // Health Routes
  // ============================================================

  private setupHealthRoutes(): void {
    this.fastify.get('/ping', async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        message: 'pong',
      });
    });

    this.fastify.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: this.getStatusSnapshot(),
      });
    });

    this.fastify.delete(
      '/status/sessions/:sessionId',
      async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
        const { sessionId } = request.params;
        const removed = this.forceDisconnectSession(sessionId);
        if (removed) {
          reply.status(HTTP_STATUS.OK).send({ status: 'ok', message: 'Session disconnected' });
        } else {
          reply
            .status(HTTP_STATUS.NOT_FOUND)
            .send({ status: 'error', message: 'Session not found' });
        }
      },
    );

    this.fastify.delete(
      '/status/clients/:clientId',
      async (request: FastifyRequest<{ Params: { clientId: string } }>, reply: FastifyReply) => {
        const { clientId } = request.params;
        const disconnectedSessions = this.forceDisconnectClient(clientId);
        if (disconnectedSessions > 0) {
          reply.status(HTTP_STATUS.OK).send({
            status: 'ok',
            message: 'Client disconnected',
            data: { disconnectedSessions },
          });
        } else {
          reply
            .status(HTTP_STATUS.NOT_FOUND)
            .send({ status: 'error', message: 'Client not found' });
        }
      },
    );
  }

  // ============================================================
  // Auth Routes (localhost only)
  // ============================================================

  private setupAuthRoutes(): void {
    const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

    this.fastify.get('/auth/token', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!LOCALHOST_IPS.has(request.ip)) {
        return reply.status(403).send({
          status: 'error',
          message: 'Forbidden – auth management is only available from localhost.',
        });
      }
      let info = tokenManager.info();
      const host = SERVER_CONFIG.HOST;
      const isWildcard = host === '0.0.0.0' || host === '::';
      if (!info && isWildcard) {
        tokenManager.resolve();
        info = tokenManager.info();
      }
      if (!info) {
        return reply.status(HTTP_STATUS.OK).send({ status: 'ok', data: null });
      }
      reply.status(HTTP_STATUS.OK).send({ status: 'ok', data: info });
    });

    this.fastify.post('/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!LOCALHOST_IPS.has(request.ip)) {
        return reply.status(403).send({
          status: 'error',
          message: 'Forbidden – auth management is only available from localhost.',
        });
      }
      try {
        const body = (request.body || {}) as { ttlDays?: unknown };
        let ttlDays: number | undefined;
        if (body.ttlDays !== undefined && body.ttlDays !== null && body.ttlDays !== '') {
          const n = Number(body.ttlDays);
          if (!Number.isFinite(n) || n < 0 || n > 3650) {
            return reply.status(HTTP_STATUS.BAD_REQUEST).send({
              status: 'error',
              message: 'ttlDays must be a number between 0 and 3650 (0 = never expire).',
            });
          }
          ttlDays = Math.floor(n);
        }
        const data = ttlDays !== undefined ? tokenManager.refresh(ttlDays) : tokenManager.refresh();
        const info = tokenManager.info();
        reply.status(HTTP_STATUS.OK).send({
          status: 'ok',
          data: {
            token: data.token,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
            fromEnv: false,
            ttlDays: info?.ttlDays ?? null,
          },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        reply.status(HTTP_STATUS.BAD_REQUEST).send({ status: 'error', message: msg });
      }
    });
  }

  // ============================================================
  // Extension Routes
  // ============================================================

  private setupExtensionRoutes(): void {
    const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

    this.fastify.get(
      '/ask-extension',
      async (request: FastifyRequest<{ Body: ExtensionRequestPayload }>, reply: FastifyReply) => {
        if (!this.nativeHost) {
          return reply
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.NATIVE_HOST_NOT_AVAILABLE });
        }
        if (!this.isRunning) {
          return reply
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.SERVER_NOT_RUNNING });
        }

        try {
          const extensionResponse = await this.nativeHost.sendRequestToExtensionAndWait(
            request.query,
            'process_data',
            TIMEOUTS.EXTENSION_REQUEST_TIMEOUT,
          );
          return reply.status(HTTP_STATUS.OK).send({ status: 'success', data: extensionResponse });
        } catch (error: unknown) {
          const err = error as Error;
          if (err.message.includes('timed out')) {
            return reply
              .status(HTTP_STATUS.GATEWAY_TIMEOUT)
              .send({ status: 'error', message: ERROR_MESSAGES.REQUEST_TIMEOUT });
          } else {
            return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
              status: 'error',
              message: `Failed to get response from extension: ${err.message}`,
            });
          }
        }
      },
    );

    this.fastify.post(
      '/bridge/heartbeat',
      async (request: FastifyRequest<{ Body: BridgeHeartbeatPayload }>, reply: FastifyReply) => {
        if (!LOCALHOST_IPS.has(request.ip)) {
          return reply.status(403).send({
            status: 'error',
            message: 'Forbidden – bridge heartbeat is only available from localhost.',
          });
        }

        const body = (request.body || {}) as BridgeHeartbeatPayload;
        const snapshot = this.recordBridgeHeartbeat({
          sentAt: Number.isFinite(body.sentAt) ? Number(body.sentAt) : Date.now(),
          nativeConnected: body.nativeConnected === true,
          extensionId: typeof body.extensionId === 'string' ? body.extensionId : null,
          connectionId: typeof body.connectionId === 'string' ? body.connectionId : null,
          browserVersion: typeof body.browserVersion === 'string' ? body.browserVersion : null,
          tabCount: Number.isFinite(body.tabCount) ? Number(body.tabCount) : null,
          windowCount: Number.isFinite(body.windowCount) ? Number(body.windowCount) : null,
          autoConnectEnabled:
            typeof body.autoConnectEnabled === 'boolean' ? body.autoConnectEnabled : null,
        });

        return reply.status(HTTP_STATUS.OK).send({
          status: 'ok',
          data: {
            bridgeState: snapshot.bridgeState,
            recordedAt: Date.now(),
            nextHeartbeatInMs: 5000,
          },
        });
      },
    );

    this.fastify.post(
      '/bridge/file-operation',
      async (
        request: FastifyRequest<{ Body: BridgeFileOperationPayload }>,
        reply: FastifyReply,
      ) => {
        if (!LOCALHOST_IPS.has(request.ip)) {
          return reply.status(403).send({
            status: 'error',
            message: 'Forbidden – bridge file operations are only available from localhost.',
          });
        }

        try {
          const body = (request.body || {}) as BridgeFileOperationPayload;
          const payload =
            body && typeof body.payload === 'object' && body.payload !== null ? body.payload : {};
          const result = await fileHandler.handleFileRequest(payload);
          return reply.status(HTTP_STATUS.OK).send({
            status: 'success',
            requestId:
              typeof body.requestId === 'string' && body.requestId.trim() ? body.requestId : null,
            payload: result,
          });
        } catch (error) {
          return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    this.fastify.post(
      '/bridge/recovery/start',
      async (
        request: FastifyRequest<{ Body: BridgeRecoveryStartPayload }>,
        reply: FastifyReply,
      ) => {
        if (!LOCALHOST_IPS.has(request.ip)) {
          return reply.status(403).send({
            status: 'error',
            message: 'Forbidden – bridge recovery is only available from localhost.',
          });
        }

        const body = (request.body || {}) as BridgeRecoveryStartPayload;
        const action =
          typeof body.action === 'string' && body.action.trim().length > 0
            ? body.action.trim()
            : 'unknown';
        this.markBridgeRecoveryStarted(action);
        return reply.status(HTTP_STATUS.OK).send({
          status: 'ok',
          data: {
            bridgeState: this.getStatusSnapshot().bridge.bridgeState,
            action,
            recordedAt: Date.now(),
          },
        });
      },
    );

    this.fastify.post(
      '/bridge/recovery/finish',
      async (
        request: FastifyRequest<{ Body: BridgeRecoveryFinishPayload }>,
        reply: FastifyReply,
      ) => {
        if (!LOCALHOST_IPS.has(request.ip)) {
          return reply.status(403).send({
            status: 'error',
            message: 'Forbidden – bridge recovery is only available from localhost.',
          });
        }

        const body = (request.body || {}) as BridgeRecoveryFinishPayload;
        const success = body.success === true;
        const errorCode = typeof body.errorCode === 'string' ? body.errorCode : null;
        const errorMessage = typeof body.errorMessage === 'string' ? body.errorMessage : null;
        this.markBridgeRecoveryFinished(success, errorCode, errorMessage);
        return reply.status(HTTP_STATUS.OK).send({
          status: 'ok',
          data: {
            bridgeState: this.getStatusSnapshot().bridge.bridgeState,
            success,
            recordedAt: Date.now(),
          },
        });
      },
    );

    this.fastify.post(
      '/bridge/testing/browser-launch-override',
      async (
        request: FastifyRequest<{ Body: BridgeTestingBrowserLaunchOverridePayload }>,
        reply: FastifyReply,
      ) => {
        if (!LOCALHOST_IPS.has(request.ip)) {
          return reply.status(403).send({
            status: 'error',
            message: 'Forbidden – bridge testing overrides are only available from localhost.',
          });
        }

        const body = (request.body || {}) as BridgeTestingBrowserLaunchOverridePayload;
        const commands = Array.isArray(body.commands)
          ? body.commands
              .filter((command): command is string => typeof command === 'string')
              .map((command) => command.trim())
              .filter(Boolean)
          : null;

        __bridgeLaunchInternals.setBrowserLaunchTestOverride(
          commands && commands.length > 0 ? commands : null,
        );

        return reply.status(HTTP_STATUS.OK).send({
          status: 'ok',
          data: {
            commands: __bridgeLaunchInternals.getBrowserLaunchTestOverride(),
            recordedAt: Date.now(),
          },
        });
      },
    );

    this.fastify.post(
      '/bridge/testing/command-channel',
      async (
        request: FastifyRequest<{ Body: BridgeTestingCommandChannelPayload }>,
        reply: FastifyReply,
      ) => {
        if (!LOCALHOST_IPS.has(request.ip)) {
          return reply.status(403).send({
            status: 'error',
            message: 'Forbidden – command channel testing is only available from localhost.',
          });
        }

        const body = (request.body || {}) as BridgeTestingCommandChannelPayload;
        const rawMode = typeof body.mode === 'string' ? body.mode.trim() : '';
        const resolvedMode =
          rawMode === 'normal' ||
          rawMode === 'fail-next-send' ||
          rawMode === 'fail-all-sends' ||
          rawMode === 'unavailable'
            ? (rawMode as BridgeCommandChannelTestMode)
            : undefined;

        if (!resolvedMode) {
          return reply.status(HTTP_STATUS.BAD_REQUEST).send({
            status: 'error',
            message: 'Invalid mode for command channel testing',
          });
        }

        __bridgeCommandChannelInternals.setTestMode(resolvedMode);
        return reply.status(HTTP_STATUS.OK).send({
          status: 'ok',
          data: {
            mode: resolvedMode,
            recordedAt: Date.now(),
          },
        });
      },
    );
  }

  // ============================================================
  // MCP Routes
  // ============================================================

  private setupMcpRoutes(): void {
    // MCP POST endpoint
    this.fastify.post('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const managedEntry = sessionId ? this.sessions.get(sessionId) : undefined;
      if (sessionId && managedEntry) {
        this.sessions.touch(sessionId);
      }
      let transport: StreamableHTTPServerTransport | undefined =
        managedEntry?.kind === 'streamable-http' ? managedEntry.transport : undefined;
      let newSessionId: string | undefined;

      if (transport) {
        // Existing session found, proceed.
      } else if (sessionId && !transport) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.STALE_MCP_SESSION });
        return;
      } else if (!sessionId && isInitializeRequest(request.body)) {
        const createdSessionId = randomUUID();
        newSessionId = createdSessionId;
        const server = createMcpServer();
        const clientIp = request.ip;
        const userAgentHeader = request.headers['user-agent'];
        const userAgent =
          typeof userAgentHeader === 'string'
            ? userAgentHeader
            : Array.isArray(userAgentHeader)
              ? userAgentHeader[0] || ''
              : '';
        const initBody = request.body as {
          params?: { clientInfo?: { name?: string; version?: string } };
        };
        const clientName = initBody?.params?.clientInfo?.name ?? '';
        const clientVersion = initBody?.params?.clientInfo?.version ?? '';
        const connectedAt = Date.now();

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => createdSessionId,
          onsessioninitialized: () => undefined,
        });

        this.sessions.register(createdSessionId, {
          kind: 'streamable-http',
          transport,
          server,
          clientIp,
          clientName,
          clientVersion,
          userAgent,
          connectedAt,
        });

        transport.onclose = () => {
          this.sessions.remove(createdSessionId, 'client-closed');
        };
        await server.connect(transport);
      } else {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_MCP_REQUEST });
        return;
      }

      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);

        // If initialize failed, remove the pre-registered session to avoid leaks.
        if (newSessionId && reply.raw.statusCode >= HTTP_STATUS.BAD_REQUEST) {
          this.sessions.remove(newSessionId, 'initialize-failed');
        }
      } catch (error) {
        if (newSessionId) {
          this.sessions.remove(newSessionId, 'initialize-failed');
        }
        if (canWriteReply(reply)) {
          reply
            .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.MCP_REQUEST_PROCESSING_ERROR });
        }
      }
    });

    // MCP GET endpoint (SSE stream)
    this.fastify.get('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const sseEntry = sessionId ? this.sessions.get(sessionId) : undefined;
      if (sessionId && sseEntry) {
        this.sessions.touch(sessionId);
      }
      const transport = sseEntry?.kind === 'streamable-http' ? sseEntry.transport : undefined;

      if (!transport) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SSE_SESSION });
        return;
      }

      try {
        await transport.handleRequest(request.raw, reply.raw);
      } catch (error) {
        if (!reply.raw.writableEnded && !reply.raw.destroyed) {
          reply.raw.end();
        }
      }
    });

    // MCP DELETE endpoint
    this.fastify.delete('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SESSION_ID });
        return;
      }

      const delEntry = sessionId ? this.sessions.get(sessionId) : undefined;
      if (sessionId && delEntry) {
        this.sessions.touch(sessionId);
      }
      const transport = delEntry?.kind === 'streamable-http' ? delEntry.transport : undefined;

      if (!transport) {
        // Treat repeated or late session termination as a no-op so MCP clients can
        // shut down cleanly even if the server has already dropped the session.
        reply.code(HTTP_STATUS.NO_CONTENT).send();
        return;
      }

      try {
        await transport.handleRequest(request.raw, reply.raw);
        if (canWriteReply(reply)) {
          reply.code(HTTP_STATUS.NO_CONTENT).send();
        }
      } catch (error) {
        if (canWriteReply(reply)) {
          reply
            .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.MCP_SESSION_DELETION_ERROR });
        }
      }
    });
  }

  // ============================================================
  // Server Lifecycle
  // ============================================================

  public async start(port = NATIVE_SERVER_PORT, nativeHost?: NativeMessagingHost): Promise<void> {
    if (nativeHost) {
      if (!this.nativeHost) {
        this.nativeHost = nativeHost;
      } else if (this.nativeHost !== nativeHost) {
        this.nativeHost = nativeHost;
      }
    }

    if (this.isRunning) {
      return;
    }

    try {
      const host = SERVER_CONFIG.HOST;
      const isWildcard = host === '0.0.0.0' || host === '::';

      if (isWildcard || process.env.MCP_AUTH_TOKEN) {
        tokenManager.resolve();
      }

      await this.fastify.listen({ port, host });

      // Set port environment variables after successful listen for Chrome MCP URL resolution
      process.env.CHROME_MCP_PORT = String(port);
      process.env.MCP_HTTP_PORT = String(port);

      this.listeningPort = port;
      this.isRunning = true;
      this.bridgeState.startWatching();
      bridgeCommandChannel.attach(this.fastify.server);
    } catch (err) {
      this.listeningPort = null;
      this.isRunning = false;
      this.bridgeState.stopWatching();
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.sessions.closeAll();
      await this.fastify.close();
      this.listeningPort = null;
      this.isRunning = false;
      this.bridgeState.stopWatching();
      this.bridgeState.reset();
      this.clearNativeHost();
      bridgeCommandChannel.reset();
    } catch (err) {
      this.listeningPort = null;
      this.isRunning = false;
      this.bridgeState.stopWatching();
      this.bridgeState.reset();
      this.clearNativeHost();
      bridgeCommandChannel.reset();
      throw err;
    }
  }

  public getInstance(): FastifyInstance {
    return this.fastify;
  }

  public getListeningPort(): number | null {
    return this.listeningPort;
  }

  public async restart(port?: number, nativeHost?: NativeMessagingHost): Promise<void> {
    const restartPort = port ?? this.listeningPort ?? NATIVE_SERVER_PORT;
    const restartHost = nativeHost ?? this.nativeHost ?? undefined;

    if (this.isRunning) {
      await this.stop();
    }

    this.fastify = Fastify({ logger: SERVER_CONFIG.LOGGER_ENABLED });
    bridgeCommandChannel.attach(this.fastify.server);
    this.setupPlugins();
    this.setupRoutes();

    await this.start(restartPort, restartHost);
  }

  public getStatusSnapshot(): ServerStatusSnapshot {
    const tasks = sessionManager.listTasks();
    const executionSessions = sessionManager.listSessions();

    const host = SERVER_CONFIG.HOST;
    const isWildcard = host === '0.0.0.0' || host === '::';

    const authEnabled = tokenManager.enabled;
    const securityWarning =
      isWildcard && !authEnabled ? 'Remote access enabled without authentication' : undefined;
    this.bridgeState.syncBrowserProcessNow();
    this.bridgeState.setNativeHostAttached(this.nativeHost !== null);
    const bridge = this.bridgeState.getSnapshot();

    return {
      isRunning: this.isRunning,
      host,
      port: this.listeningPort,
      ...(isWildcard && { networkAddresses: getLocalNetworkAddresses() }),
      authEnabled,
      ...(securityWarning && { securityWarning }),
      nativeHostAttached: this.nativeHost !== null,
      bridge: {
        ...bridge,
        guidance: describeBridgeRecoveryGuidance(bridge, bridge.lastBridgeErrorCode),
      },
      transports: this.sessions.snapshot(),
      execution: {
        tasks: {
          total: tasks.length,
          pending: tasks.filter((task) => task.status === 'pending').length,
          running: tasks.filter((task) => task.status === 'running').length,
          completed: tasks.filter((task) => task.status === 'completed').length,
          failed: tasks.filter((task) => task.status === 'failed').length,
          cancelled: tasks.filter((task) => task.status === 'cancelled').length,
        },
        sessions: {
          total: executionSessions.length,
          starting: executionSessions.filter((session) => session.status === 'starting').length,
          running: executionSessions.filter((session) => session.status === 'running').length,
          completed: executionSessions.filter((session) => session.status === 'completed').length,
          failed: executionSessions.filter((session) => session.status === 'failed').length,
          aborted: executionSessions.filter((session) => session.status === 'aborted').length,
        },
        lastSessionId:
          executionSessions.length > 0
            ? executionSessions[executionSessions.length - 1].sessionId
            : null,
        persistenceMode: sessionManager.getPersistenceStatus().mode,
      },
    };
  }

  /**
   * Force-disconnect a session by ID.
   * Used by the popup "kick" button via DELETE /status/sessions/:sessionId.
   */
  public forceDisconnectSession(sessionId: string): boolean {
    return this.sessions.disconnect(sessionId, 'manual');
  }

  public forceDisconnectClient(clientId: string): number {
    return this.sessions.disconnectClient(clientId, 'manual');
  }
}

const serverInstance = new Server();
export default serverInstance;
