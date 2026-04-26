# V26-08 Search/List API Fast Path Handoff

## Scope

Package: V26-08.

Base: V26-07 landed in `a77e488` and `4159054`.

Commit: this commit (`feat(v26): add search and list api fast path`). Exact SHA is reported by the owner lane after the commit is materialized.

Push status: not pushed by instruction.

## What Changed

- Wired the V26-07 internal API Knowledge classifier into `tabrix_choose_context` for search/list reading tasks.
- Added a dispatcher input flag for resolved API search/list intents so `knowledge_supported_read` can beat generic `search` form intent without adding public MCP schema or shared enum values.
- Persisted `apiCapability` only when `sourceRoute === "knowledge_supported_read"` and `resolveApiKnowledgeCandidate(...)` returns a real candidate.
- Added a `chrome_read_page` skip branch that executes the internal reader when the skip plan requires API:
  - API success returns `kind: "api_rows"` compact rows and does not call bridge `chrome_read_page`.
  - API fallback forces bridge fallback to `requestedLayer: "L0+L1"` and does not count as read-page avoided.
- Added Gate A fixture scenario ids:
  - `V26-GATE-A-GITHUB-SEARCH-01`
  - `V26-GATE-A-NPMJS-SEARCH-01`

## Observable Conditions

- Chinese GitHub repository search intent resolves to `github_search_repositories`.
- Chinese npm package search intent resolves to `npmjs_search_packages`.
- API compact rows are treated as read output only; they do not create click locators.
- Experience replay remains higher priority than API because the dispatcher priority order is unchanged.

## Verification

- `pnpm -C "app/native-server" test:ci --% --testPathPattern "skip-read|api|v26-benchmark"`
  - Result: PASS, 6 suites, 84 tests.
- `pnpm -C "app/native-server" test:ci -- --runTestsByPath "src/benchmark/v26-benchmark.test.ts" "src/mcp/choose-context-layer-dispatch.test.ts" "src/mcp/choose-context.test.ts" "src/mcp/choose-context-skip-read-flow.test.ts"`
  - Result: PASS, 4 suites, 123 tests.
- `pnpm -r typecheck`
  - Result: PASS.
- `pnpm -C "app/native-server" build`
  - Result: PASS.
- `pnpm run docs:check`
  - Result: PASS.

## Not Run

- Real MCP/browser benchmark was not run. Gate A remains owner-lane/private acceptance evidence.
- No publish, tag, version bump, or push.

## Remaining Risk

- The API reader is public GET-only and therefore depends on public endpoint availability and rate limits.
- Fixture evidence is marked as fixture-level benchmark transformer evidence; it is not a real benchmark substitute.
