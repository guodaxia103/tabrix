# Tabrix Project Structure Guide

This guide explains where the code lives and how the main runtime paths fit together, so contributors can find the right entry point quickly.

Scope note:

- The stable public product surface is centered on browser execution through the Chrome extension plus MCP access through `Streamable HTTP` and `stdio`.
- The repository is being progressively reshaped around the MKEP layers (Memory / Knowledge / Experience / Policy). The agent / workflow / visual-editor / element-marker / local-semantic subsystems that used to live in this tree were removed in the MKEP pruning pass (see `docs/PRODUCT_PRUNING_PLAN.md` and the `Unreleased` section of `CHANGELOG.md`) and should not be expected in `main`.

Related docs:

- Architecture: `docs/ARCHITECTURE.md`
- Contributing: `CONTRIBUTING.md` (repository root)
- CLI and MCP reference: `docs/CLI_AND_MCP.md`
- Tools reference: `docs/TOOLS.md`

## 1. Repository Overview

Tabrix is a `pnpm` monorepo built around four core pieces: a Chrome extension, a local native server, a shared protocol package, and a WASM acceleration package.

```text
tabrix/
├─ app/
│  ├─ chrome-extension/    # Browser extension that executes Chrome capabilities
│  └─ native-server/       # Local Node service for CLI / MCP / Native Messaging
├─ packages/
│  └─ shared/              # Shared types, tool schemas, and cross-process contracts
├─ docs/                   # User and developer documentation
├─ scripts/                # Repo-level maintenance scripts
├─ skills/                 # Bundled Tabrix skill definitions
├─ prompt/                 # Prompt templates and references
└─ releases/               # Release notes and release assets guidance
```

> `packages/wasm-simd/` and `app/chrome-extension/workers/` (the ONNX /
> WASM bundle) were removed together with the local semantic engine.
> They are not part of the current tree.

## 2. Workspace Responsibilities

### `app/chrome-extension/`

The browser-side application. This is where Chrome APIs, DOM interaction, content scripts, and browser execution logic live. After the MKEP pruning pass the extension is deliberately small and tool-focused.

Key directories:

- `entrypoints/background/`
  - Main background runtime and bootstrap layer.
  - `index.ts` only initializes the native-host bridge. Any subsystem that needs a SW listener should mount from here.
- `entrypoints/background/tools/`
  - Browser tool implementations.
  - `browser/*.ts` contains navigation, click, keyboard, screenshot, network, JS execution, bookmarks, history, upload, and `read_page` / HVO reasoning.
- `entrypoints/background/knowledge/`
  - MKEP Knowledge layer: seed data (`seeds/`), registry (`registry/`), and lookup helpers (`lookup/`) that back registry-first page understanding and HVO classification.
- `entrypoints/background/keepalive/`
  - Generic MV3 service-worker keepalive (Offscreen Document + Port heartbeat). Relocated here from the old RR-V3 tree.
- `entrypoints/popup/`
  - Extension popup UI for connection, remote access, and host status. Previously hosted Local-Model / Element-Marker / Builder entries — all removed.
- `entrypoints/sidepanel/`
  - Side panel UI. Current tabs are Memory / Knowledge / Experience placeholders.
- `entrypoints/offscreen/`
  - Offscreen document. Now hosts only the GIF encoder and the SW keepalive port; the semantic-similarity engine was removed.
- `entrypoints/shared/`
  - UI composables and utilities shared across popup / sidepanel.
- `inject-scripts/`
  - Scripts injected into page contexts for interaction, observation, screenshots, and helpers.
- `shared/`
  - Reusable extension-side logic (selector generation, fingerprinting, screenshot helpers).
- `utils/`
  - Shared browser-side utilities (selector helpers, screenshot context, IndexedDB helpers, i18n).
- `tests/`
  - `vitest` coverage for popup state, native-host bridge, read-page / HVO, Knowledge registry, and related units.

### `app/native-server/`

The local Node service that turns extension capabilities into CLI commands, MCP endpoints, and a Native Messaging host.

Key directories:

- `src/index.ts`
  - Main process entry that wires the HTTP server to the Native Messaging host.
- `src/cli.ts`
  - CLI entry for `tabrix` and `tabrix-stdio`.
- `src/server/`
  - Fastify service layer.
  - Hosts `/ping`, `/status`, auth management, MCP transport, bridge recovery, and session tracking.
- `src/mcp/`
  - MCP server creation and tool registration.
  - `register-tools.ts` publishes tool schemas from `@tabrix/shared` and forwards execution to the extension.
- `src/native-messaging-host.ts`
  - The bidirectional bridge between Node and the extension.
- `src/scripts/`
  - CLI subcommand implementations such as `register`, `doctor`, `status`, `smoke`, `report`, `setup`, and `daemon`.
- `src/execution/`
  - Tool execution tracking and result normalization.
- `src/memory/`
  - MKEP Memory layer: SQLite schema + client + SessionManager + post-processor that persists Sessions / Tasks / Steps / PageSnapshots / Actions.
- `src/policy/`
  - MKEP Policy Phase 0: static risk-tier coverage and `requiresExplicitOptIn` gating for P3 tools.
- `src/shared/`
  - Cross-cutting helpers such as `data-dirs.ts` (the `~/.chrome-mcp-agent/` data-directory resolver that Memory depends on).

### `packages/shared/`

The shared contract between the native server and the extension.

Primary files:

- `tools.ts`: MCP tool schemas and one of the first places to touch when adding a new tool
- `types.ts` and `constants.ts`: shared cross-process contracts
- `labels.ts`: shared copy / label catalog
- `bridge-ws.ts`: the extension-to-native bridge wire protocol
- `read-page-contract.ts`: `chrome_read_page` output contract (HVO v1.0)

> The legacy `agent-types.ts` / `rr-graph.ts` / `step-types.ts` /
> `node-spec*.ts` modules were removed as part of the pruning pass.

## 3. Main Runtime Paths

### MCP Tool Execution

```text
MCP Client
  -> app/native-server/src/mcp/register-tools.ts
  -> app/native-server/src/native-messaging-host.ts
  -> app/chrome-extension/entrypoints/background/native-host.ts
  -> app/chrome-extension/entrypoints/background/tools/*
  -> Chrome APIs / content script / page
```

Use this path when debugging:

- a tool missing from MCP listing
- a tool timing out
- where a given tool is actually executed

### Extension Connection and Status

```text
popup / sidepanel
  -> background/native-host.ts
  -> chrome.runtime.connectNative(...)
  -> native-server/src/native-messaging-host.ts
  -> native-server/src/server/index.ts
```

Use this path when debugging:

- why Connect does not attach
- why remote access, token state, or port status looks inconsistent

### MKEP Memory write path

```text
MCP tool call
  -> native-server/src/mcp/register-tools.ts
  -> native-server/src/execution/* (tool post-processor)
  -> native-server/src/memory/session-manager.ts
  -> native-server/src/memory/db/client.ts (SQLite)
```

Use this path when debugging:

- why a tool invocation is not producing a Memory Action row
- where `artifactRefs` / `historyRef` are populated
- how Session / Task / Step boundaries are opened and closed

### MKEP Knowledge read path

```text
chrome_read_page
  -> background/tools/browser/read-page.ts
  -> background/knowledge/lookup/*
  -> background/knowledge/registry/* (backed by seeds/*)
  -> HVO + pageRole on the tool result
```

Use this path when debugging:

- why a page gets a specific `pageRole` / HVO labelling
- how `KNOWLEDGE_REGISTRY_MODE` (`on` / `off` / `diff`) toggles registry-first behaviour
- how to add seed data for a new site

## 4. Common Development Entry Points

### Add a browser tool

Recommended reading order:

1. `packages/shared/src/tools.ts`
2. `app/chrome-extension/entrypoints/background/tools/index.ts`
3. the matching file in `app/chrome-extension/entrypoints/background/tools/browser/*.ts`
4. `app/native-server/src/mcp/register-tools.ts`

### Change popup connection UX

Start with:

- `app/chrome-extension/entrypoints/popup/`
- `app/chrome-extension/common/popup-*.ts`
- `app/chrome-extension/entrypoints/background/native-host.ts`

### Change sidepanel behavior (MKEP viewers)

Start with:

- `app/chrome-extension/entrypoints/sidepanel/App.vue`
- `app/chrome-extension/entrypoints/sidepanel/components/` (Memory / Knowledge / Experience tab placeholders)
- `docs/ROADMAP.md` for public product direction

### Change MKEP Memory persistence

Start with:

- `app/native-server/src/memory/session-manager.ts`
- `app/native-server/src/memory/db/client.ts`
- `app/native-server/src/memory/post-processor/*`

### Change MKEP Knowledge seeds / registry

Start with:

- `app/chrome-extension/entrypoints/background/knowledge/seeds/*`
- `app/chrome-extension/entrypoints/background/knowledge/registry/*`
- `app/chrome-extension/entrypoints/background/knowledge/lookup/*`

### Change MKEP Policy risk-tier gating

Start with:

- `app/native-server/src/policy/*`
- `packages/shared/src/tools.ts` (`TOOL_RISK_TIERS` + `requiresExplicitOptIn`)

### Change auth, remote access, or server status

Start with:

- `app/native-server/src/server/auth.ts`
- `app/native-server/src/server/index.ts`
- `app/native-server/src/scripts/status.ts`
- `app/chrome-extension/entrypoints/background/native-host.ts`

## 5. Suggested Reading Order

To ramp up quickly, read in this order:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. this document
4. `packages/shared/src/tools.ts`
5. `app/native-server/src/mcp/register-tools.ts`
6. `app/chrome-extension/entrypoints/background/index.ts`
7. the concrete module you plan to change

## 6. Current Codebase Notes

- The repo currently contains four major code layers:
  - MCP service layer (`native-server/src/server`, `src/mcp`)
  - Browser execution layer (`chrome-extension/entrypoints/background/tools/*`)
  - MKEP persistence layers (Memory in `native-server/src/memory`, Knowledge in `chrome-extension/entrypoints/background/knowledge`, Policy in `native-server/src/policy`)
  - CLI / diagnostics (`native-server/src/scripts`)
- `packages/shared/` is the key stability boundary. Any change to tool schemas, risk tiers, or cross-process types should usually start there.
- The previous agent / workflow / visual-editor / element-marker / local-semantic subsystems are not present in this tree; their strategic value is migrating into MKEP work tracked outside the public docs.

## 7. Maintenance Suggestions

- When adding a new top-level capability, update this guide with directory ownership and entry points, not just release notes.
- If new workspaces are added later, keep using the `app/*` vs `packages/*` split so the monorepo mental model stays predictable.
