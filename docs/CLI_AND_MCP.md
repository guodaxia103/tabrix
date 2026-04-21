# Tabrix CLI and MCP Configuration

> Consolidated reference. Replaces `CLI.md`, `MCP_CLI_CONFIG.md`, `CLIENT_CONFIG_QUICKREF.md`, and `TRANSPORT.md`.

For a first-time install, start with [Quickstart](./QUICKSTART.md). For connection failures, see [Troubleshooting](./TROUBLESHOOTING.md).

---

## 1. Executables

- `tabrix` — primary CLI.
- `tabrix-stdio` — stdio MCP server entrypoint.

## 2. Recommended command set

If you want one stable mental model, keep these commands in this order:

1. `tabrix setup` — first-time install and next-step guidance.
2. `tabrix status` — quick health check.
3. `tabrix doctor --fix` — diagnose and auto-recover common issues.
4. `tabrix config` — print ready-to-copy MCP connection config.
5. `tabrix clients` — inspect who is currently connected.
6. `tabrix smoke` — verify the real browser path end-to-end.
7. `tabrix report --copy` — export context for issue filing.

Everything else is advanced or compatibility-oriented — not part of the default day-to-day set.

## 3. Full command reference

| Command                     | Purpose                                | Typical use                                       |
| --------------------------- | -------------------------------------- | ------------------------------------------------- |
| `tabrix setup`              | Guided first-time setup.               | New machine, first install.                       |
| `tabrix register`           | Register Native Messaging host.        | Manual or forced re-registration.                 |
| `tabrix fix-permissions`    | Repair local execution permissions.    | "Permission denied" on wrapper/host scripts.      |
| `tabrix update-port <port>` | Update stdio config port.              | Align with a custom local MCP port.               |
| `tabrix status`             | Local server runtime snapshot.         | Fast sanity check before use.                     |
| `tabrix doctor`             | Diagnose installation/runtime issues.  | Troubleshoot connectivity.                        |
| `tabrix doctor --fix`       | Auto-fix common issues.                | Recovery one-shot.                                |
| `tabrix config`             | Print ready-to-copy MCP client config. | Local + remote + stdio.                           |
| `tabrix clients`            | Show connected clients and sessions.   | Inspect active client groups and recent sessions. |
| `tabrix smoke`              | Browser-path smoke test.               | End-to-end verification with Chrome.              |
| `tabrix stdio-smoke`        | Stdio transport smoke test.            | Verify stdio-only setup.                          |
| `tabrix report`             | Generate diagnostics report.           | Share reproducible issue context.                 |
| `tabrix daemon <action>`    | Manage the standalone daemon.          | Background / always-on service.                   |

### Useful flags

- `tabrix register --browser <chrome|chromium|all>` — register specific browser targets.
- `tabrix register --detect` — auto-detect installed browser targets.
- `tabrix report --copy` — copy Markdown diagnostics to clipboard.
- `tabrix report --output <file>` — write diagnostics to a file.
- `tabrix status --json` / `tabrix config --json` / `tabrix clients --json` / `tabrix smoke --json` / `tabrix doctor --json` — machine-readable output.
- `tabrix smoke --separate-window` — run smoke in a separate browser window instead of the default temporary tab.

### Daemon actions

- `tabrix daemon start`
- `tabrix daemon stop`
- `tabrix daemon status`
- `tabrix daemon install-autostart` (Windows)
- `tabrix daemon remove-autostart` (Windows)

Daemon logs are written to `~/.tabrix/daemon.log`.

---

## 4. Transports

Tabrix officially supports two MCP transports:

| Mode                | Endpoint              | Typical use                                                      | Notes                                                                        |
| ------------------- | --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Streamable HTTP** | `POST /mcp`           | Cursor, Claude Desktop, Codex CLI, CherryStudio, Windsurf, Dify… | Primary path. `http://127.0.0.1:<port>/mcp` or `http://<lan-ip>:<port>/mcp`. |
| **stdio**           | stdin/stdout JSON-RPC | Claude Code CLI and any MCP host that cannot speak HTTP.         | Subprocess proxy to the local HTTP service.                                  |

