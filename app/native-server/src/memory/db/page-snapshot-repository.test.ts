import { openMemoryDb } from './client';
import { PageSnapshotRepository, type PageSnapshot } from './page-snapshot-repository';
import { SessionRepository } from './session-repository';
import { StepRepository } from './step-repository';
import { TaskRepository } from './task-repository';

function bootstrap(): {
  repo: PageSnapshotRepository;
  close: () => void;
} {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const stepRepo = new StepRepository(db);
  const repo = new PageSnapshotRepository(db);

  taskRepo.insert({
    taskId: 'task-parent',
    taskType: 'tool-call',
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
  stepRepo.insert({
    stepId: 'step-parent',
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
  });

  return { repo, close: () => db.close() };
}

function sample(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    snapshotId: 'snap-1',
    stepId: 'step-parent',
    tabId: 42,
    url: 'https://github.com/openclaw/openclaw/actions/runs/123',
    title: 'Run · openclaw/openclaw',
    pageType: 'web_page',
    mode: 'normal',
    pageRole: 'workflow_run_detail',
    primaryRegion: 'main',
    quality: 'usable',
    taskMode: 'read',
    complexityLevel: 'medium',
    sourceKind: 'dom_semantic',
    fallbackUsed: false,
    interactiveCount: 17,
    candidateActionCount: 3,
    highValueObjectCount: 5,
    summaryBlob: '{"pageRole":"workflow_run_detail"}',
    pageContextBlob: null,
    highValueObjectsBlob: '[{"id":"hv-1","objectType":"status_item"}]',
    interactiveElementsBlob: null,
    candidateActionsBlob: null,
    protocolL0Blob: null,
    protocolL1Blob: null,
    protocolL2Blob: null,
    capturedAt: '2026-04-20T00:00:10.000Z',
    ...overrides,
  };
}

describe('PageSnapshotRepository', () => {
  it('round-trips the full stable + blob column set', () => {
    const { repo, close } = bootstrap();
    try {
      repo.insert(sample());
      const fetched = repo.get('snap-1');
      expect(fetched).toBeDefined();
      expect(fetched!.tabId).toBe(42);
      expect(fetched!.pageRole).toBe('workflow_run_detail');
      expect(fetched!.fallbackUsed).toBe(false);
      expect(fetched!.highValueObjectCount).toBe(5);
      expect(fetched!.highValueObjectsBlob).toContain('status_item');
    } finally {
      close();
    }
  });

  it('listByStep returns snapshots in captured_at order', () => {
    const { repo, close } = bootstrap();
    try {
      repo.insert(sample({ snapshotId: 'snap-c', capturedAt: '2026-04-20T00:00:30.000Z' }));
      repo.insert(sample({ snapshotId: 'snap-a', capturedAt: '2026-04-20T00:00:10.000Z' }));
      repo.insert(sample({ snapshotId: 'snap-b', capturedAt: '2026-04-20T00:00:20.000Z' }));
      const listed = repo.listByStep('step-parent');
      expect(listed.map((s) => s.snapshotId)).toEqual(['snap-a', 'snap-b', 'snap-c']);
    } finally {
      close();
    }
  });

  it('enforces step_id foreign key', () => {
    const { repo, close } = bootstrap();
    try {
      expect(() => repo.insert(sample({ snapshotId: 'orphan', stepId: 'missing-step' }))).toThrow(
        /FOREIGN KEY/i,
      );
    } finally {
      close();
    }
  });

  it('clear() wipes all rows', () => {
    const { repo, close } = bootstrap();
    try {
      repo.insert(sample());
      repo.clear();
      expect(repo.get('snap-1')).toBeUndefined();
      expect(repo.listByStep('step-parent')).toEqual([]);
    } finally {
      close();
    }
  });
});

describe('PageSnapshotRepository.findLatestInSessionForTab', () => {
  function multiSessionBootstrap() {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const taskRepo = new TaskRepository(db);
    const sessionRepo = new SessionRepository(db);
    const stepRepo = new StepRepository(db);
    const repo = new PageSnapshotRepository(db);

    taskRepo.insert({
      taskId: 'task-a',
      taskType: 't',
      title: 't',
      intent: 'i',
      origin: 'jest',
      labels: [],
      status: 'running',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    });
    for (const s of [
      { sessionId: 'sess-A', startedAt: '2026-04-20T00:00:01.000Z' },
      { sessionId: 'sess-B', startedAt: '2026-04-20T00:00:02.000Z' },
    ]) {
      sessionRepo.insert({
        sessionId: s.sessionId,
        taskId: 'task-a',
        transport: 'stdio',
        clientName: 'jest',
        status: 'running',
        startedAt: s.startedAt,
        steps: [],
      });
    }
    for (const st of [
      { stepId: 'step-A1', sessionId: 'sess-A', index: 1 },
      { stepId: 'step-B1', sessionId: 'sess-B', index: 1 },
    ]) {
      stepRepo.insert({
        stepId: st.stepId,
        sessionId: st.sessionId,
        index: st.index,
        toolName: 'chrome_read_page',
        stepType: 'tool_call',
        status: 'running',
        inputSummary: undefined,
        resultSummary: undefined,
        errorCode: undefined,
        errorSummary: undefined,
        artifactRefs: [],
        startedAt: '2026-04-20T00:00:05.000Z',
      });
    }
    return { repo, close: () => db.close() };
  }

  function snap(
    stepId: string,
    snapshotId: string,
    tabId: number,
    capturedAt: string,
  ): PageSnapshot {
    return {
      snapshotId,
      stepId,
      tabId,
      url: null,
      title: null,
      pageType: null,
      mode: null,
      pageRole: null,
      primaryRegion: null,
      quality: null,
      taskMode: null,
      complexityLevel: null,
      sourceKind: null,
      fallbackUsed: false,
      interactiveCount: 0,
      candidateActionCount: 0,
      highValueObjectCount: 0,
      summaryBlob: null,
      pageContextBlob: null,
      highValueObjectsBlob: null,
      interactiveElementsBlob: null,
      candidateActionsBlob: null,
      protocolL0Blob: null,
      protocolL1Blob: null,
      protocolL2Blob: null,
      capturedAt,
    };
  }

  it('returns the latest snapshot for the session+tab before the cutoff', () => {
    const { repo, close } = multiSessionBootstrap();
    try {
      repo.insert(snap('step-A1', 'a-old', 7, '2026-04-20T00:00:10.000Z'));
      repo.insert(snap('step-A1', 'a-mid', 7, '2026-04-20T00:00:20.000Z'));
      repo.insert(snap('step-A1', 'a-new', 7, '2026-04-20T00:00:30.000Z'));

      const got = repo.findLatestInSessionForTab({
        sessionId: 'sess-A',
        tabId: 7,
        beforeIso: '2026-04-20T00:00:25.000Z',
      });
      expect(got?.snapshotId).toBe('a-mid');
    } finally {
      close();
    }
  });

  it('excludes snapshots from other sessions', () => {
    const { repo, close } = multiSessionBootstrap();
    try {
      repo.insert(snap('step-A1', 'a-1', 7, '2026-04-20T00:00:10.000Z'));
      repo.insert(snap('step-B1', 'b-1', 7, '2026-04-20T00:00:20.000Z'));

      const got = repo.findLatestInSessionForTab({
        sessionId: 'sess-A',
        tabId: 7,
        beforeIso: '2026-04-20T00:00:30.000Z',
      });
      expect(got?.snapshotId).toBe('a-1');
    } finally {
      close();
    }
  });

  it('returns undefined when no snapshot matches', () => {
    const { repo, close } = multiSessionBootstrap();
    try {
      repo.insert(snap('step-A1', 'a-1', 99, '2026-04-20T00:00:10.000Z'));
      const got = repo.findLatestInSessionForTab({
        sessionId: 'sess-A',
        tabId: 7,
        beforeIso: '2026-04-20T00:00:30.000Z',
      });
      expect(got).toBeUndefined();
    } finally {
      close();
    }
  });
});
