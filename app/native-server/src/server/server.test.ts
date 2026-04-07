import { describe, expect, test, afterAll, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import http from 'node:http';
import Server from './index';
import { sessionManager } from '../execution/session-manager';

/**
 * Open an SSE connection to GET /sse and resolve once the first `endpoint`
 * event is received (which contains the sessionId in the URL).
 * Returns the sessionId and a cleanup function to close the connection.
 */
function openSseConnection(port: number): Promise<{ sessionId: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/sse',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE returned status ${res.statusCode}`));
          return;
        }
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          const endpointMatch = buf.match(/event:\s*endpoint\ndata:\s*(\S+)/);
          if (endpointMatch) {
            const url = endpointMatch[1];
            const sid = new URL(url, 'http://localhost').searchParams.get('sessionId') || '';
            resolve({
              sessionId: sid,
              close: () => {
                res.destroy();
                req.destroy();
              },
            });
          }
        });
        res.on('error', () => {});
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('SSE connection timed out'));
    });
  });
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
      host: '127.0.0.1',
      port: null,
      nativeHostAttached: false,
    });
    expect(response.body.data.transports).toMatchObject({
      total: 0,
      sse: 0,
      streamableHttp: 0,
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
    expect(Array.isArray(response.body.data.transports.sessionIds)).toBe(true);
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
        clientInfo: { name: 'parallel-sse-test', version: '1.0.0' },
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

    const del1 = await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('mcp-session-id', id1);
    const del2 = await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('mcp-session-id', id2);
    expect([200, 204]).toContain(del1.status);
    expect([200, 204]).toContain(del2.status);
  });

  // ==============================================================
  // A4: 经典 SSE 传输 (GET /sse + POST /messages) 回归测试
  // ==============================================================

  describe('经典 SSE 传输', () => {
    let ssePort: number;

    beforeAll(async () => {
      await Server.getInstance().listen({ port: 0, host: '127.0.0.1' });
      const addr = Server.getInstance().server.address() as { port: number };
      ssePort = addr.port;
    });

    afterAll(async () => {
      await Server.getInstance().close();
    });

    test('GET /sse 返回 SSE 流并注册 session', async () => {
      const conn = await openSseConnection(ssePort);
      try {
        expect(conn.sessionId.length).toBeGreaterThan(0);

        const status = await supertest(Server.getInstance().server).get('/status').expect(200);
        expect(status.body.data.transports.sse).toBeGreaterThanOrEqual(1);
        expect(status.body.data.transports.sessionIds).toContain(conn.sessionId);
      } finally {
        conn.close();
      }
    });

    test('POST /messages 无效 sessionId 返回 400', async () => {
      const res = await supertest(Server.getInstance().server)
        .post('/messages')
        .query({ sessionId: 'nonexistent-session-id' })
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {} },
        })
        .expect(400);

      expect(res.text).toContain('No transport found for sessionId');
    });

    test('并行 SSE 会话在 /status 中正确计数', async () => {
      const conn1 = await openSseConnection(ssePort);
      const conn2 = await openSseConnection(ssePort);
      try {
        expect(conn1.sessionId).not.toEqual(conn2.sessionId);

        const status = await supertest(Server.getInstance().server).get('/status').expect(200);
        const { transports } = status.body.data;
        expect(transports.sse).toBeGreaterThanOrEqual(2);
        expect(transports.sessionIds).toEqual(
          expect.arrayContaining([conn1.sessionId, conn2.sessionId]),
        );

        const clients = transports.clients as Array<{
          sessionId: string;
          kind: string;
          clientIp: string;
        }>;
        const sseClients = clients.filter(
          (c) => c.sessionId === conn1.sessionId || c.sessionId === conn2.sessionId,
        );
        expect(sseClients).toHaveLength(2);
        for (const c of sseClients) {
          expect(c.kind).toBe('sse');
          expect(c.clientIp).toBeTruthy();
        }
      } finally {
        conn1.close();
        conn2.close();
      }
    });

    test('DELETE /status/sessions/:id 可踢出 SSE 会话', async () => {
      const conn = await openSseConnection(ssePort);
      const { sessionId } = conn;

      const before = await supertest(Server.getInstance().server).get('/status').expect(200);
      expect(before.body.data.transports.sessionIds).toContain(sessionId);

      await supertest(Server.getInstance().server)
        .delete(`/status/sessions/${sessionId}`)
        .expect(200);

      const after = await supertest(Server.getInstance().server).get('/status').expect(200);
      expect(after.body.data.transports.sessionIds).not.toContain(sessionId);

      conn.close();
    });

    test('SSE 连接关闭后 session 自动清理', async () => {
      const conn = await openSseConnection(ssePort);
      const { sessionId } = conn;

      const before = await supertest(Server.getInstance().server).get('/status').expect(200);
      expect(before.body.data.transports.sessionIds).toContain(sessionId);

      conn.close();
      await new Promise((r) => setTimeout(r, 200));

      const after = await supertest(Server.getInstance().server).get('/status').expect(200);
      expect(after.body.data.transports.sessionIds).not.toContain(sessionId);
    });
  });
});
