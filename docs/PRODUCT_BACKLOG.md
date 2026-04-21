# Tabrix Product Backlog

> Living, sprint-granular task list. Single source of truth for "what Claude and Codex work on this week."
>
> - Versioning: human-edited; regenerated weekly on Sunday by the active AI assistant.
> - Reading order: this doc **after** `AGENTS.md` and `docs/MKEP_STAGE_3_PLUS_ROADMAP.md`.
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

## Current Sprint — Sprint 2 (2026-W18, 2026-04-20 → 2026-04-26)

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
    - `step_sequence TEXT NOT NULL` (JSON: ordered list of `{ toolName, argTemplate }`)
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
- **Owner**: **Codex fast (draft-only)** · **Size**: S · **Status**: `review`
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

## Sprint 3+ — backlog pool (unordered, pulled into a sprint during review)

| ID    | Stage | Layer | Title                                                                                     | Size | Rough dependencies                    |
| ----- | ----- | ----- | ----------------------------------------------------------------------------------------- | ---- | ------------------------------------- |
| B-010 | 3a    | K     | `KnowledgeUIMapRule` schema + GitHub seed                                                 | M    | none                                  |
| B-011 | 3a    | K/X   | `read_page` HVO stable `targetRef` (historyRef + hvoIndex + contentHash)                  | M    | B-010                                 |
| B-012 | 3b    | E     | Experience action-path aggregator (reads Memory, writes Experience)                       | L    | Sprint 2 Experience schema landed     |
| B-013 | 3b    | E     | `experience_suggest_plan` MCP tool                                                        | M    | B-012                                 |
| B-014 | 3c    | X     | `RecoveryWatchdog` table (consolidate dialog-prearm / interaction / screenshot fallbacks) | L    | none                                  |
| B-015 | 3d    | X     | `read_page(render='markdown')` parameter + unit tests                                     | M    | none                                  |
| B-016 | 3f    | P     | `TabrixCapability` enum + `TABRIX_POLICY_CAPABILITIES` env                                | S    | none                                  |
| B-017 | 3g    | K/P   | API Knowledge capture (opt-in, PII redact, GitHub 5 endpoints)                            | XL   | B-016                                 |
| B-018 | 3h    | K/E   | `tabrix_choose_context` MCP tool + seed decision table                                    | L    | B-011 + B-013 + B-015 + B-017 in Beta |
| B-019 | 3i    | M     | `memory_insights` table + Sidepanel Insights tab                                          | M    | B-003 (shared UI layer)               |
| B-020 | 4a    | E     | `experience_export` / `experience_import` + PII redact + dry-run                          | M    | B-012 stable                          |

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
