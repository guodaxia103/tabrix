# Tabrix v2.2.0 Release Notes

Release date: 2026-04-22

## Summary

v2.2.0 is the second minor release on the 2.x line. It is the first release that
delivers visible MKEP **Stage 3** capability across all four layers — Memory
(read API + Sidepanel surface), Knowledge (UI Map + API capture), Experience
(action-path aggregator + read-side MCP tool), and Policy (capability opt-in
gate) — plus the first stable identity contract for high-value objects in
`read_page` (B-011).

The release is backward compatible with v2.1.x. All new MCP tools are additive;
all new fields on existing tools are optional; the legacy `kind` / `reason`
contract on `ReadPageHighValueObject` continues to be emitted.

## Highlights (what's actually new since v2.1.0)

### Stage 3a — Knowledge UI Map + stable HVO identity

- **`B-010` · Knowledge UI Map (data side)** — new `KnowledgeUIMapRule` schema +
  compile-time validation + `lookup/resolve-ui-map.ts`. GitHub seed: 5 purposes
  (`repo_home.open_issues_tab`, `repo_home.open_actions_tab`,
  `issues_list.new_issue_cta`, `issues_list.search_input`,
  `actions_list.filter_input`). Read-only consumer wiring is intentionally
  deferred (Stage 3a item 6).
- **`B-011` v1 · stable HVO `targetRef`** — `read_page` HVOs now carry an
  optional `targetRef` of shape `tgt_<10-hex>`, derived deterministically from
  `cyrb53(pageRole | objectSubType | role | normalizedLabel | hrefPathBucket | ordinal)`.
  The click bridge (`candidate-action.ts` + `interaction.ts` + `computer.ts`)
  resolves `candidateAction.targetRef = tgt_*` through a new per-tab snapshot
  registry (`stable-target-ref-registry.ts`) and **fails closed** with
  `unresolved_stable_target_ref` if the registry has no mapping (e.g. service
  worker eviction or stale `tgt_*` after navigation). Legacy `ref_*` /
  `selector` paths are unchanged.
  - **Caveat (1) — executable coverage**: only HVOs that _also_ carry a
    per-snapshot `ref` are end-to-end executable through the click bridge. The
    registry only records mappings when `obj.targetRef && obj.ref` are both
    present, so a `targetRef` on a synthetic / seed-derived HVO will surface
    for stability evidence but will fail closed on click. Broadening
    executable coverage is a v2 follow-up (Stage 3a item 6 / UI Map consumer
    cutover).
  - **Caveat (2) — `historyRef` is not yet a strong content anchor**: the
    extension layer fills `historyRef = read://<host>/<pageRoleSlug>/<sha8>`,
    but the native server's snapshot post-processor unconditionally overwrites
    the wire-level value to `memory://snapshot/<uuid>` (the SQLite snapshot
    row id). Upstream MCP clients therefore see a uuid, not a content hash.
    The B-011 stable `targetRef` does **not** depend on `historyRef` for its
    stability — it stays stable on its own derivation. Promoting `historyRef`
    to a true `contentHash` equivalent is its own follow-up, explicitly
    out of B-011 v1.

### Stage 3b — Experience action-path replay (read side)

- **`B-005`** — Experience schema seed (`experience_action_paths` +
  `experience_locator_prefs`).
- **`B-012`** — Experience action-path aggregator
  (`memory_sessions.aggregated_at` guarded migration; idempotent re-runs).
- **`B-013`** — `experience_suggest_plan(intent, pageRole?, limit?)` MCP tool;
  read-only, native-handled, no extension round-trip; rows ranked by
  `success_count` then net-success margin then recency. The write-side tools
  (`experience_replay`, `experience_score_step`) remain explicitly **out** of
  v2.2.0 and are gated on a Policy review.

### Stage 3e — Memory Sidepanel polish

- **`B-006`** — Memory tab status filter chips + search +
  "jump to last failure" button; covered by extension tests.

### Stage 3f — Policy capability opt-in (v1 slice)

