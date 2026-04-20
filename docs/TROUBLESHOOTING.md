# Tabrix Troubleshooting

> Consolidated troubleshooting reference. Replaces `POPUP_TROUBLESHOOTING.md`, `WINDOWS_FAQ.md`, and `WINDOWS_INSTALL_zh.md`.

Run this order first if anything looks wrong:

```bash
tabrix status
tabrix doctor
tabrix doctor --fix
```

To share context on a GitHub issue:

```bash
tabrix report --copy        # copy a Markdown report to the clipboard
tabrix report --output mcp-report.md
```

Usernames, paths, and tokens are redacted by default. Use `--no-redact` only if you are comfortable sharing full paths.

---

## 1. Extension popup status dot

| Dot color | Status text                                 | Meaning                                                                           | Severity |
| --------- | ------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| Green     | `Service running (port: 12306)`             | Everything is healthy. MCP is ready.                                              | —        |
| Yellow    | `Native host reachable, service not up yet` | Native messaging works, but the local HTTP service has not started.               | Medium   |
| Red       | `Service disconnected`                      | The extension cannot reach the native host at all.                                | High     |
| Grey      | `Detecting…`                                | Just opened or just clicked `Connect`. Should resolve in a few seconds otherwise. | Low      |

### Green but the AI client still cannot call tools

| Check                    | Action                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Client config            | See [CLI and MCP Config](./CLI_AND_MCP.md). Confirm URL and port match the popup.                        |
| Port match               | Port shown in popup must match the port in your client config (`CHROME_MCP_PORT` overrides the default). |
| Firewall / proxy         | Make sure `127.0.0.1:<port>` is not blocked.                                                             |
| Client needs a restart   | Some clients (Claude Desktop, Cursor) require a restart after you edit their config file.                |
| Old session still listed | Use the popup's `active clients` list to kick stale sessions (`×` button).                               |

### Yellow — native host reachable, service not up

| Likely cause           | Fix                                     |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Service still starting | Wait 3–5 seconds, then click `Refresh`. |
| Port already in use    | Windows: `netstat -ano                  | findstr :12306`. macOS/Linux: `lsof -i :12306`. Free the port or change it in the popup settings. |
| Node.js too old        | Node >= 20.0.0 required. `node -v`.     |
| Native host crashed    | `tabrix doctor` prints the reason.      |
| Registration missing   | `tabrix register` or `tabrix setup`.    |

Fast recovery flow:

1. Click `Refresh` in the popup.
2. If still yellow: `tabrix doctor`.
3. Fix every `❌` item the doctor reports.
4. Reload the unpacked extension at `chrome://extensions/`.
5. Click `Connect`.

### Red — service disconnected

| Likely cause                                | Fix                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Tabrix CLI not installed                    | `npm install -g @tabrix/tabrix@latest`                                     |
| Native manifest not registered              | `tabrix register`                                                          |
| Registered manifest path stale (after move) | `tabrix register` again                                                    |
| Extension not loaded correctly              | `chrome://extensions/` → Developer mode → reload the unpacked extension.   |
| Chrome just started                         | Wait a few seconds, then click `Connect`.                                  |
| Windows registry path wrong                 | `tabrix doctor --fix` will diagnose and rewrite.                           |
| Extension ID drifted after reload           | `tabrix register` so the manifest's `allowed_origins` picks up the new ID. |

Fast recovery flow:

1. Verify install: `npm list -g @tabrix/tabrix`.
2. Re-register: `tabrix register`.
3. Reload the unpacked extension.
4. Click `Connect`.
5. If still red: `tabrix doctor`.

### Grey — detecting

| Situation                    | Action                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| Turns green within 5 seconds | No action needed.                                          |
| Stays grey indefinitely      | Close and reopen the popup; otherwise follow the red flow. |

---

## 2. Connection error strings

Shown at the bottom of the popup when the last connection attempt failed.

