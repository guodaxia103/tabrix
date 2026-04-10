# Tabrix

[![Release](https://img.shields.io/github/v/release/guodaxia103/tabrix)](https://github.com/guodaxia103/tabrix/releases)
[![NPM Version](https://img.shields.io/npm/v/%40tabrix%2Ftabrix?color=cb3837)](https://www.npmjs.com/package/@tabrix/tabrix)
[![NPM Downloads](https://img.shields.io/npm/dm/%40tabrix%2Ftabrix)](https://www.npmjs.com/package/@tabrix/tabrix)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

Turn real Chrome into an MCP-native AI execution layer.

Tabrix is a Chrome extension + local native server that lets any MCP client operate your daily browser session safely and efficiently, with your existing logins, cookies, and browsing context.

**Documentation**: [English](README.md) | [中文](README_zh.md)

---

## Why Tabrix

- Real browser session, not a clean-room browser process
- Model/client agnostic (works with any MCP-compatible assistant)
- Local-first architecture for privacy-sensitive workflows
- Production-focused diagnostics (`tabrix status`, `doctor`, `smoke`)

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

If pnpm does not run postinstall scripts:

```bash
tabrix register
```

### 2) Install Chrome Extension

Download from [Releases](https://github.com/guodaxia103/tabrix/releases), then load the `tabrix-extension-vX.Y.Z.zip` unpacked folder at `chrome://extensions`.

### 3) Verify Environment

```bash
tabrix status
tabrix doctor
tabrix smoke
```

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

Client-specific configs (Claude Desktop, Cursor, Cline, Cherry Studio, Dify, etc.):
[Client Config Quick Reference](docs/CLIENT_CONFIG_QUICKREF.md)

## Core Capabilities

- Browser navigation and tab/window control
- Page interaction (click, fill, keyboard, upload)
- Rich extraction (web content, interactive elements, console)
- Network capture and request replay helpers
- Screenshot, GIF recording, performance trace analysis
- Bookmarks/history operations and JavaScript execution

Full tool list: [TOOLS API (EN)](docs/TOOLS.md) | [工具 API (中文)](docs/TOOLS_zh.md)

## Roadmap (Open Source + Product)

- [ ] Smart DOM Understanding and dehydration pipeline
- [ ] Workflow recording and deterministic replay
- [ ] Policy-based safety and permission model
- [ ] Team workspace and multi-operator collaboration
- [ ] Firefox extension support

If you want to co-build any roadmap item, open an issue with label proposal and architecture notes.

## Contributing

Contributions are welcome from both first-time contributors and maintainers.

- Start here: [Contributing Guide](docs/CONTRIBUTING.md)
- Architecture: [ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Security model: [SECURITY.md](docs/SECURITY.md)
- Error codes: [ERROR_CODES.md](docs/ERROR_CODES.md)

### High-impact contribution areas

- Reliability and reconnect stability
- Tool schema consistency and DX
- Cross-platform install and packaging quality
- Benchmarking and regression test coverage

## Commercial Direction

Tabrix is open source under MIT and is being built with long-term commercial viability in mind.

Near-term product direction:

- Operational reliability for enterprise workflows
- Governance, observability, and permission controls
- Deployment profiles for individual, team, and managed environments

If you are interested in design partnership or enterprise adoption, open a discussion in this repository.

## Project Origin and Credits

Tabrix is a community-driven continuation of
[`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome).

We appreciate the original maintainers and contributors who created the foundation.
Tabrix exists to provide sustained maintenance, clearer roadmap execution, and faster iteration.

## Documentation Index

### For Users

- [Stable Quickstart](docs/STABLE_QUICKSTART.md)
- [Transport Modes (HTTP / SSE / stdio)](docs/TRANSPORT.md)
- [Popup Troubleshooting](docs/POPUP_TROUBLESHOOTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Release Notes v2.0.3](docs/RELEASE_NOTES_v2.0.3.md)

### For Developers

- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Visual Editor](docs/VisualEditor.md)

## License

MIT. See [LICENSE](LICENSE).
