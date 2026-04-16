# Tabrix Product Surface Matrix

This document defines the current public product surface for Tabrix.

Its purpose is to keep product planning, engineering work, docs, and open-source collaboration aligned around the same question:

> What is part of the current public product, what is experimental, and what should not be presented as the default public surface?

## Why This Exists

Tabrix contains more code than the current public product surface.

The repository includes browser execution, MCP transport, diagnostics, record/replay internals, agent-related modules, semantic/vector utilities, and other subsystems. That does not mean every subsystem should be described as a current public product pillar.

This matrix is the public source of truth for capability classification.

## Tier Definitions

| Tier | Meaning | External Positioning |
| --- | --- | --- |
| `GA` | Stable, public, and expected to work for normal users and contributors | Safe to present as default product surface |
| `Beta` | Publicly visible and strategically important, but still improving in reliability or coverage | Present with clear expectations and boundaries |
| `Experimental` | Useful for contributors or internal exploration, but not part of the default public product promise | Mention only with caution |
| `Internal` | Not part of the public product surface | Do not present as default public capability |

## Current Capability Matrix

| Capability Area | Tier | Why It Matters |
| --- | --- | --- |
| Real Chrome execution via extension | `GA` | Core product value and main differentiator |
| MCP transport via `stdio` | `GA` | Tier-1 assistant integration path |
| MCP transport via `Streamable HTTP` | `GA` | Tier-1 remote and local service path |
| Browser tool execution (`read`, `navigate`, `click`, `fill`, screenshots, network helpers) | `GA` | Core daily use capability |
| Runtime diagnostics (`status`, `doctor`, `smoke`, `report`) | `GA` | Required for trust, support, and operations |
| Remote access with token-based control | `Beta` | High strategic value, but still needs continued hardening |
| Record-replay v3 execution core | `Beta` | Important reuse direction, but not yet the main onboarding surface |
| Visual editor | `Beta` | Useful product surface, but not the center of current positioning |
| Multi-client compatibility guidance | `Beta` | Important for adoption, but should not outrun core reliability |
| Experience reuse / locator fallback / memory-like recovery helpers | `Experimental` | Strong future direction, but not yet a default public promise |
| Workflow UI as a default product surface | `Experimental` | Code exists, but should not define the public story today |
| Agent / sidepanel assistant surface | `Experimental` | Present in code, not the main public product promise |
| Local semantic indexing / vector-heavy AI features | `Experimental` | Technically interesting but not a primary public positioning pillar |
| Internal review systems, acceptance evidence, nightly reports, PM execution docs | `Internal` | Governance material, not public product surface |

## Public Story We Should Keep Repeating

Today, Tabrix should primarily be described as:

1. A way to turn a real daily Chrome session into an AI-executable runtime
2. A browser automation layer exposed through MCP
3. A local-first and remotely callable system with diagnostics and recovery

It should not primarily be described as:

- a general workflow SaaS
- a browser IDE
- an all-in-one agent operating system
- a semantic search product

## Planning Rules

When choosing what to build next:

1. Prefer improving `GA` reliability before expanding `Experimental` scope
2. Do not market `Experimental` modules as default public product surface
3. If a feature is externally visible but unstable, classify it as `Beta`, not `GA`
4. If a subsystem exists mainly to support future directions, keep it out of the headline product story until it has a stable user path

## Related Docs

- `README.md`
- `WHY_MCP_CHROME.md`
- `ARCHITECTURE.md`
- `PROJECT_STRUCTURE.md`
- `TESTING.md`
- `PLATFORM_SUPPORT.md`
