# Skills Stack

Last updated: `2026-04-06 12:50 Asia/Shanghai`

This document records the local skill stack being used to improve execution continuity and delivery quality.

## Installed From GitHub

### `note`

Source:

- `Yeachan-Heo/oh-my-codex`
- installed into `C:\Users\guo\.codex\skills\note`

Why it was selected:

- lightweight
- directly useful for compaction resilience
- does not require the full OMX runtime to be conceptually useful

Why the rest of `oh-my-codex` was not blindly installed:

- many skills assume OMX-specific runtime, state tools, slash commands, or team orchestration that do not cleanly map to the current Windows + Codex desktop + `mcp-chrome` environment
- we only want skills that improve reliability immediately

## Custom Local Skills

### `continuous-execution`

Path:

- `C:\Users\guo\.codex\skills\continuous-execution`

Purpose:

- force durable state for long-running work
- require dated task boards, blocker tracking, explicit next actions, and visible progress

### `github-delivery-loop`

Path:

- `C:\Users\guo\.codex\skills\github-delivery-loop`

Purpose:

- force small verified commits and push checkpoints
- prevent invisible piles of validated local work
- keep long-running repo work reviewable and handoff-friendly

## Existing GitHub Capabilities Already Available

These were already present and do not need separate installation:

- `github:github`
- `github:gh-fix-ci`
- `github:gh-address-comments`
- `github:yeet`

These cover most GitHub-side triage, CI, review-thread, and publish workflows.

## Operating Principle

The skill stack is intentionally layered:

1. `note` for light durable memory
2. `continuous-execution` for task continuity
3. `github-delivery-loop` for shipping cadence
4. built-in GitHub skills for repo/PR/CI workflows

This avoids adopting a heavy external workflow system wholesale while still improving long-task reliability.
