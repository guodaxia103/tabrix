# Sprint 2 Retrospective (2026-W18)

> Sprint window: **2026-04-20 → 2026-04-26** (closed same day — all five items landed in one working day).
>
> Theme: Stage 3b Experience schema seed + Stage 3e Memory tab polish + infra guardrails carried over from Sprint 1 retro action items.
>
> Authoring convention: retro is written by the active AI assistant at the end of the sprint, reviewed by the human, then committed.

## 1. Demo outcome (what a human can actually see)

### On the native-server side

- `better-sqlite3` connections now ship two empty Stage 3b tables on every open: `experience_action_paths` and `experience_locator_prefs` + their composite indexes. The aggregator that writes to them is still pending (B-012), but the schema is committed so Sprint 3+ can land pure writer PRs without bundling migrations.

### On the extension side (Sidepanel → Memory tab)

1. A new chip row above the session list: `All / Running / Completed / Failed / Canceled`. Chips act like a multi-select radio group — clicking `Running` selects only running + starting sessions (starting is treated as the same active state); clicking `All` clears any selection.
2. A free-text search input alongside the chip row matches the task title **or** task intent, case-insensitive, trimmed. Whitespace-only input is a no-op.
3. When the current page contains at least one failed session, a red-tinted `↓ Jump to last failure` button appears. Clicking it smooth-scrolls the most recent failed row into view and flashes it amber for ~900 ms.
4. The pager label now shows `(showing N)` when a filter is active and hides some of the 20 loaded rows. Previous/Next still paginate by 20.
5. A new empty-state variant — "No sessions match your filters" — appears when filters hide every row; clicking `Clear filters` restores the full list without a network round-trip.

### On the infra side

- `pnpm run size:check` runs in CI after the extension build. Post-B-006 baseline for `sidepanel-*.js` is ≈ 20.5 kB; the script hard-fails at 40 kB and warns at 25 kB.
- `docs/EXTENSION_TESTING_CONVENTIONS.md` is now the single-source reference for extension Vitest patterns (`fetch` abort mocking, `chrome.storage.local.get` callback shape, `status: 'ok'` envelope discriminator, etc.).
- `AGENTS.md` has a new `Operational Guardrails` section with two rules — bundle-size gate and schema-cite — plus a reminder that `pnpm -r typecheck` does not run cleanly under Codex's `workspace-write` sandbox.

End-state matches the sprint goal: **Stage 3e polish + Stage 3b foundation + infra guardrails**, everything behind a solid test net.

## 2. What landed (sprint ledger)

| ID    | Title                                             | Planned | Actual                           | Status |
| ----- | ------------------------------------------------- | ------- | -------------------------------- | ------ |
| B-005 | Experience schema seed                            | M       | M (4 new tests)                  | done   |
| B-006 | Memory tab filter + search + jump-to-last-failure | L       | L (+11 tests, bundle +3.4/+2.1k) | done   |
| B-007 | CI sidepanel bundle-size gate                     | S       | S (40/25 kB thresholds)          | done   |
| B-008 | Extension testing conventions doc                 | S       | S (8 sections)                   | done   |
| B-009 | Codex fast — schema-cite rule in AGENTS.md        | S       | S (2 files, draft-only)          | done   |

Merge commits for the sprint (main → main fast-forwards, no merge-commit noise):

- `e50e5f7` — Sprint 2 lock (`docs(backlog): lock sprint 2 …`).
- `3770201` — B-005 (`feat(experience): seed empty Stage 3b tables + indexes` + tests).
- `5f37ed4` — B-006 (`feat(sidepanel): memory tab status filter + search + jump-to-last-failure` + tests).
- `6de2a4c` — B-007 (`chore(ci): gate sidepanel bundle size`).
- `3f59080` — B-008 (`docs(testing): extract extension vitest mocking conventions`).
- `c8ed033` — B-009 (`docs(agents): add schema-cite rule + bundle-size gate reference`).

## 3. Metrics

### Test growth

| Suite                           | End of Sprint 1 | End of Sprint 2 | Delta             |
| ------------------------------- | --------------- | --------------- | ----------------- |
| `@tabrix/tabrix` (native, Jest) | 172 / 24 skip   | 176 / 24 skip   | **+4** (B-005)    |
| `@tabrix/extension` (Vitest)    | 262             | 273             | **+11** (B-006)   |
| Combined                        | 434 + 24 skip   | 449 + 24 skip   | **+15** this week |

### Sidepanel bundle budget

| Artifact          | Post-B-003 | Post-B-006 | Delta                           |
| ----------------- | ---------- | ---------- | ------------------------------- |
| `sidepanel-*.js`  | 17.59 kB   | 20.51 kB   | **+2.92 kB** (budget +6.0 kB ✓) |
| `sidepanel-*.css` | 16.13 kB   | 18.24 kB   | **+2.11 kB** (budget +3.0 kB ✓) |

