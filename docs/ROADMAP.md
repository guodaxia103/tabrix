# Tabrix Public Roadmap

This document describes the public product direction for Tabrix.

It is intended to answer a simple question:

> If Tabrix keeps winning, what does it become next?

This is a public roadmap, not a dated delivery promise.
It should stay ambitious enough to attract contributors, but grounded enough to match the current codebase and public product surface.

## Product Direction

Tabrix is building toward a clear position:

> The browser automation execution layer for AI assistants that need to operate a user's real Chrome session.

That means we are not primarily trying to become:

- another generic browser automation framework
- another workflow SaaS
- another browser IDE
- another "spin up a fresh browser every time" runtime

## Why This Direction Matters

The strongest advantage in this repository is not "browser control" by itself.
It is the combination of:

- real logged-in Chrome session reuse
- MCP-native access for AI assistants
- local-first deployment with optional remote access
- diagnostics and recovery for day-to-day operation

This is the path most likely to make Tabrix uniquely useful for Codex, Claude Desktop, Cursor, Cline, and similar MCP-connected assistants.

## Now

Current near-term priorities:

- make `Streamable HTTP` and `stdio` the most reliable MCP entry paths
- improve reconnect, diagnostics, and install recovery
- reduce first-success friction for new users and contributors
- keep the public docs tightly aligned with the actual code surface

In public terms, this is about making Tabrix easier to trust, easier to install, and easier to use in a real browser workflow.

## Next

Once the main connection path is stable, the next major product upgrades are:

- structured page snapshots instead of long noisy page text by default
- MKEP Memory-backed run history (Session / Task / Step viewers in the sidepanel)
- MKEP Knowledge expansion beyond the GitHub seed (URL catalogue, menu / region / API knowledge for additional sites)
- MKEP Policy risk-tier gating for every P3-classified tool, with an explicit opt-in flow exposed via MCP
- stronger real-browser MCP E2E coverage and fixture-based regression testing
- browser auto-launch and recovery when an assistant calls Tabrix and Chrome is not ready
- better locator stability through fingerprinting, fallback chains, and more deterministic targeting

These upgrades matter because they improve success rate, reduce token cost, and make browser actions more predictable.

## Later

Longer-term public directions:

- MKEP Experience reuse: per-site reusable recipes that let repeated tasks skip redundant page reads
- community sharing / import / export of Experience packs
- replay artifacts for failed flows and nightly regression diagnosis
- safer team collaboration and multi-operator browser workflows
- richer higher-level automation layers built on top of the stable MCP execution path

These directions are strategically important, but they should not outrun the current reliability foundation.

Detailed sprint plans and owner-lane briefs are maintained outside the public repository.

## What We Will Not Prioritize First

To keep the product sharp, Tabrix should not drift into headline messaging such as:

- "all-in-one agent operating system"
- "default workflow builder"
- "semantic search product"
- "general-purpose browser IDE"

Some related subsystems exist in the repository, but they are not the current public center of gravity.

For the current public boundary, read:

- [PRODUCT_SURFACE_MATRIX.md](PRODUCT_SURFACE_MATRIX.md)
- [USE_CASES.md](USE_CASES.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)

## How To Contribute To The Roadmap

High-value contribution areas right now:

- reliability and reconnect behavior
- first-success onboarding and install quality
- structured browser reading and extraction
- fixture sites, smoke coverage, and regression evidence
- tool schema clarity and client integration quality

If you want to help shape a roadmap item, open an issue with:

- the user problem
- the proposed behavior
- affected modules
- the smallest verifiable success condition
