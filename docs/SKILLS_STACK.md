# Skills Stack

Last updated: `2026-04-06 13:15 Asia/Shanghai`

This document records the local skill stack being used to improve execution continuity and delivery quality.

## Installed From GitHub / Upstream Runtime

### `oh-my-codex` runtime

Status:

- globally installed via npm
- `omx setup` completed successfully
- `omx doctor` passes with warnings only
- Windows `psmux/tmux` backend installed
- `codex`, `omx`, and `tmux` resolution fixed for fresh PowerShell sessions

What is now directly reused:

- upstream prompts
- upstream AGENTS orchestration layer
- upstream OMX skills such as `team`, `ralph`, `ralplan`, `deep-interview`, `autopilot`
- upstream MCP/runtime wiring written into `C:\Users\guo\.codex\config.toml`

### `note`

Source:

- `Yeachan-Heo/oh-my-codex`
- installed into `C:\Users\guo\.codex\skills\note`

Why it was selected:

- lightweight
- directly useful for compaction resilience
- does not require the full OMX runtime to be conceptually useful

Why `note` was still called out separately:

- it was the first lightweight skill adopted before the full OMX runtime install
- it remains a useful low-friction memory layer even after full OMX setup

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

This now uses the upstream OMX runtime directly, while keeping a thin layer of local skills for repo-specific discipline.
