# Tabrix AI Development Rules

This repository welcomes contributions from **any AI coding assistant** — Claude (Desktop / Code / Cursor), Codex CLI, Cursor Agent, Cline, Windsurf, GPT-5, Gemini, and any future tool capable of reading + writing files. The historical `Claude → Codex` two-name pairing that appears in old sprint retros was about two specific tools the original maintainer happened to be running, not a restriction on who may contribute.

What matters is the **role** an AI plays for a given task (see "Tiered Execution Model" below), not which vendor ships it.

This repository uses a strict "small, verifiable, low-regression" workflow for AI-assisted development.

All code changes in this repository must follow the `karpathy-guidelines` skill:

- think before coding
- keep the change as small as possible
- define a verifiable success condition
- prefer a real fix over a temporary suppression

## Mandatory Read Path

Before changing code or docs, every AI assistant should read the public repository docs below first, **in this order**:

1. [README.md](./README.md)
2. [docs/README.md](./docs/README.md)
3. [docs/ROADMAP.md](./docs/ROADMAP.md) — public product direction and contribution areas.
4. [docs/PRODUCT_SURFACE_MATRIX.md](./docs/PRODUCT_SURFACE_MATRIX.md) — current public product surface + capability tiers (GA/Beta/Experimental/Internal).
5. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
6. [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md)
7. [docs/PRODUCT_PRUNING_PLAN.md](./docs/PRODUCT_PRUNING_PLAN.md)
8. [CONTRIBUTING.md](./CONTRIBUTING.md)

Then continue with the smallest relevant task-specific reading set below.

### Private maintainer planning boundary

Detailed PRDs, sprint backlogs, owner-lane briefs, and version-internal plans are maintainer-private materials and must stay outside the public Git tree. Public contributors should use `docs/ROADMAP.md`, `docs/PRODUCT_SURFACE_MATRIX.md`, and code-local issues/PRs as the public working contract.

## Task-Specific Reading

### Product positioning, public docs, and boundary-governance tasks

Read:

- [docs/README.md](./docs/README.md)
- [docs/PRODUCT_SURFACE_MATRIX.md](./docs/PRODUCT_SURFACE_MATRIX.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)

### Transport, CLI, MCP, native-server, and diagnostics tasks

Read:

- [docs/CLI_AND_MCP.md](./docs/CLI_AND_MCP.md)
- [docs/TOOLS.md](./docs/TOOLS.md)

### Extension, popup, onboarding, and troubleshooting tasks

Read:

- [docs/QUICKSTART.md](./docs/QUICKSTART.md)
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
- [docs/EXTENSION_TESTING_CONVENTIONS.md](./docs/EXTENSION_TESTING_CONVENTIONS.md) — required when adding or editing any `app/chrome-extension/tests/**` file.

### MKEP Memory-layer tasks (SQLite / SessionManager / post-processor / sidepanel Memory tab)

Public touchpoints: `app/native-server/src/memory/**`, `app/chrome-extension/entrypoints/sidepanel/**` (Memory tab). Detailed phase plans are maintainer-private and must not be reintroduced under `docs/`.

### MKEP Knowledge-layer tasks (registry / seeds / HVO classifier / UI map)

Public touchpoints: `app/chrome-extension/entrypoints/background/knowledge/**`, `app/chrome-extension/entrypoints/background/tools/browser/read-page*`. Detailed Knowledge stage plans are maintainer-private and must not be reintroduced under `docs/`.

### MKEP Experience-layer tasks (action-path replay / recipes / shared deck)

Read the public MKEP code map in this file and the relevant implementation modules. Detailed Experience package briefs are maintainer-private and must not be reintroduced under `docs/`.

### MKEP Policy-layer tasks (risk-tier gating / capability opt-in)

Public touchpoints: `app/native-server/src/policy/**`, `packages/shared/src/tools.ts` (`TOOL_RISK_TIERS` + `requiresExplicitOptIn`). Detailed Policy phase plans are maintainer-private and must not be reintroduced under `docs/`.

### Release, security, and third-party reuse tasks

Read:

