/**
 * MKEP Memory read-side DTOs.
 *
 * These types describe the JSON shapes returned by the native-server's
 * read-only `GET /memory/*` routes (see `app/native-server/src/server/memory-routes.ts`).
 * They are shared between the native-server (canonical emitter) and the
 * Chrome extension's sidepanel (sole consumer) so the contract stays pinned
 * in a single place.
 *
 * Conventions:
 * - All timestamps are ISO-8601 strings in UTC.
 * - Fields marked optional mirror nullable columns in the Memory SQLite tables.
 * - No field is ever renamed across layers: the server emits the same keys
 *   the client consumes, and the extension never reshapes before display.
 * - This module intentionally does not include any writer-side types. Write
 *   paths live inside the native-server and must not leak onto the wire.
 */

export type MemoryPersistenceMode = 'disk' | 'memory' | 'off';

export type MemorySessionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'aborted';

export type MemoryTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type MemoryStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type MemoryStepType = 'tool_call' | 'flow_call' | 'verification' | 'retry' | 'recovery';

/**
 * Flattened projection of `memory_sessions` joined with `memory_tasks` and
 * a `COUNT(memory_steps)` subquery. Backs the Sidepanel Memory tab list.
 */
export interface MemorySessionSummary {
  sessionId: string;
  taskId: string;
  /** Task title (copied from `memory_tasks.title`). */
  taskTitle: string;
  /** Task intent (copied from `memory_tasks.intent`). */
  taskIntent: string;
  transport: string;
  clientName: string;
  status: MemorySessionStatus;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  workspaceContext?: string;
  browserContext?: string;
  /** Number of `memory_steps` rows whose `session_id` equals `sessionId`. */
  stepCount: number;
}

/**
 * Raw `memory_steps` row, emitted in index order ascending.
 */
export interface MemoryExecutionStep {
  stepId: string;
  sessionId: string;
  index: number;
  toolName: string;
  stepType: MemoryStepType;
  status: MemoryStepStatus;
  inputSummary?: string;
  resultSummary?: string;
  startedAt: string;
  endedAt?: string;
  errorCode?: string;
  errorSummary?: string;
  artifactRefs: string[];
}

/**
 * Raw `memory_tasks` row. Returned by `GET /memory/tasks/:taskId`.
 */
export interface MemoryTaskRow {
  taskId: string;
  taskType: string;
  title: string;
  intent: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
  status: MemoryTaskStatus;
  owner?: string;
  projectId?: string;
  labels: string[];
}

/** `GET /memory/sessions` response envelope body. */
export interface MemorySessionsResponseData {
  sessions: MemorySessionSummary[];
  total: number;
  limit: number;
  offset: number;
  persistenceMode: MemoryPersistenceMode;
}

/** `GET /memory/sessions/:sessionId/steps` response envelope body. */
export interface MemorySessionStepsResponseData {
  sessionId: string;
  steps: MemoryExecutionStep[];
  persistenceMode: MemoryPersistenceMode;
}

/** `GET /memory/tasks/:taskId` response envelope body. */
export interface MemoryTaskResponseData {
  task: MemoryTaskRow;
  persistenceMode: MemoryPersistenceMode;
}

/** Standard success envelope used by all `/memory/*` routes. */
export interface MemoryReadSuccess<TData> {
  status: 'ok';
  data: TData;
}

/**
 * Standard error envelope emitted by the `/memory/*` routes.
 *
 * Shape mirrors what `memory-routes.ts` returns today: a top-level
 * `message` string, optionally accompanied by a typed `data` blob
 * (e.g. the `persistenceMode` on 404 responses).
 */
export interface MemoryReadError {
  status: 'error';
  message: string;
  data?: { persistenceMode?: MemoryPersistenceMode };
}

export type MemoryReadResponse<TData> = MemoryReadSuccess<TData> | MemoryReadError;
