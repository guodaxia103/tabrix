# Tabrix v2.6.0 Release Notes

Release date: **2026-04-27**.

## Summary

v2.6 corrects the Tabrix execution mainline around knowledge-assisted
reading. It introduces a generic network-observe classifier, Endpoint
Knowledge lookup, a Knowledge-driven on-demand reader, a Policy-aware
data-source router, and explicit `endpointSource` lineage
(`observed` / `seed_adapter` / `manual_seed` / `unknown`).

GitHub and npmjs seed adapters remain part of the v2.6 transition and
validation path. Their hits are reported as `seed_adapter` evidence
instead of being presented as generic observed endpoints. Broader
observed-endpoint reuse across arbitrary site families remains a v2.7
scope item. DOM `L0+L1` fallback stays the safe recovery path when an
API route is unavailable, times out, or fails semantic validation.

The release also formalises verified-empty API results. When a
knowledge-driven endpoint succeeds with zero rows, Tabrix emits
`emptyResult: true` with an `emptyReason`, so downstream consumers do
not confuse a valid empty list with an API failure.

v2.6 is backward-compatible with v2.5 callers. Public MCP input schemas
are unchanged; new output fields are additive and optional.

## Highlights

- **Direct API execution path:** read-only search/list/detail tasks can
  execute through the Knowledge-driven API route without forcing a
  browser navigation first.
- **Execution vs learning mode split:** production execution does not
  run foreground network capture by default; learning mode is explicit.
- **Generic network-observe classifier:** observed requests are
  classified into closed semantic buckets such as search, list, detail,
  pagination, and filter candidates.
- **Endpoint Knowledge reader:** endpoint lookup and request planning
  happen through Knowledge first; seed adapters are compatibility
  sources, not generic observed-endpoint proof.
- **Unified Layer Contract:** API, DOM JSON, Markdown, and Experience
  replay are normalised into a shared layer contract so the router can
  choose the lowest sufficient data source.
- **Operation log explainability:** operation logs include structured
  decision and fallback context, enabling later replay of why a step
  used API, DOM, or fallback.
- **Verified empty results:** empty API lists are explicit successful
  results, not silent failures.
- **Latency and competitor gate:** the v26 benchmark transformer tracks
  per-scenario latency budgets, competitor deltas, resilience wins, and
  strict release-blocking evidence.
- **Short-lived compact result cache:** repeated identical read-only API
  reads in one runtime window reuse compact in-memory rows. This is not
  persisted Knowledge or Experience data.

## Real-Browser Acceptance

Gate B strict PASS was completed in the maintainer-private acceptance
repository on the v2.6.0 release candidate build.

Public-safe evidence summary:

| Metric                        | Result                               |
| ----------------------------- | ------------------------------------ |
| Gate B status                 | PASS                                 |
| Paired runs                   | 3 per scenario                       |
| API knowledge hit rate        | 0.80                                 |
| read_page avoided count       | 24                                   |
| token savings estimate total  | 3234                                 |
| operation log write rate      | 1.00                                 |
| fallback success rate         | 1.00                                 |
| primary tab reuse rate        | 1.00                                 |
| max concurrent benchmark tabs | 1                                    |
| sensitive persisted count     | 0                                    |
| verified empty result count   | 15                                   |
| competitor delta distribution | lead 4 / resilience_win 2 / behind 0 |

Private artifacts include the raw NDJSON, transformed v26 benchmark
report, Gate B summary, and per-scenario evidence. Raw evidence and raw
per-scenario timings are intentionally not committed to the public
repository.

## Compatibility

| Surface                        | Status                                                   |
| ------------------------------ | -------------------------------------------------------- |
| MCP tool input schemas         | unchanged                                                |
| MCP tool output schemas        | additive optional fields only                            |
| `TABRIX_POLICY_*` env vars     | unchanged                                                |
| `experience_replay` capability | unchanged                                                |
| SQLite schema                  | additive metadata and private Knowledge/Memory rows only |
| Risk tier registrations        | unchanged                                                |
| Sidepanel surface              | unchanged from v2.5                                      |

Additive output fields include `emptyResult`, `emptyReason`,
`emptyMessage`, `endpointSource`, cache telemetry, and layer-contract
metadata on existing envelopes.

## Verification

Commands run on the release candidate:

```bash
pnpm -C app/native-server test:ci -- --testPathPattern "api-knowledge|direct-api-executor|choose-context-direct-api|v26-benchmark"
pnpm -r typecheck
pnpm -C app/native-server build
pnpm -C app/chrome-extension build
pnpm run docs:check
pnpm run size:check
pnpm run extension:reload
pnpm run acceptance:v2.6.0:gate-b -- --run-id gate-b-release-candidate-2026-04-27-r4
```

The final release gate also validates the private v26 benchmark report
through `pnpm run release:check`.

## Known Limitations

- `endpointSource = 'seed_adapter'` is expected for live GitHub/npmjs
  seed hits in v2.6. Fully generic observed-endpoint reuse is planned
  for v2.7.
- The API path only handles read-only endpoint reuse. Mutating API calls
  remain out of scope.
- The compact result cache is process-local and short-lived. It is a
  latency optimization, not persistent Knowledge.
- Operation-log replay is read-only. It does not write Experience rows
  or trigger ranking/scoring.
- Resilience-win wording means availability/resilience improvement, not
  an absolute speed lead.
