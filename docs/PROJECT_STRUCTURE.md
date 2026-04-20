# Tabrix Project Structure Guide

This guide explains where the code lives and how the main runtime paths fit together, so contributors can find the right entry point quickly.

Scope note:

- The stable public product surface is centered on browser execution through the Chrome extension plus MCP access through `Streamable HTTP` and `stdio`.
- The repository also contains agent, workflow, replay, and semantic-indexing subsystems. They are important for code navigation, but they should not be read as the default public product surface.

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
│  ├─ shared/              # Shared types, tool schemas, and cross-process contracts
│  └─ wasm-simd/           # Rust/WebAssembly SIMD math helpers
├─ docs/                   # User and developer documentation
├─ scripts/                # Repo-level maintenance scripts
├─ skills/                 # Bundled Tabrix skill definitions
├─ prompt/                 # Prompt templates and references
└─ releases/               # Release notes and release assets guidance
```

## 2. Workspace Responsibilities

### `app/chrome-extension/`

The browser-side application. This is where Chrome APIs, DOM interaction, content scripts, and most browser execution logic live. The codebase also includes experimental or internal subsystems such as workflow replay, agent chat, and semantic indexing.

Key directories:

- `entrypoints/background/`
  - Main background runtime and bootstrap layer.
  - `index.ts` initializes the native host bridge, tool listeners, and other extension subsystems, including some experimental modules.
- `entrypoints/background/tools/`
  - Browser tool implementations.
  - `browser/*.ts` contains navigation, click, keyboard, screenshot, network, JS execution, bookmarks, history, upload, and related tooling.
- `entrypoints/background/record-replay-v3/`
  - Workflow and replay runtime used by internal or experimental flows.
  - `domain/` holds core models, `engine/` holds scheduling and execution, `storage/` persists flows, runs, triggers, and imports.
- `entrypoints/popup/`
  - Extension popup UI for connection, remote access, and host status.
- `entrypoints/sidepanel/`
  - Side panel UI for agent chat, workflow surfaces, and RR-V3 debugging. This is not the main public onboarding surface.
- `entrypoints/web-editor-v2/`
  - Visual page editor logic.
- `inject-scripts/`
  - Scripts injected into page contexts for interaction, observation, recording, screenshots, and helpers.
- `shared/`
  - Reusable extension-side logic such as selector generation, element picker, and quick panel support.
- `utils/`
  - Shared browser-side utilities including selector helpers, screenshot context, IndexedDB helpers, offscreen management, and some experimental semantic/vector utilities.
- `workers/`
  - ONNX/WASM worker assets and generated runtime artifacts.
- `tests/`
  - `vitest` coverage for popup state, record-replay, web editor, and related units.

### `app/native-server/`

The local Node service that turns extension capabilities into CLI commands, MCP endpoints, and a Native Messaging host.

Key directories:

- `src/index.ts`
  - Main process entry that wires the HTTP server to the Native Messaging host.
- `src/cli.ts`
  - CLI entry for `tabrix` and `tabrix-stdio`.
- `src/server/`
  - Fastify service layer.
  - Hosts `/ping`, `/status`, auth management, MCP transport, agent routes, and session tracking.
- `src/mcp/`
  - MCP server creation and tool registration.
  - `register-tools.ts` publishes tool schemas from `@tabrix/shared` and forwards execution to the extension.
- `src/native-messaging-host.ts`
  - The bidirectional bridge between Node and the extension.
- `src/scripts/`
  - CLI subcommand implementations such as `register`, `doctor`, `status`, `smoke`, `report`, `setup`, and `daemon`.
- `src/execution/`
  - Tool execution tracking and result normalization.
- `src/agent/`
  - Agent backend services including projects, sessions, messages, attachments, streams, and Codex/Claude engine adapters. These routes exist in the codebase but are not the primary public product surface.

### `packages/shared/`

The shared contract between the native server and the extension.

Primary files:

- `tools.ts`: MCP tool schemas and one of the first places to touch when adding a new tool
- `types.ts` and `constants.ts`: shared cross-process contracts
- `step-types.ts`, `rr-graph.ts`, `node-spec*.ts`: workflow and graph models
- `agent-types.ts`: shared agent-related types

### `packages/wasm-simd/`

Rust-based SIMD math helpers used by extension-side semantic similarity and vector operations.

Primary files:

- `src/lib.rs`: core Rust implementation
- `Cargo.toml`: Rust package definition
- `BUILD.md` and `README.md`: WASM build guidance

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

### Experimental Workflow / Record-Replay V3

```text
sidepanel workflows / background bootstrap
  -> record-replay-v3/domain
  -> record-replay-v3/engine
  -> record-replay-v3/storage
  -> background/tools/record-replay.ts or dynamic flow tools
```

Use this path when debugging internal or experimental subsystems:

- publishing and triggering flows
- scheduling and recovery behavior
- v2 to v3 migration logic
- dynamic `flow.<slug>` tool generation

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

### Change agent or sidepanel behavior

Start with:

- `app/chrome-extension/entrypoints/sidepanel/components/agent-chat/`
- `app/chrome-extension/entrypoints/sidepanel/composables/useAgent*.ts`
- `app/native-server/src/server/routes/agent.ts`
- `app/native-server/src/agent/*`

### Change workflows or replay runtime

Start with:

- `app/chrome-extension/entrypoints/background/record-replay-v3/`
- `app/chrome-extension/tests/record-replay-v3/`
- `packages/shared/src/node-spec*.ts`

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

- The repo contains three major code layers:
  - MCP service layer
  - browser execution layer
  - agent/workflow and replay subsystems
- The stable public product story should still be read primarily through the MCP service layer and browser execution layer.
- `record-replay-v3` and `sidepanel/agent-chat` are still worth understanding when you work in those areas, but they are not the default public capability surface.
- `packages/shared/` is the key stability boundary. Any change to tool schemas, workflow nodes, or cross-process types should usually start there.

## 7. Maintenance Suggestions

- When adding a new top-level capability, update this guide with directory ownership and entry points, not just release notes.
- If new workspaces are added later, keep using the `app/*` vs `packages/*` split so the monorepo mental model stays predictable.