| Error fragment                                               | Likely cause                                         | Fix                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| `Specified native messaging host not found`                  | Manifest missing or path wrong                       | `tabrix register`                                          |
| `Access to the specified native messaging host is forbidden` | Extension ID not in the manifest's `allowed_origins` | `tabrix register` again                                    |
| `Native host has exited`                                     | Bridge process crashed                               | Check logs (paths below); run `tabrix doctor`.             |
| `Error when communicating with the native messaging host`    | Bridge emitted non-JSON output                       | Confirm Node >= 20 and no global `require` hook.           |
| `EADDRINUSE`                                                 | Port already bound                                   | Change the port in the popup, or free the conflicting PID. |

---

## 3. Connect button succeeded but the client still cannot connect

1. `tabrix doctor` — inspects installation, manifest, permissions, and Node path.
2. Confirm Tabrix is globally installed:

   ```bash
   tabrix -V
   ```

3. Confirm the manifest is in the correct directory:
   - Windows: `%APPDATA%\Google\Chrome\NativeMessagingHosts\com.tabrix.nativehost.json`
   - macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.tabrix.nativehost.json`
   - Linux: `~/.config/google-chrome/NativeMessagingHosts/com.tabrix.nativehost.json`

4. Check logs:
   - Windows: `%LOCALAPPDATA%\tabrix\logs\`
   - macOS: `~/Library/Logs/tabrix/`
   - Linux: `~/.local/state/tabrix/logs/`

5. Fix execution permissions if the wrapper script is not executable:

   ```bash
   tabrix fix-permissions
   ```

6. If you are using a Node version manager (nvm, volta, asdf, fnm), the wrapper may not find Node. Either:

   ```bash
   export CHROME_MCP_NODE_PATH=/path/to/your/node
   ```

   or run `tabrix doctor --fix`, which persists the current Node path.

---

## 4. Platform FAQ

### 4.1 Windows

**Installed as administrator, cannot connect**

`npm install -g` under an admin shell writes the registration into the admin user context. A normal-user Chrome will not find it. Re-run registration as a normal user:

```powershell
tabrix register
```

Global install and registration should always run as a normal user. Only `register --system` requires admin.

**pnpm did not run the postinstall registration**

pnpm v7+ disables postinstall scripts by default.

```powershell
# Option 1 (recommended): enable postinstall scripts
pnpm config set enable-pre-post-scripts true
pnpm install -g @tabrix/tabrix@latest

# Option 2: register manually
pnpm install -g @tabrix/tabrix@latest
tabrix register
```

**Browser automation still not ready after install**

Tabrix installed successfully, but no Chrome/Chromium was detected yet. This is "browser automation not ready", not "install failed".

```powershell
tabrix doctor --fix
tabrix register
```

Then look at:

- `tabrix doctor --json` → `browser.executable`
- Persisted config: `C:\Users\<you>\.tabrix\browser.json`

If still empty, install Chrome or Chromium first.

**Node version manager shim breaks native host**

Native host uses the absolute path in the manifest. A shim path from nvm-windows / fnm / volta may fail.

```powershell
set CHROME_MCP_NODE_PATH=C:\Program Files\nodejs\node.exe
tabrix register
# or
tabrix doctor --fix
```

`doctor --fix` writes the current `node.exe` path into `node_path.txt`.

**Port 12306 already in use (`EADDRINUSE`)**

```powershell
netstat -ano | findstr :12306
taskkill /PID <pid> /F
```

Or change the port in the popup settings and update the client config to match.

**Firewall or security software blocks localhost**

- Allow `127.0.0.1:12306` in the firewall.
- Allow `node.exe` to access the local network in your security software.

**JSON path escaping on Windows**

```json
// wrong
{ "command": "C:\Users\me\node.exe" }

