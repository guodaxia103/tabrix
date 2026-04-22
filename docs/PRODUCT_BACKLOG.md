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
  - `experience_replay(intent, variables) → plan` — write/execute path; needs Policy review before exposure.
  - `experience_score_step(stepId, result)` — Memory write path from upstream agents; needs schema + abuse-vector review.
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

## Sprint 3+ — backlog pool (unordered, pulled into a sprint during review)

| ID    | Stage | Layer | Title                                                                                     | Size | Rough dependencies                    |
| ----- | ----- | ----- | ----------------------------------------------------------------------------------------- | ---- | ------------------------------------- |
| B-011 | 3a    | K/X   | `read_page` HVO stable `targetRef` (historyRef + hvoIndex + contentHash)                  | M    | B-010                                 |
| B-014 | 3c    | X     | `RecoveryWatchdog` table (consolidate dialog-prearm / interaction / screenshot fallbacks) | L    | none                                  |
| B-015 | 3d    | X     | `read_page(render='markdown')` parameter + unit tests                                     | M    | none                                  |
| B-016 | 3f    | P     | `TabrixCapability` enum + `TABRIX_POLICY_CAPABILITIES` env (done 2026-04-22)              | S    | none                                  |
| B-017 | 3g    | K/P   | API Knowledge capture v1 (opt-in, GitHub-first, PII-safe, capture-only)                   | XL   | B-016                                 |
| B-018 | 3h    | K/E   | `tabrix_choose_context` MCP tool + seed decision table (v1 minimal slice done 2026-04-22) | L    | B-011 + B-013 + B-015 + B-017 in Beta |
| B-019 | 3i    | M     | `memory_insights` table + Sidepanel Insights tab                                          | M    | B-003 (shared UI layer)               |
| B-020 | 4a    | E     | `experience_export` / `experience_import` + PII redact + dry-run                          | M    | B-012 stable                          |
| B-024 | 3c    | X     | Click V2 · verifier hook v1 (GitHub repo-nav: issues / pull_requests / actions)           | S    | B-023                                 |

> Items `B-010`, `B-012`, `B-013`, `B-021`, `B-022` are pulled into Sprint 3 above; `B-011` stays in the pool and is a candidate for Sprint 4.
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
- 2026-04-22 — B-018 v1 minimal slice landed (NOT full Stage 3h DoD): rule-based `tabrix_choose_context` MCP tool (P0, native-handled, read-only). Inputs `{intent, url?, pageRole?, siteId?}`; outputs `{status, strategy, fallbackStrategy?, reasoning, artifacts, resolved, error?}` over a fixed 3-strategy set: `experience_reuse` / `knowledge_light` / `read_page_required`. Decision tree is deterministic: Experience hit (success-rate ≥ 0.5) → `experience_reuse`; else GitHub family + `api_knowledge` capability on + ≥1 captured endpoint → `knowledge_light`; else `read_page_required`. Strict non-goals (preserved as v2 candidates): no model calls, no scoring system, no multi-round planner, no Sidepanel UI, no write paths, no `knowledge_call_api` (Tabrix has no execute side yet — must not lie about callability), no `tokenEstimate` (no calibration data yet), no multi-site beyond GitHub. Shared types in `packages/shared/src/choose-context.ts` (constants `EXPERIENCE_HIT_MIN_SUCCESS_RATE = 0.5`, `EXPERIENCE_LOOKUP_LIMIT = 3`, `KNOWLEDGE_LIGHT_SAMPLE_LIMIT = 5`); native logic in `app/native-server/src/mcp/choose-context.ts` (28 unit tests in `choose-context.test.ts` covering input parsing, capability gating, three branches, threshold rejection, read-only behavior); wiring + tier registration via `TOOL_NAMES.CONTEXT.CHOOSE` (P0) in `packages/shared/src/tools.ts` and `NATIVE_HANDLERS` in `native-tool-handlers.ts`. Design + DoD scope in `docs/B_018_CONTEXT_SELECTOR_V1.md`.
