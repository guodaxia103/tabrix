# V26-14C Small Fix Pack Handoff

## Status

Implemented the product-side Gate B fix and locally verified. Push/tag/publish/version bump were not run.

## Gate B Finding

- Real Gate B failed `V26-GATE-B-SEMANTIC-MISMATCH-FALLBACK-01`.
- Root cause: `resolveApiKnowledgeCandidate()` saw a GitHub search URL with `pageRole="issues_list"` and issue intent, but no repository owner/name. It then continued into the repository-search adapter and returned `github_search_repositories`, producing `api_rows` for an issue-search task.

## Fix

- `app/native-server/src/api/api-knowledge.ts`: if GitHub intent/pageRole asks for issues but the URL is not a repository issues page, return `null` so the production path falls back to DOM `L0+L1`.
- `app/native-server/src/api/api-knowledge.test.ts`: added regression coverage for `https://github.com/search?...type=issues` + `issues_list` returning no API candidate.

## Verification

- `pnpm -C app/native-server test:ci --% --testPathPattern "api|skip-read|v26-benchmark"` — PASS, 6 suites / 101 tests.
- `pnpm -r typecheck` — PASS.
- `pnpm -C app/native-server build` — PASS.
- `pnpm run docs:check` — PASS.
- `git diff --check` — PASS, CRLF warnings only.

## Not Verified

- Real Gate B rerun happens after the private runner sensitive-scan correction.

## Remaining Risks

- This intentionally does not add a GitHub issue-search API adapter. It only prevents an existing repository-search adapter from answering a semantically different issue-search task.

## Commit

- SHA: final local commit reported by `git log`.
- Push status: not pushed.
