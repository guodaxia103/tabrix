import { openMemoryDb } from './client';
import { SessionRepository } from './session-repository';
import { StepRepository } from './step-repository';
import { TaskRepository } from './task-repository';
import type { ExecutionStep } from '../../execution/types';

function bootstrap(): {
  stepRepo: StepRepository;
  close: () => void;
} {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const stepRepo = new StepRepository(db);

  taskRepo.insert({
    taskId: 'task-parent',
    taskType: 't',
    title: 't',
    intent: 'i',
    origin: 'jest',
    labels: [],
    status: 'running',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
  });
  sessionRepo.insert({
    sessionId: 'session-parent',
    taskId: 'task-parent',
    transport: 'stdio',
    clientName: 'jest',
    status: 'running',
    startedAt: '2026-04-20T00:00:01.000Z',
    steps: [],
  });

  return { stepRepo, close: () => db.close() };
}

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    stepId: overrides.stepId ?? 'step-1',
    sessionId: 'session-parent',
    index: 1,
    toolName: 'chrome_read_page',
    stepType: 'tool_call',
    status: 'running',
    inputSummary: undefined,
    resultSummary: undefined,
    errorCode: undefined,
    errorSummary: undefined,
    artifactRefs: [],
    startedAt: '2026-04-20T00:00:02.000Z',
    endedAt: undefined,
    ...overrides,
  };
}

describe('StepRepository', () => {
  it('round-trips steps with artifact refs', () => {
    const { stepRepo, close } = bootstrap();
    try {
      stepRepo.insert(step({ artifactRefs: ['artifact://read_page/1'] }));
      const steps = stepRepo.listBySession('session-parent');
      expect(steps).toHaveLength(1);
      expect(steps[0].artifactRefs).toEqual(['artifact://read_page/1']);
    } finally {
      close();
    }
  });

  it('complete() writes status, result, ended timestamp, and new refs', () => {
    const { stepRepo, close } = bootstrap();
    try {
      stepRepo.insert(step({ stepId: 'step-1' }));
      stepRepo.complete({
        stepId: 'step-1',
        status: 'completed',
        resultSummary: 'ok',
        artifactRefs: ['artifact://foo'],
        endedAt: '2026-04-20T00:00:05.000Z',
      });
      const [fetched] = stepRepo.listBySession('session-parent');
      expect(fetched.status).toBe('completed');
      expect(fetched.resultSummary).toBe('ok');
      expect(fetched.artifactRefs).toEqual(['artifact://foo']);
      expect(fetched.endedAt).toBe('2026-04-20T00:00:05.000Z');
    } finally {
      close();
    }
  });

  it('complete() preserves error fields', () => {
    const { stepRepo, close } = bootstrap();
    try {
      stepRepo.insert(step({ stepId: 'step-err' }));
      stepRepo.complete({
        stepId: 'step-err',
        status: 'failed',
        errorCode: 'E_BOOM',
        errorSummary: 'exploded',
        artifactRefs: [],
        endedAt: '2026-04-20T00:00:06.000Z',
      });
      const [fetched] = stepRepo.listBySession('session-parent');
      expect(fetched.status).toBe('failed');
      expect(fetched.errorCode).toBe('E_BOOM');
      expect(fetched.errorSummary).toBe('exploded');
    } finally {
      close();
    }
  });

  it('listBySession returns steps ordered by step_index', () => {
    const { stepRepo, close } = bootstrap();
    try {
      stepRepo.insert(step({ stepId: 'a', index: 3 }));
      stepRepo.insert(step({ stepId: 'b', index: 1 }));
      stepRepo.insert(step({ stepId: 'c', index: 2 }));
      const steps = stepRepo.listBySession('session-parent');
      expect(steps.map((s) => s.stepId)).toEqual(['b', 'c', 'a']);
      expect(steps.map((s) => s.index)).toEqual([1, 2, 3]);
    } finally {
      close();
    }
  });

  it('enforces (session_id, step_index) uniqueness', () => {
    const { stepRepo, close } = bootstrap();
    try {
      stepRepo.insert(step({ stepId: 's1', index: 1 }));
      expect(() => stepRepo.insert(step({ stepId: 's2', index: 1 }))).toThrow(/UNIQUE/);
    } finally {
      close();
    }
  });

  it('nextIndexFor returns 1 for empty sessions and max+1 otherwise', () => {
    const { stepRepo, close } = bootstrap();
    try {
      expect(stepRepo.nextIndexFor('session-parent')).toBe(1);
      stepRepo.insert(step({ stepId: 'a', index: 1 }));
      stepRepo.insert(step({ stepId: 'b', index: 2 }));
      expect(stepRepo.nextIndexFor('session-parent')).toBe(3);
    } finally {
      close();
    }
  });
});

describe.skip('StepRepository.listBySession (integration · B-004 placeholder)', () => {
  it.todo('returns empty array on virgin db');
  it.todo('respects limit');
  it.todo('respects offset');
  it.todo('orders by startedAt desc');
  it.todo('does not leak unrelated sessions when filtering by id');
  it.todo('throws typed error on malformed id');
  it.todo('handles 10k-row pagination consistency');
  it.todo('respects better-sqlite3 transaction boundary');
});
