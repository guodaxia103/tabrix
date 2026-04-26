import { randomUUID } from 'node:crypto';
import {
  ExecutionSession,
  ExecutionSessionStatus,
  ExecutionStep,
  ExecutionStepStatus,
  ExecutionStepType,
  Task,
} from './types';
import {
  ActionRepository,
  openMemoryDb,
  OperationMemoryLogRepository,
  PageSnapshotRepository,
  resolveMemoryDbPath,
  SessionRepository,
  StepRepository,
  TaskRepository,
  type SessionSummary,
  type SqliteDatabase,
} from '../memory/db';
import { PageSnapshotService } from '../memory/page-snapshot-service';
import { ActionService } from '../memory/action-service';
import {
  ExperienceAggregator,
  ExperienceQueryService,
  ExperienceRepository,
} from '../memory/experience';
import { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import { ChooseContextTelemetryRepository } from '../memory/telemetry/choose-context-telemetry';
import { TaskSessionContext } from './task-session-context';

export interface CreateTaskInput {
  taskType: string;
  title: string;
  intent: string;
  origin: string;
  owner?: string;
  projectId?: string;
  labels?: string[];
}

export interface StartSessionInput {
  taskId: string;
  transport: string;
  clientName: string;
  workspaceContext?: string;
  browserContext?: string;
}

export interface StartStepInput {
  sessionId: string;
  toolName: string;
  stepType?: ExecutionStepType;
  inputSummary?: string;
}

export interface SessionManagerOptions {
  /**
   * Override SQLite path. Use ':memory:' for an ephemeral in-process
   * DB (used by tests). When omitted, defaults to
   * `~/.chrome-mcp-agent/memory.db` in production and to ':memory:'
   * when `NODE_ENV=test` or `JEST_WORKER_ID` is set so that the
   * module-level singleton never writes to a developer's real data
   * file during tests.
   */
  dbPath?: string;
  /**
   * When `false`, skip DB initialization entirely and run with pure
   * in-memory Maps (same shape as pre-persistence behavior). Useful
   * as a kill-switch; also controlled globally by
   * `TABRIX_MEMORY_PERSIST=false`.
   */
  persistenceEnabled?: boolean;
}

export type SessionPersistenceMode = 'disk' | 'memory' | 'off';

interface Repos {
  task: TaskRepository;
  session: SessionRepository;
  step: StepRepository;
  pageSnapshot: PageSnapshotRepository;
  action: ActionRepository;
  operationLog: OperationMemoryLogRepository;
  experience: ExperienceRepository;
  knowledgeApi: KnowledgeApiRepository;
  chooseContextTelemetry: ChooseContextTelemetryRepository;
}

interface StorageInit {
  repos: Repos | null;
  dbHandle: SqliteDatabase | null;
  persistenceMode: SessionPersistenceMode;
  pageSnapshots: PageSnapshotService | null;
  actions: ActionService | null;
  operationLog: OperationMemoryLogRepository | null;
  experienceAggregator: ExperienceAggregator | null;
  experienceQuery: ExperienceQueryService | null;
  knowledgeApi: KnowledgeApiRepository | null;
  chooseContextTelemetry: ChooseContextTelemetryRepository | null;
}

const nowIso = () => new Date().toISOString();

/**
 * v2.6 S1 P1-1 fix — hard cap on the number of distinct external
 * task-session keys we hold in memory. Sized for "every reasonable
 * daemon-mode workflow fits comfortably" (a single agent rarely runs
 * more than ~30 logical tasks in a session) while still bounded so a
 * misbehaving client cannot exhaust memory by minting fresh
 * `taskSessionId`s per call.
 */
const EXTERNAL_TASK_CONTEXT_CAP = 256;

function resolveRuntimeDbPath(options?: SessionManagerOptions): string {
  if (options?.dbPath !== undefined) return options.dbPath;
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return ':memory:';
  }
  return resolveMemoryDbPath({});
}

