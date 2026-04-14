import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { BridgeCommandChannelManager } from './bridge-command-channel';
import { bridgeRuntimeState } from './bridge-state';
import type {
  BridgeCommandMessage,
  BridgeHeartbeatMessage,
  BridgeHelloMessage,
  BridgeResultMessage,
} from '@tabrix/shared';

async function listen(server: HttpServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return (server.address() as AddressInfo).port;
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(predicate()).toBe(true);
}

describe('BridgeCommandChannelManager', () => {
  let server: HttpServer;
  let manager: BridgeCommandChannelManager;
  let port: number;

  beforeEach(async () => {
    bridgeRuntimeState.reset();
    bridgeRuntimeState.setBrowserProcessRunning(true);
    manager = new BridgeCommandChannelManager();
    server = createServer((_request, response) => {
      response.statusCode = 200;
      response.end('ok');
    });
    manager.attach(server);
    port = await listen(server);
  });

  afterEach(async () => {
    manager.reset();
    bridgeRuntimeState.reset();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('registers hello and heartbeat as an executable websocket bridge', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);

    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    const hello: BridgeHelloMessage = {
      type: 'hello',
      connectionId: 'conn-1',
      extensionId: 'ext-1',
      sentAt: Date.now(),
    };
    ws.send(JSON.stringify(hello));

    const heartbeat: BridgeHeartbeatMessage = {
      type: 'heartbeat',
      connectionId: 'conn-1',
      extensionId: 'ext-1',
      sentAt: Date.now(),
      nativeConnected: false,
      browserVersion: 'Chrome Test',
      tabCount: 3,
      windowCount: 1,
      autoConnectEnabled: true,
    };
    ws.send(JSON.stringify(heartbeat));

    await waitForCondition(() => bridgeRuntimeState.getSnapshot().bridgeState === 'READY');

    expect(bridgeRuntimeState.getSnapshot()).toMatchObject({
      bridgeState: 'READY',
      commandChannelConnected: true,
      commandChannelType: 'websocket',
      activeConnectionId: 'conn-1',
      heartbeat: {
        extensionId: 'ext-1',
        connectionId: 'conn-1',
        tabCount: 3,
        windowCount: 1,
      },
    });

    ws.close();
  });

  test('round-trips command and result messages', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);

    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(
      JSON.stringify({
        type: 'hello',
        connectionId: 'conn-2',
        extensionId: 'ext-1',
        sentAt: Date.now(),
      } satisfies BridgeHelloMessage),
    );
    ws.send(
      JSON.stringify({
        type: 'heartbeat',
        connectionId: 'conn-2',
        extensionId: 'ext-1',
        sentAt: Date.now(),
        nativeConnected: false,
      } satisfies BridgeHeartbeatMessage),
    );

    await waitForCondition(() => bridgeRuntimeState.getSnapshot().commandChannelConnected);

    const commandPromise = new Promise<BridgeCommandMessage>((resolve) => {
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as BridgeCommandMessage;
        if (message.type === 'command') {
          resolve(message);
        }
      });
    });

    const resultPromise = manager.sendCommand(
      'call_tool',
      { name: 'chrome_read_page', args: { tabId: 1 } },
      1000,
    );
    const command = await commandPromise;
    expect(command.command).toMatchObject({
      action: 'call_tool',
      payload: { name: 'chrome_read_page', args: { tabId: 1 } },
    });

    ws.send(
      JSON.stringify({
        type: 'result',
        requestId: command.requestId,
        connectionId: 'conn-2',
        extensionId: 'ext-1',
        sentAt: Date.now(),
        success: true,
        payload: {
          status: 'success',
          data: { content: [{ type: 'text', text: 'ok' }], isError: false },
        },
      } satisfies BridgeResultMessage),
    );

    await expect(resultPromise).resolves.toMatchObject({
      status: 'success',
      data: { content: [{ type: 'text', text: 'ok' }], isError: false },
    });

    ws.close();
  });

  test('clears command channel state when the active websocket disconnects', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(
      JSON.stringify({
        type: 'hello',
        connectionId: 'conn-3',
        extensionId: 'ext-1',
        sentAt: Date.now(),
      } satisfies BridgeHelloMessage),
    );

    await waitForCondition(() => bridgeRuntimeState.getSnapshot().commandChannelConnected);
    ws.close();
    await waitForCondition(() => !bridgeRuntimeState.getSnapshot().commandChannelConnected);

    expect(bridgeRuntimeState.getSnapshot()).toMatchObject({
      commandChannelConnected: false,
      activeConnectionId: null,
    });
  });
});
