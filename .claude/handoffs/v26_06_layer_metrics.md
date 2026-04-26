# V26-06 Layer Metrics + Benchmark Evidence Handoff

## Scope

Package: V26-06.

Base commits:

- `a77e488` V26-07 API Knowledge substrate.
- `4159054` V26-07 reader hardening.
- `084f333` V26-08 search/list API fast path.

Commit: this commit (`feat(v26): add layer metrics and benchmark evidence`). Exact SHA is reported by the owner lane after the commit is materialized.

Push status: not pushed by instruction.

## What Changed

- Extended `v26-benchmark` to surface Gate A evidence fields:
  - `readPageAvoidedCount`
  - `tokensSavedEstimateTotal`
  - `layerDistribution`
  - `dispatcherInputSourceDistribution`
  - `apiKnowledgeHitRate`
  - `fallbackDistribution`
  - `medianDuration`
  - `readPageCount`
  - `primaryTabReuseRate`
  - `maxConcurrentBenchmarkTabs`
- Added `evidenceKind`, `evidenceStatus`, and `evidenceFindings` so missing API/skip-read/token-saving evidence cannot be silently treated as success.
- Extended the V26 search/list fast-path fixture with explicit API telemetry, dispatcher input source, `api_rows`, task totals, and tab hygiene input.

## Consumed Fields

- V26-03 skip-read/task totals:
  - `readPageAvoided`
  - `tokenEstimateChosen`
  - `tokenEstimateFullRead`
  - `taskTotals.readPageAvoidedCount`
  - `taskTotals.tokensSavedEstimateTotal`
- V26-07 API Knowledge telemetry:
  - `apiFamily`
  - `apiTelemetry.status`
  - `apiTelemetry.reason`
  - `apiTelemetry.endpointFamily`
  - `apiTelemetry.fallbackEntryLayer`
- V26-08 API rows/fallback records:
  - `kind: "api_rows"`
  - `sourceKind: "api_list"`
  - `chosenSource: "api_list"`
  - `dispatcherInputSource: "api_knowledge"`
- v25 tab hygiene:
  - `primaryTabReuseRate`
  - `maxConcurrentTabs`

## Fixture vs Real Evidence

- Fixture-only in this commit:
  - Gate A search/list scenario ids.
  - Non-zero API hit rate and token savings in `v26SearchListFastPathFixture()`.
  - Tab hygiene values inside the fixture.
- Requires owner-lane/private acceptance:
  - Real MCP/browser NDJSON with public endpoint availability.
  - Real Gate A comparison against the current browser runner.

## Verification

- `pnpm -C "app/native-server" test:ci --% --testPathPattern "v26-benchmark|ndjson|telemetry"`
  - Result: PASS, 2 suites, 28 tests.
- `pnpm -r typecheck`
  - Result: PASS.
- `pnpm -C "app/native-server" build`
  - Result: PASS.
- `pnpm run docs:check`
  - Result: PASS.

## Not Run

- Real MCP/browser benchmark was not run.
- No private acceptance repo run.
- No publish, tag, version bump, or push.

## Remaining Risk

- `dispatcherInputSource` is optional for legacy NDJSON; missing values produce a warning, not a hard fail.
- API hit rate is only as complete as the runner/recorder fields present in the input.
- Fixture report proves transformer semantics, not live product performance.
