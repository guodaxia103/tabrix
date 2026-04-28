export const TOOL_NAMES = {
  BROWSER: {
    GET_WINDOWS_AND_TABS: 'get_windows_and_tabs',
    NAVIGATE: 'chrome_navigate',
    SCREENSHOT: 'chrome_screenshot',
    CLOSE_TABS: 'chrome_close_tabs',
    SWITCH_TAB: 'chrome_switch_tab',
    WEB_FETCHER: 'chrome_get_web_content',
    CLICK: 'chrome_click_element',
    FILL: 'chrome_fill_or_select',
    REQUEST_ELEMENT_SELECTION: 'chrome_request_element_selection',
    GET_INTERACTIVE_ELEMENTS: 'chrome_get_interactive_elements',
    NETWORK_CAPTURE: 'chrome_network_capture',
    // Legacy tool names (kept for internal use, not exposed in TOOL_SCHEMAS)
    NETWORK_CAPTURE_START: 'chrome_network_capture_start',
    NETWORK_CAPTURE_STOP: 'chrome_network_capture_stop',
    NETWORK_REQUEST: 'chrome_network_request',
    NETWORK_DEBUGGER_START: 'chrome_network_debugger_start',
    NETWORK_DEBUGGER_STOP: 'chrome_network_debugger_stop',
    KEYBOARD: 'chrome_keyboard',
    HISTORY: 'chrome_history',
    BOOKMARK_SEARCH: 'chrome_bookmark_search',
    BOOKMARK_ADD: 'chrome_bookmark_add',
    BOOKMARK_DELETE: 'chrome_bookmark_delete',
    INJECT_SCRIPT: 'chrome_inject_script',
    SEND_COMMAND_TO_INJECT_SCRIPT: 'chrome_send_command_to_inject_script',
    JAVASCRIPT: 'chrome_javascript',
    CONSOLE: 'chrome_console',
    FILE_UPLOAD: 'chrome_upload_file',
    READ_PAGE: 'chrome_read_page',
    COMPUTER: 'chrome_computer',
    HANDLE_DIALOG: 'chrome_handle_dialog',
    HANDLE_DOWNLOAD: 'chrome_handle_download',
    USERSCRIPT: 'chrome_userscript',
    PERFORMANCE_START_TRACE: 'performance_start_trace',
    PERFORMANCE_STOP_TRACE: 'performance_stop_trace',
    PERFORMANCE_ANALYZE_INSIGHT: 'performance_analyze_insight',
    GIF_RECORDER: 'chrome_gif_recorder',
  },
  RECORD_REPLAY: {
    FLOW_RUN: 'record_replay_flow_run',
    LIST_PUBLISHED: 'record_replay_list_published',
  },
  /**
   * MKEP Experience layer (Stage 3b). Native-handled tools (no Chrome
   * extension round-trip) — the native-server reads its own SQLite and
   * answers directly. See `mcp/native-tool-handlers.ts`.
   */
  EXPERIENCE: {
    SUGGEST_PLAN: 'experience_suggest_plan',
    /**
     * V24-01: write/execute path. Replays a NAMED `actionPathId`
     * previously recorded in `experience_action_paths`. Bridged tool
     * — calls `chrome_click_element` / `chrome_fill_or_select` through
     * the existing per-step Policy + verifier dispatch. Capability-gated
     * by `experience_replay`. SoT: `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md`.
     */
    REPLAY: 'experience_replay',
    /**
     * V24-02: per-step replay outcome write-back. Records one
     * (success | failure) observation against the named action path,
     * keyed by `(actionPathId, stepIndex)`. Native-handled, gated by
     * the same `experience_replay` capability so the score-step
     * channel is always governed by the capability that controls the
     * replay tool itself. SoT: `.claude/TABRIX_V2_4_0_PLAN.md` §V24-02.
     */
    SCORE_STEP: 'experience_score_step',
  },
  /**
   * MKEP context selector (Stage 3h, B-018 v1 minimal slice).
   * Native-handled. See `app/native-server/src/mcp/choose-context.ts`
   * and `docs/B_018_CONTEXT_SELECTOR_V1.md` for the SoT.
   */
  CONTEXT: {
    CHOOSE: 'tabrix_choose_context',
    /**
     * V23-04 / B-018 v1.5 outcome write-back. Pure-INSERT P0 tool that
     * lets the upstream caller close the loop on "did the strategy
     * `tabrix_choose_context` returned actually save us a `read_page`?".
     */
    RECORD_OUTCOME: 'tabrix_choose_context_record_outcome',
  },
};
