# Nightly Report (2026-04-11)

## Scope

- Follow the 5-hour plan for stability, CI/release quality, connection reliability, and docs.
- No UI visual redesign.
- No `v2.0.6` release.

## P0 / P1 Triage (User-impacting only)

- P0: none found in this round.
- P1 (fixed): `tabrix status` could print `sse: undefined` when `/status` omitted `transports.sse`.
- P1 (fixed): release workflow extension asset selection relied on `ls | head -n 1`, which could be ambiguous when stale zip files existed.
- P1 (fixed): npm publish failures were hard to diagnose from CI output; no automatic npm debug-log tail.
- P1 (fixed): remote toggle path could fail immediately when native port was temporarily disconnected, without an internal reconnect attempt.
- P0 (fixed): published `@tabrix/tabrix` package contained `workspace:` protocol dependency (`@tabrix/shared`), which breaks npm install.

## Completed Changes

### 1) CLI status output hardening

- File: `app/native-server/src/scripts/status.ts`
- Added transport field normalization for optional status fields:
  - `sse` defaults to `0`
  - `streamableHttp` defaults to `0`
  - `sessionIds` defaults to `[]`
- Result: pretty output no longer leaks `undefined`.

### 2) Regression test for status script

- File: `app/native-server/src/scripts/status.test.ts`
- Added tests for:
  - missing `sse` in payload
  - session ID rendering

### 3) Release workflow hardening

- File: `.github/workflows/publish-npm.yml`
- Added cleanup step for previous extension zip artifacts before build.
- Changed asset collection to strict mode:
  - must find exactly one `*-chrome.zip` artifact
  - fail early with explicit error when count is not `1`
- Added npm preflight diagnostics (`npm config get registry`, `npm ping` warning).
- Added failure diagnostics step to print/tail npm debug logs when publish fails.
- Added shared package flow before main package publish:
  - check/publish/verify `@tabrix/shared` first when missing
  - gate main `@tabrix/tabrix` publish on shared package readiness

### 4) Connection/remote reliability hardening

- File: `app/chrome-extension/entrypoints/background/native-host.ts`
- `set_remote_access` now:
  - tries `ensureNativeConnected('ui_set_remote_access')` when not connected
  - handles `postMessage` errors and persists last native error
- File: `app/chrome-extension/entrypoints/popup/App.vue`
- Added `waitForRemoteAccessState(...)` to wait for server status convergence after remote toggle.
- Remote toggle flow now waits for the expected remote state before continuing token checks.

### 5) Docs quick-path improvements

- File: `README.md`
  - Added explicit quick-start action: click `Connect` once after loading extension.
- File: `README_zh.md`
  - Added same quick-start connect action in Chinese.
- File: `docs/STABLE_QUICKSTART.md`
  - Replaced mixed-language label `Token 管理` with `Token Management` in English doc.

### 6) Workspace dependency packaging fix

- File: `app/native-server/package.json`
  - changed `@tabrix/shared` dependency from `workspace:^1.0.2` to `^1.0.2` for npm-compatible publish metadata.
- File: `.npmrc`
  - enabled workspace linking for local development:
    - `link-workspace-packages=true`
    - `prefer-workspace-packages=true`
- File: `scripts/check-release-readiness.mjs`
  - added release gate to block any `workspace:` dependencies in publishable native package metadata.
  - exported shared package name/version to workflow outputs.

## Validation Run

- `pnpm -C app/native-server test -- status.test.ts` ✅
- `pnpm -C app/native-server test` ✅
- Remaining full-matrix validation to run after this patch set:
  - none

- Additional completed validation:
  - `pnpm -C app/chrome-extension typecheck` ✅
  - `pnpm -C app/chrome-extension test` ✅
  - `pnpm -C app/native-server test` ✅
  - `pnpm run i18n:check` ✅
  - manual paired smoke (install packed `@tabrix/shared` + `@tabrix/tabrix` tarballs):
    - npm path ✅
    - pnpm path ✅

## Risks / Notes

- GitHub Actions still shows Node 20 deprecation warnings from action runtimes; currently non-blocking because workflows force Node 24 action runtime compatibility env.
- `app/native-server` jest may throw a transient `@hono/node-server` timer close error when run concurrently with heavy parallel local tasks; serial run remains green. CI currently runs core tests in serial order.
- Manual remote smoke is still recommended after these connection-path changes (extension + native host).

## Tomorrow First Tasks

1. Run the full quality gate matrix once more on latest `main`.
2. Perform manual popup smoke for remote toggle and token path on Windows + Chrome.
3. If all green, prepare `v2.0.6` candidate checklist (still no release until UI optimization round is merged).
