# Tabrix v2.7.0 Release Notes

v2.7.0 is the MKEP product-surface pruning and browser-read reliability release. It removes retired assistant/workflow/local-model surfaces, tightens Browser Hygiene around real Chrome sessions, and improves generic page-read fail-fast behavior for unreadable documents.

The release remains backward compatible for the supported MCP read/control tools except for the explicitly removed experimental surfaces listed below. The removed tools were not part of the current MKEP product boundary.

## Removed

- Removed the embedded Smart Assistant / Quick Panel / Element Picker stack from the extension and native server. Upstream AI clients remain the intended drivers.
- Removed Record-Replay / Workflow builder surfaces and the retired `run_flow` / `list_published_flows` MCP tools.
- Removed local semantic search/model surfaces including `search_tabs_content`, ONNX/WASM model assets, local vector-search dependencies, and related popup pages.
- Removed Element Marker management and Visual Editor v2 surfaces. `markedElements` remains an empty compatibility field in `chrome_read_page` responses.
- Rebuilt the sidepanel around MKEP placeholder tabs: Memory, Knowledge, and Experience.

## Fixed

- `chrome_close_tabs` now requires explicit `tabIds` or `url`; empty-argument cleanup no longer closes the active user tab.
- `read_page` and `chrome_get_web_content` now surface Chrome error pages / unreadable documents as structured `success=false`, `reason=page_unreadable`, `pageType=browser_error_page` payloads.
- Navigation/read guidance now distinguishes stale pages, readable pages, loading pages, and unreadable/error pages instead of encouraging unsafe reads.
- `read_page` can recover visible DOM/text rows when structured extraction returns no business rows, preserving a generic fallback without adding site-specific GitHub/XHS/Douyin logic.
- Production logging governance and LF line-ending enforcement were tightened to reduce CI/release drift.

## Release Gate Summary

Gate B strict PASS evidence is required before publishing this release. The release gate checks the maintainer-private real-browser benchmark report and validates API/DOM fallback behavior, operation-log writes, primary-tab reuse, latency gates, competitor deltas, and sensitive-data persistence.

Public-safe summary of the accepted Gate B contract:

- evidence kind: real MCP / real browser
- API knowledge hit rate above threshold
- read-page avoidance and token-saved counters present
- operation-log write rate above threshold
- primary tab reuse above threshold
- max concurrent benchmark tabs within limit
- competitor behind count is zero
- latency gate failures are zero
- sensitive persisted count is zero
- seed_adapter remains a transitional source lineage and is disclosed here intentionally

## Known Boundaries

- v2.7.0 does not claim arbitrary-platform API/interface reuse. API reuse remains evidence-bounded; broader observed-endpoint reuse and lifecycle sensing continue after this release.
- Same-profile browser reuse is Tabrix's primary advantage over isolated-profile browser competitors, but fallback success is not claimed as API parity.
- Private real-browser artifacts and raw benchmark JSON stay outside public docs by design.
