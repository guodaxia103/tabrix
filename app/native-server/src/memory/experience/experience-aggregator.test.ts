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

  it('C2: aborted sessions increment failure_count', () => {
    const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
      bootstrap();
    try {
      insertTask(taskRepo, { intent: 'monitor runs' });
      insertSession(sessionRepo, { sessionId: 's-aborted', status: 'aborted' });
      insertStep(stepRepo, { stepId: 'aborted-step', sessionId: 's-aborted', index: 1 });
      insertSnapshot(snapshotRepo, {
        snapshotId: 'snap-aborted',
        stepId: 'aborted-step',
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

  it('H: native read-only Experience tools are skipped (marked aggregated, not projected)', () => {
    // B-013 P1 regression: `experience_suggest_plan` produces a Memory
    // session for audit, but must not feed back into Experience itself
    // (otherwise every suggest call seeds bogus
    // `(unknown, "run mcp tool experience_suggest_plan")` buckets).
    const { db, taskRepo, sessionRepo, stepRepo, aggregator, experienceRepo, close } = bootstrap();
    try {
      insertTask(taskRepo, {
        taskId: 'task-suggest',
        intent: 'Run MCP tool experience_suggest_plan',
      });
      insertSession(sessionRepo, {
        sessionId: 's-suggest',
        taskId: 'task-suggest',
        status: 'completed',
      });
      insertStep(stepRepo, {
        stepId: 'suggest-step',
        sessionId: 's-suggest',
        index: 1,
        toolName: 'experience_suggest_plan',
      });

      // A regular Memory-touching session in the same batch must still
      // project — the exclusion is per-session, not global.
      insertTask(taskRepo, { taskId: 'task-real', intent: 'open issues' });
      insertSession(sessionRepo, {
        sessionId: 's-real',
        taskId: 'task-real',
        status: 'completed',
      });
      insertStep(stepRepo, {
        stepId: 'real-step',
        sessionId: 's-real',
        index: 1,
        toolName: 'chrome_read_page',
      });

      const result = aggregator.projectPendingSessions('2026-04-22T00:00:00.000Z');
      expect(result.scanned).toBe(2);
      expect(result.projected).toBe(1);

      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      expect(rows[0].intentSignature).toBe('open issues');
      // Make sure the polluting bucket really is absent.
      expect(rows.find((row) => row.intentSignature.includes('experience_suggest_plan'))).toBe(
        undefined,
      );

      // The skipped session must be marked so it never returns to the
      // pending-scan; otherwise we would spin on it forever.
      const marker = db
        .prepare('SELECT aggregated_at FROM memory_sessions WHERE session_id = ?')
        .get('s-suggest') as { aggregated_at: string | null } | undefined;
      expect(marker?.aggregated_at).toBe('2026-04-22T00:00:00.000Z');

      const replay = aggregator.projectPendingSessions('2026-04-22T00:01:00.000Z');
      expect(replay).toEqual({ scanned: 0, projected: 0 });
    } finally {
      close();
    }
  });

  // V24-01 (brief §7) — replay sessions compound on the original row.
  describe('V24-01: experience_replay session special-case (brief §7)', () => {
    function seedOriginalRow(
      ctx: ReturnType<typeof bootstrap>,
      opts: { intent: string; pageRole: string; sessionId?: string; toolName?: string },
    ): { actionPathId: string; pageRole: string; intentSignature: string } {
      const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo } = ctx;
      const sessionId = opts.sessionId ?? 'orig-1';
      insertTask(taskRepo, { taskId: `task-${sessionId}`, intent: opts.intent });
      insertSession(sessionRepo, {
        sessionId,
        taskId: `task-${sessionId}`,
        status: 'completed',
      });
      insertStep(stepRepo, {
        stepId: `${sessionId}-step-1`,
        sessionId,
        index: 1,
        toolName: opts.toolName ?? 'chrome_click_element',
      });
      insertSnapshot(snapshotRepo, {
        snapshotId: `${sessionId}-snap`,
        stepId: `${sessionId}-step-1`,
        pageRole: opts.pageRole,
        capturedAt: '2026-04-20T00:00:01.500Z',
      });
      aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
      const row = experienceRepo.listActionPaths().find((r) => r.pageRole === opts.pageRole);
      if (!row) throw new Error(`failed to seed original row for ${opts.pageRole}`);
      return {
        actionPathId: row.actionPathId,
        pageRole: row.pageRole,
        intentSignature: row.intentSignature,
      };
    }

    it('compounds a successful replay session onto the original row (no new bucket)', () => {
      const ctx = bootstrap();
      try {
        const { taskRepo, sessionRepo, stepRepo, aggregator, experienceRepo } = ctx;
        const seeded = seedOriginalRow(ctx, {
          intent: 'open issues',
          pageRole: 'issues_list',
        });

        const beforeRows = experienceRepo.listActionPaths();
        expect(beforeRows).toHaveLength(1);
        const before = beforeRows[0];
        expect(before.successCount).toBe(1);
        expect(before.failureCount).toBe(0);
        const originalStepSequence = before.stepSequence;

        // Replay session writes its own audit-trail step row; the
        // task.intent carries the replay-prefix so the aggregator
        // detects it.
        insertTask(taskRepo, {
          taskId: 'task-replay-ok',
          intent: `experience_replay:${seeded.actionPathId}`,
        });
        insertSession(sessionRepo, {
          sessionId: 'replay-ok-1',
          taskId: 'task-replay-ok',
          status: 'completed',
          startedAt: '2026-04-22T00:00:01.000Z',
          endedAt: '2026-04-22T00:00:02.000Z',
        });
        insertStep(stepRepo, {
          stepId: 'replay-ok-step',
          sessionId: 'replay-ok-1',
          index: 1,
          toolName: 'chrome_click_element',
          status: 'completed',
        });

        const result = aggregator.projectPendingSessions('2026-04-22T00:00:03.000Z');
        expect(result).toEqual({ scanned: 1, projected: 1 });

        const after = experienceRepo.listActionPaths();
        expect(after).toHaveLength(1);
        expect(after[0].actionPathId).toBe(seeded.actionPathId);
        expect(after[0].pageRole).toBe(seeded.pageRole);
        expect(after[0].intentSignature).toBe(seeded.intentSignature);
        expect(after[0].successCount).toBe(2);
        expect(after[0].failureCount).toBe(0);
        expect(after[0].stepSequence).toEqual(originalStepSequence);
        expect(after[0].lastUsedAt).toBe('2026-04-22T00:00:02.000Z');
      } finally {
        ctx.close();
      }
    });

    it('compounds a failed replay session onto the original row as failure_count++', () => {
      const ctx = bootstrap();
      try {
        const { taskRepo, sessionRepo, stepRepo, aggregator, experienceRepo } = ctx;
        const seeded = seedOriginalRow(ctx, {
          intent: 'fill issue title',
          pageRole: 'issue_detail',
        });

        insertTask(taskRepo, {
          taskId: 'task-replay-fail',
          intent: `experience_replay:${seeded.actionPathId}`,
        });
        insertSession(sessionRepo, {
          sessionId: 'replay-fail-1',
          taskId: 'task-replay-fail',
          status: 'failed',
          startedAt: '2026-04-22T00:01:00.000Z',
          endedAt: '2026-04-22T00:01:01.000Z',
        });
        insertStep(stepRepo, {
          stepId: 'replay-fail-step',
          sessionId: 'replay-fail-1',
          index: 1,
          toolName: 'chrome_click_element',
          status: 'failed',
        });

        const result = aggregator.projectPendingSessions('2026-04-22T00:01:02.000Z');
        expect(result).toEqual({ scanned: 1, projected: 1 });

        const after = experienceRepo.listActionPaths();
        expect(after).toHaveLength(1);
        expect(after[0].actionPathId).toBe(seeded.actionPathId);
        expect(after[0].successCount).toBe(1);
        expect(after[0].failureCount).toBe(1);
      } finally {
        ctx.close();
      }
    });

    it('marks aggregated and skips when the referenced actionPathId no longer exists (stale id)', () => {
      const ctx = bootstrap();
      try {
        const { db, taskRepo, sessionRepo, stepRepo, aggregator, experienceRepo } = ctx;

        const staleId = 'action_path_' + 'a'.repeat(64);
        insertTask(taskRepo, {
          taskId: 'task-replay-stale',
          intent: `experience_replay:${staleId}`,
        });
        insertSession(sessionRepo, {
          sessionId: 'replay-stale-1',
          taskId: 'task-replay-stale',
          status: 'completed',
        });
        insertStep(stepRepo, {
          stepId: 'replay-stale-step',
          sessionId: 'replay-stale-1',
          index: 1,
          toolName: 'chrome_click_element',
          status: 'completed',
        });

        const result = aggregator.projectPendingSessions('2026-04-22T00:02:00.000Z');
        expect(result).toEqual({ scanned: 1, projected: 0 });
        expect(experienceRepo.listActionPaths()).toEqual([]);

        const marker = db
          .prepare('SELECT aggregated_at FROM memory_sessions WHERE session_id = ?')
          .get('replay-stale-1') as { aggregated_at: string | null } | undefined;
        expect(marker?.aggregated_at).toBe('2026-04-22T00:02:00.000Z');

        const second = aggregator.projectPendingSessions('2026-04-22T00:02:01.000Z');
        expect(second).toEqual({ scanned: 0, projected: 0 });
      } finally {
        ctx.close();
      }
    });

    it("marks aggregated and skips when the intent is the 'experience_replay:invalid' sentinel", () => {
      const ctx = bootstrap();
      try {
        const { taskRepo, sessionRepo, stepRepo, aggregator, experienceRepo } = ctx;

        insertTask(taskRepo, {
          taskId: 'task-replay-invalid',
          intent: 'experience_replay:invalid',
        });
        insertSession(sessionRepo, {
          sessionId: 'replay-invalid-1',
          taskId: 'task-replay-invalid',
          status: 'failed',
        });
        // Note: invalid-input handler returns BEFORE any step runs, so
        // there are no audit-trail step rows. The aggregator must
        // tolerate that and not crash.
        const result = aggregator.projectPendingSessions('2026-04-22T00:03:00.000Z');
        expect(result).toEqual({ scanned: 1, projected: 0 });
        expect(experienceRepo.listActionPaths()).toEqual([]);

        // Add a step too, repeat: still no projection.
        insertTask(taskRepo, {
          taskId: 'task-replay-invalid-2',
          intent: 'experience_replay:invalid',
        });
        insertSession(sessionRepo, {
          sessionId: 'replay-invalid-2',
          taskId: 'task-replay-invalid-2',
          status: 'failed',
        });
        insertStep(stepRepo, {
          stepId: 'replay-invalid-2-step',
          sessionId: 'replay-invalid-2',
          index: 1,
          toolName: 'chrome_click_element',
          status: 'failed',
        });
        const second = aggregator.projectPendingSessions('2026-04-22T00:03:01.000Z');
        expect(second).toEqual({ scanned: 1, projected: 0 });
        expect(experienceRepo.listActionPaths()).toEqual([]);
      } finally {
        ctx.close();
      }
    });

    it('non-replay sessions are unaffected by the special-case', () => {
      const ctx = bootstrap();
      try {
        const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo } = ctx;
        insertTask(taskRepo, { taskId: 'task-normal', intent: 'open profile' });
        insertSession(sessionRepo, {
          sessionId: 'normal-1',
          taskId: 'task-normal',
          status: 'completed',
        });
        insertStep(stepRepo, {
          stepId: 'normal-step',
          sessionId: 'normal-1',
          index: 1,
          toolName: 'chrome_click_element',
        });
        insertSnapshot(snapshotRepo, {
          snapshotId: 'normal-snap',
          stepId: 'normal-step',
          pageRole: 'repo_home',
          capturedAt: '2026-04-22T00:04:01.000Z',
        });

        const result = aggregator.projectPendingSessions('2026-04-22T00:04:02.000Z');
        expect(result).toEqual({ scanned: 1, projected: 1 });
        const rows = experienceRepo.listActionPaths();
        expect(rows).toHaveLength(1);
        expect(rows[0].intentSignature).toBe('open profile');
      } finally {
        ctx.close();
      }
    });
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

  // ---------------------------------------------------------------------------
  // V24-01 closeout: aggregator lifts captured args from
  // `memory_steps.input_summary` onto Experience rows for the v1 replay
  // supported step kinds (`chrome_click_element` / `chrome_fill_or_select`),
  // strips session-local `tabId`, and stays a no-op for everything else.
  // This is the "real closure" half of Codex's V24-01 follow-up: without
  // this the chooser never sees a row that satisfies the args-presence
  // guard in `isReplayEligible()` and dispatch-side replay is dead in the
  // wild.
  // ---------------------------------------------------------------------------
  describe('V24-01 closeout: replay args lifted from input_summary', () => {
    it('populates args for chrome_click_element and strips session-local tabId', () => {
      const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
        bootstrap();
      try {
        insertTask(taskRepo, { intent: 'open issues' });
        insertSession(sessionRepo, { sessionId: 's-click', status: 'completed' });
        insertStep(stepRepo, {
          stepId: 's-click-step-1',
          sessionId: 's-click',
          index: 1,
          toolName: 'chrome_click_element',
          status: 'completed',
          inputSummary: JSON.stringify({ tabId: 42, selector: '#issues-tab' }),
          artifactRefs: ['history://click'],
        });
        insertSnapshot(snapshotRepo, {
          snapshotId: 'snap-click',
          stepId: 's-click-step-1',
          pageRole: 'repo_home',
          capturedAt: '2026-04-20T00:00:01.500Z',
        });

        aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
        const rows = experienceRepo.listActionPaths();
        expect(rows).toHaveLength(1);
        expect(rows[0].stepSequence).toEqual([
          {
            toolName: 'chrome_click_element',
            status: 'completed',
            historyRef: 'history://click',
            args: { selector: '#issues-tab' },
          },
        ]);
      } finally {
        close();
      }
    });

    it('populates args for chrome_fill_or_select preserving the recorded value', () => {
      const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
        bootstrap();
      try {
        insertTask(taskRepo, { intent: 'search repo' });
        insertSession(sessionRepo, { sessionId: 's-fill', status: 'completed' });
        insertStep(stepRepo, {
          stepId: 's-fill-step-1',
          sessionId: 's-fill',
          index: 1,
          toolName: 'chrome_fill_or_select',
          status: 'completed',
          inputSummary: JSON.stringify({
            tabId: 7,
            selector: '#search-input',
            value: 'tabrix',
          }),
          artifactRefs: [],
        });
        insertSnapshot(snapshotRepo, {
          snapshotId: 'snap-fill',
          stepId: 's-fill-step-1',
          pageRole: 'issues_list',
          capturedAt: '2026-04-20T00:00:01.500Z',
        });

        aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
        const rows = experienceRepo.listActionPaths();
        expect(rows).toHaveLength(1);
        expect(rows[0].stepSequence[0].args).toEqual({
          selector: '#search-input',
          value: 'tabrix',
        });
        // tabId is the only stripped key today.
        expect(rows[0].stepSequence[0].args).not.toHaveProperty('tabId');
      } finally {
        close();
      }
    });

    it('does NOT populate args for unsupported step kinds (preserves historical shape)', () => {
      const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
        bootstrap();
      try {
        insertTask(taskRepo, { intent: 'navigate' });
        insertSession(sessionRepo, { sessionId: 's-nav', status: 'completed' });
        insertStep(stepRepo, {
          stepId: 's-nav-step-1',
          sessionId: 's-nav',
          index: 1,
          // Out of v1 replay supported set:
          toolName: 'chrome_navigate',
          status: 'completed',
          inputSummary: JSON.stringify({ tabId: 1, url: 'https://github.com' }),
          artifactRefs: [],
        });
        insertSnapshot(snapshotRepo, {
          snapshotId: 'snap-nav',
          stepId: 's-nav-step-1',
          pageRole: 'repo_home',
          capturedAt: '2026-04-20T00:00:01.500Z',
        });

        aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
        const rows = experienceRepo.listActionPaths();
        expect(rows).toHaveLength(1);
        expect(rows[0].stepSequence[0]).not.toHaveProperty('args');
      } finally {
        close();
      }
    });

    it('skips args when input_summary is missing, malformed, or non-object', () => {
      const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
        bootstrap();
      try {
        insertTask(taskRepo, { intent: 'malformed inputs' });
        insertSession(sessionRepo, { sessionId: 's-malformed', status: 'completed' });
        insertStep(stepRepo, {
          stepId: 's-malformed-1',
          sessionId: 's-malformed',
          index: 1,
          toolName: 'chrome_click_element',
          status: 'completed',
          inputSummary: undefined, // missing
          artifactRefs: [],
        });
        insertStep(stepRepo, {
          stepId: 's-malformed-2',
          sessionId: 's-malformed',
          index: 2,
          toolName: 'chrome_click_element',
          status: 'completed',
          inputSummary: 'not-json',
          artifactRefs: [],
        });
        insertStep(stepRepo, {
          stepId: 's-malformed-3',
          sessionId: 's-malformed',
          index: 3,
          toolName: 'chrome_click_element',
          status: 'completed',
          inputSummary: JSON.stringify(['array', 'not', 'object']),
          artifactRefs: [],
        });
        insertSnapshot(snapshotRepo, {
          snapshotId: 'snap-malformed',
          stepId: 's-malformed-1',
          pageRole: 'repo_home',
          capturedAt: '2026-04-20T00:00:01.500Z',
        });

        aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
        const rows = experienceRepo.listActionPaths();
        expect(rows).toHaveLength(1);
        for (const step of rows[0].stepSequence) {
          expect(step).not.toHaveProperty('args');
        }
      } finally {
        close();
      }
    });

    it('skips args when stripping tabId would leave the object empty', () => {
      const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
        bootstrap();
      try {
        insertTask(taskRepo, { intent: 'tabid only' });
        insertSession(sessionRepo, { sessionId: 's-empty', status: 'completed' });
        insertStep(stepRepo, {
          stepId: 's-empty-1',
          sessionId: 's-empty',
          index: 1,
          toolName: 'chrome_click_element',
          status: 'completed',
          inputSummary: JSON.stringify({ tabId: 99 }),
          artifactRefs: [],
        });
        insertSnapshot(snapshotRepo, {
          snapshotId: 'snap-empty',
          stepId: 's-empty-1',
          pageRole: 'repo_home',
          capturedAt: '2026-04-20T00:00:01.500Z',
        });

        aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
        const rows = experienceRepo.listActionPaths();
        expect(rows).toHaveLength(1);
        expect(rows[0].stepSequence[0]).not.toHaveProperty('args');
      } finally {
        close();
      }
    });

    it('skips args when input_summary exceeds the size cap', () => {
      const { taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo, close } =
        bootstrap();
      try {
        // 9 KB > 8 KB MAX_REPLAY_ARGS_INPUT_SUMMARY_BYTES cap.
        const oversize = JSON.stringify({
          selector: '#x',
          padding: 'A'.repeat(9 * 1024),
        });
        insertTask(taskRepo, { intent: 'oversized' });
        insertSession(sessionRepo, { sessionId: 's-large', status: 'completed' });
        insertStep(stepRepo, {
          stepId: 's-large-1',
          sessionId: 's-large',
          index: 1,
          toolName: 'chrome_click_element',
          status: 'completed',
          inputSummary: oversize,
          artifactRefs: [],
        });
        insertSnapshot(snapshotRepo, {
          snapshotId: 'snap-large',
          stepId: 's-large-1',
          pageRole: 'repo_home',
          capturedAt: '2026-04-20T00:00:01.500Z',
        });

        aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');
        const rows = experienceRepo.listActionPaths();
        expect(rows).toHaveLength(1);
        expect(rows[0].stepSequence[0]).not.toHaveProperty('args');
      } finally {
        close();
      }
    });
  });
});
