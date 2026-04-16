# CLI MCP Configuration Guide

This guide explains how to configure Codex CLI and Claude Code to connect to Tabrix.

## Overview

Tabrix exposes its MCP interface at `http://127.0.0.1:12306/mcp` by default.
Both Codex CLI and Claude Code can connect through `Streamable HTTP`, and stdio-only hosts can use `tabrix-stdio`.

## Codex CLI Configuration

### Option 1: Streamable HTTP MCP Server (Recommended)

Add the following to your `~/.codex/config.json`:

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Option 2: Via Environment Variable

Set the preferred MCP port environment variable before running Codex CLI:

```bash
export CHROME_MCP_PORT=12306
```

`MCP_HTTP_PORT` is still accepted as a backward-compatible alias, but `CHROME_MCP_PORT` is the current preferred variable.

## Claude Code Configuration

### Option 1: Streamable HTTP MCP Server

Run:

```bash
claude mcp add tabrix --transport http http://127.0.0.1:12306/mcp
```

Or add the following to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Option 2: Stdio Server (Alternative)

If you prefer stdio-based MCP communication:

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "tabrix-stdio"
    }
  }
}
```

If `tabrix-stdio` is not on `PATH`, use the script entry directly:

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

## Verifying Connection

After configuration, the CLI tools should be able to see and use Tabrix tools such as:

- `get_windows_and_tabs` - Get browser window and tab information
- `chrome_navigate` - Navigate to a URL
- `chrome_click_element` - Click on page elements
- `chrome_get_web_content` - Get page content
- And more...

## Troubleshooting

### Connection Refused

If you get "connection refused" errors:

1. Ensure the Chrome extension is installed and the native server is running
2. Check that the port matches (default: 12306)
3. Verify no firewall is blocking localhost connections
4. Run `tabrix doctor --fix` to diagnose and auto-fix common issues

### Tools Not Appearing

If MCP tools don't appear in the CLI:

1. Restart the CLI tool after configuration changes
2. Check the configuration file syntax (valid JSON)
3. Ensure the MCP server URL is accessible

### Port Conflicts

If port 12306 is already in use:

1. Set a custom port in the extension settings
2. Update the CLI configuration to match the new port
3. Run `tabrix update-port <new-port>` to update the stdio config

## Environment Variables

| Variable                     | Description                                 | Default |
| ---------------------------- | ------------------------------------------- | ------- |
| `CHROME_MCP_PORT`            | Preferred HTTP port variable for MCP server | 12306   |
| `MCP_HTTP_PORT`              | Backward-compatible HTTP port alias         | 12306   |
| `MCP_ALLOWED_WORKSPACE_BASE` | Additional allowed workspace directory      | (none)  |
| `CHROME_MCP_NODE_PATH`       | Override Node.js executable path            | (auto)  |
