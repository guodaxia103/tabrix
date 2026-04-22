# Tabrix Product Requirements Document (PRD)

> **Version**: `v1.0.0` (2026-04-21) — first consolidated repo-internal PRD.
> **Status**: `Active / Product Single Source of Truth (SoT)`.
> **Language**: English (canonical). Chinese mirror: [`PRD_zh.md`](./PRD_zh.md).
> **Audience**: every AI assistant (Codex, Claude, Cursor, Cline, …) and human contributor that touches this repository.
> **Supersedes**: the "PRD" role previously scattered across [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md), [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md), `AGENTS.md`, and the private Feishu "Tabrix PRD v1" doc.
> **Companion**: [`TASK_ROADMAP.md`](./TASK_ROADMAP.md) — Stage-level execution plan from `Stage 3a` through `Stage 5e`.

---

## 0. How to Read This Document

This PRD is **the product-level single source of truth** for Tabrix. It answers:

- What is Tabrix? Who does it serve? Who does it deliberately not serve?
- What are the hard architectural constraints that must not drift?
- How do Memory / Knowledge / Experience / Policy (MKEP) fit together?
- What is the roadmap at the Stage level, and how does it map to sprint-level `B-*` items?
- What is an AI assistant not allowed to do to the product story?

This PRD **does not** duplicate:

- Sprint-level execution — see [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md).
- Stage-level execution detail — see [`TASK_ROADMAP.md`](./TASK_ROADMAP.md).
- Public capability tiers — see [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md).
- Tool schemas — see [`TOOLS.md`](./TOOLS.md) and `packages/shared/src/tools.ts`.
- Development rules — see [`AGENTS.md`](../AGENTS.md) and `docs/AI_DEV_RULES` (if present).
- Release gates — see [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md).

When this PRD and a downstream doc disagree, fix the downstream doc — except where the "arbitration order" in §12 says otherwise.

---

## 1. One-Sentence Definition (Inviolable)

> **Tabrix turns a user's real, logged-in Chrome browser into an AI-executable runtime exposed via MCP.**

Four pillars. **If a feature, PR, or doc breaks any pillar, it is off-product and must be refused until the PRD is updated first.**

| #   | Pillar                         | Means                                                                                                                                              | The opposite (forbidden)                                                                          |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| P1  | **Real logged-in Chrome**      | Default path reuses the user's daily Chrome profile: existing logins, cookies, extensions, and tabs are preserved.                                 | Defaulting to a fresh Chromium / headless / Playwright runtime.                                   |
| P2  | **MCP-native**                 | All capabilities are exposed through MCP (`stdio` + `Streamable HTTP`, both tier-1).                                                               | Shipping a private HTTP API, a closed SDK, or a browser-IDE as the primary surface.               |
| P3  | **Low-footprint takeover**     | Default automation path is `extension + Native Messaging + content-script + DOM`. `chrome.debugger` / CDP is an explicit, gated, high-risk branch. | Defaulting to `chrome.debugger` / CDP / remote-debugging-port attachment.                         |
| P4  | **Execution layer, not Agent** | Tabrix provides primitives (read, click, fill, recipe, plan-suggest). Planning, goal decomposition, and self-dialogue stay with the upstream LLM.  | Building Tabrix's own chat UI, task loop, "auto-decide next step" heuristic, or in-product Agent. |

Every downstream decision — architecture, tool surface, roadmap, naming — must be defensible by pointing to one or more of these four pillars.

---

## 2. Target Users

### 2.1 Primary users (served today)

1. **MCP-client power users**: users of Codex CLI, Claude Desktop, Cursor, Cline, Cherry Studio, Dify, Windsurf, and similar MCP hosts who want the assistant to act inside **their own real Chrome**.
2. **Back-office automation developers**: engineers automating read/write flows inside logged-in internal systems (CMS, ticketing, CRM, admin consoles, ops dashboards) where a headless runtime cannot reach.
3. **Technical teams that need AI in a real session**: teams for whom "rebuild the browser from scratch" is not acceptable — logins, extensions, and live context matter.

### 2.2 Secondary users (mentioned but not the default story)

1. Small teams sharing one Tabrix-enabled browser over LAN behind bearer-token auth.
2. DevOps teams integrating browser capabilities into internal workflows (webhook-triggered, CI-triggered).
3. Advanced users needing replay / evidence / Memory / Policy for compliance-adjacent work.

### 2.3 Users we deliberately do not yet serve

Any outward-facing doc that claims Tabrix **covers / supports / is ready for** any of the following is out of spec:

1. Large-enterprise browser-automation procurement (cross-team SLA, audit, RBAC).
2. Finance / healthcare / government regulated default deployment.
3. Cross-browser or cross-OS coverage beyond the declared compatibility matrix (Safari, Firefox; non-Chrome Chromium forks outside `PLATFORM_SUPPORT.md`).
4. Fully-automated, no-confirmation agents (Tabrix is **explicitly** not an autonomous agent — P4).

