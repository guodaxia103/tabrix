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
  });
});
