# Tabrix AI Development Rules

This repository uses a strict "small, verifiable, low-regression" workflow for AI-assisted development.

All code changes in this repository must follow the `karpathy-guidelines` skill:

- think before coding
- keep the change as small as possible
- define a verifiable success condition
- prefer a real fix over a temporary suppression

## Mandatory Read Path

Before changing code or docs, every AI assistant should read the public repository docs below first:

1. [README.md](./README.md)
2. [docs/README.md](./docs/README.md)
3. [docs/PRODUCT_SURFACE_MATRIX.md](./docs/PRODUCT_SURFACE_MATRIX.md)
4. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
5. [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md)
6. [CONTRIBUTING.md](./CONTRIBUTING.md)

Then continue with the smallest relevant task-specific reading set below.

For product-level Single Source of Truth — PRD, positioning, tool layering, AI dev rules, code entrypoints, audit notes, T4 gates, release-readiness criteria, maintenance log, and third-party reuse analysis — consult the Feishu `Tabrix` wiki space (not this repository). See the "Non-Public Source of Truth" section below.

## Task-Specific Reading

### Product positioning, public docs, and boundary-governance tasks

Read:

- [docs/README.md](./docs/README.md)
- [docs/PRODUCT_SURFACE_MATRIX.md](./docs/PRODUCT_SURFACE_MATRIX.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- Feishu wiki → `Tabrix / 01_产品与路线 / Tabrix PRD v1`
- Feishu wiki → `Tabrix / 01_产品与路线 / Tabrix 产品定位与技术原理`
- Feishu wiki → `Tabrix / 02_研发与架构 / Tabrix 工具分层与风险分级`

### Transport, CLI, MCP, native-server, and diagnostics tasks

Read:

- [docs/CLI_AND_MCP.md](./docs/CLI_AND_MCP.md)
- [docs/TOOLS.md](./docs/TOOLS.md)

### Extension, popup, onboarding, and troubleshooting tasks

Read:

- [docs/QUICKSTART.md](./docs/QUICKSTART.md)
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
- Feishu wiki → `Tabrix / 04_运行与排障 / Tabrix-First GitHub 排障 Runbook`
- Feishu wiki → `Tabrix / 04_运行与排障 / Tabrix Browser Tool Settle Audit`
- Feishu wiki → `Tabrix / 02_研发与架构 / Tabrix 浏览器桥接状态机与自动恢复实施设计`

### Release, security, and third-party reuse tasks

Read:

- [docs/RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md)
- [docs/TESTING.md](./docs/TESTING.md)
- [docs/PLATFORM_SUPPORT.md](./docs/PLATFORM_SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- Feishu wiki → `Tabrix / 03_发布与验收 / Tabrix 发布前检查清单（Phase 0）`
- Feishu wiki → `Tabrix / 03_发布与验收 / Tabrix v2 发布门禁标准`
- Feishu wiki → `Tabrix / 03_发布与验收 / Tabrix T4 GitHub Baseline 验收门禁`
- Feishu wiki → `Tabrix / 03_发布与验收 / Tabrix T4 Douyin Login Golden 门禁`
- Feishu wiki → `Tabrix / 03_发布与验收 / Tabrix 生产依赖安全审计门禁（OSV 方案）`
- Feishu wiki → `Tabrix / 02_研发与架构 / Tabrix 三方复用矩阵`
- Feishu wiki → `Tabrix / 02_研发与架构 / Tabrix 三方复用工作流`

## Non-Public Source of Truth

Internal product-management, governance, audit, and gate-maintenance materials live in the Feishu `Tabrix` wiki space, organized as:

- `00_治理规范` — document naming/version rules, public/private boundary, AI contributor onboarding, AI dev rules, Skills catalog, task numbering / SoT specification
- `01_产品与路线` — PRD v1, product positioning and technical principles, task system, roadmap, decision log, T-task regulations
- `02_研发与架构` — code entrypoints, bridge state design, tool layering and risk classification, third-party reuse, dependency upgrade plans
- `03_发布与验收` — release checklists, T4 gates, acceptance matrices, OSV audit gate, release-readiness criteria, maintenance log, nightly reports
- `04_运行与排障` — GitHub-first troubleshooting runbook, Browser tool settle audit, Popup status / recovery UX spec

For any task that touches policy, governance, delivery gating, or internal acceptance, treat the Feishu wiki as authoritative. Do not recreate those materials inside the public tree.

## Public Source Of Truth

For this public repository, treat `docs/` (English-only) plus the root-level `README.md`, `README_zh.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `AGENTS.md` as the public source of truth. Do not recreate internal PM systems, private review docs, nightly reports, or acceptance evidence inside the public tree.

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
15. Architecture-review trigger: after every 3 consecutive `feat:` / `fix:` commits on the same subsystem, stop adding more feat/fix and run a short architecture-debt checkpoint before continuing. Deliver: (a) a listing of any site-specific / domain-specific names that leaked into a core layer, (b) a listing of any files that grew past the internal size budget defined in the Feishu `Tabrix v2 发布门禁标准` document, (c) an explicit decision to either open a `refactor:` task or to record an accepted debt item. Do not silently skip this checkpoint — if no debt is found, state that explicitly in the task summary.
16. When editing any file under `app/chrome-extension/entrypoints/background/tools/browser/read-page-understanding-core.ts` or other files tagged "core neutral" by the Feishu `Tabrix v2 发布门禁标准` Gate A, the change MUST NOT introduce site-specific vocabulary (e.g. Chinese/English anchors belonging to a single product, hostnames, or family-specific role literals). Such logic belongs in a `*-<family>.ts` adapter. The neutrality invariant is protected by `tests/read-page-understanding-core-neutrality.test.ts`; do not weaken or skip that test to unblock a change.
17. Public / private test split. Any test or fixture that reproduces a specific real-world site's URL, DOM content, brand-named accessibility tree, or login-state flow (e.g. Douyin / BOSS / private-console vendors) belongs in the sibling `tabrix-private-tests` repository, not in this repo. In this public repo only the declared GA baseline (currently: GitHub) may appear in `app/**/tests/**` as realistic fixture data. Generic login, footer, dashboard, and accessibility-tree fixtures must use neutral wording and MUST NOT embed a specific vendor brand as flavoring. Exception: guardrail tests that list brand words as forbidden tokens (e.g. `tests/read-page-understanding-core-neutrality.test.ts`) may contain those words because their purpose is to assert absence, not reproduce a scenario.
18. Documentation placement. Public English docs go under `docs/`. Chinese-language public material belongs only in root `README_zh.md` and this file. Internal governance, audit, gate maintenance, PRD, roadmap sequencing, and acceptance evidence belong in the Feishu `Tabrix` wiki. Do not reintroduce deleted internal documents into `docs/` without an explicit governance decision.

If a task conflicts with these rules, stop and surface the tradeoff instead of guessing.
