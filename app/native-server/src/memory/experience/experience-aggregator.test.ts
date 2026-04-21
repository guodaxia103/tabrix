import { openMemoryDb } from '../db/client';
import { PageSnapshotRepository, SessionRepository, StepRepository, TaskRepository } from '../db';
import type { ExecutionSession, ExecutionStep, Task } from '../../execution/types';
import { ExperienceAggregator, ExperienceRepository } from './index';

function bootstrap(): {
  db: ReturnType<typeof openMemoryDb>['db'];
  taskRepo: TaskRepository;
  sessionRepo: SessionRepository;
  stepRepo: StepRepository;
  snapshotRepo: PageSnapshotRepository;
  experienceRepo: ExperienceRepository;
  aggregator: ExperienceAggregator;
  close: () => void;
} {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const stepRepo = new StepRepository(db);
  const snapshotRepo = new PageSnapshotRepository(db);
  const experienceRepo = new ExperienceRepository(db);
  const aggregator = new ExperienceAggregator(
    db,
    sessionRepo,
    stepRepo,
    snapshotRepo,
    experienceRepo,
  );
  return {
    db,
    taskRepo,
    sessionRepo,
    stepRepo,
    snapshotRepo,
    experienceRepo,
    aggregator,
    close: () => db.close(),
  };
}

function insertTask(repo: TaskRepository, overrides: Partial<Task> = {}): Task {
  const task: Task = {
    taskId: overrides.taskId ?? 'task-1',
    taskType: overrides.taskType ?? 'browser-action',
    title: overrides.title ?? 'task',
    intent: overrides.intent ?? 'Open Issues',
    origin: overrides.origin ?? 'jest',
    owner: overrides.owner,
    projectId: overrides.projectId,
    labels: overrides.labels ?? [],
    status: overrides.status ?? 'completed',
    createdAt: overrides.createdAt ?? '2026-04-20T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-20T00:00:00.000Z',
  };
  repo.insert(task);
  return task;
}

function insertSession(
  repo: SessionRepository,
  overrides: Partial<ExecutionSession> = {},
): ExecutionSession {
  const session: ExecutionSession = {
    sessionId: overrides.sessionId ?? 'session-1',
    taskId: overrides.taskId ?? 'task-1',
    transport: overrides.transport ?? 'stdio',
    clientName: overrides.clientName ?? 'jest',
    startedAt: overrides.startedAt ?? '2026-04-20T00:00:01.000Z',
    endedAt: overrides.endedAt ?? '2026-04-20T00:00:02.000Z',
    status: overrides.status ?? 'completed',
    workspaceContext: overrides.workspaceContext,
    browserContext: overrides.browserContext,
    summary: overrides.summary,
    steps: overrides.steps ?? [],
  };
  repo.insert(session);
  return session;
}

function insertStep(repo: StepRepository, overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  const step: ExecutionStep = {
    stepId: overrides.stepId ?? 'step-1',
    sessionId: overrides.sessionId ?? 'session-1',
    index: overrides.index ?? 1,
    toolName: overrides.toolName ?? 'chrome_read_page',
    stepType: overrides.stepType ?? 'tool_call',
    status: overrides.status ?? 'completed',
    inputSummary: overrides.inputSummary,
    resultSummary: overrides.resultSummary,
    startedAt: overrides.startedAt ?? '2026-04-20T00:00:01.100Z',
    endedAt: overrides.endedAt ?? '2026-04-20T00:00:01.200Z',
    errorCode: overrides.errorCode,
    errorSummary: overrides.errorSummary,
    artifactRefs: overrides.artifactRefs ?? [],
  };
  repo.insert(step);
  return step;
}

function insertSnapshot(
  repo: PageSnapshotRepository,
  params: { snapshotId: string; stepId: string; pageRole: string; capturedAt: string },
): void {
  repo.insert({
    snapshotId: params.snapshotId,
    stepId: params.stepId,
    pageRole: params.pageRole,
    fallbackUsed: false,
    interactiveCount: 0,
    candidateActionCount: 0,
    highValueObjectCount: 0,
    capturedAt: params.capturedAt,
  });
}

