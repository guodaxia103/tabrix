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

## 3. Verify the local runtime

The fastest checks are now:

```powershell
mcp-chrome-bridge status
mcp-chrome-bridge doctor
```

Expected healthy output:

- `status` shows `Running: yes`
- `doctor` shows green checks for:
  - `Connectivity`
  - `Runtime status`
  - `MCP initialize`

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
3. Confirm the extension popup shows the server as running
4. Confirm `http://127.0.0.1:12306/status` is reachable
5. Reconnect the extension once

## 6. What the new diagnostics mean

- `status`
  - Quick runtime snapshot from the live bridge process
  - Shows host, port, native host attachment, and active MCP sessions
- `doctor`
  - Checks installation, manifest, registry, port config, and logs
  - Also performs a real MCP `initialize` request against `/mcp`
- `report`
  - Produces a shareable support bundle for issue filing

## 7. Known notes

- On Windows, rebuilding while the native host is active may log a non-fatal `EBUSY` warning during `dist` cleanup. The build continues and overwrites artifacts.
- If you rebuild local source, restart the native host once so the running process picks up the latest `dist` output.
