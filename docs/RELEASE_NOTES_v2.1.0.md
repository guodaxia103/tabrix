# Tabrix v2.1.0 Release Notes

Release date: 2026-04-20

## Summary

v2.1.0 is the first minor release on the 2.x line. It delivers the T5.4
high-value object pipeline in `read_page`, promoting the real Chrome ->
read -> understand -> act loop from T5.0 task-mode awareness all the way
to T5.4 four-layer object extraction.

The release is backward compatible with v2.0.x. All new fields on
`ReadPageHighValueObject` are additive and optional; the legacy `kind` /
`reason` contract continues to be emitted and is still usable by older
MCP clients.

## Highlights

### T5.4: Four-layer high-value object pipeline

`read_page` now returns a structured high-value object layer alongside
the existing candidate list. Each object carries:

- `objectType` (one of `nav_entry` / `record` / `control` / `status_item`
  / `entry` / ...)
- `region` (coarse page region tag)
- `importance` (0..1 confidence-weighted score)
- `reasons` (multi-step explainability; why this object was promoted)
- `actions` (legacy `kind` / `reason` still emitted for compatibility)
- `sourceKind` (whether the object came from a DOM ref, a candidate
  action, or a page-role seed)

The pipeline is split into neutral core logic plus a GitHub family
adapter, so adding additional family adapters in the future does not
require touching the core scoring path. See
`app/chrome-extension/entrypoints/background/tools/browser/read-page-high-value-objects-core.ts`.

### Neutral noise downranking

Commit hashes, timing durations, commitlint-style prefixes, overly
long labels, and site-shell wording (watch/star/pin, "Search or jump
to...", "Open Copilot...", "Skip to content", footer links on GitHub)
are now consistently downranked so the first object on a page is the
one an assistant would actually want to act on.

### Continued: recovery & diagnostics

Everything shipped in v2.0.8 / v2.0.9 — browser executable detection,
unified status / doctor / report / bridge-recovery semantics, real
browser auto-recovery on bridge-degraded paths — still applies in
v2.1.0. No behavior regressions in any of those subsystems.

## Acceptance Evidence

This release was verified end-to-end by the maintainer-held full-chain
real-browser acceptance suite.

- Suite: `T5_FULLCHAIN_REAL_BROWSER_ACCEPTANCE` (15 scenarios across
  Groups A / B / C / D / E)
- Groups:
  - A (environment health): runtime-consistency with 4-state classification
  - B (legacy core action chain): real `chrome_navigate` +
    `chrome_read_page` + `chrome_click_element` + `chrome_screenshot`
    against a public GitHub repo
  - C (T5 understanding chain): bridged through `pnpm t4:github-baseline`
  - D (compatibility chain): T5 `highValueObjects.ref` clicked via the
    legacy `chrome_click_element` tool; legacy + T5.4 fields coexist
    on the same object
  - E (recovery chain): `tabrix doctor --json` idempotency + post-doctor
    understanding replay
- Result: **15 / 15 scenarios passed, `productLevelReady: true`**
- Verdicts: `legacyCorePassed: true`, `t5UnderstandingPassed: true`,
  `compatibilityPassed: true`, `recoveryCompatibilityPassed: true`

The acceptance suite and its evidence are intentionally kept outside
this public repository (see `AGENTS.md` §17). The commit SHA above is
the stable anchor.

## Lockstep Version Move

All first-party packages move to `2.1.0`:

- `tabrix-monorepo`
- `@tabrix/tabrix`
- `@tabrix/extension`
- `@tabrix/shared`
- `@tabrix/wasm-simd`

`@tabrix/tabrix` now depends on `@tabrix/shared@^2.1.0`.
`@tabrix/extension` keeps its `workspace:*` reference.

## Compatibility Notes

- Existing MCP clients that consume only `kind` and `reason` (singular)
  continue to work unchanged.
- Assistants that want structured object metadata should prefer the new
  fields (`objectType`, `importance`, `reasons`, `sourceKind`) over the
  legacy singular `reason` text when both are present.
- No changes to CLI / transport / diagnostics public surface.

## Upgrade

- npm: `npm install -g @tabrix/tabrix@2.1.0`
- Extension: reload the unpacked extension from `dist/` after upgrading.

## Known Non-Goals In This Release

- Real fault-injection recovery (Group E uses a non-destructive
  idempotency check instead). Tracked in the private-tests `v3`
  backlog; behind an opt-in `--enable-fault-injection` flag when it
  lands.
- Nightly CI wiring of the T5 acceptance suite.
- Extension of the acceptance model to logged-in platforms (Douyin /
  BOSS / private consoles) — those stay in their own private suites
  and are not part of this public release surface.
