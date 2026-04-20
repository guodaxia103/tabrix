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
3. [docs/AI_CONTRIBUTOR_QUICKSTART_zh.md](./docs/AI_CONTRIBUTOR_QUICKSTART_zh.md)
4. [docs/AI_DEV_RULES_zh.md](./docs/AI_DEV_RULES_zh.md)
5. [docs/PRODUCT_SURFACE_MATRIX.md](./docs/PRODUCT_SURFACE_MATRIX.md) or [docs/PRODUCT_SURFACE_MATRIX_zh.md](./docs/PRODUCT_SURFACE_MATRIX_zh.md)
6. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) or [docs/ARCHITECTURE_zh.md](./docs/ARCHITECTURE_zh.md)
7. [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md) or [docs/PROJECT_STRUCTURE_zh.md](./docs/PROJECT_STRUCTURE_zh.md)
8. [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) or [docs/CONTRIBUTING_zh.md](./docs/CONTRIBUTING_zh.md)

Then continue with the smallest relevant task-specific reading set below.

## Task-Specific Reading

### Product positioning, public docs, and boundary-governance tasks

Read:

- [docs/README.md](./docs/README.md)
- [docs/AI_CONTRIBUTOR_QUICKSTART_zh.md](./docs/AI_CONTRIBUTOR_QUICKSTART_zh.md)
- [docs/AI_DEV_RULES_zh.md](./docs/AI_DEV_RULES_zh.md)
- [docs/PRODUCT_SURFACE_MATRIX_zh.md](./docs/PRODUCT_SURFACE_MATRIX_zh.md)
- [docs/TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md](./docs/TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md)
- [docs/TABRIX_TOOL_LAYERING_AND_RISK_CLASSIFICATION_zh.md](./docs/TABRIX_TOOL_LAYERING_AND_RISK_CLASSIFICATION_zh.md)
- [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) or [docs/CONTRIBUTING_zh.md](./docs/CONTRIBUTING_zh.md)

### Transport, CLI, MCP, native-server, and diagnostics tasks

Read:

- [docs/TRANSPORT.md](./docs/TRANSPORT.md)
- [docs/CLI.md](./docs/CLI.md) or [docs/CLI_zh.md](./docs/CLI_zh.md)
- [docs/TOOLS.md](./docs/TOOLS.md) or [docs/TOOLS_zh.md](./docs/TOOLS_zh.md)
- [docs/CLIENT_CONFIG_QUICKREF.md](./docs/CLIENT_CONFIG_QUICKREF.md)

### Extension, popup, onboarding, and troubleshooting tasks

Read:

- [docs/STABLE_QUICKSTART.md](./docs/STABLE_QUICKSTART.md)
- [docs/FIRST_SUCCESS_GUIDE.md](./docs/FIRST_SUCCESS_GUIDE.md)
- [docs/POPUP_TROUBLESHOOTING.md](./docs/POPUP_TROUBLESHOOTING.md)
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) or [docs/TROUBLESHOOTING_zh.md](./docs/TROUBLESHOOTING_zh.md)
- [docs/WINDOWS_FAQ.md](./docs/WINDOWS_FAQ.md) and [docs/WINDOWS_INSTALL_zh.md](./docs/WINDOWS_INSTALL_zh.md) when Windows setup is involved

### Release, security, and third-party reuse tasks

Read:

- [docs/RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md) or [docs/RELEASE_PROCESS_zh.md](./docs/RELEASE_PROCESS_zh.md)
- [docs/RELEASE_READINESS_CHECKLIST_zh.md](./docs/RELEASE_READINESS_CHECKLIST_zh.md)
- [docs/RELEASE_READINESS_CRITERIA_v2.md](./docs/RELEASE_READINESS_CRITERIA_v2.md) or [docs/RELEASE_READINESS_CRITERIA_v2_zh.md](./docs/RELEASE_READINESS_CRITERIA_v2_zh.md)
- [docs/TESTING.md](./docs/TESTING.md) or [docs/TESTING_zh.md](./docs/TESTING_zh.md)
- [docs/PLATFORM_SUPPORT.md](./docs/PLATFORM_SUPPORT.md) or [docs/PLATFORM_SUPPORT_zh.md](./docs/PLATFORM_SUPPORT_zh.md)
- [docs/SECURITY.md](./docs/SECURITY.md)
- [docs/THIRD_PARTY_REUSE_MATRIX.md](./docs/THIRD_PARTY_REUSE_MATRIX.md) or [docs/THIRD_PARTY_REUSE_MATRIX_zh.md](./docs/THIRD_PARTY_REUSE_MATRIX_zh.md)
- [docs/THIRD_PARTY_REUSE_WORKFLOW.md](./docs/THIRD_PARTY_REUSE_WORKFLOW.md) or [docs/THIRD_PARTY_REUSE_WORKFLOW_zh.md](./docs/THIRD_PARTY_REUSE_WORKFLOW_zh.md)

## Public Source Of Truth

For this public repository, the default onboarding and collaboration rules are:

- `docs/AI_CONTRIBUTOR_QUICKSTART_zh.md`
- `docs/AI_DEV_RULES_zh.md`

For this public repository, treat `docs/` as the public source of truth. Do not recreate internal PM systems, private review docs, nightly reports, or acceptance evidence inside the public tree.

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
15. Architecture-review trigger: after every 3 consecutive `feat:` / `fix:` commits on the same subsystem, stop adding more feat/fix and run a short architecture-debt checkpoint before continuing. Deliver: (a) a listing of any site-specific / domain-specific names that leaked into a core layer, (b) a listing of any files that grew past the size budget defined in `docs/RELEASE_READINESS_CRITERIA_v2.md`, (c) an explicit decision to either open a `refactor:` task or to record an accepted debt item. Do not silently skip this checkpoint — if no debt is found, state that explicitly in the task summary.
16. When editing any file under `app/chrome-extension/entrypoints/background/tools/browser/read-page-understanding-core.ts` or other files tagged "core neutral" by `docs/RELEASE_READINESS_CRITERIA_v2.md` Gate A, the change MUST NOT introduce site-specific vocabulary (e.g. Chinese/English anchors belonging to a single product, hostnames, or family-specific role literals). Such logic belongs in a `*-<family>.ts` adapter. The neutrality invariant is protected by `tests/read-page-understanding-core-neutrality.test.ts`; do not weaken or skip that test to unblock a change.
17. Public / private test split. Any test or fixture that reproduces a specific real-world site's URL, DOM content, brand-named accessibility tree, or login-state flow (e.g. Douyin / BOSS / private-console vendors) belongs in the sibling `tabrix-private-tests` repository, not in this repo. In this public repo only the declared GA baseline (currently: GitHub) may appear in `app/**/tests/**` as realistic fixture data. Generic login, footer, dashboard, and accessibility-tree fixtures must use neutral wording and MUST NOT embed a specific vendor brand as flavoring. Exception: guardrail tests that list brand words as forbidden tokens (e.g. `tests/read-page-understanding-core-neutrality.test.ts`) may contain those words because their purpose is to assert absence, not reproduce a scenario.

If a task conflicts with these rules, stop and surface the tradeoff instead of guessing.
