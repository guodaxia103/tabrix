export {
  openMemoryDb,
  resolveMemoryDbPath,
  TabrixMemoryDbBindingError,
  type MemoryDbOptions,
  type OpenMemoryDbResult,
  type SqliteDatabase,
} from './client';
export { MEMORY_CREATE_TABLES_SQL, OPERATION_MEMORY_LOG_CREATE_TABLES_SQL } from './schema';
export { TaskRepository } from './task-repository';
export {
  SessionRepository,
  SESSION_SUMMARY_LIMIT_MAX,
  type SessionUpdate,
  type SessionSummary,
} from './session-repository';
export { StepRepository, type StepCompletion } from './step-repository';
export { PageSnapshotRepository, type PageSnapshot } from './page-snapshot-repository';
export {
  ActionRepository,
  type MemoryAction,
  type MemoryActionKind,
  type MemoryActionStatus,
  type MemoryNavigateMode,
} from './action-repository';
export {
  OperationMemoryLogRepository,
  type OperationMemoryLog,
  type OperationMemoryLogInsert,
} from './operation-memory-log-repository';
export {
  NOT_APPLICABLE,
  OPERATION_LOG_BLOB_SCHEMA_VERSION,
  buildOperationLogBlobV2,
  buildOperationLogMetadata,
  makeOperationLogMetadataDefaults,
  parseOperationLogBlob,
  type OperationLogBlobV2,
  type OperationLogMetadata,
} from './operation-log-metadata';
export {
  rowToTask,
  taskToRow,
  rowToSession,
  sessionToRow,
  rowToStep,
  stepToRow,
  type TaskRow,
  type SessionRow,
  type StepRow,
} from './row-mappers';
