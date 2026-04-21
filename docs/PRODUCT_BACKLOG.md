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

## Current Sprint — Sprint 1 (2026-W17, 2026-04-20 → 2026-04-26)

**Theme**: Stage 3e · light up the Sidepanel Memory tab with real SQLite run history.

**Demo outcome** (what the human should see at end of sprint): open the extension sidepanel → Memory tab → list of recent 20 Sessions with their Tasks and Steps; click through to a Step to see `pageRole`, `historyRef` (copyable), action counts, and wall-clock duration.

**Out of scope for Sprint 1**: Experience aggregation, API Knowledge capture, pageRole-indexed recipes. Those are Sprint 2+.

### B-001 · Native-server: expose Memory read API

- **Stage**: 3e · **Layer**: M · **KPI**: 懂用户
- **Owner**: Claude · **Size**: S · **Status**: `planned`
- **Dependencies**: none (builds on existing `memory/db/client.ts`)
- **Branch**: `feat/b-001-memory-read-api`
- **Scope**:
  - Add 3 repository read methods (paginated, read-only, no writes):
    - `sessionRepo.listRecent(limit: number, offset: number): MemorySessionRow[]`
    - `taskRepo.listBySessionId(sessionId: string): MemoryTaskRow[]`
    - `stepRepo.listByTaskId(taskId: string): MemoryStepRow[]`
  - Expose as HTTP routes under `/memory/*` in `app/native-server/src/server/routes/memory.ts`:
    - `GET /memory/sessions?limit=&offset=`
    - `GET /memory/sessions/:sessionId/tasks`
    - `GET /memory/tasks/:taskId/steps`
  - Wire into `server/routes/index.ts` re-export.
  - Auth: same Bearer/loopback guard as other routes.
- **Exit criteria**:
  - `pnpm --filter @tabrix/tabrix test` passes with ≥ 3 new tests (1 per route, happy path + empty-result path).
  - `GET /memory/sessions` responds in < 50 ms for a 1,000-row DB (baseline memory fixture).
  - No write path is exposed. Unit test asserts routes reject `POST`.
  - `docs/CLI_AND_MCP.md` gets a 3-line note that these routes are HTTP-only (not MCP tools yet — they're internal sidepanel data, not LLM context).

### B-002 · Extension: Memory tab session list

- **Stage**: 3e · **Layer**: M · **KPI**: 懂用户
- **Owner**: Claude · **Size**: M · **Status**: `planned`
- **Dependencies**: **B-001**
- **Branch**: `feat/b-002-memory-tab-session-list`
- **Scope**:
  - New composable `entrypoints/sidepanel/composables/useMemoryTimeline.ts`: calls `GET /memory/sessions` via the existing native-host port (no direct `fetch`), returns `{ sessions, loading, error, reload }`.
  - Replace the Memory placeholder card in `entrypoints/sidepanel/App.vue` with a virtualized list of the last 20 sessions: `sessionId` (short), `startedAt`, `status` (completed / running / failed — color coded), task count.
  - Empty state: friendly copy pointing to "run any MCP tool to start populating Memory".
  - Loading skeleton (no 3rd-party spinner — use existing Tailwind classes).
  - Error state: red banner with "Retry" button that calls `reload()`.
- **Exit criteria**:
  - `pnpm --filter @tabrix/extension test --run` passes with ≥ 4 new tests for the composable (loading → data, loading → error, empty state, reload).
  - Manual browser check documented in the PR: sidepanel renders real SQLite data after invoking any MCP tool via Codex.
  - Bundle size delta ≤ +8 KB (compare `.output/chrome-mv3/assets/sidepanel-*.js`).

### B-003 · Extension: Memory session → task → step drill-down

- **Stage**: 3e · **Layer**: M · **KPI**: 懂用户
- **Owner**: Claude · **Size**: L · **Status**: `planned`
- **Dependencies**: **B-001**, **B-002**
- **Branch**: `feat/b-003-memory-drilldown`
- **Scope**:
  - Click a session row → right-side drawer (or expanded card) shows its Tasks with duration, tool count.
  - Click a task → shows Steps in chronological order with `pageRole`, `toolName`, `endedAt - startedAt`, error short message if any, and a "Copy historyRef" button per step (writes `mem://snapshot/<snapshotId>` to clipboard).
  - Failed steps get a red left border; retried steps show `retry N` badge.
  - Lazy load: tasks and steps are fetched only when the user drills in (no upfront prefetch).
- **Exit criteria**:
  - `pnpm --filter @tabrix/extension test --run` passes with ≥ 6 new tests (drill-down state machine, copy-to-clipboard wiring, error styling).
  - Manual browser check: can go from "session list" → "task list" → "step detail" and copy a `historyRef` that resolves via the existing `getPageSnapshot` lookup.
  - `docs/MEMORY_PHASE_0.md` gets a "Sprint 1 UI surfaced" note at the top; no schema change.

### B-004 · Codex fast task · Add JSDoc + it.todo skeleton for B-001 repo methods

- **Stage**: 3e · **Layer**: M · **KPI**: —
- **Owner**: **Codex fast** · **Size**: S · **Status**: `planned`
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

## Sprint 2 (2026-W18) — placeholders to be confirmed after Sprint 1 review

Tentative themes (final call made during Sprint 1 review):

- Expand Stage 3e: filter/search in Memory tab, pagination controls, "jump to last failure" shortcut.
- Seed Stage 3b Experience schema (`experience_action_paths`, `experience_locator_prefs`) under `app/native-server/src/memory/experience/`, **no aggregator yet** — empty tables + migrations only.
- Claude-led Policy Phase 0.1: add `requiresExplicitOptIn` hints to 3–5 currently under-tiered tools (needs fresh risk review).

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
