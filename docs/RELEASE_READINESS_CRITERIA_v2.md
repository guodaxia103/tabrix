# Tabrix Release Readiness Criteria v2

This document is the **upper-layer companion** to `RELEASE_READINESS_CHECKLIST_zh.md`
(Phase 0 minimal loop). Phase 0 answers "does it run?"; this document answers
"can we call this release production-grade / GA?"

Applies to: `v2.1+`
Status: `active`

---

## 0. Relationship to Phase 0

| Layer                  | Document                            | Question answered                                   |
| ---------------------- | ----------------------------------- | --------------------------------------------------- |
| Phase 0                | `RELEASE_READINESS_CHECKLIST_zh.md` | Can this build install, connect, and run?           |
| **Phase 1 (this doc)** | `RELEASE_READINESS_CRITERIA_v2.md`  | Can this release be declared production-grade / GA? |

Passing Phase 0 does not imply passing Phase 1. Every Phase 1 item is a release blocker.

---

## 1. Four Hard Gates

Before declaring a release "production-grade", **all four** dimensions must be
satisfied. If any fails, the release may only ship under a
`Developer Preview` / `Beta` narrative.

### Gate A: Architecture Neutrality

Intent: prove the core layer is not hijacked by a single site family, so new
families can be added without rewriting.

Required:

- `read-page-understanding-core.ts` contains zero site-specific vocabulary:
  - No Chinese / English anchors tied to a specific family (GitHub / Douyin / creator centers, etc.)
  - `PageRole` enum only includes **industry-neutral** roles (e.g. `dashboard / list / detail / document / form / workflow / search_result / media_asset / login_required / outer_shell / unknown`)
- Site-family rules live in `*-<family>.ts` adapter files only:
  - At least 2 family adapters exist (GitHub is the baseline; a second adapter proves neutrality)
  - Adding a new family must not grow core line count / enum size / dictionaries
- Object layer (`highValueObjects`) is no longer hard-coded inside `read-page-task-protocol.ts`:
  - Lives in dedicated modules `read-page-high-value-objects-{core,<family>}.ts`
  - `read-page-task-protocol.ts` ≤ 400 lines
- Unit test evidence:
  - With all family adapters disabled, GitHub baseline pages must fall back to `pageRole = unknown` or a neutral role, not to a specialized role

### Gate B: Real Acceptance Surface

Intent: make the "works across industries" claim measurable.

Required:

- Public acceptance families ≥ **3** (recommended first batch: `github`, `enterprise_backoffice`, `content_longform`)
- Public baseline pages per family ≥ **4**, total ≥ `12/12`
- Real MCP E2E framework (T7) in place:
  - ≥ 10 E2E cases pass 7 runs in a row
  - Entry point must be a real MCP client; module-level pretending is not allowed
- Long-tail negative sampling:
  - ≥ 100 random public domains exercised via non-assertive `read_page`
  - Record `pageRole` / `primaryRegion` / failure distribution
  - Regression gate: crash rate = 0; `unknown` ratio drift ≤ 15 % over 30-day window
- Flaky rate: last-30-runs pass rate of core CI jobs ≥ **95 %**

### Gate C: Self-healing & Observability

Intent: prove "AI can rely on Tabrix" is a measurable loop, not folklore.

Required:

- T9 `fallbackChain` / locator degradation merged; key tools (`chrome_click`, `chrome_fill`, `chrome_read_page`) are wired in
- T10 Policy v1 supports at least: `allow / suggest / confirm / block`
- Default sensitive-domain deny-list active (see Gate D)
- T8 evidence layer + T13 nightly:
  - Nightly runs the public acceptance matrix; 7-day pass rate ≥ **95 %**
  - Failures automatically produce artifacts (screenshot + DOM snapshot + trace)
- T4 understanding-quality regression metric:
  - Every CI prints hit rate for `taskMode / pageRole / primaryRegion / highValueObjects`
  - A regression of > **3 percentage points** vs. previous `release/` branch blocks the release

### Gate D: Enterprise Non-functional