### Docs delta

| File                                    | Change                                                         |
| --------------------------------------- | -------------------------------------------------------------- |
| `docs/EXTENSION_TESTING_CONVENTIONS.md` | **new** · 8 sections                                           |
| `AGENTS.md`                             | new Operational Guardrails section (bundle-size + schema-cite) |
| `docs/MKEP_STAGE_3_PLUS_ROADMAP.md`     | Stage 3b §4.2 updated with B-005 progress note                 |
| `docs/PRODUCT_BACKLOG.md`               | Sprint 2 locked and closed; B-010+ pool untouched              |

## 4. What went well

- **Day-one close**: all five items merged on the first day of the sprint window. Every PR was a clean fast-forward. No rollback, no hotfix, no regression reported.
- **B-006's 100 % client-side filtering** kept the blast radius tiny — one composable + one Vue file, no new HTTP surface, no new shared DTO, no migration. Reverting is literally `git revert 5f37ed4`.
- **B-008 captured the freshest footgun**: the `status: 'ok'` envelope discriminator ate ~5 minutes during B-006. The doc now teaches that trap, and the next composable test that hits it will save that 5 minutes.
- **B-009 re-tested the Codex draft-only protocol end-to-end** and it worked: Codex edited exactly 2 files, hit the expected `spawn EPERM` on `pnpm -r typecheck` (per the B-004 lesson), reported clean `docs:check`, and Claude verified + committed. The protocol is now proven on Windows.

## 5. What hurt

- **Codex `workspace-write` still can't run `pnpm -r typecheck`** — `spawn EPERM` on the pnpm wrapper, distinct from the `.git/index.lock` failure from B-004. This is documented in `AGENTS.md` but it means any verification step we delegate to Codex has to be replaced by "Claude re-runs it locally before committing". Keeps Codex limited to mechanical edits, not full verification.
- **Backlog drift on B-007**: the original spec called for "update `AGENTS.md` rule 21" but `AGENTS.md` doesn't use numbered rules. Had to retrofit as a new section. Future backlog items should grep `AGENTS.md` before referencing non-existent rule numbers — or better yet, drop the numbering convention from the backlog spec.
- **Bundle delta lingers on CSS**: `sidepanel-*.css` grew +2.11 kB in B-006 but CSS isn't gated by the new size check. If B-010+ adds UI-heavy surfaces like the Insights tab (B-019), the CSS will be the first thing to creep. Action logged in §7.

## 6. Lessons

1. **The testing conventions doc is worth more than the test file itself.** B-008's 8 sections took ~45 minutes to write but will save minutes-to-hours on every new extension test file.
2. **A one-week sprint window that finishes in a day is a signal, not a problem.** It means the scope fit the team and the feature topology was clean. Don't artificially pad the next sprint — just pull the next 4-5 items from the backlog pool.
3. **"Schema seed only" is a valid backlog shape**, not a non-shippable stub. Landing B-005's tables empty unlocks parallel work on the Sprint 3 aggregator (B-012) without waiting.
4. **Codex's draft-only protocol is the right default**, not a fallback. Full-autopilot in a worktree is a specialized tool for self-contained cleanup runs — most tasks should stay in draft-only.
5. **Client-side filtering beats server-side for lists ≤ 200 rows**. Zero network noise, instant UX, no schema change. The moment B-006 needed to filter across all 10k Memory rows, we'd need a `?q=` endpoint — but the current 20-per-page viewport doesn't.

## 7. Action items for Sprint 3

- [ ] Draft CSS bundle-size gate (`sidepanel-*.css`) as a follow-up `B-NNN` in the Sprint 3+ backlog pool.
- [ ] Decide Sprint 3 theme: most likely **Stage 3b Experience aggregator (B-012)** paired with a Stage 3a knowledge seed (B-010) + a small Sidepanel Insights preview (B-019). Confirm during sprint-review with the human.
- [ ] Drop the "rule N" numbering convention from `docs/PRODUCT_BACKLOG.md`'s B-NNN templates. Replace with "add a new subsection titled …".
- [ ] Add `scripts/check-bundle-size.mjs` to handle both JS and CSS with separate thresholds (small refactor, ≤ S).
- [ ] Continue exercising Codex draft-only on 1 item per sprint; escalate to full autopilot only if a truly disposable worktree task appears.

## 8. Changelog

- `docs/PRODUCT_BACKLOG.md` §Sprint 2: promoted from placeholder → current → closed over the course of this sprint.
- `AGENTS.md`: +1 section (`Operational Guardrails`), +1 note in `Operational sandbox`, +1 reading-list entry for extension tests.
- Sprint 2 close signed off by Claude on 2026-04-20.
