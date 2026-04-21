# Tabrix Public Docs

This directory keeps the English-only public documentation for `Tabrix`.

It is intended for:

- Users onboarding to the product
- Developers integrating through CLI or MCP
- Contributors working on the public codebase
- Release, security, and compliance readers

Internal product-management, governance, audit, and gate-maintenance materials are **not** kept here. They are maintained separately by the project maintainers outside this repository and are not required for contributing against the public surface.

## Entry Points

### Product-level Source of Truth (start here)

- [`PRD.md`](./PRD.md) — canonical Product Requirements Document (English). Product identity, KPIs, MKEP architecture, capability tiers, MCP tool surface, anti-patterns, task numbering, change governance.
- [`PRD_zh.md`](./PRD_zh.md) — Chinese mirror of `PRD.md`. Must stay semantically equivalent.
- [`TASK_ROADMAP.md`](./TASK_ROADMAP.md) — canonical Stage-level execution plan from `Stage 3a` through `Stage 5e`, with Definition of Done and `B-*` mappings for each Stage.
- [`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md) — Chinese mirror of `TASK_ROADMAP.md`.
- [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) — sprint-level backlog (`B-*` items). Each Stage in `TASK_ROADMAP.md` breaks down into one or more `B-*` here.
- [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md) — historical snapshot (v0.3, 2026-04-20). Superseded by `PRD.md` + `TASK_ROADMAP.md`; kept for provenance only.

### Getting Started

- [`QUICKSTART.md`](./QUICKSTART.md) — first-success path, extension install, local verification, MCP client connection, first task
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — popup status, connection errors, Windows FAQ, browser-first GitHub triage, log locations

### CLI and MCP

- [`CLI_AND_MCP.md`](./CLI_AND_MCP.md) — executables, recommended commands, transports, per-client configuration, remote access, `/status` semantics, environment variables, verification
- [`TOOLS.md`](./TOOLS.md) — registered MCP tool catalog and contracts

### Architecture and Capabilities

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — high-level component overview
- [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) — codebase map and module responsibilities
- [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) — capability boundaries and tier definitions
- [`COMPATIBILITY_MATRIX.md`](./COMPATIBILITY_MATRIX.md) — MCP client and environment compatibility
- [`PLATFORM_SUPPORT.md`](./PLATFORM_SUPPORT.md) — OS and browser support posture
- [`WHY_MCP_CHROME.md`](./WHY_MCP_CHROME.md) — rationale behind the Chrome-native architecture
- [`VISUAL_EDITOR.md`](./VISUAL_EDITOR.md) — visual editor surface
- [`ERROR_CODES.md`](./ERROR_CODES.md) — error code reference

### Release and Process

- [`ROADMAP.md`](./ROADMAP.md) — public product direction
- [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) — public release workflow
- [`TESTING.md`](./TESTING.md) — contributor verification standards
- [`USE_CASES.md`](./USE_CASES.md) — realistic early-stage scenarios

### Repository Root

- [`../README.md`](../README.md) and [`../README_zh.md`](../README_zh.md) — public landing pages
- [`../AGENTS.md`](../AGENTS.md) — mandatory reading for AI contributors (public contributor rules)
- [`../SECURITY.md`](../SECURITY.md) — security disclosure policy
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — contributor workflow
- [`../CHANGELOG.md`](../CHANGELOG.md) — versioned user-visible changes

## Internal Documents (Not Here)

The following categories are maintained outside this public repository by the project maintainers:

- Internal product-management artifacts (PRD, positioning, roadmap sequencing)
- Internal governance (tool layering, AI contributor rules, Skills catalog, ownership map)
- Internal acceptance and gate materials (release readiness, audit gate, GA baseline gates)
- Internal runbooks for non-public scenarios

None of these materials are required for contributing against the public surface. If you need access to internal materials, contact the project owner directly.

## Language Policy

- English is the single public language for `docs/`, with the following **explicit, limited** bilingual exceptions:
  - [`PRD.md`](./PRD.md) (English canonical) + [`PRD_zh.md`](./PRD_zh.md) (Chinese mirror)
  - [`TASK_ROADMAP.md`](./TASK_ROADMAP.md) (English canonical) + [`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md) (Chinese mirror)
  - Both pairs must stay semantically equivalent; any PR that edits one of a pair must edit the other in the same commit.
- The only Chinese documents outside `docs/` are [`../README_zh.md`](../README_zh.md) (public landing page in Chinese) and [`../AGENTS.md`](../AGENTS.md) (internal contributor rules, bilingual prose)
- Chinese variants of other internal materials are maintained outside this repository

## Naming Rules

- Public filenames use `UPPER_SNAKE_CASE.md`
- No temporary status words such as `draft`, `latest`, `temp`, or `v2_zh`
- Versioned release notes and dated governance documents do not belong in this directory
- `README.md`, `CHANGELOG.md` (root), and the public entry documents above are the only stable exceptions

## Public Source of Truth

For public-facing documentation, this directory is the source of truth. Anything else (internal governance, audit, roadmap sequencing, acceptance evidence, gate maintenance) is managed by the project maintainers outside this repository and is not part of the public contract.
