# Tabrix Product Surface Matrix

This document defines the current public product surface for Tabrix.

Its purpose is to keep product planning, engineering work, docs, and open source collaboration aligned around the same question:

> What is part of the current public product, what is experimental, and what should not be presented as the default public surface?

## Why This Exists

Tabrix contains more code than the current public product surface.

The repository includes browser execution, MCP transport, diagnostics, record/replay internals, agent related modules, semantic/vector utilities, and other subsystems. That does not mean every subsystem should be described as a current public product pillar.

This matrix is the public source of truth for capability classification.

## Tier Definitions

| Tier | Meaning | External Positioning |
| | | |
| `GA` | Stable, public, and expected to work for normal users and contributors | Safe to present as default product surface |
| `Beta` | Publicly visible and strategically important, but still improving in reliability or coverage | Present with clear expectations and boundaries |
| `Experimental` | Useful for contributors or internal exploration, but not part of the default public product promise | Mention only with caution |
| `Internal` | Not part of the public product surface | Do not present as default public capability |

## Current Capability Matrix

| Capability Area | Tier | Why It Matters |
| | | |
| Real Chrome execution via extension | `GA` | Core product value and main differentiator |
| MCP transport via `stdio` | `GA` | Tier 1 assistant integration path |
| MCP transport via `Streamable HTTP` | `GA` | Tier 1 remote and local service path |
| Browser tool execution (`read`, `navigate`, `click`, `fill`, screenshots, network helpers) | `GA` | Core daily use capability |
| Runtime diagnostics (`status`, `doctor`, `smoke`, `report`) | `GA` | Required for trust, support, and operations |
| Remote access with token based control | `Beta` | High strategic value, but still needs continued hardening |
| Policy risk tier gating (P0–P3, explicit opt in for P3) | `Beta` | MKEP Policy layer guardrail for assistant driven sessions |
| Knowledge Registry (GitHub site profile + HVO classifier, data ified) | `Beta` | MKEP Knowledge layer seed for registry first page understanding |
| Memory persistence (Session / Task / Step / PageSnapshot / Action in SQLite) | `Beta` | MKEP Memory layer; survives SW / native server restarts |
| Multi client compatibility guidance | `Beta` | Important for adoption, but should not outrun core reliability |
| Sidepanel Memory / Knowledge / Experience tabs (placeholders) | `Experimental` | Stage 3x viewers for the MKEP data layers |
| Experience reuse / locator fallback / memory like recovery helpers | `Experimental` | Strong future direction, but not yet a default public promise |
| Internal review systems, acceptance evidence, nightly reports, PM execution docs | `Internal` | Governance material, not public product surface |

### Removed surfaces (no longer part of the public product story)

The following surfaces are not part of the current public product story. They
must not be reintroduced or marketed as public capability without an explicit
owner decision.

| Capability Area | Status (since Unreleased) | Replacement / Follow up |
| | | |
| Smart Assistant (sidepanel AgentChat + Quick Panel + Codex/Claude engines) | Removed | Upstream MCP clients (Codex, Claude, Cursor, Cline) drive Tabrix directly |
| Element Picker MCP tool (`element_picker`) and Element Marker management UI | Removed | Superseded by MKEP Knowledge UIMap (Stage 3d) |
| Visual Editor (`web editor v2`) | Removed | Out of scope for MKEP execution layer |
| Record Replay v2 / v3 workflow engine, builder, and `run_flow` / `list_published_*` | Removed | Superseded by MKEP Experience layer (Stage 4) — design not yet frozen |
| Local semantic engine + ONNX WASM workers + `search_tabs_content` | Removed | Will be re introduced only behind a dedicated offscreen entry if and when Knowledge / Memory semantic search ships |

## Public Story We Should Keep Repeating

Today, Tabrix should primarily be described as:

1. A way to turn a real daily Chrome session into an AI executable runtime
2. A browser automation layer exposed through MCP
3. A local first and remotely callable system with diagnostics and recovery

It should not primarily be described as:

a general workflow SaaS
a browser IDE
an all in one agent operating system
a semantic search product

## Planning Rules

When choosing what to build next:

1. Prefer improving `GA` reliability before expanding `Experimental` scope
2. Do not market `Experimental` modules as default public product surface
3. If a feature is externally visible but unstable, classify it as `Beta`, not `GA`
4. If a subsystem exists mainly to support future directions, keep it out of the headline product story until it has a stable user path

## Related Docs

`README.md`
`WHY_MCP_CHROME.md`
`ARCHITECTURE.md`
`PROJECT_STRUCTURE.md`
`TESTING.md`
`PLATFORM_SUPPORT.md`
`ROADMAP.md` — public product direction after the pruning pass
