# Tabrix Product Backlog

> Living, sprint-granular task list. Single source of truth for "what Claude and Codex work on this week."
>
> - Versioning: human-edited; regenerated weekly on Sunday by the active AI assistant.
> - Reading order: this doc **after** `AGENTS.md` and `docs/TASK_ROADMAP.md`.
> - Every backlog item (`B-NNN`) has: Stage tag, KPI tag, Owner, Size, Dependencies, Branch, Exit Criteria.
> - If a PR does not reference a `B-NNN` ID (or explain why not), it's out of spec — see `AGENTS.md` rule 20.

## Legend

| Field      | Values                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| **Stage**  | `3a` / `3b` / `3c` / `3d` / `3e` / `3f` / `3g` / `3h` / `3i` / `4a` / `4b` / `4c` / `5a..e`     |
| **Layer**  | `M` (Memory) / `K` (Knowledge) / `E` (Experience) / `P` (Policy) / `X` (cross-cutting)          |
| **KPI**    | 省 token · 更快 · 更准 · 更稳 · 懂用户                                                          |
| **Owner**  | `Claude` (architect + implementation) / `Codex fast` (mechanical only, see AGENTS.md) / `Human` |
| **Size**   | `S` ≤ 0.5 day · `M` 0.5–1.5 day · `L` 1.5–3 days · `XL` > 3 days (split before scheduling)      |
| **Status** | `planned` / `in_progress` / `review` / `done` / `blocked`                                       |

## Previous Sprint — Sprint 1 (2026-W17, 2026-04-20 → 2026-04-26) — **CLOSED 2026-04-20**

**Theme**: Stage 3e · light up the Sidepanel Memory tab with real SQLite run history.

**Demo outcome** (what the human should see at end of sprint): open the extension sidepanel → Memory tab → list of recent 20 Sessions with their Tasks and Steps; click through to a Step to see `pageRole`, `historyRef` (copyable), action counts, and wall-clock duration.

**Out of scope for Sprint 1**: Experience aggregation, API Knowledge capture, pageRole-indexed recipes. Those are Sprint 2+.

**Outcome**: all four items (B-001 / B-002 / B-003 / B-004) shipped and merged on 2026-04-20 — see `docs/SPRINT_1_RETRO.md` for metrics, deviations, and action items carried into Sprint 2.

### B-001 · Native-server: expose Memory read API

- **Stage**: 3e · **Layer**: M · **KPI**: 懂用户
- **Owner**: Claude · **Size**: S · **Status**: `done` (merged 2026-04-20, commit `1e18087`)
- **Dependencies**: none (builds on existing `memory/db/client.ts`)
- **Branch**: `feat/b-001-memory-read-api`
- **Schema note**: the MKEP Memory schema is `Task (1) → Session (N) → Step (N)` — each session belongs to exactly one task. The original "sessions/:id/tasks" and "tasks/:id/steps" shape conflicted with this and was corrected in-flight.
- **Scope**:
  - Add repository read methods on `SessionRepository` (no schema change):
    - `listRecent(limit: number, offset: number): SessionSummary[]` — SQL JOIN with `memory_tasks` + subquery step count, ordered `started_at DESC, session_id DESC`.
    - `countAll(): number` — for pagination total.
  - Add read methods on `SessionManager` (public surface for routes): `listRecentSessionSummaries`, `countAllSessions`, `getStepsForSession`, `getTaskOrNull`.
  - Expose as HTTP routes under `/memory/*` in `app/native-server/src/server/memory-routes.ts` (factory module — matches the "future route groups" note in `routes/index.ts`):
    - `GET /memory/sessions?limit=&offset=` (default 20, max 500)
    - `GET /memory/sessions/:sessionId/steps`
    - `GET /memory/tasks/:taskId` (404 when unknown)
  - Wire into `server/index.ts::setupRoutes()`.
  - Auth: inherits the global `onRequest` Bearer/loopback hook (no route-local override).
  - Response envelope: `{ status: 'ok' | 'error', data: ... }` with `data.persistenceMode` on every memory response so the sidepanel can surface "persistence off" neutrally.
