# Tabrix Click Contract Repair v1

> Execution note for Codex / Claude.
>
> Purpose: fix the `chrome_click_element` false-success contract without widening scope into unrelated T6+ work.

## Why This Doc Exists

The current click path still reports tool-level success too early.

- In `app/chrome-extension/entrypoints/background/tools/browser/interaction.ts`, the tool serializes `success: true` even when `navigationOccurred` is `false`.
- In `app/chrome-extension/inject-scripts/click-helper.js`, the click helper mainly treats `beforeunload` as the navigation proof path, which is too narrow for SPA route changes, dialogs, menus, toggles, and other non-full-page click outcomes.

GitHub-specific target-selection improvements may reduce the visible symptom on some pages, but they do not repair the core click contract.

## Problem Statement

Tabrix currently mixes two different meanings:

- `dispatch succeeded`: the extension found a target and fired the click event
- `user-visible outcome succeeded`: the click produced an observable result that the caller can trust

These are not the same thing. Product-grade browser control must report verified outcome, not just dispatched input.

## Goal

Change `chrome_click_element` from a dispatch-success contract to a verified-outcome contract.

The repaired tool must let an AI caller distinguish:

- the click was dispatched
- what outcome was observed
- whether the observed outcome satisfies the action claim

## Non-Goals

This task does **not** include:

- GitHub-family ranking or locator tuning
- T5.5 / T5.6 / T6 feature expansion
- large policy-engine work
- generic replay system design
- making every possible site/action perfect in one pass

## Required Contract Change

The tool response must stop using plain `success: true` as a synonym for "the click API call returned normally".

The output should expose separate fields with stable meaning:

```json
{
  "success": false,
  "dispatchSucceeded": true,
  "observedOutcome": "no_observed_change",
  "verification": {
    "navigationOccurred": false,
    "urlChanged": false,
    "newTabOpened": false,
    "domChanged": false,
    "stateChanged": false,
    "focusChanged": false
  }
}
```

Recommended `observedOutcome` enum for v1:

- `cross_document_navigation`
- `spa_route_change`
- `hash_change`
- `new_tab_opened`
- `dialog_opened`
- `menu_opened`
- `state_toggled`
- `selection_changed`
- `dom_changed`
- `focus_changed`
- `download_intercepted`
- `no_observed_change`
- `verification_unavailable`

### Contract Rules

1. `dispatchSucceeded` means only that Tabrix found a target and dispatched the click path.
2. `success` must mean the click produced an observed, trusted outcome.
3. `success` must **not** remain `true` when `observedOutcome` is `no_observed_change`.
4. `navigationOccurred` may remain as a compatibility field for one release, but it must no longer be the only success signal.
5. If verification times out or cannot be proven, return `success: false` with a precise reason instead of optimistic success.

## Preferred Architecture

Do not solve this by adding more GitHub heuristics in `interaction.ts`.

The preferred split is:

1. `click-helper.js`
   - dispatch the click
   - collect immediate page-local evidence
   - report structured signals, not final business verdicts
2. background/browser layer
   - observe browser-level evidence such as URL/tab/navigation events
   - merge page-local and browser-level signals for the same click attempt
3. `interaction.ts`
   - orchestrate the attempt
   - apply the contract mapping
   - serialize the final tool response

If a new module is needed, prefer a focused file such as:

- `app/chrome-extension/entrypoints/background/tools/browser/click-verification.ts`

## Signals To Use

Use existing extension-native capability first. Do not jump to heavyweight re-read loops unless the cheap signals are ambiguous.

### Browser-Level Signals

- `chrome.webNavigation` committed/history events
- active tab URL change
- new tab creation / tab activation changes
- same-tab hash-only URL change

### Page-Level Signals

- `beforeunload`
- `pagehide`
- `visibilitychange`
- focused element change
- DOM mutation summary via `MutationObserver`
- control-state deltas:
  - `checked`
  - `aria-expanded`
  - `aria-selected`
  - `value`
  - `open`
  - `disabled`

