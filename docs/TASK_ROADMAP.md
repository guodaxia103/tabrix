# Tabrix Task Roadmap (Stage 3a → 5e)

> **Version**: `v1.0.0` (2026-04-21) — companion to [`PRD.md`](./PRD.md).
> **Language**: English (canonical). Chinese mirror: [`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md).
> **Status**: `Active / Execution plan SoT (Stage level)`.
> **Supersedes**: the roadmap portion of [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md). That file stays as a historical reference; this one is the live plan.
> **Sprint executor**: [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) — every Stage on this page maps to one or more `B-*` items over there.

---

## 0. How to Use This Document

If you are a new AI assistant picking up work on Tabrix, read in this order:

1. [`AGENTS.md`](../AGENTS.md) — development rules.
2. [`PRD.md`](./PRD.md) — product identity + hard constraints.
3. **This file** — which Stage is live, what is next, what is off-limits.
4. [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) — the `B-*` you can grab this week.

Each Stage below has a fixed template:

- **ID & name** — `Stage <id>`, e.g. `Stage 3a`.
- **MKEP layer** — `M` / `K` / `E` / `P` / `X` (cross-cutting).
- **KPI** — which of the five North-Star dimensions the Stage moves (`省 token` · `更快` · `更准` · `更稳` · `懂用户`).
- **Priority / Size / Dependencies** — `P0..P2` · `S/M/L/XL` · upstream Stages.
- **Scope** — what is in.
- **Non-scope** — what is explicitly out (to keep the Stage finishable).
- **Definition of Done (DoD)** — the hard completion signal.
- **Linked `B-*`** — sprint items that deliver the Stage.
- **Notes for incoming AI** — traps, conventions, and invariants to respect.

When in doubt: **do not expand scope without updating this file first**. Scope creep is the most common source of stuck Stages.

---

## 1. Wave Map (Dependency Overview)

```
Wave 1 — near-term, parallelizable. Starts unblocked.
  Stage 3a · Knowledge UI Map + stable targetRef      [B-010 done, B-011 next]
  Stage 3d · read_page(render='markdown')             [B-015 pool]
  Stage 3g · API Knowledge (XHR/fetch capture)        [B-017 pool]       ← biggest K1 lever (data side)
  Stage 3f · Policy capability opt-in enum            [B-016 pool]

Wave 2 — needs Wave 1 to be at least Beta.
  Stage 3b · Experience action-path replay            [B-005 schema done, B-012 done, B-013 next]
  Stage 3c · Recovery Watchdog consolidation          [B-014 pool]

Wave 3 — strategic payoff; needs Waves 1+2.
  Stage 3h · Context Strategy Selector                [B-018 pool]       ← biggest K1 lever (planning side)
  Stage 3e · Run History UI                           [B-001..B-006 DONE; Sprint 1+2]
  Stage 3i · Memory Insights table                    [B-019 pool]

Wave 4 — user-value amplification.
  Stage 4a · Experience import/export + PII redact    [B-020 pool]
  Stage 4b · Policy dynamic context                   [no B yet]
  Stage 4c · Douyin + cross-site family migration     [no B yet]

Wave 5 — long horizon, no dates.
  Stage 5a · Experience self-learning writeback
  Stage 5b · Knowledge Graph upgrade
  Stage 5c · WebMCP Bridge
  Stage 5d · Experience Marketplace
  Stage 5e · Personal userPreference layer
```

**Cross-cutting (non-Stage) tracks** that run in parallel with any Wave:

- Tool-contract correctness — [`CLICK_CONTRACT_REPAIR_V1.md`](./CLICK_CONTRACT_REPAIR_V1.md) (B-023 done; next tool contracts TBD).
- Infrastructure guardrails — bundle-size gate (B-007, B-021), schema-cite rule (B-009), testing conventions (B-008).

---

## 2. Stage 3a · Knowledge UI Map + Stable `targetRef`

- **Layer**: `K`
- **KPI**: `更准` · `更稳` · `省 token`
- **Priority**: `P0` · **Size**: `M` · **Dependencies**: none
- **Status**: **partially done** — UI Map schema + GitHub seed + lookup landed in `B-010`. Stable `targetRef` is `B-011`, pending.

### Scope

1. `KnowledgeUIMapRule { siteId, pageRole, purpose, region?, locatorHints[], actionType?, confidence? }` with hint kinds `aria_name | label_regex | href_regex | css`. Landed in `B-010`.
2. `compileKnowledgeRegistry` compiles + indexes UI map rules by `(siteId, pageRole, purpose)`; duplicate triples are rejected at compile time. Landed in `B-010`.
3. `lookup/resolve-ui-map.ts` exposing `lookupUIMapRule` / `listUIMapRulesForPage` / `listUIMapRulesForSite`. Landed in `B-010`.
4. GitHub seed: the first five purposes — `repo_home.open_issues_tab`, `repo_home.open_actions_tab`, `issues_list.new_issue_cta`, `issues_list.search_input`, `actions_list.filter_input`. Landed in `B-010`.
5. `read_page` HVO output gains **stable `targetRef`** = `historyRef` + HVO index + `contentHash`, so upstream LLMs can reference the same HVO across reloads. Pending in `B-011`.
6. `candidate-action.ts` gradually migrates hardcoded locator-priority logic to consult UI Map hints. Pending (scoped behind `KNOWLEDGE_REGISTRY_MODE = on | off | diff`).

### Non-scope

- Douyin UI Map rules (Stage 4c).
- Modifying the public `read_page` DTO schema beyond adding the `targetRef` field.
- Re-wiring `candidate-action.ts` entirely — Stage 3a only lands the data lookup; consumer cutover is incremental.

### Definition of Done

- `read_page` returns stable `targetRef` that round-trips across reloads for at least 80% of HVOs on the GitHub baseline.
- `pnpm --filter @tabrix/extension test` has ≥ 15 tests covering compile / declaration order / duplicate reject / lookup / fallback.
- Knowledge Stage 1/2 existing tests all green with zero edits (no regression).
- `docs:check` clean.

### Linked `B-*`

- ✅ `B-010` — `KnowledgeUIMapRule` schema + GitHub seed + read-only lookup (done).
- ⬜ `B-011` — `read_page` HVO stable `targetRef` (`historyRef` + HVO index + `contentHash`).

### Notes for incoming AI

- **Core-neutrality invariant** is guarded by `tests/read-page-understanding-core-neutrality.test.ts` — no GitHub strings in `read-page-understanding-core.ts`. Breaking this test is a blocker.
- Locator hint kinds are the same four used by `docs/MKEP_CURRENT_VS_TARGET.md:229-242`; do not add a fifth without a roadmap update.
- `contentHash` in `targetRef` must be stable across cosmetic DOM mutations (e.g. class toggles); hashing the accessible name + role is the starting heuristic.

---

## 3. Stage 3b · Experience Phase 0 · Action Path Replay

- **Layer**: `E` (+ reads `M`)
- **KPI**: `省 token` · `更快` · `懂用户`
- **Priority**: `P0` · **Size**: `L` · **Dependencies**: `Stage 3a`
- **Status**: **schema done, aggregator done; MCP tools next** — `B-005` (schema) done in Sprint 2; `B-012` (aggregator) landed in Sprint 3; `B-013` (MCP tools) remains in pool.

### Scope

1. Schema: `experience_action_paths(page_role, intent_signature, step_sequence, success_count, failure_count, last_used_at, …)` + `experience_locator_prefs(page_role, element_purpose, preferred_selector_kind, preferred_selector, hit_count, …)`. Done in `B-005`.
2. **Aggregator** (`B-012`, done): walks `memory_sessions` where `status ∈ {completed, failed, aborted}` AND `aggregated_at IS NULL`; joins `memory_tasks` for intent; reads `memory_steps` for ordered step sequence; and projects into `experience_action_paths`. Idempotent re-runs do not double-count.
3. `memory_sessions.aggregated_at` column added via guarded migration (SQLite lacks `IF NOT EXISTS` on `ADD COLUMN`).
4. MCP tools (`B-013`, next): `experience_suggest_plan(intent, pageRole?) → ActionPath | null`, `experience_replay(intent, variables) → plan`, `experience_score_step(stepId, result)`.
5. Five-tier locator fallback at replay time: `exact ref → stable hash → xpath → ax name → attribute`, reordered by Experience statistics.

### Non-scope

- Writing to `experience_locator_prefs` in `B-012` — that's a follow-up item.
- Cross-user sharing / import / export (Stage 4a).
- Marketplace or community features (Stage 5d).
- Modifying Memory schema except for the `aggregated_at` column.

### Definition of Done

- `experience_suggest_plan` returns non-null for repeat GitHub tasks after ≥ 10 completed sessions on the same `(pageRole, intent)`.
- K5 (`懂用户`) measurable at ≥ 30% on the GitHub baseline (hit rate climbing toward 60% target as more runs accumulate).
- Aggregator is idempotent: running twice over the same Memory state yields identical Experience rows.
- `pnpm --filter @tabrix/tabrix test` green with ≥ 4 aggregator tests (empty / single-session / idempotent replay / failure counts).

### Linked `B-*`

- ✅ `B-005` — Experience schema seed (done).
- ✅ `B-012` — Experience action-path aggregator (done).
- ⬜ `B-013` — `experience_suggest_plan` / `experience_replay` / `experience_score_step` MCP tools.

### Notes for incoming AI

- Tabrix is **execution layer, not Agent** (PRD §1, P4). `experience_suggest_plan` returns a plan — the upstream LLM decides to adopt or not. Do not add "auto-pick the plan" logic in Tabrix.
- `intent_signature` normalization is the hidden hard part: "list issues in repo X" and "show issues from repo X" must hash to the same bucket. Current v1 is intentionally light (lowercase + trim + collapse spaces); revisit only when bucket quality evidence requires it.
- The `step_sequence` JSON in B-012 v1 is `{ toolName, status, historyRef }` — preserve `historyRef` so replay can re-fetch the same page snapshot.

---

## 4. Stage 3c · Recovery Watchdog Consolidation

- **Layer**: `E` + `P`
- **KPI**: `更稳` · `更准`
- **Priority**: `P1` · **Size**: `M` · **Dependencies**: none (can run in parallel with Wave 1)
- **Status**: pool — `B-014`.

### Scope

1. `RecoveryWatchdog` interface: `{ trigger, pageRoleScope, recoverySteps, cooldownMs }`.
2. Migrate four existing fallbacks to watchdog pattern:
   - `dialog-prearm.ts` — native dialog auto-accept / dismiss.
   - `interaction.ts` — click / fill fallback on stale refs.
   - `screenshot.ts` — CDP → content-script fallback.
   - `read-page.ts` — sparse-tree fallback.
3. Reserve — not implement — extension points for `captcha` / `rate-limit` / `stale-session` / `login-expired`.
4. Optional: add session-level mutex (à la `mcp-server-browserbase`) if the watchdog flow reveals races.

### Non-scope

- Implementing captcha or rate-limit watchdogs.
- Changing any tool's public contract.
- Centralizing unrelated state machines.

### Definition of Done

- The four existing fallbacks compile through a single `RecoveryWatchdog` interface.
- No change in tool behaviour (regression tests green).
- `docs/TESTING.md` documents how to inject a synthetic failure to test a watchdog.
- K4 (`更稳`) baseline for `bridge recovery failure rate` captured in Memory for future comparison.

### Linked `B-*`

- ⬜ `B-014` — Recovery Watchdog table consolidation.

### Notes for incoming AI

- This is a **refactor** — do not let it become "add six new watchdogs in one PR." Scope is _consolidate existing four_, not _add new_.
- `cooldownMs` must be respected per page/session; a broken cooldown makes the watchdog oscillate.
- Add an `architecture-debt-review` per `AGENTS.md` rule 15 after three consecutive commits on this Stage.

---

## 5. Stage 3d · `read_page(render='markdown')` + Agent Step Envelope

- **Layer**: `K` + `M`
- **KPI**: `省 token`
- **Priority**: `P1` · **Size**: `S` · **Dependencies**: none
- **Status**: pool — `B-015`.

### Scope

1. `chrome_read_page(render = 'json' | 'markdown')` — default stays `json`; no breaking change.
2. `memory_page_snapshots.readable_markdown` column (lazy-computed on demand).
3. Optional: `agentStep` envelope JSON schema published to `packages/shared/src/` for MCP clients that want to embed the schema in a prompt.

### Non-scope

- HTML → markdown rules beyond what the existing `get_web_content` tool already does.
- Adding a new MCP tool.
- Changing the default render.

### Definition of Done

- `render='markdown'` round-trips through `read_page`; p95 token count for the GitHub baseline is ≥ 40% below `render='json'`.
- Snapshot recall: if the same page returns `render='markdown'` twice, the markdown is stable (same `contentHash` → same bytes).
- `pnpm --filter @tabrix/extension test` adds ≥ 5 tests.

### Linked `B-*`

- ⬜ `B-015` — `read_page(render='markdown')` + unit tests.

### Notes for incoming AI

- The markdown path must not bypass the HVO extractor — upstream LLMs still want `highValueObjects[]` even when prose is markdown. The response shape becomes `{ render: 'markdown', markdown: string, highValueObjects: [...] }`.
- Do not reintroduce `@tabrix/markdown-worker` or similar deleted surfaces without a governance decision (`AGENTS.md` → Removed Surfaces).

---

## 6. Stage 3e · Run History UI (Sidepanel "Memory" Tab)

- **Layer**: `M`
- **KPI**: `懂用户` (operator/self-diagnose value)
- **Priority**: `P1` · **Size**: `M` · **Dependencies**: none
- **Status**: **DONE** — Sprint 1+2 shipped the core surface.

### Scope (shipped)

- `B-001` — Native-server `/memory/*` read API (sessions list, steps drill-down, task fetch).
- `B-002` — Sidepanel Memory tab session list (paginated, status colour dot, step count pill, duration).
- `B-003` — Session → step drill-down with per-step status, tool name, duration, error surfacing, "Copy historyRef" button.
- `B-006` — Status filter chips + search + "jump to last failure" button.

### Non-scope (deferred)

- Server-side search (`GET /memory/sessions?q=`) — future backlog candidate.
- Virtual scrolling — paginate instead (20 rows/page default, cap 500).
- Variable-snapshot inspector (comes back under a different Stage once Experience aggregates it).

### Definition of Done

- ✅ Sidepanel Memory tab renders 20 recent sessions by default; clicking expands to steps; copying `historyRef` works; filter + search + jump-to-failure all functional.
- ✅ No re-introduction of the removed Smart Assistant / AgentChat surface.
- ✅ Bundle size under the 25/40 kB JS and 20/22 kB CSS gates (`scripts/check-bundle-size.mjs`).

### Linked `B-*` (all `done`)

- ✅ `B-001`, `B-002`, `B-003`, `B-006`.

### Notes for incoming AI

- Future Memory-tab features (variable snapshots, action-path visualiser) must reuse the `useMemoryTimeline` composable — do not fork state management.
- The composable was deliberately placed under `entrypoints/shared/composables/` so the popup can later consume the same source.

---

## 7. Stage 3f · Policy Capability Opt-in Standardisation

- **Layer**: `P` + `M`
- **KPI**: `更稳` (auditability)
- **Priority**: `P1` · **Size**: `S` · **Dependencies**: none
- **Status**: pool — `B-016`.

### Scope

1. `TabrixCapability` enum: `vision | elevated_js | download | devtools | testing | cross_origin_nav`.
2. Each P2/P3 tool declares its required capability (`tools.ts`).
3. Env: `TABRIX_POLICY_ALLOW_P3` → `TABRIX_POLICY_CAPABILITIES` (back-compat for ≥ 6 months).
4. `MemoryAction.policyCapabilities` field (for the Insights tab and future audits).
5. Hook for Stage 4b's origin/siteId dynamic policy (reserved interface, no implementation yet).

### Non-scope

- Per-siteId dynamic policy (Stage 4b).
- UI for capability toggling (sidepanel Policy surface is later).
- Breaking the existing `TABRIX_POLICY_ALLOW_P3` env.

### Definition of Done

- All P3 tools have a named capability; `TABRIX_POLICY_ALLOW_P3=1` still unlocks them all for back-compat.
- `packages/shared/src/tools.ts` publishes `TabrixCapability`.
- Native-server policy gate reads capability from the tool annotation, not a separate table.
- `pnpm -r typecheck` and gate tests green.

### Linked `B-*`

- ⬜ `B-016` — `TabrixCapability` enum + env migration.

### Notes for incoming AI

- Policy-layer changes are owner-lane work per `AGENTS.md` "Tiered Execution Model" → "Fast-lane must not do" §2. Any AI assistant that picks this up must stay in owner-lane (design → write it down → then execute), not delegate it down to a mechanical fast-lane pass.
- Keep the deprecation friendly: if `TABRIX_POLICY_ALLOW_P3=1` is set, keep unlocking P3 for six months, and log a deprecation warning once per process.

---

## 8. Stage 3g · API Knowledge · Network-Layer Awareness

> **The biggest competitive gap today** — zero surveyed competitor treats site APIs as first-class Knowledge.

- **Layer**: `K` + `P`
- **KPI**: `省 token` (largest) · `更快` · `更准`
- **Priority**: `P0` · **Size**: `L` · **Dependencies**: `Stage 3f` (capability framework)
- **Status**: pool — `B-017`.

### Scope

1. **Capture layer**: opt-in XHR/fetch listener (`chrome.debugger.attach` + `Network.requestWillBeSent/responseReceived`). Default **off**, gated by capability `knowledge.capture_api`.
2. **Aggregation layer**: collapse repeated requests into `KnowledgeApiEndpoint`:
   ```ts
   interface KnowledgeApiEndpoint {
     siteId: string;
     pageRole?: string;
     method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
     urlPattern: string; // /api/v3/repos/:owner/:repo/issues
     requestSchema?: JsonSchema;
     responseSchema?: JsonSchema;
     paginationHint?: 'offset' | 'cursor' | 'none';
     authRequired?: boolean;
     rateLimitHint?: string;
     seenCount: number;
     lastSeenAt: string;
   }
   ```
3. **MCP tools**:
   - `knowledge_describe_api(siteId, pageRole?) → endpoints[]`.
   - `knowledge_call_api(endpointId, params)` — reuses the user's real Chrome cookies (the moat: cloud browsers cannot).
4. **Privacy / Policy**:
   - Default off; Sidepanel shows an explicit opt-in switch per `siteId`.
   - PII redaction (`token` / `password` / `email` patterns) runs **before** the row lands in SQLite.
   - Per-site on/off.
5. **Milestone**: GitHub first — cover `issues`, `actions`, `workflow_runs`, `prs`, `contents` (5 endpoints).

### Non-scope

- Cross-user / cross-machine API catalog sharing (out — siteId-level sharing of `urlPattern` and `responseSchema` only; no payload sharing).
- Non-HTTP protocols (WebSocket, SSE) — later.
- Auto-calling APIs the user has not explicitly opted into.

### Definition of Done

- On GitHub, after one capture session, `knowledge_describe_api(siteId: 'github.com')` returns ≥ 5 endpoints with valid JSON schemas.
- `knowledge_call_api` round-trips against at least `GET /repos/:owner/:repo/issues` using real cookies.
- Privacy test: PII fixtures (`authorization: Bearer …`, `password: …`, `email: foo@bar.com`) never land in the SQLite row.
- A fresh install has the capability disabled; opting in is a conscious Sidepanel action.

### Linked `B-*`

- ⬜ `B-017` — API Knowledge capture + schema + redact (XL — may split).

### Notes for incoming AI

- `chrome.debugger.attach` is a P3 path (per PRD §1, P3 low-footprint pillar). This Stage is an **intentional, opted-in P3 branch** — keep the opt-in default off, and never leave debugger attached on tab close.
- PII redact must run **before** `INSERT` — adding a post-hoc scrubber is not acceptable (privacy leaks happen between capture and redact otherwise).
- GitHub API surface is the MVP; do not add Douyin / Xiaohongshu endpoints until GitHub is Beta.

---

## 9. Stage 3h · Context Strategy Selector

> **The single largest `省 token` lever on the planning side.**

- **Layer**: `K` + `E`
- **KPI**: `省 token` (largest) · `更快` · `懂用户`
- **Priority**: `P0` · **Size**: `L` · **Dependencies**: `Stage 3a` + `Stage 3b` + `Stage 3d` + `Stage 3g` all at least `Beta`
- **Status**: pool — `B-018`.

### Scope

1. New MCP tool `tabrix_choose_context(intent, url?, constraints?) → ContextBundle`:
   ```ts
   interface ContextBundle {
     strategy:
       | 'api_only'
       | 'knowledge_light'
       | 'read_page_markdown'
       | 'read_page_json'
       | 'experience_replay'
       | 'read_page_json_plus_ui_map';
     reasoning: string;
     artifacts: Array<{
       kind:
         | 'experience'
         | 'knowledge_api'
         | 'knowledge_ui_map'
         | 'read_page'
         | 'markdown'
         | 'historyRef';
       payload: unknown;
       tokenEstimate: number;
     }>;
     tokenBudget: number;
     fallbackStrategy?: string;
   }
   ```
2. Rule table (seed data in Knowledge Registry):
   `intent pattern × siteId known? × pageRole known? × has Experience? × has API Knowledge? → strategy`.
3. Self-learning: every adopted strategy + its outcome (success/fail, duration, tokens) writes back to Memory; next call re-ranks by success rate.
4. Stage 3h is the **consumer** of Experience (Stage 3b is the producer).

### Non-scope

- Writing strategy preferences back to Knowledge Registry seed (Stage 5a).
- Server-side model to pick strategies — rule-based only in v1.
- Cross-user strategy sharing.

### Definition of Done

- For the top-10 repeat GitHub intents, `tabrix_choose_context` picks `api_only` or `experience_replay` (not `read_page_json`) in ≥ 70% of calls once Stage 3g + 3b are Beta.
- Aggregate token cost on the GitHub baseline drops by ≥ 25% vs. the pre-3h line (measured via MCP-side input-token tallies).
- Rule table is data, not code — adding a rule does not require a TS edit.

### Linked `B-*`

- ⬜ `B-018` — `tabrix_choose_context` + seed decision table.

### Notes for incoming AI

- This Stage is valuable **only when its four dependencies are at least Beta**. Starting it early produces `read_page_json` as the default fallback every time — no K1 movement.
- Do not turn this into "Tabrix is now an agent." It picks a context, not a next step.

---

## 10. Stage 3i · Memory Insights Table + Sidepanel Insights Tab

- **Layer**: `M` + `E`
- **KPI**: `更准` (long-term)
- **Priority**: `P2` · **Size**: `M` · **Dependencies**: `Stage 3e` (shared Sidepanel UI layer)
- **Status**: pool — `B-019`.

### Scope

1. New table `memory_insights`:
   ```ts
   interface MemoryInsight {
     id: string;
     type:
       | 'unexpected_failure'
       | 'locator_flaky'
       | 'retry_loop'
       | 'fallback_triggered'
       | 'policy_denied'
       | 'api_schema_drift';
     severity: 'info' | 'warn' | 'error';
     siteId?: string;
     pageRole?: string;
     toolName?: string;
     sampleSessionId: string;
     sampleActionId: string;
     occurrences: number;
     suggestion?: string;
     firstSeenAt: string;
     lastSeenAt: string;
     status: 'new' | 'acknowledged' | 'copied_to_issue' | 'wont_fix';
   }
   ```
2. Sidepanel "Insights" tab — severity-sorted list, dedup + occurrences count, one-click "copy as issue markdown" (clipboard only, **no network**).
3. Aggregation: periodic scan of recent Memory rows flags the six `type` patterns above.

### Non-scope

- Auto-filing GitHub issues (PRD §8 — never, until `AGENTS.md` governance decision).
- Anonymous telemetry upload — Stage 5+ candidate.
- ML-based anomaly detection — static rules only in v1.

### Definition of Done

- `memory_insights` is written to for all six `type` values on synthetic fixtures.
- Sidepanel Insights tab renders + copies markdown; clipboard round-trip verified.
- No network request originates from this Stage.

### Linked `B-*`

- ⬜ `B-019` — `memory_insights` table + Sidepanel tab.

### Notes for incoming AI

- **Never** add a "file this upstream" button in v1. Clipboard-only is a product invariant.
- Copy-as-issue markdown should include `historyRef`, page URL, tool name, occurrence count, first/last seen — enough for a human to triage without opening Tabrix.

---

## 11. Stage 4a · Experience Local Import / Export (Community Seeding)

- **Layer**: `E`
- **KPI**: `懂用户` (long-term community compounding)
- **Priority**: `P1` · **Size**: `M` · **Dependencies**: `Stage 3b` at `Beta`
- **Status**: pool — `B-020`.

### Scope

1. `experience_export(taskIntent | pageRole | all) → JSON file`.
2. `experience_import(file) → diff + dry-run + user confirm`.
3. **PII redact** pre-export: regex-match `password | token | authorization | cookie | session` (case-insensitive) and strip unless the user opts to keep.
4. Schema versioning: `experienceSchemaVersion: 1`; cross-version auto-migrate on import.
5. Trust: import forces a `dry-run` preview listing the locator prefs / action paths that would be overwritten; user confirms before any write.

### Non-scope

- Networked marketplace / community ratings / remote pull (Stage 5d).
- Differential diff UI beyond "added X, overwriting Y".
- Signing / notarization (Stage 5d).

### Definition of Done

- Round-trip export → import on the same machine preserves the `(pageRole, intent)` buckets bit-exact.
- PII regex test: injected secrets in Memory are absent from the export file.
- Dry-run is not bypassable (no "force import" flag).

### Linked `B-*`

- ⬜ `B-020` — `experience_export` / `experience_import` + redact + dry-run.

### Notes for incoming AI

- Marketplace / networked sharing is explicitly later. Stage 4a is **local file** only. Do not add a "publish" button.
- PII redact defaults to "strip"; the user must explicitly opt in to keep secrets — never the other way around.

---

## 12. Stage 4b · Policy Dynamic Context

- **Layer**: `P`
- **KPI**: `更稳` · `更准`
- **Priority**: `P1` · **Size**: `M` · **Dependencies**: `Stage 3f` + `Stage 3g` + Memory aggregation ready
- **Status**: no `B-*` yet.

### Scope

1. `PolicyContext = { toolName, pageRole, siteId, recentFailureRate, apiEndpointCalled }` passed into every gate call.
2. Dynamic re-tiering: e.g. `chrome_javascript` is P2 on `github.com/issues`, but P3 on `bank.com`.
3. User-level override layer — individuals can **tighten** policy (not loosen — loosening is a repo owner call).
4. Audit log UI (subset of `memory_insights`).

### Non-scope

- Machine learning on policy decisions — static rules + Memory signals only.
- Cross-organisation policy sharing.

### Definition of Done

- Policy decisions referenced in Memory include full `PolicyContext` (searchable in Insights).
- At least one working re-tier rule (e.g. `chrome_javascript` on `bank.com` is P3 even when env allows P3 globally on GitHub — demonstrable).

### Notes for incoming AI

- Do not weaken any existing P3 tool as a side-effect. Re-tier should be one-way (stricter) unless the repo owner explicitly opts in via PR.

---

## 13. Stage 4c · Knowledge Stage 4 · Douyin + Cross-Site Family

- **Layer**: `K`
- **KPI**: `更准` (coverage expansion)
- **Priority**: `P2` · **Size**: `M` · **Dependencies**: `Stage 3a` stable
- **Status**: no `B-*` yet.

### Scope

1. Migrate all rules in `read-page-understanding-douyin.ts` (and Creator Center) to Registry seeds.
2. Abstract a "Video/Social family" (Douyin, Bilibili, YouTube share patterns: feed, creator panel, comments, upload).
3. Retire hardcoded TS adapters where Registry covers them.

### Non-scope

- Adding a new family (e.g. "search engine family") in the same Stage.
- Public benchmarks against competitors on non-GitHub sites (later).

### Definition of Done

- All Douyin TS adapter code goes through `docs/KNOWLEDGE_STAGE_1.md` + `STAGE_2.md` Registry paths.
- Parity test on Douyin matches the pre-migration TS adapter output byte-for-byte on representative fixtures.

### Notes for incoming AI

- Any Douyin-specific fixture lives in the private `tabrix-private-tests` repo, **not** this repo (`AGENTS.md` rule 17).
- Do not paste real Douyin DOM into a public test file.

---

## 14. Stage 5a · Experience Self-Learning Writeback

- **Layer**: `K` + `E`
- **KPI**: `懂用户` · `更准`
- **Priority**: future · **Size**: `L` · **Dependencies**: Stage 3b + 3h stable for ≥ one sprint
- **Status**: no `B-*` yet.

### Scope

Tabrix automatically mines successful locator / path preferences from Memory + Experience and writes candidate rows to a **Knowledge candidate area**. A human (repo maintainer) reviews before promoting to Registry seed.

### Non-scope

- Automatic writeback without human review.
- Cross-user pooled learning (would break privacy invariants).

### Definition of Done

- The repo maintainer runs a weekly review pass; ≥ 5 candidate rows / week on active sites.
- No `memory_insights` row for `api_schema_drift` or `locator_flaky` triggers a direct Knowledge write without human approval.

---

## 15. Stage 5b · Knowledge Graph Upgrade

- **Layer**: `K`
- **KPI**: `更准` · `懂用户`
- **Priority**: future · **Size**: `XL` · **Dependencies**: Stage 3a + 3g + 4c all stable
- **Status**: no `B-*` yet.

### Scope

Upgrade the flat Registry tables into a graph: `Site × Page × Object × Action × API`, with edges `LINKS_TO` / `HAS_REGION` / `CONTAINS_OBJECT` / `LEADS_TO` / `SUCCEEDS` (inspired by GitNexus schema). Enables:

- "next candidate action" inference.
- Similar-path recall.
- Failure-path avoidance.

### Non-scope

- Vector embeddings over the graph (Stage 5+, and only if semantic search returns to the roadmap).
- Externalising to Neo4j / a separate graph DB — graph runs on top of existing SQLite.

### Definition of Done

- TBD — pending Stage 5a maturity.

---

## 16. Stage 5c · WebMCP Bridge

- **Layer**: `X`
- **KPI**: `更快` · `省 token`
- **Priority**: future · **Size**: `L` · **Dependencies**: WebMCP standardisation externally
- **Status**: no `B-*` yet.

### Scope

When a site ships WebMCP endpoints, Tabrix acts as a bridge: forward to WebMCP if present; fall back to `read_page + HVO` otherwise.

### Non-scope

- Implementing WebMCP ourselves before it stabilises externally.
- Site-side WebMCP injection.

### Definition of Done

- TBD — pending WebMCP spec maturity.

---

## 17. Stage 5d · Experience Marketplace

- **Layer**: `E`
- **KPI**: `懂用户`
- **Priority**: future · **Size**: `XL` · **Dependencies**: Stage 4a stable for ≥ 6 months
- **Status**: no `B-*` yet.

### Scope

Signed + trust-scored + community-distributed Experience bundles. Networked import/export with provenance and malicious-recipe detection.

### Non-scope

- Until Stage 4a (local import/export) has shipped and matured.
- Monetisation.

### Definition of Done

- TBD — pending Stage 4a maturity.

### Notes for incoming AI

Anything labelled "marketplace" before Stage 4a is green for ≥ 6 months is premature; block the PR and ask.

---

## 18. Stage 5e · Personal `userPreference` Layer

- **Layer**: `M`
- **KPI**: `懂用户`
- **Priority**: future · **Size**: `M` · **Dependencies**: Memory has accumulated ≥ 3 months of data
- **Status**: no `B-*` yet.

### Scope

Memory gains `user_preferences { key, value, sourceSessionId, confidence }` — captured from recurring patterns (e.g. "user always picks repo X when asked about issues").

### Non-scope

- Cross-user pooling.
- Marketing copy that calls this "personalisation" before the column exists.

### Definition of Done

- TBD.

---

## 19. Cross-Cutting Tracks (Not Stage-Scoped)

### 19.1 Tool-contract correctness

Inspired by `B-023` (`chrome_click_element` false-success defect). Every tool ships a response contract that distinguishes:

- `dispatchSucceeded` — did the content-script path even run?
- `observedOutcome` — what actually changed (enum: `cross_document_navigation | spa_route_change | hash_change | new_tab_opened | dialog_opened | menu_opened | state_toggled | selection_changed | dom_changed | focus_changed | download_intercepted | no_observed_change | verification_unavailable`).
- `verification` — raw signal booleans.
- `success` — derived, never synonymous with "the promise resolved".

**Next candidates**: `chrome_fill_or_select`, `chrome_keyboard`, `chrome_navigate` need the same treatment, each as its own `B-*`.

### 19.2 Infrastructure guardrails

- `scripts/check-bundle-size.mjs` — JS 25/40 kB, CSS 20/22 kB (B-007 + B-021).
- Schema-cite rule for any Memory / Knowledge / Experience or shared DTO touch (B-009).
- `docs/EXTENSION_TESTING_CONVENTIONS.md` — `fetch` / `AbortController` / `chrome.storage` patterns (B-008).
- Architecture-review checkpoint every 3 consecutive `feat:` / `fix:` commits on the same MKEP layer (`AGENTS.md` rule 15).

### 19.3 Removed-surface invariant

Before adding any MCP tool / background listener / sidepanel tab / shared type, check against `AGENTS.md` → Removed Surfaces. If the change resurrects any of those surfaces **under any name**, stop and surface the question.

---

## 20. Current-Sprint Snapshot (2026-W19 · Sprint 3)

(Live snapshot — update at each sprint review; authoritative copy is in [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md).)

| Sprint         | State               | Items                                                                |
| -------------- | ------------------- | -------------------------------------------------------------------- |
| Sprint 1 (W17) | `closed 2026-04-20` | `B-001..B-004` all done.                                             |
| Sprint 2 (W18) | `closed 2026-04-20` | `B-005..B-009` all done.                                             |
| Sprint 3 (W19) | **active**          | `B-010 done · B-021 done · B-023 done · B-012 done · B-022 planned`. |

### Next sprint candidates (Sprint 4, seeded from pool)

Pick in this order unless something blocks:

1. `B-011` — Stable `targetRef` (finishes Stage 3a properly).
2. `B-013` — `experience_suggest_plan` MCP tool (Stage 3b closes the write + read loop).
3. `B-015` — `read_page(render='markdown')` (Stage 3d, small and high-K1).
4. `B-016` — `TabrixCapability` enum (Stage 3f, unblocks Stage 3g).

Do not pull `B-017` (API Knowledge) until `B-016` is at least in `review` — API Knowledge depends on the capability framework.

---

## 21. Changelog

| Version  | Date       | Change                                                                                                                                                                                                                                  |
| -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v1.0.0` | 2026-04-21 | First consolidated Stage-level roadmap. Supersedes the roadmap portion of [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md) (kept as historical reference). Covers `Stage 3a → 5e` (17 stages) with DoD + `B-*` mapping. |
