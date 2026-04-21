# Sprint 1 Retrospective (2026-W17)

> Sprint window: **2026-04-20 → 2026-04-26** (closed early on 2026-04-20 after B-001/B-002/B-003 all landed in the same working day).
>
> Theme: Stage 3e · light up the Sidepanel Memory tab with real SQLite run history.
>
> Authoring convention: retro is written by the active AI assistant at the end of the sprint, reviewed by the human, then committed. Future sprints copy this file's shape.

## 1. Demo outcome (what a human can actually see)

Open the extension sidepanel → **Memory** tab:

1. A paginated list of the 20 most recent Sessions appears within ~1 request round-trip of the native server.
2. Each row shows: status dot, task title (from the owning task), task intent (dimmed), step count pill, session duration, client name, start timestamp.
3. Clicking any row expands an inline panel showing every Step of that session — with tool name, status, duration, one-line input/result summary, error code + message on failure, a "retry" badge where applicable, and a **Copy historyRef** button that becomes "Copied ✓" for 1.5 s on success.
4. Previous / Next paginate 20-at-a-time. Dark mode is honoured via `prefers-color-scheme`.
5. When the native server is unreachable or persistence is off, the tab surfaces a typed, neutral message — never a raw `TypeError`.

End-state matches the sprint goal: **懂用户 KPI delivered** (the assistant can now point a user at an exact historyRef for any past step and say "this is what I did").

## 2. What landed (sprint ledger)

| ID    | Title                                         | Planned | Actual          | Status      |
| ----- | --------------------------------------------- | ------- | --------------- | ----------- |
| B-001 | Native-server: expose Memory read API         | S       | S (5 + 8 tests) | done        |
| B-002 | Extension: Memory tab session list            | M       | M (+20 tests)   | done        |
| B-003 | Extension: Memory session → step drill-down   | L       | L (+13 tests)   | done        |
| B-004 | Codex fast task · JSDoc + `it.todo` for B-001 | S       | in progress     | in_progress |

Merge commits for the sprint (main → main fast-forwards, no merge-commit noise):

- `65fa8cb` `feat(memory): add SessionRepository.listRecent + session summary read APIs`
- `1e18087` `feat(native-server): expose /memory/* read routes for sidepanel stage 3e`
- `6f250b5` `docs(memory): document /memory/* read routes and update B-001 status`
- `43ad65f` `feat(shared): add MKEP Memory read DTOs (B-002)`
- `21ae7d6` `feat(extension): add Memory HTTP client and useMemoryTimeline composable (B-002)`
- `be8dc2d` `feat(sidepanel): wire Memory tab to native-server session list (B-002)`
- `767166a` `feat(extension): add historyRef + clipboard helpers for Memory steps (B-003)`
- `2c44e08` `feat(extension): extend useMemoryTimeline with steps drill-down cache (B-003)`
- `2efef71` `feat(sidepanel): drill into a Memory session to see its steps (B-003)`

Plus the supporting docs commits: `542e5dc` (AGENTS refresh) and `d4f6d39` (PRODUCT_BACKLOG seed).

## 3. Metrics

### Test growth

- `@tabrix/tabrix` (native-server): +13 tests (5 repo + 8 route), 0 flaky, wall-clock no regression.
- `@tabrix/extension`: 229 → 262 tests (+33 across 3 new files: `memory-api-client.test.ts` 13, `use-memory-timeline.test.ts` 7, `memory-drilldown.test.ts` 13).

### Bundle size (sidepanel chunk — the only consumer of the new code)

|               | Pre-B-002 | After B-002      | After B-003      | Budget                |
| ------------- | --------- | ---------------- | ---------------- | --------------------- |
| sidepanel.js  | 5.43 kB   | 11.91 kB (+6.48) | 17.59 kB (+5.68) | +8 kB per item — PASS |
| sidepanel.css | 7.62 kB   | 11.26 kB (+3.64) | 16.13 kB (+4.87) | informal, tracked     |

Cumulative cost of the whole Memory tab feature: **+12.16 kB JS / +8.51 kB CSS**. Reasonable for a paginated list + drill-down + dark mode + status taxonomy.

### API performance (B-001 exit criterion)

- `GET /memory/sessions?limit=20` against the 1 000-row fixture: ~6 ms P50 on a warm native server (far under the 50 ms budget).
- No write path is exposed — POST/PUT/DELETE on `/memory/*` return 404; asserted in `memory-routes.test.ts`.

### Schema decisions locked

1. `Task (1) → Session (N) → Step (N)`. The original B-001 spec had "session → task → step" three-level drill-down; that shape contradicted the actual SQLite schema and was corrected in-flight. The corrected shape is now documented in B-001 and B-003 "Schema note" blocks.
2. `historyRef` lives inside `step.artifactRefs` as a `memory://snapshot/<uuid>` URI. First occurrence wins for copy-to-clipboard; documented in `extractHistoryRef`.

## 4. What went well

