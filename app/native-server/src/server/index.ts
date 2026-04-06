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
import {
  NATIVE_SERVER_PORT,
  TIMEOUTS,
  SERVER_CONFIG,
  HTTP_STATUS,
  ERROR_MESSAGES,
} from '../constant';
import { NativeMessagingHost } from '../native-messaging-host';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { sessionManager } from '../execution/session-manager';

// ============================================================
// Types
// ============================================================

interface ExtensionRequestPayload {
  data?: unknown;
}

type ManagedTransport =
  | {
      kind: 'sse';
      transport: SSEServerTransport;
      server: McpServer;
    }
  | {
      kind: 'streamable-http';
      transport: StreamableHTTPServerTransport;
      server: McpServer;
    };

interface ServerStatusSnapshot {
  isRunning: boolean;
  host: string;
  port: number | null;
  nativeHostAttached: boolean;
  transports: {
    total: number;
    sse: number;
    streamableHttp: number;
    sessionIds: string[];
  };
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

function canWriteReply(reply: FastifyReply): boolean {
  return !reply.sent && !reply.raw.writableEnded && !reply.raw.headersSent;
}

// ============================================================
// Server Class
// ============================================================

export class Server {
  private fastify: FastifyInstance;
  public isRunning = false;
  private nativeHost: NativeMessagingHost | null = null;
  private transportsMap: Map<string, ManagedTransport> = new Map();
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
    // Health check
    this.setupHealthRoutes();

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
    // SSE endpoint
    this.fastify.get('/sse', async (_, reply) => {
      try {
        reply.hijack();
        reply.raw.writeHead(HTTP_STATUS.OK, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const transport = new SSEServerTransport('/messages', reply.raw);
        const server = createMcpServer();
        this.transportsMap.set(transport.sessionId, {
          kind: 'sse',
          transport,
          server,
        });

        reply.raw.on('close', () => {
          this.removeManagedTransport(transport.sessionId);
        });

        await server.connect(transport);

        if (!reply.raw.writableEnded) {
          reply.raw.write(':\n\n');
        }
      } catch (error) {
        if (!reply.raw.writableEnded) {
          reply.raw.end(ERROR_MESSAGES.INTERNAL_SERVER_ERROR);
        }
      }
    });

    // SSE messages endpoint
    this.fastify.post('/messages', async (req, reply) => {
      try {
        const { sessionId } = req.query as { sessionId?: string };
        const entry = this.transportsMap.get(sessionId || '');
        if (!sessionId || !entry || entry.kind !== 'sse') {
          reply.code(HTTP_STATUS.BAD_REQUEST).send('No transport found for sessionId');
          return;
        }

        await entry.transport.handlePostMessage(req.raw, reply.raw, req.body);
      } catch (error) {
        if (canWriteReply(reply)) {
          reply.code(HTTP_STATUS.INTERNAL_SERVER_ERROR).send(ERROR_MESSAGES.INTERNAL_SERVER_ERROR);
        }
      }
    });

    // MCP POST endpoint
    this.fastify.post('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const managedTransport = sessionId ? this.transportsMap.get(sessionId) : undefined;
      let transport: StreamableHTTPServerTransport | undefined =
        managedTransport?.kind === 'streamable-http' ? managedTransport.transport : undefined;

      if (transport) {
        // Transport found, proceed
      } else if (!sessionId && isInitializeRequest(request.body)) {
        const newSessionId = randomUUID();
        const server = createMcpServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
          onsessioninitialized: (initializedSessionId) => {
            if (transport && initializedSessionId === newSessionId) {
              this.transportsMap.set(initializedSessionId, {
                kind: 'streamable-http',
                transport,
                server,
              });
            }
          },
        });

        transport.onclose = () => {
          if (transport?.sessionId) {
            this.removeManagedTransport(transport.sessionId);
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
      const entry = sessionId ? this.transportsMap.get(sessionId) : undefined;
      const transport = entry?.kind === 'streamable-http' ? entry.transport : undefined;

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
      const entry = sessionId ? this.transportsMap.get(sessionId) : undefined;
      const transport = entry?.kind === 'streamable-http' ? entry.transport : undefined;

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

  public async start(port = NATIVE_SERVER_PORT, nativeHost: NativeMessagingHost): Promise<void> {
    if (!this.nativeHost) {
      this.nativeHost = nativeHost;
    } else if (this.nativeHost !== nativeHost) {
      this.nativeHost = nativeHost;
    }

    if (this.isRunning) {
      return;
    }

    try {
      await this.fastify.listen({ port, host: SERVER_CONFIG.HOST });

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
      await this.closeManagedTransports();
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

  public getStatusSnapshot(): ServerStatusSnapshot {
    const sessionIds = [...this.transportsMap.keys()];
    let sse = 0;
    let streamableHttp = 0;
    const tasks = sessionManager.listTasks();
    const executionSessions = sessionManager.listSessions();

    for (const entry of this.transportsMap.values()) {
      if (entry.kind === 'sse') {
        sse += 1;
      } else {
        streamableHttp += 1;
      }
    }

    return {
      isRunning: this.isRunning,
      host: SERVER_CONFIG.HOST,
      port: this.listeningPort,
      nativeHostAttached: this.nativeHost !== null,
      transports: {
        total: sessionIds.length,
        sse,
        streamableHttp,
        sessionIds,
      },
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

  private removeManagedTransport(sessionId: string): void {
    const entry = this.transportsMap.get(sessionId);
    if (!entry) {
      return;
    }

    this.transportsMap.delete(sessionId);
    void entry.server.close().catch(() => {
      // Ignore cleanup failures during disconnect/teardown.
    });
  }

  private async closeManagedTransports(): Promise<void> {
    const entries = [...this.transportsMap.entries()];
    this.transportsMap.clear();
    await Promise.allSettled(entries.map(([, entry]) => entry.server.close()));
  }
}

const serverInstance = new Server();
export default serverInstance;
