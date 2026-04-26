import { openMemoryDb } from './client';
import {
  OperationMemoryLogRepository,
  type OperationMemoryLogInsert,
} from './operation-memory-log-repository';
import { SessionRepository } from './session-repository';
import { StepRepository } from './step-repository';
import { TaskRepository } from './task-repository';
import type { ExecutionSession, ExecutionStep, Task } from '../../execution/types';

function bootstrap(): {
  repo: OperationMemoryLogRepository;
  close: () => void;
} {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const stepRepo = new StepRepository(db);
  const repo = new OperationMemoryLogRepository(db);

  const task: Task = {
    taskId: 'task-1',
    taskType: 'browser-action',
    title: 'operation log task',
    intent: 'read list',
    origin: 'jest',
    labels: [],
    status: 'running',
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
  };
  const session: ExecutionSession = {
    sessionId: 'session-1',
    taskId: task.taskId,
    transport: 'stdio',
    clientName: 'jest',
    status: 'running',
    startedAt: '2026-04-26T00:00:01.000Z',
    steps: [],
  };
  const step: ExecutionStep = {
    stepId: 'step-1',
    sessionId: session.sessionId,
    index: 1,
    toolName: 'chrome_read_page',
    stepType: 'tool_call',
    status: 'completed',
    artifactRefs: [],
    startedAt: '2026-04-26T00:00:02.000Z',
    endedAt: '2026-04-26T00:00:02.200Z',
  };

  taskRepo.insert(task);
  sessionRepo.insert(session);
  stepRepo.insert(step);

  return { repo, close: () => db.close() };
}

function logFixture(overrides: Partial<OperationMemoryLogInsert> = {}): OperationMemoryLogInsert {
  return {
    operationLogId: 'op-1',
    taskId: 'task-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    toolName: 'chrome_read_page',
    urlPattern: 'https://api.example.test/search{?q}',
    pageRole: 'search_results',
    requestedLayer: 'L0+L1',
    selectedDataSource: 'api_rows',
    sourceRoute: 'knowledge_supported_read',
    decisionReason: 'api_knowledge_candidate',
    resultKind: 'api_rows',
    durationMs: 42,
    success: true,
    fallbackUsed: null,
    readCount: 1,
    tokensSaved: 120,
    tabHygiene: { primaryTabReuseRate: 1 },
    createdAt: '2026-04-26T00:00:03.000Z',
    ...overrides,
  };
}

describe('OperationMemoryLogRepository', () => {
  it('round-trips operation metadata without raw payload fields', () => {
    const { repo, close } = bootstrap();
    try {
      const inserted = repo.insert(logFixture());
      expect(inserted).toEqual(
        expect.objectContaining({
          operationLogId: 'op-1',
          taskId: 'task-1',
          sessionId: 'session-1',
          stepId: 'step-1',
          toolName: 'chrome_read_page',
          selectedDataSource: 'api_rows',
          sourceRoute: 'knowledge_supported_read',
          tokensSaved: 120,
          tabHygiene: { primaryTabReuseRate: 1 },
        }),
      );
      expect(repo.listBySession('session-1')).toEqual([inserted]);
      expect(JSON.stringify(inserted)).not.toContain('Authorization');
      expect(JSON.stringify(inserted)).not.toContain('Cookie');
      expect(JSON.stringify(inserted)).not.toContain('rawBody');
    } finally {
      close();
    }
  });

  it('is idempotent per step and clearable', () => {
    const { repo, close } = bootstrap();
    try {
      repo.insert(logFixture({ operationLogId: 'op-1', tokensSaved: 100 }));
      repo.insert(logFixture({ operationLogId: 'op-2', tokensSaved: 200 }));
      expect(repo.count()).toBe(1);
      expect(repo.listBySession('session-1')[0].tokensSaved).toBe(200);
      repo.clear();
      expect(repo.count()).toBe(0);
    } finally {
      close();
    }
  });
});
