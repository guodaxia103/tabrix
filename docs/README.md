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
- CLI, tools, transport, and architecture references
- project structure, release, security, and changelog documents
- public-facing compliance and contribution guidance

## Naming Rules

- Use stable public filenames in `UPPER_SNAKE_CASE.md` form when possible
- Chinese public variants should use the `_zh.md` suffix
- Avoid temporary status words such as `draft`, `latest`, or `temp`
- Do not publish internal review or planning docs under date-stamped filenames unless the document is intentionally public-facing
- `README.md`, `README_zh.md`, `CHANGELOG.md`, and versioned release notes are maintained as explicit legacy exceptions

## Public Source Of Truth

For public docs, this repository is the source of truth.
