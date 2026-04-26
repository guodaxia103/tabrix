# V26-10 Browser Network Observe v1 Handoff

## Status

Completed locally as an atomic V26-10 package. Not pushed, not tagged, not published, no version bump.

## What Changed

- Kept the MV3 `webRequest` path as the main observation path.
- Sanitized `chrome_network_capture` webRequest stop output:
  - raw query values are blanked while query keys remain observable;
  - request body capture was removed from the webRequest path;
  - request/response header values are stripped, sensitive header names are omitted;
  - `endpointCandidates` and `endpointDiagnostics` are emitted as metadata.
- Added endpoint noise classification:
  - `asset`
  - `analytics`
  - `auth`
  - `private`
  - `telemetry`
  - `usable`
  - `unknown`
- Updated native API Knowledge capture to filter private/telemetry endpoints before upsert, so `_private/browser/stats` cannot become endpoint Knowledge.
- Added native diagnostics for bundle analysis while preserving the existing `deriveKnowledgeFromBundle(...)` API.

## Why

V26-10 needed browser-observed network metadata to become product-grade endpoint candidates, not raw network dumps. The main product risk was letting private/telemetry URLs or sensitive values land in Knowledge, or letting `_private/browser/stats` become the only persisted endpoint evidence.

## Observable Conditions

- Extension stop output keeps endpoint metadata and diagnostics, not raw body/header/query values.
- Persisted `api_knowledge` upsert still works for usable GitHub endpoints.
- Private GitHub telemetry-like paths are filtered before persistence.
- No new extension permissions, no CDP mainline, no public MCP schema changes.

## Tests Added Or Updated

- Added `app/chrome-extension/tests/network-capture-web-request.test.ts`.
- Updated `app/native-server/src/memory/knowledge/api-knowledge-capture.test.ts`.
- Updated `app/native-server/src/mcp/tool-post-processors.test.ts`.

## Verification

- `pnpm -C app/native-server test:ci --% --testPathPattern "api-knowledge-capture|tool-post-processors"`: PASS, 2 suites / 40 tests.
- `pnpm -C app/chrome-extension test -- --runInBand tests/network-capture-web-request.test.ts`: PASS. Vitest ran the full extension suite in this invocation: 49 files / 424 tests.
- `pnpm -r typecheck`: PASS.
- `pnpm -C app/native-server build`: PASS.
- `pnpm -C app/chrome-extension build`: PASS.
- `pnpm run docs:check`: PASS.
- `git diff --check`: PASS, only Git CRLF conversion warnings.

## Not Verified

- Real browser Gate B was not run in this package.
- `pnpm run extension:reload` was not run; build output is ready but unpacked Chrome was not reloaded in this package.

## Remaining Risk

- The webRequest capture still buffers request metadata in memory during an active capture; request bodies are no longer captured in the webRequest path.
- Current Knowledge persistence remains GitHub-first. Generic usable endpoint candidates are diagnosed but not all are persisted until V26-11 extends Endpoint Knowledge semantics.

## Commit

- Commit SHA: recorded in final report after the atomic commit is created.
- Push status: not pushed by instruction.
