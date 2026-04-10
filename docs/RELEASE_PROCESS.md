# Tabrix Release Process

This document defines the standard release process for the Tabrix repository.

## Versioning Policy

- Canonical release package: `@tabrix/tabrix`
- Root workspace version (`package.json`) must match `@tabrix/tabrix` version.
- `@tabrix/extension` version must match `@tabrix/tabrix` version.
- Release tags must use one of:
- `vX.Y.Z`
- `tabrix-vX.Y.Z`

## Required Release Notes

Each release must include:

- `docs/RELEASE_NOTES_vX.Y.Z.md`

Release workflow will block publication if this file is missing.

## Pre-Release Checks

Run from repository root:

```bash
pnpm install --frozen-lockfile
pnpm run release:check
pnpm run i18n:check
pnpm run typecheck
pnpm run test:core
pnpm run audit
```

## Release Execution

1. Update versions and release notes.
2. Commit changes to `main`.
3. Create and push a release tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

4. GitHub Actions (`Release Tabrix`) will:

- validate release metadata
- run quality gates
- publish to npm (token or trusted publishing mode)
- upload extension zip and npm tarball to GitHub Release

## Manual Release (workflow_dispatch)

When manually running `Release Tabrix`:

- input `tag`: existing tag (for example `v2.0.5`)
- `publish_npm=false`: dry release assets only
- `publish_npm=true`: publish to npm if not yet published

## Rollback / Hotfix

- Do not overwrite published npm versions.
- For hotfixes, bump patch version (`X.Y.Z+1`) and release a new tag.
- If GitHub Release notes are incorrect, edit the release body and keep the tag immutable.
