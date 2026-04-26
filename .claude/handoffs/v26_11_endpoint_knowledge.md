# V26-11 Endpoint Knowledge v1 Handoff

## Status

Completed locally as an atomic V26-11 package. Not pushed, not tagged, not published, no version bump.

## Schema Cite

Authoritative DDL: `app/native-server/src/memory/db/schema.ts`, `KNOWLEDGE_CREATE_TABLES_SQL`, table `knowledge_api_endpoints`.

Existing columns used:

- `semantic_tag`
- `status_class`
- `request_summary_blob`
- `response_summary_blob`
- `sample_count`
- `first_seen_at`
- `last_seen_at`
- `endpoint_signature`

Decision: no SQLite schema change was needed. V26-11 scoring uses existing metadata fields, so no migration/ALTER was introduced.

## What Changed

- Added repository-level scored candidate view:
  - `EndpointSemanticType`
  - `ScoredKnowledgeApiEndpoint`
  - `scoreEndpointKnowledge(...)`
  - `KnowledgeApiRepository.listScoredBySite(...)`
- Scoring derives:
  - semantic type (`search`, `list`, `detail`, `pagination`, `filter`, `noise`, `unknown`);
  - confidence;
  - `usableForTask`;
  - `fallbackReason`.
- `tabrix_choose_context` now prefers `listScoredBySite(...).filter(row => row.usableForTask)` when the repository supports it, while keeping the old `listBySite(...)` fallback for tests/legacy deps.

## Why

Endpoint Knowledge needed to be queryable and scored without becoming an API response cache. Existing schema already had enough redacted metadata to score endpoint usefulness; adding columns would have increased migration risk without unlocking new product behavior in this package.

## Verification

- `pnpm -C app/native-server test:ci --% --testPathPattern "knowledge-api-repository|api-knowledge-capture|choose-context"`: PASS, 7 suites / 168 tests.
- `pnpm -r typecheck`: PASS.
- `pnpm -C app/native-server build`: PASS.
- `pnpm run docs:check`: PASS.
- `git diff --check`: PASS, only Git CRLF conversion warnings.

## Not Verified

- Real Gate B was not run in this package.
- No extension build was run for this package because V26-11 touched only native-server code and tests.

## Remaining Risk

- Confidence scoring is intentionally conservative and metadata-derived. Gate B may require tuning after real endpoint observations.
- Generic non-GitHub endpoint persistence remains limited by the existing B-017 classifier; V26-11 did not broaden public site/API families.

## Commit

- Commit SHA: recorded in final report after the atomic commit is created.
- Push status: not pushed by instruction.
