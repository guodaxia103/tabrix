# Tabrix Click V2 Product And Technical Plan

> Scope: click only.
>
> This document defines how Tabrix should evolve `chrome_click_element` into a
> product-grade capability that is more accurate, faster, more stable, and more
> token-efficient.
>
> Out of scope:
>
> - B-012 / Experience / Memory work
> - generic backlog cleanup
> - non-click browser tools unless they are directly used as click verification
> - broad T6+ planning

## 1. Problem Statement

Tabrix has already moved beyond the old "dispatch succeeded == click succeeded"
model. The next problem is more important:

> After a click is dispatched, can Tabrix prove that the user's intended target
> state was actually reached, with low latency and low token cost?

This is the real product boundary.

For product-grade browser control, a click is only useful when it answers all
of the following clearly:

1. Was the target selection correct?
2. Was the input dispatch successful?
3. What observable outcome happened?
4. Did that outcome satisfy the user goal?

If Tabrix cannot answer item 4 cheaply and reliably, it still forces the upper
layer AI to spend extra reads, retries, and tokens to rediscover the truth.

## 2. Product Goal

Tabrix Click V2 should make `chrome_click_element` the default high-trust action
primitive for real browser automation.

The target user experience is:

- More accurate: the tool can distinguish "clicked the right thing and reached
  the intended page/state" from "input fired but goal not reached".
- Faster: the tool avoids slow blind retries and long generic settle waits.
- More stable: the tool uses browser-native truth sources, not only page-local
  heuristics.
- More token-efficient: the tool returns enough structured evidence that the AI
  does not need to immediately re-read the whole page after every click.

## 3. Design Principles

### 3.1 Verified Outcome Over Dispatched Input

`dispatchSucceeded` and `success` are different facts.

- `dispatchSucceeded`: Tabrix found a target and sent the input sequence.
- `success`: the click produced an observed outcome that satisfies the action
  claim.

Tabrix must never collapse these into one field again.

### 3.2 Extension-Native Truth Sources First

Tabrix's advantage is not "we can also click". Many projects can do that.

Tabrix's advantage is:

- content-script visibility into live DOM and state transitions
- background/service-worker visibility into tab and navigation events
- access to family-aware `read_page` semantics after the click

Click V2 must use all three layers together.

### 3.3 Goal-Aware Verification Beats Generic Heuristics

Generic outcomes like `dom_changed` or `focus_changed` are useful, but they are
not the final product answer for important flows.

For high-value routes, Tabrix should verify the target state explicitly:

- repo nav click should confirm post-click `pageRole`
- workflow run click should confirm the run detail page
- workflow job click should confirm job-detail controls
- menu click should confirm the intended popup/listbox opened

### 3.4 Speed Comes From Better Proof, Not More Retries

The correct way to make click faster is:

- choose the right target once
- detect the right success signal early
- stop waiting as soon as sufficient proof exists

The wrong way is:

- more generic retries
- longer fixed settle windows
- more fallback clicks against alternative targets

## 4. Current State

Current `main` already repaired two important contract issues:

- the tool no longer treats `no_observed_change` as `success: true`
- new-tab observation is kept alive for the lifetime of the click interaction

This is necessary, but not sufficient.

Today the main remaining gap is not the old false-success bug. The gap is:

> Click outcome classification exists, but click intent satisfaction is still
> only partially modeled.

In other words, Tabrix can often say "something happened", but not always
cheaply say "the user's goal has been achieved".

## 5. Click V2 Capability Model

Click V2 should be implemented as a 4-stage pipeline.

### Stage A: Target Selection

Inputs:

- explicit `ref`
- explicit selector
- `candidateAction`
- page family metadata
- optional page-aware verifier hint

Priority:

1. explicit `ref`
2. structured target from `candidateAction`
3. selector fallback
4. coordinates only as last resort

Target selection should prefer richer targets:

- `ref`
- `href`
- `role`
- family `objectSubType`
- region alignment with `primaryRegion`

### Stage B: Dispatch

Dispatch should remain narrow and deterministic:

- one logical click attempt by default
- standard pointer/mouse/native-click sequence
- explicit double-click only when requested
- no hidden "click until something happens" loop

The dispatch layer should report:

- `dispatchSucceeded`
- `elementInfo`
- dispatch method

It should not decide product success by itself.

### Stage C: Observation

Observation should merge browser-level and page-level evidence.

Browser-level signals:

- `chrome.tabs.onCreated`
- `chrome.tabs.onUpdated`
- `chrome.webNavigation` committed/completed/history signals
- final tab URL / hash / activation change

Page-level signals:

- `beforeunload`
- URL/hash delta
- `MutationObserver`
- dialog/menu detection
- target state delta
- focus delta

Observation returns:

- `observedOutcome`
- `verification`
- raw evidence bundle for debugging

### Stage D: Goal Verifier

This is the real V2 addition.

After a valid observed outcome, Tabrix may run a lightweight verifier to decide
whether the user's goal was reached.

Verifier types:

- generic verifier
- family-aware verifier

Examples:

- `repo_home -> Issues`:
  verify `afterUrl` matches repo issues path and `pageRole === issues_list`
- `actions_list -> workflow_run_detail`:
  verify URL matches `/actions/runs/<id>` and `pageRole === workflow_run_detail`
- `workflow_run_detail -> quality job detail`:
  verify URL matches `/job/<id>` and page content exposes `View raw logs` +
  `Download log archive`
- dialog/menu open:
  verify the intended surface exists and is visible

The verifier should be optional. Not every click needs it.

## 6. Public Contract V2

Recommended response shape:

```json
{
  "success": true,
  "dispatchSucceeded": true,
  "observedOutcome": "spa_route_change",
  "verification": {
    "navigationOccurred": false,
    "urlChanged": true,
    "newTabOpened": false,
    "domChanged": true,
    "stateChanged": false,
    "focusChanged": false
  },
  "targetEvidence": {
    "ref": "ref_128",
    "href": "/owner/repo/issues",
    "source": "highValueObjects"
  },
  "postClickState": {
    "beforeUrl": "https://github.com/owner/repo",
    "afterUrl": "https://github.com/owner/repo/issues",
    "pageRoleBefore": "repo_home",
    "pageRoleAfter": "issues_list",
    "verifierPassed": true,
    "verifierReason": "github.repo_nav.issues"
  }
}
```

Contract rules:

1. `success` means verified success, not merely dispatched input.
2. `observedOutcome` is required whenever dispatch succeeded.
3. `postClickState` is optional for generic clicks, required for verifier-backed
   flows.
4. `targetEvidence` should explain why this target was chosen.
5. The tool should remain backward-compatible for one release where practical,
   but new callers should consume V2 fields.

## 7. Outcome Taxonomy

Base observed outcomes:

- `cross_document_navigation`
- `spa_route_change`
- `hash_change`
- `new_tab_opened`
- `dialog_opened`
- `menu_opened`
- `state_toggled`
- `dom_changed`
- `focus_changed`
- `download_intercepted`
- `no_observed_change`
- `verification_unavailable`

Interpretation rule:

- observed outcome answers "what changed"
- verifier answers "did this satisfy the goal"

This distinction should remain explicit.

## 8. Where Tabrix Should Beat CDP-Only Tools

Many browser automation stacks can:

- click an element
- observe URL changes
- inspect browser events

Tabrix should lead in three areas that benefit directly from the extension
architecture.

### 8.1 Page-Aware Success Proof

Because Tabrix already has `read_page`, it can verify semantic destination state
after the click without forcing the upper AI to build that logic itself.

### 8.2 Lower-Traction Interaction

The extension can use page-local DOM access and refs instead of relying on
global CDP selectors or brittle coordinate-only control. This should reduce:

- accidental clicks
- UI flicker from unnecessary fallback actions
- extra browser focus changes

### 8.3 Cheaper Post-Click Recovery

When a click is ambiguous, Tabrix can do a lightweight compact re-read of the
current page family instead of escalating immediately to heavy tools like raw JS
or computer-control fallbacks.

This is how click can become more token-efficient.

## 9. Speed Strategy

Click V2 should use early-stop settle rules.

### Fast-stop cases

Stop immediately when strong proof exists:

- `new_tab_opened`
- `cross_document_navigation`
- `hash_change`
- verifier passes from cheap readback

### Short-window cases

Use short windows for:

- dialog/menu open
- state toggle
- focus-only transitions

### Slow-path cases

Use a slower path only when needed:

- ambiguous SPA updates
- target moved or page partially re-rendered
- family-aware verifier requires one compact readback

The goal is to replace fixed generic waits with proof-driven stop conditions.

## 10. Accuracy Strategy

Accuracy should be improved in this order:

1. better target ranking
2. better outcome detection
3. better verifier coverage
4. limited retry only for transient infra issues

Do not use repeated clicks to compensate for weak targeting.

For GitHub, the first verifier set should cover:

- repo nav tabs
- Actions run entry
- workflow job detail
- Security and quality tab

## 11. Stability Strategy

Stability should come from layered evidence and deterministic fallback.

Recommended fallback order:

1. `ref` click + browser/page observation
2. verifier-backed compact readback
3. selector re-resolution if target became stale
4. explicit fallback escalation
   - `chrome_get_interactive_elements`
   - `chrome_read_page compact`
   - `chrome_javascript`
   - `chrome_computer`

This order should be enforced in tooling guidance and acceptance tests.

## 12. Token Efficiency Strategy

Click V2 should reduce token cost in two ways.

### 12.1 Richer Tool Return

If the click response already contains:

- target evidence
- observed outcome
- before/after URL
- post-click page role
- verifier result

then the AI often does not need to call `read_page` again just to confirm what
happened.

### 12.2 Smaller Verification Reads

When readback is needed, prefer:

- compact mode
- family-aware expectations
- verifier-specific checks

Do not default to whole-page rereads after every click.

## 13. Implementation Plan

### Phase 1: Solidify the Generic Click Contract

Goal:

- keep the repaired V1 contract stable
- ensure `success` is always tied to verified outcome
- preserve browser + page signal merge

Deliverables:

- maintain `mergeClickSignals()`
- keep `_blank` observation robust
- record structured debugging evidence

### Phase 2: Add Verifier Hook

Goal:

- allow callers or family adapters to request a post-click verifier

Deliverables:

- verifier interface
- generic verifier runner
- response fields for `targetEvidence` and `postClickState`

### Phase 3: GitHub Family Verifiers

Goal:

- make core GitHub flows high trust

Deliverables:

- repo nav verifier
- actions run verifier
- workflow job detail verifier
- security tab verifier

### Phase 4: Real-World Acceptance

Goal:

- prove user-goal completion, not just event dispatch

Deliverables:

- private real-browser acceptance scenarios
- click attempt count and retry count in evidence
- latency tracking per click path

## 14. Metrics

Click V2 should be judged by product metrics, not by code elegance.

Primary metrics:

- click first-attempt success rate
- click verified-success rate
- median click-to-proof latency
- retry rate
- post-click extra-read rate
- token cost per completed click flow

GitHub starter targets:

- repo nav verified-success rate >= 98%
- workflow run entry verified-success rate >= 95%
- workflow job detail verified-success rate >= 95%
- median click-to-proof latency <= 1.2 s on healthy local runtime

## 15. Acceptance Tests

Product-grade acceptance must include real-browser paths.

Minimum GitHub set:

1. `repo_home -> Issues`
2. `repo_home -> Security and quality`
3. `actions_list -> workflow_run_detail`
4. `workflow_run_detail -> quality job detail`
5. `_blank` link opens a new tab and is reported as `new_tab_opened`
6. menu/dialog click reports the correct non-navigation outcome
7. no-op click reports `success: false` with `no_observed_change`

Each scenario should record:

- logical click attempt count
- whether retry happened
- observed outcome
- verifier result
- latency to proof

## 16. Explicit Non-Goals

Click V2 should not try to solve everything at once.

Not in scope for this document:

- generic replay architecture
- cross-site verifier framework for every family
- full computer-use fallback redesign
- long-term memory/experience aggregation
- non-click product planning

## 17. Recommended Next Step

The next concrete step should be:

1. keep the current repaired click contract as the V1 stable base
2. define a small verifier interface
3. implement GitHub verifier coverage for:
   - repo nav
   - run detail
   - job detail
   - security tab
4. extend private real-browser acceptance to record click attempt count and
   verifier-backed success

That is the shortest path from "click no longer lies" to "click becomes a real
product advantage".