- [docs/RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md)
- [docs/TESTING.md](./docs/TESTING.md)
- [docs/PLATFORM_SUPPORT.md](./docs/PLATFORM_SUPPORT.md)
- [SECURITY.md](./SECURITY.md)

### Test / acceptance ownership

`main_tabrix` owns product code, public contracts, deterministic unit/integration tests, benchmark transformers, release gates, report schemas, and regression tests that do not depend on real accounts, private repositories, live browser state, or external-site stability.

Keep these in `main_tabrix`:

- Pure functions, DTO/schema validation, repository/handler tests, policy gates, release-readiness checks, bundle/docs/typecheck/audit gates, and fixture-level benchmark tests.
- Public baseline tests that protect Tabrix's declared open surface and can run deterministically in CI.

Keep these in the sibling `tabrix-private-tests` repository:

- Real MCP browser runs, live-site scenarios, login/private-account flows, private repository/account cases, benchmark NDJSON producers, screenshots, and release evidence artifacts.

Passing `main_tabrix` tests is not product-level acceptance for claims about real browser behavior, version benchmark evidence, or release readiness. Those claims require the matching `tabrix-private-tests` lane.

## MKEP Code Map (post-pruning)

Use this map when you need to locate where a layer lives. If a task does not fit any of the four layers cleanly, stop and surface the mismatch instead of inventing a new home.

| Layer          | Native server                                                      | Chrome extension                                                    | Shared                                                              |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Memory**     | `app/native-server/src/memory/**` (SQLite, SessionManager, post-processor) | Sidepanel Memory tab (placeholder, Stage 3e target)                 | –                                                                   |
| **Knowledge**  | –                                                                  | `app/chrome-extension/entrypoints/background/knowledge/**` (seeds, registry, lookup) | –                                                                   |
| **Experience** | _not yet scaffolded — will live under `src/memory/experience/`_    | Sidepanel Experience tab (placeholder, Stage 3b target)             | –                                                                   |
| **Policy**     | `app/native-server/src/policy/**`                                  | Sidepanel Policy surface (future)                                   | `packages/shared/src/tools.ts` (`TOOL_RISK_TIERS`, `requiresExplicitOptIn`) |

Cross-cutting helpers:

- `app/native-server/src/shared/data-dirs.ts` — `~/.chrome-mcp-agent/` resolver used by Memory.
- `app/chrome-extension/entrypoints/background/keepalive/` — MV3 SW keepalive (Offscreen Document + Port heartbeat). Do not reopen the old RR-V3 path.
- `packages/shared/src/` public API boundary: `constants`, `types`, `tools`, `labels`, `bridge-ws`, `read-page-contract`. **Any new cross-process type goes here, and nowhere else.**

## Removed Surfaces — Must Not Be Reintroduced

The following product surfaces were removed as part of `docs/PRODUCT_PRUNING_PLAN.md` and **must not be reintroduced** without an explicit governance decision from the repository owner:

- Smart Assistant / Quick Panel / Agent Chat in the sidepanel (Codex / Claude / Cursor / Cline are the intended upstream drivers — Tabrix does not embed its own assistant UI).
- Record & Replay v2 / v3 engine, builder UI, `run_flow` / `list_published_flows` MCP tools.
- Local semantic engine / ONNX WASM workers / `search_tabs_content` MCP tool / `@xenova/transformers` / `hnswlib-wasm-static` / `@vue-flow/*` / `elkjs`.
- Element Marker management, `element_picker` MCP tool.
- Visual Editor (`web-editor-v2`).

If a task seems to require any of these surfaces, stop and ask. The strategic value of the removed surfaces has been remapped to MKEP work tracked in maintainer-private planning, while the public boundary remains [`docs/PRODUCT_SURFACE_MATRIX.md`](./docs/PRODUCT_SURFACE_MATRIX.md).

## Tiered Execution Model (any AI assistant)

This repository splits AI-assisted work into two execution lanes. The split is based on **task nature**, not on which AI product is running. Any AI assistant (Claude, Codex, Cursor Agent, Cline, Windsurf, GPT-5, Gemini, future entrants) may run either lane — but must pick the right lane per task and must not silently cross the line.

