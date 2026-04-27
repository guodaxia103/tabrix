import { openMemoryDb } from './client';
import {
  OperationMemoryLogRepository,
  type OperationMemoryLogInsert,
} from './operation-memory-log-repository';
import {
  NOT_APPLICABLE,
  OPERATION_LOG_BLOB_SCHEMA_VERSION,
  makeOperationLogMetadataDefaults,
} from './operation-log-metadata';
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

  describe('V26-FIX-07 — structured operation-log metadata', () => {
    it('persists a complete metadata envelope when none is provided', () => {
      const { repo, close } = bootstrap();
      try {
        const inserted = repo.insert(logFixture({ tabHygiene: undefined }));
        expect(inserted.metadata).toEqual(makeOperationLogMetadataDefaults());
        expect(inserted.metadata.decisionReason).toBe(NOT_APPLICABLE);
        expect(inserted.metadata.routerDecision).toBe(NOT_APPLICABLE);
        expect(inserted.metadata.fallbackPlan).toBe(NOT_APPLICABLE);
        expect(inserted.metadata.apiTelemetry).toBe(NOT_APPLICABLE);
      } finally {
        close();
      }
    });

    it('round-trips a partial metadata block and fills the rest with not_applicable', () => {
      const { repo, close } = bootstrap();
      try {
        const inserted = repo.insert(
          logFixture({
            metadata: {
              decisionReason: 'api_knowledge_high_confidence',
              routerDecision: 'api_rows',
              confidence: '0.92',
              apiTelemetry: 'http_200_compact',
            },
          }),
        );
        expect(inserted.metadata).toEqual({
          ...makeOperationLogMetadataDefaults(),
          decisionReason: 'api_knowledge_high_confidence',
          routerDecision: 'api_rows',
          confidence: '0.92',
          apiTelemetry: 'http_200_compact',
        });
        const fromDb = repo.listBySession('session-1')[0];
        expect(fromDb.metadata).toEqual(inserted.metadata);
      } finally {
        close();
      }
    });

    it('coerces empty / whitespace metadata values to not_applicable', () => {
      const { repo, close } = bootstrap();
      try {
        const inserted = repo.insert(
          logFixture({
            metadata: {
              decisionReason: '',
              routerDecision: '   ',
              confidence: 'high',
            },
          }),
        );
        expect(inserted.metadata.decisionReason).toBe(NOT_APPLICABLE);
        expect(inserted.metadata.routerDecision).toBe(NOT_APPLICABLE);
        expect(inserted.metadata.confidence).toBe('high');
      } finally {
        close();
      }
    });

    it('serialises tabHygiene + metadata under the schema-v2 wrapper', () => {
      const { repo, close } = bootstrap();
      try {
        const inserted = repo.insert(
          logFixture({
            metadata: { decisionReason: 'router_fail_safe_dom_compact' },
          }),
        );
        const raw = (
          (
            repo as unknown as {
              db: { prepare: (sql: string) => { get: (id: string) => unknown } };
            }
          ).db
            ? (
                repo as unknown as {
                  db: { prepare: (sql: string) => { get: (id: string) => unknown } };
                }
              ).db
                .prepare(
                  'SELECT tab_hygiene_blob FROM operation_memory_logs WHERE operation_log_id = ?',
                )
                .get(inserted.operationLogId)
            : null
        ) as { tab_hygiene_blob: string } | null;
        // Repo intentionally hides its db handle; if we cannot peek
        // (test rig isolation), at least round-trip the read path
        // and assert the structured envelope is stable.
        const fromDb = repo.listBySession('session-1')[0];
        expect(fromDb.metadata.decisionReason).toBe('router_fail_safe_dom_compact');
        if (raw && typeof raw.tab_hygiene_blob === 'string') {
          const parsed = JSON.parse(raw.tab_hygiene_blob);
          expect(parsed.schemaVersion).toBe(OPERATION_LOG_BLOB_SCHEMA_VERSION);
          expect(parsed.metadata.decisionReason).toBe('router_fail_safe_dom_compact');
        }
      } finally {
        close();
      }
    });

    it('reads legacy raw-blob rows and surfaces metadata defaults', () => {
      const { repo, close } = bootstrap();
      try {
        // Inject a legacy blob shape directly (pre-FIX-07 writers
        // stored the raw `tabHygiene` object, no schemaVersion
        // wrapper). Use the underlying db handle exposed via the
        // private field — TypeScript `private` is compile-time only
        // so the property still exists at runtime.
        const dbHandle = (repo as unknown as { db: unknown }).db as {
          prepare: (sql: string) => { run: (...args: unknown[]) => void };
        };
        // INSERT OR REPLACE on the legacy row, replacing the
        // step-1 slot (UNIQUE(step_id) constraint).
        dbHandle
          .prepare(
            `INSERT OR REPLACE INTO operation_memory_logs
              (operation_log_id, task_id, session_id, step_id, tool_name,
               url_pattern, page_role, requested_layer, selected_data_source,
               source_route, decision_reason, result_kind, duration_ms, success,
               fallback_used, error_code, read_count, tokens_saved, tab_hygiene_blob, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'op-legacy',
            'task-1',
            'session-1',
            'step-1',
            'chrome_read_page',
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            1,
            null,
            null,
            null,
            null,
            JSON.stringify({ primaryTabReuseRate: 1 }),
            '2026-04-26T00:00:09.000Z',
          );
        const fromDb = repo.listBySession('session-1');
        const legacy = fromDb.find((row) => row.operationLogId === 'op-legacy');
        expect(legacy).toBeDefined();
        expect(legacy!.tabHygiene).toEqual({ primaryTabReuseRate: 1 });
        expect(legacy!.metadata).toEqual(makeOperationLogMetadataDefaults());
      } finally {
        close();
      }
    });
  });
});
