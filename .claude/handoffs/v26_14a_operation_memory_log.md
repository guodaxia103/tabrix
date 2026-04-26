# V26-14A Operation Memory Log Handoff

## Status

Implemented and locally verified. Commit SHA is filled after the final local commit.

## What Changed

- Added `operation_memory_logs` as an idempotent Memory-layer SQLite table.
- Added `OperationMemoryLogRepository` for insert/list/count/clear.
- Wired `SessionManager.completeStep()` to write one best-effort operation log row per completed/failed/skipped tool step.
- Added structured operation-log hints for `chrome_read_page` API rows, skip-read, fallback, warning, and bridge fallback paths.
- Extended the v26 benchmark transformer with `operationLogWritten` input evidence and `operationLogWriteRate` summary output.

## Why

Gate B needs product-path evidence that Tabrix records operation decisions without blocking browser tools. This stores factual operation metadata only: task/session/tool, selected data source, source route, fallback, timing, success/error, read count, token savings, and optional tab hygiene summary.

## Schema Cite

- Existing task/session/step schema: `app/native-server/src/memory/db/schema.ts`, `MEMORY_CREATE_TABLES_SQL`, tables `memory_tasks`, `memory_sessions`, `memory_steps`.
- Existing Knowledge metadata boundary: `app/native-server/src/memory/db/schema.ts`, `KNOWLEDGE_CREATE_TABLES_SQL`, table `knowledge_api_endpoints`.
- New table: `OPERATION_MEMORY_LOG_CREATE_TABLES_SQL`, `operation_memory_logs`.
- Idempotency: `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`; no legacy `ALTER` required for this first version.

## Privacy Boundary

- Does not store raw response body, request body, cookie, Authorization, header values, raw query values, or API result payloads.
- Does not write Experience and does not perform automatic experience extraction.
- Tool calls remain fail-open if operation-log persistence fails.

## Verification

- `pnpm -C app/native-server test:ci --% --testPathPattern "operation-memory-log|session-manager|v26-benchmark|skip-read"` — PASS, 5 suites / 61 tests.
- `pnpm -r typecheck` — PASS.
- `pnpm -C app/native-server build` — PASS.
- `pnpm run docs:check` — PASS.
- `git diff --check` — PASS, CRLF warnings only.

## Not Verified

- Did not run real Gate B.
- Did not reload Chrome extension; this package only changes native-server code and benchmark transformer.

## Remaining Risks

- The benchmark transformer only aggregates `operationLogWriteRate` when the runner emits explicit `operationLogWritten` evidence; real Gate B should either query persisted logs or annotate NDJSON from the DB.
- Non-`chrome_read_page` tool calls currently get minimal operation rows without selected data-source details, which is intentional for the v1 log.

## Commit

- SHA: 405b228
- Push status: not pushed.
