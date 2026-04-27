# Tabrix v2.6.0 Release Notes — DRAFT

> **Status:** Draft only. Not a release. Not signed off as a
> production-level deliverable. The maintainer-private Gate A / Gate B
> real-browser acceptance loop and the full release-readiness check
> have not been re-run on the head of this draft. Do not version-bump,
> tag, or publish from this file as-is. The numbers, scenarios, and
> evidence pointers below are intentionally unspecific — fill them in
> only after owner-lane Gate B passes and the release-check workflow
> reports green.

Release date: **TBD**.

## Summary (draft)

v2.6 starts correcting the Tabrix execution mainline by introducing
the foundations of a knowledge-driven API direct path: a generic
network-observe classifier, an Endpoint Knowledge lookup, an
on-demand reader selected by Knowledge + a Policy-aware data-source
router, and an explicit `endpointSource` lineage
(`observed` / `seed_adapter` / `manual_seed` / `unknown`).
GitHub / npmjs hardcoded adapters remain part of the v2.6 transition
and validation path — they are how v2.6 exercises the new contract
end-to-end against a real site family — but their hits are now
visible as `seed_adapter` evidence instead of being presented as
generic observed endpoints. Broader observed-endpoint reuse across
arbitrary site families is a v2.7 goal, not a v2.6 claim. The DOM
`L0+L1` fallback path is preserved end-to-end as the safe-by-default
recovery on every path.

The release also formalises a **closed-vocabulary "verified empty"
result** for API answers: when a knowledge-driven endpoint succeeds
but returns zero rows, the chain emits an explicit `emptyResult`
marker so downstream consumers (token-savings estimator, Gate B,
operation-log replay) cannot confuse it with a silent zero-row miss
that should fall back to DOM.

This release is **backward-compatible with v2.5.x callers** — every
new field on the public MCP surface is optional and no existing
schema field changed.

## Highlights (draft)

### V26-FIX-01..09 — execution-mainline correction

- **API direct execution path** scoped to read-only intents, with a
  closed-enum `DirectApiExecutionMode` and `DirectApiDecisionReason`
  so every direct-API attempt is explainable.
- **Execution / learning mode split** — production runs no longer
  enable foreground network observation; learning-mode is the
  explicit opt-in path.
- **Generic network-observe classifier** with closed
  `NetworkObserveSemanticType` buckets, removing the previous
  hardcoded GitHub-only signal.
- **Knowledge-driven on-demand reader** (`EndpointKnowledgeReader`,
  `EndpointMatch`, `SafeRequestPlan`) — API endpoints are looked up
  through the Knowledge layer first; the legacy adapter path becomes
  a guarded `legacy_candidate` fallback.
- **Hardcoded API adapter deprecated as mainline** — `endpointSource`
  is now closed over `observed | seed_adapter | manual_seed` plus
  `unknown` for legacy NDJSON. Seed-adapter hits are visible in the
  benchmark transformer rather than disguised as observed.
- **Unified Layer Contract** across data sources — every reader (API
  / DOM / Experience replay) speaks the same `LayerContractEnvelope`
  / `LayerContractAssertion` shape so the Layer downstream can rank
  candidates without per-source special-casing.
- **Operation log explainability v1** — every step now writes a
  closed-vocab "why" envelope (`decisionReason`, `routerDecision`,
  `fallbackPlan`, …) into a single JSON blob alongside the existing
  per-column structured fields.
- **Latency budget + competitor gate** in the v26 benchmark
  transformer — per-scenario `latencyGateStatus` (pass / warn / fail)
  and `competitorDelta` (lead / near / behind / blocked /
  resilience_win / not_compared). Gate B's strict mode rejects any
  scenario whose median exceeds 1.25× its budget.
- **Cold-start guard** for direct-API attempts: a single bounded
  retry on `network_timeout` / `network_error` within a configurable
  budget, with `apiFirstAttemptMs`, `apiRetryCount`, `apiFinalReason`,
  and `coldStartGuard` recorded as evidence.

### V26-PGB-01..06 — post-Gate-B reinforcement

- **PGB-01: API empty-result semantics.** `api_rows` now carries
  `emptyResult: true | false`, `emptyReason: 'no_matching_records' |
null`, and a short `emptyMessage` when the API call succeeded but
  returned zero rows. Verified-empty answers do not trigger DOM
  fallback and do not inflate the `tokensSavedEstimate` (an
  explicit `unavailable_empty_api_rows` source replaces a
  hypothetical full-read estimate). The chain is wired through
  direct-API → choose-context → MCP shim → operation log.
- **PGB-02: Gate B empty-result reinforcement.** Gate B now exposes
  `emptyResultCount` and `emptyResultScenarios` and the strict-mode
  classifier FAILs the run when an `expectEmptyResult` scenario is
  missing the `emptyResult=true` evidence. The transformer's count
  is cross-checked against the per-scenario classifier so a silent
  drop on either side fails loudly.
- **PGB-04: endpointSource pass-through.** `endpointSource` is
  threaded through `TabrixDirectApiExecution`, the cached direct-API
  snapshot, and the `chrome_read_page` shim. The benchmark
  transformer's `endpointSourceDistribution` (existing FIX-05
  surface) now reflects whether a hit came from an observed
  endpoint, a seed adapter, a manual seed, or unknown legacy
  records.
- **PGB-05: Operation-log replay summary helper.** A new read-only
  helper produces a closed-shape per-step replay summary
  (`api_success` / `api_empty` / `api_fallback` / `read_page_*` /
  `tool_call`) keyed by `sessionId`, surfaces a competitor-friendly
  `routeOutcomeDistribution`, and never leaks raw URLs, request
  bodies, cookies, or auth headers. The session-manager already
  isolates write failures behind a try/catch, so the helper has no
  production-path side-effects.
