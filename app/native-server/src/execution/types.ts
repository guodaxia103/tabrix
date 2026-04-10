export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ExecutionSessionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'aborted';

export type ExecutionStepType = 'tool_call' | 'flow_call' | 'verification' | 'retry' | 'recovery';

export type ExecutionStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Task {
  taskId: string;
  taskType: string;
  title: string;
  intent: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
  status: TaskStatus;
  owner?: string;
  projectId?: string;
  labels: string[];
}

export interface ExecutionStep {
  stepId: string;
  sessionId: string;
  index: number;
  toolName: string;
  stepType: ExecutionStepType;
  status: ExecutionStepStatus;
  inputSummary?: string;
  resultSummary?: string;
  startedAt: string;
  endedAt?: string;
  errorCode?: string;
  errorSummary?: string;
  artifactRefs: string[];
}

export interface ExecutionSession {
  sessionId: string;
  taskId: string;
  transport: string;
  clientName: string;
  startedAt: string;
  endedAt?: string;
  status: ExecutionSessionStatus;
  workspaceContext?: string;
  browserContext?: string;
  summary?: string;
  steps: ExecutionStep[];
}

export interface NormalizedExecutionError {
  code: string;
  summary: string;
  details?: unknown;
}

export interface ExecutionResult<TData = unknown> {
  status: 'success' | 'warning' | 'failure';
  summary: string;
  data?: TData;
  warnings: string[];
  errors: NormalizedExecutionError[];
  artifacts: string[];
  nextActions: string[];
}