When public copy uses phrases like "enterprise-grade", "any website", "universal", "zero-config", "fully automated", `AGENTS.md` anti-drift rules require an AI assistant to **block the change** and ask for the PRD to update first.

---

## 3. What Tabrix Is Not (Exclusion List)

Regardless of whether code exists for these surfaces in history, they are not part of the current product promise. They must not appear in public README / store description / MCP-host directory / PR titles / commit messages as default capabilities.

1. Generic headless scraper / cloud browser automation platform.
2. DevTools-grade CDP product (default `chrome.debugger` / CDP attachment is a P3 branch, not the main path).
3. Browser IDE / visual workflow builder / Record-Replay v2/v3 marketing surface.
4. Local-LLM / vector DB / semantic-search product.
5. Agent operating system / autonomous "do my day job" agent.
6. Cross-browser, cross-OS enterprise SLA vendor.

The alignment matches:

- [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) — "Removed surfaces" section.
- [`PRODUCT_PRUNING_PLAN.md`](./PRODUCT_PRUNING_PLAN.md) — the executed pruning pass.
- `AGENTS.md` → `## Removed Surfaces — Must Not Be Reintroduced`.

---

## 4. North-Star KPIs

Tabrix is scored on **five dimensions**. These are the only KPIs that justify saying "Tabrix is getting better." Feature presence alone is **not** a promotion criterion.

| #   | Dimension                   | Metric                                       | Target (end of Stage 4)                                     | Measurement SoT                                              |
| --- | --------------------------- | -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| K1  | **省 token** (token-thrift) | Avg input tokens per task, upstream-MCP side | **−40%** vs. `v2.1.0` baseline                              | MCP per-request input token sum ÷ task count                 |
| K2  | **更快** (faster)           | p50 latency per tool                         | `click ≤ 800 ms` · `fill ≤ 1500 ms` · `read_page ≤ 2500 ms` | `memory_actions.endedAt − startedAt` rollup                  |
| K3  | **更准** (more correct)     | Multi-step task success rate                 | **≥ 85%**                                                   | `memory_sessions.status = 'completed'` ÷ total               |
| K4  | **更稳** (more stable)      | Retry + fallback + bridge-recovery failure   | `any-tool retry ≤ 10%` · `bridge recovery failure ≤ 2%`     | `memory_actions.retryCount > 0` ÷ total                      |
| K5  | **懂用户** (user-aware)     | Experience hit rate on repeat tasks          | **≥ 60%** after Stage 3b lands                              | `experience_replay` returned non-null AND adopted ÷ requests |

**Engineering contract**: every Stage / PR / backlog item must answer _"which KPI does this move, and by how much?"_. If the answer is _"none"_ the item is tooling / infra and must be labeled `Layer: X` in [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md).

Baselines, measurement periods, and sampling rules live in [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) and the per-KPI Memory / Experience views, not in this PRD.

---

## 5. Architecture — MKEP + Supporting Layers

Tabrix is a four-layer learning loop sitting on top of a tool surface and a transport layer.

```
 ┌────────────────────────────────────────────────────────────────┐
 │                       Upstream LLM (MCP client)                │
 │         Codex · Claude · Cursor · Cline · Cherry · Dify        │
 └──────────────┬─────────────────────────────────┬───────────────┘
                │ stdio / Streamable HTTP         │
 ┌──────────────▼─────────────────────────────────▼───────────────┐
 │                 Tabrix Tool Surface (28+ MCP tools)            │
 │   read · navigate · click · fill · screenshot · network · …    │
 │   (+ future Agent primitives: tabrix_choose_context · replay)  │
 └──────────────┬─────────────────────────────────────────────────┘
                │  Policy check (P0/P1/P2/P3 + capability opt-in) │
 ┌──────────────▼────────────────────────────────────────────────┐ │
 │              MKEP Core — the self-improving loop              │ │
 │                                                               │ │
 │   ┌──────────┐   ┌────────────┐   ┌────────────┐  ┌────────┐  │ │
 │   │  Memory  │──▶│ Knowledge  │──▶│ Experience │──│ Policy │  │ │
 │   │ (SQLite) │   │ (Registry) │   │  (replay)  │  │(gating)│  │ │
 │   └────▲─────┘   └─────▲──────┘   └─────▲──────┘  └────▲───┘  │ │
 │        │                │                 │             │     │ │
 │        └────────────────┴─── Recovery Watchdog ─────────┘     │ │
 └───────────────────────────────────────────────────────────────┘ │
                │                                                  │
 ┌──────────────▼──────────────────────────────────────────────────┘
 │              Browser Layer — real logged-in Chrome              │
 │       Chrome extension (MV3) + Native Messaging bridge          │
 │   Default path: content-script / DOM. P3 path: chrome.debugger  │
 └─────────────────────────────────────────────────────────────────┘
```

