# Tabrix Project Review 2026 Q2

## Executive Summary

Tabrix has evolved from a browser bridge into a product-shaped MCP execution platform with clear strengths in local-first browser automation and remote control. The current phase should focus on stability and contributor trust: tighten quality gates, complete user-facing i18n, and reduce release risk before accelerating feature expansion.

At this stage, Tabrix should explicitly optimize for AI assistant products first. The two tier-1 connection modes are `stdio` and remote `Streamable HTTP`; everything else should be treated as secondary until remote browser control is consistently reliable.

## 1) Product Manager View

### Positioning

- Core value: turn a real daily browser session into an MCP execution layer.
- Strong differentiator: remote control with token auth and LAN workflow support.
- Ecosystem fit: compatible with multiple MCP clients and assistant products.
- Priority audience: Copaw, OpenClaw, Codex, Claude Desktop, Cursor, Cline, and similar AI assistant products.

### Growth Drivers

- Fast installation path (`npm/pnpm + extension`) is now clearer.
- Unified CLI (`tabrix`) and troubleshooting commands reduce support burden.
- Strong release assets (extension zip + npm tarball) help non-technical users.

### Growth Frictions

- Some UX copy and i18n had inconsistent quality (now being standardized).
- CI quality gates were missing for PR-level trust and contributor confidence.
- Public-facing benchmark/success metrics are not yet visible.

## 2) Architecture View

### Current Strengths

- Monorepo split is clear: extension / native server / shared / wasm-simd.
- Runtime chain is explicit: MCP client -> native server -> extension -> browser APIs.
- Feature depth is strong in record/replay and web editor workflows.

### Technical Debt / Risks

- Security baseline required dependency hardening (drizzle + hono chain).
- Workspace dependency consistency needed alignment (`@tabrix/shared`).
- 일부 user-visible strings were still hardcoded in runtime modules.

### Recommended Architectural Priorities

- Keep CLI contract stable; optimize internal modules behind unchanged commands.
- Use CI gates as architecture guardrails (i18n, typecheck, tests, audit).
- Treat remote-control path as tier-1 path with dedicated regression checks.
- Treat `stdio` and remote `Streamable HTTP` as the only tier-1 transports in the current phase.
- Design recovery around the assistant command path: if the browser is not running, the system should be able to launch Chrome, reattach the extension bridge, and continue the requested tool call.

## 3) Test & Release Management View

### Current Baseline

- Typecheck passes for extension/native/shared.
- Core tests are strong in extension, thinner in native server.
- Full recursive tests currently depend on local wasm toolchain availability.

### Key Gaps

- No dedicated CI workflow previously for PR-level verification.
- i18n regression checks were manual and easy to miss.
- Security audit was not consistently enforced in release gates.

### Actions (this phase)

- Add CI workflow with `i18n:check`, `typecheck`, `test:core`, `audit`.
- Keep wasm tests as conditional/local capability checks.
- Block release only on high-severity production vulnerabilities.

## 4) Real User / UX View

### First-Hour Journey (Install -> Connect -> Remote)

- Positive: command surface is simpler and troubleshooting is actionable.
- Required improvements: fully localized, concise, and non-technical user messages across popup + sidepanel + builder validation.
- Required improvements: remote browser control should feel automatic for assistant users, not like a manual multi-step setup ritual.

### UX Principles for Next Iteration

- Prefer short, action-oriented error copy.
- Always pair problem + one concrete next action.
- Keep remote-control onboarding visible and copy-pastable.

## 5) Open-Source Reputation First (Pre-Commercialization)

Current recommended strategy is **reputation-first open source growth**:

- Fast issue response and transparent release notes.
- Reliable install experience across npm/pnpm and major MCP clients.
- Contribution-friendly workflows (CI feedback, docs, stable command behavior).

### KPI Suggestions (Community Phase)

- Install success rate (CLI + extension) by platform.
- First-connect success rate within 10 minutes.
- Release failure rate and rollback count.
- Median issue response time and PR merge lead time.

## Roadmap

### M0 - Stabilization (Now)

- Complete user-facing i18n coverage.
- Enforce CI/release quality gates.
- Close high-severity dependency risks.
- Fully stabilize remote `Streamable HTTP` for real assistant clients before expanding other surfaces.
- Define release gating around real MCP flows: `initialize -> tools/list -> tools/call`.

### M1 - Growth

- Improve onboarding docs and demos for top MCP clients.
- Add contributor starter tasks and dev environment quick checks.
- Publish reliability and adoption metrics in release notes.
- Publish an assistant-first compatibility matrix for Copaw, OpenClaw, Codex, Claude Desktop, Cursor, and Cline.

### M2 - Differentiation

- Smart DOM understanding and dehydration pipeline.
- Remote collaboration and multi-operator workflow controls.
- Higher-level automation abstractions for repeatable business workflows.
- Automatic end-to-end browser recovery for assistant commands: daemon auto-start, Chrome auto-launch, bridge reattach, and tool-call retry when the browser is not yet running.
