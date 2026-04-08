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

The extension build now ensures a local `CHROME_EXTENSION_KEY` in:

```powershell
D:\projects\ai\codex\mcp-chrome\app\chrome-extension\.env
```

That key keeps the unpacked extension ID stable across rebuilds on the same machine.

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
    "chrome-mcp": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

## 5. Standalone daemon (optional)

By default, the MCP server starts when Chrome launches the native host (on Connect). If you want the MCP service to stay online **even when Chrome is closed**, you can run it as a standalone daemon:

```powershell
# Start daemon in the background
mcp-chrome-bridge daemon start

# Check daemon status
mcp-chrome-bridge daemon status

# Stop daemon
mcp-chrome-bridge daemon stop
```

The daemon listens on the same port (default `12306`) and serves all non-browser MCP tools. Browser-specific tools (like `chrome_screenshot`) will return an error until Chrome opens and the extension connects.

### Autostart on boot (Windows)

```powershell
# Install a Windows scheduled task that starts the daemon on login
mcp-chrome-bridge daemon install-autostart

# Remove the autostart task
mcp-chrome-bridge daemon remove-autostart
```

### Daemon logs

Daemon output is written to `~/.mcp-chrome/daemon.log`. Check this file if the daemon fails to start or crashes.

### Custom port

Set the `CHROME_MCP_PORT` environment variable to override the default port for both the daemon and the extension-based server.

## 6. Remote access (optional)

To allow other machines or Docker containers to connect via LAN:

1. Open the extension popup → **Remote** tab → toggle the **remote access switch** to ON. The server immediately restarts on `0.0.0.0` — no browser restart needed. The preference is saved to `~/.mcp-chrome/config.json` and survives reconnects / browser restarts.

2. A Token is **auto-generated** on first remote enable and saved to `~/.mcp-chrome/auth-token.json`. The popup will show the full MCP config (including `Authorization` header) once remote is enabled.

3. Allow the port through your firewall (Windows example):

```powershell
netsh advfirewall firewall add rule name="MCP Chrome Bridge" dir=in action=allow protocol=tcp localport=12306
```

4. The popup auto-detects your LAN IP. Copy the displayed config to the remote machine:

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://<your-lan-ip>:12306/mcp",
      "headers": {
        "Authorization": "Bearer <token-from-popup>"
      }
    }
  }
}
```

5. Check the popup's "Connected clients" list to verify the remote connection

> **Advanced**: You can also set `MCP_HTTP_HOST=0.0.0.0` as an OS environment variable to override the config file (useful for daemon mode). Token auto-expires in 7 days (configure via `MCP_AUTH_TOKEN_TTL`). Localhost requests bypass token auth.

## 7. Troubleshooting order

If the client cannot use tools, check in this order:

1. `mcp-chrome-bridge status`
2. `mcp-chrome-bridge doctor`
3. Confirm `doctor` reports the expected `Chrome extension path`
4. Confirm the extension popup shows the server as running
5. Confirm `http://127.0.0.1:12306/status` is reachable
6. In the popup, try `Disconnect -> Connect`
7. Use the popup `Refresh` button to force a status refresh and recovery attempt
8. If you just updated extension code, reload the unpacked extension once in `chrome://extensions/`

## 8. What the new diagnostics mean

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
  - If the popup says connected but the service is still down, use `Refresh` or `Disconnect -> Connect` once before retrying

## 9. Local development workflow that avoids stale builds

If `doctor` shows Chrome is loading a different unpacked directory than the one you just built, either:

1. Reload the unpacked extension from the new build folder in `chrome://extensions/`, or
2. Copy the latest build output into the directory shown by `Chrome extension path`

Recommended stable unpacked directory:

```powershell
D:\projects\ai\chrome-mcp-server-1.0.0
```

Recommended sync command:

```powershell
robocopy D:\projects\ai\codex\mcp-chrome\app\chrome-extension\.output\chrome-mv3 D:\projects\ai\chrome-mcp-server-1.0.0 /MIR
```

After syncing:

```powershell
node app\native-server\dist\cli.js doctor
```

Look for:

- `Chrome extension path` points to the expected unpacked folder
- `Runtime status` becomes healthy after clicking `Connect`

If Chrome forgets the unpacked extension after restart, remove stale old entries in `chrome://extensions/`, then load the same stable directory again:

```powershell
D:\projects\ai\chrome-mcp-server-1.0.0
```

Do not keep switching between multiple unpacked build folders.

## 10. Known notes

- On Windows, rebuilding while the native host is active may log a non-fatal `EBUSY` warning during `dist` cleanup. The build continues and overwrites artifacts.
- If you rebuild local source, restart the native host once so the running process picks up the latest `dist` output.

For the current Phase 0 validation checklist, see:

- [Phase 0 Test Matrix](D:/projects/ai/codex/mcp-chrome/docs/PHASE0_TEST_MATRIX.md)