| | **Owner-lane** | **Fast-lane** |
| --- | --- | --- |
| Who runs it | Any AI assistant **acting as the task owner** (or a human maintainer) | Any AI assistant **dispatched to execute a pre-authored brief**, including the same AI that just wrote the brief |
| Typical invocation | Interactive session, free to ask clarifying questions, designs the approach | Non-interactive / narrow session with an explicit brief; often a CLI fast-mode (`codex exec`, `cursor-agent run`, etc.) or a sub-agent |
| Allowed to decide | Architecture, public contracts, schema, risk tier, backlog entries, whether a removed surface should come back | Only how to carry out a decision the owner-lane already wrote down |
| Commit authority | Yes (after verification) | No — produces a diff / patch; the owner-lane verifies and commits |

The purpose of the split is to keep **decision quality** high while still getting the speed advantage of mechanical execution. Both lanes are first-class — an AI assistant that only ever does mechanical work is still a full contributor, and an AI assistant that drives owner-lane work does not need permission from any other tool to do so.

### Fast-lane allowlist (mechanical tasks)

When running fast-lane, an AI assistant **may** do:

1. Rename a symbol / file repo-wide with explicit search-and-replace rules.
2. Migrate imports after a module move when source and target paths are both given.
3. Add JSDoc / TSDoc blocks to an explicit list of functions.
4. Add `it.todo` test-skeleton scaffolding for an explicit list of methods.
5. Delete files that are listed by path (dead-code removal after the owner-lane has mapped references).
6. Run existing lint / format / typecheck / test scripts and report the output verbatim.
7. Apply a diff that the owner-lane drafted in prose but did not commit yet.

### Fast-lane must not do

When running fast-lane, an AI assistant **must not** do any of the following — stop and return control to the owner-lane:

1. Choose between two architectural approaches. If two designs are on the table, stop.
2. Change a public contract: MCP tool schema (`packages/shared/src/tools.ts`), `read_page` HVO contract (`read-page-contract.ts`), HTTP route shape, or a cross-process message type.
3. Add a new `TOOL_NAMES` entry, a new risk tier, or a new `requiresExplicitOptIn` flag — these are Policy-layer decisions.
4. Change the Memory / Knowledge / Experience SQLite schema.
5. Touch CI (`.github/workflows/**`) or commitlint rules.
6. Touch dependency versions or the lockfile beyond what a prior owner-lane migration already dictates.
7. Decide whether a removed surface should come back. Always escalate.

If you are a single AI assistant running both lanes within one session, the enforcement is the same: the moment you hit a "fast-lane must not do" item, switch mental mode to owner-lane (design → write it down → then execute) rather than silently deciding inside the fast path.

### Hand-off protocol

When owner-lane and fast-lane are two different AI assistants (or two different sessions of the same one):

- **Owner-lane writes** a prose brief pointing at one `B-XXX` backlog item, with: (a) files fast-lane may touch, (b) files fast-lane must not touch, (c) explicit acceptance criteria, (d) the verification commands to run at the end.
- **Fast-lane runs** the task and returns: exit status of each verification command, the list of files changed, and any decision point it hit where the brief was ambiguous.
- **Owner-lane reviews** the diff, re-runs the same verification locally, and is the one who commits and pushes.

When owner-lane and fast-lane are the same session, the protocol is the same but executed inline: write the brief as a short plan block in the conversation, then do the mechanical work, then verify, then commit.

### Operational notes: running fast-lane under a restricted CLI sandbox

Some AI CLIs run fast-lane under a filesystem sandbox (e.g. `codex exec --sandbox workspace-write`). Those environments have historically had constraints that are **not bugs in the AI product** — they are the sandbox's security model — so the operational workarounds below apply regardless of which CLI is used:

- On Windows, `workspace-write`-style sandboxes may deny writes to `.git/` (observed 2026-04-20 during B-004 with Codex CLI: `Unable to create .git/index.lock: Permission denied`). Do NOT ask a sandboxed fast-lane to `git add` / `git commit`.
- Acceptable invocation shapes for any sandboxed fast-lane:
  1. **Draft-only**: fast-lane edits files in place under `workspace-write`; the owner-lane is responsible for `git add` / `git commit` / `git push`. Make the brief's "finish" step `git diff --stat` (not `git commit`).
  2. **Full autopilot**: run the CLI's equivalent of "bypass approvals and sandbox" (e.g. `codex exec --dangerously-bypass-approvals-and-sandbox`) inside a throw-away worktree, where the fast-lane may commit; only use when the task is self-contained and the worktree is disposable.