### 5.1 Memory

**Role**: persistent, replay-ready record of _what happened_ — Session → Task → Step with PageSnapshot + Action evidence.

**Current maturity**: ~45% — `memory_sessions` / `memory_tasks` / `memory_steps` persisted in SQLite (`app/native-server/src/memory/db/`); `memory_page_snapshots` + `memory_actions` land data; the Sidepanel Memory tab ships a readable timeline with filter + search + drill-down (`B-001`…`B-006`).

**Target**: every MCP tool call produces a replayable `{ historyRef, contentHash, targetRef, locator, outcome }` evidence row. Service restart must not forget anything.

**Gaps vs. target** (see `MKEP_CURRENT_VS_TARGET.md`):

- `historyRef` is wired into the DTO contract but only partially populated by `read_page`.
- `memory_actions.retryCount` / `fallbackUsed` are captured but not yet aggregated for K4.
- No cross-session aggregation for insights (`memory_insights` is Stage 3i).

**Code touchpoints**:

- `app/native-server/src/memory/**` — schema + repositories + SessionManager + post-processor.
- `app/chrome-extension/entrypoints/sidepanel/tabs/Memory*.vue` — viewer UI.
- `packages/shared/src/memory.ts` — cross-process DTO contract.

### 5.2 Knowledge

**Role**: _data-first_ description of the web — site profiles, page catalogs, primary-region rules, HVO (High-Value-Object) classifier seeds, UI map rules, API endpoints.

**Current maturity**: ~55% — Knowledge Registry Stage 1 + Stage 2 landed (GitHub site profile + HVO classifier seeded). Stage 3a just landed the first UI Map rules (`B-010`, 5 GitHub pairs).

**Target**: adding a new site is adding one seed file, not touching `read-page-understanding-<family>.ts`. Locator hints, API endpoints, and page catalogs all come from Registry data, not TS branches.

**Gaps vs. target**:

- `read_page` HVO `targetRef` is not yet stable across reloads (Stage 3a — `B-011`).
- Locator hints for non-GitHub families still in TS adapters.
- **API Knowledge is completely missing** — the biggest competitive gap (Stage 3g — `B-017`).
- Only GitHub is properly data-fied; Douyin and Creator Center still TS-first (Stage 4c).

**Code touchpoints**:

- `app/chrome-extension/entrypoints/background/knowledge/**` — seeds, registry, lookup.
- `app/chrome-extension/entrypoints/background/tools/browser/read-page-*.ts` — consumers.
- Neutrality invariant: `read-page-understanding-core.ts` must not contain site-specific vocabulary — enforced by `tests/read-page-understanding-core-neutrality.test.ts` (`AGENTS.md` rule 16).

### 5.3 Experience

**Role**: projection of Memory into _reusable action paths and locator preferences_ — "what worked last time on this page, for this intent."

**Current maturity**: ~35% — schema landed (`experience_action_paths` / `experience_locator_prefs`, `B-005`); aggregator landed in Sprint 3 (`B-012`) projecting terminal Memory sessions into `experience_action_paths` with idempotent replay guards; read-side MCP tool `experience_suggest_plan` landed in `B-013` (P0, native-handled).

**Target**: upstream LLM asks `experience_suggest_plan(intent, pageRole?)` → Tabrix returns the ranked action paths for that `(pageRole, intent)` bucket, with five-tier locator fallback. The plan is a **primitive** — the upstream LLM decides whether to adopt it.

**Gaps vs. target**:

- Write-side MCP tools (`experience_replay` / `experience_score_step`) not yet exposed — Stage 3b continuation (Sprint 4+, blocked on Policy review for the write/execute path).
- No import/export (Stage 4a — `B-020`).

**Code touchpoints**:

- `app/native-server/src/memory/db/schema.ts` — `EXPERIENCE_CREATE_TABLES_SQL`.
- `app/native-server/src/memory/experience/` — `experience-aggregator.ts` + `experience-repository.ts` (`B-012` first write path).
- `app/chrome-extension/entrypoints/sidepanel/tabs/ExperienceTab.vue` — placeholder UI.

### 5.4 Policy

**Role**: risk-tier gating for every MCP tool, with capability-based opt-in and (future) context-aware overrides.

**Current maturity**: ~40% — `TOOL_RISK_TIERS` (P0/P1/P2/P3) + `requiresExplicitOptIn` shipped in `packages/shared/src/tools.ts`; P3 tools are hidden by default unless allow-listed via env.

**Target**: Policy is context-aware — `PolicyContext = { toolName, pageRole, siteId, recentFailureRate, apiEndpointCalled }` allows dynamic risk re-tiering (e.g. `chrome_javascript` is P2 on GitHub issues page but P3 on `bank.com`).

**Gaps vs. target**:

- Static today — no pageRole / siteId context (Stage 4b).
- Capability opt-in is a boolean flag, not the full `TabrixCapability` enum (Stage 3f — `B-016`).
- No user-level override layer.

**Code touchpoints**:

- `packages/shared/src/tools.ts` — risk tier + opt-in annotations.
- `app/native-server/src/policy/**` — gate + allow-list.

### 5.5 Supporting layers

**Tool Surface (currently ~28 MCP tools)** — the actual callable surface. Tools are grouped in `packages/shared/src/tools.ts::TOOL_NAMES.BROWSER`. See §7.

**Transport** — `stdio` and `Streamable HTTP`, both GA. No third transport is on the roadmap; anything HTTP-like that is not MCP must be justified as an internal route (e.g. `/memory/*` sidepanel routes, which are NOT MCP tools — see `B-001`).

**Recovery Watchdog (future)** — Stage 3c consolidates the four existing fallbacks (dialog-prearm / interaction / screenshot / read-page sparse-tree) into a single `RecoveryWatchdog` family (B-014).

**Context Strategy Selector (future, strategic)** — Stage 3h adds `tabrix_choose_context(intent, url?)` → `ContextBundle` as the **single biggest token-thrift lever** (B-018). See §9.3 for rationale.

---

## 6. Capability Tiers

This PRD does **not** duplicate the capability tier table. The SoT is [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) with four tiers: `GA` · `Beta` · `Experimental` · `Internal`.

### 6.1 Hard constraints on tier promotion

1. Promoting a capability from `Experimental` → `Beta` or `Beta` → `GA` **must** land as a PR that edits `PRODUCT_SURFACE_MATRIX.md` first, before the README / store description / outward copy is touched.
2. The PR description must cite: (a) the promotion evidence, (b) the KPI movement (see §4), (c) the `B-*` backlog item that sealed the promotion, (d) the relevant `RELEASE_READINESS_CRITERIA_v2` gates.
3. `PRODUCT_SURFACE_MATRIX.md` wins any disagreement with README / store / roadmap — downstream copy is the follower, not the leader.
4. A capability labelled `Experimental` must **not** appear in `README.md` / `README_zh.md` / the Chrome Web Store listing as a default capability.

### 6.2 Current headline summary

(At the time of writing — verify against `PRODUCT_SURFACE_MATRIX.md` before quoting.)

| Capability area                                                                          | Tier           |
| ---------------------------------------------------------------------------------------- | -------------- |
| Real-Chrome execution via extension                                                      | `GA`           |
| MCP transport `stdio` + `Streamable HTTP`                                                | `GA`           |
| Core browser tools (read / navigate / click / fill / screenshot / network / diagnostics) | `GA`           |
| `status` / `doctor` / `smoke` / `report`                                                 | `GA`           |
| Remote access with bearer-token                                                          | `Beta`         |
| Policy P0–P3 + P3 opt-in                                                                 | `Beta`         |
| Knowledge Registry (GitHub site profile + HVO)                                           | `Beta`         |
| Memory persistence (Session / Task / Step / PageSnapshot / Action)                       | `Beta`         |
| Sidepanel Memory / Knowledge / Experience tabs                                           | `Experimental` |
| Experience replay / locator fallback / Recovery helpers                                  | `Experimental` |

---

## 7. MCP Tool Surface

### 7.1 Current tools (enumerated, risk-tiered)

The authoritative list is `packages/shared/src/tools.ts::TOOL_NAMES.BROWSER`. This table is a **snapshot** for onboarding; if it drifts from the code, the code wins.

