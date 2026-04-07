import { describe, expect, test, afterAll, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { sessionManager } from '../execution/session-manager';

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
});
