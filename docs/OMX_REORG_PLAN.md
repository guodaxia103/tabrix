# OMX Reorganization Plan

Last updated: `2026-04-06 13:50 Asia/Shanghai`

This document reframes the `mcp-chrome` secondary development effort using `oh-my-codex (OMX)` workflow concepts.

The goal is to stop treating the project as a loose feature backlog and instead run it as a staged delivery program with explicit clarification, planning, execution, and verification lanes.

## 1. Project Reframe

This project is not just “continue improving a Chrome MCP extension”.

It should be treated as:

**a browser execution platform program**

with three layers:

1. **Platform layer**
   - browser execution
   - native bridge
   - MCP tools
   - diagnostics
   - workflow runtime

2. **Execution layer**
   - task/session model
   - logs and artifacts
   - retries and recovery
   - flow templates

3. **Product layer**
   - strategy and memory
   - vertical templates
   - control surface
   - enterprise/private deployment readiness

## 2. Why Use OMX Framing

OMX gives this program a better structure:

- `deep-interview` for scope clarification
- `ralplan` for approved plan creation
- `ralph` for persistent completion loops
- `team` for durable parallel execution when the work is large enough

This matters because the current project has:

- a non-trivial architecture
- platform hardening work
- productization work
- long-running validation work
- multiple possible priorities competing at once

Without staged workflow discipline, it becomes easy to mix:

- infra fixes
- product features
- experiments
- documentation
- commercial packaging

into one unstable stream.

## 3. OMX-Style Program Structure

## Phase A: `deep-interview`

Use this phase to clarify business and delivery boundaries before writing more code.

Questions this phase should answer:

- What is the first real trial scenario?
- Who is the first user?
- Which 2-3 scenarios matter first?
- What does “stable and deliverable” mean?
- Which capabilities are required for the first commercial trial?
- Which capabilities are explicitly out of scope for now?

Primary outputs:

- product boundary summary
- first-trial scenario list
- non-goals
- explicit success criteria

## Phase B: `ralplan`

Use this phase to turn the clarified scope into an approved execution blueprint.

The plan should define:

- modules
- dependencies
- priority order
- acceptance criteria
- what must be completed before the next phase starts

Primary outputs:

- approved module plan
- phased roadmap
- completion gates

## Phase C: `ralph`

Use this phase for persistent, finish-to-completion execution of one major lane at a time.

Good `ralph` lanes for this program:

1. **Phase 0 platform hardening**
2. **Execution Core**
3. **Memory and Strategy**
4. **Workflow Template system**

This is the “close the loop” mode:

- fix
- verify
- document
- commit
- record blocker or next action

## Phase D: `team`

Use this phase only when:

- tasks are cleanly separable
- shared state adds value
- a durable parallel runtime is worth the coordination overhead

Good team lanes later in the program:

- platform stability and diagnostics
- execution core
- memory and strategy
- docs and adoption
- product surface

Do not use `team` for tiny fixes or unclear work.

## 4. Updated Program Map

## Program 0: Deliverable Platform Base

Primary question:

**Can the system be installed, connected, diagnosed, and trusted?**

Required outcomes:

- stable transport/session lifecycle
- stable extension/native host behavior
- useful `doctor/status/report/smoke`
- real-world tool validation
- CoPaw integration validation
- installation and troubleshooting docs

This is the current highest priority.

## Program 1: Execution Platform Core

Primary question:

**Can this become a real execution system instead of just a tool bundle?**

Required outcomes:

- task model
- session model
- step model
- normalized result shape
- artifact/log capture
- retry/recovery policy

## Program 2: Strategy and Memory

Primary question:

**Why is this platform better than a generic browser MCP?**

Required outcomes:

- page/domain fingerprinting
- selector experience reuse
- domain/site strategy rules
- failure pattern memory
- first memory-backed recommendations

## Program 3: Workflow Templates

Primary question:

**Can repetitive browser business work be expressed as reusable templates?**

Required outcomes:

- parameterized flow templates
- branching and retry nodes
- human-confirm checkpoints
- reusable vertical task templates

## Program 4: Product Surface

Primary question:

**Can this be trialed or delivered as a product?**

Required outcomes:

- local or private control surface
- project/task visibility
- strategy/template management
- trial-ready packaging

## 5. Execution Lanes

The project should now be reasoned about in explicit lanes.

### Lane 1: Platform Stability

Scope:

- extension + native host reliability
- MCP transport/session
- doctor/status/report/smoke
- install and troubleshooting

### Lane 2: Execution Core

Scope:

- task/session/step primitives
- result normalization
- artifact and audit capture
- recovery logic

### Lane 3: Strategy and Memory

Scope:

- SQLite or local store
- page fingerprints
- best-known selector reuse
- domain strategies

### Lane 4: Workflow Templates

Scope:

- record-replay evolution
- flow parameterization
- conditional execution
- reusable scenario templates

### Lane 5: Docs and Adoption

Scope:

- quickstart
- troubleshooting
- CoPaw guide
- trial checklist
- skills and operator guidance

## 6. Immediate Priorities

Under this OMX framing, the next priorities should be:

1. Finish Program 0 before chasing larger feature work.
2. Keep using `ralph`-style completion behavior for current Phase 0 work.
3. Delay heavy `team` usage until the platform base and task boundaries are cleaner.
4. Prepare a formal `ralplan` document for Program 1 once Phase 0 is close to complete.

## 7. Anti-Patterns

Avoid these:

- mixing platform hardening with speculative product features
- running parallel delivery before acceptance criteria are defined
- using `team` to mask unclear scope
- opening many unfinished workstreams without durable task state
- describing the project as “more browser tools” instead of “browser execution platform”

## 8. Working Rule

From now on, use this sequence by default:

1. clarify with `deep-interview` when scope is still fuzzy
2. approve with `ralplan` when architecture or sequencing matters
3. execute with `ralph` for persistent completion
4. scale with `team` only when tasks are mature enough for durable parallelism

This is the preferred operating model for the ongoing `mcp-chrome` secondary development effort.
