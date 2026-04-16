# Tabrix

[![Release](https://img.shields.io/github/v/release/guodaxia103/tabrix)](https://github.com/guodaxia103/tabrix/releases)
[![NPM Version](https://img.shields.io/npm/v/%40tabrix%2Ftabrix?color=cb3837)](https://www.npmjs.com/package/@tabrix/tabrix)
[![NPM Downloads](https://img.shields.io/npm/dm/%40tabrix%2Ftabrix)](https://www.npmjs.com/package/@tabrix/tabrix)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

Turn real Chrome into an MCP-native AI execution layer.

Tabrix is a Chrome extension + local native server that lets any MCP client operate your daily browser session safely and efficiently, with your existing logins, cookies, and browsing context.

**Documentation**: [English](README.md) | [Chinese](README_zh.md)

---

## Why Tabrix

Tabrix does not spin up "yet another browser." It upgrades your current Chrome into an AI-executable runtime.

- Real session, ready instantly: keep your existing logins, cookies, extensions, and tabs without rebuilding environments
- More stable and safer runtime path: extension + Native Messaging, without keeping `--remote-debugging-port` exposed
- Remote control by default: built-in Bearer auth, token management, and token TTL controls
- Broad client compatibility: works with Claude Desktop, Cursor, Cline, Cherry Studio, Dify, and other MCP clients
- Local-first architecture: browser state and data stay on your machine by default for stronger privacy and compliance control
- Production operations built in: `tabrix status` / `doctor --fix` / `smoke` / `report`

### Scenario Value

- More reliable compliant collection: real-session reuse reduces failures from fresh environments and blank fingerprints
- Higher back-office automation efficiency: automate logged-in CMS, ticketing, and operations workflows with fewer repetitive clicks
- Better team collaboration: secure LAN remote access lets multiple MCP clients call the same browser capability
- Faster regression troubleshooting: `doctor --fix` and `smoke` quickly pinpoint connection-path issues and shorten resolution time

## What You Can Build

- Browser copilots for research, QA, operations, and support
- Cross-tab task automation with semantic context
- Safe web workflows with human-in-the-loop checkpoints
- MCP toolchains that combine browser, filesystem, and APIs

## Quick Start (3 Minutes)

### 1) Install CLI

```bash
npm install -g @tabrix/tabrix@latest
# or
pnpm install -g @tabrix/tabrix@latest
```

Tabrix installation and browser readiness are now treated separately:

- CLI install can succeed even if Chrome/Chromium is not installed yet
- Browser automation becomes ready after `tabrix register`, `tabrix setup`, or `tabrix doctor --fix` detects a supported browser executable
- The detected browser path is persisted and reused for later auto-launch

If pnpm does not run postinstall scripts:

```bash
tabrix register
```

### 2) Install Chrome Extension

Download from [Releases](https://github.com/guodaxia103/tabrix/releases), then load the `tabrix-extension-vX.Y.Z.zip` unpacked folder at `chrome://extensions`.
After loading, open the extension popup and click `Connect` once.

### 3) Verify Environment

Check runtime status:

```bash
tabrix status
```

Run automatic recovery:

```bash
tabrix doctor --fix
```

What to look for:

- `tabrix doctor --json` now includes `browser.executable`
- If Chrome/Chromium is ready, Tabrix persists the resolved path for later browser auto-launch
- If no supported browser is detected, Tabrix stays installed but reports browser automation as not ready

### 4) Connect from MCP Client (Streamable HTTP)

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

Configs for popular AI assistants and MCP clients ([OpenClaw](https://github.com/openclaw/openclaw), [CoPaw](https://github.com/guodaxia103/copaw), Claude Desktop, Cursor, Cline, Cherry Studio, Dify, etc.):
[Client Config Quick Reference](docs/CLIENT_CONFIG_QUICKREF.md)

## 🌐 Remote Control

Typical remote MCP config:

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://<LAN_IP>:12306/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TABRIX_TOKEN>"
      }
    }
  }
}
```

Turn on `Remote Access` in extension popup and expose:

- `http://<LAN_IP>:12306/mcp`

### Enable In 30 Seconds

1. Open extension popup -> switch to `Remote` -> enable `Remote Access`
2. Open `Token Management` and copy current token (or click refresh)
3. Paste LAN config to your MCP client and start remote automation

### Security Default

- Remote mode must use bearer-token authentication
- Extension `Token Management` page supports view/copy/refresh
- Token validity is configurable:
  - Set custom days in `Token Management` -> `Refresh Token`
  - Or set `MCP_AUTH_TOKEN_TTL` (`0` means never expire)
- If `MCP_AUTH_TOKEN` env is set, env token always has priority

## Core Capabilities

- Browser navigation and tab/window control
- Page interaction (click, fill, keyboard, upload)
- Rich extraction (web content, interactive elements, console)
- Network capture and request replay helpers
- Screenshot, GIF recording, performance trace analysis
- Bookmarks/history operations and JavaScript execution

### CLI Commands

Installed executables:

```bash
tabrix
tabrix-stdio
```

First-time guided setup:

```bash
tabrix setup
```

Register Native Messaging host:

```bash
tabrix register
```

Fix local execution permissions:

```bash
tabrix fix-permissions
```

Update MCP port:

```bash
tabrix update-port <port>
```

Check current runtime status:

```bash
tabrix status
```

Diagnose issues (`--fix` applies common auto-fixes):

```bash
tabrix doctor
```

```bash
tabrix doctor --fix
```

Run browser-path smoke test:

```bash
tabrix smoke
```

Run stdio-only smoke test:

```bash
tabrix stdio-smoke
```

Export diagnostics report (copy to clipboard):

```bash
tabrix report --copy
```

Daemon lifecycle commands:

```bash
tabrix daemon start
```

```bash
tabrix daemon status
```

```bash
tabrix daemon stop
```

Full command reference: [CLI.md](docs/CLI.md)

Full tool list: [TOOLS API (EN)](docs/TOOLS.md) | [TOOLS API (ZH)](docs/TOOLS_zh.md)

## Roadmap (Open Source + Product)

These are open collaboration directions rather than dated delivery commitments.

- [ ] Smart DOM Understanding and dehydration pipeline
- [ ] Workflow recording and deterministic replay
- [ ] Policy-based safety and permission model
- [ ] Team workspace and multi-operator collaboration
- [ ] Firefox extension support

If you want to co-build any roadmap item, open an issue with label proposal and architecture notes.

## Contributing

Contributions are welcome from both first-time contributors and maintainers.

- Start here: [Contributing Guide](docs/CONTRIBUTING.md)
- Good first issues: [Start with beginner-friendly tasks](https://github.com/guodaxia103/tabrix/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
- Community discussions: [GitHub Discussions](https://github.com/guodaxia103/tabrix/discussions)
- Architecture: [ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Security model: [SECURITY.md](docs/SECURITY.md)
- Error codes: [ERROR_CODES.md](docs/ERROR_CODES.md)

### High-impact contribution areas

- Reliability and reconnect stability
- Tool schema consistency and DX
- Cross-platform install and packaging quality
- Benchmarking and regression test coverage

## Community First (Current Phase)

Our current priority is community growth and project reputation:

- Lower onboarding friction for new users and contributors
- Keep release quality high with transparent changelogs and issue triage
- Improve reliability across platforms and MCP clients
- Build an open roadmap with active maintainer feedback

Long-term, once adoption and ecosystem maturity are in place, we may explore sustainable paths that remain compatible with the open-source community.

## Project Origin and Credits

Tabrix is a community-driven continuation of
[`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome).

We appreciate the original maintainers and contributors who created the foundation.
Tabrix exists to provide sustained maintenance, clearer roadmap execution, and faster iteration.

## Documentation Index

### For Users

- [CLI Commands](docs/CLI.md)
- [Stable Quickstart](docs/STABLE_QUICKSTART.md)
- [Transport Modes (Streamable HTTP / stdio)](docs/TRANSPORT.md)
- [Popup Troubleshooting](docs/POPUP_TROUBLESHOOTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Changelog](docs/CHANGELOG.md)
- [GitHub Releases](https://github.com/guodaxia103/tabrix/releases)

### For Developers

- [Docs Index](docs/README.md)
- [AI Contributor Quickstart (ZH)](docs/AI_CONTRIBUTOR_QUICKSTART_zh.md)
- [AI Development Rules (ZH)](docs/AI_DEV_RULES_zh.md)
- [Product Surface Matrix](docs/PRODUCT_SURFACE_MATRIX.md)
- [Testing Guide](docs/TESTING.md)
- [Platform Support](docs/PLATFORM_SUPPORT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Project Structure Guide](docs/PROJECT_STRUCTURE.md)
- [Code Entrypoints and Ownership (ZH)](docs/CODE_ENTRYPOINTS_AND_OWNERSHIP_zh.md)
- [Product Positioning and Technical Principles (ZH)](docs/TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md)
- [Tool Layering and Risk Classification (ZH)](docs/TABRIX_TOOL_LAYERING_AND_RISK_CLASSIFICATION_zh.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Visual Editor](docs/VISUAL_EDITOR.md)
- [Release Process](docs/RELEASE_PROCESS.md)

## License

MIT. See [LICENSE](LICENSE).
