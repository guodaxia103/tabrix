# Tabrix v2.0.3 Release Notes

Release date: 2026-04-10

## Context

v2.0.3 is a release hardening patch to improve post-publish confidence and make npm visibility checks explicit in CI.

## Added

- Post-publish npm visibility verification in release workflow:
  - Polls npm registry for `<package>@<version>` after publish
  - Fails the workflow if package remains invisible after retry window

## Changed

- Added explicit npm `publishConfig` in package metadata:
  - `access: public`
  - `registry: https://registry.npmjs.org/`

## Fixed

- Reduced false-positive "publish success" cases where package was not yet visible on npm.
- Improved long-term release consistency across manual and tag-triggered runs.

## Notes

- Install command remains:
  - `npm install -g @tabrix/tabrix@latest`
  - `pnpm install -g @tabrix/tabrix@latest`
