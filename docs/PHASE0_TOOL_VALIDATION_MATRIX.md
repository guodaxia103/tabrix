# Phase 0 Tool Validation Matrix

This matrix tracks real-environment validation for all exposed Chrome MCP tools.

Status legend:

- `pending`: not yet validated in a live environment
- `pass`: validated successfully in live browser/MCP flow
- `warn`: works with caveats or partial validation
- `fail`: reproduced bug or unstable behavior

## Browser Core

| Tool                              | Category     | Live MCP | CoPaw   | Notes                                                                                       |
| --------------------------------- | ------------ | -------- | ------- | ------------------------------------------------------------------------------------------- |
| `get_windows_and_tabs`            | windows/tabs | pass     | pass    | Verified against real Chrome windows and tabs in MCP, CoPaw runtime, and CoPaw chat history |
| `chrome_navigate`                 | navigation   | pass     | pass    | Localhost/new-window navigation verified in MCP and CoPaw                                   |
| `chrome_switch_tab`               | navigation   | pass     | pass    | Verified in smoke, direct MCP, and CoPaw                                                    |
| `chrome_close_tabs`               | navigation   | pass     | pass    | Verified by smoke cleanup and CoPaw close-tab flow                                          |
| `chrome_read_page`                | page-read    | pass     | warn    | Verified on smoke page; CoPaw degrades on `chrome://` and sparse localhost pages            |
| `chrome_get_web_content`          | page-read    | pass     | pass    | Verified via smoke, CoPaw runtime, and CoPaw chat-visible `#result` extraction              |
| `chrome_get_interactive_elements` | page-read    | warn     | pending | 当前仍在 tools/list 中暴露；新流程优先使用 `chrome_read_page`，后续可再评估收敛             |
| `search_tabs_content`             | page-read    | fail     | pending | Documented in shared schema but not exposed by the current MCP tools/list response          |

## Interaction

| Tool                               | Category    | Live MCP | CoPaw | Notes                                                                                                        |
| ---------------------------------- | ----------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `chrome_click_element`             | interaction | pass     | pass  | Verified on smoke page, direct CoPaw interaction flow, and CoPaw chat-visible submit click                   |
| `chrome_fill_or_select`            | interaction | pass     | pass  | Verified on text/select/checkbox and direct CoPaw interaction flow; CoPaw chat path needed JS fallback once  |
| `chrome_keyboard`                  | interaction | pass     | warn  | CoPaw direct test shows it treats full text as invalid key-string input                                      |
| `chrome_computer`                  | interaction | pass     | pass  | Screenshot action verified directly and through `chrome_computer`                                            |
| `chrome_handle_dialog`             | interaction | warn     | warn  | Page result verified in smoke; direct call on a page without an active dialog returns `No dialog is showing` |
| `chrome_request_element_selection` | interaction | warn     | warn  | Picker session starts and returns a structured timeout result; this is expected without human selection      |

## Network / Console / JS

| Tool                     | Category    | Live MCP | CoPaw   | Notes                                                   |
| ------------------------ | ----------- | -------- | ------- | ------------------------------------------------------- |
| `chrome_network_capture` | network     | pass     | pending | Verified local fetch capture                            |
| `chrome_network_request` | network     | pass     | pass    | Verified direct request in MCP and CoPaw                |
| `chrome_console`         | diagnostics | pass     | pass    | Buffer mode verified in MCP and direct CoPaw validation |
| `chrome_javascript`      | diagnostics | pass     | pass    | Verified DOM reads in MCP and CoPaw                     |

## Files / Media

| Tool                     | Category | Live MCP | CoPaw   | Notes                                                                                                 |
| ------------------------ | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `chrome_screenshot`      | media    | pass     | warn    | Verified in smoke; CoPaw direct runtime hit `image readback failed`                                   |
| `chrome_upload_file`     | files    | pass     | pass    | Verified with temp file upload in MCP and direct CoPaw validation                                     |
| `chrome_handle_download` | files    | pass     | pending | Verified against a real local download and completion wait                                            |
| `chrome_gif_recorder`    | media    | warn     | warn    | `status` and `start` succeed; simple `start -> stop` flow can still return `No recording in progress` |

## Bookmarks / History

| Tool                     | Category     | Live MCP | CoPaw | Notes                                                                     |
| ------------------------ | ------------ | -------- | ----- | ------------------------------------------------------------------------- |
| `chrome_history`         | browser-data | pass     | pass  | Verified query path in MCP, CoPaw runtime, and CoPaw chat-visible session |
| `chrome_bookmark_search` | browser-data | pass     | pass  | Verified after add in MCP, CoPaw runtime, and CoPaw chat-visible session  |
| `chrome_bookmark_add`    | browser-data | pass     | pass  | Verified with temp bookmark in MCP and CoPaw                              |
| `chrome_bookmark_delete` | browser-data | pass     | pass  | Verified with temp bookmark in MCP and CoPaw                              |

## Performance / Advanced

| Tool                          | Category    | Live MCP | CoPaw   | Notes                                                                     |
| ----------------------------- | ----------- | -------- | ------- | ------------------------------------------------------------------------- |
| `performance_start_trace`     | performance | pass     | pass    | Verified via smoke and direct CoPaw validation                            |
| `performance_stop_trace`      | performance | pass     | pass    | Verified via smoke and direct CoPaw validation                            |
| `performance_analyze_insight` | performance | pass     | pending | Validated after adding fallback to the most recent recorded trace result  |
| `chrome_userscript`           | advanced    | fail     | pending | Documented in shared schema but not exposed by the current MCP tools/list |

## Non-exposed / Backward-Compat Surface

These names exist in shared schemas or extension code, but are not currently exposed by the active `tools/list` response. They should not block Phase 0 public-surface completion once documented clearly.

| Tool                                   | Status | Notes                                                                     |
| -------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `search_tabs_content`                  | fail   | Mentioned in docs/shared schema, but not returned by current `tools/list` |
| `chrome_get_interactive_elements`      | warn   | 当前仍对外暴露，建议新流程优先使用 `chrome_read_page`                     |
| `chrome_inject_script`                 | fail   | Current bridge returns disabled/unavailable when called directly          |
| `chrome_send_command_to_inject_script` | fail   | Current bridge returns disabled/unavailable when called directly          |
| `chrome_userscript`                    | fail   | Mentioned in shared schema, but not returned by current `tools/list`      |

## Validation Goals

Before Phase 0 is considered complete:

1. Every public tool in the active `tools/list` surface must have a live-MCP result.
2. High-value tools must also be re-validated through CoPaw.
3. Any `warn` or `fail` entry must link to a concrete issue, code fix, or documented limitation.
