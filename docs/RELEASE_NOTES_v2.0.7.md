# Tabrix v2.0.7 Release Notes

Release date: 2026-04-12

## Context

v2.0.7 focuses on release pipeline stability and package version consistency.

## Added

- Workspace lockstep guardrails in release readiness checks:
  - Enforces aligned versions across `tabrix-monorepo`, `@tabrix/tabrix`, `@tabrix/extension`, `@tabrix/shared`, and `@tabrix/wasm-simd`.
  - Verifies native-server dependency pinning for `@tabrix/shared` matches expected release range.

## Improved

- GitHub Actions runtime compatibility:
  - Upgraded workflow actions to Node 24-compatible stable majors (`actions/checkout@v5`, `actions/setup-node@v5`, `pnpm/action-setup@v5`).
- npm release resilience:
  - Hardened shared-package visibility checks with token-aware lookup and longer retry window.
  - Avoids false-negative publish failures when registry visibility propagation is delayed.

## Changed

- Lockstep package versions moved to `2.0.7`:
  - `tabrix-monorepo`
  - `@tabrix/tabrix`
  - `@tabrix/extension`
  - `@tabrix/shared`
  - `@tabrix/wasm-simd`
- `@tabrix/tabrix` dependency updated to `@tabrix/shared@^2.0.7`.

## Validation

- `RELEASE_TAG=v2.0.7 pnpm run release:check`
