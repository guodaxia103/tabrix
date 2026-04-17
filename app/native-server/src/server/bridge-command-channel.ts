import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type {
  BridgeCommandAction,
  BridgeCommandMessage,
  BridgeHelloMessage,
  BridgeHeartbeatMessage,
  BridgeResultMessage,
  BridgeWsMessage,
} from '@tabrix/shared';
import { bridgeRuntimeState } from './bridge-state';

interface PendingCommand {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ActiveConnection {
  socket: WebSocket;
  connectionId: string;
  extensionId: string;
}

export type BridgeCommandChannelTestMode =
  | 'normal'
  | 'unavailable'
  | 'fail-next-send'
  | 'fail-all-sends';

interface BridgeCommandChannelTestingState {
  mode: BridgeCommandChannelTestMode;
}

function isLocalhostAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function safeCloseSocket(socket: Socket, statusCode: number, message: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } catch {
    // ignore
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
}

export class BridgeCommandChannelManager {
  private readonly wss = new WebSocketServer({ noServer: true });
  private attachedServer: HttpServer | null = null;
  private activeConnection: ActiveConnection | null = null;
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private testingState: BridgeCommandChannelTestingState = {
    mode: 'normal',
  };

  private readonly handleUpgrade = (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): void => {
    const url = request.url || '';
    const pathname = url.split('?')[0];
    if (pathname !== '/bridge/ws') {
      safeCloseSocket(socket, 404, 'Not Found');
      return;
    }

    if (!isLocalhostAddress(request.socket.remoteAddress)) {
      safeCloseSocket(socket, 403, 'Forbidden');
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      this.wss.emit('connection', ws, request);
    });
  };

  constructor() {
    this.wss.on('connection', (socket: WebSocket) => {
      this.handleConnection(socket);
    });
  }

  attach(server: HttpServer): void {
    if (this.attachedServer === server) return;
    if (this.attachedServer) {
      this.attachedServer.off('upgrade', this.handleUpgrade);
    }
    this.attachedServer = server;
    this.attachedServer.on('upgrade', this.handleUpgrade);
  }

  reset(): void {
    if (this.attachedServer) {
      this.attachedServer.off('upgrade', this.handleUpgrade);
      this.attachedServer = null;
    }
    this.rejectAllPending(new Error('Bridge command channel reset'));
    if (this.activeConnection) {
      try {
        this.activeConnection.socket.close();
      } catch {
        // ignore
      }
    }
    this.activeConnection = null;
    bridgeRuntimeState.setCommandChannelConnected(false);
    this.testingState = {
      mode: 'normal',
    };
  }

  setTestMode(mode: BridgeCommandChannelTestMode): void {
    this.testingState.mode = mode;
  }

  getTestMode(): BridgeCommandChannelTestMode {
    return this.testingState.mode;
  }

  getActiveConnectionId(): string | null {
    return this.activeConnection?.connectionId ?? null;
  }

  isConnected(): boolean {
    return this.activeConnection?.socket.readyState === WebSocket.OPEN;
  }

  async sendCommand(action: BridgeCommandAction, payload: any, timeoutMs: number): Promise<any> {
    const connection = this.activeConnection;
    const testMode = this.testingState.mode;
    if (testMode === 'unavailable') {
      throw new Error('Bridge is unavailable due to test injection');
    }

    if (testMode === 'fail-next-send' || testMode === 'fail-all-sends') {
      if (testMode === 'fail-next-send') {
        this.testingState.mode = 'normal';
        throw new Error('Bridge is unavailable (transient test injection)');
      }
      throw new Error('Bridge is unavailable due to test injection');
    }

    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Bridge command channel unavailable');
    }

    const requestId = randomUUID();
    const message: BridgeCommandMessage = {
      type: 'command',
      requestId,
      connectionId: connection.connectionId,
      sentAt: Date.now(),
      command: {
        action,
        payload,
        timeoutMs,
      },
    };

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Bridge command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingCommands.set(requestId, {
        resolve,
        reject,
        timeout,
      });

      try {
        connection.socket.send(JSON.stringify(message));
        bridgeRuntimeState.recordCommandChannelActivity({
          type: 'websocket',
          connectionId: connection.connectionId,
          seenAt: Date.now(),
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingCommands.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleConnection(socket: WebSocket): void {
    socket.on('message', (raw: RawData) => {
      this.handleSocketMessage(socket, raw.toString()).catch(() => {
        try {
          socket.close();
        } catch {
          // ignore
        }
      });
    });

    socket.on('close', () => {
      this.handleSocketClosed(socket);
    });

    socket.on('error', () => {
      this.handleSocketClosed(socket);
    });
  }

  private async handleSocketMessage(socket: WebSocket, raw: string): Promise<void> {
    const message = JSON.parse(raw) as BridgeWsMessage;
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'hello') {
      this.handleHello(socket, message);
      return;
    }

    if (message.type === 'heartbeat') {
      this.handleHeartbeat(message);
      return;
    }

    if (message.type === 'result') {
      this.handleResult(message);
    }
  }

  private handleHello(socket: WebSocket, message: BridgeHelloMessage): void {
    if (this.activeConnection && this.activeConnection.socket !== socket) {
      try {
        this.activeConnection.socket.close();
      } catch {
        // ignore
      }
    }

    this.activeConnection = {
      socket,
      connectionId: message.connectionId,
      extensionId: message.extensionId,
    };

    bridgeRuntimeState.setCommandChannelConnected(true, {
      type: 'websocket',
      connectionId: message.connectionId,
      seenAt: message.sentAt,
    });
  }

  private handleHeartbeat(message: BridgeHeartbeatMessage): void {
    bridgeRuntimeState.recordCommandChannelActivity({
      type: 'websocket',
      connectionId: message.connectionId,
      seenAt: message.sentAt,
    });
    bridgeRuntimeState.recordHeartbeat({
      sentAt: message.sentAt,
      nativeConnected: message.nativeConnected,
      extensionId: message.extensionId,
      connectionId: message.connectionId,
      browserVersion: message.browserVersion,
      tabCount: message.tabCount,
      windowCount: message.windowCount,
      autoConnectEnabled: message.autoConnectEnabled,
    });
  }

  private handleResult(message: BridgeResultMessage): void {
    bridgeRuntimeState.recordCommandChannelActivity({
      type: 'websocket',
      connectionId: message.connectionId,
      seenAt: message.sentAt,
    });

    const pending = this.pendingCommands.get(message.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(message.requestId);

    if (message.success) {
      pending.resolve(message.payload);
      return;
    }

    pending.reject(new Error(message.error || 'Bridge command failed'));
  }

  private handleSocketClosed(socket: WebSocket): void {
    if (this.activeConnection?.socket !== socket) return;
    this.activeConnection = null;
    bridgeRuntimeState.setCommandChannelConnected(false);
    this.rejectAllPending(new Error('Bridge command channel disconnected'));
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingCommands.delete(requestId);
    }
  }
}

export const bridgeCommandChannel = new BridgeCommandChannelManager();

export const __bridgeCommandChannelInternals = {
  setTestMode(mode: BridgeCommandChannelTestMode): void {
    bridgeCommandChannel.setTestMode(mode);
  },
  getTestMode(): BridgeCommandChannelTestMode {
    return bridgeCommandChannel.getTestMode();
  },
  resetTestMode(): void {
    bridgeCommandChannel.setTestMode('normal');
  },
};
