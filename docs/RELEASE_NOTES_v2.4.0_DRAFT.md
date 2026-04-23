# Tabrix v2.4.0 Release Notes — DRAFT

> **DRAFT — NOT shippable.** This file is named `*_DRAFT.md` on purpose: the release-check script is keyed on `docs/RELEASE_NOTES_v2.4.0.md` (without the `_DRAFT` suffix), so this file does not satisfy the v2.4.0+ release gate. Renaming this file to `docs/RELEASE_NOTES_v2.4.0.md`, refreshing the baseline-comparison table with REAL maintainer-run numbers, and bumping the five `package.json` versions to `2.4.0` is owner-lane work and is intentionally NOT performed by fast-lane.

Release date: `<TBD by maintainer>`.

## Summary

v2.4.0 is the first release whose **Experience layer learns from its own replay outcomes**. The chooser ranks Experience candidates with a deterministic composite score, the replay engine writes outcome deltas back into the Experience repository through an isolated write-back path, and a new `experience_score_step` MCP tool lets external clients participate in the same loop. The release also lands the v2.4 benchmark framework + release gate so that future v2.4+ tags must ship with a real-browser pair-aware report under `docs/benchmarks/v24/`.

The release is backward compatible with v2.3.x. Every new MCP tool is additive; every new field on existing tools is optional. The chooser's `experience_replay` strategy stays disabled by default until the operator opts in via the existing `experience_replay` capability (V23-05 brief). The v2.3 release gate path under `docs/benchmarks/v23/` remains intact for v2.3.x tags.

## Highlights (what's actually new since v2.3.0)

### V24-01 — `experience_replay` v1 (already on `main` from previous package)

- New native MCP tool `experience_replay`: re-executes a previously recorded `experience_action_paths` step list against the current page, fail-closed on the first non-recoverable step, with structured per-step `evidenceRefs` for downstream Experience scoring. Capability-gated under `experience_replay` (single capability, single switch).
- Replay engine sanitises step args before dispatch (P1 fix, already on `main`).
- See `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` and the V24-01 handoff for full surface.

### V24-02 — `experience_score_step` + replay outcome write-back

- New native MCP tool `experience_score_step` (P1, capability-gated under the existing `experience_replay` capability — single switch governs replay + score-step). Records the observed outcome of one replay step against an `experience_action_paths` row using the `ClickObservedOutcome` enum from `packages/shared/src/click.ts` (no parallel enum).
- `ReplayEngine` now hooks an isolated outcome writer: per-step success/failure deltas, `last_replay_at`, and `last_replay_outcome` flow into the Experience repository on the same path the new MCP tool uses.
- New `experience_writeback_warnings` table catches isolated failures: when a write-back fails (e.g. row-not-found, FK violation), the replay primary path is unaffected (`evidenceRefs[i]` is preserved verbatim) and a structured warning row is recorded for post-mortem. The Experience layer loses one learning sample but the user-visible replay does not regress.
- New session-end composite-score writer (`composite-score.ts` pure module + `SessionCompositeScoreWriter`) projects per-session components (accuracy / speed_norm / token_norm / stability) into `memory_sessions.composite_score_raw` + `composite_score_components_blob` and into the cached `experience_action_paths.composite_score_decayed` field via `applyRecencyDecay(rawScore, daysSinceRun) = raw * 0.5^(daysSinceRun / 30)`.
- New `Knowledge taskWeights v1` baseline (`accuracy: 0.40 / speed: 0.20 / token: 0.30 / stability: 0.10`) plus two GitHub seeds (`releases/new`, `search`).
- `tabrix_choose_context` reads but never writes the cached score (V24-03 below).

### V24-03 — `tabrix_choose_context` v2 ranked replay-aware

- `tabrix_choose_context` now returns a single `experience_ranked` artifact whenever any Experience candidate surfaces. The artifact carries the deterministic top-3 ranking (`EXPERIENCE_RANKED_TOP_N = 3`) computed from the cached composite score (with recency decay) and per-task weights.
- New result fields: `rankedCandidateCount`, `replayEligibleBlockedBy`, `replayFallbackDepth`. `ReplayEligibilityBlockReason` is a closed enum (`capability_off | unsupported_step_kind | non_portable_args | non_github_pageRole | below_threshold | stale_locator | none`) and the chooser surfaces the FIRST blocker in the documented order so post-mortem grouping is deterministic.
- Strict v2 thresholds for the `experience_replay` strategy: `EXPERIENCE_REPLAY_MIN_SUCCESS_RATE = 0.80` AND `EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT = 3` AND a portable-args-and-supported-step-kind check. Below those, the chooser downgrades to `experience_reuse` (the legacy v1.5 path is unchanged for the reuse branch).
- Chooser is locked OUT of per-step Memory tables via a Memory-not-read invariant test (greps the chooser source for `step-repository` / `session-repository` and fails the suite on accidental import).
- Telemetry table schema is INTENTIONALLY UNCHANGED in v2.4: the chooser does NOT persist the new V24-03 fields to `tabrix_choose_context_decisions`. Long-term ranked-depth statistics ship in v2.5 alongside K6 trend instrumentation; this avoids regressing the v2.3 release gate.

