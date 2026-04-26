import { describe, expect, test, afterAll, beforeAll, jest } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { SERVER_CONFIG } from '../constant';
import { sessionManager } from '../execution/session-manager';
import { tokenManager } from './auth';
import type { TokenData } from './auth';
import { bridgeRuntimeState } from './bridge-state';

/** 非本机 IP，用于触发 onRequest 中的 Bearer 校验分支 */
const REMOTE_CLIENT_IP = '192.168.99.1';
const REMOTE_BEARER_TOKEN = 'jest-remote-bearer-test-token';

function setTokenData(data: TokenData | null): void {
  (tokenManager as unknown as { data: TokenData | null }).data = data;
}

function parseStreamableJson(text: string): any {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  const payload = dataLines[dataLines.length - 1];
  return payload ? JSON.parse(payload) : {};
}

describe('服务器测试', () => {
  // 启动服务器测试实例
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  // 关闭服务器
  afterAll(async () => {
    await Server.stop();
  });

  test('GET /ping 应返回正确响应', async () => {
    const response = await supertest(Server.getInstance().server)
      .get('/ping')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({
      status: 'ok',
      message: 'pong',
    });
  });

  test('GET /status 应返回运行状态快照', async () => {
    sessionManager.reset();
    const response = await supertest(Server.getInstance().server)
      .get('/status')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body.status).toBe('ok');
    expect(response.body.data).toMatchObject({
      isRunning: false,
      host: SERVER_CONFIG.HOST,
      port: null,
      authEnabled: false,
      nativeHostAttached: false,
    });
    expect(response.body.data.bridge).toMatchObject({
      bridgeState: expect.any(String),
      browserProcessRunning: expect.any(Boolean),
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
      lastBridgeReadyAt: null,
      lastBridgeErrorCode: null,
      lastBridgeErrorMessage: null,
      lastRecoveryAction: null,
      lastRecoveryAt: null,
      recoveryAttempts: 0,
      recoveryInFlight: false,
    });
    expect(response.body.data.transports).toMatchObject({
      total: 0,
      streamableHttp: 0,
      sessionStates: {
        active: 0,
        stale: 0,
        disconnected: 0,
      },
    });
    expect(response.body.data.execution).toMatchObject({
      tasks: {
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
      sessions: {
        total: 0,
        starting: 0,
        running: 0,
        completed: 0,
        failed: 0,
        aborted: 0,
      },
      lastSessionId: null,
    });
    expect(response.body.data.capabilities).toMatchObject({
      source: expect.any(String),
      enabled: expect.any(Array),
      unknown: expect.any(Array),
    });
    expect(Array.isArray(response.body.data.transports.sessionIds)).toBe(true);
    expect(Array.isArray(response.body.data.transports.clients)).toBe(true);
    expect(Array.isArray(response.body.data.transports.sessions)).toBe(true);
  });

  test('POST /bridge/heartbeat 应记录扩展心跳并更新 bridge 快照', async () => {
    const syncBrowserSpy = jest
      .spyOn(bridgeRuntimeState, 'syncBrowserProcessNow')
      .mockImplementation(() => {
        bridgeRuntimeState.setBrowserProcessRunning(true);
        return true;
      });
    bridgeRuntimeState.setBrowserProcessRunning(true);
    const sentAt = Date.now();
    const heartbeat = await supertest(Server.getInstance().server)
      .post('/bridge/heartbeat')
      .send({
        extensionId: 'tabrix-extension',
        connectionId: 'conn-1',
        sentAt,
        nativeConnected: true,
        browserVersion: '135.0.0.0',
        tabCount: 3,
        windowCount: 1,
        autoConnectEnabled: true,
      })
      .expect(200)
      .expect('Content-Type', /json/);

    expect(heartbeat.body).toMatchObject({
      status: 'ok',
      data: {
        bridgeState: 'BRIDGE_DEGRADED',
        nextHeartbeatInMs: 5000,
      },
    });

    const status = await supertest(Server.getInstance().server).get('/status').expect(200);
    expect(status.body.data.bridge).toMatchObject({
      bridgeState: 'BRIDGE_DEGRADED',
      extensionHeartbeatAt: sentAt,
      heartbeat: {
        extensionId: 'tabrix-extension',
        connectionId: 'conn-1',
        browserVersion: '135.0.0.0',
        tabCount: 3,
        windowCount: 1,
        autoConnectEnabled: true,
      },
    });
    syncBrowserSpy.mockRestore();
    bridgeRuntimeState.reset();
  });

  test('GET /status 应暴露 execution 快照', async () => {
    sessionManager.reset();
    const task = sessionManager.createTask({
      taskType: 'browser-action',
      title: 'Status snapshot test',
      intent: 'Verify execution summary exposure',
      origin: 'server-test',
    });
    sessionManager.startSession({
      taskId: task.taskId,
      transport: 'mcp',
      clientName: 'jest',
    });

    const response = await supertest(Server.getInstance().server)
      .get('/status')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body.status).toBe('ok');
    expect(response.body.data.execution).toMatchObject({
      tasks: {
        total: 1,
        pending: 0,
        running: 1,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
      sessions: {
        total: 1,
        starting: 0,
        running: 1,
        completed: 0,
        failed: 0,
        aborted: 0,
      },
    });
    expect(typeof response.body.data.execution.lastSessionId).toBe('string');
  });

  describe('Token 管理接口（本机）', () => {
    beforeAll(() => {
      delete process.env.MCP_AUTH_TOKEN;
      delete process.env.MCP_AUTH_TOKEN_TTL;
      setTokenData(null);
    });

    afterAll(() => {
      setTokenData(null);
      delete process.env.MCP_AUTH_TOKEN;
      delete process.env.MCP_AUTH_TOKEN_TTL;
    });

    test('POST /auth/refresh 支持自定义 ttlDays=1', async () => {
      const now = Date.now();
      const res = await supertest(Server.getInstance().server)
        .post('/auth/refresh')
        .send({ ttlDays: 1 })
        .expect(200)
        .expect('Content-Type', /json/);

      expect(res.body.status).toBe('ok');
      expect(res.body.data.ttlDays).toBe(1);
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.token.length).toBeGreaterThan(10);
      expect(typeof res.body.data.expiresAt).toBe('number');
      expect(res.body.data.expiresAt).toBeGreaterThan(now + 23 * 60 * 60 * 1000);
      expect(res.body.data.expiresAt).toBeLessThan(now + 25 * 60 * 60 * 1000);
    });

    test('POST /auth/refresh 支持 ttlDays=0（永不过期）', async () => {
      const res = await supertest(Server.getInstance().server)
        .post('/auth/refresh')
        .send({ ttlDays: 0 })
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.data.ttlDays).toBe(0);
      expect(res.body.data.expiresAt).toBeNull();
    });

    test('POST /auth/refresh 非法 ttlDays 返回 400', async () => {
      const res = await supertest(Server.getInstance().server)
        .post('/auth/refresh')
        .send({ ttlDays: -1 })
        .expect(400);

      expect(res.body.status).toBe('error');
      expect(res.body.message).toContain('ttlDays');
    });
  });

  test('POST /mcp initialize 可以连续创建多个独立会话', async () => {
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'phase0-test-client',
          version: '1.0.0',
        },
      },
    };

    const firstResponse = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(initializeRequest)
      .expect(200);

    const secondResponse = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({ ...initializeRequest, id: 2 })
      .expect(200);

    const firstSessionId = firstResponse.headers['mcp-session-id'];
    const secondSessionId = secondResponse.headers['mcp-session-id'];

    expect(firstSessionId).toBeTruthy();
    expect(secondSessionId).toBeTruthy();
    expect(firstSessionId).not.toEqual(secondSessionId);

    const d1 = await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('mcp-session-id', String(firstSessionId));
    const d2 = await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('mcp-session-id', String(secondSessionId));
    expect([200, 204]).toContain(d1.status);
    expect([200, 204]).toContain(d2.status);
  });

  test('GET /mcp 无 mcp-session-id 应返回 SSE 会话错误说明', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/mcp')
      .set('Accept', 'text/event-stream')
      .expect(400);

    expect(res.body?.error).toContain('mcp-session-id');
    expect(res.body?.error).toContain('POST /mcp');
  });

  test('并行 streamable-http 会话与 /status 计数一致并可逐个删除', async () => {
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'parallel-http-test', version: '1.0.0' },
      },
    };

    const r1 = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(initializeRequest)
      .expect(200);
    const r2 = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({ ...initializeRequest, id: 2 })
      .expect(200);

    const id1 = String(r1.headers['mcp-session-id'] || '');
    const id2 = String(r2.headers['mcp-session-id'] || '');
    expect(id1.length).toBeGreaterThan(0);
    expect(id2.length).toBeGreaterThan(0);
    expect(id1).not.toEqual(id2);

    const status = await supertest(Server.getInstance().server).get('/status').expect(200);
    expect(status.body.data.transports.total).toBeGreaterThanOrEqual(2);
    expect(status.body.data.transports.streamableHttp).toBeGreaterThanOrEqual(2);
    expect(status.body.data.transports.sessionIds).toEqual(expect.arrayContaining([id1, id2]));
    expect(status.body.data.transports.clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientName: 'parallel-http-test',
          sessionCount: 2,
          state: 'active',
        }),
      ]),
    );

    const del1 = await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('mcp-session-id', id1);
    const del2 = await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('mcp-session-id', id2);
    expect([200, 204]).toContain(del1.status);
    expect([200, 204]).toContain(del2.status);
  });

  test('DELETE /status/clients/:clientId 会按归并客户端断开全部活跃会话', async () => {
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'group-disconnect-test', version: '1.0.0' },
      },
    };

    await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(initializeRequest)
      .expect(200);
    await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({ ...initializeRequest, id: 2 })
      .expect(200);

    const before = await supertest(Server.getInstance().server).get('/status').expect(200);
    const clientId = before.body.data.transports.clients.find(
      (client: { clientName?: string }) => client.clientName === 'group-disconnect-test',
    )?.clientId;

    expect(typeof clientId).toBe('string');

    const disconnect = await supertest(Server.getInstance().server)
      .delete(`/status/clients/${clientId}`)
      .expect(200);

    expect(disconnect.body).toMatchObject({
      status: 'ok',
      data: { disconnectedSessions: 2 },
    });

    const after = await supertest(Server.getInstance().server).get('/status').expect(200);
    expect(
      after.body.data.transports.clients.some(
        (client: { clientName?: string }) => client.clientName === 'group-disconnect-test',
      ),
    ).toBe(false);
    expect(after.body.data.transports.sessionStates.disconnected).toBeGreaterThanOrEqual(2);
  });

  test('POST /mcp initialize 后可立即调用 tools/list', async () => {
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'followup-tools-list-test', version: '1.0.0' },
      },
    };

    const init = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(initializeRequest)
      .expect(200);

    const sid = String(init.headers['mcp-session-id'] || '');
    expect(sid.length).toBeGreaterThan(0);

    const list = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('mcp-session-id', sid)
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      })
      .expect(200);

    const payload = parseStreamableJson(list.text || '');
    expect(payload?.result?.tools).toBeDefined();
    expect(Array.isArray(payload?.result?.tools)).toBe(true);

    const del = await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('mcp-session-id', sid);
    expect([200, 204]).toContain(del.status);
  });

  test('DELETE /mcp 对已不存在的 session 应返回 204', async () => {
    await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('mcp-session-id', 'already-gone-session')
      .expect(204);
  });

  /**
   * 放在其它用例之后：先启用 MCP_AUTH_TOKEN + resolve()，再对 inject 设置 remoteAddress，
   * 覆盖「远程访问必须带有效 Bearer」的 HTTP 层行为（本机 IP 仍豁免）。
   */
  describe('远程 IP + Bearer（TokenManager 已启用）', () => {
    beforeAll(() => {
      process.env.MCP_AUTH_TOKEN = REMOTE_BEARER_TOKEN;
      setTokenData(null);
      tokenManager.resolve();
    });

    afterAll(() => {
      delete process.env.MCP_AUTH_TOKEN;
      setTokenData(null);
    });

    test('远程 IP 访问公开路径 /ping、/status 无需 Bearer', async () => {
      const app = Server.getInstance();
      const ping = await app.inject({
        method: 'GET',
        url: '/ping',
        remoteAddress: REMOTE_CLIENT_IP,
      });
      expect(ping.statusCode).toBe(200);
      const status = await app.inject({
        method: 'GET',
        url: '/status',
        remoteAddress: REMOTE_CLIENT_IP,
      });
      expect(status.statusCode).toBe(200);
      expect(JSON.parse(status.body).data.authEnabled).toBe(true);
    });

    test('远程 IP 无 Authorization 访问 POST /mcp 返回 401', async () => {
      const app = Server.getInstance();
      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'remote-auth-test', version: '1.0.0' },
        },
      };
      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        remoteAddress: REMOTE_CLIENT_IP,
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: initializeRequest,
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body as string);
      expect(body.message).toContain('Unauthorized');
    });

    test('远程 IP Bearer 错误时返回 401', async () => {
      const app = Server.getInstance();
      const res = await app.inject({
        method: 'GET',
        url: '/agent/engines',
        remoteAddress: REMOTE_CLIENT_IP,
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(res.statusCode).toBe(401);
    });

    test('远程 IP 携带正确 Bearer 可完成 POST /mcp initialize 流程', async () => {
      const app = Server.getInstance();
      const authHeaders = { authorization: `Bearer ${REMOTE_BEARER_TOKEN}` };

      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'remote-bearer-ok', version: '1.0.0' },
        },
      };
      const mcp = await app.inject({
        method: 'POST',
        url: '/mcp',
        remoteAddress: REMOTE_CLIENT_IP,
        headers: {
          ...authHeaders,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: initializeRequest,
      });
      expect(mcp.statusCode).toBe(200);
      expect(mcp.headers['mcp-session-id']).toBeTruthy();

      const sid = String(mcp.headers['mcp-session-id']);
      const del = await app.inject({
        method: 'DELETE',
        url: '/mcp',
        remoteAddress: REMOTE_CLIENT_IP,
        headers: {
          ...authHeaders,
          'mcp-session-id': sid,
        },
      });
      expect([200, 204]).toContain(del.statusCode);
    });

    test('远程 IP 携带正确 Bearer 时可完成 initialize -> initialized -> tools/list', async () => {
      const app = Server.getInstance();
      const authHeaders = {
        authorization: `Bearer ${REMOTE_BEARER_TOKEN}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      };

      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'remote-bearer-sequence', version: '1.0.0' },
        },
      };

      const init = await app.inject({
        method: 'POST',
        url: '/mcp',
        remoteAddress: REMOTE_CLIENT_IP,
        headers: authHeaders,
        payload: initializeRequest,
      });
      expect(init.statusCode).toBe(200);

      const sid = String(init.headers['mcp-session-id'] || '');
      expect(sid.length).toBeGreaterThan(0);

      const initialized = await app.inject({
        method: 'POST',
        url: '/mcp',
        remoteAddress: REMOTE_CLIENT_IP,
        headers: {
          ...authHeaders,
          'mcp-session-id': sid,
        },
        payload: {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        },
      });
      expect([200, 202, 204]).toContain(initialized.statusCode);

      const list = await app.inject({
        method: 'POST',
        url: '/mcp',
        remoteAddress: REMOTE_CLIENT_IP,
        headers: {
          ...authHeaders,
          'mcp-session-id': sid,
        },
        payload: {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        },
      });
      expect(list.statusCode).toBe(200);
      const payload = parseStreamableJson(list.body as string);
      expect(Array.isArray(payload?.result?.tools)).toBe(true);
      expect(
        payload?.result?.tools?.some(
          (tool: { name?: string }) => tool?.name === 'get_windows_and_tabs',
        ),
      ).toBe(true);

      const del = await app.inject({
        method: 'DELETE',
        url: '/mcp',
        remoteAddress: REMOTE_CLIENT_IP,
        headers: {
          authorization: `Bearer ${REMOTE_BEARER_TOKEN}`,
          'mcp-session-id': sid,
        },
      });
      expect([200, 204]).toContain(del.statusCode);
    });

    test('远程 IP 在 token 已过期时即使 Bearer 正确也返回 401', async () => {
      const app = Server.getInstance();
      const previous = (tokenManager as unknown as { data: TokenData | null }).data;
      (tokenManager as unknown as { data: TokenData | null }).data = {
        token: REMOTE_BEARER_TOKEN,
        createdAt: 0,
        expiresAt: Date.now() - 1000,
      };
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/agent/engines',
          remoteAddress: REMOTE_CLIENT_IP,
          headers: { authorization: `Bearer ${REMOTE_BEARER_TOKEN}` },
        });
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body as string).message).toContain('expired');
      } finally {
        (tokenManager as unknown as { data: TokenData | null }).data = previous;
      }
    });
  });
});