function initStorage(options?: SessionManagerOptions): StorageInit {
  const persistenceOptOut =
    options?.persistenceEnabled === false || process.env.TABRIX_MEMORY_PERSIST === 'false';
  if (persistenceOptOut) {
    return {
      repos: null,
      dbHandle: null,
      persistenceMode: 'off',
      pageSnapshots: null,
      actions: null,
      operationLog: null,
      experienceAggregator: null,
      experienceQuery: null,
      knowledgeApi: null,
      chooseContextTelemetry: null,
    };
  }

  try {
    const dbPath = resolveRuntimeDbPath(options);
    const opened = openMemoryDb({ dbPath });
    const pageSnapshotRepo = new PageSnapshotRepository(opened.db);
    const actionRepo = new ActionRepository(opened.db);
    const operationLogRepo = new OperationMemoryLogRepository(opened.db);
    const experienceRepo = new ExperienceRepository(opened.db);
    const knowledgeApiRepo = new KnowledgeApiRepository(opened.db);
    const chooseContextTelemetryRepo = new ChooseContextTelemetryRepository(opened.db);
    const repos: Repos = {
      task: new TaskRepository(opened.db),
      session: new SessionRepository(opened.db),
      step: new StepRepository(opened.db),
      pageSnapshot: pageSnapshotRepo,
      action: actionRepo,
      operationLog: operationLogRepo,
      experience: experienceRepo,
      knowledgeApi: knowledgeApiRepo,
      chooseContextTelemetry: chooseContextTelemetryRepo,
    };
    return {
      repos,
      dbHandle: opened.db,
      persistenceMode: opened.persistenceMode,
      pageSnapshots: new PageSnapshotService(pageSnapshotRepo),
      actions: new ActionService(actionRepo, pageSnapshotRepo),
      operationLog: operationLogRepo,
      experienceAggregator: new ExperienceAggregator(
        opened.db,
        repos.session,
        repos.step,
        pageSnapshotRepo,
        experienceRepo,
      ),
      experienceQuery: new ExperienceQueryService(experienceRepo),
      knowledgeApi: knowledgeApiRepo,
      chooseContextTelemetry: chooseContextTelemetryRepo,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`[tabrix/memory] falling back to in-memory session storage: ${message}`);
    return {
      repos: null,
      dbHandle: null,
      persistenceMode: 'off',
      pageSnapshots: null,
      actions: null,
      operationLog: null,
      experienceAggregator: null,
      experienceQuery: null,
      knowledgeApi: null,
      chooseContextTelemetry: null,
    };
  }
}

export class SessionManager {
  private tasks = new Map<string, Task>();
  private sessions = new Map<string, ExecutionSession>();
  /**
   * V26-05 (B-028) — per-task in-process read-budget gate. Attached
   * on `startSession`, detached on `finishSession`. Never persisted
   * (V4.1 §0.1 — runtime cap, not a persisted budget). The
   * `register-tools` `chrome_read_page` shim consults this via
   * `getTaskContext(taskId)` before forwarding to the extension.
   */
  private readonly taskContexts = new Map<string, TaskSessionContext>();
  /**
   * v2.6 S1 P1-1 fix — externally-keyed read-budget gates. The MCP
   * `handleToolCall` mints a fresh internal `taskId` per invocation,
   * which previously meant `taskContexts` could never accumulate
   * state across multiple tool calls of the same logical agent task.
   * Callers can now pass a stable `taskSessionId` (or `taskId` /
   * `clientTaskId` alias) in the tool args; this map keeps that
   * context alive across `handleToolCall` round-trips so the read
   * budget actually fires in production, not just in tests that
   * spy on `getTaskContext`.
   *
   * Lifetime: independent of `startSession` / `finishSession` (the
   * external key has no relation to the internal `taskId`). To keep
   * memory bounded for long-running daemons we cap at
   * {@link EXTERNAL_TASK_CONTEXT_CAP} entries and evict the oldest
   * by insertion order (Map preserves insertion order, so the first
   * `keys()` iterator value is the LRU candidate).
   */
  private readonly externalTaskContexts = new Map<string, TaskSessionContext>();
  private readonly repos: Repos | null;
  private readonly dbHandle: SqliteDatabase | null;
  private readonly persistenceMode: SessionPersistenceMode;
  private readonly pageSnapshotService: PageSnapshotService | null;
  private readonly actionService: ActionService | null;
  private readonly operationLogRepo: OperationMemoryLogRepository | null;
  private readonly experienceAggregator: ExperienceAggregator | null;
  private readonly experienceQueryService: ExperienceQueryService | null;
  private readonly knowledgeApiRepo: KnowledgeApiRepository | null;
  private readonly chooseContextTelemetryRepo: ChooseContextTelemetryRepository | null;

