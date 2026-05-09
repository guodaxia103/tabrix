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

## V27 Public-Safe Gate Reports

The public repository may contain deterministic V27 gate report schemas and fixture-level tests only. A V27 public-safe gate report uses:

- `overallStatus`: `PASS`, `FAIL`, or `BLOCKED`
- `releaseReadiness`: always `not_assessed`
- `sections[].id`: one of `api_success`, `api_timeout_fallback`, `semantic_mismatch_fallback`, `api_unavailable_fallback`, `real_platform_gate`, `competitor_delta_gate`, `privacy_evidence`, or `benchmark_gate`
- `sections[].evidence`: redacted counters or closed-vocabulary markers only

These reports must not include raw URLs, raw query strings, cookies, Authorization headers, raw request or response bodies, or private benchmark artifacts. A public-safe `PASS` means the transformed public evidence shape passed deterministic checks; it is not a release-readiness claim. Real browser acceptance and final release judgment remain in the maintainer-private acceptance lane.

## Reporting Verification

Task summaries should clearly state:

1. what was changed
2. what was verified
3. what was not verified
4. what risks remain
