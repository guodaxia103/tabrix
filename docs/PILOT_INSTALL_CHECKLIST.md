# Pilot Install Checklist

Last updated: `2026-04-05 19:12 Asia/Shanghai`

This checklist is for a pilot delivery or first internal rollout.

Goal:

- the user can install the local bridge
- Chrome can load the extension
- the extension can start the local MCP service
- an MCP client can connect and run a first browser task

## 1. Machine Preconditions

- [ ] Windows machine with Google Chrome installed
- [ ] Node.js `>= 20`
- [ ] `npm` available on `PATH`
- [ ] `pnpm` available on `PATH` if using source builds
- [ ] local firewall allows `127.0.0.1:12306`

Quick checks:

```powershell
node -v
npm -v
pnpm -v
```

## 2. Bridge Installation

Production-style install:

```powershell
npm install -g mcp-chrome-bridge
mcp-chrome-bridge register
```

Source-build install:

```powershell
cd D:\projects\ai\codex\mcp-chrome
pnpm install
pnpm --filter mcp-chrome-bridge build
node app\native-server\dist\cli.js register
```

Checks:

- [ ] native host manifest exists
- [ ] Chrome registry entry points to the expected manifest
- [ ] `mcp-chrome-bridge doctor` can see the manifest and registry

## 3. Extension Installation

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the extension folder
5. Open the popup
6. Click `Connect`

For source builds, use:

```powershell
D:\projects\ai\codex\mcp-chrome\app\chrome-extension\.output\chrome-mv3
```

Checks:

- [ ] popup shows server running
- [ ] `doctor` reports the expected `Chrome extension path`
- [ ] loaded path matches the folder you intended to run

## 4. Runtime Verification

Run:

```powershell
mcp-chrome-bridge status
mcp-chrome-bridge doctor
mcp-chrome-bridge smoke
```

Checks:

- [ ] `status` reports runtime information
- [ ] `doctor` shows healthy connectivity and runtime checks
- [ ] `smoke` runs at least the basic browser sanity path

Raw endpoint checks:

```powershell
curl http://127.0.0.1:12306/ping
curl http://127.0.0.1:12306/status
```

## 5. MCP Client Verification

Recommended Streamable HTTP config:

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

Checks:

- [ ] client can initialize MCP
- [ ] client can list tools
- [ ] client can call `get_windows_and_tabs`
- [ ] client can run one read action and one click/input action

## 6. CoPaw Verification

CoPaw client object:

```json
{
  "key": "streamable-mcp-server",
  "name": "streamable-mcp-server",
  "description": "",
  "enabled": true,
  "transport": "streamable_http",
  "url": "http://127.0.0.1:12306/mcp",
  "headers": {},
  "command": "",
  "args": [],
  "env": {},
  "cwd": ""
}
```

Checks:

- [ ] CoPaw loads the MCP client
- [ ] CoPaw can list tools
- [ ] CoPaw can call `get_windows_and_tabs`
- [ ] CoPaw can complete one explicit browser task

## 7. Common Recovery Actions

If something is wrong:

1. [ ] Re-run `mcp-chrome-bridge doctor`
2. [ ] Check `Chrome extension path`
3. [ ] In popup, try `Disconnect -> Connect`
4. [ ] Try the popup `Refresh`
5. [ ] Reload the unpacked extension once
6. [ ] Re-run `status` and `doctor`
7. [ ] Generate a report:

```powershell
mcp-chrome-bridge report --output .\mcp-chrome-report.md
```

## 8. Pilot Sign-Off

Pilot install is considered good when:

- [ ] bridge installs without manual registry edits
- [ ] extension can connect and start the service
- [ ] diagnostics explain failures clearly
- [ ] at least one MCP client works
- [ ] CoPaw can complete a high-value browser task
- [ ] the operator can recover from the most common failure modes
