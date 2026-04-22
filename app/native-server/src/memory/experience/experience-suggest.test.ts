import { openMemoryDb } from '../db/client';
import { PageSnapshotRepository, SessionRepository, StepRepository, TaskRepository } from '../db';
import type { ExecutionSession, ExecutionStep, Task } from '../../execution/types';
import {
  ExperienceAggregator,
  ExperienceRepository,
  ExperienceSuggestPlanInputError,
  buildSuggestPlanResult,
  parseExperienceSuggestPlanInput,
} from './index';

describe('parseExperienceSuggestPlanInput (B-013)', () => {
  it('rejects missing args', () => {
    expect(() => parseExperienceSuggestPlanInput(undefined)).toThrow(
      ExperienceSuggestPlanInputError,
    );
    expect(() => parseExperienceSuggestPlanInput(null)).toThrow(ExperienceSuggestPlanInputError);
  });

  it('rejects non-object args', () => {
    expect(() => parseExperienceSuggestPlanInput('hi')).toThrow(ExperienceSuggestPlanInputError);
    expect(() => parseExperienceSuggestPlanInput(['intent'])).toThrow(
      ExperienceSuggestPlanInputError,
    );
  });

  it('requires non-empty intent', () => {
    expect(() => parseExperienceSuggestPlanInput({})).toThrow(/intent.*required/i);
    expect(() => parseExperienceSuggestPlanInput({ intent: '' })).toThrow(/intent/i);
    expect(() => parseExperienceSuggestPlanInput({ intent: '   ' })).toThrow(/intent/i);
  });

  it('rejects wrong types for intent / pageRole / limit', () => {
    expect(() => parseExperienceSuggestPlanInput({ intent: 123 })).toThrow(/string/);
    expect(() => parseExperienceSuggestPlanInput({ intent: 'open issues', pageRole: 7 })).toThrow(
      /string/,
    );
    expect(() => parseExperienceSuggestPlanInput({ intent: 'open issues', limit: '3' })).toThrow(
      /number/,
    );
    expect(() => parseExperienceSuggestPlanInput({ intent: 'open issues', limit: 1.5 })).toThrow(
      /integer/,
    );
    expect(() =>
      parseExperienceSuggestPlanInput({ intent: 'open issues', limit: Number.NaN }),
    ).toThrow(/finite/);
  });

  it('normalizes intent identically to the aggregator (whitespace + case)', () => {
    const a = parseExperienceSuggestPlanInput({ intent: '  Open   Issues  ' });
    const b = parseExperienceSuggestPlanInput({ intent: 'open issues' });
    expect(a.intentSignature).toBe('open issues');
    expect(b.intentSignature).toBe('open issues');
  });

  it('truncates long intent before normalization to keep the bucket stable', () => {
    const longIntent = 'open issues '.repeat(200);
    const parsed = parseExperienceSuggestPlanInput({ intent: longIntent });
    expect(parsed.intent.length).toBeLessThanOrEqual(1024);
    // Normalization still collapses whitespace, so signature is bounded too.
    expect(parsed.intentSignature.length).toBeLessThanOrEqual(1024);
  });

  it('treats blank pageRole as "no filter"', () => {
    const parsed = parseExperienceSuggestPlanInput({
      intent: 'open issues',
      pageRole: '   ',
    });
    expect(parsed.pageRole).toBeUndefined();
  });

  it('rejects pageRole longer than the cap', () => {
    expect(() =>
      parseExperienceSuggestPlanInput({
        intent: 'open issues',
        pageRole: 'r'.repeat(200),
      }),
    ).toThrow(/pageRole.*128/);
  });

  it('clamps limit to [1, 5] and defaults to 1', () => {
    expect(parseExperienceSuggestPlanInput({ intent: 'i' }).limit).toBe(1);
    expect(parseExperienceSuggestPlanInput({ intent: 'i', limit: 0 }).limit).toBe(1);
    expect(parseExperienceSuggestPlanInput({ intent: 'i', limit: -3 }).limit).toBe(1);
    expect(parseExperienceSuggestPlanInput({ intent: 'i', limit: 5 }).limit).toBe(5);
    expect(parseExperienceSuggestPlanInput({ intent: 'i', limit: 99 }).limit).toBe(5);
  });
});

