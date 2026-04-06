# 2026-04-06 Phase 0 Tasks

Last updated: `2026-04-06 19:20 Asia/Shanghai`

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
- `done`: validate CoPaw click/fill/close-tab interaction flows and classify keyboard/screenshot caveats
- `done`: validate `chrome_handle_download` against a real local download flow
- `done`: validate `performance_analyze_insight` after adding latest-trace fallback logic
- `done`: validate `chrome_request_element_selection` timeout behavior for the human-in-the-loop path
- `done`: classify `search_tabs_content` as a remaining functional gap instead of unknown pending work
- `done`: draft a beginner handoff guide for install, validation, and first-task success
- `done`: create local `continuous-execution` skill for durable long-task execution
- `done`: create local `github-delivery-loop` skill for small verified git checkpoints
- `in_progress`: OMX team closeout run launched as `omx-mnn1u7ui` with 3 lanes (public tools, CoPaw+skill, beginner handoff)
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
- [x] validate CoPaw click/fill/close-tab flows and classify keyboard/screenshot caveats
- [x] convert two remaining `pending` tools into explicit validated outcomes (`pass` or `fail`)
- [x] validate `performance_analyze_insight` and `chrome_request_element_selection` behavior
- [x] draft the beginner handoff package for install and first-task success
- [x] create custom local skills adapted to current repo workflow
- [x] validate new local skills structurally
- [~] run an OMX team closeout lane for parallel validation/doc work
- [ ] update task and handoff process to explicitly use the new skills
- [ ] continue live validation for remaining MCP tools
- [~] continue CoPaw real-environment retest
- [ ] commit the new repo docs separately from unfinished code changes

## Blockers

- the repo build and local CLI are correct, but the globally installed `mcp-chrome-bridge` still points to an older npm package with outdated CLI behavior
- the current `omx team` smoke proved runtime startup and team-state creation, but a fully interactive end-to-end worker completion cycle is still pending
- remaining Phase 0 work is no longer blocked by browser startup; it is now mostly validation coverage and CoPaw retesting
- CoPaw still emits a known cleanup warning during `close_all()` on streamable HTTP clients, even after successful MCP operations
- CoPaw app-level initialization now loads `streamable-mcp-server` again; the remaining noise is concentrated in shutdown / cleanup
- `search_tabs_content` is exposed in docs/shared schemas but is currently unavailable in the active bridge runtime
- some interaction-heavy CoPaw flows still need broader coverage beyond read/navigation

## Next Actions

1. commit the latest validation findings, matrix cleanup, and beginner handoff guide
2. continue the remaining live tool validation coverage
3. continue CoPaw interaction-heavy validation and finalize the skill guidance
