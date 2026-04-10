# Program 1 / Phase 1 Approved Plan

Last updated: `2026-04-09 11:20 Asia/Shanghai`

This document is the approved development plan for **Program 1: Execution Platform Core**.

It follows the OMX framing established in [OMX_REORG_PLAN.md](D:\projects\ai\codex\mcp-chrome\docs\OMX_REORG_PLAN.md).

The purpose of Program 1 is to turn `mcp-chrome` from a raw browser tool bridge into a real execution platform with task/session structure, normalized outcomes, artifacts, and recoverable state.

## 1. Program 1 Goal

Primary question:

**Can `mcp-chrome` become a real browser execution system rather than only a bundle of tools?**

Program 1 is successful when the platform can represent, track, and explain a browser task as a structured execution session instead of a loose sequence of independent tool calls.

## 2. Scope

Program 1 includes:

- task model
- session model
- step model
- normalized result model
- artifact capture and references
- retry and recovery policy
- execution audit trail
- rule-based DOM understanding and dehydration contract for tool outputs

Program 1 does **not** include:

- site strategy engine
- memory/fingerprint recommendations
- local model intelligence
- enterprise auth/permissions model
- full control panel
- vision-model-first page parsing pipeline

Those belong to later programs.

## 3. Design Principle

Program 1 must preserve the current working `mcp-chrome` base:

- extension remains the browser execution layer
- native server remains the MCP-facing coordinator
- current tools still execute
- current record-replay capability remains intact

Program 1 adds a structured execution layer **above** current tool dispatch.

## 4. Core Objects

## 4.1 Task

Represents the user-intent unit.

Suggested fields:

- `task_id`
- `task_type`
- `title`
- `intent`
- `origin`
- `created_at`
- `updated_at`
- `status`
- `owner`
- `project_id` (optional)
- `labels`

Typical statuses:

- `pending`
- `running`
- `completed`
- `failed`
- `cancelled`

## 4.2 Execution Session

Represents one concrete run of a task.

Suggested fields:

- `session_id`
- `task_id`
- `transport`
- `client_name`
- `started_at`
- `ended_at`
- `status`
- `workspace_context`
- `browser_context`
- `summary`

Typical statuses:

- `starting`
- `running`
- `completed`
- `failed`
- `aborted`

## 4.3 Execution Step

Represents one tool call or logical action inside a session.

Suggested fields:

- `step_id`
- `session_id`
- `index`
- `tool_name`
- `step_type`
- `input_summary`
- `result_status`
- `started_at`
- `ended_at`
- `error_code`
- `error_summary`
- `artifact_refs`

Typical step types:

- `tool_call`
- `flow_call`
- `verification`
- `retry`
- `recovery`

## 4.4 Execution Result

Provides a normalized result for users, clients, and logs.

Suggested fields:

- `status`
- `summary`
- `data`
- `warnings`
- `errors`
- `artifacts`
- `next_actions`

## 5. Module Plan

## Module A: Execution Core

Location suggestion:

- `app/native-server/src/execution`

Responsibilities:

- construct task/session/step models
- open and close execution sessions
- route tool calls through a common session-aware layer
- normalize results

Suggested files:

- `task-manager.ts`
- `session-manager.ts`
- `step-runner.ts`
- `result-normalizer.ts`
- `types.ts`

## Module B: Artifact Layer

Location suggestion:

- `app/native-server/src/artifacts`

Responsibilities:

- register screenshots, html dumps, network summaries, and other evidence
- return stable references in results and logs
- avoid bloating primary responses with raw artifacts

Suggested files:

- `artifact-store.ts`
- `artifact-types.ts`
- `artifact-ref.ts`

## Module C: Audit and Logs

Location suggestion:

- `app/native-server/src/audit`

Responsibilities:

- structured task/session/step logging
- durable execution trail
- mapping user-visible failures to traceable records

Suggested files:

- `audit-log.ts`
- `error-catalog.ts`
- `session-summary.ts`

## Module D: Retry and Recovery

Location suggestion:

- `app/native-server/src/recovery`

Responsibilities:

- narrow retry policy for transient failures
- classify retryable vs non-retryable failures
- surface recovery decisions clearly

Suggested files:

- `retry-policy.ts`
- `failure-classifier.ts`
- `recovery-runner.ts`

## Module E: Flow Integration Adapter