describe('buildSuggestPlanResult (B-013, pure)', () => {
  it('emits no_match for empty rows', () => {
    const result = buildSuggestPlanResult([], 'disk');
    expect(result).toEqual({
      status: 'no_match',
      plans: [],
      persistenceMode: 'disk',
    });
  });

  it('computes successRate and projects step shape from rows', () => {
    const result = buildSuggestPlanResult(
      [
        {
          actionPathId: 'ap-1',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [
            { toolName: 'chrome_click_element', status: 'completed', historyRef: 'h://a' },
            { toolName: 'chrome_read_page', status: 'completed', historyRef: null },
          ],
          successCount: 3,
          failureCount: 1,
          lastUsedAt: '2026-04-21T10:00:00.000Z',
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-21T10:00:00.000Z',
        },
      ],
      'disk',
    );
    expect(result.status).toBe('ok');
    expect(result.persistenceMode).toBe('disk');
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      actionPathId: 'ap-1',
      pageRole: 'repo_home',
      intentSignature: 'open issues',
      successCount: 3,
      failureCount: 1,
      lastUsedAt: '2026-04-21T10:00:00.000Z',
      steps: [
        { toolName: 'chrome_click_element', status: 'completed', historyRef: 'h://a' },
        { toolName: 'chrome_read_page', status: 'completed', historyRef: null },
      ],
    });
    expect(result.plans[0].successRate).toBeCloseTo(0.75, 5);
  });

  it('reports successRate=0 (not NaN) when both counters are zero', () => {
    const result = buildSuggestPlanResult(
      [
        {
          actionPathId: 'ap-empty',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [],
          successCount: 0,
          failureCount: 0,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
      ],
      'memory',
    );
    expect(result.plans[0].successRate).toBe(0);
    expect(result.persistenceMode).toBe('memory');
  });
});

describe('ExperienceRepository.suggestActionPaths (B-013, SQL)', () => {
  function bootstrap() {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new ExperienceRepository(db);
    return { db, repo, close: () => db.close() };
  }

  function seed(
    repo: ExperienceRepository,
    overrides: Partial<{
      actionPathId: string;
      pageRole: string;
      intentSignature: string;
      successDelta: number;
      failureDelta: number;
      lastUsedAt: string;
      stepSequence: { toolName: string; status: string; historyRef: string | null }[];
    }>,
  ) {
    repo.upsertActionPath({
      actionPathId: overrides.actionPathId ?? 'ap-x',
      pageRole: overrides.pageRole ?? 'repo_home',
      intentSignature: overrides.intentSignature ?? 'open issues',
      stepSequence: overrides.stepSequence ?? [
        { toolName: 'chrome_click_element', status: 'completed', historyRef: 'h://a' },
      ],
      successDelta: overrides.successDelta ?? 1,
      failureDelta: overrides.failureDelta ?? 0,
      lastUsedAt: overrides.lastUsedAt ?? '2026-04-20T00:00:00.000Z',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    });
  }

  it('returns [] when no row matches the intent signature', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, { intentSignature: 'open issues' });
      const rows = repo.suggestActionPaths({
        intentSignature: 'something else',
        limit: 1,
      });
      expect(rows).toEqual([]);
    } finally {
      close();
    }
  });

  it('returns the matching row(s) ordered by success_count DESC', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-low',
        pageRole: 'repo_home',
        successDelta: 1,
        failureDelta: 4,
        lastUsedAt: '2026-04-20T01:00:00.000Z',
      });
      seed(repo, {
        actionPathId: 'ap-high',
        pageRole: 'issues_list',
        successDelta: 5,
        failureDelta: 0,
        lastUsedAt: '2026-04-20T02:00:00.000Z',
      });

      const rows = repo.suggestActionPaths({
        intentSignature: 'open issues',
        limit: 5,
      });
      expect(rows.map((r) => r.actionPathId)).toEqual(['ap-high', 'ap-low']);
    } finally {
      close();
    }
  });

  it('respects pageRole filter and never returns rows from other roles', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-repo',
        pageRole: 'repo_home',
        successDelta: 10,
      });
      seed(repo, {
        actionPathId: 'ap-issues',
        pageRole: 'issues_list',
        successDelta: 1,
      });

      const onlyIssues = repo.suggestActionPaths({
        intentSignature: 'open issues',
        pageRole: 'issues_list',
        limit: 5,
      });
      expect(onlyIssues.map((r) => r.actionPathId)).toEqual(['ap-issues']);
    } finally {
      close();
    }
  });

  it('clamps limit to >= 1 even when caller passes 0 or negative', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, { actionPathId: 'ap-only', successDelta: 1 });
      const zero = repo.suggestActionPaths({
        intentSignature: 'open issues',
        limit: 0,
      });
      expect(zero).toHaveLength(1);
      const negative = repo.suggestActionPaths({
        intentSignature: 'open issues',
        limit: -10,
      });
      expect(negative).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('breaks ties on last_used_at DESC then action_path_id ASC', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-old',
        successDelta: 2,
        failureDelta: 0,
        lastUsedAt: '2026-04-19T00:00:00.000Z',
      });
      seed(repo, {
        actionPathId: 'ap-new',
        successDelta: 2,
        failureDelta: 0,
        lastUsedAt: '2026-04-21T00:00:00.000Z',
      });
      const rows = repo.suggestActionPaths({
        intentSignature: 'open issues',
        limit: 5,
      });
      expect(rows.map((r) => r.actionPathId)).toEqual(['ap-new', 'ap-old']);
    } finally {
      close();
    }
  });
});

