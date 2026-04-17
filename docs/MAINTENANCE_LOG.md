# Tabrix Public Maintenance Log

This document is a lightweight public log for verified maintenance findings, known gaps, and follow-up items that are useful to contributors working in the open repository.

It is intentionally not a replacement for GitHub Issues, Pull Requests, or internal governance systems.

Scope:

- verified public maintenance findings
- contributor-visible follow-up items
- public troubleshooting notes worth preserving
- verified product-improvement suggestions discovered while using Tabrix in real maintenance or contributor workflows

Out of scope:

- internal planning systems
- private review notes
- acceptance evidence bundles
- unpublished release-gate governance records

## Entry Format

Use concise records with:

1. date
2. status
3. scope
4. priority
5. owner
6. related
7. summary
8. evidence
9. next action

Ordering rule:

- keep entries in reverse chronological order, newest first

Maintenance convention:

- After using Tabrix in a real task, record concise, contributor-visible improvement ideas here when they are verified and useful for follow-up optimization. Keep the log lightweight rather than turning it into an internal task system.

## Entries

### 2026-04-17 - Open - Recovery acceptance ergonomics and local scene restoration

- Scope: recovery-specific smoke coverage, local runtime recovery after forced Chrome shutdown, structured tool-error parsing
- Priority: Medium
- Owner: Maintainers / contributors
- Related: `tabrix smoke --bridge-recovery`, `tabrix smoke --browser-path-unavailable`, `tabrix daemon start`
- Summary: The recovery loop now covers real auto-launch, unavailable-browser-path, and partial-recovery failure cases, but real maintainer use still surfaced two operational facts worth preserving: forcing Chrome closed can require an explicit local daemon restart on this machine, and real tool failures may arrive wrapped as `Error calling tool: {json}; ...`, so acceptance tooling must strip that wrapper to read the structured result reliably.
- Evidence:
  - The real path `Chrome not running -> real browser request -> auto-launch -> original request succeeds` passed, and the local browser scene was restored to a closed state afterward.
  - The new `tabrix smoke --browser-path-unavailable` path now reproduces `TABRIX_BROWSER_NOT_RUNNING` with one single `nextAction` without mutating the system `chrome.exe`.
  - During this real regression run, `taskkill /IM chrome.exe /F` occasionally also left the local service unavailable until `tabrix daemon start` was run again.
  - Real tool-error payloads included a suffix like `Error calling tool: {json}; recoveryAttempted=...`, which caused false negatives until smoke parsing was taught to extract the JSON body first.
- Next action:
  - Consider adding a clearer `status` / `doctor` hint when the browser has been force-closed and the local service also needs to be restarted.
  - Keep recovery smoke paths in the safer form used here: set localhost-only injection -> trigger a real request -> validate the structured result -> clear injection -> restore the local scene.
  - Prefer localhost-only recovery injections over touching user installation directories when expanding future acceptance coverage.

### 2026-04-17 - Open - CLI argument ergonomics in real troubleshooting

- Scope: real maintainer use of `tabrix mcp call --args` from PowerShell
- Priority: Medium
- Owner: Maintainers / contributors
- Related: `tabrix mcp call`, GitHub Actions page troubleshooting, PowerShell
- Summary: The browser-first troubleshooting flow now works, but `--args` still requires hand-written JSON strings, which is easy to misquote in PowerShell and adds friction in real maintenance work.
- Evidence:
  - During this real GitHub Actions investigation, multiple attempts failed with JSON parsing errors such as `MCP call failed: Expected property name or '}' in JSON...` before the command shape was corrected.
  - The same `chrome_navigate`, `chrome_read_page`, and `chrome_get_web_content` calls succeeded reliably once arguments were passed via single-quoted JSON or `ConvertTo-Json`.
  - GitHub-oriented examples are now present in `tabrix mcp --help`, but shell-level argument ergonomics still depend on users understanding quoting details.
- Next action:
  - Evaluate a lower-friction argument format for `tabrix mcp call`, such as `--args-file`, repeated `--arg key=value`, or another shell-friendly object input mode.
  - Add at least one PowerShell-specific argument example to CLI docs or help text for Windows maintenance workflows.
  - Keep recording verified self-use friction points here after real tasks, while keeping the public log lightweight.