- **`B-016`** v1 — `TabrixCapability` enum + `TABRIX_POLICY_CAPABILITIES` env
  parser, gated alongside the existing `TABRIX_POLICY_ALLOW_P3` (no migration /
  no deprecation pressure yet). v1 ships only the `api_knowledge` capability;
  per-tool capability annotations and the `MemoryAction.policyCapabilities`
  audit field are intentionally deferred.

### Stage 3g — API Knowledge capture v1

- **`B-017`** v1 — GitHub-first, capture-only, capability-gated. New
  `knowledge_api_endpoints` table (idempotent migration; dedup by
  `(site, endpoint_signature)` with `sample_count` / `first_seen_at` /
  `last_seen_at`). Pure transformer covers 9 GitHub endpoint families plus an
  `unclassified` fallback that still respects redaction. Wired through a new
  `chrome_network_capture` post-processor — **no MCP surface change** in v1.
  - Hard PII guarantees, regression-tested at three layers (pure transformer,
    repository, post-processor): never persists raw header values, cookies,
    query values, request body values, or response body text. Only header
    _names_, query _keys_, body _keys_, presence flags (`hasAuth` /
    `hasCookie`), and a coarse response shape descriptor.
  - **Out of v2.2.0**: `knowledge_call_api`, JSON-Schema inference, Sidepanel
    per-site toggle, additional sites. These remain in the pool under the
    same `B-017` umbrella.

### Stage 3h — Context Strategy Selector (v1 minimal slice)

- **`B-018`** v1 — `tabrix_choose_context(intent, url?, pageRole?, siteId?)`
  MCP tool wired into the native server with a rule-based selector and three
  shipped strategies (`experience_reuse` / `knowledge_light` /
  `read_page_required`). GitHub-first; `siteId` only honours `github` in v1,
  and non-GitHub URLs resolve to `read_page_required`. Design + scope detail
  in the maintainer-private B-018 owner brief.
  - **Caveat**: this is a v1 _slice_, not the full Stage 3h DoD. The full
    decision table, telemetry-driven self-learning, and multi-site coverage
    are still in pool. The v1 selector is intentionally rule-only (no
    server-side model).

### Click contract V2 — verifier hook

- **`B-023`** — `chrome_click_element` verified-outcome contract:
  `dispatchSucceeded` / `observedOutcome` / `verification` / `success` (derived,
  never synonymous with "the promise resolved"). Closes the false-success
  defect that v2.1.x exhibited on degraded-bridge / new-tab paths.
- **`B-024`** — Click V2 verifier hook v1: three keys
  (`github.repo_nav.issues` / `pull_requests` / `actions`); fail-closed on
  unknown keys; public click response gains optional `postClickState`
  (`beforeUrl` / `afterUrl` / `pageRoleAfter` / `verifierPassed` /
  `verifierReason`).

### Infrastructure guardrails

- **`B-007`** — sidepanel JS bundle-size CI gate (25 / 40 kB).
- **`B-021`** — sidepanel CSS bundle-size CI gate (20 / 22 kB).
- **`B-008`** — extension testing conventions documented
  (`docs/EXTENSION_TESTING_CONVENTIONS.md`).
- **`B-009`** — schema-cite rule (`AGENTS.md`); every Memory / Knowledge /
  Experience / shared DTO change must cite the authoritative schema.
- **`B-022`** — backlog cleanup (drop legacy `Rule N` numbering references).

## Acceptance Evidence

The product-level claim for v2.2.0 sits on two layers; this section is
deliberately explicit about which evidence is **real-browser** and which is
**source-level / test-level** so upstream readers can calibrate trust.

### Real-browser acceptance (private, anchored)

- **`B-011` golden path** — `T5-F-GH-STABLE-TARGETREF-ROUNDTRIP` in the
  maintainer-held private acceptance lane, GitHub repo home (no login
  state). Two consecutive `read_page` calls produce the same `tgt_<10-hex>`
  for the same logical HVO; a click using **only** `candidateAction.targetRef`
  (no per-snapshot `ref`) lands real navigation.
  - Evidence sample (per-machine, not committed to the public repo):
    `artifacts/t5-fullchain-real-browser-acceptance/.../evidence/t5-f-gh-stable-targetref-roundtrip.json`,
    `targetRefStable: true`, `clickResult.ok: true`, `urlChanged: true`.
