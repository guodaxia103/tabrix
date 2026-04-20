# Tabrix Quickstart

> Goal: get from a cold install to a working AI-controlled Chrome session in ~5 minutes.

This page replaces the earlier `FIRST_SUCCESS_GUIDE` and `STABLE_QUICKSTART` docs. For deeper CLI and MCP configuration, see [CLI and MCP Config](./CLI_AND_MCP.md). For connection issues, see [Troubleshooting](./TROUBLESHOOTING.md).

---

## 1. Install the CLI

```bash
npm install -g @tabrix/tabrix@latest
# or
pnpm install -g @tabrix/tabrix@latest
```

Important:

- CLI install can succeed even if Chrome/Chromium is not yet installed on this machine.
- Browser automation only becomes ready after `setup`, `register`, or `doctor --fix` detects a supported browser executable.
- The detected browser path is persisted and reused for automatic browser launch.

If `pnpm` skipped the postinstall step, finish registration manually:

```bash
tabrix register
```

---

## 2. Load the Chrome extension

1. Download the latest extension asset from [Releases](https://github.com/guodaxia103/tabrix/releases) — prefer `tabrix-extension-vX.Y.Z.zip`.
2. Unpack it into a **stable directory you will not move later** (Chrome remembers the exact unpack path).
3. Open `chrome://extensions/`, enable `Developer mode`, click `Load unpacked`, and select that directory.
4. Open the extension popup and click `Connect`.

Watch the status dot in the popup:

- Green — service is running, MCP is ready.
- Yellow — native host is reachable but the HTTP service has not come up yet.
- Red — the extension cannot reach the native host.
- Grey — detecting; should turn green within a few seconds.

If it stays yellow or red, see [Troubleshooting](./TROUBLESHOOTING.md).

---

## 3. Verify locally

```bash
tabrix status
tabrix doctor
tabrix config
tabrix clients
tabrix smoke
```

Expected healthy signals:

- `tabrix status` shows `Running: yes`.
- `tabrix doctor` shows green for `Browser executable`, `Chrome extension path`, `Connectivity`, `Runtime status`, and `MCP initialize`.
- `tabrix doctor --json` includes `browser.executable`.
- `tabrix config` prints ready-to-copy local `Streamable HTTP`, remote `Streamable HTTP`, and `stdio` config.
- `tabrix clients` shows active client groups plus recent inactive sessions.
- `tabrix smoke` opens a short-lived tab in the current window and exercises a live browser path end-to-end. Use `--separate-window` only when you need stronger isolation.

Raw endpoints also work:

```bash
curl http://127.0.0.1:12306/ping
curl http://127.0.0.1:12306/status
```

---

## 4. Connect an MCP client

Tabrix officially supports two MCP transports — `Streamable HTTP` (preferred) and `stdio`.

Streamable HTTP (most desktop clients — Cursor, Claude Desktop, Codex CLI, CherryStudio, Windsurf, Dify):

```json
{
  "mcpServers": {
    "tabrix": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

Stdio (for clients that only accept stdio):

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "tabrix-stdio"
    }
  }
}
```

Per-client snippets and environment variables are in [CLI and MCP Config](./CLI_AND_MCP.md).

---

## 5. Run the first task

Send one of these instructions to your AI client:

- "List my currently open browser tabs." → the client calls `get_windows_and_tabs`.
- "Open https://github.com for me." → the client calls `chrome_navigate`.
- "Take a screenshot of the current page." → the client calls `chrome_screenshot`.

What a healthy first success looks like:

- The AI's tool call is received by Tabrix within a second.
- The tool returns a structured JSON payload (tabs, navigation result, screenshot reference).
- The same Chrome session you normally use keeps its login state, cookies, and extensions.

---

## 6. What to try next

- "Read the current page and summarize it." — `chrome_read_page` + `chrome_get_web_content`
- "Fill the search box with 'MCP protocol' and click search." — `chrome_fill_or_select` + `chrome_click_element`
- "Search my browser history for 'AI'." — `chrome_history`
- "Bookmark this page." — `chrome_bookmark_add`
- "Record the next 10 seconds of browser activity as a GIF." — `chrome_gif_recorder`

Deeper capability maps:

- [Product Surface Matrix](./PRODUCT_SURFACE_MATRIX.md) — public capability tiers.
- [Tools API](./TOOLS.md) — full tool reference.
- [Use Cases](./USE_CASES.md) — realistic scenarios for new users.

---

## 7. Remote access (optional)

If you need to reach Tabrix from another machine or a Docker container:

1. Open the extension popup → `Remote` tab → turn the remote access switch on. The server restarts on `0.0.0.0` without a browser restart. The preference is persisted to `~/.tabrix/config.json`.
2. Open `Token Management` and copy the current Bearer token. You can customize the token TTL on regenerate (`0` = never expire). The default TTL is 7 days; override with `MCP_AUTH_TOKEN_TTL`. Setting `MCP_AUTH_TOKEN` forces that token and disables rotation.
3. On Windows, allow the port through the firewall (admin PowerShell):

   ```powershell
   netsh advfirewall firewall add rule name="Tabrix MCP Bridge" dir=in action=allow protocol=tcp localport=12306
   ```

4. Paste the following into the remote client (the popup also auto-detects your LAN IP):

   ```json
   {
     "mcpServers": {
       "tabrix": {
         "url": "http://<lan-ip>:12306/mcp",
         "headers": {
           "Authorization": "Bearer <token-from-popup>"
         }
       }
     }
   }
   ```

Rules:

- Requests from `127.0.0.1` / `::1` bypass the token.
- Remote requests must carry `Authorization: Bearer <token>`; otherwise the server returns `401`.
- `/ping`, `/status`, `/auth/token`, `/auth/refresh` are public endpoints.

More detail in [CLI and MCP Config → Remote access](./CLI_AND_MCP.md#remote-access).

---

## 8. Standalone daemon (optional)

By default, the MCP server starts when Chrome launches the native host (on `Connect`). To keep the service online even when Chrome is closed:

```bash
tabrix daemon start
tabrix daemon status
tabrix daemon stop
```

On Windows you can autostart the daemon on login:

```powershell
tabrix daemon install-autostart
tabrix daemon remove-autostart
```

The daemon listens on the same port (default `12306`) and serves all non-browser tools. Browser-specific tools will return a structured error until Chrome opens and the extension connects. Daemon output is written to `~/.tabrix/daemon.log`.

Override the default port with the `CHROME_MCP_PORT` environment variable.

---

## 9. Troubleshooting order

If a client cannot call tools, check in this order:

1. `tabrix status`
2. `tabrix doctor`
3. `tabrix doctor` reports the expected `Chrome extension path`.
4. The extension popup shows the server as running (green dot).
5. `http://127.0.0.1:12306/status` is reachable.
6. In the popup, try `Disconnect` → `Connect`.
7. Click `Refresh` in the popup once to force a status refresh and recovery attempt.
8. If you just updated extension code, reload the unpacked extension once in `chrome://extensions/`.

Deeper symptoms and platform-specific FAQs are in [Troubleshooting](./TROUBLESHOOTING.md).
