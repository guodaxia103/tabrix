# V2.7 release readiness — current worktree state (not a gate verdict)

**Status: STALE WORKTREE — cannot be used as release readiness or shipping evidence.**

This snapshot documents repository state as observed during v2.7 closeout hygiene (2026-05-05). It does **not** replace a maintainer gate run, does **not** assert clean trees, and must **not** be cited as `READY_FOR_MAINTAINER_RELEASE_REVIEW`.

---

## Repositories at time of note

| Repo | Branch | HEAD |
|------|--------|------|
| `main_tabrix` | `main` | `f148a29061558cbf93611f41ed3d9549aca7ff98` |
| `tabrix-private-tests` | `fix/v27-dom-rows-evidence-binding` | `0375fec846af59e8ac29c9679d276fe4404f461f` |

---

## Dirty / uncommitted work (summary)

**main_tabrix** had modified/untracked paths across extension tools, inject-scripts, native-server, shared contracts, eslint, tests, and `.agents/` skill drafts. **Treat as not release-ready** until the working tree is intentionally cleaned or committed.

**tabrix-private-tests** had branch-local edits (including competitor/DOM-rows scenarios) and **must not** be treated as a validated gate matrix until clean + rerun.

---

## Verification not re-run for this snapshot

- Full deterministic suites across both repos  
- Real-browser / PG-02–PG-05 evidence lanes  
- Maintainer release gate  

---

## What would be required before any release readiness conclusion

1. **Clean** working trees (or explicitly scoped commits) on both repos  
2. **Re-run** agreed verification (tests, docs checks, and any required real-browser lanes per maintainer process)  
3. Only then may a separate report record `READY_FOR_MAINTAINER_RELEASE_REVIEW` or equivalent  

---

## Supersedes / complements

- Historical report `.claude/test-reports/v27-release-readiness-2026-05-01.md` is marked **STALE**; its verdicts describe **past** repo state only.