| Tool                                                                                         | Risk          | Purpose (one line)                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_windows_and_tabs`                                                                       | P0            | List Chrome windows and tabs.                                                                                                                                        |
| `chrome_read_page`                                                                           | P0            | Structured page snapshot + HVO (primary reading tool).                                                                                                               |
| `chrome_get_interactive_elements`                                                            | P0            | List interactive elements with stable refs.                                                                                                                          |
| `chrome_get_web_content`                                                                     | P0            | Plain-text / markdown page content.                                                                                                                                  |
| `chrome_screenshot`                                                                          | P0            | Capture viewport / element screenshot.                                                                                                                               |
| `chrome_console`                                                                             | P0            | Read DevTools console output.                                                                                                                                        |
| `chrome_history`                                                                             | P0            | Query browser history (scoped).                                                                                                                                      |
| `chrome_bookmark_search`                                                                     | P0            | Query bookmarks.                                                                                                                                                     |
| `chrome_network_capture`                                                                     | P1            | Capture HAR-style network events.                                                                                                                                    |
| `chrome_navigate`                                                                            | P1            | Navigate the current/new tab.                                                                                                                                        |
| `chrome_switch_tab`                                                                          | P1            | Switch active tab.                                                                                                                                                   |
| `chrome_gif_recorder`                                                                        | P1            | Record a short GIF of the current tab.                                                                                                                               |
| `performance_start_trace` / `performance_stop_trace` / `performance_analyze_insight`         | P1            | Trace + lightweight summary.                                                                                                                                         |
| `chrome_click_element`                                                                       | P2            | Click with verified outcome contract (see `CLICK_CONTRACT_REPAIR_V1.md`, `B-023`).                                                                                   |
| `chrome_fill_or_select`                                                                      | P2            | Fill inputs / select options.                                                                                                                                        |
| `chrome_keyboard`                                                                            | P2            | Keyboard key dispatch.                                                                                                                                               |
| `chrome_handle_dialog`                                                                       | P2            | Accept / dismiss native dialogs.                                                                                                                                     |
| `chrome_handle_download`                                                                     | P2            | Accept / dismiss downloads.                                                                                                                                          |
| `chrome_close_tabs`                                                                          | P2            | Close specified tabs.                                                                                                                                                |
| `chrome_bookmark_add` / `chrome_bookmark_delete`                                             | P2            | Bookmark write.                                                                                                                                                      |
| `chrome_request_element_selection`                                                           | P2            | Ask user to pick an element (human-in-loop).                                                                                                                         |
| `chrome_javascript`                                                                          | P3 (opt-in)   | Run arbitrary JS in content world.                                                                                                                                   |
| `chrome_inject_script`                                                                       | P3 (opt-in)   | Inject a script into a tab.                                                                                                                                          |
| `chrome_send_command_to_inject_script`                                                       | P3 (opt-in)   | Send a command to an injected script.                                                                                                                                |
| `chrome_userscript`                                                                          | P3 (opt-in)   | Manage user scripts.                                                                                                                                                 |
| `chrome_upload_file`                                                                         | P3 (opt-in)   | File upload.                                                                                                                                                         |
| `chrome_computer`                                                                            | P3 (opt-in)   | Coordinate-level input (mouse/keyboard).                                                                                                                             |
| `chrome_network_capture_start` / `_stop` / `_request` / `_debugger_start` / `_debugger_stop` | P3 (internal) | Advanced network / debugger — internal, not surfaced to `listTools` by default.                                                                                      |
| `experience_suggest_plan`                                                                    | P0            | Read-only ranked action paths for `(intent, pageRole?)`. Native-handled (no extension round-trip). Memory-off → `status: 'no_match'` (graceful). Shipped in `B-013`. |

### 7.2 Forward-looking tools (planned, named in this PRD)

| Tool                     | Planned in              | Layer                  | Purpose                                                                                                   |
| ------------------------ | ----------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `tabrix_choose_context`  | Stage 3h (`B-018`)      | Knowledge + Experience | Given `(intent, url?)`, return the minimum-token `ContextBundle` — **largest K1 lever**.                  |
| `experience_replay`      | Stage 3b (post-`B-013`) | Experience             | Execute a previously-learned action path with variable substitution. Needs Policy review before exposure. |
| `experience_score_step`  | Stage 3b (post-`B-013`) | Experience             | Let the upstream LLM feed step outcomes back into Memory. Needs Policy review before exposure.            |
| `knowledge_describe_api` | Stage 3g (`B-017`)      | Knowledge              | List captured `KnowledgeApiEndpoint[]` for a site.                                                        |
| `knowledge_call_api`     | Stage 3g (`B-017`)      | Knowledge              | Call a site API using the user's logged-in Chrome cookies.                                                |

### 7.3 Tool-surface invariants

1. Tools **must** declare a risk tier. Ship-gate: `TOOL_RISK_TIERS[toolName]` has a matching entry.
2. Low-footprint first — P0/P1/P2 tools must not default to CDP/`chrome.debugger`. If a tool needs CDP, it is P3.
3. Tool names must reflect risk — a Safe-named tool with a Debugger-backed implementation is a naming defect.
4. Every tool response must allow the caller to distinguish **success**, **dispatch-succeeded-but-no-outcome**, **failure**, and **fallback-used**. The `chrome_click_element` post-`B-023` shape is the reference pattern (see `packages/shared/src/click.ts`).
5. Adding / removing a tool, or changing a schema, is a Policy-layer decision (`AGENTS.md` → "Tiered Execution Model" → "Fast-lane must not do" §2) — any AI assistant running fast-lane must escalate instead of deciding unilaterally.

---

## 8. What We Deliberately Do Not Build (Strategic Moats)

| Anti-pattern                               | Representative competitor                   | Why Tabrix refuses                                                                                                           |
| ------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Cloud-hosted browser as default path       | Browserbase / stagehand / browser-use cloud | Breaks P1 (real logged-in Chrome).                                                                                           |
| In-house headless engine                   | Lightpanda                                  | Investment mismatch; breaks P1.                                                                                              |
| Block-based visual workflow as the product | automa                                      | Breaks P4 (we're execution layer, not workflow SaaS). We may borrow the run-history UI idea; we will not become the product. |
| LLM rewriting the runtime harness          | browser-harness                             | Breaks auditability; breaks P3 (low-footprint).                                                                              |
| In-page JS copilot                         | page-agent                                  | Value-add is cross-tab / cross-site, not single-page.                                                                        |
| Arbitrary JS as a primary interface        | playwriter `execute`                        | Breaks Policy Phase 0; we keep `chrome_javascript` as P3 opt-in.                                                             |
| Tabrix running its own Agent main loop     | —                                           | Breaks P4. Planning stays with the upstream LLM. We expose primitives, not decisions.                                        |
| Auto-filing GitHub issues from Memory      | —                                           | Privacy + token-cost + false-positive risk. Replaced by local `memory_insights` + manual copy (Stage 3i).                    |
| Networked Experience marketplace           | —                                           | Phase-0 is local file import/export + PII redact (Stage 4a); marketplace is Stage 5+.                                        |

An AI assistant catching a change that violates any of the above must **block** and ask the user, not implement-and-ask-later.

---

## 9. Strategic Differentiation (Moats Worth Repeating)

Three things that, if executed, make Tabrix unambiguously distinct from the 14 surveyed competitors. All three are already in the roadmap but worth stating explicitly because they are **where the thesis is bet**.

### 9.1 Real logged-in Chrome + MCP-native

The only product of this shape today. Cloud-browser vendors cannot reuse the user's real cookies. Pure MCP servers lack browser control. Tabrix is the intersection.

### 9.2 MKEP — self-improving execution layer

Every call flows through the same `Memory → Knowledge → Experience → Policy` loop. Each call makes the next call cheaper / faster / more correct. No surveyed competitor ships the full loop.

### 9.3 Context Strategy Selector (Stage 3h, the token-thrift engine)

Every competitor's angle is "give the LLM one more table (snapshot / markdown / HVO / screenshot)." Nobody ships "**only give the LLM the one table it actually needs**, chosen by rule."

`tabrix_choose_context(intent, url?, constraints?) → ContextBundle` will ingest `(intent, siteId, pageRole, has-Experience?, has-API-Knowledge?)` and route to the minimum-token strategy:

```
intent: "list issues in repo X"
  → strategy: api_only                        (~ 200 tokens, hit-rate ~100% once API Knowledge seeded)

