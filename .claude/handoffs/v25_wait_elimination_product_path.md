# v25 Wait Elimination - Product Path

## Scope

Replaced fixed waits on the normal Tabrix click/fill/keyboard product path with observable, capped waits. No version, release notes, tags, publish flow, or MCP tool surface changed.

## Replaced Waits

- `inject-scripts/click-helper.js`
  - Replaced ref scroll fixed `80ms` and selector scroll fixed `100ms`.
  - New condition: element remains connected, has finite non-zero rect, intersects viewport, and rect is stable for 2 animation frames within 1px.
  - Cap: `150ms`.
  - Diagnostics: `elementInfo.waitDiagnostics.scroll.{waitedMs,reason,ready,stableFrames}`.

- `inject-scripts/click-helper.js`
  - Replaced click verification fixed window behavior where non-navigation outcomes waited the full `400ms`.
  - New condition: `beforeunload`, URL/hash change, dialog/menu added, target state changed, or focus changed.
  - Cap: `400ms` for normal verification; `timeout` value when `waitForNavigation=true`.
  - Diagnostics: `signals.waitDiagnostics.verification.{waitedMs,reason}`.

- `entrypoints/background/tools/browser/click-verifier.ts`
  - Replaced fixed `250ms` pre-readback delay.
  - New condition: initial `chrome.tabs.get` shows URL changed or `tab.status === "complete"`, or `chrome.tabs.onUpdated` reports URL/status change.
  - Cap: `250ms`.
  - Diagnostics: `waitDiagnostics.postClickReadback.{waitedMs,reason}` on verifier results.

- `entrypoints/background/tools/browser/interaction.ts`
  - Replaced unconditional post-click new-tab drain.
  - New condition: `chrome.tabs.onCreated`, tab query delta, or page-local outcome when verifier is not requested.
  - Cap: `75ms` only for ambiguous possible `_blank` cases; `300ms` only for verifier-requested ambiguous cases.
  - Diagnostics: `waitDiagnostics.newTabObservation.{waitedMs,reason,maxMs}`.

- `inject-scripts/fill-helper.js`
  - Replaced fill scroll fixed `100ms`.
  - New condition: same connected/visible/intersecting/stable rect check as click.
  - Cap: `150ms`.
  - Diagnostics: `elementInfo.waitDiagnostics.scroll`.

- `inject-scripts/keyboard-helper.js`
  - Replaced focus fixed `50ms`.
  - New condition: `document.activeElement === element`.
  - Cap: `100ms`.
  - Diagnostics: `targetElement.waitDiagnostics.focus`.

## Benchmark Impact

Normal non-`_blank` clicks with observable page-local outcomes no longer pay a fixed background drain. The remaining caps affect only ambiguous cases where no page-local signal or tab event/query delta proves the outcome before the cap.

The existing double-click sequencing timer and caller-specified keyboard inter-key delay were not changed because they are action semantics, not the fixed waits listed in the v25 benchmark-speed issue.

## Validation

- `pnpm -C "E:\projects\AI\codex\main_tabrix\app\chrome-extension" exec vitest run tests/click-contract.test.ts tests/click-verifier.test.ts tests/injected-wait-helpers.test.ts` - passed, 49 tests.
- `pnpm -r typecheck` - passed.
- `pnpm -C "E:\projects\AI\codex\main_tabrix\app\chrome-extension" test -- --runInBand` - passed, 48 files / 411 tests.
- `git diff --check` - passed.

## Not Run

- No real browser benchmark.
- No tag, publish, or release-note final-value update.

## Commit And Push

- Commit SHA: same commit; exact SHA reported in final handoff because embedding a commit's own final SHA changes the SHA.
- Push status: reported in final handoff after `git push`.
