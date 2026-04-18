# Tabrix v2.0.9 Release Notes

Release date: 2026-04-18

## Context

v2.0.9 turns browser recovery from "state visible + manual advice" into a formal product loop: when a real browser automation request arrives and the bridge is not ready, Tabrix now attempts recovery and continues the original request when possible.

## Added

- Unified bridge recovery guidance:
  - one shared recovery guidance source now powers MCP tool failure payloads, `status`, `doctor`, and `report`.
  - `/status` bridge snapshots now include `guidance.summary`, `guidance.hint`, and `guidance.nextAction`.
- Recovery-special smoke path:
  - `tabrix smoke --bridge-recovery` injects a bridge failure and validates that a real browser request either auto-recovers and succeeds or returns one single next action.

## Improved

- Browser automation recovery loop:
  - browser-tool requests now pass through one recovery gate before execution.
  - bridge-degraded, bridge-broken, and command-channel-not-ready states now converge on one retry/recovery path.
  - successful recovery now continues the original request instead of stopping after diagnostics.
- Diagnostics consistency:
  - `status`, `doctor`, and `report` now describe the same recovery truth with one action-oriented recommendation.
  - recovery failures now avoid multi-step manual suggestion lists and instead return one key next action.
- T3/T4 execution quality closure:
  - T3.1/T3.2 structured `read_page` contract is now used as the stable base for execution-oriented snapshots.
  - T4 public GitHub baseline remains runnable after Douyin private-asset split.
  - workflow run detail baseline path now prefers explicit run URL navigation and dedicated tab resolution, restoring `workflow_run_detail` baseline stability.

## Fixed

- Fixed product gap where recovery stopped at advice text even though runtime state was recoverable.
- Fixed inconsistent wording across `status`, `doctor`, and `report` for the same bridge fault.
- Fixed smoke acceptance gap by adding a formal recovery-specific validation path.

## Validation

- `pnpm --dir app/chrome-extension exec vitest run tests/native-host.test.ts`
- `pnpm --dir app/native-server exec jest src/mcp/bridge-recovery.test.ts src/scripts/doctor-bridge-state.test.ts src/scripts/status.test.ts src/server/bridge-recovery-routes.test.ts --runInBand`
- `node app/native-server/dist/cli.js stdio-smoke --json`
- `node app/native-server/dist/cli.js smoke --json --protocol-only --url http://192.168.131.217:12306/mcp --auth-token <token>`
- `node app/native-server/dist/cli.js smoke --json --bridge-recovery`
- `node app/native-server/dist/cli.js doctor --json`
- `node app/native-server/dist/cli.js report --json`
- `node --test scripts/t4-github-baseline.test.mjs`
- `pnpm run t4:github-baseline -- --owner guodaxia103 --repo tabrix --out-dir .tmp/t4-github-baseline --non-strict` (4/4)
- `pnpm run t4:post-submit -- --owner guodaxia103 --repo tabrix --commit 2ad1bbf --non-strict`
