# Tabrix v2.5.0 Release Notes — DRAFT

> **DRAFT — DO NOT SHIP.** Every measured number in this draft is a
> `__V25_TBD__` placeholder that the maintainer must replace with real
> values from the v2.5 real-MCP benchmark before the release gate
> (`pnpm run release:check`) will accept the file. The gate refuses to
> ship release notes that still contain the `__V25_TBD__` token (per
> `scripts/lib/v25-benchmark-gate.cjs::RELEASE_NOTES_PLACEHOLDER_TOKEN`).
> The shape of this file is locked so that the V25-05 fs-level test
> can fixture-test both a placeholder-rejected version and a fully
> populated version.
>
> **Canonical-path requirement (V25 closeout P1):** this DRAFT file
> lives at `docs/RELEASE_NOTES_V2_5_DRAFT.md` and that path is
> **draft-only**. Before tagging `v2.5.0` the maintainer MUST
> `git mv docs/RELEASE_NOTES_V2_5_DRAFT.md docs/RELEASE_NOTES_v2.5.0.md`
> in the same commit that bumps the five `package.json` versions and
> replaces every `__V25_TBD__` token with real benchmark numbers.
> The release gate (`scripts/check-release-readiness.mjs`) and
> `docs/RELEASE_PROCESS.md` only recognise the canonical
> `RELEASE_NOTES_vX.Y.Z.md` form; the DRAFT path is intentionally NOT
> a fallback the v25 gate will accept on a real release commit.

Release date: **V25_TBD**.

## Summary

v2.5.0 is the first release in which `tabrix_choose_context` emits a
**deterministic, caller-facing layer-dispatch policy signal** (chosen
layer, dispatch reason, source route) computed at chooser time. The
chooser delegates the L0 / L0+L1 / L0+L1+L2 selection to a new pure
dispatcher (`choose-context-layer-dispatch.ts`) that linearly scans
the strategy table from V3.1 §11; `chrome_read_page` accepts the new
optional `requestedLayer` field and only emits the layers that were
asked for; and the chosen layer + dispatch reason + source route are
persisted to `tabrix_choose_context_decisions` so the new sidepanel
`Execution` tab and the v25 release gate can both consume the same
evidence.

The signal is advisory: the chooser does **not** itself call
`chrome_read_page` and does **not** itself skip it. The upstream
caller (LLM / agent) reads the chooser's output and decides whether
to honour the signal — for example, when `sourceRoute` is
`'experience_replay_skip_read'`, the caller is expected (per the
contract documented in
`packages/shared/src/read-page-contract.ts`) to replay the recorded
path directly without first calling `chrome_read_page`. If the
caller ignores the signal and still calls `chrome_read_page`, the
extension still serves the request — only the token-saving and
latency-reduction goals captured in the v25 KPIs are forfeited for
that turn.

**v2.5.0 dispatcher priority — honest accounting.** The strategy
table inside `dispatchLayer` places the
`experience_replay_executable` rule at priority 5, AFTER user-intent
overrides (priority 2), task-type overrides (priority 3), and
page-complexity overrides (priority 4). In v2.5.0 the chooser hard-
codes `candidateActionsCount = 0` and `hvoCount = 0` when calling
`dispatchLayer`, which means priority-4's `simple_page_low_density`
rule fires for any non-empty `pageRole`. As a consequence,
`sourceRoute = 'experience_replay_skip_read'` only actually surfaces
through `tabrix_choose_context` when BOTH (a) the caller's `intent`
classifies to the `'unknown'` user-intent bucket (it does NOT match
summary / details / open / select / form / submit keywords), AND
(b) the caller's `pageRole` is empty. This is intentional — the
chooser respects an explicit user-intent override even when an
Experience candidate is replay-eligible (V25-04 stability binding).
Future versions may extend the chooser to feed real per-page facts
into `dispatchLayer` (lifting the hard-coded zeros) and may
re-evaluate the priority order; v2.5 does not.

