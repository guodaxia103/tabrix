import { randomUUID } from 'node:crypto';
import {
  ExecutionSession,
  ExecutionSessionStatus,
  ExecutionStep,
  ExecutionStepStatus,
  ExecutionStepType,
  Task,
} from './types';

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

const nowIso = () => new Date().toISOString();

export class SessionManager {
  private tasks = new Map<string, Task>();
  private sessions = new Map<string, ExecutionSession>();

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

    const taskStatusMap: Record<
      Extract<ExecutionSessionStatus, 'completed' | 'failed' | 'aborted'>,
      Task['status']
    > = {
      completed: 'completed',
      failed: 'failed',
      aborted: 'cancelled',
    };

    this.updateTaskStatus(session.taskId, taskStatusMap[session.status]);
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
  }
}

export const sessionManager = new SessionManager();
