# 🚀 Installation and Connection Issues

## Quick Diagnosis

Run the diagnostic tool to identify common issues:

```bash
tabrix doctor
```

To automatically fix common issues:

```bash
tabrix doctor --fix
```

## Export Report for GitHub Issues

If you need to open an issue, export a diagnostic report:

```bash
# Print Markdown report to terminal (copy/paste into GitHub Issue)
tabrix report

# Write to a file
tabrix report --output mcp-report.md

# Copy directly to clipboard
tabrix report --copy
```

By default, usernames, paths, and tokens are redacted. Use `--no-redact` if you're comfortable sharing full paths.

## Browser-First GitHub Triage

For visible GitHub failures, prefer a browser-first path before script-only diagnosis:

1. `tabrix status`
2. `tabrix doctor --fix`
3. `tabrix mcp tools`
4. Open target page in a new tab to avoid extension-page context conflict:

```bash
tabrix mcp call chrome_navigate --arg url="https://github.com/<owner>/<repo>/actions"
tabrix mcp call chrome_read_page --arg filter=interactive --arg depth=2
```

For complex pages:

1. `chrome_get_web_content` with a narrow selector
2. `chrome_get_interactive_elements`
3. `chrome_screenshot` for visual confirmation
4. `chrome_javascript` fallback only when the above is insufficient

If any tool call returns a structured failure with one `nextAction`, execute that action and retry immediately. This keeps triage fast and explicit.

## GitHub Failure Verification

You can run one quick recovery check during maintenance windows:

```bash
tabrix smoke --bridge-recovery --json
tabrix smoke --command-channel-recovery fail-next-send --json
tabrix smoke --command-channel-recovery fail-all-sends --json
```

## If Connection Fails After Clicking the Connect Button on the Extension

1. **Run the diagnostic tool first**

```bash
tabrix doctor
```

This will check installation, manifest, permissions, and Node.js path.

2. **Check if tabrix is installed successfully**, ensure it's globally installed

```bash
tabrix -V
```

<img width="612" alt="Screenshot 2025-06-11 15 09 57" src="https://github.com/user-attachments/assets/59458532-e6e1-457c-8c82-3756a5dbb28e" />

2. **Check if the manifest file is in the correct directory**

Windows path: C:\Users\xxx\AppData\Roaming\Google\Chrome\NativeMessagingHosts

Mac path: /Users/xxx/Library/Application\ Support/Google/Chrome/NativeMessagingHosts

If the npm package is installed correctly, a file named `com.tabrix.nativehost.json` should be generated in this directory

3. **Check logs**
   Logs are now stored in user-writable directories:

- **macOS**: `~/Library/Logs/tabrix/`
- **Windows**: `%LOCALAPPDATA%\tabrix\logs\`
- **Linux**: `~/.local/state/tabrix/logs/`

<img width="804" alt="Screenshot 2025-06-11 15 09 41" src="https://github.com/user-attachments/assets/ce7b7c94-7c84-409a-8210-c9317823aae1" />

4. **Check if you have execution permissions**
   You need to check your installation path (if unclear, open the manifest file in step 2, the path field shows the installation directory). For example, if the Mac installation path is as follows:

`xxx/node_modules/@tabrix/tabrix/dist/run_host.sh`

Check if this script has execution permissions. Run to fix:

```bash
tabrix fix-permissions
```

5. **Node.js not found**
   If you use a Node version manager (nvm, volta, asdf, fnm), the wrapper script may not find Node.js. Set the `CHROME_MCP_NODE_PATH` environment variable:

```bash
export CHROME_MCP_NODE_PATH=/path/to/your/node
```

Or run `tabrix doctor --fix` to write the current Node path.

## Log Locations

Wrapper logs are now stored in user-writable locations:

- **macOS**: `~/Library/Logs/tabrix/`
- **Windows**: `%LOCALAPPDATA%\tabrix\logs\`
- **Linux**: `~/.local/state/tabrix/logs/`