  constructor(options?: SessionManagerOptions) {
    const init = initStorage(options);
    this.repos = init.repos;
    this.dbHandle = init.dbHandle;
    this.persistenceMode = init.persistenceMode;
    this.pageSnapshotService = init.pageSnapshots;
    this.actionService = init.actions;
    this.operationLogRepo = init.operationLog;
    this.experienceAggregator = init.experienceAggregator;
    this.experienceQueryService = init.experienceQuery;
    this.knowledgeApiRepo = init.knowledgeApi;
    this.chooseContextTelemetryRepo = init.chooseContextTelemetry;
    if (this.repos) this.hydrateFromDb(this.repos);
  }

  /**
   * Stage 3b / B-013 read API. Read-only Experience layer queries.
   * `null` when persistence is off (or DB init failed). Callers must
   * treat `null` as "Memory unavailable" and surface
   * `persistenceMode: 'off'` to the upstream agent.
   */
  public get experience(): ExperienceQueryService | null {
    return this.experienceQueryService;
  }

  /**
   * Memory Phase 0.2 — page snapshot façade. `null` when persistence
   * is off (or DB init failed). Callers must treat `null` as
   * "Memory unavailable, proceed without a historyRef".
   */
  public get pageSnapshots(): PageSnapshotService | null {
    return this.pageSnapshotService;
  }

  /**
   * Memory Phase 0.3 — DOM action façade (click / fill / navigate /
   * keyboard). `null` when persistence is off.
   */
  public get actions(): ActionService | null {
    return this.actionService;
  }

  /**
   * V26-14A — factual operation log repository. `null` when persistence
   * is off. Tool calls must treat it as best-effort evidence storage,
   * never as part of the browser-tool success path.
   */
  public get operationLogs(): OperationMemoryLogRepository | null {
    return this.operationLogRepo;
  }

  /**
   * B-017 — Knowledge API endpoint repository. Capture writes go through
   * here from the `chrome_network_capture` post-processor (gated by the
   * `api_knowledge` capability). `null` when persistence is off, in
   * which case the post-processor short-circuits.
   */
  public get knowledgeApi(): KnowledgeApiRepository | null {
    return this.knowledgeApiRepo;
  }

  /**
   * V23-04 / B-018 v1.5 — telemetry repository for `tabrix_choose_context`
   * decisions and outcome write-backs. `null` when persistence is off.
   * Native handlers must treat `null` as "telemetry disabled, skip
   * the decisionId write-back" — the chooser still returns a usable
   * result without a `decisionId`.
   */
  public get chooseContextTelemetry(): ChooseContextTelemetryRepository | null {
    return this.chooseContextTelemetryRepo;
  }

  private hydrateFromDb(repos: Repos): void {
    for (const task of repos.task.list()) {
      this.tasks.set(task.taskId, task);
    }
    for (const session of repos.session.list()) {
      const steps = repos.step.listBySession(session.sessionId);
      this.sessions.set(session.sessionId, { ...session, steps });
    }
  }

  public createTask(input: CreateTaskInput): Task {
    const timestamp = nowIso();
    const task: Task = {
      taskId: randomUUID(),
      taskType: input.taskType,
      title: input.title,
      intent: input.intent,
      origin: input.origin,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'pending',
      owner: input.owner,
      projectId: input.projectId,
      labels: input.labels ?? [],
    };

    this.repos?.task.insert(task);
    this.tasks.set(task.taskId, task);
    return task;
  }

  public startSession(input: StartSessionInput): ExecutionSession {
    const task = this.getTask(input.taskId);
    const session: ExecutionSession = {
      sessionId: randomUUID(),
      taskId: task.taskId,
      transport: input.transport,
      clientName: input.clientName,
      startedAt: nowIso(),
      status: 'running',
      workspaceContext: input.workspaceContext,
      browserContext: input.browserContext,
      steps: [],
    };

    this.repos?.session.insert(session);
    this.sessions.set(session.sessionId, session);
    this.updateTaskStatus(task.taskId, 'running');
    // V26-05 (B-028): attach a fresh per-task read-budget gate. Idempotent
    // — `startSession` may be called more than once per task (e.g. retry
    // after an aborted session) and we deliberately keep the existing
    // context so the budget already spent on the prior session still
    // counts. A truly virgin task (first `startSession`) gets a brand-new
    // context with the env-resolved budget.
    if (!this.taskContexts.has(task.taskId)) {
      this.taskContexts.set(task.taskId, new TaskSessionContext());
    }
    return session;
  }