### V24-04 — DEFERRED to v2.5

- The K8 token-cache work (V24-04) is deferred per the `v2.4.0_p0_chain` plan §6.4 conditional. v2.5 picks it up only if the maintainer's real-MCP benchmark shows K8 < 0.40 (i.e. the second-touch token spend drops below 40 % of first-touch). Until then, the v2.4 benchmark gate emits `WARN: K8 …` evidence but does not block on it.

### V24-05 — Real-browser benchmark v2 framework + v2.3 baseline gate

- New benchmark transformer `app/native-server/src/benchmark/v24-benchmark.ts` (pure function, no IO). Pair-aware: each KPI scenario emits two `kind: 'pair'` records (`first_touch` / `second_touch`) binding tool-call sequence numbers to roles. Computes K1..K4 (carried forward from v23 semantics, unchanged) plus the v2.4 K5..K8:
  - **K5 second-touch speedup**: `firstTouchDurationMs / secondTouchDurationMs`, MEDIAN across pairs.
  - **K6 replay success rate**: per-pair `successCount / replayCount` for second-touch tool calls tagged `chooserStrategy = 'experience_replay'`, MEDIAN.
  - **K7 replay fallback rate**: per-pair `fallbackCount / totalSecondTouchCount`, MEDIAN.
  - **K8 token saving ratio**: `secondTouchTokensIn / firstTouchTokensIn`, MEDIAN. Lower is better; the V24-04 trigger is K8 < 0.40.
- New `replayEligibilityDistribution` and `replayEligibilityBlockedBy` distributions derived from per-tool-call V24-03 chooser metadata (`chooserStrategy`, `chooserBlockedBy`). Lets Codex see "we had a candidate but blocked it because: …" at the run level.
- New CLI wrapper `pnpm run benchmark:v24` (`scripts/benchmark-v24.mjs`): reads NDJSON, writes `docs/benchmarks/v24/<runId>.json`, supports `--gate` (gate-then-write semantics, hard reasons block the write), and `--baseline <v23-report.json>` to auto-emit `docs/benchmarks/v24/v24-vs-v23-baseline-<date>.md` with the canonical `metric | v2.3.0 baseline | v2.4.0 median | delta | direction` table.
- New release gate `scripts/lib/v24-benchmark-gate.cjs` (independent CommonJS file from v23): hard invariants are lane-integrity / K3 ≥ 0.85 / K4 ≤ 0.10 / non-empty scenarios / `reportVersion === 1` / `pairCount ≥ 3` per declared KPI scenario / baseline comparison table embed in release notes; soft (`WARN:`) reasons cover K5..K8 guidance (≥ 1.5, ≥ 0.80, ≤ 0.20, ≤ 0.40 respectively). Gate-then-write blocks `--gate` from leaving a failing JSON on disk.
- `scripts/check-release-readiness.mjs` adds a `benchmarkGateAppliesV24` branch (v2.4.0+) preempting the v23 branch (which still applies to v2.3.x). `--allow-missing-notes` still does NOT bypass the v24 content gate, the baseline-comparison-table embed requirement, or the pairCount check (mirrors the V23-06 closeout).

## Compatibility

| Surface                                         | Status                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Existing MCP tool input schemas                 | unchanged                                                                                                                                |
| Existing MCP tool output schemas                | unchanged for v2.3.x callers; `tabrix_choose_context` adds optional fields (`rankedCandidateCount`, `replayEligibleBlockedBy`, etc.)     |
| `TABRIX_POLICY_*` env vars                      | unchanged                                                                                                                                |
| `experience_replay` capability                  | governs both `experience_replay` (V24-01) and `experience_score_step` (V24-02) — single switch, no new capability                        |
| SQLite schema (Memory / Knowledge / Experience) | additive only — `experience_action_paths` gains 4 nullable columns; `memory_sessions` gains 2; new `experience_writeback_warnings` table |
| Risk tier registrations                         | one new P1 entry (`experience_score_step`); no existing tier downgraded                                                                  |
| Sidepanel surface                               | unchanged                                                                                                                                |
| Telemetry table schema (v2.4 chooser)           | unchanged — V24-03 ranked-depth statistics deferred to v2.5                                                                              |
| `release:check` v2.3.x path                     | unchanged                                                                                                                                |

