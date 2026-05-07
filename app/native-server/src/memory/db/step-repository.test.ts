import { openMemoryDb } from './client';
import { SessionRepository } from './session-repository';
import { StepRepository } from './step-repository';
import { TaskRepository } from './task-repository';
import type { ExecutionStep } from '../../execution/types';

function bootstrap(): {
  sessionRepo: SessionRepository;
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

  return { sessionRepo, stepRepo, close: () => db.close() };
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

describe('StepRepository.listBySession (integration · B-004 closure)', () => {
  it('returns empty arrays for sessions without steps and unknown sessions', () => {
    const { stepRepo, close } = bootstrap();
    try {
      expect(stepRepo.listBySession('session-parent')).toEqual([]);
      expect(stepRepo.listBySession('missing-session')).toEqual([]);
    } finally {
      close();
    }
  });

  it('isolates steps by session while preserving per-session step_index order', () => {
    const { sessionRepo, stepRepo, close } = bootstrap();
    try {
      sessionRepo.insert({
        sessionId: 'session-other',
        taskId: 'task-parent',
        transport: 'stdio',
        clientName: 'jest',
        status: 'running',
        startedAt: '2026-04-20T00:00:03.000Z',
        steps: [],
      });

      stepRepo.insert(step({ stepId: 'parent-2', sessionId: 'session-parent', index: 2 }));
      stepRepo.insert(step({ stepId: 'other-1', sessionId: 'session-other', index: 1 }));
      stepRepo.insert(step({ stepId: 'parent-1', sessionId: 'session-parent', index: 1 }));
      stepRepo.insert(step({ stepId: 'other-2', sessionId: 'session-other', index: 2 }));

      expect(stepRepo.listBySession('session-parent').map((s) => s.stepId)).toEqual([
        'parent-1',
        'parent-2',
      ]);
      expect(stepRepo.listBySession('session-other').map((s) => s.stepId)).toEqual([
        'other-1',
        'other-2',
      ]);
    } finally {
      close();
    }
  });

  it('computes next indexes independently for each session', () => {
    const { sessionRepo, stepRepo, close } = bootstrap();
    try {
      sessionRepo.insert({
        sessionId: 'session-other',
        taskId: 'task-parent',
        transport: 'stdio',
        clientName: 'jest',
        status: 'running',
        startedAt: '2026-04-20T00:00:03.000Z',
        steps: [],
      });

      stepRepo.insert(step({ stepId: 'parent-1', sessionId: 'session-parent', index: 1 }));
      stepRepo.insert(step({ stepId: 'parent-2', sessionId: 'session-parent', index: 2 }));
      stepRepo.insert(step({ stepId: 'other-1', sessionId: 'session-other', index: 1 }));

      expect(stepRepo.nextIndexFor('session-parent')).toBe(3);
      expect(stepRepo.nextIndexFor('session-other')).toBe(2);
      expect(stepRepo.nextIndexFor('missing-session')).toBe(1);
    } finally {
      close();
    }
  });
});
