# Tabrix Public Docs

This directory keeps the English-only public documentation for `Tabrix`.

It is intended for:

- Users onboarding to the product
- Developers integrating through CLI or MCP
- Contributors working on the public codebase
- Release, security, and compliance readers

Internal product-management, governance, audit, and gate-maintenance materials are **not** kept here. They live in the private Feishu knowledge base (`Tabrix` wiki space).

## Entry Points

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
- [`../AGENTS.md`](../AGENTS.md) — mandatory reading for AI contributors (governance summary with Feishu pointers)
- [`../SECURITY.md`](../SECURITY.md) — security disclosure policy
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — contributor workflow
- [`../CHANGELOG.md`](../CHANGELOG.md) — versioned user-visible changes

## Internal Documents (Not Here)

The following categories are maintained in the Feishu `Tabrix` wiki, not in this repository:

- Product Requirement Document (PRD v1)
- Product positioning and technical principles
- Tool layering and risk classification
- AI development rules (internal governance)
- Code entrypoints and ownership map
- Skills catalog (internal AI skill inventory)
- Maintenance log
- Browser bridge state design
- Browser tool settle audit
- OSV audit gate
- Release readiness checklist and criteria (internal gate)
- T4 GitHub baseline gate
- T4 Douyin login golden gate
- Third-party reuse matrix and workflow
- GitHub-first troubleshooting runbook
- AI contributor onboarding (detailed internal version)

If you need access to these, consult the Feishu `Tabrix` wiki space or contact the project owner.

## Language Policy

- English is the single public language for `docs/`
- The only Chinese documents in the repository are [`../README_zh.md`](../README_zh.md) (public landing page in Chinese) and [`../AGENTS.md`](../AGENTS.md) (internal contributor rules, bilingual prose)
- Chinese variants of internal materials live in the Feishu wiki

## Naming Rules

- Public filenames use `UPPER_SNAKE_CASE.md`
- No temporary status words such as `draft`, `latest`, `temp`, or `v2_zh`
- Versioned release notes and dated governance documents do not belong in this directory
- `README.md`, `CHANGELOG.md` (root), and the public entry documents above are the only stable exceptions

## Public Source of Truth

For public-facing documentation, this directory is the source of truth. For anything else (governance, audit, roadmap sequencing, acceptance evidence, gate maintenance), the Feishu `Tabrix` wiki is authoritative.
