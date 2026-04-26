# V26-12 On-demand Endpoint Reader v1 Handoff

## Status

Completed locally as an atomic V26-12 package. Not pushed, not tagged, not published, no version bump.

## What Changed

- Added `readApiKnowledgeEndpointPlan(...)` on top of the existing timeout-bounded `readApiKnowledgeRows(...)`.
- The endpoint plan validates semantic equivalence before public fetch:
  - endpoint family must be supported;
  - requested `dataPurpose` must match the endpoint family;
  - mismatch returns `fallback_required` with `reason="semantic_mismatch"` and `fallbackEntryLayer="L0+L1"`.
- `chrome_read_page` API skip branch now calls the endpoint read plan instead of directly calling the family reader.
- API success still returns compact `api_rows`, `readPageAvoided=true`, token savings, and no bridge `chrome_read_page`.
- API fallback still forces DOM `L0+L1` and does not count token savings.

## Why

V26-12 needed the on-demand reader to execute a task-specific read plan, not just a family fetch. This prevents fast API reads from answering a semantically different task and keeps failure fallback compact.

## Verification

- `pnpm -C app/native-server test:ci --% --testPathPattern "api|skip-read"`: PASS, 5 suites / 79 tests.
- `pnpm -r typecheck`: PASS.
- `pnpm -C app/native-server build`: PASS.
- `pnpm run docs:check`: PASS.
- `git diff --check`: PASS, only Git CRLF conversion warnings.

## Not Verified

- Real Gate B was not run in this package.
- Extension build/reload was not run because this package touched native-server only.

## Remaining Risk

- `api_detail` is not yet broadened beyond current compact row families. Detail reads still require later task-specific support and Gate B evidence.
- Semantic checks are purpose-level in this package; richer parameter equivalence may need tuning after real Gate B failures.

## Commit

- Commit SHA: recorded in final report after the atomic commit is created.
- Push status: not pushed by instruction.
