import { openMemoryDb } from './client';
import { SessionRepository, SESSION_SUMMARY_LIMIT_MAX } from './session-repository';
import { StepRepository } from './step-repository';
import { TaskRepository } from './task-repository';
import type { ExecutionSession, ExecutionStep, Task } from '../../execution/types';

function bootstrap(): {
  taskRepo: TaskRepository;
  sessionRepo: SessionRepository;
  stepRepo: StepRepository;
  close: () => void;
} {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const stepRepo = new StepRepository(db);

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

  return { taskRepo, sessionRepo, stepRepo, close: () => db.close() };
}

function stepFixture(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    stepId: overrides.stepId ?? 'step-1',
    sessionId: overrides.sessionId ?? 'session-1',
    index: overrides.index ?? 1,
    toolName: overrides.toolName ?? 'chrome_read_page',
    stepType: overrides.stepType ?? 'tool_call',
    status: overrides.status ?? 'completed',
    inputSummary: overrides.inputSummary,
    resultSummary: overrides.resultSummary,
    errorCode: overrides.errorCode,
    errorSummary: overrides.errorSummary,
    artifactRefs: overrides.artifactRefs ?? [],
    startedAt: overrides.startedAt ?? '2026-04-20T00:00:05.000Z',
    endedAt: overrides.endedAt,
  };
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

  describe('listRecent (B-001 read API)', () => {
    it('returns an empty array on a virgin DB', () => {
      const { sessionRepo, close } = bootstrap();
      try {
        expect(sessionRepo.listRecent(20, 0)).toEqual([]);
        expect(sessionRepo.countAll()).toBe(0);
      } finally {
        close();
      }
    });

    it('orders by startedAt DESC, inlines task title + intent + stepCount', () => {
      const { sessionRepo, stepRepo, close } = bootstrap();
      try {
        sessionRepo.insert(
          sessionFixture({ sessionId: 's-old', startedAt: '2026-04-20T00:00:01.000Z' }),
        );
        sessionRepo.insert(
          sessionFixture({ sessionId: 's-new', startedAt: '2026-04-20T00:00:10.000Z' }),
        );

        stepRepo.insert(stepFixture({ stepId: 'step-a', sessionId: 's-new', index: 1 }));
        stepRepo.insert(stepFixture({ stepId: 'step-b', sessionId: 's-new', index: 2 }));
        stepRepo.insert(stepFixture({ stepId: 'step-c', sessionId: 's-old', index: 1 }));

        const summaries = sessionRepo.listRecent(20, 0);
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({
          sessionId: 's-new',
          taskId: 'task-parent',
          taskTitle: 'parent',
          taskIntent: 'parent intent',
          stepCount: 2,
        });
        expect(summaries[1]).toMatchObject({
          sessionId: 's-old',
          stepCount: 1,
        });
      } finally {
        close();
      }
    });

    it('respects limit and offset (pagination)', () => {
      const { sessionRepo, close } = bootstrap();
      try {
        for (let i = 0; i < 5; i += 1) {
          sessionRepo.insert(
            sessionFixture({
              sessionId: `s-${i}`,
              startedAt: `2026-04-20T00:00:${String(i).padStart(2, '0')}.000Z`,
            }),
          );
        }
        const page1 = sessionRepo.listRecent(2, 0).map((s) => s.sessionId);
        const page2 = sessionRepo.listRecent(2, 2).map((s) => s.sessionId);
        const page3 = sessionRepo.listRecent(2, 4).map((s) => s.sessionId);
        expect(page1).toEqual(['s-4', 's-3']);
        expect(page2).toEqual(['s-2', 's-1']);
        expect(page3).toEqual(['s-0']);
        expect(sessionRepo.countAll()).toBe(5);
      } finally {
        close();
      }
    });

    it('clamps limit to SESSION_SUMMARY_LIMIT_MAX and coerces bad input', () => {
      const { sessionRepo, close } = bootstrap();
      try {
        sessionRepo.insert(sessionFixture({ sessionId: 's-1' }));
        const clamped = sessionRepo.listRecent(10_000, 0);
        expect(clamped).toHaveLength(1);
        // Negative / NaN limit falls back to at least 1 row per the docstring.
        const coerced = sessionRepo.listRecent(-5, -10);
        expect(coerced).toHaveLength(1);
        // Sanity check the bound is what consumers think it is.
        expect(SESSION_SUMMARY_LIMIT_MAX).toBe(500);
      } finally {
        close();
      }
    });

    it('keeps ordering stable when two sessions share the same startedAt', () => {
      const { sessionRepo, close } = bootstrap();
      try {
        const sameTs = '2026-04-20T00:00:05.000Z';
        sessionRepo.insert(sessionFixture({ sessionId: 's-a', startedAt: sameTs }));
        sessionRepo.insert(sessionFixture({ sessionId: 's-b', startedAt: sameTs }));
        const summaries = sessionRepo.listRecent(10, 0).map((s) => s.sessionId);
        // Secondary key is session_id DESC, so 'b' precedes 'a'.
        expect(summaries).toEqual(['s-b', 's-a']);
      } finally {
        close();
      }
    });
  });

  describe('pending aggregation (B-012)', () => {
    it('lists terminal unaggregated sessions and marks them exactly once', () => {
      const { sessionRepo, close } = bootstrap();
      try {
        sessionRepo.insert(
          sessionFixture({
            sessionId: 's-running',
            status: 'running',
            startedAt: '2026-04-20T00:00:01.000Z',
          }),
        );
        sessionRepo.insert(
          sessionFixture({
            sessionId: 's-completed',
            status: 'completed',
            startedAt: '2026-04-20T00:00:02.000Z',
            endedAt: '2026-04-20T00:00:03.000Z',
          }),
        );
        sessionRepo.insert(
          sessionFixture({
            sessionId: 's-failed',
            status: 'failed',
            startedAt: '2026-04-20T00:00:04.000Z',
            endedAt: '2026-04-20T00:00:05.000Z',
          }),
        );

        const pending = sessionRepo.listPendingAggregationSessions();
        expect(pending.map((row) => row.sessionId)).toEqual(['s-completed', 's-failed']);

        const firstMark = sessionRepo.markAggregated('s-completed', '2026-04-21T00:00:00.000Z');
        const secondMark = sessionRepo.markAggregated('s-completed', '2026-04-21T00:00:01.000Z');
        expect(firstMark).toBe(1);
        expect(secondMark).toBe(0);

        const remaining = sessionRepo.listPendingAggregationSessions();
        expect(remaining.map((row) => row.sessionId)).toEqual(['s-failed']);
      } finally {
        close();
      }
    });
  });
});