- If a sandboxed fast-lane stops mid-task with a permission error, revert any whitespace-only / line-ending changes (`git checkout -- <files>`) before the owner-lane resumes manually — otherwise the diff review becomes noisy.
- **Verification commands inside these sandboxes also surprise**: during B-009, `pnpm -r typecheck` spawned by the sandboxed fast-lane failed with `spawn EPERM`, while `pnpm run docs:check` succeeded. Do not treat a sandbox-side typecheck failure as a real regression. The owner-lane must always re-run the full verification locally before committing.

## Operational Guardrails

These are cross-cutting size / performance / schema rules that every AI assistant (regardless of vendor or lane) must respect. They are enforced by CI in `.github/workflows/ci.yml`.

### Sidepanel bundle-size gate (added in B-007, CSS added in B-021)

- Script: `scripts/check-bundle-size.mjs`, wired as `pnpm run size:check` and run in CI after the extension build step. One script, two targets, declared in a `TARGETS` array at the top of the file.
- Targets (WXT splits JS into `chunks/` and CSS into `assets/`):
  - `app/chrome-extension/.output/chrome-mv3/chunks/sidepanel-*.js`
  - `app/chrome-extension/.output/chrome-mv3/assets/sidepanel-*.css`
- Thresholds (raw, not gzipped — easier to eyeball against the WXT build report):

  | Target             | Soft (warn)  | Hard (fail)  |
  | ------------------ | ------------ | ------------ |
  | `sidepanel-*.js`   | 25 kB        | 40 kB        |
  | `sidepanel-*.css`  | 20 kB        | 22 kB        |

- Post-B-021 baselines: `sidepanel-*.js` ≈ 20.5 kB, `sidepanel-*.css` ≈ 17.8 kB. The CSS cap is tighter than the JS cap on purpose — CSS renders on the critical path, and post-B-006 has already absorbed the filter/search surface that was the most obvious CSS consumer.
- If a feature pushes either bundle past its soft threshold: either split the feature behind a dynamic import (JS) / scoped stylesheet (CSS), or raise the threshold **in the same reviewed commit** as the feature — never in a separate "oops" follow-up.
- Adding a third target (e.g. `popup-*.js`) is a future backlog item; do not squeeze new targets in opportunistically.

### Schema-cite rule (added in B-009)

Every backlog item whose scope touches the Memory / Knowledge / Experience SQLite tables or the shared DTO contract in `packages/shared/src/` must cite the authoritative schema before implementation starts. Concretely, the "Schema cite" line of the backlog entry must:

- Point at the exact repository file + (when possible) line range of the SQL DDL or TypeScript type that the task builds on — no paraphrase, no "see docs".
- Name each new / modified column or DTO field explicitly; a vague "adds a few fields" is not acceptable.
- Call out the idempotency story: does the migration use `CREATE … IF NOT EXISTS`, does the DTO shape stay backwards-compatible, does the client parser accept unknown keys.

Why: three of the five real bugs in Sprints 1–2 were one side of the extension / native-server / shared DTO triangle drifting from the other two. Forcing a citation turns "I remember what that shape is" into "grep confirms this shape is the same".

Applies equally to owner-lane and fast-lane tasks. Whoever drafts the backlog item (any AI assistant or a human maintainer) puts the citation in the `- **Schema cite**:` bullet (see B-005 / B-006 for examples).

## Public Source Of Truth