### 2026-04-17 - Open - Product self-use feedback from real GitHub troubleshooting

- Scope: Tabrix browser-control workflow used against real GitHub Actions pages
- Priority: Medium
- Owner: Maintainers / contributors
- Related: `tabrix status`, `tabrix doctor`, `tabrix smoke --json`
- Summary: Core runtime health is strong, but complex web troubleshooting still needs better task-oriented ergonomics.
- Evidence:
  - `tabrix status`, `tabrix doctor`, and `tabrix smoke --json` all passed on the current workspace build, confirming that the bridge, extension, and local MCP runtime were healthy during the investigation.
  - Real-session browser use through Tabrix successfully opened the GitHub Actions job page, read logged-in page content, and recovered the failing advisory text from the rendered page.
  - For a precise conclusion on a complex page, the investigation still needed `chrome_javascript` to read `document.body.innerText`, which means page-reading ergonomics are not yet strong enough for all contributor workflows.
- Next action:
  - Define and document a preferred complex-page investigation ladder: `chrome_read_page` -> `chrome_get_web_content` -> `chrome_get_interactive_elements` -> screenshot/console -> `chrome_javascript` only as an explicit fallback.
  - Add at least one repeatable GitHub-oriented browser validation path to routine maintenance work so complex public web pages are exercised intentionally, not only ad hoc.
  - Evaluate a lower-friction maintainer inspection entrypoint for direct MCP tool calls during troubleshooting, instead of requiring ad hoc local scripts.
  - Keep validating product changes with real logged-in browser tasks instead of only protocol-level checks.

### 2026-04-17 - Closed - GitHub troubleshooting workflow

- Scope: contributor troubleshooting flow for GitHub-visible failures
- Priority: High
- Owner: Maintainers / contributors
- Related: GitHub Actions `CI #110`, Tabrix-driven browser inspection
- Summary: When a failure is visible in GitHub's web UI, contributors should prefer a Tabrix-driven browser investigation before falling back to API-only or CLI-only inspection.
- Evidence:
  - This incident was resolved faster once the GitHub Actions job page was inspected through Tabrix in a real logged-in Chrome session.
  - Browser-side inspection recovered the exact failing advisory text even when `gh` was not logged in and public log endpoints were restricted.
  - A lower-friction maintainer entrypoint is now in place through `tabrix mcp tools` and `tabrix mcp call <tool>`, which removes the need for ad hoc local scripts in the common troubleshooting path.
  - The workflow has now been re-verified against the current repository's GitHub page, confirming that contributors can follow `tabrix status` -> `tabrix doctor` -> `tabrix mcp call ...` for browser-first investigation.
- Next action: Keep this sequence as the default contributor workflow. Reopen the item only if GitHub page inspection ergonomics or discoverability regress again.

### 2026-04-17 - Closed - CI audit attribution

- Scope: GitHub Actions `CI` workflow, `Production audit (high)` gate
- Priority: High
- Owner: Verified by contributors
- Related: GitHub Actions `CI #110`, GitHub Actions `CI #111`, commit `650638b`
- Summary: The current CI blocker was verified to be `protobufjs@6.11.4` with advisory `GHSA-xq3m-2v4x-88gg`, not `fastify`.
- Evidence:
  - Historical failure: GitHub Actions `CI #110` failed in `Production audit (high)`.
  - Page-level verification through Tabrix on the GitHub job page showed `tabrix audit: HIGH/CRITICAL production vulnerabilities detected` followed by `protobufjs@6.11.4`.
  - Current head verification: local `pnpm run audit` passes on `main`.
  - Current head verification: GitHub Actions `CI #111` succeeded after commit `650638b` (`fix: upgrade onnxruntime-web to eliminate protobufjs CVE path`).
  - Dependency check: `app/native-server/package.json` kept `fastify` at `^5.8.5` before and after the red-to-green transition, which rules it out as the direct cause of this incident.
- Next action: Keep using the OSV gate as the source of truth for production dependency blocking findings, and confirm specific failing packages before attributing CI failures to a named dependency.
