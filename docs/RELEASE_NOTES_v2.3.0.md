# Tabrix v2.3.0 Release Notes

Release date: `2026-04-23`.

## Summary

v2.3.0 is the third minor release on the 2.x line. It is the first release whose **release gate is real-browser–anchored**: `pnpm run release:check` now refuses to ship a v2.3.0+ tag without recent maintainer-private benchmark evidence that passes the K3 / K4 / lane-integrity gate. v2.1 / v2.2 ship-grade behaviour is unchanged — the gate only applies to `2.3.0+`.

The release is backward compatible with v2.2.x. Every new MCP tool is additive and either P0 (read-only) or carries `requiresExplicitOptIn: true`; every new field on existing tools is optional. The only behavioural default change is the V23-04 chooser branch landing the new `read_page_markdown` strategy on a hand-curated GitHub whitelist — outside that whitelist callers see no change.

## Highlights (what's actually new since v2.2.0)

### V23-01 — Execution-Truth Hardening (extension)

- **Click-verifier window alignment**: `chrome.tabs.onCreated` observation window in `app/chrome-extension/entrypoints/background/tools/browser/interaction.ts` is now driven by the exported `CLICK_VERIFIER_SETTLE_DELAY_MS` constant rather than a private timeout, removing the documented timing drift between new-tab observation and click verifier settle delay.
- **Tabrix-owned lane integrity**: every successful `chrome_click_element` response now carries an explicit `lane: 'tabrix_owned'` marker. The new `evaluateBenchmarkGate` predicate (V23-06) hard-fails the release if any tool call shows up on the `cdp` or `debugger` lane in the run report — silent fallback to the debugger lane is no longer a quiet regression.
- **Surgical probe reduction**: low-value duplicate `read_page` probes on the GitHub edit/save flow were trimmed; the v2.3.0 benchmark report tracks `readPageProbeCount` as a soft signal so a future regression is visible.

### V23-02 — Stable `targetRef` increment hardening

- New `app/chrome-extension/tests/stable-target-ref-stability.test.ts` exercises three classes of cosmetic DOM mutation (sibling deletion, class change, whitespace-only text change) and one ordinal-collision case against the same HVO; all assert `targetRef` invariants from B-011 v1.
- The maintainer-private real-browser acceptance lane gained a cross-reload `targetRef` stability scenario. Maintainers must run that lane before publishing.

### V23-03 / B-015 — `read_page(render='markdown')` + L2 source routing

- `packages/shared/src/read-page-contract.ts` adds the optional `render?: 'json' | 'markdown'` input field (defaulting to `'json'`, no behaviour change for existing callers) plus the new L2 source-routing fields `domJsonRef` / `markdownRef` / `knowledgeRef` so a caller can ask "give me the cheap reading surface" without losing access to the execution truth.
- The extension's `read-page.ts` now emits an optional `markdown` projection through the new helper `read-page-markdown.ts`. Markdown is intentionally a **reading surface** — HVOs, candidate actions, and `targetRef` continue to live in the JSON branch, and the markdown projection deliberately omits `ref` / `targetRef` values so callers cannot accidentally execute against a markdown view (B-015 invariant).
- New tests: `read-page-render-markdown.test.ts`, `read-page-l2-source-routing.test.ts`. `B-015` flips from pool to done.

### V23-04 / B-018 v1.5 — `tabrix_choose_context` telemetry + outcome write-back + markdown branch

- New SQLite tables `tabrix_choose_context_decisions` (one row per `status='ok'` chooser call: `decision_id`, `intent_signature`, `page_role`, `site_family`, `strategy`, `fallback_strategy`, `created_at`) and `tabrix_choose_context_outcomes` (one row per write-back, FK to decisions). Idempotent `CREATE IF NOT EXISTS` — old DBs from before V23-04 pick up the tables on next open without a migration.
- `runTabrixChooseContext` returns the new opaque `decisionId` field. Telemetry write failures never poison the chooser result (the `decisionId` is simply omitted, treated as "telemetry off").
- New MCP tool `tabrix_choose_context_record_outcome` (P0, pure-INSERT, native-handled). Closed `outcome` set: `reuse | fallback | completed | retried`. Three structural statuses: `ok | invalid_input | unknown_decision` — caller can distinguish "decision lost" from "permission denied".
- New strategy `read_page_markdown` joins `ContextStrategyName`. Routed when no experience hit AND no usable knowledge AND `siteFamily === 'github'` AND `pageRole` is on the hand-curated `MARKDOWN_FRIENDLY_PAGE_ROLES` whitelist (today: `repo_home`; pre-listed for forward-compat: `issue_detail`, `pull_request_detail`, `discussion_detail`, `wiki`, `release_notes`, `commit_detail`).
- New release-evidence script `pnpm run release:choose-context-stats` aggregates strategy distribution and outcome ratios from the telemetry tables.

### V23-05 / `B-EXP-REPLAY-V1` — `experience_replay` v1 owner-lane brief (no implementation)

- A maintainer-private owner brief specifies the v1 contract for `experience_replay`: input/output DTOs, proposed risk tier (P1 + `requiresExplicitOptIn` + new `experience_replay` capability), closed failure-code enum, fail-closed step semantics, Memory write-back via the existing `memory_sessions` + `memory_steps` shape, and a 3-layer test matrix (unit + integration + private-repo `T5-G-experience-replay`).
- **No code lands** in v2.3.0 for `experience_replay`. The brief enumerates 7 owner-lane open questions that gate any future implementation; per `AGENTS.md` §"Tiered Execution Model" they cannot be answered by fast-lane.

