# V26-09 Unified Data Source Router v1 Handoff

## Status

Completed locally as an atomic V26-09 package. Not pushed, not tagged, not published, no version bump.

## What Changed

- Added internal `DataSourceRouter` in `app/native-server/src/execution/data-source-router.ts`.
- Routed `tabrix_choose_context` decisions through the router without changing public MCP tool schemas.
- Persisted router evidence into `TaskSessionContext` snapshots so `chrome_read_page` skip/API envelopes can report it.
- Added top-level runtime evidence fields for benchmark NDJSON consumers:
  - `chosenSource`
  - `dataSource`
  - `decisionReason`
  - `fallbackPlan`
  - `dispatcherInputSource`
  - `routerConfidence`
  - `routerRiskTier`
  - `costEstimate`
- Kept API execution in the existing V26-08 `readApiKnowledgeRows` branch; the router only decides, it does not fetch.

## Why

Gate A passed but v26 benchmark evidence still warned on `dispatcher_input_source_missing`.
V26-09 needed a single explainable internal decision point for API / Markdown / DOM / Experience routing so later packages can build on the same source decision instead of each path inferring independently.

## Observable Conditions

- API search/list routes produce `chosenSource="api_list"` and `dispatcherInputSource="api_knowledge"`.
- Markdown-friendly read routes produce `chosenSource="markdown"` and compact DOM fallback.
- DOM routes produce `chosenSource="dom_json"`.
- Router fail-safe and fallback plans clamp to `L0` or `L0+L1`, never `L0+L1+L2`.

## Tests Added Or Updated

- Added `app/native-server/src/execution/data-source-router.test.ts`.
- Updated chooser tests for Chinese GitHub/npm search router evidence.
- Updated production chooser -> `chrome_read_page` integration test for API rows evidence.

## Verification

- `pnpm -C app/native-server test:ci --% --testPathPattern "data-source-router|choose-context|skip-read|v26-benchmark"`: PASS, 8 suites / 179 tests.
- `pnpm -r typecheck`: PASS.
- `pnpm -C app/native-server build`: PASS.
- `pnpm run docs:check`: PASS.
- `git diff --check`: PASS, only existing CRLF conversion warnings from Git.

## Not Verified

- Real Gate A/Gate B browser acceptance was not run in this package.
- Extension build/reload was not run because V26-09 only touched native-server code and tests.

## Remaining Risk

- Existing bridge-forwarded DOM `chrome_read_page` responses are still mostly bridge-shaped; router evidence is guaranteed on chooser, skip, and API rows envelopes. Gate B may still expose report-field gaps for pure DOM forwarded records.
- No public schema was changed, so callers relying on strict shared TypeScript types will not see the extra evidence fields at compile time.

## Commit

- Commit SHA: recorded in final report after the atomic commit is created.
- Push status: not pushed by instruction.