- **Exit criteria**:
  - `pnpm --filter @tabrix/tabrix test` passes with ≥ 3 new tests (1 per route, happy path + empty-result path). Actual delivery: 5 new repo tests + 8 new route tests.
  - `GET /memory/sessions` responds in < 50 ms for a 1,000-row DB (baseline memory fixture).
  - No write path is exposed. Unit test asserts POST/PUT/DELETE against `/memory/*` return 404.
  - `docs/CLI_AND_MCP.md` gets a short section explaining these are HTTP-only internal routes (not MCP tools — they're sidepanel data, not LLM context).

### B-002 · Extension: Memory tab session list

- **Stage**: 3e · **Layer**: M · **KPI**: 懂用户
- **Owner**: Claude · **Size**: M · **Status**: `done` (merged 2026-04-20, commit `be8dc2d`)
- **Dependencies**: **B-001** (done)
- **Branch**: `feat/b-002-memory-tab-session-list`
- **Landed scope** (what was actually shipped; deviations from the original plan are flagged):
  - New shared DTO module `packages/shared/src/memory.ts` — canonical typing for every `/memory/*` response consumed cross-process. Server and sidepanel now share the same field names.
  - New HTTP client `app/chrome-extension/common/memory-api-client.ts` — pure functions (`fetchRecentSessions`, `fetchSessionSteps`, `fetchMemoryTask`) + typed `MemoryApiError` taxonomy (`network` / `http` / `shape`). Resolves native-server port via `chrome.storage.local.nativeServerPort` (fallback 12306) — same pattern as the popup.
  - New composable `entrypoints/shared/composables/useMemoryTimeline.ts` (placed in `shared/` not `sidepanel/` so the popup can reuse it later): reactive `{ status, sessions, total, offset, persistenceMode, errorMessage, errorKind, hasNextPage, hasPrevPage, isEmpty, load, reload, nextPage, prevPage, dispose }`. Concurrent calls abort in-flight requests to avoid stale-overwrite races.
  - `tabs/MemoryTab.vue` rewritten to render: 4-state UI (idle/loading/empty/error), 20-row paginated list with `status` colour dot, step count pill, per-row duration, and Previous/Next controls. Footer shows `N–M of Total`. Respects `prefers-color-scheme: dark`.
  - **Deviation from original plan**: used a plain scrollable list instead of DOM virtualization — real virtualization only pays off at 100s of rows, but the server caps us at 20 per page by default; we paginate instead. Documented here so B-003+ doesn't silently assume virtualization infrastructure exists.
  - **Deviation from original plan**: composable lives in `shared/composables/` (not `sidepanel/composables/`) so the popup can later surface "last session status" from the same source.
- **Exit criteria**:
  - `pnpm -r typecheck` passes.
  - `pnpm --filter @tabrix/extension test` passes — 249 tests total, +20 new tests across `tests/memory-api-client.test.ts` (13) and `tests/use-memory-timeline.test.ts` (7).
  - Bundle size delta ≤ +8 KB for the sidepanel chunk. **Measured**: `sidepanel.js` 5.43 kB → 11.91 kB (+6.48 kB), `sidepanel.css` 7.62 kB → 11.26 kB (+3.64 kB). Within budget.
  - Manual browser check (user-side): open sidepanel → Memory tab → list renders when the native server is reachable; shows typed error states otherwise.

### B-003 · Extension: Memory session → step drill-down

- **Stage**: 3e · **Layer**: M · **KPI**: 懂用户
- **Owner**: Claude · **Size**: L · **Status**: `done` (merged 2026-04-20, commit `2efef71`)
- **Dependencies**: **B-001**, **B-002** (both done)
- **Branch**: `feat/b-003-memory-drilldown`
- **Schema note**: under the corrected `Task (1) → Session (N) → Step (N)` schema there is no "session → task" drill-down to do — each session already belongs to exactly one task, whose title/intent is embedded in the session row. The original "session → task → step" 3-level spec collapses to "session → step" with the task acting as context. Documented here so future sprints do not re-open the wrong drill-down shape.
- **Landed scope**:
  - `useMemoryTimeline` extended with `expandedSessionId`, per-session reactive `stepsBySession` cache, `toggleExpansion`, `reloadSteps`, `getStepsSlot`. Each session gets its own `AbortController`, so rapid open/close on different rows never races.
  - `common/memory-api-client.ts` gained two pure helpers reused from the UI and by tests: `extractHistoryRef(step)` returns the first `memory://…` entry from `artifactRefs` (or `null`), and `copyTextToClipboard(text)` with an `execCommand` fallback for sandboxes without the async clipboard API.
  - New SFC `tabs/MemorySessionSteps.vue` renders the inline expanded area: per-step index, status dot (reuses the colour scheme from B-002), `toolName`, duration, one-line result/input summary, error code + message (red border for failed steps), "retry" badge for `stepType === 'retry'`, and a "Copy historyRef" button that becomes "Copied ✓" for 1.5 s on success. Button is disabled when the step has no memory ref — clearer than silently copying an empty string.
  - `MemoryTab.vue` wraps each session row in a toggle button with `aria-expanded` / `aria-controls`, plus a rotating caret. Focus ring uses `:focus-visible` only, so pointer users don't see the ring on click.
  - **Deviation from original plan**: inline expansion instead of a right-side drawer — sidepanel width (~400 px) makes drawer UX cramped, and inline keeps users in the list context.
- **Exit criteria**:
  - `pnpm -r typecheck` passes.
  - `pnpm --filter @tabrix/extension test` passes — 262 tests total (+13 new in `tests/memory-drilldown.test.ts` across state machine, cache, copy helpers, error surfacing, refetch, independent-session caching, and dispose/abort).
  - Manual browser check (user-side): open Memory tab → click any recent session → inline steps render with duration, status colours, and a working "Copy historyRef" for `chrome_read_page` steps.
  - Bundle size (cumulative vs. pre-B-002): `sidepanel.js` 5.43 kB → 17.59 kB (+12.16 kB), `sidepanel.css` 7.62 kB → 16.13 kB (+8.51 kB). B-003's own marginal cost: +5.68 kB JS, +4.87 kB CSS — well within what a full drill-down UI should take.

### B-004 · Codex fast task · Add JSDoc + it.todo skeleton for B-001 repo methods

- **Stage**: 3e · **Layer**: M · **KPI**: —
- **Owner**: **Codex fast** (attempted) → **Claude** (landed) · **Size**: S · **Status**: `done` (merged 2026-04-20, commit `ada3b12`)
- **Dependencies**: **B-001** merged to main
- **Branch**: `chore/b-004-memory-repo-jsdoc`
- **Scope (tight, per `AGENTS.md` Codex rules)**:
  - Add JSDoc blocks to the 3 new methods from B-001: each block must include `@param`, `@returns`, and a `@remarks` line saying "read-only; paginate with limit ≤ 500 to keep sidepanel renders < 50 ms".
  - In `app/native-server/src/memory/session-repo.test.ts` (and the two siblings), append `describe.skip('listRecent / listBySessionId / listByTaskId (integration)', () => { it.todo('...'); })` for the 8 following cases (Claude will implement bodies next sprint):
    1. returns empty array on virgin db
    2. respects `limit`
    3. respects `offset`
    4. orders by `startedAt` desc
    5. does not leak unrelated sessions when filtering by id
    6. throws typed error on malformed id
    7. handles 10k-row pagination consistency
    8. respects `better-sqlite3` transaction boundary
- **Codex must not** (per AGENTS.md): add real test bodies, touch method signatures, touch route files, or add any new import.
- **Exit criteria**:
  - `pnpm -r typecheck` passes.
  - `pnpm --filter @tabrix/tabrix test` passes (new `it.todo`s do not count as failures).
  - Diff is contained in the 3 JSDoc blocks + 3 test files; Claude reviews and pushes.
- **Landed 2026-04-20 (Codex fast attempted, Claude finished)**: JSDoc on 4 read methods (`SessionRepository.listRecent`, `SessionRepository.countAll`, `StepRepository.listBySession`, `TaskRepository.get`) + 24 `it.todo` placeholders across `session-repository.test.ts`, `step-repository.test.ts`, `task-repository.test.ts`.
- **Codex delegation post-mortem**: the `codex exec` run (fast mode, `workspace-write` sandbox) stopped before any substantive edit because the Windows sandbox denied writes to `.git/index.lock`, so it could not honour the "commit-or-stop" contract in this prompt. Only LF→CRLF line-ending noise landed; reverted. Claude completed the task manually. Action for Sprint 2: either (a) invoke Codex with `--dangerously-bypass-approvals-and-sandbox` inside a clean worktree where `.git` is writable, or (b) keep the constraint and relax "must commit" to "must stage + write handoff note"; pick one and update `AGENTS.md` Codex Delegation Rules accordingly.

## Previous Sprint — Sprint 2 (2026-W18, 2026-04-20 → 2026-04-20) — **CLOSED 2026-04-20**

All five backlog items landed on day one of the nominal sprint window. Outcome: see `docs/SPRINT_2_RETRO.md` for what went well, what friction surfaced (most notably the `status: 'ok'` envelope trap documented in B-008), and the handoff into Sprint 3. Nothing slipped.

**Theme**: _Stage 3b Experience schema seed + Stage 3e polish + infra guardrails_. Balance: one schema-layer seed that unblocks Sprint 3+ aggregator work, one user-visible UI refinement on the Memory tab, and the three action items carried over from `docs/SPRINT_1_RETRO.md` §7.

**Demo outcome** (what the human should see at end of sprint):

1. Sidepanel Memory tab now has a **status filter chip row** (all / running / completed / failed / canceled) + a free-text search box (matches task title or intent); "jump to last failure" button scrolls to the nearest failed session on the current page.
2. Native-server ships with two new empty Experience tables (`experience_action_paths`, `experience_locator_prefs`) and their migrations — `SELECT * FROM sqlite_master` shows them, but no aggregator writes to them yet. This is deliberate: Sprint 3+ items B-012/B-013 depend on this schema landing first.
3. CI now hard-fails any PR that pushes `sidepanel.js` past the bundle-size threshold (see B-007 for the exact number — pinned to the post-B-006 baseline + 5 kB headroom).
4. `docs/EXTENSION_TESTING_CONVENTIONS.md` exists as the one-stop reference for the `fetch` / `AbortController` / `chrome.storage` mocking patterns that tripped us up in Sprint 1.
5. `AGENTS.md` has a new invariant: every `B-NNN` touching Memory / Knowledge / Experience must cite the actual repository file + line of the schema it builds on, before implementation starts.

**Out of scope for Sprint 2**: Experience aggregator logic (that's B-012, Sprint 3+), `experience_suggest_plan` MCP tool (B-013), Policy Phase 0.1 risk retiering (moved to Sprint 3 — needs a dedicated risk review that would crowd this sprint).

**Execution order** (each item should merge before the next starts so Claude can rebase cleanly, except where noted as parallelisable):

1. **B-005** (schema seed) — independent, lands first.
2. **B-006** (Memory filter/search) — independent of B-005; may run in parallel but must not share the same PR.
3. **B-007** (CI bundle gate) — must run AFTER B-006 merges so the threshold reflects post-B-006 size.
4. **B-008** (testing conventions doc) — captures lessons from B-005 + B-006; can run in parallel with B-007.
5. **B-009** (Codex fast re-attempt) — last, re-tests the Codex handoff protocol with the new "draft-only" shape from `AGENTS.md`.

### B-005 · Native-server: seed Experience schema (empty tables + migrations)

- **Stage**: 3b · **Layer**: E · **KPI**: — (enabling item; unblocks Sprint 3+ B-012/B-013)
- **Owner**: Claude · **Size**: M · **Status**: `done` (merged 2026-04-20, commit `3770201`)
- **Dependencies**: none (new schema, no touch to Memory/Knowledge tables)
- **Branch**: `feat/b-005-experience-schema-seed`
- **Schema cite**: builds alongside existing Memory schema at `app/native-server/src/memory/db/schema.ts` (the migration scaffolding used for `memory_tasks`/`memory_sessions`/`memory_steps`). Two new tables, same migration style:
  - `experience_action_paths`
    - `action_path_id TEXT PRIMARY KEY`
    - `page_role TEXT NOT NULL` (e.g. `github.repo.home`, `generic.form`)
    - `intent_signature TEXT NOT NULL` (normalised intent hash, populated by aggregator in B-012)
    - `step_sequence TEXT NOT NULL` (JSON sequence; `B-012` v1 writes an ordered list of `{ toolName, status, historyRef }`)
    - `success_count INTEGER NOT NULL DEFAULT 0`
    - `failure_count INTEGER NOT NULL DEFAULT 0`
    - `last_used_at TEXT NULL` (ISO timestamp)
    - `created_at TEXT NOT NULL`
    - `updated_at TEXT NOT NULL`
    - Index: `(page_role, intent_signature)` — composite, used by future `experience_suggest_plan` lookups.
  - `experience_locator_prefs`
    - `locator_pref_id TEXT PRIMARY KEY`
    - `page_role TEXT NOT NULL`
    - `element_purpose TEXT NOT NULL` (e.g. `search-box`, `submit-button`)
    - `preferred_selector_kind TEXT NOT NULL` (`role` / `text` / `data-testid` / `css` — enforced at the app layer)
    - `preferred_selector TEXT NOT NULL`
    - `hit_count INTEGER NOT NULL DEFAULT 0`
    - `last_hit_at TEXT NULL`
    - `created_at TEXT NOT NULL`
    - `updated_at TEXT NOT NULL`
    - Index: `(page_role, element_purpose)`.
- **Scope**:
  - Extend `schema.ts` migration runner with a new migration step (`migrate_v?_experience_seed`) that creates both tables + indexes. Must be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
  - Add new folder `app/native-server/src/memory/experience/` with `index.ts` re-exporting the two table names as exported constants (no repository class yet — empty surface).
  - Update `docs/MKEP_STAGE_3_PLUS_ROADMAP.md` §Stage 3b to say "schema landed in Sprint 2 (B-005); aggregator scheduled for B-012".
- **Must not do**: write any INSERT/UPDATE code against these tables (that's B-012). Do not expose MCP tools. Do not touch the extension package.
- **Exit criteria**:
  - `pnpm --filter @tabrix/tabrix test` passes, plus ≥ 3 new tests:
    1. Migration creates both tables on a virgin DB.
    2. Migration is idempotent (running twice does not error, does not duplicate indexes).
    3. Both tables are empty after migration (no seed data).
  - `pnpm -r typecheck` passes.
  - No changes in `app/chrome-extension/**` or `packages/shared/**`.
- **Landed scope (2026-04-20)**:
  - `app/native-server/src/memory/db/schema.ts` exports new `EXPERIENCE_CREATE_TABLES_SQL` constant with the two tables + 4 indexes exactly as specified above. **Idempotency**: every statement is `CREATE … IF NOT EXISTS`, same pattern as Memory.
  - `app/native-server/src/memory/db/client.ts`: `openMemoryDb()` now execs both `MEMORY_CREATE_TABLES_SQL` and `EXPERIENCE_CREATE_TABLES_SQL` in sequence on every open. No new migration runner — the existing "IF NOT EXISTS on open" discipline is enough at this stage; documented as a design choice in the `schema.ts` JSDoc block.
  - New module `app/native-server/src/memory/experience/index.ts` exports `EXPERIENCE_ACTION_PATHS_TABLE`, `EXPERIENCE_LOCATOR_PREFS_TABLE` string constants + `EXPERIENCE_SELECTOR_KINDS` const tuple / `ExperienceSelectorKind` type. No repository class yet, as specified.
  - New test file `app/native-server/src/memory/experience/schema.test.ts` adds **4 tests** (one over-delivery vs. the "≥ 3" bar): tables exist, expected indexes exist, re-exec is idempotent, both tables empty on virgin DB.
  - `docs/MKEP_STAGE_3_PLUS_ROADMAP.md` §4.2 Stage 3b gets a "进度（Sprint 2 · B-005）" paragraph noting the schema has landed and aggregator/MCP tooling is still B-012/B-013.
  - **Deviation from brief**: original scope said "Extend schema.ts migration runner with a new migration step (`migrate_v?_experience_seed`)". In reality, Memory never introduced a numbered migration runner — it relies on `CREATE TABLE IF NOT EXISTS` at open. B-005 follows the **actual** pattern to avoid introducing a migration framework for a single idempotent seed. If/when an in-place schema change is needed, a real runner lands as its own backlog item.
  - **Footprint**: 0 changes in `app/chrome-extension/**`, 0 changes in `packages/shared/**`. Full monorepo test suite still green (`@tabrix/tabrix`: 172 → 176 passed / 24 skipped).

### B-006 · Extension: Memory tab filter + search + jump-to-last-failure

- **Stage**: 3e · **Layer**: M · **KPI**: 懂用户 · 更快
- **Owner**: Claude · **Size**: L · **Status**: `done` (merged 2026-04-20, commit `5f37ed4`)
- **Dependencies**: B-002 and B-003 merged (both `done`)
- **Branch**: `feat/b-006-memory-tab-filter-search`
- **Schema cite**: extends the read-side contract in `packages/shared/src/memory.ts` (the DTO module B-002 introduced); native-server surface already exists — `MemorySessionSummary.status` and `MemorySessionSummary.taskTitle` / `taskIntent` are enough for client-side filtering. **Do not** add a new backend endpoint for this — server-side search is a Sprint 3+ candidate and needs its own `B-NNN`.
- **Scope**:
  - In `useMemoryTimeline`: add `statusFilter: Ref<Set<MemorySessionStatus> | 'all'>` and `searchQuery: Ref<string>`; derive a `filteredSessions` computed that applies both filters locally to the already-paginated `sessions`. Clear filters does not trigger a network refetch.
  - Add `jumpToLastFailure()` method: returns the `sessionId` of the most recent `failed` session in the current page, or `null`.
  - In `MemoryTab.vue`: status chip row (5 chips: `all` / `running` / `completed` / `failed` / `canceled`; `all` deselects the others), free-text search input (matches `taskTitle` OR `taskIntent`, case-insensitive, trimmed). Button "↓ Jump to last failure" appears only when current page has ≥ 1 failed session; on click, scrolls the matching row into view and momentarily highlights it (`animation: row-flash 600ms`).
  - Accessibility: chips are `role="radiogroup"`; search input has `aria-label="Search memory by task title or intent"`.
  - Edge cases: empty filter result shows "No sessions match your filters" inside the existing empty-state slot; clearing filters restores full list.
  - Dark mode must be respected (use the same CSS variables as B-002).
- **Must not do**: add a server-side `GET /memory/sessions?q=` endpoint (future Sprint 3+ item). Do not touch `memory-api-client.ts` signatures.
- **Exit criteria**:
  - `pnpm -r typecheck` passes.
  - `pnpm --filter @tabrix/extension test` passes with ≥ 8 new tests across a new `tests/memory-filter.test.ts` file:
    1. `all` chip shows everything.
    2. Selecting `failed` hides others.
    3. Multi-chip selection works (running + completed).
    4. Search matches title case-insensitively.
    5. Search matches intent when title doesn't.
    6. Empty search string is a no-op.
    7. `jumpToLastFailure()` returns the correct id.
    8. Clearing both filters restores full list without refetch.
  - Sidepanel bundle size delta ≤ +6 kB JS, ≤ +3 kB CSS vs. post-B-003 baseline (17.59 / 16.13).
  - Manual browser check (user-side): filtering works on a live session list; "jump to last failure" scrolls and highlights.
- **Landed scope (2026-04-20)**:
  - `app/chrome-extension/entrypoints/shared/composables/useMemoryTimeline.ts`: new exported `MemoryStatusChip` type, `MEMORY_STATUS_CHIPS` readonly tuple, and `chipToStatuses(chip)` helper (the "running" chip expands to `['running', 'starting']` — documented inline). Composable API grew `statusFilter` / `searchQuery` Refs, `filteredSessions` / `hasActiveFilters` / `lastFailedSessionId` Computeds, and `toggleStatusChip` / `clearFilters` / `jumpToLastFailure` methods. No new network requests — filtering is 100 % client-side against the already-paginated page.
  - `app/chrome-extension/entrypoints/sidepanel/tabs/MemoryTab.vue`: new chip row (All + 4 status chips) with `role="radiogroup"` + `aria-checked` on each chip; `<input type="search">` bound via a computed v-model to the composable's `searchQuery`; conditional `↓ Jump to last failure` button; new empty-state variant ("No sessions match your filters"); `scrollIntoView` + `memory-row-flash` 900 ms highlight on jump. List now iterates `timeline.filteredSessions.value`. Pager shows `(showing N)` badge when a filter is active.
  - `app/chrome-extension/tests/memory-filter.test.ts` (new): **11 tests** (over the "≥ 8" bar) covering all-default state, single chip, multi-chip OR, running→starting expansion, title/intent search, whitespace-only no-op, `jumpToLastFailure` in ordered-DESC list, post-filter null, `clearFilters` with no network call, and chip-toggle idempotency. Extension test count: 262 → 273.
  - Sidepanel bundle: `sidepanel.js` 17.59 kB → **21.00 kB (+3.41 kB, within +6 kB budget)**; `sidepanel-*.css` 16.13 kB → **18.24 kB (+2.11 kB, within +3 kB budget)**.
  - **Deviation from brief**: test file delivers 11 tests (not "≥ 8") because the "search whitespace-only no-op" and "toggle idempotency" were worth first-class coverage. Chip labels: "Canceled" is the user-facing label for the DB status `aborted` — spec said "canceled"; kept the existing DB name for the type/filter code and remapped only at the UI layer.
  - **Schema cite** (per the future B-009 rule): consumes `MemorySessionSummary.taskTitle / taskIntent / status` from `packages/shared/src/memory.ts`. No server-side schema touched.

### B-007 · Infra: CI bundle-size gate for `sidepanel.js`

- **Stage**: — · **Layer**: X · **KPI**: 更稳
- **Owner**: Claude · **Size**: S · **Status**: `done` (merged 2026-04-20, commit `6de2a4c`)
- **Dependencies**: **B-006 merged** (so the threshold reflects the real post-B-006 size)
- **Branch**: `chore/b-007-bundle-size-gate`
- **Scope**:
  - Add a small Node script `scripts/check-bundle-size.mjs` that reads `app/chrome-extension/.output/**/sidepanel.js` (or whatever the WXT build emits) and fails with a non-zero exit code + a clear message if the gzipped size exceeds the threshold. Warns (exit 0) between the "soft" and "hard" thresholds.
  - Thresholds pinned via constants at the top of the script:
    - Hard fail: **40 kB raw** (not gzipped — simpler to compare against the WXT output).
    - Soft warn: **25 kB raw**.
    - CSS is not gated in this sprint (future item).
  - Wire into `package.json` as `"size:check": "node ./scripts/check-bundle-size.mjs"` at the root.
  - Add a CI step AFTER the build step in the existing CI workflow (keep the rule "do not touch CI beyond what's directly needed" — this is the minimum edit).
- **Exit criteria**:
  - Script runs cleanly locally (`pnpm run size:check` after `pnpm run build`).
  - Threshold is documented in `AGENTS.md` "Default expectations" (add a one-line rule 21).
  - Post-B-006 size plus recorded delta is documented in this backlog entry under "Landed".
- **Landed scope (2026-04-20)**:
  - New script `scripts/check-bundle-size.mjs` — ESM, Node-only, no new deps. Resolves the most recently-mtime'd `sidepanel-*.js` under `app/chrome-extension/.output/chrome-mv3/chunks/`, prints `sidepanel bundle: <path> — <size>`, hard-fails (`exit 1`) above 40 kB, warns (`exit 0`) above 25 kB, errors (`exit 2`) when the build artefact is missing.
  - New root script `size:check` in `package.json`.
  - CI update: `.github/workflows/ci.yml` now runs `pnpm --filter @tabrix/extension build` followed by `pnpm run size:check` immediately before the production audit. Minimal diff — no other CI re-ordering.
  - `AGENTS.md` gets a new "Operational Guardrails" section documenting the thresholds, the post-B-006 baseline (**sidepanel-\*.js ≈ 20.5 kB**), and the rule that raising the threshold must land in the same reviewed commit as the feature that needed it.
  - **Local run**: `pnpm run size:check` reports `sidepanel-BFu4rnQa.js — 20.51 kB (soft 25.00 kB, hard 40.00 kB)` · exit 0.
  - **Deviation from brief**: CSS gating is explicitly out — documented as "CSS is not gated yet. A future backlog item may extend the script". Matches the brief's "CSS is not gated in this sprint".

### B-008 · Docs: Extension testing conventions

- **Stage**: — · **Layer**: X · **KPI**: 更稳
- **Owner**: Claude · **Size**: S · **Status**: `done` (merged 2026-04-20, commit `3f59080`)
- **Dependencies**: can start after either B-005 or B-006; final pass AFTER both (capture fresh lessons)
- **Branch**: `docs/b-008-extension-testing-conventions`
- **Scope**:
  - New file `docs/EXTENSION_TESTING_CONVENTIONS.md` covering:
    1. `fetch` + `AbortController` mocking pattern (the B-003 fix: always reject with `AbortError` on `signal.aborted`).
    2. `chrome.storage.local.get` callback-vs-promise pattern (the `isThenable` guard introduced in B-002).
    3. When to use Vitest `vi.mock` vs. `vi.spyOn` for global APIs.
    4. The "do not import `describe.skip` / `it.todo`" reminder (Jest/Vitest globals).
    5. A small template test file header (common setup) linked from this doc.
  - Add a `docs/README.md`-level reference so the doc is discoverable (update the "Reading order" list in `AGENTS.md` default expectations if such a list exists; if not, skip).
- **Must not do**: enforce the conventions retroactively in this sprint (retro-enforcement is a separate Sprint 3+ candidate).
- **Exit criteria**:
  - File exists and is referenced from `AGENTS.md`.
  - `pnpm run docs:check` passes (the existing docs linter).
- **Landed scope (2026-04-20)**:
  - New doc `docs/EXTENSION_TESTING_CONVENTIONS.md` with 8 sections covering: (1) `fetch` + `AbortController` reject-on-signal pattern, (2) callback-only `chrome.storage.local.get` mocking + `as never` rationale, (3) the Memory API envelope discriminator `status: 'ok'` (captured from the real B-006 trap), (4) `vi.spyOn` / `vi.stubGlobal` / `vi.mock` decision matrix, (5) `await nextTick()` before DOM assertions, (6) `describe.skip` / `it.todo` globals, (7) a copy-paste minimal template, (8) when to push a test to the native-server integration suite instead.
  - `AGENTS.md` § "Extension, popup, onboarding, and troubleshooting tasks" now has a required-reading bullet for this doc when editing `app/chrome-extension/tests/**`.
  - `pnpm run docs:check` passes.
  - **Deviation from brief**: delivered 8 sections instead of 5. The extras (`vi.spyOn` matrix, `nextTick`, integration-test boundary) came directly from Sprint 1/2 friction and would otherwise have had to be re-discovered each sprint.

### B-009 · Codex fast task · add "schema-cite rule" to AGENTS.md + backlog template

- **Stage**: — · **Layer**: X · **KPI**: 懂用户 (process)
- **Owner**: **Codex fast (draft-only, Claude committed)** · **Size**: S · **Status**: `done` (merged 2026-04-20, commit `c8ed033`)
- **Dependencies**: none
- **Branch**: `chore/b-009-agents-schema-cite-rule`
- **Shape (re-tests the "draft-only" Codex handoff protocol from `AGENTS.md`)**:
  - Codex edits files in place under `workspace-write`; its "finish" step is `git diff --stat`, NOT `git commit`. Claude is the one who stages + commits + merges, after reviewing the diff.
- **Scope (allow-list of files Codex may touch)**:
  1. `AGENTS.md` — add rule 21 (bundle-size gate reference) and rule 22 (schema-cite rule: every `B-NNN` touching Memory / Knowledge / Experience must cite the actual repository file + line of the schema it builds on, before implementation starts). Numbering must follow current max.
  2. `docs/PRODUCT_BACKLOG.md` — flip B-009 `Status: planned` → `Status: review` and add a one-line landed note.
- **Must not do**: anything outside the 2 files above; add new imports anywhere; touch CI; renumber existing AGENTS rules.
- **Exit criteria**:
  - `pnpm -r typecheck` passes.
  - `git diff --stat` shows exactly 2 files changed.
  - Claude manually commits with message `docs(agents): add schema-cite rule + bundle-size gate reference (B-009)` after verification.
- **Landed by Codex (2026-04-20, draft-only)**: two files edited per brief. `git diff --stat` returned cleanly. Awaiting Claude's verification + commit.
- **Claude verified + committed (2026-04-20)**: `pnpm -r typecheck` and `pnpm run docs:check` both pass locally. Committed as `c8ed033`. Sandbox behaviour confirms the draft-only shape from `AGENTS.md` §"Operational sandbox (lesson from B-004)" works on Windows — Codex could not run `pnpm -r typecheck` under the `workspace-write` sandbox (spawn EPERM on `pnpm`), which is consistent with the B-004 lesson; verification by Claude after draft is now the documented norm.

## Current Sprint — Sprint 3 (2026-W19, 2026-04-20 → 2026-04-26)

**Theme**: _Stage 3a Knowledge UI Map seed + Sprint 2 retro follow-ups + first write path into Stage 3b_. Balance: one new Knowledge surface (B-010) that gives B-011/B-012 a stable key space, the CSS half of the bundle-size gate from Sprint 2 §7, the Stage 3b aggregator that finally turns B-005's empty tables into real data, and one Codex fast task to close the sprint.

**Demo outcome** (what the human should see at end of sprint):

1. `GITHUB_KNOWLEDGE_SEEDS.uiMapRules` exists in `app/chrome-extension/entrypoints/background/knowledge/seeds/github.ts` with the first five `(pageRole, purpose)` pairs — `repo_home.open_issues_tab`, `repo_home.open_actions_tab`, `issues_list.new_issue_cta`, `issues_list.search_input`, `actions_list.filter_input` — and a `lookup/resolve-ui-map.ts` helper that turns a `(siteId, pageRole, purpose)` triple into the compiled rule.
2. `scripts/check-bundle-size.mjs` now also gates the latest `sidepanel-*.css` bundle (post-B-006 baseline is 18.24 kB; hard threshold 22 kB, soft 20 kB — same 40/25 shape as the JS gate, just smaller numbers).
3. `experience_action_paths` contains real rows for the first time — written by a new aggregator that walks terminal Memory sessions, buckets by `(page_role, intent_signature)`, and upserts action-path rows + success/failure counters idempotently. No MCP tool surface yet (that's B-013, Sprint 4+).
4. `docs/PRODUCT_BACKLOG.md` B-NNN template no longer tells authors to "append rule N" — it tells them to "add a new subsection titled …", fixing the drift discovered during Sprint 2 B-007.

**Out of scope for Sprint 3**:

- **B-011 stable `targetRef`** — B-010 ships only the schema + seed + lookup; the `read_page` HVO output contract stays unchanged in this sprint. Rewiring `candidate-action.ts` to consult UI Map hints is B-011's job.
- **B-019 Sidepanel Insights tab UI** — stays in Sprint 4+; `memory_insights` table is not created in this sprint.
- **`experience_suggest_plan` MCP tool (B-013)** — waits on the B-012 aggregator stabilising for at least one sprint before we expose it to upstream agents.
- **Any Douyin UI Map seed** — Stage 1 intentionally only migrated GitHub; Stage 3a follows the same "GitHub first, then Douyin when representative" cadence.

**Execution order** (each merges before the next starts):

1. **B-010** (UI Map schema + GitHub seed + lookup) — first because B-012's aggregator design is cleaner once the `(siteId, pageRole, purpose)` key space exists.
2. **B-021** (CSS bundle gate) — smallest item; keeps momentum and satisfies Sprint 2 retro §7 action.
3. **B-023** (click contract hotfix) — pulled in mid-sprint on 2026-04-20 after the GA-facing `chrome_click_element` false-success P1 surfaced. Sequenced before B-012 because B-012's aggregator consumes `step.status` values, and right now the extension can emit `status='completed'` for clicks that did not actually change anything — aggregating over those rows would poison the Experience layer's `success_count`.
4. **B-012** (Experience aggregator) — the big one; comes after B-010 so the aggregator's write-path can key off `purpose` strings if needed (even though the minimal B-012 may not use them yet).
5. **B-022** (Codex fast — drop "rule N" wording) — last, low-risk, exercises the draft-only protocol for a third consecutive sprint.

### B-010 · Extension: `KnowledgeUIMapRule` schema + GitHub seed + read-only lookup

- **Stage**: 3a · **Layer**: K · **KPI**: 更准 · 更稳 (stable purpose key space makes retries converge)
- **Owner**: Claude · **Size**: M · **Status**: `done` (merged 2026-04-20, commit `87673f5`)
- **Dependencies**: none (extends the existing Stage 1/2 `KnowledgeSeeds` shape without touching consumers)
- **Branch**: `feat/b-010-knowledge-uimap-github-seed`
- **Schema cite** _(per the schema-cite rule added in B-009)_:
  - Authored shape extends `KnowledgeSeeds` — see `app/chrome-extension/entrypoints/background/knowledge/types.ts:113-119` (current definition before B-010). B-010 adds an optional `uiMapRules?: readonly KnowledgeUIMapRule[]` field; existing Stage 1/2 seeds continue to compile unchanged.
  - Compiled shape extends `CompiledKnowledgeRegistry` — see `app/chrome-extension/entrypoints/background/knowledge/types.ts:169-177` (current definition). B-010 adds two new indices: `uiMapRulesBySite: ReadonlyMap<string, readonly CompiledKnowledgeUIMapRule[]>` (declaration order per site) and `uiMapRuleByKey: ReadonlyMap<string, CompiledKnowledgeUIMapRule>` (fast-path lookup keyed by `${siteId}::${pageRole}::${purpose}`).
  - Target shape reference: `docs/MKEP_CURRENT_VS_TARGET.md:229-242` (the `KnowledgeUIMap` TypeScript sketch in the target schema). B-010 is a faithful subset — same four `locatorHints` kinds, same `actionType` tristate, same optional `confidence`.
  - **New / modified fields**: `KnowledgeUIMapRule { siteId, pageRole, purpose, region?, locatorHints[], actionType?, confidence?, notes? }`; `KnowledgeUIMapLocatorHint { kind, value, role? }` where `kind ∈ { aria_name | label_regex | href_regex | css }`.
  - **Idempotency**: the registry loader throws on duplicate `(siteId, pageRole, purpose)` — matches the existing pattern used for duplicate `siteId` in site profiles (`knowledge-registry.ts:62-64`). The DTO shape stays backwards-compatible (new field is optional), and Stage 1/2 tests stay green without changes.
- **Scope**:
  - Add `KnowledgeUIMapRule` + `CompiledKnowledgeUIMapRule` + `KnowledgeUIMapLocatorHint` + `CompiledKnowledgeUIMapLocatorHint` types in `types.ts`.
  - Extend `compileKnowledgeRegistry` in `registry/knowledge-registry.ts` to compile and index UI map rules + reject duplicate triples.
  - Add `GITHUB_UI_MAP_RULES()` factory in `seeds/github.ts` with exactly the five purposes listed in the demo outcome.
  - Add `lookup/resolve-ui-map.ts` exposing `lookupUIMapRule`, `listUIMapRulesForPage`, `listUIMapRulesForSite`.
  - Add `tests/knowledge-ui-map.test.ts` covering: compile, declaration order, regex vs non-regex hint compilation, duplicate rejection, Douyin tolerance, defaults, lookup by triple, listing, explicit-null registry path, no regression on Stage 1/2 counts.
- **Must not do**: modify the public `read_page` contract; implement stable `targetRef`; touch `candidate-action.ts`; touch native-server schema; touch CI; touch sidepanel UI; add Douyin UI map rules; wire into Experience aggregator.
- **Exit criteria**:
  - `pnpm --filter @tabrix/extension typecheck` green.
  - `pnpm --filter @tabrix/extension test` green (273 prior + ~15 new B-010 tests).
  - Knowledge Stage 1/2 existing tests (`knowledge-registry.test.ts`, `knowledge-lookup.test.ts`, `knowledge-object-classification.test.ts`) all still green with zero edits.
  - `git diff --stat` contains only knowledge layer files + the new test + backlog update.
- **Landed**: 5 files changed, 578 insertions, 1 deletion. Extension tests 273 → 288 (+15 B-010). All 288 green. `pnpm -r typecheck` + `pnpm run docs:check` both clean. Native-server regression check: 176 passed / 24 skipped (no change). No touch to `read_page` contract, `candidate-action.ts`, native-server schema, CI, or sidepanel UI — per the Must-not-do list.

### B-021 · Infra: extend `check-bundle-size.mjs` to gate `sidepanel-*.css`

- **Stage**: N/A (infra carry-over from Sprint 2 retro §7) · **Layer**: X · **KPI**: 更稳 (prevents CSS creep)
- **Owner**: Claude · **Size**: S · **Status**: `done` (merged 2026-04-20)
- **Dependencies**: B-010 merged (so the CSS baseline number is measured after B-010's non-UI-impacting edits)
- **Branch**: `chore/b-021-bundle-size-css-gate`
- **Scope**:
  - Generalize `scripts/check-bundle-size.mjs` to iterate a `TARGETS` array of `{ label, subdir, prefix, suffix, softLimit, hardLimit }` entries; each target picks the latest-mtime'd file matching `prefix*suffix` in its subdir.
  - Add a CSS target — `subdir: 'assets'`, `prefix: 'sidepanel-'`, `suffix: '.css'`, `hardLimit: 22 * 1024`, `softLimit: 20 * 1024`.
  - Update `AGENTS.md` Operational Guardrails §"Sidepanel bundle-size gate" to list both JS and CSS thresholds.
- **Must not do**: change the JS thresholds; gate any bundle other than sidepanel; introduce a second script; touch sidepanel source; touch CI beyond what B-007 already wired.
- **Exit criteria**:
  - `pnpm run size:check` passes locally on a clean build and prints both JS + CSS lines.
  - `pnpm -r typecheck` green.
  - CI run on the PR passes.
- **Landed**: `scripts/check-bundle-size.mjs` refactored from single-target to multi-target (TARGETS array). `AGENTS.md` Operational Guardrails updated with a two-row threshold table. Measured bundles on this branch: **JS 20.51 kB** (under 25 soft · under 40 hard ✓), **CSS 17.81 kB** (under 20 soft · under 22 hard ✓). Script discovered that WXT emits CSS into `.output/chrome-mv3/assets/` not `chunks/` — the TARGETS array carries a per-entry `subdir` to handle both. No sidepanel source, CI workflow, or JS thresholds touched.

### B-023 · GA reliability hotfix · verified click outcome contract for `chrome_click_element`

_Pulled into Sprint 3 mid-sprint on 2026-04-20 as a P1 hotfix. This is **not** an MKEP / Experience / Knowledge increment — it is a tool-layer correctness fix that the whole MKEP stack sits on top of. Execution spec: `docs/CLICK_CONTRACT_REPAIR_V1.md`._

- **Stage**: N/A (GA reliability hotfix) · **Layer**: X (tool-layer contract, not a Memory / Knowledge / Experience / Policy increment) · **KPI**: 更准 · 更稳 (stops "click happened" from being serialized as "action succeeded")
- **Owner**: Claude · **Size**: M · **Status**: `done` (merged 2026-04-20)
- **Dependencies**: none — sits strictly upstream of B-012. B-012 reads `step.status`; if this hotfix does not land first, B-012 will aggregate over poisoned success rows.
- **Branch**: `fix/b-023-click-contract-v1`
- **Schema cite** _(per the schema-cite rule added in B-009)_:
  - Public tool response today — see `app/chrome-extension/entrypoints/background/tools/browser/interaction.ts:452-466` (the regular-click return path): currently `JSON.stringify({ success, message, elementInfo, navigationOccurred, clickMethod })` with `success` unconditionally `true` whenever the content-script message resolves without `error`. This is the false-success defect.
  - Content-script signal source — see `app/chrome-extension/inject-scripts/click-helper.js:320-325` (the `clickElement` return): currently `{ success: true, message, elementInfo, navigationOccurred }`, where `navigationOccurred` is true only when `beforeunload` fired. This conflates "full-page unload happened" with "click produced an outcome"; SPA route changes, hash changes, dialogs, menus, toggles, and no-op clicks are all invisible here.
  - Target-shape reference: `docs/CLICK_CONTRACT_REPAIR_V1.md §"Required Contract Change"` (the `{success, dispatchSucceeded, observedOutcome, verification:{…}}` JSON block). B-023 lands a faithful subset of that shape.
  - **New / modified fields** (added to the public tool response; existing fields preserved for one-release compat):
    - `dispatchSucceeded: boolean` — did `click-helper.js` find a target and dispatch the click path?
    - `observedOutcome: ClickObservedOutcome` (string enum; see below) — the merged verdict from page-local + browser-level signals.
    - `verification: { navigationOccurred, urlChanged, newTabOpened, domChanged, stateChanged, focusChanged }` — raw evidence, booleans only; callers can build their own verdict if they disagree with ours.
    - `success: boolean` — **redefined**. True iff `observedOutcome !== 'no_observed_change'` and `observedOutcome !== 'verification_unavailable'`. It is **never** true purely because the content-script promise resolved.
    - `navigationOccurred: boolean` — kept as a one-release compat field; equals `verification.navigationOccurred`. A future sprint (B-024+, not this one) deprecates it.
  - **`ClickObservedOutcome` enum (v1, frozen):** `cross_document_navigation` · `spa_route_change` · `hash_change` · `new_tab_opened` · `dialog_opened` · `menu_opened` · `state_toggled` · `selection_changed` · `dom_changed` · `focus_changed` · `download_intercepted` · `no_observed_change` · `verification_unavailable`. Lives in a new shared module `packages/shared/src/click.ts` so the native-server post-processor and future MCP consumers can import it without duplicating the union.
  - **Idempotency**: the click-helper protocol is request/response only — no state persisted in the extension. Background-layer `chrome.tabs.onCreated` correlation is a one-shot listener with explicit removal inside the verification window; no long-lived subscriber. Adding the new response fields is strictly additive — existing callers that only read `success` will see strictly fewer false positives and no new false negatives on the currently-green download-intercept path.
- **Scope**:
  - Add `packages/shared/src/click.ts` exporting `ClickObservedOutcome`, `ClickVerification`, `ClickToolResult`; re-export from `packages/shared/src/index.ts`.
  - Rewrite `app/chrome-extension/inject-scripts/click-helper.js` to emit raw signals (no verdict): `{ dispatchSucceeded, beforeUnloadFired, urlBefore, urlAfter, hashBefore, hashAfter, targetStateDelta, focusChanged, domAddedDialog, domAddedMenu, domChanged, elementInfo }`. Keep existing targeting / visibility / scroll logic unchanged — this is a contract fix, not a targeting fix.
  - In `app/chrome-extension/entrypoints/background/tools/browser/interaction.ts`: add a pure `mergeClickSignals()` function that turns raw page-local signals + `chrome.tabs.onCreated`-derived `newTabOpened` into `{ observedOutcome, verification, success, dispatchSucceeded }`; serialize per new contract. Keep the existing `intercepted-download` fast-path response shape exactly as-is (compat — existing `click-download-intercept.test.ts` must stay green with zero edits).
  - Add `app/chrome-extension/tests/click-contract.test.ts` with:
    1. Contract regression — asserts the forbidden combo `{success:true, navigationOccurred:false, observedOutcome:'no_observed_change'}` is unreachable.
    2. No-op click → `observedOutcome='no_observed_change'`, `success=false`.
    3. `beforeunload` fires → `cross_document_navigation`, `success=true`.
    4. Target `aria-expanded` flips false→true → `state_toggled`, `success=true`.
    5. `location.href` changes (same host, different path, no unload) → `spa_route_change`.
    6. Only `location.hash` changes → `hash_change`.
    7. A `[role="dialog"]` appears in DOM after click → `dialog_opened`.
- **Must not do**:
  - Do not add GitHub-family (or any site-family) selector heuristics — Non-goal per `docs/CLICK_CONTRACT_REPAIR_V1.md §"Non-Goals"`.
  - Do not touch `fill-helper.js` or `fillTool` — scope is click only.
  - Do not change the `intercepted-download` response shape — existing regression test (`click-download-intercept.test.ts`) must stay green with zero edits.
  - Do not introduce a `chrome.webNavigation` global listener — a one-shot `chrome.tabs.onCreated` with explicit removal is enough for v1.
  - Do not extract `click-verification.ts` as a separate background module in v1 — keep merging logic as a pure function inside `interaction.ts` until a second caller (fill, hover) exists.
  - Do not delete the `navigationOccurred` field; it stays as a one-release compat field.
  - Do not declare B-023 done based on source inspection alone — unit tests must run green locally.
  - Do not run a real-browser validation inside the Codex/Claude sandbox (MV3 extensions cannot be driven from the sandbox on Windows); the task summary must explicitly state real-browser validation is deferred.
- **Exit criteria**:
  - `packages/shared` builds clean: `pnpm -C packages/shared build`.
  - Extension builds clean: `pnpm -C app/chrome-extension build`.
  - `pnpm --filter @tabrix/extension test` green — the existing 288 tests all stay green, plus the ≥ 7 new B-023 tests in `click-contract.test.ts`, plus the existing `click-helper-targeting.test.ts` tests stay green with zero edits.
  - `pnpm -r typecheck` green.
  - `pnpm run size:check` green — JS bundle must stay under 40 kB hard / 25 kB soft.
  - `pnpm run docs:check` green.
  - Task summary includes: (1) the before/after contract diff, (2) which outcomes are detected, (3) which tests ran, (4) explicit statement that real-browser validation was **not** run and why, (5) what remains unsupported (selection_changed, focus_changed detected-but-not-tested; `chrome.webNavigation` aggregation deferred; generic replay deferred).
- **Landed**: 5 files changed, 858 insertions, 35 deletions. Extension tests 288 → 304 (+16 B-023: 13 `mergeClickSignals` pure-function tests + 3 jsdom end-to-end signal tests). All 304 green. `pnpm -r typecheck`, `pnpm run size:check`, `pnpm run docs:check` all clean. Legacy click tests (`click-helper-targeting.test.ts`, `click-download-intercept.test.ts`) stayed green with **zero edits** — the `intercepted-download` fast-path response shape was deliberately not unified into the new contract this sprint. Real-browser validation was **not** run inside the sandbox (MV3 extensions cannot be driven from the Windows sandbox); explicit follow-up item on the Sprint 3 retro.

### B-012 · Native-server: Experience action-path aggregator (v1)

- **Stage**: 3b · **Layer**: E · **KPI**: 省 token · 更快 (reusable path priors reduce planning retries)
- **Owner**: Claude · **Size**: L · **Status**: `done` (landed 2026-04-21)
- **Dependencies**: B-005 (Experience schema landed); optionally references B-010 purposes when the step's `pageRole` has an authored UI map
- **Branch**: `feat/b-012-experience-action-path-aggregator`
- **Schema cite**:
  - Writes to `experience_action_paths` — see `app/native-server/src/memory/db/schema.ts` §`EXPERIENCE_CREATE_TABLES_SQL` (landed in B-005, commit `3770201`). Fields used: `action_path_id` (deterministic id for the `(page_role, intent_signature)` bucket in v1), `page_role`, `intent_signature`, `step_sequence` (JSON array of `{toolName, status, historyRef}`), `success_count`, `failure_count`, `last_used_at`, `created_at`, `updated_at`.
  - Reads from Memory — see `app/native-server/src/memory/db/schema.ts` §`MEMORY_CREATE_TABLES_SQL` for `memory_sessions`, `memory_tasks`, `memory_steps`, `memory_page_snapshots`, and `memory_actions`. In v1: `memory_sessions` + `memory_tasks` define the terminal-session / intent boundary, `memory_steps` provides ordered step backbone + `artifact_refs`, `memory_page_snapshots` provides the latest session `page_role`, and `memory_actions` stays available for action-level enrichment without becoming a hard dependency for the first write path.
  - **Idempotency**: the aggregator is a pure projection — same Memory state → same Experience state. Re-running it over the same sessions must not double-increment `success_count` / `failure_count`. The session-level `aggregated_at` marker lives on `memory_sessions` (same PR adds `aggregated_at TEXT` via a guarded migration; SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) so replay can scan only terminal sessions that have not been projected yet.
- **Scope**: see `docs/TASK_ROADMAP.md` §3 (Stage 3b). Minimal first cut:
  - Walk `memory_sessions WHERE status IN ('completed', 'failed', 'aborted') AND aggregated_at IS NULL`, in `started_at` order.
  - Join each session to `memory_tasks` on `task_id` and compute a single `intent_signature` from `memory_tasks.intent` (hash + light normalization).
  - Build `step_sequence` from `memory_steps` in `step_index` order; for each step, keep `{toolName, status, historyRef}` where `historyRef` is the first `artifact_ref` when present, else `null`.
  - Resolve `page_role` from the latest `memory_page_snapshots` row in the same session; fallback to `'unknown'` when the session never emitted a page snapshot.
  - Emit or upsert one `experience_action_paths` row per `(page_role, intent_signature)` bucket; increment `success_count` for `status = 'completed'`, increment `failure_count` for `status IN ('failed', 'aborted')`, and update `step_sequence` / `last_used_at` / `updated_at` from the latest observed terminal session.
  - Mark the session `aggregated_at = now()` so the next run skips it.
  - Expose as an internal-only function; **no MCP tool** yet (that's B-013).
- **Must not do**: expose an MCP tool; change Memory schema except for the `aggregated_at` column on `memory_sessions`; write to `experience_locator_prefs` (deferred to a separate item); make `memory_actions` mandatory for v1 path aggregation; read UI Map rules in the first cut (reserve for a follow-up).
- **Exit criteria**:
  - Jest tests cover: empty Memory (no-op); single completed session → exactly 1 Experience row; replay is idempotent; failed session increments `failure_count`.
  - `pnpm --filter @tabrix/tabrix test` green.
  - `pnpm -r typecheck` and `pnpm run docs:check` green.
- **Landed**: `memory_sessions.aggregated_at` shipped with guarded migration (new install + legacy upgrade path), `ExperienceAggregator` + `ExperienceRepository` project terminal sessions into `experience_action_paths` using `(page_role, intent_signature)` buckets, and session-level `aggregated_at` markers enforce idempotent replay. Scope constraints held: no new MCP tool, no writes to `experience_locator_prefs`. Validation: `pnpm --filter @tabrix/tabrix test`, `pnpm -r typecheck`, `pnpm run docs:check` all green.

### B-013 · MCP tool: `experience_suggest_plan` (read-only)

- **Stage**: 3b · **Layer**: E · **KPI**: 省 token · 更准 (upstream LLM reuses prior winning plans instead of re-planning)
- **Owner**: Claude · **Size**: M · **Status**: `done` (landed 2026-04-22, pulled into Sprint 3 as the read-side companion of B-012)
- **Dependencies**: **B-012** (aggregator must be writing `experience_action_paths` rows)
- **Branch**: landed on `main` directly (B-012 stable in-tree; brief is small enough that no feature branch was warranted, same pattern B-024 used)
- **Public contract**:
  - New MCP tool `experience_suggest_plan` (Risk tier `P0` — pure SELECT against the local SQLite, no browser side-effects, no network).
  - Input: `intent: string` (required, ≤ 1024 chars, normalized via the same `normalizeIntentSignature` the B-012 aggregator uses), `pageRole?: string` (optional, ≤ 128 chars), `limit?: integer` (optional, default 1, clamped to `[1, 5]`).
  - Output: `{ status: 'ok' | 'no_match', plans: ExperienceActionPathPlan[], persistenceMode: 'disk' | 'memory' | 'off' }`. Each plan carries `actionPathId`, `pageRole`, `intentSignature`, `successCount`, `failureCount`, `successRate` (computed server-side), `lastUsedAt?`, and the projected `steps[]`.
  - When persistence is off (Memory disabled or DB init failed) the tool returns a successful tool call with `status: 'no_match'`, `persistenceMode: 'off'` rather than `isError: true` — upstream agents branch on `persistenceMode`, they don't have to special-case a hard error.
- **Architecture decision** (single owner-lane decision worth pinning here):
  - Existing `register-tools.ts` bridges every MCP call to the Chrome extension. `experience_suggest_plan`'s data lives entirely in the native-server's SQLite, so a new lane was added: a `getNativeToolHandler(name)` short-circuit that runs in-process. `sessionManager` step bookkeeping is preserved.
  - SQL ordering (in `ExperienceRepository.suggestActionPaths`): `success_count DESC, (failure_count - success_count) ASC, last_used_at DESC NULLS LAST, intent_signature ASC, action_path_id ASC` — fully deterministic so unit tests do not depend on SQLite row-storage order.
- **Scope (what landed)**:
  - `packages/shared/src/experience.ts` — DTOs (`ExperienceActionPathPlan`, `ExperienceSuggestPlanInput`, `ExperienceSuggestPlanResult`) + caps (`MAX_EXPERIENCE_SUGGEST_PLAN_LIMIT = 5`, intent ≤ 1024, pageRole ≤ 128) shared between native-server and any future consumer.
  - `packages/shared/src/tools.ts` — `TOOL_NAMES.EXPERIENCE.SUGGEST_PLAN`, full input schema in `TOOL_SCHEMAS`, `TOOL_RISK_TIERS[...] = 'P0'`. `tool-risk-tier-coverage.test.ts` invariants hold automatically.
  - `app/native-server/src/memory/experience/experience-repository.ts` — added read-only `suggestActionPaths` with two prepared statements (with / without `pageRole` filter).
  - `app/native-server/src/memory/experience/experience-suggest.ts` — pure `parseExperienceSuggestPlanInput` + `buildSuggestPlanResult`, plus typed `ExperienceSuggestPlanInputError`.
  - `app/native-server/src/memory/experience/experience-query-service.ts` — read-only façade exposed on `SessionManager.experience` so the MCP handler never sees the mutating repository methods.
  - `app/native-server/src/mcp/native-tool-handlers.ts` — handler registry; `experience_suggest_plan` is the first entry.
  - `app/native-server/src/mcp/register-tools.ts` — native handler short-circuit between policy check and the extension bridge.
- **Must not do (held)**: expose `experience_replay` or `experience_score_step` (deferred — see "next" below); modify any schema; touch the Chrome extension; bypass policy / sessionManager bookkeeping.
- **Tests**:
  - `app/native-server/src/memory/experience/experience-suggest.test.ts` — 16 tests across input parsing (missing/blank/wrong-type/long intent, pageRole cap, limit clamping), pure result projection (no_match, successRate, NaN guard), and SQL ordering (no match, success_count ordering, pageRole filter isolation, limit clamp, last_used_at tiebreak).
  - `app/native-server/src/mcp/native-tool-handlers.test.ts` — 5 tests covering handler registration, bad-input projection, persistence-off graceful fallback, end-to-end with a stub `ExperienceQueryService`, and `no_match` projection.
- **Validation**: `pnpm -r typecheck` green; `pnpm --filter @tabrix/tabrix test` green (32 suites / 208 passed / 24 skipped — +22 from B-013); `pnpm --filter @tabrix/extension test` green (39 files / 326 tests, unaffected); `pnpm run docs:check` OK; `pnpm run size:check` within budget (no sidepanel changes).
- **Next (explicitly out of scope for B-013, kept on the roadmap)**:
  - `experience_replay(actionPathId, variableSubstitutions, …) → ExperienceReplayResult` — write/execute path; **landed in v2.4.0 (V24-01, 2026-04-22)** as `B-EXP-REPLAY-V1`.
  - `experience_score_step({actionPathId, stepIndex, observedOutcome, …}) → TabrixExperienceScoreStepResult` — Memory write path from upstream agents and from the replay engine itself; **landed in v2.4.0 (V24-02, 2026-04-23)** with capability reuse (`experience_replay`) and write-back isolation (`experience_writeback_warnings`).
  - `experience_locator_prefs` read access — gated on B-012 emitting locator prefs in the first place.
- **Follow-up fix (2026-04-22, P1)**: read-side recursion guard. The first cut of B-013 routed through the generic `handleToolCall()` wrapper, which left `SessionManager.finishSession()` calling `ExperienceAggregator.projectPendingSessions()` unconditionally — so every `experience_suggest_plan` invocation seeded a `(pageRole='unknown', intent_signature='run mcp tool experience_suggest_plan')` bucket back into `experience_action_paths`. Patched in `app/native-server/src/memory/experience/experience-aggregator.ts` by adding a single-tool exclusion set (`EXPERIENCE_AGGREGATION_EXCLUDED_TOOLS = { 'experience_suggest_plan' }`); excluded sessions are still marked `aggregated_at` so the pending-scan does not loop. Audit-trail / step bookkeeping unchanged. Public MCP contract unchanged. Regression coverage: aggregator unit test "H" + two integration tests in `register-tools.test.ts` (`experience_suggest_plan does not pollute Experience (B-013 P1 regression)`).

### B-022 · Codex fast task · drop "rule N" numbering convention from backlog template wording

- **Stage**: N/A (docs carry-over from Sprint 2 retro §7) · **Layer**: X · **KPI**: — (tooling hygiene)
- **Owner**: **Codex fast (draft-only, Claude commits)** · **Size**: S · **Status**: `planned`
- **Dependencies**: none
- **Branch**: `chore/b-022-drop-rule-n-numbering`
- **Scope** (exactly two files, as required by Codex draft-only protocol in `AGENTS.md`):
  - `AGENTS.md`: find any line referencing "rule 19" / "rule 20" / "rule 21" and rephrase to cite the section title (e.g. "see the 'Product pruning' section") instead of a numeric rule index. `AGENTS.md` does not use numbered rules.
  - `docs/PRODUCT_BACKLOG.md`: update the Cross-Sprint Invariants bullet that says "see `AGENTS.md` rule 19" to cite the section title; update the `B-NNN` template wording at the top of the doc if it references "rule N"; mark B-022 as `review` with a "Landed by Codex" note.
- **Must not do**: change any other wording; touch code; introduce new rules; renumber existing headings.
- **Exit criteria**:
  - `git diff --stat` shows at most 2 files changed.
  - `pnpm run docs:check` passes inside the Codex sandbox.
  - Claude runs `pnpm -r typecheck` locally, confirms clean, and commits as `docs(backlog): drop rule-N numbering references (B-022)`.

## Sprint 4 — v2.6 S1 foundation (2026-W17, 2026-04-25 → 2026-04-26)

**Theme**: _v2.6 S1 — Foundation pass for "Layer Dispatch + Real Execution Value" v2._ Lock the four ground-floor packages that S2/S3 land on top of: step-level benchmark telemetry harness (V26-01), product-side primary tab controller (V26-02), honest dispatcher inputs (V26-04), and per-task read budget (V26-05). All four are no-regression against shipped v2.5.0 surfaces. P0/P1 semantics follow `.claude/strategy/TABRIX_V2_6_P0_CHAIN_V4_1_zh.md` §16.

**Demo outcome** (what should be true after S1):

1. The v26 benchmark transformer (`app/native-server/src/benchmark/v26-benchmark.ts`) exists and consumes step-level NDJSON with `startedAt / endedAt / durationMs / component / toolName / status / failureCode / waitedMs / chosenLayer / chosenSource`; emits `perTaskDurationMs / perToolDurationMs / unknownComponentRatio` aggregations. Negative duration / missing timestamp combinations fail the transformer; legacy v25 NDJSON without the new fields parses with `unknown` markers (fail-soft).
2. A product-side `PrimaryTabController` runtime module exists (`app/native-server/src/runtime/primary-tab-controller.ts`), promotes the V25-05 `scripts/lib/v25-primary-tab-session.cjs` benchmark contract to runtime, and the bridge runtime snapshot now exposes `primaryTabId / primaryTabReuseRate / benchmarkOwnedTabCount`. Default off (env `TABRIX_PRIMARY_TAB_ENFORCE=true` to enforce on `chrome_navigate` hot path) — fail-soft so v2.5 navigation behavior is preserved unless explicitly opted-in.
3. `app/native-server/src/mcp/choose-context.ts:687-688` no longer hard-codes `candidateActionsCount: 0, hvoCount: 0`. A new `mcp/page-context-provider.ts` reads the latest page snapshot for the current task and returns either real counters or `{ source: 'fallback_zero', cause }`; the `tabrix_choose_context_decisions` SQLite table grows two columns (`dispatcher_input_source`, `fallback_cause_v26`) via idempotent migration.
4. `execution/task-session-context.ts` exists; `SessionManager` attaches one per task; `chrome_read_page` calls in `handleToolCall` are gated by the read-budget; URL/pageRole change invalidates and a default initial layer of `L0+L1` is enforced for replay/API fallback.
5. No regression: `pnpm -r typecheck`, `pnpm -C app/native-server test:ci`, `pnpm run docs:check`, `pnpm run release:check`, `pnpm run size:check` all green; existing v23/v24/v25 benchmark + gate suites untouched.

**Out of scope for Sprint 4 (S1)**:

- V26-03 (skip-read actually wired through) / V26-06..V26-14 — those are S2/S3 work even if time allows.
- `packages/shared/src/tools.ts` `TOOL_NAMES` / `TOOL_RISK_TIERS` — no new MCP tool surface.
- `packages/shared/src/read-page-contract.ts` HVO public schema — no public contract change; only internal native-server gating.
- Any `RELEASE_NOTES_v2.6` / `CHANGELOG` / version bump / publish action.

**Execution order** (each commits + pushes before the next starts so reverts stay surgical):

1. **B-025** (V26-01 benchmark transformer) — independent, lands first.
2. **B-026** (V26-02 PrimaryTabController) — independent of B-025, second.
3. **B-027** (V26-04 honest dispatcher inputs) — needs the telemetry table migration to land cleanly before downstream code consumes it.
4. **B-028** (V26-05 task session context + read budget) — last in S1; touches `register-tools.ts` `chrome_read_page` path.
5. **B-029** is an S2 placeholder — listed here so V26-06 has a stable backlog id when its sprint lands.

### B-025 · v2.6 V26-01 — Step Telemetry Harness (benchmark transformer)

- **Stage**: N/A (v2.6 release-evidence infra) · **Layer**: X · **KPI**: 更准 (per-step evidence powers V26-06+ reports)
- **Owner**: Claude · **Size**: M · **Status**: `planned`
- **Dependencies**: none — extends v25 transformer in a parallel module, does not modify v23/v24/v25 surfaces.
- **Branch**: landed on `main` directly (foundation layer, no public contract surface change).
- **Schema cite** (per the schema-cite rule in `AGENTS.md`):
  - Extends the v25 NDJSON record `BenchmarkToolCallRecordV25` — see `app/native-server/src/benchmark/v25-benchmark.ts:123-163`. New record `BenchmarkToolCallRecordV26` adds `startedAt: string`, `endedAt: string`, `durationMs: number | null` (computed from `endedAt - startedAt` when not provided; `null` when either timestamp is missing), `component: string` (closed enum of `'mcp_tool' | 'native_handler' | 'extension_bridge' | 'page_snapshot' | 'unknown'`), `failureCode: string | null`, `waitedMs: number | null`, `chosenSource: BenchmarkLayerSourceRoute | null` (closed enum, mirrors v25). All new fields are optional — legacy v25 NDJSON parses with `component='unknown'`, `failureCode=null`, etc.
  - No SQLite schema change. No `ExecutionStep` DTO change in `app/native-server/src/execution/types.ts:23-37` (deferred to V26-06+ when the runner can populate the columns).
  - **Idempotency**: pure data transformer, no IO, no state. Same NDJSON in → same report out.
- **Scope**:
  - Add `app/native-server/src/benchmark/v26-benchmark.ts` exporting `BenchmarkToolCallRecordV26`, `BenchmarkRunInputV26`, `BenchmarkSummaryV26`, `summariseBenchmarkRunV26`. Re-exports v23/v24/v25 primitives that v26 reuses; bumps a local `BENCHMARK_REPORT_VERSION = 1` (independent counter from v25).
  - Aggregations: `perTaskDurationMs` (Map keyed by `scenarioId`, value `{ p50, p95, sum, count }`), `perToolDurationMs` (Map keyed by `toolName`, same shape), `unknownComponentRatio` (`unknownCount / totalCount`), `componentDistribution` (closed-enum + unknown counters), `failureCodeDistribution` (open-ended map).
  - Fail-shape contract: if `durationMs < 0` after derivation, transformer treats the record as malformed — emits a `transformerWarning` entry and excludes it from medians; if both timestamps are missing AND `durationMs` is missing, the record is bucketed under `unknownComponentRatio` denominator but excluded from latency aggregates.
  - Add `app/native-server/src/benchmark/v26-benchmark.test.ts` with at least 8 cases: empty input, single record happy path, missing timestamps → unknown bucket, negative duration → excluded + warning, mixed v25/v26 records (back-compat), `unknownComponentRatio = 0/1/intermediate`, per-tool latency p50 across multiple tools, `chosenSource` distribution.
  - Do NOT touch `scripts/lib/v25-benchmark-gate.cjs` — v26 gate ships in S3 V26-14.
  - Do NOT touch `app/native-server/src/execution/types.ts` or `session-manager.ts` — owner-lane decision: keep V26-01 strictly transformer-side so the foundation lands without churning the runtime DTO. The runtime DTO extension is V26-06's responsibility (it owns the runner side that populates these columns).
- **Must not do**: bump v23/v24/v25 `BENCHMARK_REPORT_VERSION`; modify v23/v24/v25 transformer surfaces; create a v26 release gate (S3 V26-14); change `ExecutionStep` shape; touch the chrome extension; introduce new MCP tool surface.
- **Exit criteria**:
  - `pnpm -r typecheck` green.
  - `pnpm -C app/native-server test:ci -- --testPathPattern v26-benchmark` green (≥ 8 new tests).
  - `pnpm -C app/native-server test:ci -- --testPathPattern v2[345]-benchmark` green (no regression).
  - `pnpm run docs:check` green.
- **Refs**: `.claude/strategy/TABRIX_V2_6_P0_CHAIN_V4_1_zh.md` §6 / §11 / §16.

### B-026 · v2.6 V26-02 — Primary Tab Controller (runtime + bridge snapshot)

- **Stage**: N/A (v2.6 reliability foundation) · **Layer**: X · **KPI**: 更稳 (multi-site tab leakage is the v2.5 acceptance regression)
- **Owner**: Claude · **Size**: M · **Status**: `planned`
- **Dependencies**: none — wraps the existing `scripts/lib/v25-primary-tab-session.cjs` contract; does not change extension navigate behavior unless `TABRIX_PRIMARY_TAB_ENFORCE=true`.
- **Branch**: landed on `main` directly.
- **Schema cite**:
  - Extends `BridgeRuntimeSnapshot` — see `app/native-server/src/server/bridge-state.ts:11-36`. New optional fields: `primaryTabId: number | null` (default `null`), `primaryTabReuseRate: number | null` (default `null` until ≥ 1 navigation observed), `benchmarkOwnedTabCount: number` (default `0`). Baseline tabs the user already had open are **not** counted.
  - No SQLite schema change. No DDL in `schema.ts`.
  - **Idempotency**: controller state is per-process (no persistence). The opt-in env gate `TABRIX_PRIMARY_TAB_ENFORCE` defaults to off — `chrome_navigate` hot path behavior is unchanged unless the maintainer explicitly turns the gate on (fail-soft per V4.1 §16).
- **Scope**:
  - Add `app/native-server/src/runtime/primary-tab-controller.ts` exporting `createPrimaryTabController(opts?)` (re-uses the cjs `createPrimaryTabSession` under the hood, exposes a TS-typed surface) and a `getDefaultPrimaryTabController()` singleton accessor. Surface methods: `getSnapshot()`, `recordNavigation({ url, returnedTabId, scenarioId? })`, `declareAllowsNewTab(scenarioId)`, `reset()`.
  - Extend `BridgeStateManager` with `setPrimaryTabSnapshot({ primaryTabId, primaryTabReuseRate, benchmarkOwnedTabCount })`; `getSnapshot()` includes the three new fields.
  - In `app/native-server/src/mcp/register-tools.ts`, before forwarding `chrome_navigate` (line 1331-1343 region) check `process.env.TABRIX_PRIMARY_TAB_ENFORCE === 'true'`; when on, route through the controller (inject `tabId: primaryTabId` on second-and-after calls); when off, hot path is unchanged. After every navigation, push the controller snapshot into `bridgeRuntimeState`.
  - The cjs `v25-primary-tab-session.cjs` stays unchanged — the new TS module wraps it via `require()` so the v25 benchmark runner contract is preserved.
  - Add `app/native-server/src/runtime/primary-tab-controller.test.ts` with at least 6 cases: first call seeds primary, second call mismatch triggers switch-back, allowlisted scenario tolerated, snapshot fields populate `bridgeRuntimeState`, `TABRIX_PRIMARY_TAB_ENFORCE=false` → no-op (proves no regression), `TABRIX_PRIMARY_TAB_ENFORCE=true` → controller invoked.
- **Must not do**: change the chrome-extension `NavigateTool` behavior; rewrite `v25-primary-tab-session.cjs`; gate the legacy benchmark runner on the new env flag; ship a public MCP tool for primary-tab control; touch the v25 release gate.
- **Exit criteria**:
  - `pnpm -r typecheck` green.
  - `pnpm -C app/native-server test:ci -- --testPathPattern primary-tab-controller` green (≥ 6 new tests).
  - `pnpm -C app/native-server test:ci -- --testPathPattern v25-primary-tab-session` green (no regression on benchmark contract).
  - `pnpm run release:check` green.
- **Refs**: `.claude/strategy/TABRIX_V2_6_P0_CHAIN_V4_1_zh.md` §6 / §16; `scripts/lib/v25-primary-tab-session.cjs:1-432`.

### B-027 · v2.6 V26-04 — Honest Dispatcher Inputs + Source Router

- **Stage**: N/A (v2.6 dispatcher correctness) · **Layer**: P (Policy/Dispatcher) · **KPI**: 更准 · 更省 (Strategy Table complexity rules can finally fire)
- **Owner**: Claude · **Size**: M · **Status**: `planned`
- **Dependencies**: none in S1 — the SQLite schema migration is idempotent and the dispatcher fallback path was already designed for `fallback_zero` semantics.
- **Branch**: landed on `main` directly.
- **Schema cite**:
  - Migrates `tabrix_choose_context_decisions` — see `app/native-server/src/memory/db/schema.ts:314-359` (DDL `CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL`). Add two columns: `dispatcher_input_source TEXT` (closed enum: `live_snapshot | memory_snapshot | fallback_zero`) and `fallback_cause_v26 TEXT` (open-ended cause string for the `fallback_zero` branch — kept distinct from the existing `fallback_cause TEXT` column which still holds V25-02 dispatcher fallback reason). Migration is idempotent: `ALTER TABLE … ADD COLUMN` wrapped in a try/catch (`duplicate column name` → silently OK), same pattern as `ensureExperienceReplayWritebackColumns` in `client.ts`.
  - Reads from `memory_page_snapshots` via the existing `PageSnapshotService` — see `app/native-server/src/memory/page-snapshot-service.ts:182-223`. Fields used: `interactiveCount` / `candidateActionCount` / `highValueObjectCount` / `pageRole`.
  - Modifies `app/native-server/src/mcp/choose-context.ts:687-688` exactly: replaces hard-coded `candidateActionsCount: 0, hvoCount: 0` with values from the new `PageContextProvider`.
  - **Idempotency**: schema migration runs on every `openMemoryDb`, no-op on second run. Provider is read-only (no writes).
- **Scope**:
  - Add `app/native-server/src/mcp/page-context-provider.ts` exporting `PageContextProvider` interface + `LivePageContextProvider` impl. `getContext({ sessionId, taskId })` returns `{ source: 'live_snapshot' | 'memory_snapshot' | 'fallback_zero', candidateActionsCount, hvoCount, fullReadByteLength, pageRole, fallbackCause? }`. Lookup order: latest `memory_page_snapshots` row for the current session (preferred) → most recent snapshot for the task (memory snapshot fallback) → `fallback_zero` with explicit `cause` ('no_session_snapshots' / 'no_task_snapshots' / 'persistence_off').
  - Migrate `app/native-server/src/memory/telemetry/choose-context-telemetry.ts` `recordDecision` to accept and persist `dispatcherInputSource` + `fallbackCauseV26`. Extend the schema DDL string in `schema.ts` and add the idempotent column migration to `client.ts`.
  - Modify `app/native-server/src/mcp/choose-context.ts` line 687-688: replace `candidateActionsCount: 0, hvoCount: 0` with provider output; record `dispatcherInputSource` + `fallbackCauseV26` on telemetry. The existing `dispatchLayer` output (`{ chosenLayer, sourceRoute, ... }`) is unchanged — V26-04 only changes the _inputs_ the dispatcher consumes, not its output shape.
  - The v26-benchmark transformer (B-025) does not yet aggregate `dispatcherInputSource` — that aggregation is V26-06's job. B-027 only ensures the column lands and the value is recorded.
  - Add `app/native-server/src/mcp/page-context-provider.test.ts` with ≥ 6 cases: live snapshot found, memory snapshot fallback, persistence-off → `fallback_zero` with cause, multiple snapshots → newest wins, complexity bucket flips when real counts present, `pageRole` propagated.
  - Add at least 2 cases in `choose-context.test.ts`: dispatcher receives non-zero counts when snapshot exists; `fallback_zero` does not silently inflate `tokensSavedEstimate`.
- **Must not do**: change `dispatchLayer` output shape; remove the existing `fallback_cause` column (V25-02 telemetry stays valid); introduce a new MCP tool; rebuild the strategy table; alter the public chooser result DTO beyond what V25-02 already exposes.
- **Exit criteria**:
  - `pnpm -r typecheck` green.
  - `pnpm -C app/native-server test:ci -- --testPathPattern page-context-provider` green (≥ 6 new tests).
  - `pnpm -C app/native-server test:ci -- --testPathPattern choose-context` green (no regression on existing 50+ chooser tests + new V26-04 cases).
  - `pnpm -C app/native-server test:ci -- --testPathPattern choose-context-telemetry` green (column migration is idempotent; legacy DBs stay valid).
  - `pnpm run docs:check` green.
- **Refs**: `.claude/strategy/TABRIX_V2_6_P0_CHAIN_V4_1_zh.md` §0.1 / §6 / §11.

### B-028 · v2.6 V26-05 — Task Session Context + Read Budget

- **Stage**: N/A (v2.6 token-saving foundation) · **Layer**: X (execution shell) · **KPI**: 省 token (caps redundant `chrome_read_page` per task)
- **Owner**: Claude · **Size**: M · **Status**: `planned`
- **Dependencies**: none in S1 — runtime in-memory state only; no schema change.
- **Branch**: landed on `main` directly.
- **Schema cite**:
  - No SQLite schema change. State lives in process memory only (deliberately — V4.1 §0.1 says "task session context is a runtime cap, not a persisted budget").
  - Reads `pageRole` from `PageContextProvider` (B-027) when available; falls back to `null` when not.
  - Public `chrome_read_page` shared schema in `packages/shared/src/read-page-contract.ts` is intentionally unchanged — V26-05 only gates the call in `register-tools.ts::handleToolCall`, returning a structured warning payload (still a valid `CallToolResult`) when budget is exceeded.
  - **Idempotency**: per-task state resets on `startSession` / `finishSession`. No persistence, so process restart resets cleanly.
- **Scope**:
  - Add `app/native-server/src/execution/task-session-context.ts` exporting `TaskSessionContext` class. State per task: `currentUrl`, `pageRole`, `lastReadLayer`, `lastReadSource`, `targetRefsSeen: Set<string>`, `apiEndpointFamiliesSeen: Set<string>`, `readPageCount: number`, `readBudget: number` (default 6, configurable via `TABRIX_READ_BUDGET_PER_TASK` env). Methods: `noteUrlChange(url, pageRole?)` (invalidates `lastReadLayer` / `targetRefsSeen` when URL or pageRole changes), `noteReadPage({ layer, source, targetRefs?, apiFamilies? })`, `shouldAllowReadPage({ requestedLayer })` returns `{ allowed: boolean, reason?: string, suggestedLayer?: ReadPageRequestedLayer }`.
  - Default initial layer enforcement: when allowed and no prior read on this URL/pageRole, suggest `'L0+L1'` (V4.1 §0.1 hard rule — replay/API fallback enters DOM at `L0+L1`, only escalates to L2 when verifier/target evidence demands).
  - Extend `SessionManager` with a private `Map<taskId, TaskSessionContext>`; `startSession` attaches; `finishSession` detaches. Public accessor `getTaskContext(taskId): TaskSessionContext | null`.
  - In `register-tools.ts::handleToolCall`, when `name === 'chrome_read_page'`, look up the task context (via the session→task chain), check `shouldAllowReadPage`. When budget exceeded or read is redundant, return a structured warning result (`status='ok'`, content includes `{ warning: 'read_budget_exceeded' | 'read_redundant', readPageCount, readBudget, suggestedLayer }`) WITHOUT forwarding to the extension. Successful reads call `noteReadPage`.
  - Add `app/native-server/src/execution/task-session-context.test.ts` with ≥ 8 cases: virgin task allows read with `L0+L1` suggestion, budget exceeded warns, URL change resets budget, pageRole change resets budget, targetRefs accumulated and reused, env override `TABRIX_READ_BUDGET_PER_TASK=10` respected, layer escalation `L0 → L0+L1 → L0+L1+L2` allowed, layer demotion warned.
  - Add ≥ 2 integration cases in `register-tools.test.ts`: `chrome_read_page` over budget returns structured warning without bridge call; URL change in a single task allows fresh read.
- **Must not do**: persist context state to SQLite; modify `packages/shared/src/read-page-contract.ts` HVO schema; add a new MCP tool; throw a hard error when budget is exceeded (must be a structured warning, not a tool failure); change `chrome_read_page` argument schema.
- **Exit criteria**:
  - `pnpm -r typecheck` green.
  - `pnpm -C app/native-server test:ci -- --testPathPattern task-session-context` green (≥ 8 new tests).
  - `pnpm -C app/native-server test:ci -- --testPathPattern register-tools` green (existing register-tools tests + ≥ 2 new V26-05 integration cases).
  - `pnpm run docs:check` green.
- **Refs**: `.claude/strategy/TABRIX_V2_6_P0_CHAIN_V4_1_zh.md` §0.1 / §6 / §11 / §16.

### B-029 · v2.6 V26-06 — Layer Metrics + Benchmark Evidence (S2 placeholder)

- **Stage**: N/A (v2.6 S2 — reserved id) · **Layer**: X · **KPI**: 省 token · 更准
- **Owner**: Claude · **Size**: L · **Status**: `planned` (NOT scheduled for S1)
- **Dependencies**: B-025 / B-027 / B-028 landed.
- **Branch**: TBD (S2).
- **Scope (placeholder, S2 detail to follow when sprint lands)**: extend `v26-benchmark.ts` to aggregate `dispatcherInputSourceDistribution`, `readBudgetExceededRate`, `tabHygieneOnPrimaryTabRate`; wire into a `--gate` script (eventual V26-14); produce `docs/benchmarks/v26/` evidence artifacts. Schema cite + acceptance criteria written when S2 starts.
- **Why allocate the id now**: keeps the `B-NNN` ↔ `V26-NN` mapping unbroken (`AGENTS.md` §"Operational Guardrails" / Rule 20). S1 commits reference V26-06 = B-029 in their plan-out, even though no code lands.

## Sprint 3+ — backlog pool (unordered, pulled into a sprint during review)

| ID    | Stage | Layer | Title                                                                                                                                                                                                                                                                                                  | Size | Rough dependencies                    |
| ----- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------- |
| B-011 | 3a    | K/X   | `read_page` HVO stable `targetRef` (v1 done 2026-04-22 — `tgt_<10-hex>` from cyrb53 of pageRole/objectSubType/role/normalizedLabel/hrefPathBucket/ordinal; click bridge + per-tab registry; T5-F real-browser acceptance green)                                                                        | M    | B-010                                 |
| B-014 | 3c    | X     | `RecoveryWatchdog` table (consolidate dialog-prearm / interaction / screenshot fallbacks)                                                                                                                                                                                                              | L    | none                                  |
| B-015 | 3d    | X     | `read_page(render='markdown')` parameter + unit tests (v1 done 2026-04-22 — shared `RenderMode='json'\|'markdown'`, extension generates Markdown projection as a §4.3 reading surface that intentionally omits `ref`/`targetRef`, L2 source routing exposes `domJsonRef`/`markdownRef`/`knowledgeRef`) | M    | none                                  |
| B-016 | 3f    | P     | `TabrixCapability` enum + `TABRIX_POLICY_CAPABILITIES` env (done 2026-04-22)                                                                                                                                                                                                                           | S    | none                                  |
| B-017 | 3g    | K/P   | API Knowledge capture v1 (opt-in, GitHub-first, PII-safe, capture-only)                                                                                                                                                                                                                                | XL   | B-016                                 |
| B-018 | 3h    | K/E   | `tabrix_choose_context` MCP tool + seed decision table (v1 minimal slice done 2026-04-22; v1.5 telemetry + outcome write-back + markdown branch done 2026-04-22; **v2 ranked replay-aware artifact + replay-eligibility post-mortem fields done 2026-04-23 via V24-03**)                               | L    | B-011 + B-013 + B-015 + B-017 in Beta |
| B-019 | 3i    | M     | `memory_insights` table + Sidepanel Insights tab                                                                                                                                                                                                                                                       | M    | B-003 (shared UI layer)               |
| B-020 | 4a    | E     | `experience_export` / `experience_import` + PII redact + dry-run                                                                                                                                                                                                                                       | M    | B-012 stable                          |
| B-024 | 3c    | X     | Click V2 · verifier hook v1 (GitHub repo-nav: issues / pull_requests / actions)                                                                                                                                                                                                                        | S    | B-023                                 |

> Items `B-010`, `B-011`, `B-012`, `B-013`, `B-015`, `B-021`, `B-022` are landed (`B-011` v1 on 2026-04-22; `B-015` v1 on 2026-04-22). The remaining pool items (`B-014`, `B-017` v2, `B-018` full Stage 3h, `B-019`, `B-020`, `B-024` follow-ups, plus the Stage 3a UI-Map-consumer cutover that `B-011` v1 deliberately did not do) feed Sprint 4 review.
>
> **B-024 · Click V2 · verifier hook v1** (landed outside a sprint boundary, 2026-04-21, Claude). Tracking-only entry so AGENTS.md rule 20 stays satisfied. Scope follows `docs/CLICK_V2_EXECUTION_BRIEF_V1.md`: new `click-verifier.ts`, internal `verifierContext` on `ClickToolParams` (not on the public MCP input schema yet — brief §6), public click response gains optional `postClickState` (brief §5: `beforeUrl` / `afterUrl` / `pageRoleAfter` / `verifierPassed` / `verifierReason`), `success` collapses to `false` when a requested verifier fails. Three v1 keys: `github.repo_nav.issues` / `github.repo_nav.pull_requests` / `github.repo_nav.actions`. Tests: `tests/click-verifier.test.ts` covers brief §10 cases 1–5 directly against the pure evaluator plus the IO wrapper. Real-browser acceptance **not** executed in this environment — same MV3 constraint that B-023 documented; follow-up covers workflow-run / workflow-job / security-tab verifiers (brief §13 non-goals for v1).
>
> If a candidate for a backlog item cannot be mapped to one of the Stages above, that's a signal the MKEP roadmap is missing a dimension — raise it in the next sprint review instead of coding.

## Sprint Review Protocol (run every Sunday)

1. Claude (or whichever AI is active) reads `git log --since='last sunday'`.
2. For each merged PR, mark its `B-NNN` as `done` in this file with a link to the merge commit.
3. For each in-progress branch with no merge yet, mark `in_progress`.
4. If a sprint item slipped, either (a) move to Sprint N+1 keeping `planned`, or (b) split into smaller items and rename.
5. Pull the top 3–5 items from "Sprint 3+ backlog pool" into the next sprint, sequenced by dependency.
6. Commit the updated backlog as `docs(backlog): sprint N review — carry-over and next sprint seeding`.
7. If Sprint 1 or any other sprint needs a mid-week adjustment, create a follow-up entry rather than rewriting history.

## Cross-Sprint Invariants

- **No regression on the 3 MKEP foundations** — Policy Phase 0 risk coverage matrix, Memory Phase 0.1-0.3 persistence, Knowledge Stage 1-2 registry-first — must stay green at all times. Any backlog item that threatens one of these must land behind a feature flag and flip only after Claude explicitly sign-off.
- **No re-introduction of removed surfaces** — see `AGENTS.md` rule 19 and `docs/PRODUCT_PRUNING_PLAN.md`.
- **No PR touches both `native-server` schema and `chrome-extension` UI in the same commit.** Split across two PRs with explicit ordering; keeps reverts surgical.
- **Every PR updates this file** in the same commit, moving its own `B-NNN` from `planned` / `in_progress` → `done`, otherwise the reviewer will block the merge.

## Changelog (of this file)

- 2026-04-20 — Sprint 1 seeded: Stage 3e Memory Run History UI. Initial commit.
- 2026-04-20 — Sprint 1 closed same day: B-001 / B-002 / B-003 / B-004 all `done`. Retro at `docs/SPRINT_1_RETRO.md`. `AGENTS.md` Codex Delegation Rules updated with sandbox lesson from B-004.
- 2026-04-20 — Sprint 2 locked: B-005 (Experience schema seed) / B-006 (Memory filter/search) / B-007 (CI bundle gate) / B-008 (testing conventions doc) / B-009 (Codex fast — schema-cite rule). Themes: Stage 3b seed + Stage 3e polish + Sprint 1 retro action items.
- 2026-04-20 — Sprint 2 closed same day: all 5 items `done`. B-009 successfully re-tested the Codex "draft-only" handoff protocol — Codex completed the 2-file edit, Claude verified + committed. Retro at `docs/SPRINT_2_RETRO.md`. `AGENTS.md` gained an Operational Guardrails section covering bundle-size gate and schema-cite rule.
- 2026-04-20 — Sprint 3 locked: B-010 (Knowledge UI Map schema + GitHub seed) / B-021 (CSS bundle gate) / B-012 (Experience action-path aggregator) / B-022 (Codex fast — drop rule-N numbering). Themes: Stage 3a Knowledge seed + Stage 3b first write path + Sprint 2 retro §7 follow-ups. B-021 and B-022 added to the pool as part of this lock.
- 2026-04-20 — Sprint 3 · B-021 done: `scripts/check-bundle-size.mjs` extended to gate `sidepanel-*.css` (soft 20 kB / hard 22 kB) alongside the existing `sidepanel-*.js` gate (unchanged, soft 25 / hard 40). `AGENTS.md` Operational Guardrails updated with a two-row threshold table. Baselines: JS ≈ 20.5 kB, CSS ≈ 17.8 kB.
- 2026-04-20 — Sprint 3 · B-023 done: `chrome_click_element` tool response now exposes `dispatchSucceeded` / `observedOutcome` / `verification` alongside `success`, and `success` is no longer synonymous with "the content-script promise resolved". 13-value `ClickObservedOutcome` enum landed in `packages/shared/src/click.ts`. The forbidden combo `{success:true, navigationOccurred:false, observedOutcome:'no_observed_change'}` is now unreachable (contract regression test asserts this). Real-browser validation deferred to a follow-up that runs outside the sandbox.
- 2026-04-20 — Sprint 3 mid-sprint adjustment: **B-023** (click contract hotfix) pulled in as a P1 GA reliability item. Sequenced between B-021 and B-012 — see the B-023 entry for why ordering matters (B-012 reads `step.status`, which is currently polluted by the false-success defect). Execution spec `docs/CLICK_CONTRACT_REPAIR_V1.md` committed alongside the backlog update so the contract is reviewable independently of the code change. Sprint 3 scope is now 5 items (B-010 / B-021 / B-023 / B-012 / B-022); no item was dropped to make room — Sprint 3 is deliberately accepting the overrun because the hotfix cannot wait for Sprint 4.
- 2026-04-21 — Sprint 3 · B-012 done: native-server now projects terminal Memory sessions into `experience_action_paths` with an idempotent session marker (`memory_sessions.aggregated_at`). Landed modules: `experience-aggregator.ts` + `experience-repository.ts`; covered by native-server aggregator/migration tests. No MCP tool surface was added, and `experience_locator_prefs` remains untouched (deferred to follow-up items).
- 2026-04-22 — Sprint 3 · B-013 done (read-only half of the Stage 3b write+read loop): `experience_suggest_plan` MCP tool (P0, native-handled, no extension round-trip) returns ranked `ExperienceActionPathPlan[]` for `(intent, pageRole?)` lookups. New routing lane (`getNativeToolHandler` short-circuit in `register-tools.ts`) keeps SQLite-backed tools off the bridge; sessionManager step bookkeeping preserved. Caps: intent ≤ 1024 chars, pageRole ≤ 128, `limit ∈ [1, 5]`. Memory-off → `status: 'no_match'` + `persistenceMode: 'off'` (graceful, not `isError`). Tests: 16 in `experience-suggest.test.ts` + 5 in `native-tool-handlers.test.ts`. `experience_replay` / `experience_score_step` / locator-prefs MCP surface remain explicit non-goals — see B-013 entry "Next" block.
- 2026-04-22 — B-013 P1 follow-up fix: stop `experience_suggest_plan` from being projected back into `experience_action_paths`. `ExperienceAggregator.projectPendingSessions()` now skips sessions whose entire step list is in `EXPERIENCE_AGGREGATION_EXCLUDED_TOOLS` (`{ 'experience_suggest_plan' }`) and marks them `aggregated_at` so the pending-scan does not loop. Public MCP contract / `handleToolCall()` flow / audit-trail unchanged. New regression tests: aggregator unit test "H" and two integration tests under `experience_suggest_plan does not pollute Experience (B-013 P1 regression)`.
- 2026-04-22 — B-016 done: capability opt-in gate landed. `TabrixCapability` enum + `ALL_TABRIX_CAPABILITIES` in `packages/shared/src/capabilities.ts` (v1 capability: `api_knowledge`). Native-side `parseCapabilityAllowlist()` / `isCapabilityEnabled()` in `app/native-server/src/policy/capabilities.ts` parse `TABRIX_POLICY_CAPABILITIES` (comma-separated, `all` token, case-sensitive, default-deny). Orthogonal to existing P0–P3 risk tiers and `TABRIX_POLICY_ALLOW_P3` — feature-level gate, not tool-level. 12 new parser tests; no MCP surface change.
- 2026-04-22 — B-017 done (capture v1): GitHub-first, opt-in, PII-safe API Knowledge capture. New `knowledge_api_endpoints` table (idempotent `CREATE IF NOT EXISTS`, dedup by `(site, endpoint_signature)`, `sample_count`/`first_seen_at`/`last_seen_at` provenance). `KnowledgeApiRepository` owns persistence; `api-knowledge-capture.ts` is a pure transformer covering 9 GitHub endpoint families (issues / pulls / actions runs / actions workflows / search/issues / search/repositories / repo metadata + their `:number`/`:run_id` detail variants) plus an `unclassified` fallback. Wired through a new `chrome_network_capture` post-processor; capture is gated on `TABRIX_POLICY_CAPABILITIES=api_knowledge`. Hard guarantees (regression-tested): never persists raw header values, cookies, query values, request body values, or response body text — only header _names_, query _keys_, body _keys_, presence flags (`hasAuth` / `hasCookie`), and a coarse response shape descriptor. Out-of-scope (deferred): `knowledge_call_api` / API replay / non-GitHub sites / UI / context-chooser integration (B-018 dependency stays intact).
- 2026-04-22 — B-018 v1.5 landed (V23-04, fast-lane): chooser telemetry + outcome write-back + markdown reading branch. (1) New SQLite tables `tabrix_choose_context_decisions` (one row per `status='ok'` chooser call: `decision_id` / `intent_signature` / `page_role` / `site_family` / `strategy` / `fallback_strategy` / `created_at`) and `tabrix_choose_context_outcomes` (one row per write-back, FK back to decisions). DDL lives in `app/native-server/src/memory/db/schema.ts`; idempotent `CREATE IF NOT EXISTS` so old DBs from before V23-04 pick up the tables on next open without a migration. (2) `runTabrixChooseContext` now appends a decision row when telemetry is wired and surfaces the new opaque `decisionId` field on `TabrixChooseContextResult`. Failure to write telemetry never poisons the chooser result — the `decisionId` is simply omitted (treated as "telemetry off"). (3) New MCP tool `tabrix_choose_context_record_outcome` (P0, pure-INSERT, native-handled). Inputs `{decisionId, outcome}` where outcome ∈ `{reuse, fallback, completed, retried}` (closed set). Returns `{status, decisionId, outcome, error?}` with three `status` values: `ok` (row appended), `invalid_input` (malformed args), `unknown_decision` (well-formed but no matching decision row — caller distinguishes "telemetry lost" from "permission denied"). (4) New `read_page_markdown` strategy joins `ContextStrategyName`. The chooser routes to it when (a) no experience hit, (b) no usable knowledge catalog, (c) `siteFamily === 'github'`, (d) `pageRole` is on the new hand-curated `MARKDOWN_FRIENDLY_PAGE_ROLES` whitelist (`repo_home` shipping today; `issue_detail` / `pull_request_detail` / `discussion_detail` / `wiki` / `release_notes` / `commit_detail` pre-listed for forward-compat). Outside the whitelist the v1 fallback (`read_page_required`) is preserved so JSON-only callers see no behavior change. Markdown is a _reading_ surface — JSON HVOs / candidateActions / `targetRef` stay the execution truth (B-015 / V23-03 invariant). (5) `pnpm run release:choose-context-stats` (`scripts/release-choose-context-stats.mjs`) — read-only release evidence script that aggregates strategy distribution and outcome ratios from the telemetry tables (supports `--since`, `--json`, `--db`). Refuses to operate on a DB that pre-dates V23-04 so the report cannot silently say "0 rows" when the table is missing. (6) Tests: 21 new cases in `choose-context.test.ts` (markdown branch routing, telemetry decisionId surfacing, telemetry write-failure isolation, outcome runner input validation, unknown-decision branching, outcome write-failure isolation) plus a dedicated 8-case suite in `memory/telemetry/choose-context-telemetry.test.ts` against a real `:memory:` SQLite handle (PK collision, null fields, aggregation, `since` filter). Risk-tier guard test extended to assert `RECORD_OUTCOME` is registered as P0.
- 2026-04-23 — V24-05 landed (real-browser benchmark v2 framework + v2.4.0+ release gate, v2.4.0). Pure transformer `app/native-server/src/benchmark/v24-benchmark.ts` (no IO; sibling to v23 `v23-benchmark.ts`, NOT a replacement — both ship). Pair-aware schema: each KPI scenario emits two `kind: 'pair'` records (`first_touch` / `second_touch`) binding tool-call sequence numbers to roles. Carries forward K1..K4 (v23 semantics, unchanged) and adds the v2.4 K5..K8: K5 second-touch speedup median (`firstTouchDurationMs / secondTouchDurationMs`), K6 replay success-rate median (per-pair `successCount / replayCount` for second-touch tool calls tagged `chooserStrategy='experience_replay'`), K7 replay fallback-rate median (per-pair `fallbackCount / totalSecondTouchCount`), K8 token-saving-ratio median (`(firstTouchTokensIn - secondTouchTokensIn) / firstTouchTokensIn`; HIGHER is better — corrected v2.4.0 closeout, gate guidance K8 ≥ 0.40, V24-04 trigger remains "K8 < 0.40 means second-touch saves <40 % of first-touch tokens"). Per-tool-call records carry V24-03 chooser metadata (`chooserStrategy`, `chooserBlockedBy`) which feed `replayEligibilityDistribution` + `replayEligibilityBlockedBy` distributions on the report. New release gate `scripts/lib/v24-benchmark-gate.cjs` (independent CommonJS module from `v23-benchmark-gate.cjs`; the two are mutually exclusive by version): hard invariants are lane-integrity / K3 ≥ 0.85 / K4 ≤ 0.10 / non-empty scenarios / `reportVersion === 1` / `pairCount ≥ 3` per declared KPI scenario / baseline-comparison-table embed in release notes; soft (`WARN:`) reasons cover K5..K8 guidance (K5 ≥ 1.5, K6 ≥ 0.80, K7 ≤ 0.20, K8 ≥ 0.40 — K8 is "higher is better" under the corrected `(first - second) / first` semantic). New CLI `pnpm run benchmark:v24` (`scripts/benchmark-v24.mjs`) reads NDJSON, writes `docs/benchmarks/v24/<runId>.json`, supports `--gate` (gate-then-write semantics, hard reasons block the write) and `--baseline <v23-report.json>` to auto-emit `docs/benchmarks/v24/v24-vs-v23-baseline-<date>.md` with the canonical `metric | v2.3.0 baseline | v2.4.0 median | delta | direction` table. `scripts/check-release-readiness.mjs` adds a `benchmarkGateAppliesV24` branch (v2.4.0+) preempting the v23 branch (which still applies to v2.3.x). `--allow-missing-notes` does NOT bypass the v24 content gate, the baseline-comparison-table embed requirement, or the pairCount check (mirrors the V23-06 closeout). New tests: `v24-benchmark.test.ts` (transformer + gate unit cases — pair-aware K5..K8 medians, replay eligibility distribution, K3/K4 hard fails, pairCount<3 hard fail, soft WARN partitioning, version-drift hard fail, reportVersion check); `release-gate-v24-fs.test.ts` (file-system anchored: malformed JSON / missing pairs / lane violation / baseline-comparison-table embed enforcement / spawn test asserting `--gate` does not write a report on hard failure); `release-gate-v24-allow-missing-notes.test.ts` (spawn test verifying the v2.4.0+ content gate fires even with `--allow-missing-notes` set, mirroring V23-06). Verification: `pnpm -r typecheck` green; full native-server `jest:ci` green (49 suites / 582 passed / 24 skipped). **Real-browser MCP run NOT executed by Claude** — fast-lane is not allowed to run the maintainer's `tabrix-private-tests` `acceptance:v2.4.0` runner. Codex / the maintainer must run the runner, project the NDJSON via `pnpm run benchmark:v24 -- --input … --gate --baseline docs/benchmarks/v23/v23-baseline-2026-04-23.json`, paste the auto-generated baseline table into `docs/RELEASE_NOTES_v2.4.0.md` (renamed from the current `_DRAFT.md`), commit the report under `docs/benchmarks/v24/`, and bump the five `package.json` files in lockstep before `release:check` will pass on the v2.4.0+ branch. New release-notes draft `docs/RELEASE_NOTES_v2.4.0_DRAFT.md` documents the maintainer command list and embeds the placeholder baseline-comparison table (clearly marked NOT release-ready). Out of scope (deferred): K8-driven token-cache work (V24-04, conditional v2.5; gated on real-MCP K8 < 0.40 evidence), K6 long-term trend instrumentation (v2.5), v24 telemetry-table schema bump for chooser ranked-depth statistics (v2.5).
- 2026-04-23 — V24-03 landed (`tabrix_choose_context` v2 — chooser-side ranked replay-aware artifact, v2.4.0). Extends the V23-04 v1.5 chooser with a deterministic ranked Experience artifact and a closed-set replay-eligibility post-mortem field, consuming V24-02's persisted composite scores. Public contract in `packages/shared/src/choose-context.ts`: new `'experience_ranked'` artifact kind (single artifact, optional `ranked: TabrixChooseContextRankedCandidate[]` of length ≤ `EXPERIENCE_RANKED_TOP_N=3`, each `{ ref, score, replayEligible, blockedBy }`); new closed `ReplayEligibilityBlockReason` union (`'capability_off' | 'unsupported_step_kind' | 'non_portable_args' | 'non_github_pageRole' | 'below_threshold' | 'stale_locator' | 'none'`); `TabrixChooseContextResult` gains `rankedCandidateCount?` + `replayEligibleBlockedBy?` + `replayFallbackDepth?: 0 | 1 | 2 | 3 | 'cold'` (the chooser only ever writes `0` / `'cold'` — the actual ladder depth is maintained downstream by the replay engine in V24-04+). New thresholds `EXPERIENCE_REPLAY_MIN_SUCCESS_RATE=0.80` + `EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT=3` + `EXPERIENCE_RECENCY_DECAY_DAYS=30` (V24-03 strict gate; the legacy `EXPERIENCE_HIT_MIN_SUCCESS_RATE=0.5` `experience_reuse` bar is unchanged). New module `app/native-server/src/mcp/choose-context-replay-rules.ts` houses the pure ranking logic (`isReplayEligible(row, capabilityEnabled)` returns the FIRST blocker in the closed enum order so post-mortem grouping is stable; `rankExperienceCandidates({rows, capabilityEnabled, nowIso, pageRole})` derives composite scores via cache hit (`composite_score_decayed`) → fallback `projectCompositeComponents` → `applyRecencyDecay` and applies the documented tie-break: `score DESC → successCount DESC → lastReplayAt DESC NULLS LAST → actionPathId ASC`); ineligible candidates are kept in the ranked list with their blocker so telemetry can group "we had a candidate but blocked it". `app/native-server/src/mcp/choose-context.ts` now invokes the ranking module on every chooser call (`runTabrixChooseContext` injects `now` so tests stay deterministic), surfaces `experience_ranked` artifact whenever Experience rows surface (even on the `experience_reuse` downgrade branch), and exposes `rankedCandidateCount` / `replayEligibleBlockedBy` / `replayFallbackDepth` on the result. **Telemetry table schema is intentionally frozen at the V23-04 v1.5 form in v2.4** — the chooser does NOT persist the new V24-03 fields to `tabrix_choose_context_decisions` (preserving the v2.3 release gate); ranked-depth statistics are deferred to v2.5. **Memory-not-read invariant locked**: `choose-context.ts` and `choose-context-replay-rules.ts` only depend on `experience.suggestActionPaths` (the aggregator-only path); a regression test pins the import graph against `step-repository` / `session-repository`. Tests: 20 new unit cases in `choose-context-replay-rules.test.ts` (FIRST-blocker order across the full enum, top-N cap, cache-hit short-circuit, derived-score fallback, deterministic tie-break, ineligible-kept-in-list, capability-off blocker, custom task weights, recency decay) + 6 new chooser-orchestrator cases in `choose-context.test.ts` (ranked artifact happy path, capability-off downgrade, non_portable_args downgrade, below_threshold downgrade with successCount<3, rankedCandidateCount=0 cold path, telemetry table-schema-unchanged guard, Memory-not-read invariant). The two V24-01 e2e fixtures in `experience-replay-e2e.test.ts` were topped up via `upsertActionPath(successDelta=2)` to clear the new strict V24-03 success-count floor (the V24-01 invariant "aggregator-produced row is routed to experience_replay" still holds — it now requires ≥3 successes, by design). Verification: `pnpm -r typecheck` green; full native-server `jest` suite green (46 suites / 533 passed / 24 skipped). Out of scope (deferred): replay-engine `replay_fallback_depth` ladder maintenance (V24-04 candidate, gated on Codex's V24-05 benchmark evidence), telemetry-table schema bump for the new fields (v2.5), multi-site decision table beyond GitHub (full Stage 3h DoD).
- 2026-04-23 — V24-02 landed (`experience_score_step` v1 + replay outcome write-back + session-end composite score, v2.4.0). New native (non-bridged) MCP tool `experience_score_step` (`P1` + `requiresExplicitOptIn` + **reuses** the V24-01 `experience_replay` capability — no new capability key). Public contract in `packages/shared/src/experience-score-step.ts` (DTOs, closed `TabrixExperienceScoreStepInvalidInputCode` enum, `TABRIX_EXPERIENCE_SCORE_STEP_ACTION_PATH_ID_PATTERN`, `MAX_TABRIX_EXPERIENCE_SCORE_STEP_STEP_INDEX=15`, `EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS` + `EXPERIENCE_SCORE_STEP_GITHUB_TASK_WEIGHTS` + `getTaskWeightsFor` for Knowledge `taskWeights` v1, `EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS`). Schema additive migration in `app/native-server/src/memory/db/schema.ts`: `memory_sessions` gains `composite_score_raw REAL` + `components_blob TEXT`; `experience_action_paths` gains `last_replay_at TEXT` + `last_replay_outcome TEXT` + `last_replay_status TEXT` + `composite_score_decayed REAL` + a partial `composite_score_decayed` index; new table `experience_writeback_warnings` for the isolation telemetry path. Migrations are idempotent: `ensureExperienceReplayWritebackColumns` in `client.ts` adds columns only when missing. Native handler in `app/native-server/src/mcp/experience-score-step.ts` — strict input parser, capability gate, persistence gate, single-write `recordReplayStepOutcome` dispatch, **isolation contract on SQLite failure** (catches the throw, writes a `experience_writeback_warnings` row, returns `status: 'isolated'` so the caller's path is never blocked). `ReplayEngine` (in `experience-replay.ts`) gets a new optional `outcomeWriter` hook that fires per-step (success → `state_toggled`, failure → `no_observed_change` projection in `mapFailureToOutcome`); production wiring in `register-tools.ts::buildReplayDeps` binds the hook to `experience.recordReplayStepOutcome` with double-layered isolation. Aggregator (`experience-aggregator.ts`) adds session-end composite-score writeback for replay sessions only: deterministic `projectCompositeComponents` → `computeRawComposite` (per-`taskWeights` v1) → `applyRecencyDecay`, then `SessionCompositeScoreWriter.write` outside the `upsertAndMarkTxn` transaction so `aggregated_at` always lands even when composite write fails (V24-02 isolation policy mandates that `aggregated_at` is **not** a retry hook). New module `composite-score.ts` is pure / side-effect-free / fully unit-testable. Single-source-of-truth for outcome→delta projection lives in `ExperienceRepository.recordReplayStepOutcome`. Façade change: `ExperienceQueryService` exposes `recordReplayStepOutcome` + `recordWritebackWarning` passthroughs (docblock updated — façade is no longer strictly read-only). Tests: 58 new unit cases across `composite-score.test.ts` (12), `experience-score-step.test.ts` (28), and the V24-02 extension to `experience-repository.test.ts` (18 covering write-back deltas, no-match, no-regression on `last_used_at`, composite update, warning persistence, ordering, and migration idempotence). Verification: `pnpm -r typecheck` green; full native-server `jest` suite green (45 suites / 506 passed / 24 skipped); the V24-01 self-pollution regression in `experience-suggest.test.ts` still passes (replay sessions still fold into the original row, no new bucket created). Out of scope (deferred): `parent_step_id` cross-link (V24-04+), ranked-candidates fallback ladder in chooser (V24-03), benchmark v2 with K5–K8 metrics (V24-05), real-browser scenario family `t5-G-experience-replay` step-write-back assertions (sibling PR in `tabrix-private-tests`), an outbox/retry path for isolated warnings (v2.5).
- 2026-04-22 — `B-EXP-REPLAY-V1` v1 landed (V24-01, v2.4.0). Implements the locked §10 brief: new bridged MCP tool `experience_replay` (`P1` + `requiresExplicitOptIn: true` + new `experience_replay` capability gate — first non-P3 use of `requiresExplicitOptIn`). Public contract in `packages/shared/src/experience-replay.ts` (DTOs, closed failure-code enum, `MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET=16`, `TABRIX_REPLAY_PLACEHOLDERS={queryText,targetLabel}`, GitHub-only pageRole + supported step-kind sets). Native handler / engine in `app/native-server/src/mcp/experience-replay.ts` — pure-IO `ReplayEngine` with stubbable bridge/recorder, terminal-on-first-failure (no retry/re-plan/fallback), defense-in-depth capability gate. Wiring: `register-tools.ts` adds `filterToolsByCapability` + dispatch-side capability check + production `buildReplayDeps` (binds extension dispatch + per-step `memory_steps` recorder + session task-intent retag); listTools strips capability-gated tools when env is unset. Aggregator special-case in `experience-aggregator.ts` (brief §7): replay sessions tag `task.intent='experience_replay:<actionPathId>'`, aggregator detects the prefix and projects success/failure deltas back onto the original row (preserves `step_sequence` / `pageRole` / `intentSignature`); stale-id and `:invalid` sentinel mark-aggregated without seeding a bogus bucket. Chooser branch in `choose-context.ts` adds `experience_replay` strategy when capability + GitHub pageRole + every step kind in supported set all qualify (fallback `experience_reuse → read_page_required`). New shared capability `experience_replay`; `ContextStrategyName` extended. Out of scope (deferred per §10): `parent_step_id` migration (V24-02+), `experience_score_step` + Knowledge `taskWeights` (V24-02), ranked-candidates fallback ladder (V24-03), `readable_markdown` lazy column (V24-04), real-browser scenario family `t5-G-experience-replay` (sibling PR in `tabrix-private-tests`), ExperienceTab UI (v2.4.x or v2.5). Verification: full repo typecheck + native-server `test:ci` (430 passed) + extension `vitest` (384 passed) + `docs:check` + `release:check` all green; targeted `experience-replay` test pattern: 53 passed. New design doc `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` specifies the v1 contract for `experience_replay` (write/execute half of Stage 3b): input/output DTO (named `actionPathId` + whitelisted `variableSubstitutions` + opt `targetTabId` / `maxSteps`), proposed `P1` + `requiresExplicitOptIn` + new `experience_replay` capability tier (Alternatives A/B/C documented), closed failure-code enum, fail-closed step semantics (no autonomous retry, no autonomous re-locator, no silent CDP/JS escalation), Memory-evidence write-back via the existing `memory_sessions` + `memory_steps` shape (no bespoke `experience_replays` table), substitution boundary tied to a new optional `templateFields` step annotation, and a 3-layer test matrix (unit + integration + private-repo `T5-G-experience-replay` scenarios). **No code lands**; the brief enumerates 7 owner-lane open questions (risk tier, cross-link, capability name, substitution whitelist scope, schema bump timing, P3 allowlist key, acceptance scenario count) that gate any future fast-lane implementation per `AGENTS.md` §"Tiered Execution Model".
- 2026-04-22 — B-018 v1 minimal slice landed (NOT full Stage 3h DoD): rule-based `tabrix_choose_context` MCP tool (P0, native-handled, read-only). Inputs `{intent, url?, pageRole?, siteId?}`; outputs `{status, strategy, fallbackStrategy?, reasoning, artifacts, resolved, error?}` over a fixed 3-strategy set: `experience_reuse` / `knowledge_light` / `read_page_required`. Decision tree is deterministic: Experience hit (success-rate ≥ 0.5) → `experience_reuse`; else GitHub family + `api_knowledge` capability on + ≥1 captured endpoint → `knowledge_light`; else `read_page_required`. Strict non-goals (preserved as v2 candidates): no model calls, no scoring system, no multi-round planner, no Sidepanel UI, no write paths, no `knowledge_call_api` (Tabrix has no execute side yet — must not lie about callability), no `tokenEstimate` (no calibration data yet), no multi-site beyond GitHub. Shared types in `packages/shared/src/choose-context.ts` (constants `EXPERIENCE_HIT_MIN_SUCCESS_RATE = 0.5`, `EXPERIENCE_LOOKUP_LIMIT = 3`, `KNOWLEDGE_LIGHT_SAMPLE_LIMIT = 5`); native logic in `app/native-server/src/mcp/choose-context.ts` (28 unit tests in `choose-context.test.ts` covering input parsing, capability gating, three branches, threshold rejection, read-only behavior); wiring + tier registration via `TOOL_NAMES.CONTEXT.CHOOSE` (P0) in `packages/shared/src/tools.ts` and `NATIVE_HANDLERS` in `native-tool-handlers.ts`. Design + DoD scope in `docs/B_018_CONTEXT_SELECTOR_V1.md`.