## Release verification (CI / unit / integration)

This section is what fast-lane (Claude) can fill in deterministically (no real Chrome).

- `pnpm -r typecheck` — green.
- `pnpm -C app/native-server test:ci` — green (49 suites, 582 passed, 24 skipped). Includes V24-02 (`experience-score-step.test.ts`, `composite-score.test.ts`, `experience-aggregator.test.ts` extensions, `schema.test.ts` migration idempotence), V24-03 (`choose-context-replay-rules.test.ts`, `choose-context.test.ts` extensions), V24-05 (`v24-benchmark.test.ts`, `release-gate-v24-fs.test.ts`, `release-gate-v24-allow-missing-notes.test.ts`), and the regression-locked V23-06 path.
- `pnpm -C app/chrome-extension test` — `<TBD by maintainer>` (V24-02/V24-03 changed shared contracts; the maintainer must run the extension suite as part of v2.4 ship work — fast-lane sandbox does not run the extension test bundle).
- `pnpm run docs:check` — green (PRD ↔ ROADMAP ↔ BACKLOG ↔ POLICY in sync).
- `pnpm run release:check` — green on the v2.3.0 path (the script's v2.4 branch is exercised end-to-end by `release-gate-v24-allow-missing-notes.test.ts` on a synthetic v2.4.0 fixture repo; the real repo `package.json` versions remain at `2.3.0` and the maintainer bumps them when the real benchmark is in place).

## Real-browser acceptance evidence

> **PLACEHOLDER — Codex / maintainer must run the real MCP benchmark before release; this draft does not constitute release readiness.**

The numbers below are derived from a synthetic fixture run produced by `release-gate-v24-fs.test.ts`. They prove the v24 transformer + gate are wired correctly but they are NOT real-browser numbers.

- **Run ID:** `fixture-v24-pass` (placeholder)
- **Build SHA:** `fixturepassv24` (placeholder)
- **Report file:** `docs/benchmarks/v24/<TBD>.json` — to be produced by the maintainer's `pnpm run benchmark:v24 -- --input <ndjson> --gate --baseline docs/benchmarks/v23/v23-baseline-2026-04-23.json`.
- **Baseline comparison table:** `docs/benchmarks/v24/v24-vs-v23-baseline-<TBD>.md` — auto-emitted by the CLI.

### Placeholder baseline comparison table

| metric                           | v2.3.0 baseline | v2.4.0 median | delta | direction |
| -------------------------------- | --------------- | ------------- | ----- | --------- |
| K1 mean input tokens             | n/a             | n/a           | —     | —         |
| K3 task success                  | 1.000           | _TBD_         | _TBD_ | _TBD_     |
| K4 retry rate                    | 0.000           | _TBD_         | _TBD_ | _TBD_     |
| K4 fallback rate                 | 0.000           | _TBD_         | _TBD_ | _TBD_     |
| K5 second-touch speedup (median) | n/a             | _TBD_         | —     | —         |
| K6 replay success rate (median)  | n/a             | _TBD_         | —     | —         |
| K7 replay fallback rate (median) | n/a             | _TBD_         | —     | —         |
| K8 token saving ratio (median)   | n/a             | _TBD_         | —     | —         |

> NOTE: K5..K8 are evidence-only in v2.4 (the gate emits `WARN:` reasons rather than hard-fails). v23 baseline does not measure them. K8 < 0.40 is the v2.5 V24-04 trigger.

## Maintainer command list (real-browser run)

These commands are owner-lane / maintainer-only — fast-lane never invokes them inside this repository (per `AGENTS.md` rule 14).

```bash
# 1. Make sure the local extension matches HEAD.
pnpm install
pnpm -r --if-present typecheck
pnpm -C app/native-server build
pnpm -C app/chrome-extension build
pnpm run extension:reload

# 2. Start the native MCP server in foreground; leave running.
pnpm dev:native

# 3. In a second shell, in the sibling tabrix-private-tests checkout,
#    run the v2.4.0 acceptance scenario set (must include each KPI
#    scenario at least 3 times alternating first_touch / second_touch
#    so the v24 gate's `pairCount >= 3` invariant holds).
cd ../tabrix-private-tests
pnpm run acceptance:v2.4.0 -- --runId v24-acceptance-2026-MM-DD

# 4. Back in this repo, project the NDJSON into the release-evidence
#    JSON report, enforce the K3 / K4 / lane-integrity / pairCount
#    gate, and emit the baseline comparison table. The CLI's
#    --baseline flag points at the v2.3.0 baseline JSON so the table
#    is generated automatically.
cd -
pnpm run benchmark:v24 -- \
  --input ~/.chrome-mcp-agent/benchmarks/v24/v24-acceptance-2026-MM-DD.ndjson \
  --gate \
  --baseline docs/benchmarks/v23/v23-baseline-2026-04-23.json

# 5. Paste the generated baseline comparison table into this notes
#    file (replace the placeholder block above), commit the report
#    and notes, and rename docs/RELEASE_NOTES_v2.4.0_DRAFT.md to
#    docs/RELEASE_NOTES_v2.4.0.md so release-check can find it.
git add docs/benchmarks/v24/v24-acceptance-2026-MM-DD.json \
        docs/benchmarks/v24/v24-vs-v23-baseline-2026-MM-DD.md \
        docs/RELEASE_NOTES_v2.4.0.md
git commit -m "release: v2.4.0 — benchmark evidence"

# 6. Bump versions in lockstep across the five package.json files
#    (root, app/native-server, app/chrome-extension, packages/shared,
#    packages/wasm-simd). release-check enforces this.

# 7. The release gate is now green on the v2.4.0+ branch.
pnpm run release:check
```

### Public acceptance scenario list (v2.4.0 — KPI subset)

The `tabrix-private-tests` `acceptance:v2.4.0` runner is expected to cover at minimum:

| Family                | Scenario ID                                | First-touch + second-touch pairs required |
| --------------------- | ------------------------------------------ | ----------------------------------------- |
| Repo navigation       | `T5-A-GH-REPO-NAV-CODE`                    | ≥ 3                                       |
| Repo navigation       | `T5-A-GH-REPO-NAV-ISSUES`                  | ≥ 3                                       |
| Repo navigation       | `T5-A-GH-REPO-NAV-PRS`                     | ≥ 3                                       |
| Edit / save           | `T5-D-GH-ISSUE-COMMENT-EDIT-SAVE`          | ≥ 3                                       |
| Stable targetRef      | `T5-F-GH-STABLE-TARGETREF-CROSS-RELOAD`    | ≥ 3                                       |
| Markdown reading      | `T5-H-GH-REPO-HOME-READ-MARKDOWN`          | ≥ 3                                       |
| Experience replay     | `T5-G-GH-EXPERIENCE-REPLAY-RELEASE-CREATE` | ≥ 3 — **new in v2.4 KPI set**             |
| Chooser ranked replay | `T5-I-GH-CHOOSE-CONTEXT-RANKED-REPLAY`     | ≥ 3 — **new in v2.4 KPI set**             |

> The exact runner command shape lives in `tabrix-private-tests`. Fast-lane never invokes the runner.

## Versioning policy reminder

- v2.4.0 is a minor bump (PRD-level capabilities added, no API breakage).
- Releasing v2.4.0 MUST bump `version` in **all five** `package.json` files in lockstep: root, `app/native-server`, `app/chrome-extension`, `packages/shared`, `packages/wasm-simd`. `release:check` enforces this.
- Tag format `vX.Y.Z` or `tabrix-vX.Y.Z` (existing convention).

## Known limitations carried into v2.4.0

- `experience_replay` candidate ranking is per-`pageRole` × per-`taskWeights` only; cross-task generalisation is deliberately out of scope (the V24-03 plan §2.2 deferred it).
- `replayFallbackDepth` is declared in the chooser's result contract but is only ever set to `0` by the chooser itself; the actual chain depth is maintained by the replay engine and surfaces in the v24 benchmark via per-tool-call `chooserStrategy` / `fallbackUsed`. Long-term per-decision persistence in `tabrix_choose_context_decisions` is deferred to v2.5.
- `experience_writeback_warnings` is an observability table only; a recorded warning means the Experience layer lost one learning sample for that step. There is no automatic compensating write.
- v2.4 K5..K8 are evidence-only in the gate. Codex-driven real-MCP measurement is required before any K8-driven optimisation (V24-04) can be planned for v2.5.
- The `tabrix_choose_context_decisions` telemetry table schema is unchanged in v2.4 to avoid regressing the v2.3 release gate; ranked-depth statistics + post-mortem `replayEligibleBlockedBy` columns ship in v2.5.