- **PGB-06: Resilience-win semantics.** A new
  `describeCompetitorDeltaV26` helper enforces that the
  `resilience_win` verdict is rendered as
  `"resilience win (availability)"` and never as `"absolute lead"`,
  `"speed lead"`, or `"faster than competitor"`. The Gate B
  markdown summary now includes a `competitorDeltaDistribution`
  line and a per-scenario competitor column with the resilience-
  aware label. Locked by unit tests on both the TS helper and its
  JS mirror in the private gate runner.

## Compatibility (draft)

| Surface                                         | Status                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Existing MCP tool input schemas                 | unchanged                                                                                                                                |
| Existing MCP tool output schemas                | additive only — `emptyResult`, `emptyReason`, `emptyMessage`, `endpointSource` are optional on `api_rows` and `TabrixDirectApiExecution` |
| `TABRIX_POLICY_*` env vars                      | unchanged                                                                                                                                |
| `experience_replay` capability                  | unchanged                                                                                                                                |
| SQLite schema (Memory / Knowledge / Experience) | additive only — operation-log metadata blob carries new closed-vocab fields; no `ALTER TABLE` on existing columns                        |
| Risk tier registrations                         | unchanged                                                                                                                                |
| Sidepanel surface                               | unchanged from v2.5                                                                                                                      |
| `release:check` v2.3 / v2.4 / v2.5 paths        | unchanged — the v2.6 branch is wired in only when this draft is promoted to a real release                                               |

## Release verification (TBD — DO NOT FILL)

This section MUST be left as a placeholder until the maintainer-
private Gate A / Gate B real-browser acceptance loop has been re-run
against the head of this draft and `pnpm run release:check` reports
green. Filling these lines from a partial run, a fixture run, or a
sandboxed CI typecheck is not acceptable per the public/private test
split rule (`AGENTS.md` rule 17).

- `pnpm -r typecheck` — TBD
- `pnpm -C app/native-server test:ci` — TBD
- `pnpm -C app/chrome-extension test` — TBD
- `pnpm run docs:check` — TBD
- `pnpm run size:check` — TBD
- `pnpm run release:check` — TBD (after the v2.6.0 version bump)

## Real-browser acceptance evidence (TBD)

The maintainer-private acceptance repository owns the real-browser
evidence (NDJSON, screenshots, Gate B markdown summary, run id,
build SHA). Do **not** copy raw evidence, raw competitor numbers,
internal scheduling details, or per-scenario timings into this
public draft. When the release is promoted, this section should
mirror the v2.5 shape — privately-archived NDJSON, a public summary
of pass / fail counts, the `pairedRunCount`, and tab-hygiene
counters — and nothing else.

## Maintainer command list (placeholder)

```bash
pnpm -r --if-present typecheck
pnpm --filter @tabrix/tabrix build
pnpm --filter @tabrix/extension build
pnpm run extension:reload
# v2.6 benchmark / gate-B commands intentionally omitted until the
# private acceptance repository confirms the corresponding scripts.
pnpm run release:check
```

## Versioning policy reminder

- v2.6.0 is a minor bump (PRD-level capabilities added, no public
  schema breakage).
- Releasing v2.6.0 MUST bump `version` in **all five**
  `package.json` files in lockstep: root, `app/native-server`,
  `app/chrome-extension`, `packages/shared`, `packages/wasm-simd`.
  `release:check` enforces this.
- This draft does **not** bump any version. The maintainer is
  responsible for performing the bump in a single dedicated commit
  after Gate B passes.

## Known limitations to carry into v2.6.0 (draft)

- `endpointSource = 'seed_adapter'` is the expected value for live
  GitHub / npmjs adapter hits in v2.6. The transition window for
  promoting these adapters into observed-only knowledge entries is
  tracked in maintainer-private planning.
- The cold-start guard retries at most once. Sites that surface a
  multi-step transient failure are still expected to fall through
  to the DOM `L0+L1` recovery path; a deeper retry policy is not in
  v2.6 scope.
- The operation-log replay helper is a read-only summary tool. It
  does NOT write into Experience and does NOT trigger any ranking
  / scoring; surface for that work remains maintainer-private.
- The resilience-win semantics helper enforces vocabulary at render
  time only. The underlying baseline data — competitor median,
  `mode: 'resilience_win'` flag — is owned by the maintainer-private
  acceptance repository and is not mirrored into this public tree.

## Release-gate checklist (manual, owner-lane)

This block must be filled in by hand at release time and replaced
with concrete evidence pointers. Do not auto-fill from CI.

- [ ] Owner-lane Gate B real-browser run on head of v2.6.0 candidate
      build (`status: PASS`, no strict failures).
- [ ] `emptyResult` evidence present for every `expectEmptyResult`
      scenario (PGB-02 strict invariant).
- [ ] `competitorDeltaDistribution.resilience_win` matches
      `resilienceWinScenarios` length, and the release-note narrative
      for the npmjs scenarios uses resilience-mode wording (PGB-06).
- [ ] No re-introduction of removed surfaces (Smart Assistant,
      Record & Replay v2/v3, local semantic engine, element-marker,
      Visual Editor) — review against `AGENTS.md` § "Removed Surfaces".
- [ ] `pnpm run release:check` runs to completion against the
      v2.6.0 version bump.
- [ ] Release-notes draft re-saved as `RELEASE_NOTES_v2.6.0.md`
      (no `.draft` suffix) only after the above checks pass.
