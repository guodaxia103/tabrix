# Phase 0 OMX Sprint Plan

Last updated: `2026-04-06 17:05 Asia/Shanghai`

This is the approved OMX-style execution plan for closing the current Phase 0 goals.

Target goals:

0. `mcp-chrome` is stable, easy to use, and deliverable
1. all public `mcp-chrome` tool methods are live-tested
2. CoPaw re-tests the high-value tool surface and gains a better browser skill
3. the beginner install and usage manual is handoff-quality

## RALPLAN Summary

### Principles

1. Close Phase 0 by acceptance gates, not by volume of changes
2. Prefer structured browser evidence over screenshots whenever possible
3. Treat blocker removal as higher priority than new feature work
4. Keep every verified unit independently commit-worthy

### Decision Drivers

1. Fastest path to a truly deliverable Phase 0
2. Lowest-risk validation coverage expansion
3. Clear handoff package for non-expert users

### Viable Options

#### Option A: Keep splitting time between Program 1 and remaining Phase 0 validation

Pros:

- execution platform keeps advancing

Cons:

- Phase 0 stays half-open
- user-facing acceptance remains ambiguous

#### Option B: Freeze new platform work and finish the four Phase 0 goals end-to-end

Pros:

- shortest path to a stable deliverable
- user-facing quality improves fastest
- avoids more drift

Cons:

- Program 1 code growth pauses briefly

### Decision

Choose **Option B** until the current Phase 0 gate is genuinely closed.

## Ralph Lane

Single-owner persistent lane:

- keep Phase 0 as the top priority
- do not reopen broader platform work unless it directly helps one of the four goals
- keep verifying after each unit

## Team Lanes

Parallelizable side lanes:

### Lane 1: Remaining Tool Validation

Focus:

- resolve remaining `pending` and `warn` entries
- clearly classify hidden/deprecated vs real failures

### Lane 2: CoPaw Validation and Skill Improvement

Focus:

- expand CoPaw coverage to interaction-heavy tools
- improve `copaw-mcp-browser` prompts, fallback logic, and guidance

### Lane 3: Beginner Handoff Docs

Focus:

- one short install path
- one short validation path
- reconnect/reload FAQ
- first-task walkthrough

## Acceptance Gates

Phase 0 closes only when:

1. browser install/restart/connect path is stable
2. all public tools have a live validation result or explicit de-scope decision
3. CoPaw has a credible high-value re-test set plus improved skill guidance
4. docs are good enough for a beginner handoff

## Immediate Execution Order

1. finish remaining direct tool validations
2. classify remaining fail/warn items
3. expand CoPaw validation on interaction flows
4. polish beginner docs into a final handoff package
