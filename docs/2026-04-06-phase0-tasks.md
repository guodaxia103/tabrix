# 2026-04-06 Phase 0 Tasks

Last updated: `2026-04-06 14:15 Asia/Shanghai`

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
- `done`: create local `continuous-execution` skill for durable long-task execution
- `done`: create local `github-delivery-loop` skill for small verified git checkpoints
- `in_progress`: fold the new OMX-backed skill stack into current delivery workflow
- `pending`: resume Phase 0 smoke and live tool validation
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
- [x] create custom local skills adapted to current repo workflow
- [x] validate new local skills structurally
- [ ] update task and handoff process to explicitly use the new skills
- [ ] continue live validation for remaining MCP tools
- [ ] continue CoPaw real-environment retest
- [ ] commit the new repo docs separately from unfinished code changes

## Blockers

- the active browser-extension chain is still not stable enough for unattended end-to-end smoke completion
- there are still uncommitted experimental edits in `report.ts` and `smoke.ts`, so doc-only commits must stay scoped
- the current `omx team` smoke proved runtime startup and team-state creation, but a fully interactive end-to-end worker completion cycle is still pending

## Next Actions

1. commit the OMX install/runtime status update without pulling in unfinished code edits
2. resume Phase 0 validation from the current live-tool matrix
3. keep using the dated task board + small verified commits protocol for every next slice
