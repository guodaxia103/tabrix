# Master Task Roadmap

Last updated: `2026-04-05 19:05 Asia/Shanghai`
Repo: [mcp-chrome](D:\projects\ai\codex\mcp-chrome)
Branch: `codex/phase0-stabilization`

This document is the master task roadmap for the project.
It is based on:

- current code state in the local repo
- completed hardening work on `codex/phase0-stabilization`
- our earlier product discussions about commercialization
- the Phase 0 delivery target: stable, easy to install, easy to diagnose, and easy to use

Status legend:

- `[x]` completed
- `[~]` in progress / partially completed
- `[ ]` planned / not started
- `[!]` blocked / needs product decision

## 1. Product Direction

The product should not stay positioned as only a Chrome MCP bridge.

Target direction:

- local-first browser execution platform
- reuse real Chrome and real login state
- first-class MCP integration for AI assistants
- stable enough for repeated production-style browser tasks
- good diagnostics and observability
- eventually extensible with memory, strategy, templates, and local models

Short product framing:

- `Phase 0`: make the base stable and deliverable
- `Phase 1`: make it an execution platform
- `Phase 2`: add memory, strategy, templates, and local intelligence
- `Phase 3`: make it a pilot-ready and commercializable product

## 2. Current Code Reality

### Already solid enough to build on

- `[x]` native-server / extension / native messaging architecture is intact
- `[x]` major MCP transport/session reuse bug was fixed
- `[x]` repeated MCP initialize is stable in real local testing
- `[x]` popup state and native diagnostics are much better than before
- `[x]` `status`, `doctor`, and `smoke` commands exist
- `[x]` Windows native host registration flow is more resilient
- `[x]` unpacked-extension ID drift issue was fixed by dynamic `allowed_origins`
- `[x]` stable quickstart and CoPaw integration docs exist
- `[x]` a first CoPaw MCP browser skill exists

### Still unfinished in the current codebase

- `[~]` not every public tool has completed live validation
- `[~]` smoke still has a couple of tail issues
- `[~]` extension runtime noise from test pages still needs cleanup
- `[~]` `report` is not yet as strong as `doctor`
- `[~]` client compatibility is not fully documented or matrixed
- `[~]` install flow is better, but not yet beginner-perfect
- `[ ]` execution logs / trace / screenshot / error-code standards are not fully organized
- `[ ]` richer per-tool policy and governance are not yet in place

## 3. Task Layers

The roadmap is organized into 7 layers:

1. `Phase 0 Delivery Base`
2. `Execution Platform Core`
3. `Validation and Compatibility`
4. `Docs, Skills, and Onboarding`
5. `Memory, Strategy, and Workflow`
6. `Commercial Delivery Readiness`
7. `Longer-Term Productization`

## 4. Phase 0 Delivery Base

This is the highest priority layer right now.

### 4.1 MCP transport and session hardening

- `[x]` remove global MCP server reuse for HTTP/SSE
- `[~]` cleanly extract session registry and transport modeling
- `[x]` reduce `ERR_HTTP_HEADERS_SENT` class failures
- `[~]` add broader regression coverage for SSE and parallel sessions
- `[ ]` explicitly document transport behavior for HTTP / SSE / stdio

### 4.2 Native host and extension startup stability

- `[x]` strengthen native host diagnostics
- `[x]` improve popup connect/refresh state behavior
- `[x]` fix unpacked extension ID / allowed origin drift
- `[~]` reduce ambiguous “connected but not started” edge cases further
- `[ ]` formalize server state machine across native host, popup, and CLI

### 4.3 Installation and environment resilience

- `[x]` improve Windows registration/admin/build behavior
- `[x]` reduce build cleanup fragility
- `[~]` continue hardening dev and optional dependency behavior
- `[ ]` verify startup/install flow from a clean machine checklist
- `[ ]` produce a pilot-ready installation checklist and packaging note

### 4.4 Diagnostics and supportability

- `[x]` `status`
- `[x]` `doctor`
- `[x]` `smoke`
- `[~]` strengthen `report`
- `[ ]` define minimum support bundle contents
- `[ ]` unify runtime logs, trace references, screenshots, and error codes

## 5. Validation and Compatibility

This is the second-highest priority layer now.

### 5.1 Public tool validation

Required rule:

- every public MCP tool must have at least one real environment validation result

Current board:

- [PHASE0_TOOL_VALIDATION_MATRIX.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_TOOL_VALIDATION_MATRIX.md)

Tasks:

- `[~]` complete live MCP validation for all remaining tools
- `[~]` re-check tools that currently show `warn`
- `[ ]` link each `warn/fail` to either a fix or a documented limitation

### 5.2 High-value browser scenarios

Validate not only tools, but also user goals:

- `[ ]` open page -> verify URL/title
- `[ ]` read page -> summarize
- `[ ]` locate element -> click
- `[ ]` fill form -> verify result
- `[ ]` screenshot after operation
- `[ ]` network capture for debugging
- `[ ]` tab switching and cleanup

### 5.3 Client compatibility matrix

Need explicit compatibility docs for:

- `[~]` Chrome popup direct usage
- `[~]` CoPaw
- `[ ]` Claude Desktop
- `[ ]` Claude Code
- `[ ]` Cursor
- `[ ]` MCP Inspector / curl
- `[ ]` stdio consumers

Output needed:

- compatibility table
- recommended transport per client
- known caveats

## 6. Docs, Skills, and Onboarding

This is also a near-term priority because the product must be easy for beginners.

### 6.1 Documentation system

- `[x]` stable quickstart
- `[x]` CoPaw guide
- `[x]` dated task board
- `[x]` master tracker
- `[~]` troubleshooting guide expansion
- `[~]` better “first successful task” flow
- `[ ]` one-page pilot delivery checklist
- `[ ]` FAQ for common failures
- `[ ]` “what to do when popup says X” troubleshooting table