Intent: allow enterprise scenarios (teams, RPA, regulated industries) to adopt.

Required:

- Remote access security:
  - Bearer Token TTL (default ≤ 30 days)
  - Supports rotation / revoke without bridge restart
  - Audit log persisted per remote call: `{time, clientId, tool, argsHash, outcome}`
  - Rate limiting: default `60 req / min / token`, configurable
- Default sensitive-domain deny-list:
  - Covers at least: major banks, password managers (1Password / Bitwarden / Dashlane / LastPass), major email admin backends, major healthcare portals
  - Users may opt out, but default is on
  - Triggering returns structured `error.code = policy_sensitive_domain_blocked`
- Cross-platform coverage:
  - `Windows 10/11` × `Chrome stable` ✅
  - `macOS 13+` × `Chrome stable` ✅
  - `Linux (Ubuntu LTS)` × `Chrome stable` ✅
  - At least one alternative Chromium browser (Edge / Brave) passes smoke
- Upgrade & compatibility:
  - SemVer followed; MAJOR bumps must list breaking changes in CHANGELOG
  - MCP tool schema honors at least one `MINOR`-version backward compatibility window
  - Behavior for extension / native-server version mismatch documented in `TRANSPORT.md`
- Manifest V3 lifecycle:
  - `TRANSPORT.md` explicitly documents reconnect semantics when the service worker is suspended
  - Keep-alive heartbeat or equivalent mechanism present
- Supply chain:
  - `pnpm run audit` blocks CI
  - Release artifacts publish checksums
  - NOTICE and third-party matrix match actual reuse

---

## 2. North-star Metrics (measured from day one)

GA releases must publish baselines for the following metrics and track them:

| Metric                                             | Baseline target  | Source                       |
| -------------------------------------------------- | ---------------- | ---------------------------- |
| Install → first-success rate (within 30 min)       | ≥ 60 %           | Opt-in telemetry             |
| Main-path call success rate (last 7 days)          | ≥ 98 %           | Client self-report / nightly |
| `read_page` p95 token                              | ≤ baseline × 1.2 | Fixture regression           |
| Recovery-loop success under bridge fault injection | ≥ 90 %           | `smoke --bridge-recovery`    |
| Nightly pass rate                                  | ≥ 95 %           | T13                          |
| Security incidents (30 days)                       | = 0 high         | Audit log + SECURITY issues  |

---

## 3. Narrative Alignment (PM sign-off)

Before release, the following surfaces must be consistent and honor the gates:

- `README.md` / `README_zh.md`
- `docs/ROADMAP.md` / `ROADMAP_zh.md`
- `docs/PRODUCT_SURFACE_MATRIX.md` / `..._zh.md`
- Chrome Web Store listing description and screenshots

Forbidden phrasing:

- "Works across all industries / any website", when only 1–2 families are verified
- Treating `Experimental` / `Beta` capabilities as GA in headline copy
- Claims that conflict with `PRODUCT_SURFACE_MATRIX`

---

## 4. Release Blockers (hard red lines)

Any of the following blocks a GA release:

- Any of gates A / B / C / D not satisfied
- Any north-star metric unpublished or below baseline
- Public narrative conflicts with `PRODUCT_SURFACE_MATRIX`
- Private test assets (`.private-artifacts` / `.private-tests`) not removed or isolated from main
- CHANGELOG missing breaking-change notes
- 30-day CI flaky rate > 5 %

---

## 5. How to use

1. Open a `release/` branch per GA candidate
2. In the release PR, cite this document and tick each gate with evidence (CI run link / fixture report / artifact URL)
3. Merge only after all gates pass; otherwise ship as `Developer Preview` / `Beta`

## 6. Related documents

- `RELEASE_READINESS_CHECKLIST_zh.md` (Phase 0)
- `RELEASE_PROCESS.md`
- `PRODUCT_SURFACE_MATRIX.md`
- `ROADMAP.md`
- `SECURITY.md`
- `THIRD_PARTY_REUSE_MATRIX.md`