The SSE classic mode (`GET /sse` + `POST /messages`) was removed in v2.12. At this stage we only advertise `Streamable HTTP` and `stdio` as production transports.

### 4.1 Streamable HTTP in detail

Clients send JSON-RPC over `POST /mcp` (for `initialize`, `tools/list`, `tools/call`, …) and the server returns JSON-RPC responses. After `initialize`, a client may also open `GET /mcp` with the `mcp-session-id` header to subscribe to server-pushed events such as tool-execution progress. That is a feature of Streamable HTTP, not a separate third transport.

### 4.2 stdio in detail

An AI client launches `tabrix-stdio` as a child process. The child proxies JSON-RPC from stdin/stdout to the local HTTP service:

```
AI client  <-- stdin/stdout -->  tabrix-stdio  <-- HTTP -->  127.0.0.1:12306/mcp
```

Important: when the parent exits, `tabrix-stdio` must exit on stdin close. MCP hosts must manage the child's lifecycle correctly to avoid zombie processes.

### 4.3 Behavioral differences

- Streamable HTTP: mostly stateless requests. Each `initialize` creates its own MCP instance. Supports multiple parallel clients.
- stdio: one MCP instance per child process. Lifetime is bound to the parent.

### 4.4 Current-stage priority

1. Remote Streamable HTTP
2. Local stdio

We will not add more transports until remote `Streamable HTTP` is fully stable.

---

## 5. Per-client configuration

All clients connect to the same local MCP service. The default port is **12306**. If you changed it, replace `12306` in every snippet below with your actual port.

Before editing config files, run:

```bash
tabrix config    # ready-to-copy local / remote / stdio snippets with current token
tabrix clients   # already-connected clients and recent sessions
```

### 5.1 Claude Desktop

Config path:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

### 5.2 Cursor

Config path: `.cursor/mcp.json` (per project) or the global MCP settings.

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### 5.3 Claude Code CLI

```bash
claude mcp add tabrix --transport http http://127.0.0.1:12306/mcp
```

Or edit `~/.claude.json`:

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### 5.4 Codex CLI

Config path: `~/.codex/config.json`.

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

You can also set `CHROME_MCP_PORT` (or the backward-compatible alias `MCP_HTTP_PORT`) before launching Codex CLI.

### 5.5 CherryStudio

Add through the MCP server management page:

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

### 5.6 Windsurf

Config path: `.windsurf/mcp.json` (per project).

```json
{
  "mcpServers": {
    "tabrix": {
      "serverUrl": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### 5.7 Dify

On the MCP tool node:

- Type: `Streamable HTTP`
- URL: `http://127.0.0.1:12306/mcp`

If Dify runs inside Docker, replace `127.0.0.1` with the host IP or with `host.docker.internal`.

### 5.8 Stdio clients

Preferred — global install makes `tabrix-stdio` available on PATH:

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "tabrix-stdio"
    }
  }
}
```

If `tabrix-stdio` is not on PATH, use the script entry directly:

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "node",
      "args": ["/path/to/node_modules/@tabrix/tabrix/dist/mcp/mcp-server-stdio.js"]
    }
  }
}
```

