# Tabrix v2.0.0 Release Notes

Release date: 2026-04-10

## Context

Tabrix is a community-maintained continuation of the original open-source project [`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome).

As upstream update cadence slowed for an extended period, Tabrix is launched to provide continuous maintenance, faster fixes, and a clearer roadmap for production usage.

Thanks to all original maintainers and contributors for the initial open-source foundation.

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
