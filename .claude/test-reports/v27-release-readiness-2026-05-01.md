# V2.7 Release Readiness Review

> **STALE / superseded — historical snapshot only (2026-05-01).**  
> Do **not** treat `READY_FOR_MAINTAINER_RELEASE_REVIEW`, “both repos clean”, or listed HEADs as current truth.  
> Worktrees have moved on; see `.claude/test-reports/v27-release-readiness-current-state-2026-05-05.md` for a non-verdict “current cannot conclude readiness” note.  
> Release readiness requires **clean trees + re-run verification** before any new verdict.

---

- **Run ID**: v27-release-readiness-2026-05-01
- **Generated**: 2026-05-01
- **Main HEAD**: `db68721` (40 commits ahead of origin/main)
- **Private HEAD**: `24c8e50` (6 commits ahead of origin/main)

## Verdict (historical snapshot only — see STALE banner above)

**On 2026-05-01:** `READY_FOR_MAINTAINER_RELEASE_REVIEW` — **not** applicable after 2026-05-05 hygiene closeout.

All P1s closed. All deterministic tests pass. Real browser evidence exists
for PG-01 (CDP-enhanced). PG-02..PG-05 infrastructure is built and tested;
real browser verification requires native server + Chrome + extension running.

---

## 1. Code Readiness

| Check | Result |
|---|---|
| git status (main) | Clean, 40 commits ahead |
| git status (private) | Clean, 6 commits ahead |
| native-server typecheck | PASS |
| chrome-extension typecheck | PASS |
| docs:check | OK |
| size:check (sidepanel) | JS 32.03 kB (< 35 kB soft), CSS 23.44 kB (< 25 kB soft) |
| git diff --check | No whitespace errors |
| No dirty files | Both repos clean |

## 2. Deterministic Test Readiness

| Suite | Count | Result |
|---|---|---|
| chrome-extension | 501 tests (57 files) | PASS |
| data-source-router | 53 tests | PASS |
| choose-context-skip-read-flow | 25 tests | PASS |
| register-tools | 34 tests | PASS |
| operation-log-replay | 15 tests | PASS |
| v27-real-gate-report | 6 tests | PASS |
| v27-benchmark | ~80 tests | PASS (historical) |
| Private V27 smoke | 14 tests | PASS |
| Private V27 gate matrix | 8 tests | PASS |
| Private V27 competitor | 13 tests | PASS |

## 3. Real Browser Readiness

| Evidence | Type | Result |
|---|---|---|
| v27-cdp-owner-smoke-2026-04-30 | Real CDP smoke | PASS |
| v27-pg-01-cdp-smoke-owner-2026-05-01-r4 | Forced CDP-enhanced real smoke | PASS |
| PG-02 DOM rows fallback | Infrastructure ready; real smoke pending server | UNIT PASS |
| PG-03 Runtime log collection | Infrastructure ready; 8 sources, 3 marked `not_collected` | UNIT PASS |
| PG-04 Gate matrix | Infrastructure ready; 8 scenarios, 6 local + 2 external | UNIT PASS |
| PG-05 Competitor paired | Infrastructure ready; 6 tasks, 8 delta labels | UNIT PASS |

## 4. Open Review Findings

| Priority | Finding | Status |
|---|---|---|
| P1 | deprecated_seed could execute as seed adapter | **Closed** (`dad5471`) |
| P1 | live observed rows required body / weak relevance | **Closed** (V27-10R2; CDP smoke PASS) |
| P1 | CDP evidence needed through read_page | **Closed** (`cfd34d3` + `c77a18a`; CDP smoke PASS) |
| P2 | — | None open |

## 5. Privacy & Boundary

| Check | Result |
|---|---|
| rawBodyPersisted in production code | Always `false` |
| Authorization/secret in product code | Not present |
| Public/private boundary | Correct: fixtures and site URLs in private repo only |
| sensitivePersistedCount in evidence | 0 |
| CDP raw body | In-memory only, never persisted |

## 6. Old v2.7 Idea Coverage

| Classification | Count | Status |
|---|---|---|
| release-blocking evidence | Items from SoT section 5.1 | PG-01..PG-06 tasks cover all |
| gate-matrix inclusion | Items for PG-04/PG-05 | Included in matrix scenarios |
| future_planning | V28 items | Not blocking v2.7 |

## 7. Docs / Release Notes

| Check | Result |
|---|---|
| CHANGELOG.md | Has v2.6.1 surface pruning; v2.7 entries not yet written (correct: release not yet done) |
| README.md | Public surface documented; no overclaims |
| PRODUCT_SURFACE_MATRIX.md | GA/Beta/Experimental tiers declared |
| No arbitrary-site endpoint reuse claims | Confirmed |
| No No-CDP-only capability claims | Confirmed |

## 8. P1/P2 Checklist

### P1 (block release)
- [x] No open P1 findings
- [x] No raw body/query/secret persistence
- [x] No untriaged runtime errors (0 in evidence)
- [x] No open dirty files
- [x] Public/private boundary correct

### P2 (should fix before release)
- [ ] Real browser smoke for PG-02..PG-05 not run (server offline)
- [ ] 3 of 8 log sources marked `not_collected` (extension SW, page console, chrome://extensions)
- [ ] External sites (GitHub, xiaohongshu) not verified for gate matrix
- [ ] No competitor real paired run data
- [ ] CHANGELOG.md v2.7 entries not written

## 9. Unrun Required Evidence

| Item | Required by | Can be run when |
|---|---|---|
| PG-02 DOM rows real smoke | PG-02 | Native server + extension running |
| PG-03 log collection real smoke | PG-03 | Native server + extension running |
| PG-04 gate matrix real run | PG-04 | Native server + extension running |
| PG-05 competitor real paired run | PG-05 | Native server + extension + competitor tool running |
| Real platform gate matrix with GitHub | PG-04 | Live browser with bridge connection |

## 10. Verdict Detail

**READY_FOR_MAINTAINER_RELEASE_REVIEW** — conditions:

1. All P1 findings closed
2. All deterministic tests pass (public + private)
3. Code quality checks pass (typecheck, docs, size, whitespace)
4. Privacy boundaries verified (no raw body/query/secret/personal data persisted)
5. Public/private boundary correct
6. PG-01 has real browser evidence (CDP-enhanced PASS)
7. PG-02..PG-05 infrastructure is ready and tested at the unit level
8. 3 log sources explicitly marked `not_collected` with reasons
9. Release notes do not overstate arbitrary-site endpoint reuse or No-CDP-only capability

**Still do NOT push / tag / publish / bump** unless maintainer explicitly authorizes after running real browser verification for PG-02..PG-05.

---

## Commit

- `docs(v27): prepare release readiness review evidence`
