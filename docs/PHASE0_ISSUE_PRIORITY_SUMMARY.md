# Phase 0 Issue Priority Summary

Last updated: `2026-04-05 19:20 Asia/Shanghai`

This document summarizes the most important remaining Phase 0 issue groups based on:

- the original Phase 0 planning analysis
- current code state on `codex/phase0-stabilization`
- real local validation work already completed

Status legend:

- `resolved`: fixed or largely mitigated in the current branch
- `active`: still needs engineering work
- `watch`: not a blocker tonight, but should stay visible

## P0: Transport and Runtime Availability

### 1. MCP transport/session instability

Priority: `P0`
State: `partially resolved`

Why it matters:

- repeated initialize failures break all downstream clients
- this was the biggest “looks broken” class of defect

Current assessment:

- global MCP server reuse bug is fixed
- repeated initialize behavior is much better
- broader SSE/parallel-session regression coverage is still not complete

Next actions:

- expand session regression coverage
- clean up session-registry structure

### 2. “Connected but service not started”

Priority: `P0`
State: `active`

Why it matters:

- this is still one of the most confusing user-facing failure modes

Current assessment:

- diagnostics and popup status are much better than before
- extension/native state still depends on real popup connect flow
- there are still edge cases where runtime is not up even though Chrome is open

Next actions:

- continue state-machine cleanup
- continue popup/runtime troubleshooting improvements
- keep reducing ambiguity in error messages

## P0: Install, Startup, and Diagnostics

### 3. Installation and startup friction

Priority: `P0`
State: `partially resolved`

Current assessment:

- Windows build/registration path improved a lot
- native host manifest/registry diagnostics are stronger
- startup/install is still not yet “beginner perfect”

Next actions:

- continue beginner-path polish
- keep improving pilot install checklist
- document more common failure patterns

### 4. Diagnostic completeness

Priority: `P0`
State: `active`

Current assessment:

- `doctor` is in good shape
- `status` and `smoke` exist
- `report` is improving, but still needs to be more support-ready

Next actions:

- continue strengthening `report`
- standardize what a support bundle must contain
- organize logs / trace / screenshot / error-code references

## P1: Execution Correctness and Tool Reliability

### 5. Remaining smoke tail issues

Priority: `P1`
State: `active`

Known active items:

- `chrome_get_web_content`
- `chrome_handle_dialog`

Why it matters:

- these are not foundational transport bugs anymore
- but they block a clean “all green” confidence signal

Next actions:

- continue aligning smoke expectations with real tool outputs
- re-run smoke multiple times after fixes

### 6. Public tool validation coverage

Priority: `P1`
State: `active`

Current assessment:

- many high-value tools are already live-validated
- not every public tool has been validated yet
- not every high-value tool has been re-tested through CoPaw

Next actions:

- finish the validation matrix
- link every `warn/fail` to a fix or documented caveat

## P1: Client Compatibility

### 7. Compatibility matrix is still incomplete

Priority: `P1`
State: `active`

Current assessment:

- Chrome direct flow: partially validated
- CoPaw: partially validated
- broader matrix for Claude/Cursor/stdio/MCP Inspector is not complete

Next actions:

- produce a compatibility table
- document recommended transport per client

## P1: Runtime Noise and Operator Experience

### 8. Extension error-page noise

Priority: `P1`
State: `active`

Current assessment:

- at least one noisy teardown path has already been improved
- real-page verification still needs another pass

Next actions:

- continue removing non-actionable runtime noise
- distinguish test-page noise from real customer-impacting failures

## P2: Governance and Safety

### 9. Per-tool policy model

Priority: `P2`
State: `watch`

Current assessment:

- initial annotations exist
- minimal allow/deny tool filtering exists
- richer policy model is not yet implemented

Why this is not above P0/P1:

- the base still benefits more from stability and validation work first

## P2: Packaging and Pilot Readiness

### 10. Pilot delivery packaging

Priority: `P2`
State: `active`

Current assessment:

- quickstart exists
- CoPaw guide exists
- pilot install checklist now exists
- still needs to be turned into a cleaner trial-delivery package

Next actions:

- tighten install checklist
- add operator FAQ
- add a recommended first-task verification flow

## Recommended Fix Order

1. `P0` runtime availability and startup ambiguity
2. `P0` diagnostics/supportability
3. `P1` smoke tail issues
4. `P1` remaining public-tool validation
5. `P1` CoPaw and client compatibility coverage
6. `P1` extension runtime-noise cleanup
7. `P2` pilot packaging polish
8. `P2` richer governance model
