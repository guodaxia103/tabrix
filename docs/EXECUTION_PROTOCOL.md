# Execution Protocol

Last updated: `2026-04-06 09:15 Asia/Shanghai`

This document defines how long-running work must be executed so tasks do not silently stall.

This is not a feature roadmap.
It is the operating protocol for making progress visible, recoverable, and continuous.

## 1. Goal

The goal is to prevent this failure mode:

- a large task is planned
- work starts
- some parts are completed
- progress becomes hard to see
- a blocker appears
- no clear handoff or next step is left behind

From now on, every long-running task should leave behind:

- visible progress
- small verified commits
- explicit blockers
- a clear next action

## 2. Core Rules

### Rule 1: Every workday gets one dated task board

For each working date, create exactly one dated task file:

- `docs/YYYY-MM-DD-*.md`

This file becomes the single source of truth for that day.

It must include:

- goals
- task checklist
- current status
- blocker list
- completed work
- next actions

### Rule 2: No invisible progress

If work happens, it must show up in at least one of these places:

- a commit
- the dated task board
- a handoff/blocker section

If none of these changed, the work is not considered visible progress.

### Rule 3: Small verified commits only

When a fix or doc change is verified, commit it separately.

Default unit of work:

- one validated fix = one commit
- one validated doc pack = one commit
- one stable environment/diagnostic improvement = one commit

Do not keep large piles of validated work unstaged or uncommitted.

### Rule 4: Blockers must time out

If a task is blocked for too long, do not stay on it indefinitely.

Required response:

1. record the blocker in the dated task board
2. record what was tried
3. record the current best hypothesis
4. switch to the highest-value unblocked task

The blocker must become visible, not hidden inside working memory.

### Rule 5: Every stop point requires handoff notes

Before stopping for any reason, the dated task board must say:

- what was completed
- what is still in progress
- what is blocked
- the next smallest concrete action

This allows immediate resume without re-discovery.

## 3. Required Sections In Each Dated Task Board

Every dated task board must contain these sections:

### A. Goals

What must be achieved today.

### B. Task Checklist

All planned tasks for the day.

Statuses:

- `[x]` completed
- `[~]` in progress
- `[ ]` not started
- `[!]` blocked

### C. Completed Today

Short list of finished items.

### D. Active Blockers

For each blocker:

- symptom
- what was tried
- current hypothesis
- next recovery step

### E. Next Actions

The next smallest concrete steps, not vague goals.

### F. Validation

What was actually tested:

- build
- unit tests
- live test
- CoPaw test
- docs verification

## 4. Commit Discipline

### Required commit behavior

Commit after:

- a verified fix
- a verified doc update
- a verified environment improvement

Do not wait for “everything” to finish.

### Allowed uncommitted work

Uncommitted changes are allowed only when:

- the work is still being verified
- the change cannot yet be cleanly split

If uncommitted changes remain, they must be listed in the dated task board.

## 5. Blocker Management

A blocker is not just “something failed”.

A blocker becomes formal when:

- the same issue prevents progress across multiple attempts, or
- the issue prevents continuing the current critical path

When that happens, log it in the task board with this shape:

```md
### Blocker: short name

- Symptom:
- Tried:
- Hypothesis:
- Next step:
```

## 6. Validation Ladder

Each change should be validated at the highest reasonable level.

Preferred order:

1. static check / build
2. targeted test
3. live local runtime test
4. real Chrome extension test
5. CoPaw end-to-end test

If higher-level validation is blocked, record that explicitly.

## 7. Daily Resume Protocol

At the start of a new workday:

1. open the latest dated task board
2. open the master roadmap
3. check `git status`
4. check the last 10 commits
5. resume from the `Next Actions` section

Do not restart from scratch unless the board is missing or clearly wrong.

## 8. Escalation Rules

When a task cannot be finished in the current pass:

- do not pretend it is done
- do not leave it only in chat history
- move it into:
  - blocker list
  - tomorrow's dated board
  - master roadmap if it is not a one-day item

## 9. Definition of “Continuous Execution”

Work counts as continuous only if all are true:

- the dated task board is current
- validated fixes are committed
- blockers are recorded
- next actions are explicit

If any of these is missing, continuity is broken.

## 10. Immediate Adoption

From now on, the project should use:

- [MASTER_TASK_ROADMAP.md](D:\projects\ai\codex\mcp-chrome\docs\MASTER_TASK_ROADMAP.md)
- dated daily task boards
- this protocol

This protocol takes priority over ad-hoc working style.
