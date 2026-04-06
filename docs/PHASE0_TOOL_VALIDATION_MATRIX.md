# Phase 0 Tool Validation Matrix

This matrix tracks real-environment validation for all exposed Chrome MCP tools.

Status legend:

- `pending`: not yet validated in a live environment
- `pass`: validated successfully in live browser/MCP flow
- `warn`: works with caveats or partial validation
- `fail`: reproduced bug or unstable behavior

## Browser Core

| Tool                              | Category     | Live MCP | CoPaw   | Notes                                                                            |
| --------------------------------- | ------------ | -------- | ------- | -------------------------------------------------------------------------------- |
| `get_windows_and_tabs`            | windows/tabs | pass     | pass    | Verified against real Chrome windows and tabs in MCP and CoPaw                   |
| `chrome_navigate`                 | navigation   | pass     | pass    | Localhost/new-window navigation verified in MCP and CoPaw                        |
| `chrome_switch_tab`               | navigation   | pass     | pending | Verified in smoke and direct MCP                                                 |
| `chrome_close_tabs`               | navigation   | pass     | pending | Verified by smoke cleanup                                                        |
| `chrome_read_page`                | page-read    | pass     | warn    | Verified on smoke page; CoPaw degrades on `chrome://` and sparse localhost pages |
| `chrome_get_web_content`          | page-read    | pass     | pass    | Verified via smoke and CoPaw using selector-targeted content extraction          |
| `chrome_get_interactive_elements` | page-read    | pending  | pending |                                                                                  |
| `search_tabs_content`             | page-read    | pending  | pending |                                                                                  |

## Interaction

| Tool                               | Category    | Live MCP | CoPaw   | Notes                                                                                    |
| ---------------------------------- | ----------- | -------- | ------- | ---------------------------------------------------------------------------------------- |
| `chrome_click_element`             | interaction | pass     | pending | Verified on smoke page                                                                   |
| `chrome_fill_or_select`            | interaction | pass     | pending | Verified on text/select/checkbox                                                         |
| `chrome_keyboard`                  | interaction | pass     | pending | Verified on text input                                                                   |
| `chrome_computer`                  | interaction | pass     | pending | Screenshot action verified; more actions pending                                         |
| `chrome_handle_dialog`             | interaction | warn     | pending | Page result verified in smoke; tool may race with prompt auto-resolution on simple pages |
| `chrome_request_element_selection` | interaction | pending  | pending | Human-in-the-loop flow to validate manually                                              |

## Network / Console / JS

| Tool                                   | Category    | Live MCP | CoPaw   | Notes                                     |
| -------------------------------------- | ----------- | -------- | ------- | ----------------------------------------- |
| `chrome_network_capture`               | network     | pass     | pending | Verified local fetch capture              |
| `chrome_network_request`               | network     | pass     | pending | Verified direct request to smoke endpoint |
| `chrome_console`                       | diagnostics | pass     | pending | Buffer mode verified                      |
| `chrome_javascript`                    | diagnostics | pass     | pending | Verified DOM reads                        |
| `chrome_inject_script`                 | diagnostics | pending  | pending |                                           |
| `chrome_send_command_to_inject_script` | diagnostics | pending  | pending |                                           |

## Files / Media

| Tool                     | Category | Live MCP | CoPaw   | Notes                                               |
| ------------------------ | -------- | -------- | ------- | --------------------------------------------------- |
| `chrome_screenshot`      | media    | pass     | pending | Verified in smoke                                   |
| `chrome_upload_file`     | files    | pass     | pending | Verified with temp file upload                      |
| `chrome_handle_download` | files    | pending  | pending |                                                     |
| `chrome_gif_recorder`    | media    | warn     | pending | Status query verified; recording path still pending |

## Bookmarks / History

| Tool                     | Category     | Live MCP | CoPaw   | Notes                       |
| ------------------------ | ------------ | -------- | ------- | --------------------------- |
| `chrome_history`         | browser-data | pass     | pending | Verified query path         |
| `chrome_bookmark_search` | browser-data | pass     | pending | Verified after add          |
| `chrome_bookmark_add`    | browser-data | pass     | pending | Verified with temp bookmark |
| `chrome_bookmark_delete` | browser-data | pass     | pending | Verified with temp bookmark |

## Performance / Advanced

| Tool                          | Category    | Live MCP | CoPaw   | Notes              |
| ----------------------------- | ----------- | -------- | ------- | ------------------ |
| `performance_start_trace`     | performance | pass     | pending | Verified via smoke |
| `performance_stop_trace`      | performance | pass     | pending | Verified via smoke |
| `performance_analyze_insight` | performance | pending  | pending |                    |
| `chrome_userscript`           | advanced    | pending  | pending |                    |

## Validation Goals

Before Phase 0 is considered complete:

1. Every public tool must have a live-MCP result.
2. High-value tools must also be re-validated through CoPaw.
3. Any `warn` or `fail` entry must link to a concrete issue, code fix, or documented limitation.
