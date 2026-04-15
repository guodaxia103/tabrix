# Tabrix AI Development Rules

This repository uses a strict "small, verifiable, low-regression" workflow for AI-assisted development.

Before changing code, every AI assistant working in this repository must read:

- [docs/AI_DEV_RULES_zh.md](./docs/AI_DEV_RULES_zh.md)

Default expectations:

1. Prefer surgical changes over broad refactors.
2. Do not merge old branches blindly; review and safely absorb only the useful parts.
3. Add the smallest regression test that proves the change is correct.
4. Do not bundle unrelated files into the same commit.
5. Verify before committing; commit promptly after verification.

If a task conflicts with these rules, stop and surface the tradeoff instead of guessing.