The release is backward compatible with v2.4.x. Every new field on
existing tools is optional. The dispatcher's
`experience_replay_skip_read` source route only fires when an
Experience candidate is replay-eligible AND safe, so previous-version
callers (which never read the new fields) keep their existing
read-page behaviour by default.

## Highlights

### V25-01 — v2.5 benchmark substrate

- New transformer `app/native-server/src/benchmark/v25-benchmark.ts`
  (pure function, no IO). Pinned at `BENCHMARK_REPORT_VERSION = 1` and
  cross-source-checked by both `v25-benchmark.test.ts` and
  `release-gate-v25-fs.test.ts`.
- New CLI `pnpm run benchmark:v25`
  (`scripts/benchmark-v25.mjs`): reads NDJSON, writes
  `docs/benchmarks/v25/<runId>.json`, supports `--gate` (gate-then-write
  semantics, hard reasons block the write), and `--baseline-v24
<v24-report.json>` to auto-emit the v25-vs-v24 baseline table.
- New gate library `scripts/lib/v25-benchmark-gate.cjs` (independent
  CommonJS file from v23/v24). Hard invariants: `reportVersion === 1`,
  lane integrity, K3 ≥ 0.85, K4 ≤ 0.10, non-empty scenarios,
  `pairedRunCount ≥ 3` per declared KPI scenario, L0 token-ratio
  median ≤ 0.35, L0+L1 token-ratio median ≤ 0.60, K3 / K4 / median
  tool-calls / click-attempts / visual-fallback / JS-fallback
  regression ceilings vs v2.4 baseline, baseline comparison table
  embed in release notes, no `__V25_TBD__` placeholders in release
  notes.

### V25-02 — layer dispatch runtime + telemetry migration

- New shared DTO `ReadPageRequestedLayer` /
  `LayerDispatchReason` / `LayerSourceRoute` (closed enums) in
  `packages/shared/src/read-page-contract.ts`.
- New pure dispatcher `dispatchLayer(input)` in
  `app/native-server/src/mcp/choose-context-layer-dispatch.ts`:
  priority-ordered linear scan (safety override → user intent override
  → task type → page complexity → MKEP support → fail-safe default).
  Strategy Table row 8 is locked to `chosenLayer = 'L0'`,
  `sourceRoute = 'experience_replay_skip_read'`. The dispatcher
  produces a **caller-facing signal only**; whether
  `chrome_read_page` is actually skipped is the upstream caller's
  call (the chooser itself never calls or skips read_page).
  Internal errors fall back safely to `chosenLayer = 'L0+L1+L2'`,
  `sourceRoute = 'dispatcher_fallback_safe'` instead of throwing
  into `tabrix_choose_context`.
- `chrome_read_page` schema gains an optional `requestedLayer`. The
  background tool respects the request: `L0` returns no L1
  `candidateActions` and no L2 details but still populates
  `highValueObjects` and the per-tab stable `targetRef` registry, so
  `chrome_click_element` keeps resolving `tgt_*` even when the chooser
  asks for the smallest envelope.
- `tabrix_choose_context_decisions` migration adds 7 nullable
  columns: `chosen_layer`, `layer_dispatch_reason`, `source_route`,
  `fallback_cause`, `token_estimate_chosen`,
  `token_estimate_full_read`, `tokens_saved_estimate`,
  `knowledge_endpoint_family` (telemetry only — must not drive any
  v2.5 routing). The migration uses the `ensureXxxColumn` idempotent
  pattern.

### V25-03 — Execution Value UI + native read-only routes

- New `Execution` tab in the sidepanel (`tabs/ExecutionTab.vue`) that
  surfaces: chosen-layer distribution, source-route distribution,
  estimated tokens saved, top action paths, fallback / replay
  reliability signals. Empty state explicitly tells the operator that
  no execution decisions have been recorded yet.
- New native HTTP routes (Fastify, all `{ status: 'ok', data }`):
  `GET /execution/decisions/recent?limit=`,
  `GET /execution/savings/summary`,
  `GET /execution/action-paths/top?limit=`,
  `GET /execution/reliability/signals`. PII-safe: responses only
  expose explicitly listed safe fields; raw query-string URLs,
  cookies, authorization headers, and `user_input` columns are never
  serialised.
