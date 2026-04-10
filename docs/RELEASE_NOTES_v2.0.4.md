# Tabrix v2.0.4 Release Notes

Release date: 2026-04-10

## Context

v2.0.4 focuses on remote-control onboarding speed and documentation consistency for the Tabrix brand line.

## Added

- Default token pre-provisioning on global install:
  - Postinstall now prepares a usable auth token when `MCP_AUTH_TOKEN` is not set.
  - New users can see token data faster in extension `Token 管理`.
- Token TTL API test coverage:
  - Added tests for `ttlDays=1`, `ttlDays=0`, and invalid TTL rejection.

## Improved

- Remote toggle UX in popup:
  - Added token-ready retry flow after enabling remote access.
  - Reduced "remote enabled but no token visible yet" friction.
- Readme command UX:
  - Main `tabrix` commands are now grouped as copy-ready command blocks.
  - CLI section moved under capability context for better scanning.

## Changed

- Documentation structure and naming unified to Tabrix:
  - Remote section reordered to show client config first.
  - Legacy `chrome-mcp` config keys in user docs updated to `tabrix`.
  - Firewall rule naming and multiple docs references aligned to Tabrix wording.

## Fixed

- Inconsistent remote setup guidance across docs.
- Mixed old/new project naming that could confuse new users during onboarding.

## Validation

- `pnpm --filter @tabrix/tabrix typecheck`
- `pnpm --filter @tabrix/extension typecheck`
- `pnpm --filter @tabrix/tabrix test -- src/server/server.test.ts`
