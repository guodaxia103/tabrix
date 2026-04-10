# Dependency Upgrade Plan (Stage 2)

Date: 2026-04-10
Scope: `tabrix-monorepo`

## Goal

Upgrade dependencies in risk-controlled batches, keep release workflow stable, and avoid regressions in MCP core flows.

## Baseline

- Current core tests are stable (`native-server`, `chrome-extension`).
- Stage 1 security updates were completed (`drizzle-orm`, `hono`, `@hono/node-server`).
- Remaining outdated packages include multiple major versions and ecosystem migrations.

## Batch Strategy

### Batch A (low risk, patch/minor only)

- `@typescript-eslint/*` patch/minor alignment in all workspaces
- `chrome-devtools-frontend` minor update
- `@types/chrome` stays on `0.0.318` for now (newer `0.1.x` introduces type breaks)

Exit criteria:

- `pnpm run typecheck`
- `pnpm run test:core`

### Batch B (medium risk, runtime but non-architectural)

- `commander` major
- `pino` major
- `dotenv` major
- `markstream-vue` update

Exit criteria:

- Batch A checks
- MCP startup smoke test: `tabrix --help`, `tabrix doctor`

### Batch C (high risk, schema/test stack)

- `zod@4`
- `vitest@4`
- `jest@30`
- `typescript@6`
- `vue-tsc@3`

Exit criteria:

- Batch B checks
- extension unit tests full pass
- native unit tests full pass

### Batch D (breaking/runtime migration)

- `node-fetch@3` (ESM migration)
- `better-sqlite3@12`
- `unplugin-icons@23`
- `unplugin-vue-components@32`

Exit criteria:

- Batch C checks
- install and remote-control manual smoke path

## Execution Rules

- One batch per PR.
- No mixed major migration in a single PR.
- Every batch must include a rollback note in PR description.

## Suggested Command Set

```bash
pnpm run deps:outdated
pnpm run typecheck
pnpm run test:core
pnpm run audit
```