- Bundle gate raised to JS soft 35 kB / hard 40 kB and CSS soft 25 kB
  / hard 28 kB in the same commit as the Execution tab landed
  (`scripts/check-bundle-size.mjs`). The CSS lift is documented inline
  with the rationale; future tabs reuse the existing `exec-` prefix.

### V25-04 — Ground stability guard + release diagnostic CLI

- New contract test
  `app/chrome-extension/tests/click-resolution-l0-contract.test.ts`
  pins that `chrome_read_page({ requestedLayer: 'L0' })` still
  populates the stable `targetRef` registry and that
  `chrome_click_element` can resolve `tgt_*` to a live `ref_*` using
  only the L0 envelope. Markdown ref-free invariant under L0 is
  re-asserted.
- Experience replay no-regression: new tests in
  `experience-replay.test.ts` pin that rows persisted under reduced L0
  envelopes still get `sanitizePortableSteps` to drop per-snapshot
  `ref_*`, `tabId`, `windowId`, `frameId`, `coordinates`, and
  `candidateAction.locatorChain` `{type:'ref'}` entries; ref-only
  rows fail-closed regardless of the envelope.
- New structural pin in `click-contract.test.ts`: `mergeClickSignals`
  arity is 3 — no verifier verdict can promote `no_observed_change`
  into success. Verifier surface (`verifierContext + browser
readback`) remains independent of read-page L-layer envelopes.
- New release-only diagnostic CLI `scripts/release-diagnostic-v25.mjs`
  prints stability + layer counters from a v25 report (text or
  `--json`). Hard non-goal: it does NOT enforce thresholds — that's
  the v25 gate library, wired into release-check by V25-05 below.

### V25-05 — release gate wiring + draft release notes

- `scripts/check-release-readiness.mjs` adds a `benchmarkGateAppliesV25`
  branch that preempts the v24 branch (which still applies to v2.4.x).
  The chain is now `v25 → v24 → v23`, mutually exclusive in
  version-descending order. `--allow-missing-notes` still does NOT
  bypass the v25 content gate, the baseline-comparison-table embed
  requirement, the pairCount check, or the `__V25_TBD__` placeholder
  rejection (mirrors V23-06 / V24-05 closeouts).
- New fs-level test `release-gate-v25-fs.test.ts` covers passing
  reports, missing reports, stale reports, bad report version,
  missing baseline comparison table, link-only table rejection, bad
  L0 token ratio, K3 / K4 regression, median tool-call regression,
  visual / JS fallback regression, and the explicit "release notes
  still contain `__V25_TBD__`" negative.
- This `RELEASE_NOTES_V2_5_DRAFT.md` ships with every measured number
  as `__V25_TBD__`. The release gate refuses to accept it until the
  maintainer has run a real v2.5 MCP benchmark and replaced every
  placeholder with real values.

## Compatibility

| Surface                                         | Status                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Existing MCP tool input schemas                 | unchanged for v2.4.x callers; `chrome_read_page` adds optional `requestedLayer`                        |
| Existing MCP tool output schemas                | unchanged for v2.4.x callers; new fields on `tabrix_choose_context` decisions are optional             |
| `TABRIX_POLICY_*` env vars                      | unchanged                                                                                              |
| `experience_replay` capability                  | unchanged — single switch still governs `experience_replay` + `experience_score_step`                  |
| SQLite schema (Memory / Knowledge / Experience) | additive only — `tabrix_choose_context_decisions` gains 8 nullable columns; no existing column changes |
| Risk tier registrations                         | unchanged                                                                                              |
| Sidepanel surface                               | new `Execution` tab; existing Memory / Knowledge / Experience tabs unchanged                           |
| `release:check` v2.3.x / v2.4.x paths           | unchanged — v25 branch only fires for v2.5.0+                                                          |