// right
{ "command": "C:\\Users\\me\\node.exe" }
// also right (Node and Chrome accept forward slashes)
{ "command": "C:/Users/me/node.exe" }
```

**`EBUSY` warning during `dist` cleanup**

Non-fatal. The build still completes. For a clean build, disconnect in the popup, wait a few seconds, rebuild, then reconnect.

**Chrome loaded an old unpacked directory**

Chrome remembers the **first** unpack directory.

- Load the extension from a stable directory and never move it.
- Or mirror the latest build into that stable directory:

  ```powershell
  robocopy .\app\chrome-extension\.output\chrome-mv3 C:\stable-ext /MIR
  ```

- Check `tabrix doctor` → `Chrome extension path`.

**Remote popup shows the wrong IP**

When `MCP_HTTP_HOST=0.0.0.0` or the remote switch is on, the popup auto-selects a LAN IP (WLAN/Wi-Fi > Ethernet > other physical > virtual/VPN, with `192.168.x.x` and `10.x.x.x` scored higher). If it still picks a VPN or virtual-adapter IP, replace the IP manually in the copied config.

**Remote connection blocked by firewall**

```powershell
netsh advfirewall firewall add rule name="Tabrix MCP Bridge" dir=in action=allow protocol=tcp localport=12306
```

Verify:

```powershell
netstat -ano | findstr :12306
```

Should show `0.0.0.0:12306  LISTENING`.

**Remote connection returns `401 Unauthorized`**

Token missing, mismatched, or expired. When the server listens on `0.0.0.0`, remote IPs must carry the Bearer token.

1. Open popup → `Remote` tab → inspect the token and its expiry.
2. Click `Regenerate` if expired.
3. Paste the token into the remote client config:

   ```json
   {
     "mcpServers": {
       "tabrix": {
         "url": "http://<lan-ip>:12306/mcp",
         "headers": { "Authorization": "Bearer <token-from-popup>" }
       }
     }
   }
   ```

Localhost requests bypass the token. `/ping` and `/status` are also public.

### 4.2 macOS / Linux

Most failures on macOS and Linux fall into one of three buckets:

- Permission on the wrapper script: `tabrix fix-permissions`.
- Node version manager shim: `export CHROME_MCP_NODE_PATH=/real/path/to/node` then `tabrix register`.
- Chrome profile / extension reload dropped the ID: `tabrix register` again.

---

## 5. Browser-first GitHub triage

For visible GitHub failures (Actions, PRs, Issues), prefer a browser-first path before script-only diagnosis.

```bash
tabrix status
tabrix doctor --fix
tabrix mcp tools
tabrix mcp call chrome_navigate --arg url="https://github.com/<owner>/<repo>/actions"
tabrix mcp call chrome_read_page --arg filter=interactive --arg depth=2
```

Narrow extraction ladder for complex pages:

1. `chrome_get_web_content` with a narrow selector.
2. `chrome_get_interactive_elements`.
3. `chrome_screenshot` as a visual check.
4. `chrome_javascript` only as an explicit fallback (for `document.body.innerText` or DOM debugging).

If any tool call returns a structured failure with one `nextAction`, execute that action and retry.

### Recovery smoke during maintenance windows

```bash
tabrix smoke --bridge-recovery --json
tabrix smoke --command-channel-recovery fail-next-send --json
tabrix smoke --command-channel-recovery fail-all-sends --json
```

---

## 6. Log locations

- Windows: `%LOCALAPPDATA%\tabrix\logs\`
- macOS: `~/Library/Logs/tabrix/`
- Linux: `~/.local/state/tabrix/logs/`

The standalone daemon additionally writes to `~/.tabrix/daemon.log`.

---

## 7. Diagnostic cheat sheet

```bash
tabrix -V
node -v

tabrix status        # live runtime snapshot
tabrix doctor        # installation + manifest + runtime + live MCP initialize
tabrix doctor --fix  # auto-repair common issues
tabrix smoke         # real browser smoke
tabrix report --copy # shareable diagnostics
```

Related docs:

- [Quickstart](./QUICKSTART.md) — first-time install and first task.
- [CLI and MCP Config](./CLI_AND_MCP.md) — per-client configuration snippets.
- [Error Codes](./ERROR_CODES.md) — structured error reference.