Or `npx` without a global install:

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "npx",
      "args": ["-p", "@tabrix/tabrix", "tabrix-stdio"]
    }
  }
}
```

On Windows, if `tabrix-stdio` is not resolved, try `tabrix-stdio.cmd` or the `node + absolute path` form.

---

## 6. Remote access

By default the server listens on `127.0.0.1`. To allow other machines or Docker containers to connect:

### 6.1 Enable remote listening

Preferred — extension popup switch:

- Open the popup → `Remote` tab → turn the remote access switch on.
- The server restarts on `0.0.0.0` without a browser restart.
- The preference is persisted to `~/.tabrix/config.json`.

Advanced (daemon mode) — environment variable override (higher priority than the config file):

```powershell
[Environment]::SetEnvironmentVariable("MCP_HTTP_HOST", "0.0.0.0", "User")
```

### 6.2 Confirm token auth

Requests from `127.0.0.1` / `::1` bypass the token. Remote IPs must carry `Authorization: Bearer <token>`, otherwise the server returns `401`.

- Open popup → `Token Management` → copy the current token. You can customize TTL when regenerating (`0` = never expire).
- Default TTL is 7 days. Override with `MCP_AUTH_TOKEN_TTL`.
- Setting `MCP_AUTH_TOKEN` forces that token value and disables automatic rotation.

Public endpoints (no token required): `/ping`, `/status`, `/auth/token`, `/auth/refresh`.

Local-only token management endpoints (not reachable from remote IPs):

- `GET /auth/token` — inspect current token info.
- `POST /auth/refresh` — regenerate (old token is revoked immediately).

### 6.3 Open the firewall (Windows)

Admin PowerShell:

```powershell
netsh advfirewall firewall add rule name="Tabrix MCP Bridge" dir=in action=allow protocol=tcp localport=12306
```

Verify:

```powershell
netstat -ano | findstr :12306
```

Should show `0.0.0.0:12306  LISTENING`.

### 6.4 Configure the remote client

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

The popup auto-detects the LAN IP (WLAN/Wi-Fi > Ethernet > other physical > virtual/VPN). If you pick up a VPN IP by accident, replace it manually.

### 6.5 Docker client

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://host.docker.internal:12306/mcp"
    }
  }
}
```

### 6.6 Confirm the remote session

Check the popup's `active clients` list. You should see the remote IP and client name. Use the `×` button to kick any unexpected client group.

---

## 6.5 Memory read routes (internal, sidepanel-only)

The native server exposes three HTTP read routes under `/memory/*` for the Chrome extension's sidepanel Memory tab. These are **not** MCP tools — they're internal HTTP-only endpoints protected by the same Bearer token as `/mcp`, intended for an already-authenticated local viewer, and are intentionally read-only (POST/PUT/PATCH/DELETE respond 404 by design).

- `GET /memory/sessions?limit=&offset=` — recent sessions with task title + intent + `stepCount` joined in; default `limit=20`, max `500`.
- `GET /memory/sessions/:sessionId/steps` — chronological steps for one session.
- `GET /memory/tasks/:taskId` — single task row; 404 when unknown.

## 7. `/status` semantics

`/status` splits `data.transports` into two layers:

- `clients` — main list. Only `active` client groups, collapsed by `clientIp + clientName + clientVersion`. This is what the popup's main list uses. Raw Streamable HTTP session dumps are no longer shown as clients directly.
- `sessions` — triage layer. Recent `active / stale / disconnected` session snapshots.

Extra governance fields:

- `lastSeenAt` — most recent request that hit the session.
- `state` — `active` / `stale` / `disconnected`.
- `sessionStates` — counts per state.
- `cleanup` — current stale threshold, terminal-state retention, and last sweep info.

Session lifecycle:

- `active` — inside the active window; appears in the popup main list.
- `stale` — inactive beyond the threshold; removed from the main list, kept in the recent-terminal list.
- `disconnected` — manually disconnected or cleanly closed; does not stay in the main list.

---

## 8. Environment variables