## Release verification (CI / unit / integration)

- `pnpm -r typecheck` — **V25_TBD**.
- `pnpm -C app/native-server test:ci` — **V25_TBD**.
- `pnpm -C app/chrome-extension test` — **V25_TBD**.
- `pnpm run docs:check` — **V25_TBD**.
- `pnpm run release:check` — **V25_TBD**.

## Real-browser acceptance evidence

- **Run ID:** **V25_TBD**
- **Build SHA:** **V25_TBD**
- **Private acceptance summary:** **V25_TBD**
- **Benchmark NDJSON:** **V25_TBD**
- **Report file:** `docs/benchmarks/v25/__V25_TBD__.json`
- **Baseline comparison table:** `docs/benchmarks/v25/v25-vs-v24-baseline-__V25_TBD__.md`
- **Acceptance result:** **V25_TBD** scenario pairs passed; `pairedRunCount = __V25_TBD__`.
- **Gate result:** **V25_TBD**.

### v2.5.0 vs v2.4.0 baseline comparison

| metric                            | v2.4 baseline | v2.5 median | delta       | direction   |
| --------------------------------- | ------------- | ----------- | ----------- | ----------- |
| K1 mean input tokens              | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| K3 task success                   | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| K4 retry rate                     | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| L0 token-ratio median             | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| L0+L1 token-ratio median          | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| Median tool calls / scenario      | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| Click attempts / success (median) | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| Visual fallback rate              | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| JS fallback rate                  | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |
| Replay success rate               | **V25_TBD**   | **V25_TBD** | **V25_TBD** | **V25_TBD** |

> NOTE: every cell in the table above is intentionally a
> `__V25_TBD__` placeholder. The release gate
> (`scripts/lib/v25-benchmark-gate.cjs::requireBaselineComparisonTableV25`)
> rejects this file until those cells are filled in with real values
> from the v2.5 MCP benchmark report.

## Maintainer command list (for the real release)

```bash
pnpm -r --if-present typecheck
pnpm --filter @tabrix/tabrix build
pnpm --filter @tabrix/extension build
pnpm run extension:reload
pnpm -C ../tabrix-private-tests run acceptance:v2.5.0 -- --main-repo ../main_tabrix --owner guodaxia103 --repo tabrix --run-id v25-release-__V25_TBD__
pnpm run benchmark:v25 -- --input C:/Users/gsy/.chrome-mcp-agent/benchmarks/v25/v25-release-__V25_TBD__.ndjson --gate --baseline-v24 docs/benchmarks/v24/v24-release-2026-04-23-rerun2.json
node ./scripts/release-diagnostic-v25.mjs --input docs/benchmarks/v25/v25-release-__V25_TBD__.json
pnpm run release:check
```

## Versioning policy reminder

- v2.5.0 is a minor bump (PRD-level capabilities added, no API breakage).
- Releasing v2.5.0 MUST bump `version` in **all five** `package.json`
  files in lockstep: root, `app/native-server`, `app/chrome-extension`,
  `packages/shared`, `packages/wasm-simd`. `release:check` enforces this.
- Tag format `vX.Y.Z` or `tabrix-vX.Y.Z` (existing convention).
- This DRAFT file is shipped at version `2.4.0` (no version bump in
  the V25-05 commit, per the v2.5 P0 chain plan: V25-05 explicitly
  forbids tagging, publishing, or version-bumping). Per the
  canonical-path requirement at the top of this file (and
  `docs/RELEASE_PROCESS.md` §"Pre-release DRAFT files"), the
  maintainer MUST `git mv` this file to
  `docs/RELEASE_NOTES_v2.5.0.md` (canonical path) in the same
  commit that bumps the five `package.json` versions and replaces
  every `__V25_TBD__` token with real benchmark numbers. The v25
  release gate only loads release notes from the canonical
  `RELEASE_NOTES_vX.Y.Z.md` path; the DRAFT path is intentionally
  not a fallback.

## Known limitations carried into v2.5.0

- **V25_TBD**