describe('SessionRepository.listRecent (integration · B-004 closure)', () => {
  it('clamps oversized limits to SESSION_SUMMARY_LIMIT_MAX', () => {
    const { sessionRepo, close } = bootstrap();
    try {
      for (let i = 1; i <= SESSION_SUMMARY_LIMIT_MAX + 1; i += 1) {
        sessionRepo.insert(
          sessionFixture({
            sessionId: `s-${String(i).padStart(3, '0')}`,
            startedAt: `2026-04-20T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(
              i % 60,
            ).padStart(2, '0')}.000Z`,
          }),
        );
      }

      const summaries = sessionRepo.listRecent(10_000, 0);
      expect(summaries).toHaveLength(SESSION_SUMMARY_LIMIT_MAX);
      expect(summaries[0].sessionId).toBe('s-501');
      expect(summaries.at(-1)?.sessionId).toBe('s-002');
      expect(sessionRepo.countAll()).toBe(SESSION_SUMMARY_LIMIT_MAX + 1);
    } finally {
      close();
    }
  });

  it('keeps task projection and step counts isolated across sessions', () => {
    const { taskRepo, sessionRepo, stepRepo, close } = bootstrap();
    try {
      taskRepo.insert({
        taskId: 'task-other',
        taskType: 'browser-action',
        title: 'other',
        intent: 'other intent',
        origin: 'jest',
        labels: [],
        status: 'running',
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-20T00:00:00.000Z',
      });
      sessionRepo.insert(
        sessionFixture({
          sessionId: 's-parent',
          taskId: 'task-parent',
          startedAt: '2026-04-20T00:00:01.000Z',
        }),
      );
      sessionRepo.insert(
        sessionFixture({
          sessionId: 's-other',
          taskId: 'task-other',
          startedAt: '2026-04-20T00:00:02.000Z',
        }),
      );
      stepRepo.insert(stepFixture({ stepId: 'parent-1', sessionId: 's-parent', index: 1 }));
      stepRepo.insert(stepFixture({ stepId: 'other-1', sessionId: 's-other', index: 1 }));
      stepRepo.insert(stepFixture({ stepId: 'other-2', sessionId: 's-other', index: 2 }));

      expect(sessionRepo.listRecent(10, 0)).toMatchObject([
        {
          sessionId: 's-other',
          taskId: 'task-other',
          taskTitle: 'other',
          taskIntent: 'other intent',
          stepCount: 2,
        },
        {
          sessionId: 's-parent',
          taskId: 'task-parent',
          taskTitle: 'parent',
          taskIntent: 'parent intent',
          stepCount: 1,
        },
      ]);
    } finally {
      close();
    }
  });

  it('returns empty pages when offset is beyond the available range', () => {
    const { sessionRepo, close } = bootstrap();
    try {
      sessionRepo.insert(sessionFixture({ sessionId: 's-1' }));
      expect(sessionRepo.listRecent(20, 1)).toEqual([]);
    } finally {
      close();
    }
  });
});
