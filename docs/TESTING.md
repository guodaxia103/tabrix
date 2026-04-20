# Tabrix Testing and Verification Guide

This document explains how contributors should verify changes before claiming they are complete.

## Verification Principles

- Prefer the smallest verification set that proves the change is correct
- Distinguish code-level verification from real runtime verification
- Do not claim browser-side verification if the unpacked extension was not rebuilt and reloaded
- When a user-facing runtime path is part of the claim, verify that runtime path explicitly

## Common Verification Levels

| Level                            | What It Proves                                             |
| -------------------------------- | ---------------------------------------------------------- |
| Unit / targeted test             | The changed logic behaves as expected in isolation         |
| Package-level build or typecheck | The changed package still compiles                         |
| Runtime CLI verification         | The local service path still responds correctly            |
| Real browser verification        | The extension + native path works in a real Chrome session |

## Recommended Checks By Change Type

### Docs-only changes

- Check links and navigation paths
- Make sure README and docs index still point to the correct files

### Native server / CLI / MCP changes

- `pnpm -C app/native-server build`
- relevant targeted tests when available
- `tabrix status`
- `tabrix doctor`
- `tabrix smoke`

### Extension changes

- `pnpm -C app/chrome-extension build`
- targeted tests when available
- `pnpm run extension:reload`
- real browser validation for the changed behavior

### Shared contract or tool schema changes

- `pnpm -C packages/shared build`
- affected native-server and extension builds
- tool-path smoke verification when behavior changed

## Stable Local Acceptance Loop

For extension or runtime work, the default acceptance loop is:

1. build the changed package
2. reload the unpacked extension if browser-side code changed
3. run the smallest CLI or smoke verification needed
4. validate the specific runtime claim in a real browser when applicable

## Release-Oriented Verification

Before a release, contributors should also read:

- `RELEASE_PROCESS.md`
- `PLATFORM_SUPPORT.md`

## Reporting Verification

Task summaries should clearly state:

1. what was changed
2. what was verified
3. what was not verified
4. what risks remain
