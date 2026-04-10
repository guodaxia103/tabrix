# Tabrix v2.0.0 Release Notes

Release date: 2026-04-10

## Context

Tabrix is a community-maintained continuation of the original open-source project [`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome).

As upstream update cadence slowed for an extended period, Tabrix is launched to provide continuous maintenance, faster fixes, and a clearer roadmap for production usage.

Thanks to all original maintainers and contributors for the initial open-source foundation.

## Compared with upstream `hangwin/mcp-chrome`

Baseline used for this release note:

- Upstream repository branch: `master` (snapshot synced into this fork before Tabrix 2.0 release train)
- Upstream npm package line: `mcp-chrome-bridge` (latest known stable line before Tabrix branding migration)

### Added

- Daemon operating mode improvements:
  - `tabrix daemon start|status|stop`
  - Windows autostart support
- Remote access control flow:
  - Popup toggle for remote access
  - Persisted host preferences
  - Token-based auth management for remote connections
- Operational diagnostics reinforcement:
  - `status` / `doctor` / `smoke` pathways emphasized and hardened
  - `stdio-smoke` validation path for stdio transport checks

### Improved

- Connection-state stability in popup and sidepanel:
  - Reduced stale/ghost status transitions
  - Better reconnect visibility and guidance
- Tool reliability around `tabId/windowId` handling across multiple browser tools.
- Cross-platform build and script consistency (Windows/macOS/Linux behavior alignment).

### Fixed

- Multiple native-host reconnect and manual-disconnect edge-case regressions.
- SSE reconnect behavior and noisy connection error surfaces in UI.
- Release/packaging reliability issues:
  - workspace dependency publish risk removed
  - compatibility fallback added for enum version mismatch cases

## Added

- Latest-install standardization:
  - `npm install -g tabrix@latest`
  - `pnpm install -g tabrix@latest`
- Automated npm publishing workflow based on Git tags (`v*` / `tabrix-v*`).
- Portable assistant skill renamed and aligned to Tabrix: `skills/tabrix_browser`.

## Changed

- Rebranded default package and CLI from `mcp-chrome-bridge` to `tabrix`.
- Preserved legacy command aliases for migration compatibility:
  - `mcp-chrome-bridge`
  - `mcp-chrome-stdio`
- Unified repository links, docs naming, and public project structure for Tabrix.

## Fixed

- Fixed npm publish/install risk by replacing workspace dependency with semver dependency for `chrome-mcp-shared`.
- Added compatibility fallback for remote-access message types when shared enum versions differ.

## Migration Notes

- New users should use `tabrix` as the primary command.
- Existing users can continue using legacy commands during migration.
- Recommended first-run validation:
  - `tabrix status`
  - `tabrix doctor`
  - `tabrix smoke`