### Optional Secondary Signal

If the cheap signals remain ambiguous, allow a small follow-up verification step:

- read target subtree again
- compare target state before/after

This is a fallback, not the default path.

## Outcome Mapping Guidance

### Treat as success

- same-tab cross-document navigation observed
- SPA route change observed
- hash route change observed when the click intent is route-like
- new tab opened from the click
- dialog/menu/accordion visibly opened
- checkbox/radio/select/button state changed as intended
- download was deliberately intercepted and converted into the extension-side download path

### Treat as failure

- click dispatch ran, but no observable change was detected in the verification window
- target vanished before dispatch and no alternative target was verified
- verification window ended with conflicting or incomplete evidence

### Treat as partial / explicit ambiguity

- dispatch succeeded, but verification could not be completed due to runtime interruption
- page changed too much to trust the local evidence bundle

For ambiguity, return structured failure or partial state. Do not silently upcast it to success.

## Suggested Implementation Order

1. Define the response contract in the shared serialization path.
2. Add page-local verification signals in `click-helper.js`.
3. Add browser-level verification aggregation in the background layer.
4. Merge both into a single click verdict model.
5. Keep one-release compatibility fields where needed.
6. Add tests before widening any heuristics.

## Files Expected To Change

At minimum:

- `app/chrome-extension/entrypoints/background/tools/browser/interaction.ts`
- `app/chrome-extension/inject-scripts/click-helper.js`

Likely:

- `app/chrome-extension/entrypoints/background/tools/browser/click-verification.ts`
- targeted tests under `app/chrome-extension/tests/`

## Test Matrix

This fix is not complete unless it proves both correctness and compatibility.

### Unit / Targeted Integration

Must cover at least:

- full-page navigation click
- SPA route change click
- hash change click
- new tab click
- menu or dialog open click
- checkbox or toggle click
- download interception click
- true no-op click

### Contract Regression

Must assert that the tool no longer emits this invalid combination:

```json
{
  "success": true,
  "navigationOccurred": false,
  "observedOutcome": "no_observed_change"
}
```

### Real Browser Acceptance

At least one real browser path must be rerun after the change:

- open GitHub public page
- use `chrome_read_page` to identify a real action target
- perform `chrome_click_element`
- verify the result with the new outcome fields

If real browser verification was not run, the task summary must say so explicitly.

## Acceptance Criteria

The task is done only if all of the following are true:

1. `chrome_click_element` no longer reports optimistic success on no-op clicks.
2. the tool output cleanly separates dispatch from verified outcome.
3. existing download interception behavior still works.
4. existing successful navigation clicks still report success.
5. at least one non-navigation success path is supported and tested.
6. targeted tests are green.
7. extension build is green.
8. changed browser-side code is reloaded before any runtime claim is made.

## Explicit Anti-Patterns

Do not do the following:

- do not fix this only with more GitHub-specific selectors
- do not keep `success: true` just because no exception was thrown
- do not rely only on `beforeunload`
- do not hide uncertainty behind a generic `"Element clicked successfully"` message
- do not mark the task done from source inspection alone

## Minimal Verification Commands

Use the smallest set that proves the contract change:

```powershell
pnpm -C packages/shared build
pnpm -C app/chrome-extension build
pnpm -C app/chrome-extension test --run
pnpm run extension:reload
```

Then run one real browser validation path for the changed click behavior.

## Task Summary Template

When reporting completion, use this structure:

1. What changed in the click contract
2. What observable outcomes are now detected
3. What tests were run
4. What real browser path was verified
5. What remains unsupported or ambiguous

## Definition Of Done

Tabrix can only claim this fix is complete when a caller can trust the distinction between:

- "the click was sent"
- "the click produced an observed result"

Anything weaker is still false-success risk.
