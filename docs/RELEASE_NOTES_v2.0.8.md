# Tabrix v2.0.8 Release Notes

Release date: 2026-04-15

## Context

v2.0.8 focuses on browser bridge execution reliability, Windows startup experience, browser-readiness diagnostics, and release hardening before the next public rollout.

## Added

- Browser bridge execution channel hardening:
  - daemon status now reports richer bridge state snapshots, including command-channel readiness.
  - Claude acceptance assets and current acceptance matrix were formalized for release tracking.
- Browser readiness persistence:
  - setup, register, and doctor flows now resolve and persist the preferred browser executable path for future launches.

## Improved

- Browser automation recovery flow:
  - stronger recovery diagnostics for browser-not-running, bridge-degraded, and command-channel readiness states.
  - safer browser-tool guidance after navigation and tab switching to reduce premature execution on unsettled pages.
- Windows launch behavior:
  - browser auto-start now prefers direct executable launch instead of `cmd /c start`, reducing visible black-console flashes.
- Browser tool UX:
  - non-web tabs (`chrome://`, `chrome-extension://`, similar internal pages) now return structured guidance instead of noisy injection failures.

## Fixed

- Stabilized Claude real-session dialog handling:
  - prompt dialog handling now succeeds without leaving blocking desktop popups behind.
  - acceptance cleanup remains responsible for removing temporary tabs and local smoke listeners.
- Fixed CI/platform mismatch in browser-config tests:
  - browser platform detection now uses one consistent platform source, preventing Windows-path tests from failing on GitHub Actions runners.
- Fixed startup/runtime noise:
  - duplicate context-menu runtime errors are consumed instead of polluting extension error pages.
  - CSP-blocked `data:` image fetches were replaced by direct local decoding.

## Validation

- `pnpm run typecheck`
- `pnpm run test:core`
- `RELEASE_TAG=v2.0.8 pnpm run release:check`
- `powershell -ExecutionPolicy Bypass -File scripts\\run-claude-acceptance.ps1 -Profile full`
