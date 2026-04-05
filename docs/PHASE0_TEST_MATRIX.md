# Phase 0 Test Matrix

This document tracks the hardening checks that were exercised during Phase 0 and how to rerun them locally.

## Build and unit checks

### Native server build

```powershell
pnpm --filter mcp-chrome-bridge build
```

Purpose:

- verifies the native bridge compiles
- regenerates `dist`
- updates `node_path.txt`

### Native server regression test

```powershell
pnpm --filter mcp-chrome-bridge test -- --runInBand --coverage=false src/server/server.test.ts
```

Purpose:

- verifies repeated MCP `initialize` calls work
- guards against transport reuse regressions

### Extension build

```powershell
pnpm --filter chrome-mcp-server build
```

Purpose:

- verifies the Chrome extension build succeeds on Windows
- catches missing native rolldown binding regressions

### Navigate pattern test

```powershell
pnpm --filter chrome-mcp-server test -- navigate-patterns.test.ts
```

Purpose:

- verifies `chrome_navigate` does not generate invalid `www.` patterns for:
  - `localhost`
  - IPv4 hosts
  - IPv6 hosts

## Runtime diagnostics

### Quick runtime status

```powershell
mcp-chrome-bridge status
```

Purpose:

- confirms whether the local bridge is running
- shows current port and active session count

### Full diagnostics

```powershell
mcp-chrome-bridge doctor
```

Purpose:

- validates manifests and Windows registry entries
- validates `/ping`, `/status`, and a real MCP `initialize`
- reports the actual unpacked extension directory loaded by Chrome

### Issue bundle

```powershell
mcp-chrome-bridge report --include-logs tail
```

Purpose:

- captures a support bundle for issue filing and local troubleshooting

## Live smoke checks

### Runtime disconnected path

```powershell
mcp-chrome-bridge smoke
```

Expected behavior when the extension is not connected:

- `runtime.ping` fails with a clear hint
- final message tells the user to open the extension popup and click `Connect`

Purpose:

- ensures the smoke command fails clearly instead of returning a generic fetch error

### Runtime connected path

```powershell
mcp-chrome-bridge smoke --json
```

When the extension is connected, the smoke command is designed to exercise:

- session initialize
- tool listing
- window and tab discovery
- navigation
- page reading
- content extraction
- form fill
- keyboard input
- click
- screenshot
- console capture
- network capture
- direct network request
- dialog handling
- file upload
- bookmark add/search/delete
- history query
- gif recorder status
- performance trace
- temporary tab cleanup

Note:

- this is a live integration test, not a unit test
- it depends on Chrome having the extension connected to the native host

## Real environment checks already exercised

The following paths were verified against the real local environment during Phase 0:

- repeated HTTP MCP `initialize` calls return fresh session IDs instead of failing on transport reuse
- Chrome extension can call through to the local bridge and return real `get_windows_and_tabs` data
- CoPaw `v1.0.1` can load the local MCP client and call `get_windows_and_tabs`
- `doctor --json` reports the actual loaded Chrome extension path from `Secure Preferences`
- `smoke --json` now returns actionable guidance when the local runtime is down

## Current known boundary

The remaining operational boundary is extension connection persistence:

- if Chrome is not actively connected to the native host, `/ping` and `/status` will be down
- use `mcp-chrome-bridge doctor` to confirm the loaded extension path
- if needed, sync the build output to the exact unpacked directory Chrome is loading, then click `Connect`

See:

- [Stable Quickstart](D:/projects/ai/codex/mcp-chrome/docs/STABLE_QUICKSTART.md)
- [CoPaw Guide](D:/projects/ai/codex/mcp-chrome/docs/COPAW.md)
