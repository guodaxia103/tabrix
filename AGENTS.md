# Tabrix AI Development Rules

This repository uses a strict "small, verifiable, low-regression" workflow for AI-assisted development.

All code changes in this repository must follow the `karpathy-guidelines` skill:

- think before coding
- keep the change as small as possible
- define a verifiable success condition
- prefer a real fix over a temporary suppression

Before changing code, every AI assistant working in this repository must read:

- [docs/AI_ONBOARDING_QUICKSTART_zh.md](./docs/AI_ONBOARDING_QUICKSTART_zh.md)
- [docs/AI_DEV_RULES_zh.md](./docs/AI_DEV_RULES_zh.md)

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

If a task conflicts with these rules, stop and surface the tradeoff instead of guessing.