### V23-06 — Benchmark framework + release gate

- New benchmark transformer `app/native-server/src/benchmark/v23-benchmark.ts` (pure function, no IO) projects an NDJSON tool-call log into a deterministic v2.3.0 release-evidence report covering K1–K4 plus probe count, lane-integrity counters, mean click attempts per step, and scenario completion. `BENCHMARK_REPORT_VERSION = 1`; bumping is a coordinated change with `release:check`.
- New CLI wrapper `pnpm run benchmark:v23` reads an NDJSON run produced by the maintainer's real-browser session, writes the JSON report to the private release-evidence directory, and optionally exits non-zero on `--gate` failure.
- `pnpm run release:check` now enforces a v2.3.0+ gate: a recent (≤7 days old) private report is required. Older releases (v2.1 / v2.2) are unaffected. The hard numeric thresholds (K3 ≥ 0.85, K4 ≤ 0.10, lane violations = 0) live in `evaluateBenchmarkGate` with documented defaults; a maintainer can tighten them in a follow-up but loosening them requires a documented decision.

## Compatibility

| Surface                                         | Status                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Existing MCP tool input schemas                 | unchanged                                                                                             |
| Existing MCP tool output schemas                | unchanged for `'json'` callers; `chrome_read_page` may carry an optional `markdown` field when asked  |
| `TABRIX_POLICY_*` env vars                      | unchanged (no new env var landed in v2.3.0; `experience_replay` capability is brief-only, see V23-05) |
| SQLite schema (Memory / Knowledge / Experience) | unchanged shapes; two **additive** tables added under `tabrix_choose_context_*`                       |
| Risk tier registrations                         | one new P0 entry (`tabrix_choose_context_record_outcome`); no existing tier downgraded                |
| Sidepanel surface                               | unchanged                                                                                             |

## Release verification (CI / unit / integration)

This section is what fast-lane can fill in deterministically (no real Chrome).

- `pnpm -r typecheck` — green.
- `pnpm -C app/native-server test:ci` — green; full native-server suite including the new `v23-benchmark.test.ts`, `choose-context-telemetry.test.ts`, V23-04 chooser branches, V23-05 brief is doc-only.
- `pnpm -C app/chrome-extension test` — green; including the V23-01 lane-integrity tests and V23-02 stable-targetRef-stability tests.
- `pnpm run docs:check` — green.
- `pnpm run release:choose-context-stats -- --since 7d` — produces a valid report (or refuses on a pre-V23-04 DB, which is the documented behaviour).

## Real-browser acceptance evidence

The released v2.3.0 benchmark baseline was exercised against a live Chrome session bound to the maintainer's GitHub account and then projected through `pnpm run benchmark:v23 -- --input <ndjson> --gate`.

- **Run ID:** `v23-baseline-2026-04-23`
- **Build SHA:** `52b1b260c2c82ac04050d4eeab8fc3730efa9ab6`
- **Private evidence:** archived outside the public repository.
- **Scenario result:** `8/8` passed, `blocked=false`
- **Headline numbers:**
  - `K1 mean input tokens per task`: `null` (current CLI envelope did not surface token usage for this run)
  - `K2 click p50`: `7340 ms`
  - `K3 task success`: `1.0`
  - `K4 retry rate`: `0`
  - `K4 fallback rate`: `0`
  - `lane violations`: `0`
  - `meanClickAttemptsPerStep`: `1`
  - `readPageProbeCount`: `14`
  - `totalToolCalls`: `29`
- **Caveats observed:**
  - This release uses the final baseline run after extension rebuild + reload. Earlier same-day trial runs proved that stale unpacked-extension state can fake a regression if `pnpm -C app/chrome-extension build` and `pnpm run extension:reload` are skipped.
  - `laneCounters.unknownCount=24` is expected for this report because only the click path currently emits an explicit lane marker. The hard gate still passed because `cdpCount=0`, `debuggerCount=0`, and `violationCount=0`.
  - This report is the comparison baseline for future `v2.4.0 -> v2.3.0` release review.

## Maintainer release evidence

The concrete real-browser commands, private scenario identifiers, NDJSON path,
and JSON report are maintainer-private release evidence. Public release notes
only record the shipped capability boundary and headline outcome.

## Versioning policy reminder

- v2.3.0 is a minor bump (PRD-level capabilities added, no API breakage).
- Releasing v2.3.0 MUST bump `version` in **all five** `package.json` files in lockstep: root, `app/native-server`, `app/chrome-extension`, `packages/shared`, `packages/wasm-simd`. `release:check` enforces this.
- Tag format `vX.Y.Z` or `tabrix-vX.Y.Z` (existing convention).

## Known limitations carried into v2.3.0

- `experience_replay` is **not** shipped — only the owner brief is. Until the maintainer answers the 7 open questions, the chooser's `'experience_replay'` strategy remains absent and the K5 metric (`懂用户`) cannot improve beyond what `experience_suggest_plan` already provides.
- `historyRef` promotion to a true content-hash anchor (carried over from v2.2.0 §B-011 caveat) remains out of scope; B-011 v1 stability does not depend on it.
- `knowledge_call_api` (B-017 v2) remains absent. The chooser still routes to `knowledge_light` rather than inventing an `api_only` strategy when API Knowledge has rows but no executable call layer exists.
