# Tabrix v2.0.2 Release Notes

Release date: 2026-04-10

## Context

v2.0.2 focuses on npm publication reliability by migrating to a scoped package and strengthening release workflow diagnostics.

## Added

- Scoped npm package identity:
  - `@tabrix/tabrix`
- Stronger npm publish diagnostics in CI:
  - `npm whoami` authentication precheck
  - provenance publish fallback (`npm publish --access public`) when `--provenance` fails

## Changed

- Installation commands updated to:
  - `npm install -g @tabrix/tabrix@latest`
  - `pnpm install -g @tabrix/tabrix@latest`
- Release workflow metadata now reads package name/version dynamically from `app/native-server/package.json`.
- npm tarball path handling now uses actual `npm pack` output instead of fixed filename assumptions.

## Fixed

- Fixed npm publication status checks for scoped package names.
- Reduced release failures caused by package-name ownership ambiguity on unscoped npm package lines.

## Notes

- CLI command remains `tabrix` after installation.
- Legacy command aliases remain available for compatibility.
