# Phase 0 Execution Tracker

Last updated: `2026-04-05 18:40 Asia/Shanghai`
Branch: `codex/phase0-stabilization`

This document is the live execution board for Phase 0.

Status legend:

- `[x]` completed
- `[~]` in progress / partially completed
- `[ ]` not started
- `[!]` blocked or needs follow-up

## 1. Executive Summary

Short answer to the question "did we finish everything in `mcp-chrome-phase0-plan.md`?":

- `No, not all tasks are complete yet.`
- `Yes, the highest-risk Phase 0 foundation work is already done.`

What is already in a good state:

- `[x]` MCP transport/session root-cause fix landed and was verified in real Chrome
- `[x]` repeated `initialize` no longer breaks on reused HTTP transport
- `[x]` native host diagnostics are much stronger
- `[x]` `status`, `doctor`, and `smoke` commands exist
- `[x]` Windows native-host registration/permission path is more robust
- `[x]` popup connection state is more truthful and easier to diagnose
- `[x]` dynamic native host `allowed_origins` discovery is in place, which fixed the unpacked-extension ID drift issue
- `[x]` stable quickstart and CoPaw integration docs were added
- `[~]` full public-tool live validation is underway
- `[~]` full CoPaw re-validation is underway
- `[~]` final cleanup of extension runtime noise and smoke tail issues is still in progress

## 2. Yesterday Plan Status

Source plan:

- [mcp-chrome-phase0-plan.md](D:\projects\ai\codex\mcp-chrome-phase0-plan.md)

### Track A: MCP transport and session stabilization

- `[x]` A1. Remove global MCP server singleton for HTTP/SSE
  Notes: landed and verified through repeated real `POST /mcp initialize` calls.
- `[~]` A2. Refactor session registry
  Notes: transport lifecycle is significantly improved, but the full dedicated session-registry extraction is not finished as a standalone module.
- `[x]` A3. Fix response lifecycle and reduce `ERR_HTTP_HEADERS_SENT`
  Notes: key guardrails were added and the major repro path was removed.
- `[~]` A4. Add transport regression coverage
  Notes: regression coverage exists for repeated initialization; broader SSE/parallel-session coverage is still incomplete.

### Track B: startup, install, and diagnostics stabilization

- `[x]` B1. Establish clearer server status lifecycle
  Notes: popup/native diagnostics are much better, though there is still room to formalize state names further.
- `[x]` B2. Strengthen `doctor` / `report`
  Notes: `doctor` now checks manifest, registry, logs, runtime connectivity, `/status`, and real MCP initialize.
- `[x]` B3. Handle logs/runtime directory initialization
  Notes: startup/build/install paths are more resilient now.
- `[~]` B4. Improve dev environment and optional dependency handling
  Notes: Windows/admin/build issues were improved; broader optional-dependency hardening is not fully done.

### Track C: client compatibility and execution correctness

- `[~]` C1. Build client compatibility matrix
  Notes: Chrome direct flow and CoPaw partial flow are validated; the matrix is not fully complete yet.
- `[~]` C2. Fix execution correctness issues
  Notes: localhost navigation and several smoke paths were fixed; some tool-specific edge cases remain.

### Track D: security and tool governance

- `[x]` D1. Add MCP annotations for representative tools
  Notes: high-risk and read-only tool annotations were added.
- `[x]` D2. Add minimal allow/deny tool filtering
  Notes: `ENABLE_MCP_TOOLS` and `DISABLE_MCP_TOOLS` landed.
- `[ ]` D3. Per-tool policy model
  Notes: not a Phase 0 must-have for tonight; still not implemented.

## 3. Commits Already Landed

Verified commits already pushed on this branch:

- `3dcad02` fix: stabilize native MCP transport lifecycle
- `b4909f4` feat: add runtime status endpoint and cli
- `9761a18` feat: deepen doctor runtime checks
- `54f3b90` docs: add stable quickstart and copaw guide
- `d9096db` fix: make windows build cleanup more resilient
- `20451bf` fix: align postinstall privilege detection
- `3387b86` docs: add phase0 overnight execution plan
- `4a4ad12` fix: harden extension build and localhost navigation
- `09e517a` feat: surface loaded chrome extension path in doctor
- `d07e0ee` docs: clarify loaded extension path troubleshooting
- `7e2d9a8` feat: add live smoke test command
- `d6fc30d` docs: add phase0 validation matrix
- `b8b346a` fix: make popup refresh recover native server state
- `88151dd` docs: surface stable runtime verification commands
- `7af0e61` feat: warn when loaded extension metadata is incomplete
- `85f89d8` fix: harden native host diagnostics and extension state

