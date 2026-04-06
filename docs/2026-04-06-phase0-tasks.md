# 2026-04-06 Phase 0 Tasks

Last updated: `2026-04-06 16:25 Asia/Shanghai`

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
- `done`: harden extension packaging with an auto-generated local `CHROME_EXTENSION_KEY` for stable unpacked IDs
- `done`: clean stale Chrome extension IDs from the local profile and verify the stable unpacked extension survives a browser restart at the profile level
- `done`: restore browser-chain health so `doctor` reaches `connectivity/runtime/mcp.initialize = ok`
- `done`: get `smoke --json` back to green end-to-end
- `done`: validate CoPaw can connect to the browser MCP, list tools, navigate, and read selector-targeted content
- `done`: validate `chrome_handle_download` against a real local download flow
- `done`: classify `search_tabs_content` and `performance_analyze_insight` as remaining functional gaps instead of unknown pending items
- `done`: create local `continuous-execution` skill for durable long-task execution
- `done`: create local `github-delivery-loop` skill for small verified git checkpoints
- `in_progress`: continue the remaining live tool validation and CoPaw retest
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
- [x] add stable local extension-key generation to reduce unpacked extension ID drift
- [x] close the old unpacked-extension ID drift / stale profile state issue
- [x] restore browser-chain health and re-pass smoke end-to-end
- [x] validate the CoPaw browser MCP client on high-value read/navigation flows
- [x] convert two remaining `pending` tools into explicit validated outcomes (`pass` or `fail`)
- [x] create custom local skills adapted to current repo workflow
- [x] validate new local skills structurally
- [ ] update task and handoff process to explicitly use the new skills
- [ ] continue live validation for remaining MCP tools
- [~] continue CoPaw real-environment retest
- [ ] commit the new repo docs separately from unfinished code changes

## Blockers

- there are still uncommitted experimental edits in `report.ts` and `smoke.ts`, so doc-only commits must stay scoped
- the repo build and local CLI are correct, but the globally installed `mcp-chrome-bridge` still points to an older npm package with outdated CLI behavior
- the current `omx team` smoke proved runtime startup and team-state creation, but a fully interactive end-to-end worker completion cycle is still pending
- remaining Phase 0 work is no longer blocked by browser startup; it is now mostly validation coverage and CoPaw retesting
- CoPaw still emits a known cleanup warning during `close_all()` on streamable HTTP clients, even after successful MCP operations
- `search_tabs_content` is exposed in docs/shared schemas but is currently unavailable in the active bridge runtime
- `performance_analyze_insight` currently fails to find a just-recorded trace result after successful trace stop

## Next Actions

1. commit the latest validation findings and refreshed Phase 0 docs
2. continue the remaining live tool validation coverage
3. decide whether to fix or explicitly de-scope the remaining failing tools for Phase 0