  public startStep(input: StartStepInput): ExecutionStep {
    const session = this.getSession(input.sessionId);
    const step: ExecutionStep = {
      stepId: randomUUID(),
      sessionId: session.sessionId,
      index: session.steps.length + 1,
      toolName: input.toolName,
      stepType: input.stepType ?? 'tool_call',
      status: 'running',
      inputSummary: input.inputSummary,
      startedAt: nowIso(),
      artifactRefs: [],
    };

    this.repos?.step.insert(step);
    session.steps.push(step);
    return step;
  }

  public completeStep(
    sessionId: string,
    stepId: string,
    updates?: {
      status?: Extract<ExecutionStepStatus, 'completed' | 'failed' | 'skipped'>;
      resultSummary?: string;
      errorCode?: string;
      errorSummary?: string;
      artifactRefs?: string[];
      operationLog?: {
        urlPattern?: string | null;
        pageRole?: string | null;
        requestedLayer?: string | null;
        selectedDataSource?: string | null;
        sourceRoute?: string | null;
        decisionReason?: string | null;
        resultKind?: string | null;
        fallbackUsed?: string | null;
        readCount?: number | null;
        tokensSaved?: number | null;
        tabHygiene?: unknown;
      };
    },
  ): ExecutionStep {
    const session = this.getSession(sessionId);
    const step = this.getStep(session, stepId);

    step.status = updates?.status ?? 'completed';
    step.resultSummary = updates?.resultSummary;
    step.errorCode = updates?.errorCode;
    step.errorSummary = updates?.errorSummary;
    step.artifactRefs = updates?.artifactRefs ?? step.artifactRefs;
    step.endedAt = nowIso();

    this.repos?.step.complete({
      stepId: step.stepId,
      status: step.status,
      resultSummary: step.resultSummary,
      errorCode: step.errorCode,
      errorSummary: step.errorSummary,
      artifactRefs: step.artifactRefs,
      endedAt: step.endedAt,
    });

    this.recordOperationLog(session, step, updates?.operationLog);

    return step;
  }