intent: "analyze why workflow failed"
  → strategy: experience_replay + read_page json scoped     (~ 2 000 tokens)

intent: "explore unfamiliar site"
  → strategy: read_page(render='markdown') + observe        (~ 5 000 tokens, first time only)

intent: "fill a complex form"
  → strategy: read_page json (HVO stable refs) + knowledge.uiMap
```

This is the single largest K1 lever. It depends on Stage 3a / 3b / 3d / 3g all being at least `Beta`, which is why §11 lists these stages first.

### 9.4 API Knowledge (Stage 3g, the under-targeted gap)

Modern SPAs carry real semantics in XHR/fetch, not DOM. No surveyed competitor treats "site API catalog" as a first-class Knowledge entity. Capturing `urlPattern + request/response schema + pagination hint + auth` and exposing `knowledge_call_api` (which reuses the user's real Chrome cookies — something cloud browsers cannot do) simultaneously hits K1 (token-thrift), K2 (faster), and K3 (more correct).

---

## 10. Task Numbering System

Tabrix uses **three coordinated numbering systems**. They are not redundant — each covers a different abstraction.

### 10.1 `T*` — Feishu master task IDs (product-level semantics)

- Owned by the private Feishu "Tabrix master task table" (repository maintainer only).
- `T0..T15` define the product-level semantic contract: what each major product task is, owner, dependencies, status.
- **Not mirrored in this repo.** AI assistants must not invent new `T*` identifiers here. If a change needs a new `T*`, stop and ask the repo owner to open one upstream.

### 10.2 `B*` — Sprint backlog items (execution-level)

- Owned by [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) in this repo.
- Every non-trivial feature / refactor commit must cite a `B-*` ID in its commit body (`AGENTS.md` rule 20).
- Sizes: `S ≤ 0.5 day` · `M 0.5–1.5 day` · `L 1.5–3 days` · `XL > 3 days`.
- Merging `B-done` does **not** imply closing the parent `T*` — product-level close still requires Feishu-side sign-off and release readiness evidence.

### 10.3 `Stage 3a..5e` — MKEP roadmap stages

- Owned by [`TASK_ROADMAP.md`](./TASK_ROADMAP.md) (new) and the legacy [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md).
- Stage is the **strategic** unit: "UI Map data-fication" = Stage 3a.
- One Stage maps to one or more `B-*` items.

### 10.4 Cross-reference rule

| Level | Question it answers                               | Where it lives       |
| ----- | ------------------------------------------------- | -------------------- |
| `T*`  | "Is this product task still in scope?"            | Feishu (owner-only)  |
| Stage | "What is the strategic goal, why does it matter?" | `TASK_ROADMAP.md`    |
| `B*`  | "What does this week's PR do?"                    | `PRODUCT_BACKLOG.md` |

When in doubt, a change is `B*`. An AI assistant **must not** create a new `Stage` identifier — new Stages are a roadmap-level decision.

---

## 11. Roadmap at a Glance (Stage-Level)

Full detail, DoD, and `B-*` mapping lives in [`TASK_ROADMAP.md`](./TASK_ROADMAP.md). This section exists only to let a first-time reader see the shape.

```
Wave 1 (near-term, parallelizable)
  3a · Knowledge UI Map + stable targetRef       (B-010 done; B-011 next)
  3d · read_page(render='markdown')              (B-015 pool)
  3g · API Knowledge (XHR/fetch capture)         (B-017 pool) ← biggest K1 lever
  3f · Policy capability opt-in enum             (B-016 pool)

