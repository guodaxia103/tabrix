# Third-Party Reuse Matrix

Last updated: `2026-04-15 Asia/Shanghai`
Scope: repository-level rules for third-party code, dependencies, and design references in `Tabrix`

This matrix answers one practical question: before using an external project, decide whether it is a direct dependency candidate, a rewrite reference, or design-only. A permissive license does not automatically mean we should import the whole framework.

Related documents:

- [Third-Party Reuse Workflow](./THIRD_PARTY_REUSE_WORKFLOW.md)
- [第三方复用工作流](./THIRD_PARTY_REUSE_WORKFLOW_zh.md)
- [`NOTICE`](../NOTICE)

## Quick Rules

- `Direct dependency / shipped third-party code`: only after checking the exact package or target path license; update `NOTICE` and a source record.
- `Rewrite after reference`: ideas and structure may inform the implementation, but restricted code must not be copied; update a source record.
- `Design-only`: `AGPL`, commercial, or unclear licensing stays out of Tabrix code.

## Reuse Matrix

| Project | License | Relationship to Tabrix | Classification | Allowed | Forbidden | Recommended landing area |
| --- | --- | --- | --- | --- | --- | --- |
| [playwright-mcp](https://github.com/microsoft/playwright-mcp) | Apache-2.0 | Closest reference for MCP browser tool contracts, structured snapshots, and extension bridging | Partial reuse / dependency candidate | Reuse tool-contract ideas, bridge patterns, locator/assertion design; future source/package reuse must keep Apache notices and `NOTICE` obligations | Do not replace the Tabrix runtime with it; do not copy Apache code without attribution and modified-file notices | `snapshot`, `locator`, assertion contracts, approval/token flow |
| [rrweb](https://github.com/rrweb-io/rrweb) | MIT | Best fit for replay artifacts, DOM snapshots, and failure replay UI | Preferred direct dependency candidate | Future direct dependency or local reuse is allowed with MIT attribution retained | Do not create a parallel storage system detached from `record-replay v3`; do not record every session by default | Failure replay artifacts, DOM/mutation debug evidence, replay UI |
| [stagehand](https://github.com/browserbase/stagehand) | MIT | Strong reference for URL Experience Memory, self-healing, and action caching, but not a runtime fit | Design/implementation reference only for now | Rewrite caching, self-healing, and `act/extract/agent` ideas locally; direct package use would need a separate package/runtime check | Do not embed the whole Stagehand framework; do not make Browserbase-oriented runtime a default Tabrix dependency | URL Experience Memory hit, fallback, and healing strategies |
| [browser-use](https://github.com/browser-use/browser-use) | MIT | Useful for DOM serializer, enhanced snapshot, and variable-detection ideas | Design/implementation reference only for now | Rewrite the serializer and extraction ideas in TypeScript; direct package use would need a specific package/distribution review | Do not import the Python agent loop; do not move core DOM processing into Python | Action-oriented JSON tree, variable extraction, long-lived session UX |
| [selenium-ide](https://github.com/SeleniumHQ/selenium-ide) | Apache-2.0 | Selector ranking, fallback chains, and record/playback heuristics improve stability | Design reference, partial reuse possible | Reuse selector ranking and fallback ideas; isolated Apache-2.0 code may be evaluated later with attribution | Do not bundle the full IDE/export runtime; do not copy code without attribution | `fingerprint`, `fallbackChain`, site-level locator ranking |
| [openreplay](https://github.com/openreplay/openreplay) | Mixed: default AGPL-3.0, some MIT directories, separate `ee/` license | Good product reference for observability, privacy defaults, and session replay shape | Design-only | Product ideas and information architecture only; any future MIT subdirectory reuse would require a separate path-level review | Do not treat the repo as a general code source; do not import AGPL or `ee/` code | Failure observability panels, privacy-by-default ideas |
| [automa](https://github.com/AutomaApp/automa) | Mixed: AGPL or Automa Commercial License | Useful workflow-builder inspiration, not a safe code source | Design-only | Product-shape reference only | Do not copy repo code; do not import AGPL/commercial code | Long-term workflow UX inspiration, not current implementation |

## Current Bottom Line

### Direct dependency or local source candidates

- `playwright-mcp`
- `rrweb`
- `selenium-ide`

### Better treated as rewrite references in the current phase

- `stagehand`
- `browser-use`

### Not allowed as direct code sources

- `openreplay`
- `automa`

## Boundary Notes

- If repository and published package licenses differ, re-evaluate based on the exact shipped package or target path before merging anything.
- If the repo is permissive but a target subdirectory or subpackage has different terms, the target path wins.
- Pure product/design inspiration does not update `NOTICE`, but it still requires a source record such as `docs/third-party/<project>.md`.

## License Sources

- [playwright-mcp LICENSE](https://github.com/microsoft/playwright-mcp/blob/main/LICENSE)
- [stagehand LICENSE](https://github.com/browserbase/stagehand/blob/main/LICENSE)
- [browser-use LICENSE](https://github.com/browser-use/browser-use/blob/main/LICENSE)
- [rrweb LICENSE](https://github.com/rrweb-io/rrweb/blob/master/LICENSE)
- [selenium-ide LICENSE](https://github.com/SeleniumHQ/selenium-ide/blob/trunk/LICENSE)
- [openreplay LICENSE](https://github.com/openreplay/openreplay/blob/main/LICENSE)
- [automa LICENSE.txt](https://github.com/AutomaApp/automa/blob/main/LICENSE.txt)