## 4. 15-Hour Plan and Live Status

### Block 1. Tool inventory and validation matrix

- `[x]` Create a public-tool validation board
- `[~]` Keep the matrix updated as real tests complete

Current document:

- [PHASE0_TOOL_VALIDATION_MATRIX.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_TOOL_VALIDATION_MATRIX.md)

### Block 2. Core-tool real-environment validation

- `[x]` `get_windows_and_tabs`
- `[x]` `chrome_navigate`
- `[x]` `chrome_switch_tab`
- `[x]` `chrome_close_tabs`
- `[x]` `chrome_read_page`
- `[~]` `chrome_get_web_content`
- `[x]` `chrome_click_element`
- `[x]` `chrome_fill_or_select`
- `[x]` `chrome_keyboard`
- `[x]` `chrome_computer` basic screenshot path
- `[~]` `chrome_handle_dialog`
- `[x]` `chrome_network_capture`
- `[x]` `chrome_network_request`
- `[x]` `chrome_console`
- `[x]` `chrome_javascript`
- `[x]` `chrome_screenshot`
- `[x]` `chrome_upload_file`
- `[x]` `chrome_history`
- `[x]` `chrome_bookmark_search`
- `[x]` `chrome_bookmark_add`
- `[x]` `chrome_bookmark_delete`
- `[x]` `performance_start_trace`
- `[x]` `performance_stop_trace`

### Block 3. Remaining public tools to validate live

- `[ ]` `chrome_get_interactive_elements`
- `[ ]` `search_tabs_content`
- `[ ]` `chrome_request_element_selection`
- `[ ]` `chrome_inject_script`
- `[ ]` `chrome_send_command_to_inject_script`
- `[ ]` `chrome_handle_download`
- `[~]` `chrome_gif_recorder`
- `[ ]` `performance_analyze_insight`
- `[ ]` `chrome_userscript`

### Block 4. Smoke and diagnostics hardening

- `[x]` `status` command works
- `[x]` `doctor` command performs real runtime checks
- `[x]` `smoke` command exists and performs live checks
- `[~]` Reduce remaining smoke tail failures
- `[~]` Reduce extension runtime noise from smoke/test pages

### Block 5. CoPaw integration and re-validation

- `[x]` CoPaw basic MCP connection was previously verified
- `[~]` Re-run full CoPaw validation on upgraded `v1.0.1`
- `[ ]` Re-test high-value browser actions through CoPaw
- `[~]` Continue improving CoPaw guidance and MCP skill

### Block 6. Documentation and usability

- `[x]` stable quickstart added
- `[x]` CoPaw guide added
- `[x]` runtime verification commands documented
- `[~]` install path still being polished for absolute beginners
- `[~]` troubleshooting guide still being expanded
- `[~]` skills usage examples still being expanded

## 5. Tonight's Remaining Priorities

Priority order for the rest of the run:

1. `[ ]` Finish real validation for every remaining public tool
2. `[ ]` Re-run high-value tools through CoPaw `v1.0.1`
3. `[ ]` Fix or clearly document any remaining `warn` entries
4. `[ ]` Reduce extension error-page noise that appears during smoke/manual testing
5. `[ ]` Expand docs so a beginner can install, connect, verify, and run a first task
6. `[ ]` Expand the CoPaw browser MCP skill with more stable task recipes

## 6. Current Known Gaps

- `[~]` `chrome_get_web_content` is live-reachable, but smoke assertions still need final alignment
- `[~]` `chrome_handle_dialog` is live-reachable, but smoke timing/result handling still needs final confirmation
- `[~]` some extension error-page entries may still appear from smoke/test pages and need cleanup or clearer documentation
- `[ ]` not every public tool has completed CoPaw re-validation yet
- `[ ]` the full “beginner install to first successful task” documentation flow is not finished yet

## 7. How To Read This Tomorrow

If you want the fastest morning review:

1. Open this file first.
2. Then check the tool matrix:
   [PHASE0_TOOL_VALIDATION_MATRIX.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_TOOL_VALIDATION_MATRIX.md)
3. Then check the stable quickstart:
   [STABLE_QUICKSTART.md](D:\projects\ai\codex\mcp-chrome\docs\STABLE_QUICKSTART.md)
4. Then check CoPaw usage:
   [COPAW.md](D:\projects\ai\codex\mcp-chrome\docs\COPAW.md)

This tracker will be updated as each remaining task is completed.
