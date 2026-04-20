import { openMemoryDb } from './client';
import { SessionRepository } from './session-repository';
import { TaskRepository } from './task-repository';
import type { ExecutionSession, Task } from '../../execution/types';

function bootstrap(): {
  taskRepo: TaskRepository;
  sessionRepo: SessionRepository;
  close: () => void;
} {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);

  const parent: Task = {
    taskId: 'task-parent',
    taskType: 'browser-action',
    title: 'parent',
    intent: 'parent intent',
    origin: 'jest',
    labels: [],
    status: 'running',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
  };
  taskRepo.insert(parent);

  return { taskRepo, sessionRepo, close: () => db.close() };
}

function sessionFixture(overrides: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    sessionId: overrides.sessionId ?? 'session-1',
    taskId: overrides.taskId ?? 'task-parent',
    transport: 'stdio',
    clientName: 'jest',
    workspaceContext: undefined,
    browserContext: undefined,
    summary: undefined,
    status: 'running',
    startedAt: '2026-04-20T00:00:01.000Z',
    endedAt: undefined,
    steps: [],
    ...overrides,
  };
}

describe('SessionRepository', () => {
  it('round-trips sessions with optional fields', () => {
    const { sessionRepo, close } = bootstrap();
    try {
      const session = sessionFixture({
        sessionId: 's-abc',
        workspaceContext: '/workspace',
        browserContext: 'chrome-1',
      });
      sessionRepo.insert(session);
      const fetched = sessionRepo.get('s-abc');
      // list() returns empty steps; repo callers hydrate steps separately.
      expect(fetched).toMatchObject({
        sessionId: 's-abc',
        workspaceContext: '/workspace',
        browserContext: 'chrome-1',
        status: 'running',
      });
      expect(fetched?.steps).toEqual([]);
    } finally {
      close();
    }
  });

  it('finish() updates status, summary, endedAt', () => {
    const { sessionRepo, close } = bootstrap();
    try {
      sessionRepo.insert(sessionFixture());
      sessionRepo.finish({
        sessionId: 'session-1',
        status: 'completed',
        summary: 'done',
        endedAt: '2026-04-20T00:00:10.000Z',
      });
      const fetched = sessionRepo.get('session-1');
      expect(fetched?.status).toBe('completed');
      expect(fetched?.summary).toBe('done');
      expect(fetched?.endedAt).toBe('2026-04-20T00:00:10.000Z');
    } finally {
      close();
    }
  });

  it('foreign key cascade removes sessions when parent task is deleted', () => {
    const { taskRepo, sessionRepo, close } = bootstrap();
    try {
      sessionRepo.insert(sessionFixture({ sessionId: 's1' }));
      sessionRepo.insert(sessionFixture({ sessionId: 's2' }));
      expect(sessionRepo.list()).toHaveLength(2);
      taskRepo.clear();
      expect(sessionRepo.list()).toEqual([]);
    } finally {
      close();
    }
  });

  it('lists sessions in startedAt order', () => {
    const { sessionRepo, close } = bootstrap();
    try {
      sessionRepo.insert(
        sessionFixture({ sessionId: 's2', startedAt: '2026-04-20T00:00:02.000Z' }),
      );
      sessionRepo.insert(
        sessionFixture({ sessionId: 's1', startedAt: '2026-04-20T00:00:01.000Z' }),
      );
      sessionRepo.insert(
        sessionFixture({ sessionId: 's3', startedAt: '2026-04-20T00:00:03.000Z' }),
      );
      expect(sessionRepo.list().map((s) => s.sessionId)).toEqual(['s1', 's2', 's3']);
    } finally {
      close();
    }
  });
});