Location suggestion:

- `app/native-server/src/workflow`

Responsibilities:

- let current flow/record-replay tools run inside structured execution sessions
- treat dynamic flow tools as first-class execution steps

Suggested files:

- `flow-adapter.ts`
- `flow-session-bridge.ts`

## Module F: DOM Understanding and Dehydration

Location suggestion:

- `app/chrome-extension/inject-scripts`
- `app/chrome-extension/entrypoints/background/tools/browser`
- `app/native-server/src/execution`

Responsibilities:

- provide task-oriented DOM output modes (`compact`, `normal`, `full`)
- expose structured output shape (`page -> region -> actionable node`)
- attach candidate confidence and fallback locator chain to execution artifacts
- ensure compatibility with existing `chrome_read_page` callers

Suggested files:

- `read-page-v2.ts` (or `read-page.ts` extension)
- `dom-dehydration-schema.ts`
- `locator-fallback-policy.ts`
- `dom-summary-artifact.ts`

## 6. Sequencing

Program 1 should be delivered in this order:

### Phase 1.1: Execution Skeleton

Build:

- core types
- session lifecycle
- minimal task/session/step creation
- session-aware wrapper for tool calls

Acceptance:

- a tool call can be represented as a session with at least one step
- current MCP behavior still works

### Phase 1.2: Result Normalization

Build:

- normalized success/failure result shape
- warnings/errors structure
- consistent metadata

Acceptance:

- tool outputs can be wrapped into a common result contract
- callers can distinguish success, warning, and failure without tool-specific parsing

### Phase 1.3: Artifact References

Build:

- artifact registration
- screenshot/html/network summary references
- session-to-artifact linkage

Acceptance:

- execution session can return stable artifact refs
- artifacts do not have to be inlined into every response

### Phase 1.4: Retry and Failure Classification

Build:

- retryable error categories
- narrow automatic retry path
- failure reason normalization

Acceptance:

- repeated transient failures are handled consistently
- non-retryable failures stay explicit

### Phase 1.5: Flow Integration

Build:

- flow tools represented inside session/step model
- dynamic flow invocations included in audit trail

Acceptance:

- flow execution shows up as structured execution data, not only raw tool results

### Phase 1.6: DOM Dehydration Contract

Build:

- add `compact/normal/full` response modes for read-page outputs
- emit structured action candidates with `confidence`, `matchReason`, and `fallbackChain`
- register DOM summary as artifact ref rather than inlining large payloads

Acceptance:

- same page can return smaller task-oriented payloads than legacy output by default
- click/fill flows can consume the structured candidate contract without tool-specific parsing
- legacy `chrome_read_page` behavior remains backward compatible

## 7. Acceptance Criteria

Program 1 is done only when all are true:

- there is a real task/session/step model in code
- current tool execution still works
- results are normalized
- at least one artifact type is session-linked
- retryable failures are classified
- flow invocations can be represented inside execution state
- DOM dehydration contract is available to callers with documented modes
- action candidates provide confidence and fallback locator chain
- docs explain the new execution model clearly

## 8. Out of Scope

Do not drift into these during Program 1:

- site strategies
- selector memory
- domain templates
- model-based (LLM-driven) page understanding
- commercial UI polish

If a change is not directly helping structured execution, it should be deferred.

## 9. Risks

- over-abstracting too early and slowing down the current stable bridge
- coupling browser execution too tightly to one result format
- trying to solve strategy/memory at the same time as execution core
- storing too much raw artifact data in hot paths
- over-compressing DOM output and dropping fields needed for reliable actions

## 10. Recommended Execution Mode

Use OMX lanes like this:

- `ralph` for the first implementation loop of Program 1
- `team` only after Module A and B boundaries are stable enough to split safely

Recommended first split:

- Lane 1: execution skeleton + result normalization
- Lane 2: artifacts + audit trail
- Lane 3: retry/recovery
- Lane 4: DOM dehydration contract + locator fallback policy
- Lane 5: docs

## 11. Immediate Next Step

After Program 0 stabilizes enough, the next concrete move should be:

**Implement `chrome_read_page` structured dehydration modes (`compact/normal/full`) and wire DOM summary into execution artifacts without breaking existing callers.**

Execution issue draft:

- `docs/PROGRAM1_DOM_DEHYDRATION_TASK_LIST.md`
