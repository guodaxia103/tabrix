import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { sessionManager } from '../execution/session-manager';

async function seedOneSession(): Promise<{
  taskId: string;
  sessionId: string;
  stepIds: string[];
}> {
  const task = sessionManager.createTask({
    taskType: 'browser-action',
    title: 'route-test task',
    intent: 'inspect a github workflow run',
    origin: 'jest',
    labels: ['stage-3e', 'memory-routes'],
  });
  const session = sessionManager.startSession({
    taskId: task.taskId,
    transport: 'http',
    clientName: 'jest-supertest',
  });
  const step1 = sessionManager.startStep({
    sessionId: session.sessionId,
    toolName: 'chrome_read_page',
    inputSummary: 'read the workflow run page',
  });
  sessionManager.completeStep(session.sessionId, step1.stepId, {
    status: 'completed',
    resultSummary: 'ok',
  });
  const step2 = sessionManager.startStep({
    sessionId: session.sessionId,
    toolName: 'chrome_fill_or_select',
    inputSummary: 'fill the rerun reason',
  });
  sessionManager.completeStep(session.sessionId, step2.stepId, {
    status: 'failed',
    errorCode: 'element_not_found',
    errorSummary: 'the rerun button is not in the DOM',
  });
  sessionManager.finishSession(session.sessionId, { status: 'completed' });
  return {
    taskId: task.taskId,
    sessionId: session.sessionId,
    stepIds: [step1.stepId, step2.stepId],
  };
}

describe('memory read routes (B-001 · Stage 3e)', () => {
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  beforeEach(() => {
    sessionManager.reset();
  });

  afterEach(() => {
    sessionManager.reset();
  });

  test('GET /memory/sessions returns an empty list on a virgin DB', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/memory/sessions')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(res.body).toMatchObject({
      status: 'ok',
      data: {
        sessions: [],
        total: 0,
        limit: 20,
        offset: 0,
      },
    });
    // Persistence mode is test-mode in-memory; the route echoes it so
    // the UI can show a neutral message when disk persistence is off.
    expect(['disk', 'memory', 'off']).toContain(res.body.data.persistenceMode);
  });

  test('GET /memory/sessions lists recent sessions with task title + step count', async () => {
    const seeded = await seedOneSession();
    const res = await supertest(Server.getInstance().server).get('/memory/sessions').expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.sessions[0]).toMatchObject({
      sessionId: seeded.sessionId,
      taskId: seeded.taskId,
      taskTitle: 'route-test task',
      taskIntent: 'inspect a github workflow run',
      transport: 'http',
      clientName: 'jest-supertest',
      status: 'completed',
      stepCount: 2,
    });
  });

  test('GET /memory/sessions honors limit and offset', async () => {
    for (let i = 0; i < 3; i += 1) {
      // Each seed increments the wall clock by 1ms so listRecent order
      // is deterministic for this assertion.
      await new Promise((resolve) => setTimeout(resolve, 2));
      await seedOneSession();
    }
    const first = await supertest(Server.getInstance().server)
      .get('/memory/sessions?limit=2&offset=0')
      .expect(200);
    const second = await supertest(Server.getInstance().server)
      .get('/memory/sessions?limit=2&offset=2')
      .expect(200);

    expect(first.body.data.total).toBe(3);
    expect(first.body.data.sessions).toHaveLength(2);
    expect(first.body.data.limit).toBe(2);
    expect(second.body.data.sessions).toHaveLength(1);
    expect(second.body.data.offset).toBe(2);
  });

  test('GET /memory/sessions/:sessionId/steps returns steps in chronological order', async () => {
    const seeded = await seedOneSession();
    const res = await supertest(Server.getInstance().server)
      .get(`/memory/sessions/${seeded.sessionId}/steps`)
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      data: { sessionId: seeded.sessionId },
    });
    expect(res.body.data.steps).toHaveLength(2);
    expect(res.body.data.steps[0]).toMatchObject({
      stepId: seeded.stepIds[0],
      toolName: 'chrome_read_page',
      status: 'completed',
    });
    expect(res.body.data.steps[1]).toMatchObject({
      stepId: seeded.stepIds[1],
      toolName: 'chrome_fill_or_select',
      status: 'failed',
      errorCode: 'element_not_found',
    });
  });

  test('GET /memory/sessions/:sessionId/steps returns [] for an unknown session', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/memory/sessions/does-not-exist/steps')
      .expect(200);
    expect(res.body.data.steps).toEqual([]);
  });

  test('GET /memory/tasks/:taskId returns the task when it exists', async () => {
    const seeded = await seedOneSession();
    const res = await supertest(Server.getInstance().server)
      .get(`/memory/tasks/${seeded.taskId}`)
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      data: {
        task: {
          taskId: seeded.taskId,
          title: 'route-test task',
          intent: 'inspect a github workflow run',
        },
      },
    });
  });

  test('GET /memory/tasks/:taskId returns 404 for an unknown task', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/memory/tasks/does-not-exist')
      .expect(404);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toBe('Task not found');
  });

  test('write verbs are not registered (read-only invariant)', async () => {
    // POST / PUT / PATCH / DELETE against the memory namespace must 404.
    await supertest(Server.getInstance().server).post('/memory/sessions').expect(404);
    await supertest(Server.getInstance().server)
      .delete('/memory/sessions/anything/steps')
      .expect(404);
    await supertest(Server.getInstance().server).put('/memory/tasks/any').expect(404);
  });
});
