# Tabrix Platform Support

This document explains the current public support posture by platform.

## Current Support Position

| Platform | Current Position |
| --- | --- |
| Windows | Primary validated platform |
| macOS | Supported in principle, but still benefits from more real-machine validation |
| Ubuntu / Linux | Supported in principle, but still benefits from more real-machine validation |

## What This Means Publicly

- Windows is the strongest validation baseline today
- macOS and Ubuntu are not “unsupported”, but their public promise should remain more careful
- Contributors should avoid overstating cross-platform maturity beyond the verification actually completed

## Platform Notes

### Windows

- Main validation baseline for install, extension connection, diagnostics, and release acceptance

### macOS

- Browser path detection and service-path coverage exist in code
- Real-machine validation is still valuable for launch behavior and user-session specifics

### Ubuntu / Linux

- Browser detection and service paths exist in code
- Real desktop validation is still valuable for extension connection and desktop behavior

## Public Communication Rule

Do not describe macOS or Linux support as fully production-proven unless the specific release has completed real-machine validation for the claimed path.

## Related Docs

- `STABLE_QUICKSTART.md`
- `TESTING.md`
- `RELEASE_PROCESS.md`
