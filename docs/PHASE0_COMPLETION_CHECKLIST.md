# Phase 0 Completion Checklist

Last updated: `2026-04-06 19:10 Asia/Shanghai`

This checklist defines the hard acceptance gate for **Phase 0**.

Phase 0 is **not complete** until all items below are either:

- marked complete, or
- explicitly moved out of scope with written justification

## Goal 0: Stable, Deliverable Product

- [x] Unpacked extension uses a stable local key and no longer drifts across browser restarts
- [x] Native host registration points to the current local build output
- [x] `doctor` reports `connectivity`, `runtime.status`, and `mcp.initialize` as healthy
- [x] `smoke --json` passes end-to-end
- [x] Remaining known caveats are either fixed or documented as explicit limits
- [x] Install, reconnect, reload, and recovery flow is stable enough for handoff

## Goal 1: All `mcp-chrome` Public Tools Live-Tested

- [x] Core navigation tools verified
- [x] Core interaction tools verified
- [x] Core network/console/js tools verified
- [x] Core browser-data tools verified
- [x] Core screenshot/upload/trace tools verified
- [x] Every public tool in the active `tools/list` surface now has a live validation result
- [x] Hidden or deprecated tools are explicitly classified and not left ambiguous:
  - `search_tabs_content`
  - `chrome_get_interactive_elements`
  - `chrome_inject_script`
  - `chrome_send_command_to_inject_script`
  - `chrome_userscript`
- [x] Remaining `warn` tools are documented as explicit limitations:
  - `chrome_handle_dialog`
  - `chrome_gif_recorder`
  - `chrome_read_page` caveat cases

Source of truth:

- [PHASE0_TOOL_VALIDATION_MATRIX.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_TOOL_VALIDATION_MATRIX.md)

## Goal 2: CoPaw Full Validation + Better Skill

- [x] CoPaw loads `streamable-mcp-server`
- [x] CoPaw lists tools successfully
- [x] CoPaw validates high-value read/navigation flows
- [x] CoPaw validates click/fill/close-tab interaction flows
- [ ] CoPaw validates more interaction tools:
  - keyboard
  - screenshot
  - bookmark/history where practical
- [x] CoPaw-specific caveats documented clearly
- [x] `copaw-mcp-browser` skill upgraded with:
  - stronger prompt templates
  - fallback rules
  - failure recovery guidance
  - preferred tool order for common browser tasks

Primary references:

- [COPAW.md](D:\projects\ai\codex\mcp-chrome\docs\COPAW.md)
- [copaw-mcp-browser SKILL](C:\Users\guo.codex\skills\copaw-mcp-browser\SKILL.md)

## Goal 3: Beginner-Friendly Install and Usage Manual

- [x] Base quickstart exists
- [x] Windows installation guide exists
- [x] CoPaw integration guide exists
- [x] Final beginner handoff package is polished:
  - one short install path
  - one short validation path
  - reconnect/reload instructions
  - Chrome restart persistence notes
  - common failure FAQ
  - first-task walkthrough
- [x] Handoff docs are consistent with the latest code and latest browser behavior

Primary references:

- [STABLE_QUICKSTART.md](D:\projects\ai\codex\mcp-chrome\docs\STABLE_QUICKSTART.md)
- [WINDOWS_INSTALL_zh.md](D:\projects\ai\codex\mcp-chrome\docs\WINDOWS_INSTALL_zh.md)
- [PILOT_INSTALL_CHECKLIST.md](D:\projects\ai\codex\mcp-chrome\docs\PILOT_INSTALL_CHECKLIST.md)

## Current Phase 0 Finish Definition

Phase 0 can be called **stable and deliverable** only when:

1. browser install/restart/connect path is stable
2. all public tools have a live validation result
3. CoPaw has completed a high-value browser retest set
4. docs are good enough for a beginner handoff
