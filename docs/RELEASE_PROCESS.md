# Tabrix Release Process

This document defines the standard release process for the Tabrix repository.

## Versioning Policy

- Canonical release package: `@tabrix/tabrix`
- Runtime shared package: `@tabrix/shared`
- Root workspace version (`package.json`) must match `@tabrix/tabrix` version.
- `@tabrix/extension` version must match `@tabrix/tabrix` version.
- Release tags must use one of:
- `vX.Y.Z`
- `tabrix-vX.Y.Z`

## Required Release Notes

Each release must include:

- `docs/RELEASE_NOTES_vX.Y.Z.md`

Release workflow will block publication if this file is missing.

### Pre-release DRAFT files

Some release lines (e.g. v2.5) accumulate notes incrementally while a
multi-package P0 chain lands across several commits before any
version bump. During that window, the draft can live at a path of
the form `docs/RELEASE_NOTES_V<MAJOR>_<MINOR>_DRAFT.md` (for
example, `docs/RELEASE_NOTES_V2_5_DRAFT.md`).

The DRAFT path is **draft-only**:

- The release gate (`scripts/check-release-readiness.mjs`) only ever
  loads release notes from the canonical
  `docs/RELEASE_NOTES_vX.Y.Z.md` path. The DRAFT path is
  intentionally not a fallback.
- Before the release commit (the commit that bumps the five
  `package.json` versions and produces the tag), the maintainer MUST
  `git mv` the draft to the canonical path
  (`docs/RELEASE_NOTES_v<MAJOR>.<MINOR>.<PATCH>.md`) in the same
  commit.
- The draft MAY contain `__V25_TBD__` (or analogous) placeholders
  while the chain is in flight. The v2.5+ benchmark gate
  (`scripts/lib/v25-benchmark-gate.cjs::RELEASE_NOTES_PLACEHOLDER_TOKEN`)
  rejects any release notes file that still contains the
  `__V25_TBD__` token, so the rename step has the side effect of
  forcing the maintainer to confront every placeholder before the
  gate will pass.

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

Audit gate note:

- `pnpm run audit` now uses the in-repo OSV production dependency gate implemented in `scripts/audit-prod.mjs` instead of the retired npm audit endpoint.
- `pnpm run release:check` remains the release metadata and notes gate that runs before publication.

If the release includes new third-party reuse, complete these manual checks as well:

- the upstream project appears in the documented third-party reuse matrix and has a source record;
- code reuse has a source record and an updated root `NOTICE` when required;
- design-only inspiration has a design reference record;
- AGPL, commercial, mixed-license, or directory-scoped exceptions were manually reviewed.

## Release Execution

1. Update versions and release notes.
2. If the release introduces new third-party reuse, finish the source record / `NOTICE` / manual license review first.
3. Commit changes to `main`.
4. Create and push a release tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. GitHub Actions (`Release Tabrix`) will:

- validate release metadata
- run quality gates
- publish `@tabrix/shared` first if missing in npm registry
- publish `@tabrix/tabrix` (token or trusted publishing mode)
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

## Third-Party Reuse Release Gate

Do not release when any of the following is true:

- release-scoped third-party code or assets were reused without a source record;
- `NOTICE` should be updated but is still missing the attribution entry;
- a referenced upstream project is not yet classified in the reuse matrix;
- AGPL, commercial, mixed-license, or directory-scoped boundaries have not been manually reviewed.