describe('ExperienceAggregator (B-012 v1)', () => {
  it('A: empty memory produces no rows', () => {
    const { aggregator, experienceRepo, close } = bootstrap();
    try {
      const result = aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
      expect(result).toEqual({ scanned: 0, projected: 0 });
      expect(experienceRepo.listActionPaths()).toEqual([]);
    } finally {
      close();
    }
  });

  it('B: single completed session projects one success row with ordered step_sequence', () => {
    const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
      bootstrap();
    try {
      insertTask(taskRepo, { intent: '  Open   Issues  ' });
      insertSession(sessionRepo, { sessionId: 's1', status: 'completed' });
      insertStep(stepRepo, {
        stepId: 's1-step-1',
        sessionId: 's1',
        index: 1,
        toolName: 'chrome_click_element',
        status: 'completed',
        artifactRefs: ['history://a', 'history://b'],
      });
      insertStep(stepRepo, {
        stepId: 's1-step-2',
        sessionId: 's1',
        index: 2,
        toolName: 'chrome_read_page',
        status: 'completed',
        artifactRefs: [],
      });
      insertSnapshot(snapshotRepo, {
        snapshotId: 'snap-s1',
        stepId: 's1-step-2',
        pageRole: 'repo_home',
        capturedAt: '2026-04-20T00:00:01.500Z',
      });

      aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        pageRole: 'repo_home',
        intentSignature: 'open issues',
        successCount: 1,
        failureCount: 0,
      });
      expect(rows[0].stepSequence).toEqual([
        { toolName: 'chrome_click_element', status: 'completed', historyRef: 'history://a' },
        { toolName: 'chrome_read_page', status: 'completed', historyRef: null },
      ]);
    } finally {
      close();
    }
  });

  it('C: failed/aborted sessions increment failure_count', () => {
    const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
      bootstrap();
    try {
      insertTask(taskRepo, { intent: 'monitor runs' });
      insertSession(sessionRepo, { sessionId: 's-failed', status: 'failed' });
      insertStep(stepRepo, { stepId: 'failed-step', sessionId: 's-failed', index: 1 });
      insertSnapshot(snapshotRepo, {
        snapshotId: 'snap-failed',
        stepId: 'failed-step',
        pageRole: 'actions_list',
        capturedAt: '2026-04-20T00:00:01.800Z',
      });

      aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      expect(rows[0].successCount).toBe(0);
      expect(rows[0].failureCount).toBe(1);
    } finally {
      close();
    }
  });

  it('D: replay is idempotent and writes aggregated_at marker', () => {
    const { db, taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
      bootstrap();
    try {
      insertTask(taskRepo, { intent: 'idempotent replay' });
      insertSession(sessionRepo, { sessionId: 'idem-1', status: 'completed' });
      insertStep(stepRepo, { stepId: 'idem-step-1', sessionId: 'idem-1', index: 1 });
      insertSnapshot(snapshotRepo, {
        snapshotId: 'idem-snap-1',
        stepId: 'idem-step-1',
        pageRole: 'repo_home',
        capturedAt: '2026-04-20T00:00:01.500Z',
      });

      const first = aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
      const second = aggregator.projectPendingSessions('2026-04-21T00:00:01.000Z');
      expect(first).toEqual({ scanned: 1, projected: 1 });
      expect(second).toEqual({ scanned: 0, projected: 0 });

      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      expect(rows[0].successCount).toBe(1);
      expect(rows[0].failureCount).toBe(0);

      const marker = db
        .prepare('SELECT aggregated_at FROM memory_sessions WHERE session_id = ?')
        .get('idem-1') as { aggregated_at: string | null } | undefined;
      expect(marker?.aggregated_at).toBe('2026-04-21T00:00:00.000Z');
    } finally {
      close();
    }
  });

  it("E: missing snapshot falls back to page_role='unknown'", () => {
    const { taskRepo, sessionRepo, stepRepo, aggregator, experienceRepo, close } = bootstrap();
    try {
      insertTask(taskRepo, { intent: 'fallback role' });
      insertSession(sessionRepo, { sessionId: 's-unknown', status: 'completed' });
      insertStep(stepRepo, { stepId: 'unknown-step', sessionId: 's-unknown', index: 1 });

      aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      expect(rows[0].pageRole).toBe('unknown');
    } finally {
      close();
    }
  });

  it('F: same bucket sessions merge into one row and older sessions cannot overwrite latest timestamps/sequence', () => {
    const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
      bootstrap();
    try {
      insertTask(taskRepo, { taskId: 'task-bucket', intent: 'check pipeline health' });

      // Newer session lands first.
      insertSession(sessionRepo, {
        sessionId: 'bucket-new',
        taskId: 'task-bucket',
        status: 'completed',
        startedAt: '2026-04-20T00:00:10.000Z',
        endedAt: '2026-04-20T00:00:11.000Z',
      });
      insertStep(stepRepo, {
        stepId: 'bucket-new-step',
        sessionId: 'bucket-new',
        index: 1,
        toolName: 'chrome_read_page',
      });
      insertSnapshot(snapshotRepo, {
        snapshotId: 'bucket-new-snap',
        stepId: 'bucket-new-step',
        pageRole: 'repo_home',
        capturedAt: '2026-04-20T00:00:10.500Z',
      });

      aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');

      // Older session arrives later (out-of-order ingestion).
      insertSession(sessionRepo, {
        sessionId: 'bucket-old',
        taskId: 'task-bucket',
        status: 'failed',
        startedAt: '2026-04-20T00:00:01.000Z',
        endedAt: '2026-04-20T00:00:02.000Z',
      });
      insertStep(stepRepo, {
        stepId: 'bucket-old-step',
        sessionId: 'bucket-old',
        index: 1,
        toolName: 'chrome_click_element',
      });
      insertSnapshot(snapshotRepo, {
        snapshotId: 'bucket-old-snap',
        stepId: 'bucket-old-step',
        pageRole: 'repo_home',
        capturedAt: '2026-04-20T00:00:01.500Z',
      });

      aggregator.projectPendingSessions('2026-04-21T00:10:00.000Z');

      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      expect(rows[0].successCount).toBe(1);
      expect(rows[0].failureCount).toBe(1);
      expect(rows[0].lastUsedAt).toBe('2026-04-20T00:00:11.000Z');
      expect(rows[0].updatedAt).toBe('2026-04-21T00:00:00.000Z');
      expect(rows[0].stepSequence).toEqual([
        { toolName: 'chrome_read_page', status: 'completed', historyRef: null },
      ]);
    } finally {
      close();
    }
  });

  it('G: historyRef picks the first non-empty artifact ref', () => {
    const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
      bootstrap();
    try {
      insertTask(taskRepo, { intent: 'history ref extraction' });
      insertSession(sessionRepo, { sessionId: 's-history', status: 'completed' });
      insertStep(stepRepo, {
        stepId: 's-history-step-1',
        sessionId: 's-history',
        index: 1,
        artifactRefs: ['', 'history://chosen', 'history://ignored'],
      });
      insertSnapshot(snapshotRepo, {
        snapshotId: 's-history-snap',
        stepId: 's-history-step-1',
        pageRole: 'issues_list',
        capturedAt: '2026-04-20T00:00:01.500Z',
      });

      aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      expect(rows[0].stepSequence[0].historyRef).toBe('history://chosen');
    } finally {
      close();
    }
  });
});
