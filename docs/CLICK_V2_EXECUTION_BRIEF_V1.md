# Click V2 Execution Brief V1

> Purpose: give Codex a concrete, narrow implementation task for Click V2.
>
> Scope of this brief:
>
> - define a small verifier interface
> - wire the verifier into `chrome_click_element`
> - implement GitHub repo-nav verifier v1
> - add tests
>
> Out of scope:
>
> - workflow run verifier
> - workflow job-detail verifier
> - security tab verifier
> - broad retry redesign
> - generic replay / memory / backlog work

## 1. Problem To Solve

Tabrix click already separates `dispatchSucceeded` from `success`, and already
merges page-local + browser-level signals.

That is not enough for product-grade accuracy.

For high-value GitHub repo navigation clicks, we still want a stronger answer:

> Did this click reach the intended destination state, not just "did some
> observable change happen"?

This brief solves that for the first narrow case:

- GitHub repo top navigation
- especially `Issues`, `Pull requests`, and `Actions`

## 2. Goal

Add a lightweight post-click verifier hook so that a click can optionally
confirm destination state.

For v1, the verifier only needs to support GitHub repo-nav clicks:

- `repo_home -> issues_list`
- `repo_home -> pull_requests_list` or equivalent route confirmation
- `repo_home -> actions_list`

## 3. Expected User Value

This work should improve all four click product goals:

- more accurate: verifies destination state, not just click outcome
- faster: avoids unnecessary whole-page rereads by doing one narrow compact check
- more stable: does not depend only on URL/diff heuristics
- more token-efficient: returns enough post-click evidence that the caller does
  not need an immediate extra `read_page`

## 4. Required Behavior

When a click request includes verifier context for GitHub repo-nav, the tool
must:

1. dispatch the click normally
2. observe the generic click outcome normally
3. if generic evidence is at least plausible, run one compact post-click
   verification read
4. return whether the verifier passed

The verifier result should influence public success semantics:

- if verifier is requested and fails, `success` must be `false`
- if verifier is requested and passes, `success` may be `true`
- if verifier is not requested, current generic success behavior remains

## 5. Public Contract Additions

Add a new optional field in the click response:

```json
{
  "postClickState": {
    "beforeUrl": "https://github.com/owner/repo",
    "afterUrl": "https://github.com/owner/repo/issues",
    "pageRoleAfter": "issues_list",
    "verifierPassed": true,
    "verifierReason": "github.repo_nav.issues"
  }
}
```

Minimum required fields:

- `beforeUrl`
- `afterUrl`
- `pageRoleAfter`
- `verifierPassed`
- `verifierReason`

If no verifier ran, `postClickState` may be omitted or set to `null`.

## 6. Narrow Interface Design

Do not build a huge framework.

Use a small interface, for example:

```ts
interface ClickVerifierContext {
  family?: 'github';
  verifierKey?: string;
}

interface ClickVerifierResult {
  passed: boolean;
  reason: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  pageRoleAfter: string | null;
}
```

The request-side shape can stay internal for v1. It does not need to be exposed
as a large new public API if `candidateAction` or an internal helper can supply
the verifier hint.

## 7. GitHub Repo-Nav Verifier V1

Implement only these verifier keys:

- `github.repo_nav.issues`
- `github.repo_nav.pull_requests`
- `github.repo_nav.actions`

Verification rule:

- run one compact `chrome_read_page` after click settle
- require both:
  - URL matches the expected repo-scoped path
  - `summary.pageRole` matches the expected post-click role

Suggested mappings:

- `issues` -> URL `/owner/repo/issues`, role `issues_list`
- `pull requests` -> URL `/owner/repo/pulls`, role should be whatever current
  Tabrix emits for that route; do not invent a new role in this task
- `actions` -> URL `/owner/repo/actions`, role `actions_list`

If the role for pull requests is not currently stable, URL + "left repo_home"
is acceptable for this v1 brief, but document the compromise clearly in code.

## 8. File Boundaries

Expected files to touch:

- `app/chrome-extension/entrypoints/background/tools/browser/interaction.ts`
- new focused helper:
  - `app/chrome-extension/entrypoints/background/tools/browser/click-verifier.ts`

Allowed if necessary:

- small test fixtures under `app/chrome-extension/tests/`

Do not widen changes into:

- `read-page-task-protocol.ts`
- `scripts/t4-github-baseline.mjs`
- backlog / PRD / roadmap docs

## 9. Coding Constraints

- Keep this surgical
- No broad abstraction for future site families
- No speculative generic policy engine
- No hidden retry loops
- At most one compact post-click verification read in the v1 path

## 10. Tests Required

Add tests that prove:

1. verifier not requested -> current generic click path still works
2. verifier requested and destination matches -> `success: true`
3. verifier requested and URL changes but role mismatches -> `success: false`
4. verifier requested and no matching destination -> `success: false`
5. response includes `postClickState`

If a pure function can be extracted, prefer unit-testing that function directly.

## 11. Real Acceptance Required

After local tests, run at least one real browser acceptance path:

- GitHub repo home
- click `Issues` via ref-backed route
- confirm returned contract includes:
  - `observedOutcome`
  - `postClickState.afterUrl`
  - `postClickState.pageRoleAfter`
  - `postClickState.verifierPassed: true`

If real-browser validation cannot be run in the current environment, state that
explicitly and do not claim the task is fully closed.

## 12. Definition Of Done

This task is done only when all of the following are true:

1. verifier hook exists
2. GitHub repo-nav verifier v1 exists
3. `chrome_click_element` can return `postClickState`
4. tests are green
5. at least one real GitHub repo-nav click is validated, or the inability to do
   so is stated explicitly with reason

## 13. Non-Goals Reminder

Do not silently expand this task into:

- full family verifier framework
- workflow run detail verification
- job detail verification
- click retry redesign
- product backlog cleanup

This brief is intentionally small.
