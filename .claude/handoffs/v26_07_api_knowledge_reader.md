# V26-07 API Knowledge Reader Handoff

## Scope

Implemented the V26-07 internal API Knowledge substrate for public GET/HEAD on-demand reads. This does not add a public MCP tool, does not change shared public schemas, and does not enable the V26-08 `chrome_read_page` fast path yet.

## What Changed

- Extension: no code change. Existing `chrome_network_capture` post-processing remains the metadata ingress path.
- Native-server: added `app/native-server/src/api/api-knowledge.ts` with:
  - seed endpoint classifier;
  - redacted metadata shape;
  - task-intent candidate resolver;
  - public unauthenticated GET/HEAD reader;
  - structured fallback telemetry for unsupported family/site, method denial, 403, rate limit, HTTP/decode/network failures.
- Shared: no change. No public MCP schema/tool name was modified.

## Seed Classifiers

- `api.github.com/search/repositories` -> `github_search_repositories`, `search_list`
- `api.github.com/repos/:owner/:repo/issues` -> `github_issues_list`, `issue_list`
- `registry.npmjs.org/-/v1/search` -> `npmjs_search_packages`, `package_search`

GitHub/npmjs remain seeds and fixtures, not the product boundary.

## Redaction Boundary

The reader/classifier keeps only host, path pattern, method, status class, timing, size class, content type, endpoint family, confidence, and data purpose. It does not persist raw body, cookie, Authorization, raw query, raw request body, or user form values.

## Tests Added

- Metadata redaction does not retain raw query values.
- Unsupported site family returns `fallback_required`.
- Non-GET/HEAD methods are denied before fetch.
- 403 and 429 are observable fallback results.
- GitHub repository search, GitHub issues list, and npmjs package search seed classifiers resolve.
- Reader success returns compact rows and does not leak raw body fields.

## Verification

- `pnpm -C app/native-server test:ci -- --testPathPattern api` -> passed, 3 suites / 37 tests.
- `pnpm -r typecheck` -> passed.
- `pnpm -C app/native-server build` -> passed.
- `pnpm run docs:check` -> passed.

## Deferred

- V26-08 will wire `knowledge_supported_read` into `chrome_read_page` API execution and compact DOM fallback.
- Gate A / private acceptance will run real browser evidence; this package only adds deterministic native tests.
- No real MCP benchmark was run.

## Remaining Risk

- Public unauthenticated APIs may rate-limit or return 403 in real use; those paths are structured fallbacks to `L0+L1`.
- Candidate extraction is intentionally seed-level and may miss complex search phrasing until V26-08/Gate A expands evidence.

## Commit / Push

- Commit SHA: this commit; final SHA is reported in the batch summary.
- Push status: not pushed per instruction.