Wave 2 (depends on Wave 1)
  3b · Experience action-path replay             (B-005 schema done, B-012 done, B-013 done — write-side replay/score_step deferred)
  3c · Recovery Watchdog consolidation           (B-014 pool)

Wave 3 (strategic payoff)
  3h · Context Strategy Selector                 (B-018 pool) ← biggest K1 lever (planning side)
  3e · Run History UI                            (B-001…B-006 done — finished early)
  3i · Memory Insights table + Sidepanel tab     (B-019 pool)

Wave 4 (user-value amplification)
  4a · Experience import/export + PII redact     (B-020 pool)
  4b · Policy dynamic context                    (future)
  4c · Douyin + cross-site family migration      (future)

Wave 5 (long horizon, no dates)
  5a · Experience self-learning writeback
  5b · Knowledge Graph upgrade (Site × Page × Object × Action × API)
  5c · WebMCP Bridge
  5d · Experience Marketplace (signed, trust-scored, community)
  5e · Personal userPreference layer
```

---

## 12. Arbitration Order (When SoTs Disagree)

When documents conflict, apply top-down. The higher doc wins. If the higher doc is wrong, fix it in the same PR as the downstream correction — do **not** silently invert.

1. [`AGENTS.md`](../AGENTS.md) — development rules.
2. **This PRD** — product identity + anti-drift.
3. [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) + release readiness criteria — shipping gates.
4. [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) — capability tiers.
5. [`TASK_ROADMAP.md`](./TASK_ROADMAP.md) — Stage-level execution.
6. [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) — sprint-level `B-*`.
7. [`TOOLS.md`](./TOOLS.md) + `packages/shared/src/tools.ts` — tool contracts.
8. [`SECURITY.md`](../SECURITY.md) — security model (hard-overrides others on safety-critical calls).
9. Feishu master task table — owner-only product task status.
10. Other repo docs / Feishu docs — supporting material.

`SECURITY.md` is deliberately below this PRD on product identity but above everything else when the topic is "is this safe to ship." AI assistants: when unsure, treat `SECURITY.md` as higher-priority.

---

## 13. Anti-Drift Clauses (Hard Constraints for AI Assistants)

These clauses are enforced. A PR violating any of them must be blocked by the AI assistant itself, before the user has to notice.

### 13.1 Product narrative must defer to this PRD

When generating README / marketing copy / commit bodies / PR descriptions:

1. This PRD.
2. `PRODUCT_SURFACE_MATRIX.md`.
3. `RELEASE_PROCESS.md` + release readiness criteria.
4. `ROADMAP.md`.
5. `README.md` / `README_zh.md`.

Downstream docs follow upstream. Reverse inference — "README says X, so the PRD must be wrong" — is banned.

### 13.2 No site-specific vocabulary in core layers

Enforced by `tests/read-page-understanding-core-neutrality.test.ts`. Anything site-specific (GitHub / Douyin / vendor consoles) goes in a `*-<family>.ts` adapter.

### 13.3 No unfounded capability claims

Banned phrases in public copy unless `PRODUCT_SURFACE_MATRIX.md` carries matching evidence: **"enterprise-grade"** · **"any website"** · **"universal"** · **"zero-config"** · **"GA"** (before the `GA` gate passes) · **"out-of-the-box"** (before `QUICKSTART.md` documents a verifiable first-success path).

### 13.4 No double SoT

- Do not copy this PRD's sections into README / ROADMAP as a "local SoT".
- Do not copy the Feishu master task table into `docs/` as a "local backup."
- Do not redefine shared types inline in commit messages or code comments.
- Reference upstream (link + section + version). Never mirror.

### 13.5 No silent tier promotion

Changing `Experimental → Beta` or `Beta → GA` requires a PR editing `PRODUCT_SURFACE_MATRIX.md` **first**, with promotion evidence attached. Edits to README that describe an un-promoted capability as `GA` are anti-drift and must be reverted.

### 13.6 No new `T*` IDs in-repo

If work requires a new master task ID, stop and escalate to the repo owner. Do not invent `T16` / `T17` in a commit or doc.

### 13.7 No PRD-as-SoT substitution

"This PRD said X" is never the final answer on an implementation question. Implementation answers live in:

- Capability tier → `PRODUCT_SURFACE_MATRIX.md`.
- Release gate → `RELEASE_PROCESS.md`.
- Tool schema → `packages/shared/src/tools.ts`.
- Security model → `SECURITY.md`.
- Dev rules → `AGENTS.md`.
- Task status → `PRODUCT_BACKLOG.md` + Feishu.

This PRD gives the product identity; it does not answer schema questions.

### 13.8 No silent removal of hard constraints

Any removal or weakening of a clause in §1 / §3 / §8 / §13 must list the original text in the PR description, explain why, update `AGENTS.md` cross-references, and pass `pnpm run docs:check`.

---

## 14. Change Governance

### 14.1 How this PRD is changed

1. Open a `docs/…` branch; edit `docs/PRD.md` (+ `docs/PRD_zh.md` mirror).
2. Bump the version header to `v<major>.<minor>.<patch>` with a date stamp.
3. In the PR description, classify the change: `new clause` / `clause strengthened` / `clause weakened` / `clause removed`.
4. For `weakened` or `removed`, list the original text of every affected clause.
5. Run `pnpm run docs:check`.
6. After merge, add a line to §16 (Changelog) in the same commit — not a follow-up.

### 14.2 Review cadence

1. Full PRD review runs at every milestone version bump (`v2.x` → `v2.(x+1)`).
2. A lightweight review runs after each sprint closes — usually just "does §11 still match `PRODUCT_BACKLOG.md`?"

---

## 15. Related Sources of Truth

### 15.1 Repository (public)

- [`TASK_ROADMAP.md`](./TASK_ROADMAP.md) — Stage-level execution plan (companion to this PRD).
- [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) — sprint-level `B-*` SoT.
- [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) — capability tier registry.
- [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md) — legacy roadmap (kept as reference; top-note points back here).
- [`MKEP_CURRENT_VS_TARGET.md`](./MKEP_CURRENT_VS_TARGET.md) — gap analysis per layer.
- [`KNOWLEDGE_STAGE_1.md`](./KNOWLEDGE_STAGE_1.md) / [`KNOWLEDGE_STAGE_2.md`](./KNOWLEDGE_STAGE_2.md) — Knowledge foundations.
- [`MEMORY_PHASE_0.md`](./MEMORY_PHASE_0.md) / [`_0_2`](./MEMORY_PHASE_0_2.md) / [`_0_3`](./MEMORY_PHASE_0_3.md) — Memory foundations.
- [`POLICY_PHASE_0.md`](./POLICY_PHASE_0.md) — Policy foundations.
- [`CLICK_CONTRACT_REPAIR_V1.md`](./CLICK_CONTRACT_REPAIR_V1.md) — click-tool contract rebuild (B-023).
- [`TOOLS.md`](./TOOLS.md) — tool schemas.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) + [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) — code map.
- [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) + [`PLATFORM_SUPPORT.md`](./PLATFORM_SUPPORT.md) + [`COMPATIBILITY_MATRIX.md`](./COMPATIBILITY_MATRIX.md) — shipping.
- [`SECURITY.md`](../SECURITY.md) + [`ERROR_CODES.md`](./ERROR_CODES.md) — safety + errors.
- [`AGENTS.md`](../AGENTS.md) — dev rules.
- `README.md` / `README_zh.md` / `CHANGELOG.md` / `CONTRIBUTING.md`.

### 15.2 Private (repo-owner only — **do not mirror in-repo**)

- Feishu "Tabrix PRD v1" (this PRD's upstream twin).
- Feishu "Tabrix 主任务管理总表" (`T*` status).
- Feishu "Tabrix 任务编号治理与 SoT 规范" (T/B/Stage contract).
- Feishu "Tabrix 产品决策日志" (decision log).
- Feishu "Tabrix 可交付产品能力落地路线图" (delivery sequencing).

The repo owner maintains these. AI assistants **must not** reference Feishu URLs in public files.

---

## 16. Changelog

| Version  | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v1.0.0` | 2026-04-21 | First consolidated repo-internal PRD. Merges the previous split between `PRODUCT_SURFACE_MATRIX.md` (capability tiers), `MKEP_STAGE_3_PLUS_ROADMAP.md` (de-facto product vision), `AGENTS.md` prose (some narrative leaked into rules), and the private Feishu "Tabrix PRD v1". Introduces the Stage-level companion `TASK_ROADMAP.md`. `MKEP_STAGE_3_PLUS_ROADMAP.md` is kept as a historical reference with a top-note redirect. |
