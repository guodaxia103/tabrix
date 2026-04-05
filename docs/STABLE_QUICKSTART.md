# Stable Quickstart

This guide is the shortest path to a stable local setup on Windows with the current Phase 0 hardening work.

## 1. Install the bridge

```powershell
npm install -g mcp-chrome-bridge
```

If you are developing from source, build and register from the repo:

```powershell
cd D:\projects\ai\codex\mcp-chrome
pnpm install
pnpm --filter mcp-chrome-bridge build
node app\native-server\dist\cli.js register
```

## 2. Load the Chrome extension

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the extension build folder
5. Click `Connect` in the extension popup

For source builds, the unpacked extension output is:

```powershell
D:\projects\ai\codex\mcp-chrome\app\chrome-extension\.output\chrome-mv3
```

Important:

- Chrome keeps using the exact unpacked directory you loaded the first time
- If you later build in a different folder, Chrome will still run the old folder until you reload that exact path
- `mcp-chrome-bridge doctor` now reports the real loaded path as `Chrome extension path`

## 3. Verify the local runtime

The fastest checks are now:

```powershell
mcp-chrome-bridge status
mcp-chrome-bridge doctor
mcp-chrome-bridge smoke
```

Expected healthy output:

- `status` shows `Running: yes`
- `doctor` shows green checks for:
  - `Chrome extension path`
  - `Connectivity`
  - `Runtime status`
  - `MCP initialize`
- `smoke` can open a temporary test page and run a live browser sanity check

You can also verify raw endpoints:

```powershell
curl http://127.0.0.1:12306/ping
curl http://127.0.0.1:12306/status
```

## 4. Recommended MCP client config

For Streamable HTTP clients:

```json
{
  "mcpServers": {
    "chrome-mcp-server": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

## 5. Troubleshooting order

If the client cannot use tools, check in this order:

1. `mcp-chrome-bridge status`
2. `mcp-chrome-bridge doctor`
3. Confirm `doctor` reports the expected `Chrome extension path`
4. Confirm the extension popup shows the server as running
5. Confirm `http://127.0.0.1:12306/status` is reachable
6. Reconnect the extension once

## 6. What the new diagnostics mean

- `status`
  - Quick runtime snapshot from the live bridge process
  - Shows host, port, native host attachment, and active MCP sessions
- `doctor`
  - Checks installation, manifest, registry, port config, and logs
  - Reports the actual unpacked extension directory Chrome loaded from `Secure Preferences`
  - Also performs a real MCP `initialize` request against `/mcp`
- `report`
  - Produces a shareable support bundle for issue filing
- `smoke`
  - Runs a real browser smoke test against the local MCP runtime
  - If the extension is disconnected, it now fails with an actionable hint instead of a generic fetch error

## 7. Local development workflow that avoids stale builds

If `doctor` shows Chrome is loading a different unpacked directory than the one you just built, either:

1. Reload the unpacked extension from the new build folder in `chrome://extensions/`, or
2. Copy the latest build output into the directory shown by `Chrome extension path`

Example sync command:

```powershell
robocopy D:\projects\ai\codex\mcp-chrome\app\chrome-extension\.output\chrome-mv3 D:\projects\ai\chrome-mcp-server-1.0.0 /MIR
```

After syncing:

```powershell
mcp-chrome-bridge doctor
```

Look for:

- `Chrome extension path` points to the expected unpacked folder
- `Runtime status` becomes healthy after clicking `Connect`

## 8. Known notes

- On Windows, rebuilding while the native host is active may log a non-fatal `EBUSY` warning during `dist` cleanup. The build continues and overwrites artifacts.
- If you rebuild local source, restart the native host once so the running process picks up the latest `dist` output.

For the current Phase 0 validation checklist, see:

- [Phase 0 Test Matrix](D:/projects/ai/codex/mcp-chrome/docs/PHASE0_TEST_MATRIX.md)
