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
  experience: ExperienceRepository;
  knowledgeApi: KnowledgeApiRepository;
}

interface StorageInit {
  repos: Repos | null;
  dbHandle: SqliteDatabase | null;
  persistenceMode: SessionPersistenceMode;
  pageSnapshots: PageSnapshotService | null;
  actions: ActionService | null;
  experienceAggregator: ExperienceAggregator | null;
  experienceQuery: ExperienceQueryService | null;
  knowledgeApi: KnowledgeApiRepository | null;
}

const nowIso = () => new Date().toISOString();

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
      experienceAggregator: null,
      experienceQuery: null,
      knowledgeApi: null,
    };
  }

  try {
    const dbPath = resolveRuntimeDbPath(options);
    const opened = openMemoryDb({ dbPath });
    const pageSnapshotRepo = new PageSnapshotRepository(opened.db);
    const actionRepo = new ActionRepository(opened.db);
    const experienceRepo = new ExperienceRepository(opened.db);
    const knowledgeApiRepo = new KnowledgeApiRepository(opened.db);
    const repos: Repos = {
      task: new TaskRepository(opened.db),
      session: new SessionRepository(opened.db),
      step: new StepRepository(opened.db),
      pageSnapshot: pageSnapshotRepo,
      action: actionRepo,
      experience: experienceRepo,
      knowledgeApi: knowledgeApiRepo,
    };
    return {
      repos,
      dbHandle: opened.db,
      persistenceMode: opened.persistenceMode,
      pageSnapshots: new PageSnapshotService(pageSnapshotRepo),
      actions: new ActionService(actionRepo, pageSnapshotRepo),
      experienceAggregator: new ExperienceAggregator(
        opened.db,
        repos.session,
        repos.step,
        pageSnapshotRepo,
        experienceRepo,
      ),
      experienceQuery: new ExperienceQueryService(experienceRepo),
      knowledgeApi: knowledgeApiRepo,
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
      experienceAggregator: null,
      experienceQuery: null,
      knowledgeApi: null,
    };
  }
}

export class SessionManager {
  private tasks = new Map<string, Task>();
  private sessions = new Map<string, ExecutionSession>();
  private readonly repos: Repos | null;
  private readonly dbHandle: SqliteDatabase | null;
  private readonly persistenceMode: SessionPersistenceMode;
  private readonly pageSnapshotService: PageSnapshotService | null;
  private readonly actionService: ActionService | null;
  private readonly experienceAggregator: ExperienceAggregator | null;
  private readonly experienceQueryService: ExperienceQueryService | null;
  private readonly knowledgeApiRepo: KnowledgeApiRepository | null;

  constructor(options?: SessionManagerOptions) {
    const init = initStorage(options);
    this.repos = init.repos;
    this.dbHandle = init.dbHandle;
    this.persistenceMode = init.persistenceMode;
    this.pageSnapshotService = init.pageSnapshots;
    this.actionService = init.actions;
    this.experienceAggregator = init.experienceAggregator;
    this.experienceQueryService = init.experienceQuery;
    this.knowledgeApiRepo = init.knowledgeApi;
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
   * B-017 — Knowledge API endpoint repository. Capture writes go through
   * here from the `chrome_network_capture` post-processor (gated by the
   * `api_knowledge` capability). `null` when persistence is off, in
   * which case the post-processor short-circuits.
   */
  public get knowledgeApi(): KnowledgeApiRepository | null {
    return this.knowledgeApiRepo;
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

    return step;
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
    return session;
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
      this.repos.action.clear();
      this.repos.pageSnapshot.clear();
      this.repos.step.clear();
      this.repos.session.clear();
      this.repos.task.clear();
      this.repos.experience.clear();
    }
    this.tasks.clear();
    this.sessions.clear();
  }

  /**
   * Close the underlying DB handle. Intended for graceful shutdown
   * and test teardown. Safe to call when persistence is off.
   */
  public close(): void {
    this.dbHandle?.close();
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
