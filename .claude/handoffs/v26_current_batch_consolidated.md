# V26 Current Batch Consolidated Handoff

## Batch Boundary

Executed only:

- V26-08
- V26-06

Already completed before this batch and not redone:

- `a77e488` V26-07 API Knowledge substrate.
- `4159054` V26-07 reader hardening.

Stopped after V26-06 by instruction. V26-09..14 were not entered.

Push status: not pushed by instruction.

## Commits

- `084f333` `feat(v26): add search and list api fast path`
- V26-06: this commit (`feat(v26): add layer metrics and benchmark evidence`). Exact SHA is reported by the owner lane after the commit is materialized.

## V26-08 Summary

- Connected the V26-07 internal Public GET reader to the chooser/read-page production path.
- Chinese GitHub and npm search/list intents can route to `knowledge_supported_read`.
- API success returns compact `kind: "api_rows"` without bridge `chrome_read_page`.
- API failure falls back to bridge with forced `requestedLayer: "L0+L1"`.
- Added Gate A fixture scenario ids:
  - `V26-GATE-A-GITHUB-SEARCH-01`
  - `V26-GATE-A-NPMJS-SEARCH-01`

## V26-06 Summary

- Added V26 layer/evidence summary fields for Gate A report consumers.
- Added `evidenceStatus`/`evidenceFindings`; zero read-page avoidance or zero token savings fail the evidence summary instead of looking successful.
- Fixture replay is explicitly marked `fixture`.
- v25 tab hygiene is carried forward as `primaryTabReuseRate` and `maxConcurrentBenchmarkTabs`.

## Verification

V26-08:

- `pnpm -C "app/native-server" test:ci --% --testPathPattern "skip-read|api|v26-benchmark"` PASS.
- `pnpm -C "app/native-server" test:ci -- --runTestsByPath "src/benchmark/v26-benchmark.test.ts" "src/mcp/choose-context-layer-dispatch.test.ts" "src/mcp/choose-context.test.ts" "src/mcp/choose-context-skip-read-flow.test.ts"` PASS.
- `pnpm -r typecheck` PASS.
- `pnpm -C "app/native-server" build` PASS.
- `pnpm run docs:check` PASS.

V26-06:

- `pnpm -C "app/native-server" test:ci --% --testPathPattern "v26-benchmark|ndjson|telemetry"` PASS.
- `pnpm -r typecheck` PASS.
- `pnpm -C "app/native-server" build` PASS.
- `pnpm run docs:check` PASS.

## Not Run

- Real MCP/browser benchmark.
- Private acceptance repo Gate A.
- Publish/tag/version bump/push.

## Architecture-Debt Checkpoint

Repository rule 15 was checked before stopping:

- Site-specific/domain-specific leakage:
  - API family names remain in API Knowledge and benchmark fixture/evidence files.
  - No new public `packages/shared/src/tools.ts` enum/tool surface was introduced.
- File size/maintainability:
  - The touched benchmark transformer grew additively; no new broad framework was added.
  - No refactor task is required before the next package, but V26-14 gate work should avoid growing `v26-benchmark.ts` into release-policy logic.
- Cross-layer imports:
  - Chooser/native handler imports the internal API Knowledge reader/classifier from native server only.
  - No Chrome extension or shared-package import boundary was widened.
- Decision:
  - Accepted as local benchmark/evidence-layer debt for this batch; do not open a refactor before owner-lane real Gate A evidence unless report-policy logic expands further.

## Remaining Risk

- The live API path still depends on public unauthenticated endpoint availability and rate limits.
- The benchmark transformer now makes missing V26 evidence visible, but it cannot prove real product speed until owner-lane/private acceptance emits real NDJSON.
