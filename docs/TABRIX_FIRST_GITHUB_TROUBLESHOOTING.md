# Tabrix-First GitHub Troubleshooting Runbook

> Applies when a user explicitly asks for browser-side GitHub troubleshooting through Tabrix. In that situation the execution method is a hard constraint, not a preference — `AGENTS.md` rule 7 points here.

## Why this runbook exists

GitHub failures can look very different depending on whether you read them through the API or through the page a human actually sees:

- `gh` / REST / GraphQL responses often mask retried jobs, annotation noise, truncated logs, artifact links, or HTML-only error panels.
- The Actions UI surfaces run-level context (matrix, re-run reason, queue status, step timings) that is not cleanly reconstructible from the API.

When a user asks for "use Tabrix to look at GitHub", they are choosing the browser-visible view on purpose. This runbook defines how to honor that choice.

## Required behavior

1. **Do not** use `gh`, the GitHub REST / GraphQL API, or generic web search as the primary path.
2. Use Tabrix — or the project's real browser-control MCP path — first. Open the GitHub repository page, navigate to **Actions**, open the relevant workflow run, open the failing job, and inspect the page-visible failure details.
3. Only fall back to API / CLI **after** explicitly stating why the browser-visible path is insufficient (e.g. the page is blocked by auth, the log is truncated and only the artifact has the full trace, the run was deleted, etc.).
4. Come back with the concrete browser findings, fix the code locally, run the smallest relevant verification, push the change, then use Tabrix again to confirm the new GitHub result.
5. If any required browser step cannot be completed, state the exact blocker **before** switching tools. Do not silently switch.

## Reusable prompt

Paste this verbatim when you want to force a Tabrix-first troubleshooting flow:

```text
This time, do not use gh, GitHub API, or generic web search as the primary path.
You must use Tabrix or the project's MCP browser-control path to open the GitHub repository page, go to Actions, open the latest failing run and job, read the page-visible error details, then come back and fix the code locally, run the relevant tests, push the change, and use Tabrix again to confirm the updated result on GitHub.
If any step cannot be completed, state the blocker clearly before using any fallback path.
```

## Acceptance checklist

Every Tabrix-first GitHub troubleshooting task must report the following back to the user:

1. Which GitHub page was opened (URL).
2. Which workflow run and which job were opened (run number + job name).
3. The visible failure detail, quoted or summarized from the page — not paraphrased from API responses.
4. What was changed locally (files / commits).
5. Which verification commands were run and their outcomes.
6. Which GitHub page was revisited after the push and what final status was observed there.

## Allowed fallbacks (and how to declare them)

A fallback to `gh` / API / CLI is acceptable in any of the following cases, but you **must** name the case explicitly in your response:

- **Access blocker** — the page requires an auth state Tabrix cannot acquire in this session.
- **Page truncation** — the UI shows "log was truncated" and the full evidence only exists as a downloadable artifact.
- **Run lifetime** — the run has been retained-out / deleted and can only be reached through the API.
- **Scale** — the question is inherently aggregate across many runs (e.g. "show failure rate of job X over the last 30 days") and the per-run UI is not the right tool.

When you declare a fallback, the acceptance checklist above still applies, with item (1)–(3) replaced by "stated blocker + evidence that the blocker is real".

## Related

- `AGENTS.md` rule 7 — the single-line policy that points here.
- `docs/TROUBLESHOOTING.md` / `TROUBLESHOOTING_zh.md` — general troubleshooting.
- `docs/T4_GITHUB_BASELINE_GATE_zh.md` — GitHub-baseline acceptance gate context.
