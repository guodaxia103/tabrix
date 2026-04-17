# Tabrix Public Docs

This directory keeps only public documentation for `Tabrix`.

It is intended for:

- users onboarding to the product
- developers integrating through CLI or MCP
- contributors working on the public codebase
- release, security, and compliance readers

This directory does not keep internal product-management or review materials.

Those materials are maintained separately as internal governance documents and should be rewritten before any public release.
Implementation design notes, audits, acceptance evidence, release-gate maintenance notes, and governance records belong in internal docs rather than this public tree.

## What Belongs Here

- README, install, quickstart, and troubleshooting guides
- AI contributor onboarding and public AI collaboration rules
- CLI, tools, transport, and architecture references
- project structure, release, security, and changelog documents
- public-facing compliance and contribution guidance

## High-Value Entry Points

- `AI_CONTRIBUTOR_QUICKSTART_zh.md`: first-stop onboarding for AI contributors working in the public repo
- `AI_DEV_RULES_zh.md`: public development rules for AI-assisted changes
- `PRODUCT_SURFACE_MATRIX.md` / `PRODUCT_SURFACE_MATRIX_zh.md`: public capability boundaries and tier definitions
- `TESTING.md` / `TESTING_zh.md`: contributor verification standards
- `PLATFORM_SUPPORT.md` / `PLATFORM_SUPPORT_zh.md`: current public platform support posture
- `COMPATIBILITY_MATRIX.md` / `COMPATIBILITY_MATRIX_zh.md`: current MCP client and environment compatibility posture
- `CODE_ENTRYPOINTS_AND_OWNERSHIP_zh.md`: contributor execution map for common change types
- `STABLE_QUICKSTART.md`: user-facing first-success path
- `BROWSER_TOOL_SETTLE_AUDIT_zh.md`: browser tool settle effectiveness review and optimization policy
- `RELEASE_READINESS_CHECKLIST_zh.md`: Phase 0 发布前验收清单
- `BROWSER_BRIDGE_STATE_DESIGN_zh.md`: 浏览器桥接状态机与自动恢复设计
- `OSV_AUDIT_GATE_zh.md`: 生产依赖安全门禁与 OSV 门禁说明
- `ROADMAP.md` / `ROADMAP_zh.md`: public product direction and contributor-facing future priorities
- `USE_CASES.md` / `USE_CASES_zh.md`: realistic early-stage scenarios for new users
- `ARCHITECTURE.md` / `ARCHITECTURE_zh.md`: public architecture overview
- `PROJECT_STRUCTURE.md` / `PROJECT_STRUCTURE_zh.md`: codebase map and module responsibilities

## Naming Rules

- Use stable public filenames in `UPPER_SNAKE_CASE.md` form when possible
- Chinese public variants should use the `_zh.md` suffix
- Avoid temporary status words such as `draft`, `latest`, or `temp`
- Do not publish internal review or planning docs under date-stamped filenames unless the document is intentionally public-facing
- `README.md`, `README_zh.md`, `CHANGELOG.md`, and versioned release notes are maintained as explicit legacy exceptions

## Public Source Of Truth

For public docs, this repository is the source of truth.
