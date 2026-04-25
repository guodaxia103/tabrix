# v25 Wait Elimination P1 Follow-up

## Scope

Main repo only. This follow-up tightens the observable-wait semantics from `c6617cc` without changing version, release notes, tags, publish flow, MCP tools, or private benchmark runners.

## P1 Fixes

1. `click-helper.js` navigation intent cannot finish on focus-only changes
   - `waitForNavigation=true` now excludes `focus_changed` from the early-exit predicate.
   - Strong early exits remain: `beforeunload`, URL/hash change, dialog/menu opened, and target state change.
   - `focusChanged` is still recorded in final `signals`, and `waitForNavigation=false` still allows focus as a weak fast-click outcome.

2. `interaction.ts` verifier path no longer waits the cap when page-local strong outcome is already known
   - `observeNewTabUntil()` now distinguishes strong page outcomes from weak focus-only outcomes.
   - `verifierRequested=true` can finalize on `page_strong_outcome_observed`.
   - `focusChanged` alone is still ignored in verifier mode and falls through to `ambiguous_cap_elapsed` unless a tab event/query delta appears.

3. `click-verifier.ts` initial complete tab is not post-click readiness
   - Initial `chrome.tabs.get()` returns ready only for URL changes or tab unavailability.
   - `tab_complete` can only come from a post-click `chrome.tabs.onUpdated` event.
   - Timeout now returns `reason:"timeout"` and carries the latest available tab snapshot into readback instead of throwing.

## Test Coverage

- `waitForNavigation=true + focus only` waits to timeout and records focus only in final signals.
- `waitForNavigation=false + focus only` still returns early with `focus_changed`.
- `waitForNavigation=true` returns early for hash, `beforeunload`, and target-state changes.
- `verifierRequested=true + URL changed` returns `page_strong_outcome_observed` without waiting the cap.
- `verifierRequested=true + focus only` waits until `ambiguous_cap_elapsed`.
- `verifierRequested=false + weak page outcome` still finalizes quickly.
- `waitForPostClickReadbackReady()` rejects initial unchanged `complete`, accepts `onUpdated` complete, accepts initial URL change, and returns timeout with a tab snapshot.

## Validation

- `pnpm -C app/chrome-extension test -- --runInBand tests/click-contract.test.ts tests/click-verifier.test.ts tests/injected-wait-helpers.test.ts` - passed. The current script invocation ran the full extension suite: 48 files / 421 tests.
- `pnpm -r typecheck` - passed.
- `git diff --check` - passed.

## Not Run

- No real MCP/browser benchmark.
- No tag, publish, version bump, release notes, or private test repo changes.

## Remaining Risk

- Ambiguous verifier clicks with no strong page-local outcome and no new-tab signal still use the existing max cap as fallback.
- Real site timing still needs owner-lane real benchmark evidence before making release-readiness claims.

## Commit And Push

- Commit SHA: same commit; exact SHA is reported in the final task summary because embedding the commit's own final SHA would change the SHA.
- Push status: reported in the final task summary after push attempt.
