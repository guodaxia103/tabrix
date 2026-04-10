# Tabrix v2.0.1 Release Notes

Release date: 2026-04-10

## Context

v2.0.1 is a patch release focused on release pipeline stability and publish reliability after the initial v2.0.0 launch.

## Added

- Manual release control input in GitHub Actions:
  - `publish_npm` (`false` by default for manual runs)
  - Enables "release assets first, npm publish optional" flow for recovery scenarios

## Changed

- Release workflow checkout logic was simplified to use tag `ref` directly via `actions/checkout`.
- Dependency install step in release workflow now uses:
  - `pnpm install --frozen-lockfile --ignore-scripts`
- GitHub Actions JavaScript runtime preference is set to Node 24 for forward compatibility.

## Fixed

- Fixed manual `workflow_dispatch` runs failing at tag checkout under specific tag-ref conditions.
- Fixed release jobs failing in install phase due to lifecycle scripts requiring prebuilt `dist` files.
- Release assets are now still generated/uploaded before npm publish failure is surfaced.

## Notes

- If npm publish is expected (push-tag release or manual with `publish_npm=true`) and publish fails, the workflow marks failure with a clear error message.
- For manual recovery/rebuild of existing tags, use:
  - `tag=vX.Y.Z`
  - `publish_npm=false` (default)
