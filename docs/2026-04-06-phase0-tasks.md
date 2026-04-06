# 2026-04-06 Phase 0 Tasks

Last updated: `2026-04-06 15:20 Asia/Shanghai`

## Goals

- close the continuity gap before pushing deeper into Phase 0 work
- finish more real-world tool validation
- keep every meaningful checkpoint visible in docs or commits

## Status

- `done`: add execution protocol draft in [EXECUTION_PROTOCOL.md](D:\projects\ai\codex\mcp-chrome\docs\EXECUTION_PROTOCOL.md)
- `done`: install open-source `note` skill inspired by `oh-my-codex`
- `done`: install full `oh-my-codex` runtime with `codex`, `omx`, and Windows `psmux/tmux`
- `done`: run `omx setup`, `omx doctor`, `codex login status`, and shell-resolution checks
- `done`: initialize a real `omx team` state in a smoke repo to verify Windows team runtime startup
- `done`: reframe the `mcp-chrome` secondary development program using OMX workflow concepts
- `done`: write the approved Program 1 / Phase 1 execution-platform plan
- `done`: land the first Program 1 execution skeleton (`types.ts` + `session-manager.ts`) with passing test and build
- `done`: validate and keep the Windows-safe `report.ts` enhancement for package-manager/version diagnostics
- `done`: wrap current MCP tool dispatch with the first session-aware execution lifecycle
- `done`: expose execution task/session summary through the `/status` snapshot
- `done`: add the first result-normalization layer for tool-call session summaries
- `done`: create local `continuous-execution` skill for durable long-task execution
- `done`: create local `github-delivery-loop` skill for small verified git checkpoints
- `in_progress`: resume Phase 0 smoke and live tool validation
- `pending`: complete CoPaw full-chain retest after bridge stability improves

## Task List

- [x] create a durable execution protocol for long-running work
- [x] install at least one lightweight open-source skill that directly improves continuity
- [x] install the upstream `oh-my-codex` runtime instead of only borrowing ideas
- [x] validate `omx`, `codex`, and `tmux` resolution from a fresh PowerShell
- [x] validate `omx setup` and `omx doctor`
- [x] validate `omx team` startup path in a Windows smoke repo
- [x] write an OMX-style reorganization plan for the `mcp-chrome` program
- [x] write the Program 1 / Phase 1 approved plan
- [x] add the first execution-core code skeleton with a minimal lifecycle test
- [x] validate and keep the `report.ts` Windows command-version fix
- [x] connect `register-tools` to the first task/session/step execution wrapper
- [x] extend `/status` with execution summary and tests
- [x] add a minimal result-normalization layer with tests
- [x] create custom local skills adapted to current repo workflow
- [x] validate new local skills structurally
- [ ] update task and handoff process to explicitly use the new skills
- [ ] continue live validation for remaining MCP tools
- [ ] continue CoPaw real-environment retest
- [ ] commit the new repo docs separately from unfinished code changes

## Blockers

- the active browser-extension chain is still not stable enough for unattended end-to-end smoke completion
- opening the extension popup URL from Chrome did not trigger a fresh native-host start; no new wrapper logs were created
- there are still uncommitted experimental edits in `report.ts` and `smoke.ts`, so doc-only commits must stay scoped
- the repo build and local CLI are correct, but the globally installed `mcp-chrome-bridge` still points to an older npm package with outdated CLI behavior
- the current `omx team` smoke proved runtime startup and team-state creation, but a fully interactive end-to-end worker completion cycle is still pending

## Next Actions

1. keep the browser-chain issue explicit as a blocker instead of silently waiting on it
2. continue Program 1 work that does not depend on live extension connectivity
3. retry extension reconnection later and resume smoke once the browser chain is back
