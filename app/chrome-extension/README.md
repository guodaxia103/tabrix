# Tabrix Chrome Extension

`app/chrome-extension` is the browser-side runtime for Tabrix.

It is responsible for:

- executing browser tools through Chrome APIs and content scripts
- rendering the popup, sidepanel, and web editor surfaces
- bridging the real browser session to the native server through Native Messaging
- exposing remote access, token management, and runtime status in the popup

## Common Tasks

Install dependencies from the monorepo root:

```bash
pnpm install
```

Build the extension:

```bash
pnpm --filter @tabrix/extension build
```

Run the extension in development mode:

```bash
pnpm --filter @tabrix/extension dev
```

Run extension tests:

```bash
pnpm -C app/chrome-extension test
```

## Important Paths

- `entrypoints/background/`: background runtime, tool execution, Native Messaging bridge
- `entrypoints/popup/`: popup UI for connect, remote access, token management, and status
- `entrypoints/sidepanel/`: sidepanel surfaces such as agent and workflow-related UI
- `entrypoints/background/tools/browser/`: browser tool implementations
- `inject-scripts/`: scripts injected into page contexts
- `tests/`: extension-side test coverage

## Verification

When you change extension code, the default local acceptance loop is:

1. `pnpm -C app/chrome-extension build`
2. `pnpm run extension:reload`
3. verify the changed behavior in a real Chrome session

Do not claim browser-side verification unless the unpacked extension has been reloaded.
