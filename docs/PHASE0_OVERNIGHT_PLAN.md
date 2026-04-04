# Phase 0 Overnight Plan

Date: 2026-04-04

Branch: `codex/phase0-stabilization`

Goal: finish Phase 0 hardening work needed to make the project feel stable, diagnosable, and fast to use locally.

## Completed so far

- Fixed per-connection MCP server lifecycle for HTTP/SSE
- Added tool filtering and initial MCP annotations
- Fixed Windows `register:dev` admin-detection path
- Added regression coverage for repeated MCP initialize
- Added runtime `/status` endpoint and `mcp-chrome-bridge status`
- Deepened `doctor` to verify `/status` and a real MCP `initialize`
- Added stable quickstart and CoPaw integration docs
- Improved Windows build cleanup behavior under active native-host locks
- Aligned `postinstall` privilege detection with the CLI path

## Remaining Phase 0 tasks

### 1. Transport and lifecycle hardening

- Stress-test repeated HTTP/SSE initialize/connect/delete flows
- Confirm session cleanup does not leak stale transport entries
- Review stdio proxy path for remaining client-compatibility edge cases

### 2. Diagnostics and supportability

- Extend `report` to surface runtime status more prominently
- Add clearer next-step hints for common failure modes
- Capture example healthy and unhealthy outputs for docs

### 3. Install and setup reliability

- Re-verify global install flow with current `postinstall`
- Re-verify `register`, `doctor`, `status`, and `report` from built artifacts
- Confirm Windows local dev loop stays usable with an active Chrome connection

### 4. CoPaw integration

- Re-test `copaw app` startup path on `v1.0.1`
- Re-check `streamable-mcp-server` loading through CoPaw API/runtime
- Document any remaining CoPaw-side cleanup caveats separately from mcp-chrome issues

### 5. Operator docs

- Update troubleshooting docs with `status` and deeper `doctor`
- Add practical browser-operation examples for daily use
- Add a concise “first 5 minutes” setup checklist

### 6. Final validation

- Validate with real Chrome extension
- Validate with direct HTTP MCP calls
- Validate with CoPaw-side MCP usage
- Run targeted tests and build
- Commit/push each completed feature slice

## Working order for the rest of the night

1. Finish transport edge-case checks
2. Tighten report/support output
3. Re-verify CoPaw end-to-end
4. Polish docs and troubleshooting
5. Run final validation pass
6. Package the morning summary
