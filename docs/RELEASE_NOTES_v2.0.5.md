# Tabrix v2.0.5 Release Notes

Release date: 2026-04-10

## Context

v2.0.5 is a governance and reliability release focused on professional release discipline, dependency hardening, and long-term maintainability.

## Added

- Release governance checks:
  - Added `scripts/check-release-readiness.mjs` to validate version consistency, tag format, and release-notes presence.
  - Added root scripts `release:check` and `release:check:ci`.
- Release process documentation:
  - Added `docs/RELEASE_PROCESS.md` and `docs/RELEASE_PROCESS_zh.md`.
- Repository-wide spellcheck baseline:
  - Added root `cspell.json`.
  - Added extension-level `app/chrome-extension/cspell.json` with root import.

## Improved

- CI and release workflow hardening:
  - CI now runs release metadata sanity checks.
  - Release workflow now uses release-readiness script as a gate.
  - Build filters standardized to explicit package names (`@tabrix/tabrix`).
- Documentation consistency:
  - Unified command examples from `pnpm --filter tabrix` to `pnpm --filter @tabrix/tabrix`.
  - Added release-process links in both README and README_zh.
- Workspace metadata quality:
  - Root workspace now includes `packageManager`, `engines`, `repository`, `bugs`, and `homepage`.

## Changed

- Dependency batch upgrades (validated):
  - `markstream-vue`: `0.0.3-beta.5 -> 0.0.12`
  - `dotenv`: `^16.5.0 -> ^17.4.1`
  - `commander`: `^13.1.0 -> ^14.0.3`
  - `pino`: `^9.6.0 -> ^10.3.1`
  - `chrome-devtools-frontend` and `@typescript-eslint/parser` aligned in previous batch.
- Root workspace version aligned with release line (`2.0.5`).

## Fixed

- Reduced release risk caused by hidden version drift between root/native/extension packages.
- Reduced contributor/editor friction caused by `Unknown word` false positives for project terms.
- Removed lingering old-brand wording in `packages/wasm-simd` description.

## Validation

- `pnpm run release:check`
- `pnpm run release:check:ci`
- `pnpm run i18n:check`
- `pnpm run typecheck`
- `pnpm run test:core`
