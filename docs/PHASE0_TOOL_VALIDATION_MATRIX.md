# Phase 0 Tool Validation Matrix

This matrix tracks real-environment validation for all exposed Chrome MCP tools.

Status legend:

- `pending`: not yet validated in a live environment
- `pass`: validated successfully in live browser/MCP flow
- `warn`: works with caveats or partial validation
- `fail`: reproduced bug or unstable behavior

## Browser Core

| Tool                              | Category     | Live MCP | CoPaw   | Notes                                                                                      |
| --------------------------------- | ------------ | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `get_windows_and_tabs`            | windows/tabs | pass     | pass    | Verified against real Chrome windows and tabs in MCP and CoPaw                             |
| `chrome_navigate`                 | navigation   | pass     | pass    | Localhost/new-window navigation verified in MCP and CoPaw                                  |
| `chrome_switch_tab`               | navigation   | pass     | pending | Verified in smoke and direct MCP                                                           |
| `chrome_close_tabs`               | navigation   | pass     | pass    | Verified by smoke cleanup and CoPaw close-tab flow                                         |
| `chrome_read_page`                | page-read    | pass     | warn    | Verified on smoke page; CoPaw degrades on `chrome://` and sparse localhost pages           |
| `chrome_get_web_content`          | page-read    | pass     | pass    | Verified via smoke and CoPaw using selector-targeted content extraction                    |
| `chrome_get_interactive_elements` | page-read    | warn     | pending | Deprecated and not exposed in current tools/list; `chrome_read_page` is the supported path |
| `search_tabs_content`             | page-read    | fail     | pending | Documented in shared schema but not exposed by the current MCP tools/list response         |

## Interaction

| Tool                               | Category    | Live MCP | CoPaw   | Notes                                                                                      |
| ---------------------------------- | ----------- | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `chrome_click_element`             | interaction | pass     | pass    | Verified on smoke page and direct CoPaw interaction flow                                   |
| `chrome_fill_or_select`            | interaction | pass     | pass    | Verified on text/select/checkbox and direct CoPaw interaction flow                         |
| `chrome_keyboard`                  | interaction | pass     | warn    | CoPaw direct test shows it treats full text as invalid key-string input                    |
| `chrome_computer`                  | interaction | pass     | pending | Screenshot action verified; more actions pending                                           |
| `chrome_handle_dialog`             | interaction | warn     | pending | Page result verified in smoke; tool may race with prompt auto-resolution on simple pages   |
| `chrome_request_element_selection` | interaction | warn     | pending | Validated that the picker session starts and returns a structured timeout result after 10s |

## Network / Console / JS

| Tool                     | Category    | Live MCP | CoPaw   | Notes                                     |
| ------------------------ | ----------- | -------- | ------- | ----------------------------------------- |
| `chrome_network_capture` | network     | pass     | pending | Verified local fetch capture              |
| `chrome_network_request` | network     | pass     | pending | Verified direct request to smoke endpoint |
| `chrome_console`         | diagnostics | pass     | pending | Buffer mode verified                      |
| `chrome_javascript`      | diagnostics | pass     | pending | Verified DOM reads                        |

## Files / Media

| Tool                     | Category | Live MCP | CoPaw   | Notes                                                               |
| ------------------------ | -------- | -------- | ------- | ------------------------------------------------------------------- |
| `chrome_screenshot`      | media    | pass     | warn    | Verified in smoke; CoPaw direct runtime hit `image readback failed` |
| `chrome_upload_file`     | files    | pass     | pending | Verified with temp file upload                                      |
| `chrome_handle_download` | files    | pass     | pending | Verified against a real local download and completion wait          |
| `chrome_gif_recorder`    | media    | warn     | pending | Status query verified; recording path still pending                 |

## Bookmarks / History

| Tool                     | Category     | Live MCP | CoPaw   | Notes                       |
| ------------------------ | ------------ | -------- | ------- | --------------------------- |
| `chrome_history`         | browser-data | pass     | pending | Verified query path         |
| `chrome_bookmark_search` | browser-data | pass     | pending | Verified after add          |
| `chrome_bookmark_add`    | browser-data | pass     | pending | Verified with temp bookmark |
| `chrome_bookmark_delete` | browser-data | pass     | pending | Verified with temp bookmark |

## Performance / Advanced

| Tool                          | Category    | Live MCP | CoPaw   | Notes                                                                     |
| ----------------------------- | ----------- | -------- | ------- | ------------------------------------------------------------------------- |
| `performance_start_trace`     | performance | pass     | pending | Verified via smoke                                                        |
| `performance_stop_trace`      | performance | pass     | pending | Verified via smoke                                                        |
| `performance_analyze_insight` | performance | pass     | pending | Validated after adding fallback to the most recent recorded trace result  |
| `chrome_userscript`           | advanced    | fail     | pending | Documented in shared schema but not exposed by the current MCP tools/list |

## Non-exposed / Backward-Compat Surface

These names exist in shared schemas or extension code, but are not currently exposed by the active `tools/list` response. They should not block Phase 0 public-surface completion once documented clearly.

| Tool                                   | Status | Notes                                                                     |
| -------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `search_tabs_content`                  | fail   | Mentioned in docs/shared schema, but not returned by current `tools/list` |
| `chrome_get_interactive_elements`      | warn   | Deprecated in favor of `chrome_read_page`                                 |
| `chrome_inject_script`                 | fail   | Current bridge returns disabled/unavailable when called directly          |
| `chrome_send_command_to_inject_script` | fail   | Current bridge returns disabled/unavailable when called directly          |
| `chrome_userscript`                    | fail   | Mentioned in shared schema, but not returned by current `tools/list`      |

## Validation Goals

Before Phase 0 is considered complete:

1. Every public tool in the active `tools/list` surface must have a live-MCP result.
2. High-value tools must also be re-validated through CoPaw.
3. Any `warn` or `fail` entry must link to a concrete issue, code fix, or documented limitation.
