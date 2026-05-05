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
  BridgeObservationMessage,
  BridgeResultMessage,
} from '@tabrix/shared';
import {
  getDefaultContextManager,
  resetDefaultContextManager,
} from '../runtime/browser-context-manager';
import {
  getDefaultLifecycleStateMachine,
  resetDefaultLifecycleStateMachine,
} from '../runtime/lifecycle-state-machine';
import {
  getDefaultFactCollector,
  resetDefaultFactCollector,
} from '../runtime/browser-fact-collector';

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

  test('ingests v27 lifecycle observation through the websocket and bumps ContextManager', async () => {
    resetDefaultLifecycleStateMachine();
    resetDefaultContextManager();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(
      JSON.stringify({
        type: 'hello',
        connectionId: 'conn-obs-1',
        extensionId: 'ext-1',
        sentAt: Date.now(),
      } satisfies BridgeHelloMessage),
    );
    await waitForCondition(() => bridgeRuntimeState.getSnapshot().commandChannelConnected);

    const obs: BridgeObservationMessage = {
      type: 'observation',
      kind: 'lifecycle_event',
      connectionId: 'conn-obs-1',
      extensionId: 'ext-1',
      sentAt: Date.now(),
      payload: {
        kind: 'lifecycle_event',
        data: {
          eventKind: 'committed',
          tabId: 101,
          urlPattern: 'example.com/list',
          navigationIntent: 'user_initiated',
          observedAtMs: Date.now(),
        },
      },
    };
    ws.send(JSON.stringify(obs));

    // Lifecycle ingest is fire-and-forget; wait for the ContextManager
    // to have recorded a context for this tab.
    await waitForCondition(() => getDefaultContextManager().getContext(101) !== null);
    const ctx = getDefaultContextManager().getContext(101);
    expect(ctx).not.toBeNull();
    expect(ctx?.tabId).toBe(101);
    expect(ctx?.version).toBeGreaterThanOrEqual(1);
    expect(ctx?.urlPattern).toBe('example.com/list');

    ws.close();
  });

  test('ingests v27 fact_snapshot observation', async () => {
    resetDefaultFactCollector();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(
      JSON.stringify({
        type: 'hello',
        connectionId: 'conn-obs-2',
        extensionId: 'ext-1',
        sentAt: Date.now(),
      } satisfies BridgeHelloMessage),
    );
    await waitForCondition(() => bridgeRuntimeState.getSnapshot().commandChannelConnected);

    const obs: BridgeObservationMessage = {
      type: 'observation',
      kind: 'fact_snapshot',
      connectionId: 'conn-obs-2',
      extensionId: 'ext-1',
      sentAt: Date.now(),
      payload: {
        kind: 'fact_snapshot',
        data: {
          factSnapshotId: 'snap-1',
          observedAtMs: Date.now(),
          payload: {
            eventKind: 'unknown',
            tabId: 5,
            urlPattern: 'example.com/x',
            sessionId: null,
            observedAtMs: Date.now(),
          },
        },
      },
    };
    ws.send(JSON.stringify(obs));

    await waitForCondition(() => {
      const lookup = getDefaultFactCollector().getFactSnapshot('snap-1');
      return lookup.verdict === 'fresh' || lookup.verdict === 'stale';
    });
    const lookup = getDefaultFactCollector().getFactSnapshot('snap-1');
    expect(['fresh', 'stale']).toContain(lookup.verdict);

    ws.close();
  });

  test('ingests v27 action_outcome observation and applies to ContextManager', async () => {
    resetDefaultContextManager();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(
      JSON.stringify({
        type: 'hello',
        connectionId: 'conn-obs-3',
        extensionId: 'ext-1',
        sentAt: Date.now(),
      } satisfies BridgeHelloMessage),
    );
    await waitForCondition(() => bridgeRuntimeState.getSnapshot().commandChannelConnected);

    const baseTs = Date.now();
    const obs: BridgeObservationMessage = {
      type: 'observation',
      kind: 'action_outcome',
      connectionId: 'conn-obs-3',
      extensionId: 'ext-1',
      sentAt: baseTs,
      payload: {
        kind: 'action_outcome',
        data: {
          actionId: 'act-1',
          actionKind: 'click',
          tabId: 202,
          urlPattern: 'example.com/page',
          observedAtMs: baseTs,
          signals: [{ kind: 'lifecycle_committed', observedAtMs: baseTs + 50 }],
        },
      },
    };
    ws.send(JSON.stringify(obs));

    await waitForCondition(() => getDefaultContextManager().getContext(202) !== null);
    const ctx = getDefaultContextManager().getContext(202);
    expect(ctx?.tabId).toBe(202);

    ws.close();
  });

  test('ingests v27 tab_event observation and applies to ContextManager', async () => {
    resetDefaultContextManager();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(
      JSON.stringify({
        type: 'hello',
        connectionId: 'conn-obs-4',
        extensionId: 'ext-1',
        sentAt: Date.now(),
      } satisfies BridgeHelloMessage),
    );
    await waitForCondition(() => bridgeRuntimeState.getSnapshot().commandChannelConnected);

    // Seed a context first so bfcache_restored has something to bump.
    getDefaultContextManager().applyLifecycleSnapshot(
      getDefaultLifecycleStateMachine().ingest({
        eventKind: 'committed',
        tabId: 303,
        urlPattern: 'example.com/page',
        navigationIntent: 'user_initiated',
        observedAtMs: Date.now(),
      }),
    );
    const before = getDefaultContextManager().getContext(303);
    expect(before).not.toBeNull();

    const obs: BridgeObservationMessage = {
      type: 'observation',
      kind: 'tab_event',
      connectionId: 'conn-obs-4',
      extensionId: 'ext-1',
      sentAt: Date.now(),
      payload: {
        kind: 'tab_event',
        data: {
          eventKind: 'bfcache_restored',
          tabId: 303,
          observedAtMs: Date.now(),
          urlPattern: 'example.com/page',
          stableRefRevalidation: {
            outcome: 'stale',
            liveCount: 0,
            staleCount: 2,
            observedAtMs: Date.now(),
          },
        },
      },
    };
    ws.send(JSON.stringify(obs));

    await waitForCondition(
      () =>
        (getDefaultContextManager().getContext(303)?.lastInvalidationReason ?? null) ===
        'bfcache_restored',
    );
    const after = getDefaultContextManager().getContext(303);
    expect(after?.lastInvalidationReason).toBe('bfcache_restored');
    expect(after?.version).toBeGreaterThan(before!.version);

    ws.close();
  });

  test('ignores malformed and unknown observation envelopes without crashing the websocket', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(
      JSON.stringify({
        type: 'hello',
        connectionId: 'conn-obs-5',
        extensionId: 'ext-1',
        sentAt: Date.now(),
      } satisfies BridgeHelloMessage),
    );
    await waitForCondition(() => bridgeRuntimeState.getSnapshot().commandChannelConnected);

    // Unknown discriminator
    ws.send(
      JSON.stringify({
        type: 'observation',
        kind: 'unknown',
        connectionId: 'conn-obs-5',
        extensionId: 'ext-1',
        sentAt: Date.now(),
        payload: { kind: 'unknown', data: {} },
      }),
    );
    // Malformed payload entirely
    ws.send(
      JSON.stringify({
        type: 'observation',
        kind: 'lifecycle_event',
        connectionId: 'conn-obs-5',
        extensionId: 'ext-1',
        sentAt: Date.now(),
        payload: { kind: 'lifecycle_event', data: null },
      }),
    );
    // Confirm the bridge is still alive — heartbeat round-trip after.
    ws.send(
      JSON.stringify({
        type: 'heartbeat',
        connectionId: 'conn-obs-5',
        extensionId: 'ext-1',
        sentAt: Date.now(),
        nativeConnected: false,
      } satisfies BridgeHeartbeatMessage),
    );
    await waitForCondition(() => bridgeRuntimeState.getSnapshot().bridgeState === 'READY');
    expect(bridgeRuntimeState.getSnapshot().commandChannelConnected).toBe(true);

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
