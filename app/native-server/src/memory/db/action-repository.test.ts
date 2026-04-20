import { openMemoryDb } from './client';
import { ActionRepository, type MemoryAction } from './action-repository';
import { PageSnapshotRepository } from './page-snapshot-repository';
import { SessionRepository } from './session-repository';
import { StepRepository } from './step-repository';
import { TaskRepository } from './task-repository';

function bootstrap(): {
  actionRepo: ActionRepository;
  snapshotRepo: PageSnapshotRepository;
  stepRepo: StepRepository;
  close: () => void;
} {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const stepRepo = new StepRepository(db);
  const snapshotRepo = new PageSnapshotRepository(db);
  const actionRepo = new ActionRepository(db);

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
  stepRepo.insert({
    stepId: 'step-1',
    sessionId: 'session-parent',
    index: 1,
    toolName: 'chrome_click_element',
    stepType: 'tool_call',
    status: 'running',
    inputSummary: undefined,
    resultSummary: undefined,
    errorCode: undefined,
    errorSummary: undefined,
    artifactRefs: [],
    startedAt: '2026-04-20T00:00:02.000Z',
  });

  return { actionRepo, snapshotRepo, stepRepo, close: () => db.close() };
}

function action(overrides: Partial<MemoryAction> = {}): MemoryAction {
  return {
    actionId: overrides.actionId ?? 'act-1',
    stepId: 'step-1',
    sessionId: 'session-parent',
    toolName: 'chrome_click_element',
    actionKind: 'click',
    navigateMode: null,
    tabId: 7,
    windowId: null,
    targetRef: 'e1',
    targetSelector: null,
    targetFrameId: null,
    urlRequested: null,
    urlBefore: null,
    urlAfter: null,
    keySpec: null,
    valueSummary: null,
    status: 'success',
    errorCode: null,
    preSnapshotRef: null,
    argsBlob: '{"tabId":7,"ref":"e1"}',
    resultBlob: '{"message":"clicked"}',
    capturedAt: '2026-04-20T00:00:03.000Z',
    ...overrides,
  };
}

describe('ActionRepository', () => {
  it('round-trips an action row with stable + blob columns preserved', () => {
    const { actionRepo, close } = bootstrap();
    try {
      actionRepo.insert(action());
      const got = actionRepo.get('act-1');
      expect(got).toBeDefined();
      expect(got?.toolName).toBe('chrome_click_element');
      expect(got?.actionKind).toBe('click');
      expect(got?.tabId).toBe(7);
      expect(got?.argsBlob).toBe('{"tabId":7,"ref":"e1"}');
      expect(got?.resultBlob).toBe('{"message":"clicked"}');
    } finally {
      close();
    }
  });

  it('listBySession / listByStep return rows ordered by captured_at', () => {
    const { actionRepo, close } = bootstrap();
    try {
      actionRepo.insert(action({ actionId: 'a', capturedAt: '2026-04-20T00:00:05.000Z' }));
      actionRepo.insert(action({ actionId: 'b', capturedAt: '2026-04-20T00:00:03.000Z' }));
      actionRepo.insert(action({ actionId: 'c', capturedAt: '2026-04-20T00:00:04.000Z' }));
      expect(actionRepo.listBySession('session-parent').map((r) => r.actionId)).toEqual([
        'b',
        'c',
        'a',
      ]);
      expect(actionRepo.listByStep('step-1').map((r) => r.actionId)).toEqual(['b', 'c', 'a']);
    } finally {
      close();
    }
  });

  it('cascades on step deletion (FK ON DELETE CASCADE)', () => {
    const { actionRepo, stepRepo, close } = bootstrap();
    try {
      actionRepo.insert(action());
      expect(actionRepo.get('act-1')).toBeDefined();
      // Simulate clearing the owning step (via repo.clear() or session-level wipe).
      stepRepo.clear();
      expect(actionRepo.get('act-1')).toBeUndefined();
    } finally {
      close();
    }
  });

  it('clear() empties the table', () => {
    const { actionRepo, close } = bootstrap();
    try {
      actionRepo.insert(action({ actionId: 'x' }));
      actionRepo.insert(action({ actionId: 'y', capturedAt: '2026-04-20T00:00:04.000Z' }));
      actionRepo.clear();
      expect(actionRepo.listBySession('session-parent')).toHaveLength(0);
    } finally {
      close();
    }
  });
});
