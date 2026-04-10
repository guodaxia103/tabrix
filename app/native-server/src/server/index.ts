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
import { AgentStreamManager } from '../agent/stream-manager';
import { AgentChatService } from '../agent/chat-service';
import { CodexEngine } from '../agent/engines/codex';
import { ClaudeEngine } from '../agent/engines/claude';
import { closeDb } from '../agent/db';
import { registerAgentRoutes } from './routes';
import { sessionManager } from '../execution/session-manager';
import { SessionRegistry, type ConnectedClient, type TransportsSnapshot } from './session-registry';

// ============================================================
// Types
// ============================================================

interface ExtensionRequestPayload {
  data?: unknown;
}

interface ServerStatusSnapshot {
  isRunning: boolean;
  host: string;
  port: number | null;
  networkAddresses?: string[];
  authEnabled: boolean;
  securityWarning?: string;
  nativeHostAttached: boolean;
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
  private agentStreamManager: AgentStreamManager;
  private agentChatService: AgentChatService;

  constructor() {
    this.fastify = Fastify({ logger: SERVER_CONFIG.LOGGER_ENABLED });
    this.agentStreamManager = new AgentStreamManager();
    this.agentChatService = new AgentChatService({
      engines: [new CodexEngine(), new ClaudeEngine()],
      streamManager: this.agentStreamManager,
    });
    this.setupPlugins();
    this.setupRoutes();
  }

  /**
   * Associate NativeMessagingHost instance.
   */
  public setNativeHost(nativeHost: NativeMessagingHost): void {
    this.nativeHost = nativeHost;
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

    // Agent routes (delegated to separate module)
    registerAgentRoutes(this.fastify, {
      streamManager: this.agentStreamManager,
      chatService: this.agentChatService,
    });

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
      const info = tokenManager.info();
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
  }

  // ============================================================
  // MCP Routes
  // ============================================================

  private setupMcpRoutes(): void {
    // MCP POST endpoint
    this.fastify.post('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const managedEntry = sessionId ? this.sessions.get(sessionId) : undefined;
      let transport: StreamableHTTPServerTransport | undefined =
        managedEntry?.kind === 'streamable-http' ? managedEntry.transport : undefined;

      if (transport) {
        // Existing session found, proceed.
      } else if (sessionId && !transport) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.STALE_MCP_SESSION });
        return;
      } else if (!sessionId && isInitializeRequest(request.body)) {
        const newSessionId = randomUUID();
        const server = createMcpServer();
        const clientIp = request.ip;
        const initBody = request.body as {
          params?: { clientInfo?: { name?: string; version?: string } };
        };
        const clientName = initBody?.params?.clientInfo?.name ?? '';
        const clientVersion = initBody?.params?.clientInfo?.version ?? '';
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
          onsessioninitialized: (initializedSessionId) => {
            if (transport && initializedSessionId === newSessionId) {
              this.sessions.register(initializedSessionId, {
                kind: 'streamable-http',
                transport,
                server,
                clientIp,
                clientName,
                clientVersion,
                connectedAt: Date.now(),
              });
            }
          },
        });

        transport.onclose = () => {
          if (transport?.sessionId) {
            this.sessions.remove(transport.sessionId);
          }
        };
        await server.connect(transport);
      } else {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_MCP_REQUEST });
        return;
      }

      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
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
      const transport = sseEntry?.kind === 'streamable-http' ? sseEntry.transport : undefined;

      if (!transport) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SSE_SESSION });
        return;
      }

      reply.hijack();
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders();

      try {
        await transport.handleRequest(request.raw, reply.raw);
        if (!reply.sent) {
          reply.hijack();
        }
      } catch (error) {
        if (!reply.raw.writableEnded && !reply.raw.destroyed) {
          reply.raw.end();
        }
      }

      request.socket.on('close', () => {
        request.log.info(`SSE client disconnected for session: ${sessionId}`);
      });
    });

    // MCP DELETE endpoint
    this.fastify.delete('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const delEntry = sessionId ? this.sessions.get(sessionId) : undefined;
      const transport = delEntry?.kind === 'streamable-http' ? delEntry.transport : undefined;

      if (!transport) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SESSION_ID });
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
    } catch (err) {
      this.listeningPort = null;
      this.isRunning = false;
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
      closeDb();
      this.listeningPort = null;
      this.isRunning = false;
    } catch (err) {
      this.listeningPort = null;
      this.isRunning = false;
      closeDb();
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

    return {
      isRunning: this.isRunning,
      host,
      port: this.listeningPort,
      ...(isWildcard && { networkAddresses: getLocalNetworkAddresses() }),
      authEnabled,
      ...(securityWarning && { securityWarning }),
      nativeHostAttached: this.nativeHost !== null,
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
      },
    };
  }

  /**
   * Force-disconnect a session by ID.
   * Used by the popup "kick" button via DELETE /status/sessions/:sessionId.
   */
  public forceDisconnectSession(sessionId: string): boolean {
    return this.sessions.disconnect(sessionId);
  }
}

const serverInstance = new Server();
export default serverInstance;