- The v2.1.0 baseline (15 / 15 scenarios passed, `productLevelReady: true`)
  on T5 Groups A/B/C/D/E continues to apply for the carry-over surface; no
  v2.1.0 surface was regressed.

### Source-level / test-level evidence (this repo's CI gates)

- `pnpm --filter @tabrix/extension test` — extension test suite
  (≥ 360 tests, including the new
  `tests/stable-target-ref.test.ts`,
  `tests/stable-target-ref-registry.test.ts`, expanded
  `tests/candidate-action-bridge.test.ts`, expanded
  `tests/read-page-task-protocol.test.ts`).
- `pnpm -C app/native-server test:ci` — native server suite covering the
  Experience aggregator, `experience_suggest_plan`, API knowledge capture
  three-layer PII tests, the new context selector, and the Memory read API.
- `pnpm -r typecheck` clean across all four workspaces.
- `pnpm run docs:check` clean.
- `pnpm run i18n:check` clean.
- `pnpm run audit` clean (in-repo OSV production dependency gate).
- `pnpm run release:check` clean.

What v2.2.0 **does not** claim:

- No automated quantification of upstream token savings from B-011 / B-018.
  The structural evidence (stable identity exists, downstream can reuse it
  without re-dumping the HVO list) is real; an end-to-end token-saving
  benchmark is not part of v2.2.0.
- No real-browser acceptance for B-018's selector outcomes — the selector
  itself is exercised through unit/integration tests only in v2.2.0.
- No real-browser acceptance for the Experience aggregator end-to-end loop —
  `B-012` / `B-013` are validated via native-server unit tests only; a
  multi-session real-browser replay scenario is a v2.3.0 candidate.
- No real-browser acceptance for `B-017` capture path — the three-layer PII
  guarantees are validated through unit fixtures only in v2.2.0; a real
  GitHub network capture session under capability opt-in is a v2.3.0
  candidate.

## Lockstep Version Move

All first-party packages move to `2.2.0`:

- `tabrix-monorepo`
- `@tabrix/tabrix`
- `@tabrix/extension`
- `@tabrix/shared`
- `@tabrix/wasm-simd`

`@tabrix/tabrix` now depends on `@tabrix/shared@^2.2.0`.
`@tabrix/extension` keeps its `workspace:*` reference.

## Compatibility Notes

- Existing MCP clients that consume only the v2.1.0 `read_page` surface
  continue to work unchanged. The `targetRef` field is optional; clients
  that don't set `candidateAction.targetRef = tgt_*` follow the legacy
  resolution path with no behavior change.
- New MCP tools added in v2.2.0 are additive: `experience_suggest_plan`
  (B-013), `tabrix_choose_context` (B-018). Clients that don't call them
  are unaffected.
- `chrome_click_element` adds an _optional_ `postClickState` to its
  response (B-023 / B-024). Clients that ignore unknown response fields
  are unaffected.
- `TABRIX_POLICY_CAPABILITIES` runs alongside the existing
  `TABRIX_POLICY_ALLOW_P3`; no environment variable was removed or
  renamed.
- No CLI / transport / diagnostics public surface changes.

## Upgrade

- npm: `npm install -g @tabrix/tabrix@2.2.0`
- Extension: reload the unpacked extension from `dist/` after upgrading.

## Known Non-Goals In This Release

- `experience_replay` / `experience_score_step` MCP tools (write-side
  Experience). Tracked under Stage 3b; gated on Policy review.
- `knowledge_call_api`, JSON-Schema inference, Sidepanel API-Knowledge
  per-site toggle. Tracked under `B-017` v2.
- Full Stage 3h DoD (decision table, telemetry-driven self-learning,
  multi-site). Tracked under `B-018` v2.
- UI Map consumer cutover inside `candidate-action.ts` (Stage 3a item 6).
- Real fault-injection recovery in the private acceptance suite.
- Nightly CI wiring of the T5 acceptance suite.
- Extension of acceptance to logged-in platforms (Douyin / BOSS / private
  consoles) — those stay in their own private suites and are not part of
  this public release surface.