  private recordOperationLog(
    session: ExecutionSession,
    step: ExecutionStep,
    extras?: {
      urlPattern?: string | null;
      pageRole?: string | null;
      requestedLayer?: string | null;
      selectedDataSource?: string | null;
      sourceRoute?: string | null;
      decisionReason?: string | null;
      resultKind?: string | null;
      fallbackUsed?: string | null;
      readCount?: number | null;
      tokensSaved?: number | null;
      tabHygiene?: unknown;
    },
  ): void {
    if (!this.operationLogRepo) return;
    try {
      const started = Date.parse(step.startedAt);
      const ended = step.endedAt ? Date.parse(step.endedAt) : NaN;
      const durationMs =
        Number.isFinite(started) && Number.isFinite(ended) && ended >= started
          ? ended - started
          : null;
      this.operationLogRepo.insert({
        taskId: session.taskId,
        sessionId: session.sessionId,
        stepId: step.stepId,
        toolName: step.toolName,
        urlPattern: extras?.urlPattern ?? null,
        pageRole: extras?.pageRole ?? null,
        requestedLayer: extras?.requestedLayer ?? null,
        selectedDataSource: extras?.selectedDataSource ?? null,
        sourceRoute: extras?.sourceRoute ?? null,
        decisionReason: extras?.decisionReason ?? null,
        resultKind: extras?.resultKind ?? null,
        durationMs,
        success: step.status === 'completed',
        fallbackUsed: extras?.fallbackUsed ?? null,
        errorCode: step.errorCode ?? null,
        readCount: extras?.readCount ?? null,
        tokensSaved: extras?.tokensSaved ?? null,
        tabHygiene: extras?.tabHygiene,
        createdAt: step.endedAt ?? nowIso(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.warn(`[tabrix/operation-log] write failed: ${message}`);
    }
  }

  public finishSession(
    sessionId: string,
    updates?: {
      status?: Extract<ExecutionSessionStatus, 'completed' | 'failed' | 'aborted'>;
      summary?: string;
    },
  ): ExecutionSession {
    const session = this.getSession(sessionId);
    session.status = updates?.status ?? 'completed';
    session.summary = updates?.summary;
    session.endedAt = nowIso();

    this.repos?.session.finish({
      sessionId: session.sessionId,
      status: session.status,
      summary: session.summary,
      endedAt: session.endedAt,
    });

    const taskStatusMap: Record<
      Extract<ExecutionSessionStatus, 'completed' | 'failed' | 'aborted'>,
      Task['status']
    > = {
      completed: 'completed',
      failed: 'failed',
      aborted: 'cancelled',
    };

    this.updateTaskStatus(session.taskId, taskStatusMap[session.status]);
    try {
      this.experienceAggregator?.projectPendingSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.warn(`[tabrix/experience] aggregation failed: ${message}`);
    }
    // V26-05 (B-028): release the per-task read-budget gate. The task is
    // logically finished (completed / failed / aborted) so any future
    // tool call against the same taskId should start a fresh budget.
    // Detach is best-effort: if `taskContexts` does not have the entry
    // we silently no-op (e.g. tests that bypass `startSession`).
    this.taskContexts.delete(session.taskId);
    return session;
  }

  /**
   * V26-05 (B-028) — read-only accessor used by the
   * `register-tools::handleToolCall` `chrome_read_page` shim. Returns
   * `null` when no context is attached (e.g. the task finished, the
   * caller bypassed `startSession`, or persistence/runtime state was
   * reset between sessions).
   */
  public getTaskContext(taskId: string): TaskSessionContext | null {
    return this.taskContexts.get(taskId) ?? null;
  }

  /**
   * V26-05 (B-028) — convenience used by `register-tools` when only
   * the `sessionId` is in scope. Walks `session → task → context`
   * defensively so a missing session does not throw.
   */
  public getTaskContextForSession(sessionId: string): TaskSessionContext | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.getTaskContext(session.taskId);
  }

  /**
   * V26-05 (B-028) — test seam. Lets unit / integration tests
   * pre-seed a context (e.g. drive `readPageCount` over the budget)
   * without going through `startSession`. Production callers must
   * prefer `getTaskContext` — this method exists so the
   * `register-tools` integration tests can simulate a long-running
   * task without ceremony. Returns the existing context when one is
   * already attached so callers cannot accidentally clobber state.
   */
  public ensureTaskContext(taskId: string, ctx?: TaskSessionContext): TaskSessionContext {
    const existing = this.taskContexts.get(taskId);
    if (existing) return existing;
    const next = ctx ?? new TaskSessionContext();
    this.taskContexts.set(taskId, next);
    return next;
  }

  /**
   * v2.6 S1 P1-1 fix — return (or lazily create) the
   * {@link TaskSessionContext} keyed by an externally-supplied stable
   * id. The MCP `handleToolCall` derives this key from
   * `args.taskSessionId` / `args.taskId` / `args.clientTaskId` so the
   * read-budget gate accumulates state across consecutive tool calls
   * within the same logical agent task (the previous behaviour reset
   * the budget on every `handleToolCall`, which the v2.6 S1 review
   * correctly flagged as "spy-only" semantics).
   *
   * Lifetime is independent of any `startSession` / `finishSession`
   * pair. We bound memory at {@link EXTERNAL_TASK_CONTEXT_CAP}
   * entries and evict the oldest insertion when the cap is hit
   * (Map iteration order is insertion order). The eviction is
   * intentionally simple — no LRU-on-read promotion — because the
   * only real-world failure mode is a runaway client minting fresh
   * keys per call, and FIFO is enough to bound that.
   *
   * Returns the existing context unmodified on repeat lookups so
   * callers cannot accidentally clobber budget / page state.
   */
  public getOrCreateExternalTaskContext(externalKey: string): TaskSessionContext {
    const existing = this.externalTaskContexts.get(externalKey);
    if (existing) return existing;
    if (this.externalTaskContexts.size >= EXTERNAL_TASK_CONTEXT_CAP) {
      const oldest = this.externalTaskContexts.keys().next().value;
      if (oldest !== undefined) this.externalTaskContexts.delete(oldest);
    }
    const next = new TaskSessionContext();
    this.externalTaskContexts.set(externalKey, next);
    return next;
  }

  /**
   * v2.6 S1 P1-1 fix — test seam. Returns `null` when no external
   * context exists; never lazily creates. Lets tests assert "we did
   * NOT contaminate session A from a session B call".
   */
  public peekExternalTaskContext(externalKey: string): TaskSessionContext | null {
    return this.externalTaskContexts.get(externalKey) ?? null;
  }

  public getTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return task;
  }

  public getSession(sessionId: string): ExecutionSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown execution session: ${sessionId}`);
    }
    return session;
  }

  public listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  public listSessions(): ExecutionSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Stage 3e / B-001 read API. Returns the most recent sessions with
   * task title + intent + step count pre-joined, for the sidepanel
   * Memory tab. Returns `[]` when persistence is off (the UI treats an
   * empty response the same way as "no sessions yet" and surfaces a
   * neutral message).
   */
  public listRecentSessionSummaries(limit: number, offset: number): SessionSummary[] {
    if (!this.repos) return [];
    return this.repos.session.listRecent(limit, offset);
  }

  /**
   * Stage 3e / B-001 read API. Returns total session count to drive
   * pagination. Returns 0 when persistence is off.
   */
  public countAllSessions(): number {
    if (!this.repos) return 0;
    return this.repos.session.countAll();
  }

  /**
   * Stage 3e / B-001 read API. Returns chronologically-ordered steps
   * for the given session, read from SQLite. Empty array when the
   * session does not exist or persistence is off.
   */
  public getStepsForSession(sessionId: string): ExecutionStep[] {
    if (!this.repos) return [];
    return this.repos.step.listBySession(sessionId);
  }

  /**
   * Stage 3e / B-001 read API. Returns a Task row by id, or `null`
   * when the task is unknown or persistence is off. Intentionally
   * non-throwing so the HTTP route can surface a clean 404.
   */
  public getTaskOrNull(taskId: string): Task | null {
    if (!this.repos) return null;
    return this.repos.task.get(taskId) ?? null;
  }

  public getPersistenceStatus(): {
    mode: SessionPersistenceMode;
    enabled: boolean;
  } {
    return { mode: this.persistenceMode, enabled: this.repos !== null };
  }

  public reset(): void {
    if (this.repos) {
      // Order matters due to FK cascade: clearing tasks cascades to
      // sessions and steps, but we clear all five explicitly so
      // behavior stays identical whether persistence is on or off.
      this.repos.operationLog.clear();
      this.repos.action.clear();
      this.repos.pageSnapshot.clear();
      this.repos.step.clear();
      this.repos.session.clear();
      this.repos.task.clear();
      this.repos.experience.clear();
    }
    this.tasks.clear();
    this.sessions.clear();
    // v2.6 S1 P1-1: clear externally-keyed task contexts too, so a
    // test calling `reset()` between cases starts with a virgin
    // budget. Internal `taskContexts` is intentionally not touched
    // here — those entries are owned by `startSession`/`finishSession`
    // and would have been collected already if the corresponding
    // sessions had finished cleanly; clearing them blindly risks
    // hiding leaks in failing tests.
    this.externalTaskContexts.clear();
  }

  /**
   * Close the underlying DB handle. Intended for graceful shutdown
   * and test teardown. Safe to call when persistence is off.
   */
  public close(): void {
    this.dbHandle?.close();
  }

  /**
   * V24-01: re-tag a task's intent column. The `experience_replay`
   * MCP handler uses this to mark its wrapper-owned session with the
   * `experience_replay:<actionPathId>` prefix the aggregator's
   * special-case (brief §7) keys off. Intentionally narrow: only
   * intent + updated_at are mutated, never task status / title.
   *
   * No-op when the task is unknown OR persistence is disabled — the
   * handler invokes this best-effort and never lets a tagging failure
   * mask the real outcome.
   */
  public updateTaskIntent(taskId: string, intent: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.intent = intent;
    task.updatedAt = nowIso();
    this.repos?.task.updateIntent(taskId, intent, task.updatedAt);
  }

  private getStep(session: ExecutionSession, stepId: string): ExecutionStep {
    const step = session.steps.find((candidate) => candidate.stepId === stepId);
    if (!step) {
      throw new Error(`Unknown execution step: ${stepId}`);
    }
    return step;
  }

  private updateTaskStatus(taskId: string, status: Task['status']): void {
    const task = this.getTask(taskId);
    task.status = status;
    task.updatedAt = nowIso();
    this.repos?.task.updateStatus(taskId, status, task.updatedAt);
  }
}

export const sessionManager = new SessionManager();