- **Codex CLI was not invoked during B-001/B-002/B-003.** Once the AGENTS.md "tight boundary" rule was introduced, it became easier to tell at a glance that these were architect-level tasks that Claude should drive end-to-end. Codex is queued for B-004 precisely because it is a mechanical task — that's the right shape.
- **Shared DTO module (`packages/shared/src/memory.ts`) paid for itself immediately.** The sidepanel uses the exact field names the server emits; no drift possible. This pattern should be the default for every future `M/K/E` HTTP surface.
- **Request cancellation via `AbortController` in `useMemoryTimeline`** caught two subtle test failures that would have shipped as stale-overwrite races in production. Worth every line.
- **PRODUCT_BACKLOG.md as a single source of truth.** Every commit touched its `B-NNN` status; PR descriptions wrote themselves. This is now encoded as AGENTS rule 20.
- **No rework of prior sprints.** Pruning (last session) held — no "temporary" smart-assistant / workflow code came back by accident.

## 5. What hurt

- **Schema misreading in B-001 spec.** The initial plan had a three-level drill-down because the author (me) conflated "tasks" with "sessions". Cost: roughly 30 minutes of route reshuffling plus a retro schema note. **Action**: future `M/K/E` backlog items must cite the actual table definition line (`app/native-server/src/memory/db/*-repository.ts`) before proposing an endpoint, not just the conceptual model.
- **Test timeout in `use-memory-timeline.test.ts`** during B-003: the abort-cancellation test hung because the mocked `fetch` never resolved after `abort()`. Fixed, but it cost a red CI-local run. **Action**: a small internal guideline snippet "always reject mocked fetch with `AbortError` on `signal.aborted`" should go into the extension testing conventions (not yet written — earmarked for Sprint 2 doc work).
- **TypeScript `void` vs `Promise` for `chrome.storage.local.get`.** Needed an `isThenable` guard because polyfills and MV3 differ. Not blocking, but a sign that the extension storage wrapper in `common/` is long overdue — currently every caller invents its own promise-ification.
- **B-003 bundle-size jump was not instrumented automatically.** I measured by hand against the pre-B-002 baseline; there is no CI gate yet. If the sidepanel crosses ~40 kB it will start to feel sluggish on first-open. **Action**: Sprint 3+ should introduce a bundle-size check in CI (candidate `B-0??` item).

## 6. What we learned

1. **Inline expansion beats drawer** for a sidepanel ≤ 400 px wide. Documented as the B-003 deviation. Carry this lesson into B-019 (Insights tab) and any future "list → detail" UI.
2. **Status dot + pill + dimmed intent** is the minimum viable row shape for any MKEP list UI (session, step, experience path, knowledge entry). Same visual taxonomy should be reused in B-019 and B-013 to keep the sidepanel feeling unified.
3. **Virtualization is premature** until we routinely paginate > 100 rows. For now, 20-at-a-time server-side pagination is simpler and testable.
4. **Codex delegation only makes sense for tasks where the "what" is fully specified and the "how" is mechanical.** B-004 is the archetype. B-001/B-002/B-003 were _not_ in that bucket despite each being small individually, because each made shape-of-API decisions.

## 7. Action items for Sprint 2

Carried over / spawned by this retro (will appear in the backlog with real `B-NNN` IDs during Sprint 1 review → Sprint 2 seed):

1. **[docs]** Write a one-page "extension testing conventions" note covering `fetch`/`AbortController` mocking, `chrome.storage.local` mocking, and `SyntheticEvent` quirks. Owner: Claude, Size: S.
2. **[infra]** Add a CI bundle-size gate on `sidepanel.js` (hard fail > 40 kB, warn > 25 kB). Owner: Claude, Size: S.
3. **[infra]** Promote `common/memory-api-client.ts`'s `isThenable` + port resolver into a shared extension storage utility, then migrate call sites. Owner: Claude, Size: S.
4. **[docs]** Add a "schema-cite rule" to `AGENTS.md`: every backlog item touching Memory/Knowledge/Experience must reference the actual repository file + line before the spec is approved. Owner: Claude, Size: XS (inline edit).
5. **[mkep]** Seed Stage 3b Experience **schema-only** (empty tables + migrations — no aggregator yet). Owner: Claude, Size: M. (Was already on the Sprint 2 tentative list; retro confirms it.)

These should be converted to `B-NNN` entries at the top of Sprint 2 before any implementation starts.

## 8. Sign-off

- Sprint 1 MVP (B-001 + B-002 + B-003) shipped and merged to `main`.
- Sprint 1 residual work: **B-004 Codex fast task** — in progress at close of this retro. Not a blocker for Sprint 1's demo, tracked in the backlog as `in_progress` until Codex returns and Claude reviews.
- No regressions on Memory Phase 0.1-0.3 persistence, Policy Phase 0, or Knowledge Stage 1.
- No re-introduction of any pruned surface (`AGENTS.md` rule 19 still green).

— Claude (primary AI on Sprint 1), 2026-04-20