| Variable                      | Description                                                                                   | Default     |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `CHROME_MCP_PORT`             | Preferred MCP HTTP port.                                                                      | `12306`     |
| `MCP_HTTP_PORT`               | Backward-compatible alias for the port.                                                       | `12306`     |
| `MCP_HTTP_HOST`               | Override the listen address (higher priority than `~/.tabrix/config.json`).                   | `127.0.0.1` |
| `MCP_AUTH_TOKEN`              | Force a specific Bearer token (disables automatic rotation).                                  | (unset)     |
| `MCP_AUTH_TOKEN_TTL`          | Default token TTL in days. `0` means never expire.                                            | `7`         |
| `MCP_ALLOWED_WORKSPACE_BASE`  | Additional allowed workspace directory.                                                       | (none)      |
| `CHROME_MCP_NODE_PATH`        | Override the Node.js executable used by the native host.                                      | (auto)      |
| `ENABLE_MCP_TOOLS`            | Allow-list mode — only expose the listed tools (comma-separated).                             | (all)       |
| `DISABLE_MCP_TOOLS`           | Deny-list mode — hide the listed tools.                                                       | (none)      |
| `MCP_DISABLE_SENSITIVE_TOOLS` | Set to `true` to disable `chrome_javascript`, `chrome_bookmark_delete`, `chrome_upload_file`. | `false`     |

---

## 9. Verification

```bash
tabrix status
tabrix doctor
tabrix smoke
```

Raw endpoints also work:

```bash
curl http://127.0.0.1:12306/ping
curl http://127.0.0.1:12306/status
```

---

## 10. Real-world maintenance cookbook (browser-first GitHub triage)

Keep the flow simple and browser-first:

```bash
tabrix status
tabrix doctor --fix
tabrix mcp tools
tabrix mcp call chrome_navigate --arg url="<target-url>" --arg newWindow=true
tabrix mcp call chrome_read_page --arg filter=interactive --arg depth=2
```

Narrow extraction ladder for complex pages:

1. `chrome_get_web_content` with a narrow selector.
2. `chrome_get_interactive_elements`.
3. Targeted `chrome_click_element` / `chrome_keyboard` / `chrome_fill_or_select`.
4. `chrome_screenshot` as a visual check.
5. `chrome_javascript` only as an explicit fallback.

For longer arg payloads, use a file:

```powershell
@'
{
  "tabId": 12345678,
  "filter": "interactive",
  "depth": 2
}
'@ | Set-Content .\github-web-args.json

tabrix mcp call chrome_read_page --args-file .\github-web-args.json
```

Recovery smoke during maintenance windows:

```bash
tabrix smoke --bridge-recovery --json
tabrix smoke --command-channel-recovery fail-next-send --json
tabrix smoke --command-channel-recovery fail-all-sends --json
```

---

## 11. Common symptoms

| Symptom                           | Likely cause                            | Fix                                                                                         |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Connection refused                | Service not started                     | Click `Connect` in the popup.                                                               |
| Tools not appearing               | Bad JSON syntax in client config        | Validate JSON; restart the client after editing.                                            |
| Port conflict                     | `12306` already bound                   | Change port in popup settings and in the client config.                                     |
| Docker container cannot connect   | `127.0.0.1` points inside the container | Turn remote on (or set `MCP_HTTP_HOST=0.0.0.0`); use the host IP or `host.docker.internal`. |
| Remote connection refused         | Server only listens on `127.0.0.1`      | Turn remote on (or set `MCP_HTTP_HOST=0.0.0.0`) and check the firewall.                     |
| Remote returns `401 Unauthorized` | Token missing / mismatched / expired    | Copy the latest token from popup → `Remote` tab; regenerate if expired.                     |
| Popup shows an unknown IP         | Unexpected remote client                | Click `×` to kick that session.                                                             |
| Windows path issue                | Unescaped `\` in JSON                   | Use `\\` or `/` in JSON string values.                                                      |

---

## 12. Related docs

- [Quickstart](./QUICKSTART.md) — first-time install and first task.
- [Troubleshooting](./TROUBLESHOOTING.md) — deeper symptoms and platform FAQs.
- [Error Codes](./ERROR_CODES.md) — structured error reference.
- [Tools API](./TOOLS.md) — full tool reference.
- [Product Surface Matrix](./PRODUCT_SURFACE_MATRIX.md) — public capability tiers.
