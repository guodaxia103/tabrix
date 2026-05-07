import { openMemoryDb } from './db/client';
import { PageSnapshotRepository } from './db/page-snapshot-repository';
import { SessionRepository } from './db/session-repository';
import { StepRepository } from './db/step-repository';
import { TaskRepository } from './db/task-repository';
import {
  PageSnapshotService,
  buildHistoryRef,
  buildSnapshotFromReadPageBody,
} from './page-snapshot-service';
import { logger } from '../logging/logger';

function bootstrap(): {
  service: PageSnapshotService;
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

  return { service: new PageSnapshotService(repo), repo, close: () => db.close() };
}

const fakeReadPageBody = {
  mode: 'normal',
  page: {
    url: 'https://github.com/openclaw/openclaw/actions/runs/123',
    title: 'Run · openclaw/openclaw',
    pageType: 'web_page',
  },
  summary: {
    pageRole: 'workflow_run_detail',
    primaryRegion: 'main',
    quality: 'usable',
    primaryRegionConfidence: 'medium',
  },
  taskMode: 'read',
  complexityLevel: 'medium',
  sourceKind: 'dom_semantic',
  interactiveElements: Array.from({ length: 30 }, (_, idx) => ({
    ref: `e${idx}`,
    role: 'button',
    name: `Button ${idx}`,
  })),
  artifactRefs: [{ kind: 'dom_snapshot', ref: 'artifact://read_page/7/123' }],
  candidateActions: [
    { id: 'ca-1', actionType: 'click', targetRef: 'e1', confidence: 0.9, matchReason: 'x' },
  ],
  pageContext: {
    filter: 'default',
    depth: 3,
    focus: null,
    scheme: 'https',
    viewport: { width: 1280, height: 800, dpr: 1 },
    sparse: false,
    fallbackUsed: false,
    fallbackSource: null,
    refMapCount: 42,
    markedElementsCount: 0,
  },
  highValueObjects: [
    {
      id: 'hv-1',
      kind: 'candidate_action',
      label: 'Security and quality',
      ref: 'e2',
      objectType: 'nav_entry',
      objectSubType: 'github.tab.security',
      region: 'tabs',
      importance: 0.8,
      reasons: ['aria-selected', 'label match'],
      sourceKind: 'dom_semantic',
    },
  ],
  L0: {
    summary: 's',
    taskMode: 'read',
    pageRole: 'workflow_run_detail',
    primaryRegion: 'main',
    focusObjectIds: ['hv-1'],
  },
  L1: { overview: 'o', highValueObjectIds: ['hv-1'], candidateActionIds: ['ca-1'] },
  L2: {
    available: true,
    defaultAccess: 'artifact_ref',
    detailRefs: [],
    expansions: [],
    boundary: 'x',
  },
  historyRef: null,
  memoryHints: [],
};

function wrap(body: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(body) }] };
}

describe('buildSnapshotFromReadPageBody', () => {
  it('extracts stable columns and slims blobs', () => {
    const snap = buildSnapshotFromReadPageBody('step-parent', fakeReadPageBody as any, {
      tabId: 7,
      nowIso: '2026-04-20T00:00:10.000Z',
    });
    expect(snap.tabId).toBe(7);
    expect(snap.pageRole).toBe('workflow_run_detail');
    expect(snap.mode).toBe('normal');
    expect(snap.quality).toBe('usable');
    expect(snap.taskMode).toBe('read');
    expect(snap.interactiveCount).toBe(30);
    expect(snap.highValueObjectCount).toBe(1);
    expect(snap.candidateActionCount).toBe(1);
    expect(snap.fallbackUsed).toBe(false);
    expect(snap.capturedAt).toBe('2026-04-20T00:00:10.000Z');

    const parsedInteractive = JSON.parse(snap.interactiveElementsBlob!);
    expect(parsedInteractive).toHaveLength(24);

    const parsedHvo = JSON.parse(snap.highValueObjectsBlob!);
    expect(parsedHvo[0]).toMatchObject({
      id: 'hv-1',
      objectType: 'nav_entry',
      objectSubType: 'github.tab.security',
      region: 'tabs',
    });
    expect(parsedHvo[0].reasons).toBeUndefined();
  });
});

describe('PageSnapshotService.recordFromReadPageResult', () => {
  it('persists a snapshot and returns a memory:// historyRef', () => {
    const { service, repo, close } = bootstrap();
    try {
      const result = service.recordFromReadPageResult({
        stepId: 'step-parent',
        tabId: 7,
        rawResult: wrap(fakeReadPageBody),
      });
      expect(result).not.toBeNull();
      expect(result!.historyRef).toBe(buildHistoryRef(result!.snapshotId));
      const stored = repo.get(result!.snapshotId);
      expect(stored).toBeDefined();
      expect(stored!.pageRole).toBe('workflow_run_detail');
      expect(stored!.tabId).toBe(7);
    } finally {
      close();
    }
  });

  it('returns null when the content body is not JSON', () => {
    const { service, close } = bootstrap();
    try {
      const result = service.recordFromReadPageResult({
        stepId: 'step-parent',
        rawResult: { content: [{ type: 'text', text: 'not json' }] },
      });
      expect(result).toBeNull();
    } finally {
      close();
    }
  });

  it('returns null when content is missing', () => {
    const { service, close } = bootstrap();
    try {
      const result = service.recordFromReadPageResult({
        stepId: 'step-parent',
        rawResult: {},
      });
      expect(result).toBeNull();
    } finally {
      close();
    }
  });

  it('returns null (and does not throw) when repo write fails', () => {
    const { service, close } = bootstrap();
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const result = service.recordFromReadPageResult({
        stepId: 'non-existent-step',
        rawResult: wrap(fakeReadPageBody),
      });
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('memory', 'page snapshot write failed', {
        errorMessage: expect.stringContaining('FOREIGN KEY constraint failed'),
      });
    } finally {
      warnSpy.mockRestore();
      close();
    }
  });
});
