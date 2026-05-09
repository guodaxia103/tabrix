# Tabrix Public Docs

This directory keeps the English-only public documentation for `Tabrix`.

It is intended for:

- Users onboarding to the product
- Developers integrating through CLI or MCP
- Contributors working on the public codebase
- Release, security, and compliance readers

This repository keeps public product and integration docs for users and
contributors. Maintainer-only planning, benchmark evidence, release-gate
evidence, PRDs, detailed version plans, prompts, and handoffs stay outside the
public repository.

## Entry Points

### Product-level Source of Truth (start here)

- [`ROADMAP.md`](./ROADMAP.md) — public product direction and contribution areas.
- [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) — public product surface and capability tiers.

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

## Maintainer-Only Materials (Outside Repo)

The following categories are maintained outside this repository by the project maintainers:

- private product-positioning and commercial sequencing materials that are not part of the open-source working contract
- private governance and audit materials that contain maintainer-only process or approval state
- private acceptance evidence and gate-maintenance artifacts
- private runbooks for non-public scenarios

By contrast, `ROADMAP.md`, `PRODUCT_SURFACE_MATRIX.md`, and `AGENTS.md` are
kept in-repo because contributors need them to understand the public product
direction and execution rules.

## Language Policy

- English is the single public language for `docs/`.
- [`../README_zh.md`](../README_zh.md) is the public Chinese landing page.
- [`../AGENTS.md`](../AGENTS.md) may contain bilingual AI-contributor rules.
- Legacy public prompt or skill examples outside `docs/` may still contain localized prose, but they are not public documentation source of truth.
- Chinese variants of private governance, planning, acceptance, and release evidence materials are maintained outside this repository.

## Naming Rules

- Public filenames use `UPPER_SNAKE_CASE.md`
- No temporary status words such as `draft`, `latest`, `temp`, or `v2_zh`
- Versioned release notes may live here, but raw benchmark reports and private
  acceptance artifacts do not belong in this directory
- `README.md`, `CHANGELOG.md` (root), and the public entry documents above are the only stable exceptions

## Public Source of Truth

For public-facing documentation, this directory is the source of truth.
Sensitive maintainer-only governance, release evidence, and private acceptance
materials stay outside the repository.
