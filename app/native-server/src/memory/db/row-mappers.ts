/**
 * Row <-> DTO mappers between SQLite rows and the public TypeScript
 * types defined in `src/execution/types.ts`.
 *
 * Serialization rules:
 * - `labels: string[]`        <-> JSON text in `memory_tasks.labels`.
 * - `artifactRefs: string[]`  <-> JSON text in `memory_steps.artifact_refs`.
 * - Optional TS fields map to nullable SQLite columns; `undefined` is
 *   written as `null` and read back as `undefined` for symmetry with
 *   the in-memory DTO shape.
 */

import type {
  ExecutionSession,
  ExecutionSessionStatus,
  ExecutionStep,
  ExecutionStepStatus,
  ExecutionStepType,
  Task,
  TaskStatus,
} from '../../execution/types';

export interface TaskRow {
  task_id: string;
  task_type: string;
  title: string;
  intent: string;
  origin: string;
  owner: string | null;
  project_id: string | null;
  labels: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  session_id: string;
  task_id: string;
  transport: string;
  client_name: string;
  workspace_context: string | null;
  browser_context: string | null;
  summary: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
}

export interface StepRow {
  step_id: string;
  session_id: string;
  step_index: number;
  tool_name: string;
  step_type: string;
  status: string;
  input_summary: string | null;
  result_summary: string | null;
  error_code: string | null;
  error_summary: string | null;
  artifact_refs: string;
  started_at: string;
  ended_at: string | null;
}

function parseJsonArray(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function stringifyLabels(labels: string[]): string {
  return JSON.stringify(labels ?? []);
}

export function rowToTask(row: TaskRow): Task {
  return {
    taskId: row.task_id,
    taskType: row.task_type,
    title: row.title,
    intent: row.intent,
    origin: row.origin,
    owner: row.owner ?? undefined,
    projectId: row.project_id ?? undefined,
    labels: parseJsonArray(row.labels),
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function taskToRow(task: Task): TaskRow {
  return {
    task_id: task.taskId,
    task_type: task.taskType,
    title: task.title,
    intent: task.intent,
    origin: task.origin,
    owner: task.owner ?? null,
    project_id: task.projectId ?? null,
    labels: stringifyLabels(task.labels),
    status: task.status,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

export function rowToSession(row: SessionRow, steps: ExecutionStep[] = []): ExecutionSession {
  return {
    sessionId: row.session_id,
    taskId: row.task_id,
    transport: row.transport,
    clientName: row.client_name,
    workspaceContext: row.workspace_context ?? undefined,
    browserContext: row.browser_context ?? undefined,
    summary: row.summary ?? undefined,
    status: row.status as ExecutionSessionStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    steps,
  };
}

export function sessionToRow(session: ExecutionSession): SessionRow {
  return {
    session_id: session.sessionId,
    task_id: session.taskId,
    transport: session.transport,
    client_name: session.clientName,
    workspace_context: session.workspaceContext ?? null,
    browser_context: session.browserContext ?? null,
    summary: session.summary ?? null,
    status: session.status,
    started_at: session.startedAt,
    ended_at: session.endedAt ?? null,
  };
}

export function rowToStep(row: StepRow): ExecutionStep {
  return {
    stepId: row.step_id,
    sessionId: row.session_id,
    index: row.step_index,
    toolName: row.tool_name,
    stepType: row.step_type as ExecutionStepType,
    status: row.status as ExecutionStepStatus,
    inputSummary: row.input_summary ?? undefined,
    resultSummary: row.result_summary ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    artifactRefs: parseJsonArray(row.artifact_refs),
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
  };
}

export function stepToRow(step: ExecutionStep): StepRow {
  return {
    step_id: step.stepId,
    session_id: step.sessionId,
    step_index: step.index,
    tool_name: step.toolName,
    step_type: step.stepType,
    status: step.status,
    input_summary: step.inputSummary ?? null,
    result_summary: step.resultSummary ?? null,
    error_code: step.errorCode ?? null,
    error_summary: step.errorSummary ?? null,
    artifact_refs: JSON.stringify(step.artifactRefs ?? []),
    started_at: step.startedAt,
    ended_at: step.endedAt ?? null,
  };
}