describe('ExperienceRepository.suggestActionPaths · V24-01 replay-session sanity', () => {
  // Sanity check: after the aggregator's brief §7 special-case folds
  // a replay session into the original row, suggest reads back the
  // compounded counters (no behavior change in suggest itself).
  function bootstrap() {
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
    return { db, taskRepo, sessionRepo, stepRepo, snapshotRepo, experienceRepo, aggregator };
  }

  function insTask(repo: TaskRepository, overrides: Partial<Task>): void {
    repo.insert({
      taskId: overrides.taskId!,
      taskType: 'browser-action',
      title: 'task',
      intent: overrides.intent ?? 'task intent',
      origin: 'jest',
      labels: [],
      status: 'completed',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    });
  }

  function insSession(
    repo: SessionRepository,
    overrides: Partial<ExecutionSession> & { sessionId: string; taskId: string },
  ): void {
    repo.insert({
      sessionId: overrides.sessionId,
      taskId: overrides.taskId,
      transport: 'stdio',
      clientName: 'jest',
      startedAt: overrides.startedAt ?? '2026-04-20T00:00:01.000Z',
      endedAt: overrides.endedAt ?? '2026-04-20T00:00:02.000Z',
      status: overrides.status ?? 'completed',
      steps: [],
    });
  }

  function insStep(
    repo: StepRepository,
    overrides: Partial<ExecutionStep> & { stepId: string; sessionId: string },
  ): void {
    repo.insert({
      stepId: overrides.stepId,
      sessionId: overrides.sessionId,
      index: overrides.index ?? 1,
      toolName: overrides.toolName ?? 'chrome_click_element',
      stepType: 'tool_call',
      status: overrides.status ?? 'completed',
      startedAt: '2026-04-20T00:00:01.100Z',
      endedAt: '2026-04-20T00:00:01.200Z',
      artifactRefs: overrides.artifactRefs ?? [],
    });
  }

  it('suggest returns compounded successCount after a successful replay session is aggregated', () => {
    const { db, taskRepo, sessionRepo, stepRepo, snapshotRepo, aggregator, experienceRepo } =
      bootstrap();
    try {
      // 1. Seed an original session → aggregator creates a row with
      //    successCount=1.
      insTask(taskRepo, { taskId: 't-orig', intent: 'open issues' });
      insSession(sessionRepo, { sessionId: 'orig', taskId: 't-orig', status: 'completed' });
      insStep(stepRepo, { stepId: 'orig-1', sessionId: 'orig', index: 1 });
      snapshotRepo.insert({
        snapshotId: 'orig-snap',
        stepId: 'orig-1',
        pageRole: 'issues_list',
        fallbackUsed: false,
        interactiveCount: 0,
        candidateActionCount: 0,
        highValueObjectCount: 0,
        capturedAt: '2026-04-20T00:00:01.500Z',
      });
      aggregator.projectPendingSessions('2026-04-21T00:00:00.000Z');

      const initial = experienceRepo.suggestActionPaths({
        intentSignature: 'open issues',
        pageRole: 'issues_list',
        limit: 1,
      });
      expect(initial).toHaveLength(1);
      expect(initial[0].successCount).toBe(1);
      const original = initial[0];

      // 2. Replay session referencing original.actionPathId.
      insTask(taskRepo, {
        taskId: 't-replay',
        intent: `experience_replay:${original.actionPathId}`,
      });
      insSession(sessionRepo, {
        sessionId: 'replay',
        taskId: 't-replay',
        status: 'completed',
        startedAt: '2026-04-22T00:00:01.000Z',
        endedAt: '2026-04-22T00:00:02.000Z',
      });
      insStep(stepRepo, { stepId: 'replay-1', sessionId: 'replay', index: 1 });
      aggregator.projectPendingSessions('2026-04-22T00:00:03.000Z');

      const after = experienceRepo.suggestActionPaths({
        intentSignature: 'open issues',
        pageRole: 'issues_list',
        limit: 1,
      });
      expect(after).toHaveLength(1);
      expect(after[0].actionPathId).toBe(original.actionPathId);
      expect(after[0].successCount).toBe(2);
      expect(after[0].failureCount).toBe(0);
      // step_sequence is preserved verbatim (brief §7).
      expect(after[0].stepSequence).toEqual(original.stepSequence);
    } finally {
      db.close();
    }
  });
});