For this public repository, treat `docs/` (English-only) plus the root-level `README.md`, `README_zh.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `AGENTS.md` as the public source of truth. Do not recreate internal PM systems, private review docs, nightly reports, or acceptance evidence inside the public tree.

Project maintainers also keep non-public product-management, governance, audit, and gate-maintenance materials outside this repository. Those materials are not required for contributing against the public surface; external contributors and AI assistants should rely only on the files enumerated above.

Default expectations:

1. Prefer surgical changes over broad refactors.
2. Do not merge old branches blindly; review and safely absorb only the useful parts.
3. Add the smallest regression test that proves the change is correct.
4. Do not bundle unrelated files into the same commit.
5. Verify before committing; commit promptly after verification.
6. When diagnosing GitHub-visible failures, first distinguish historical commit failures from the current head state.
7. For browser-viewable GitHub troubleshooting, prefer Tabrix first, then use API/CLI only when the page view is insufficient.
8. Run the smallest required test matrix for the change type before committing.
9. When runtime behavior is part of the claim, make sure the local MCP service and unpacked extension are actually running the new build.
10. If the working tree is dirty, do not blindly pull/rebase/merge on top of it; fetch first, assess risk, and prefer a separate branch or worktree when needed.
11. When instructions conflict, follow this order: system/developer instructions, the user's current task, repository task docs, this file, then general heuristics.
12. End each task with a clear status summary: what changed, what was verified, what was not verified, and what risks remain.
13. If a CI or platform failure is caused by a retired upstream endpoint or broken external integration, do not stop at "ignore the error"; restore a real verification path before treating the issue as resolved.
14. When extension code changes, the default local acceptance loop is: `pnpm -C app/chrome-extension build` -> `pnpm run extension:reload` -> real browser validation. Do not claim browser-side verification if the unpacked extension has not been reloaded.
15. Architecture-review trigger: after every 3 consecutive `feat:` / `fix:` commits on the same MKEP layer (Memory / Knowledge / Experience / Policy), stop adding more feat/fix and run a short architecture-debt checkpoint before continuing. Deliver: (a) a listing of any site-specific / domain-specific names that leaked into a core layer, (b) a listing of any files that grew past the project's maintainability budget for that subsystem, (c) a listing of any new cross-layer import that violates the MKEP layering in the code-map table above, (d) an explicit decision to either open a `refactor:` task or to record an accepted debt item. Do not silently skip this checkpoint — if no debt is found, state that explicitly in the task summary.
16. When editing `app/chrome-extension/entrypoints/background/tools/browser/read-page-understanding-core.ts` or any other file that the repository's architectural-review policy tags "core neutral", the change MUST NOT introduce site-specific vocabulary (e.g. Chinese/English anchors belonging to a single product, hostnames, or family-specific role literals). Such logic belongs in a `*-<family>.ts` adapter. The neutrality invariant is protected by `tests/read-page-understanding-core-neutrality.test.ts`; do not weaken or skip that test to unblock a change.
17. Public / private test split. Any test or fixture that reproduces a specific real-world site's URL, DOM content, brand-named accessibility tree, or login-state flow (e.g. Douyin / BOSS / private-console vendors) belongs in the sibling `tabrix-private-tests` repository, not in this repo. In this public repo only the declared GA baseline (currently: GitHub) may appear in `app/**/tests/**` as realistic fixture data. Generic login, footer, dashboard, and accessibility-tree fixtures must use neutral wording and MUST NOT embed a specific vendor brand as flavoring. Exception: guardrail tests that list brand words as forbidden tokens (e.g. `tests/read-page-understanding-core-neutrality.test.ts`) may contain those words because their purpose is to assert absence, not reproduce a scenario.
18. Documentation placement. Public English docs go under `docs/`. Chinese-language public material belongs only in root `README_zh.md` and this file. Internal governance, audit, gate maintenance, PRD, roadmap sequencing, and acceptance evidence are maintained outside this public repository by the project maintainers. Do not reintroduce deleted internal documents into `docs/` without an explicit governance decision.
19. Removed-surface invariant. Before adding any MCP tool, background listener, popup entry, sidepanel tab, or shared type, check it against the "Removed Surfaces" list above. If the change looks like it would reintroduce a removed surface in any form — including under a different name — stop and surface the question instead of implementing it.
20. Planning invariant. Every non-trivial feature or refactor commit should reference a public issue, a public roadmap item, or a maintainer-private `B-*` item when one exists. Do not create or update public sprint-backlog files under `docs/`.

If a task conflicts with these rules, stop and surface the tradeoff instead of guessing.
