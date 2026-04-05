# 2026-04-05 Phase 0 Tasks

Last updated: `2026-04-05 18:48 Asia/Shanghai`
Branch: `codex/phase0-stabilization`

This is today's execution board.
It merges:

- today's 15-hour execution plan
- unfinished work from [mcp-chrome-phase0-plan.md](D:\projects\ai\codex\mcp-chrome-phase0-plan.md)

Status legend:

- `[x]` completed
- `[~]` in progress / partially completed
- `[ ]` not started
- `[!]` blocked or needs follow-up

## 1. Today's Goal

Deliver a Phase 0 build that is:

- stable enough for repeated local MCP use
- easier to install and diagnose
- verified in real Chrome, not only in unit tests
- re-validated through CoPaw for high-value browser tasks
- documented clearly enough for a beginner to install and run the first task

## 2. Quick Reality Check

Answer to "did yesterday's Phase 0 plan finish completely?":

- `No.`
- `The foundation is in much better shape, but several Phase 0 items are still being closed today.`

Already done:

- `[x]` transport/session root-cause fix
- `[x]` repeated MCP initialize stability improvement
- `[x]` stronger native host and extension diagnostics
- `[x]` `status`, `doctor`, `smoke` commands
- `[x]` popup/native state improvements
- `[x]` Windows install/build/permission hardening
- `[x]` extension-ID drift fix via discovered `allowed_origins`
- `[x]` baseline docs for stable quickstart and CoPaw

Still rolling into today's plan:

- `[ ]` complete validation for every public tool
- `[ ]` complete CoPaw re-validation on upgraded `v1.0.1`
- `[ ]` finish smoke tail fixes and runtime-noise cleanup
- `[ ]` finish compatibility/documentation/usability polish
- `[ ]` close remaining partial items from the original Phase 0 plan

## 3. Unfinished Tasks Carried Over From `mcp-chrome-phase0-plan.md`

### Track A. MCP transport and session stabilization

- `[~]` A2. Refactor session registry more cleanly
  Why still open: the high-risk bug is fixed, but the dedicated standalone session-registry module and cleaner transport modeling are not fully extracted yet.
- `[~]` A4. Expand transport regression coverage
  Why still open: repeated initialize is covered, but SSE/parallel-session coverage is still incomplete.

### Track B. Startup, install, and diagnostics stabilization

- `[~]` B4. Improve dev environment and optional dependency handling
  Why still open: Windows/admin/build friction improved, but broader environment hardening is still not complete.

### Track C. Client compatibility and execution correctness

- `[~]` C1. Build client compatibility matrix
  Why still open: Chrome direct flow is validated and CoPaw partial flow is validated, but the matrix is not complete.
- `[~]` C2. Fix remaining execution correctness issues
  Why still open: some smoke/tool edge cases still remain.

### Track D. Security and tool governance

- `[ ]` D3. Per-tool policy model
  Why still open: minimal allow/deny exists, but a richer per-tool policy model is not done.

## 4. Today's 15-Hour Task Board

### 4.1 Public tool inventory and validation

- `[x]` Create a public tool validation matrix
- `[~]` Keep the matrix updated during real tests
- `[ ]` Finish live MCP validation for every remaining public tool
- `[ ]` Re-test high-value tools through CoPaw

Main validation board:

- [PHASE0_TOOL_VALIDATION_MATRIX.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_TOOL_VALIDATION_MATRIX.md)

### 4.2 Core real-environment validation

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

### 4.3 Remaining public tools still to validate live

- `[ ]` `chrome_get_interactive_elements`
- `[ ]` `search_tabs_content`
- `[ ]` `chrome_request_element_selection`
- `[ ]` `chrome_inject_script`
- `[ ]` `chrome_send_command_to_inject_script`
- `[ ]` `chrome_handle_download`
- `[~]` `chrome_gif_recorder`
- `[ ]` `performance_analyze_insight`
- `[ ]` `chrome_userscript`

### 4.4 Smoke and diagnostics hardening

- `[x]` `status` command works
- `[x]` `doctor` command performs real runtime checks
- `[x]` `smoke` command exists and runs
- `[~]` reduce remaining smoke tail failures
- `[~]` reduce extension error-page noise caused by test pages
- `[ ]` re-run smoke repeatedly until results are stable enough for delivery confidence

### 4.5 CoPaw integration and skill polish

- `[x]` basic CoPaw MCP connection was previously verified
- `[~]` continue validating CoPaw on upgraded `v1.0.1`
- `[ ]` verify high-value browser actions through CoPaw end-to-end
- `[~]` improve `copaw-mcp-browser` skill with more stable browser task recipes
- `[ ]` document recommended CoPaw prompts and workflows

### 4.6 Installation, docs, and beginner usability

- `[x]` stable quickstart added
- `[x]` CoPaw guide added
- `[x]` runtime verification commands documented
- `[~]` expand beginner-friendly install path
- `[~]` expand troubleshooting guide
- `[~]` expand skills usage examples
- `[ ]` make “install -> connect -> verify -> first task” smooth enough for a beginner

## 5. Highest Priority Remaining Work Tonight

1. `[ ]` finish all remaining public-tool live validation
2. `[ ]` re-run high-value actions through CoPaw `v1.0.1`
3. `[ ]` either fix or clearly document every remaining `warn`
4. `[ ]` reduce extension error-page noise to only meaningful errors
5. `[ ]` finish beginner-friendly installation and troubleshooting docs
6. `[ ]` keep updates small: every tested fix gets its own commit

## 6. Files To Check Tomorrow Morning

Review in this order:

1. [2026-04-05-phase0-tasks.md](D:\projects\ai\codex\mcp-chrome\docs\2026-04-05-phase0-tasks.md)
2. [PHASE0_TOOL_VALIDATION_MATRIX.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_TOOL_VALIDATION_MATRIX.md)
3. [STABLE_QUICKSTART.md](D:\projects\ai\codex\mcp-chrome\docs\STABLE_QUICKSTART.md)
4. [COPAW.md](D:\projects\ai\codex\mcp-chrome\docs\COPAW.md)

This file will be updated as tasks are completed.
