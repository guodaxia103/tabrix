# Tabrix v2.0.6 Release Notes

Release date: 2026-04-12

## Context

v2.0.6 focuses on popup UI stability and release quality hardening.

## Added

- CI-friendly native-server test entry:
  - `app/native-server` adds `test:ci` (`jest --runInBand`) to reduce intermittent teardown issues in CI.

## Improved

- Popup action-button visual hierarchy:
  - Refined disconnect button depth, border contrast, and hover feedback in both light and dark themes.
- Release readiness process:
  - Added explicit v2.0.6 release-notes file required by `release:check`.

## Fixed

- Fixed extension popup height chain regression:
  - Replaced unstable viewport-dependent chain with a stable `html/body/#app` height strategy.
  - Prevented rare collapsed popup rendering (top strip only).
- Reduced test flakiness risk in core pipeline by using serial native-server tests.

## Validation

- `pnpm -C app/chrome-extension build`
- `pnpm -C app/chrome-extension zip`
- `pnpm run test:core`
- `pnpm typecheck`
- `pnpm run release:check` (with `RELEASE_TAG=v2.0.6`)