### 6.2 Skills

- `[x]` `copaw-mcp-browser` skill created
- `[~]` expand skill with more reliable browser-operation recipes
- `[ ]` add examples for read-plan-act-verify workflows
- `[ ]` add explicit fallback logic for missing elements / unexpected pages
- `[ ]` document how to pair CoPaw prompts with the skill

### 6.3 Beginner usability

- `[ ]` ensure install -> connect -> verify -> first task fits in a short path
- `[ ]` reduce number of places a user must inspect manually
- `[ ]` make errors actionable with “next step” language

## 7. Execution Platform Core

This is the next major engineering phase after Phase 0 closes.

### 7.1 Execution core

Goal:

- move from a raw tool bridge to a task/session execution core

Tasks:

- `[ ]` define `Task`, `ExecutionSession`, `ExecutionStep`, `ExecutionResult`
- `[ ]` add task/session manager in native-server
- `[ ]` normalize tool call results
- `[ ]` add retry and failure policy
- `[ ]` attach artifacts such as screenshots / HTML / network summaries to task runs

### 7.2 Unified observability

- `[ ]` task-level structured logs
- `[ ]` step-level success/failure records
- `[ ]` artifact references
- `[ ]` error-code catalog
- `[ ]` report bundle generation from task context

## 8. Memory, Strategy, and Workflow

This is where the product becomes differentiated.

### 8.1 Memory engine

- `[ ]` choose initial local DB shape, likely SQLite first
- `[ ]` store task history
- `[ ]` store page fingerprints
- `[ ]` store selector success history
- `[ ]` store failure reasons and wait timings
- `[ ]` use history to recommend better selectors and action order

### 8.2 Strategy engine

- `[ ]` per-site strategy configs
- `[ ]` page-type rules
- `[ ]` popup closing rules
- `[ ]` login-state detection rules
- `[ ]` risk-page fallback rules
- `[ ]` retry/wait policies by site

### 8.3 Workflow and templates

- `[ ]` upgrade record-replay into parameterized templates
- `[ ]` input schema support
- `[ ]` conditional nodes
- `[ ]` retry nodes
- `[ ]` human confirmation nodes
- `[ ]` reusable business templates

## 9. Local Model Integration

This should be introduced as an enhancement layer, not by rewriting the whole native server immediately.

Tasks:

- `[ ]` define a separate local-model service boundary
- `[ ]` page summary capability
- `[ ]` page intent classification
- `[ ]` structured info extraction
- `[ ]` selector ranking assistance
- `[ ]` failure replay / post-mortem summary

Non-goal for now:

- `[ ]` do not rewrite the full native server to Python first unless product needs justify it later

## 10. Commercial Delivery Readiness

These tasks matter once Phase 0 stability is good enough.

### 10.1 Pilot delivery package

- `[ ]` stable install checklist
- `[ ]` known-environment checklist
- `[ ]` supported client matrix
- `[ ]` troubleshooting bundle instructions
- `[ ]` demo workflow set

### 10.2 Governance and safety

- `[x]` minimal allow/deny tool filtering
- `[~]` initial MCP annotations
- `[ ]` richer per-tool policy model
- `[ ]` domain restrictions / sensitive tool controls
- `[ ]` audit-friendly task records

### 10.3 Team-facing productization

- `[ ]` issue priority tracker
- `[ ]` internal acceptance checklist per release
- `[ ]` demo script for pilot customers
- `[ ]` operator runbook

## 11. Longer-Term Productization

Not immediate, but important to keep in view.

### 11.1 Admin and ops console

- `[ ]` local web control panel
- `[ ]` task list and task replay
- `[ ]` logs and screenshot inspection
- `[ ]` strategy/template management

### 11.2 Business templates

- `[ ]` e-commerce operations template set
- `[ ]` social/content operations template set
- `[ ]` recruiting/search template set
- `[ ]` backend admin automation template set

### 11.3 Enterprise features

- `[ ]` pilot packaging for private deployment
- `[ ]` team/project concepts
- `[ ]` permission model
- `[ ]` audit exports

## 12. Recommended Working Order

Recommended sequence from here:

### Immediate

1. `[ ]` finish all remaining Phase 0 live tool validation
2. `[ ]` finish CoPaw high-value browser validation
3. `[ ]` clean up smoke tail issues and runtime noise
4. `[ ]` strengthen `report`
5. `[ ]` improve beginner install and troubleshooting docs
6. `[ ]` finish pilot-ready installation/checklist docs

### Next

7. `[ ]` define execution core objects and task/session model
8. `[ ]` define observability baseline
9. `[ ]` publish compatibility matrix
10. `[ ]` define initial memory and strategy schema

### After that

11. `[ ]` add workflow templates
12. `[ ]` add local-model enhancement layer
13. `[ ]` shape pilot delivery package
14. `[ ]` begin admin/ops surface design

## 13. Morning Review Files

If you want the fastest review path later:

1. [2026-04-05-phase0-tasks.md](D:\projects\ai\codex\mcp-chrome\docs\2026-04-05-phase0-tasks.md)
2. [MASTER_TASK_ROADMAP.md](D:\projects\ai\codex\mcp-chrome\docs\MASTER_TASK_ROADMAP.md)
3. [PHASE0_TOOL_VALIDATION_MATRIX.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_TOOL_VALIDATION_MATRIX.md)
4. [STABLE_QUICKSTART.md](D:\projects\ai\codex\mcp-chrome\docs\STABLE_QUICKSTART.md)
5. [COPAW.md](D:\projects\ai\codex\mcp-chrome\docs\COPAW.md)

This roadmap should be treated as the long-lived source of truth.
