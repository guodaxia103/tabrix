# Tabrix 🚀

[![Stars](https://img.shields.io/github/stars/guodaxia103/tabrix)](https://img.shields.io/github/stars/guodaxia103/tabrix)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://developer.chrome.com/docs/extensions/)
[![Release](https://img.shields.io/github/v/release/guodaxia103/tabrix.svg)](https://img.shields.io/github/v/release/guodaxia103/tabrix.svg)

> 🌟 **Turn your Chrome browser into your intelligent assistant** - Tabrix lets AI take control of your browser, transforming it into a powerful automation tool.

**📖 Documentation**: [English](README.md) | [中文](README_zh.md)

> The project is still in its early stages and is under intensive development. More features, stability improvements, and other enhancements will follow.

---

## 📜 Project Origin

Tabrix is a community-driven continuation of the original open-source project [`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome).

As upstream maintenance cadence slowed for an extended period and issue backlog pressure grew, we launched Tabrix to provide sustained maintenance, faster fixes, and a clearer product roadmap.

Special thanks to all original maintainers and contributors for building the foundation that made this project possible.

## 🤝 Maintenance Commitment

- We will continue maintaining Tabrix with regular updates and bug fixes.
- We will publish release notes for every significant version.
- We will keep practical backward compatibility whenever possible.

## 🔔 Tabrix 2.0 (2026-04-10)

Full notes: [Release Notes v2.0.0](docs/RELEASE_NOTES_v2.0.0.md)

### Added

- Standardized latest-install flow: `npm install -g tabrix@latest` and `pnpm install -g tabrix@latest`.
- Automated npm release workflow triggered by Git tags (`v*` / `tabrix-v*`).
- Portable assistant skill renamed and aligned to Tabrix: `skills/tabrix_browser`.

### Changed

- Rebranded package and command from `mcp-chrome-bridge` to `tabrix`.
- Kept compatibility aliases for existing users (`mcp-chrome-bridge`, `mcp-chrome-stdio`).
- Updated repository references, docs links, and public-facing project structure.

### Fixed

- Resolved package publishing risk caused by workspace dependency (`chrome-mcp-shared` now uses semver range).
- Added compatibility fallback for remote-access message types when shared enum versions differ.

---

## 🎯 What is Tabrix?

Tabrix is a Chrome extension-based **Model Context Protocol (MCP) server** that exposes your Chrome browser functionality to AI assistants like Claude, enabling complex browser automation, content analysis, and semantic search. Unlike traditional browser automation tools (like Playwright), **Tabrix** directly uses your daily Chrome browser, leveraging existing user habits, configurations, and login states, allowing various large models or chatbots to take control of your browser and truly become your everyday assistant.

## ✨ Current Highlights

- **A New Visual Editor for Claude Code & Codex**, for more detail here: [VisualEditor](docs/VisualEditor.md)
- **Stable runtime diagnostics**: use `tabrix status`, `doctor`, and `report` for faster local troubleshooting

## 📘 Stable Ops Guides

- [Stable Quickstart](docs/STABLE_QUICKSTART.md)

## ✨ Core Features

- 😁 **Chatbot/Model Agnostic**: Let any LLM or chatbot client or agent you prefer automate your browser
- ⭐️ **Use Your Original Browser**: Seamlessly integrate with your existing browser environment (your configurations, login states, etc.)
- 💻 **Fully Local**: Pure local MCP server ensuring user privacy
- 🚄 **Streamable HTTP**: Streamable HTTP connection method
- 🏎 **Cross-Tab**: Cross-tab context
- 🧠 **Semantic Search**: Built-in vector database for intelligent browser tab content discovery
- 🔍 **Smart Content Analysis**: AI-powered text extraction and similarity matching
- 🌐 **20+ Tools**: Support for screenshots, network monitoring, interactive operations, bookmark management, browsing history, and 20+ other tools
- 🚀 **SIMD-Accelerated AI**: Custom WebAssembly SIMD optimization for 4-8x faster vector operations

## 🆚 Comparison with Similar Projects

| Comparison Dimension    | Playwright-based MCP Server                                                                                               | Chrome Extension-based MCP Server                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Resource Usage**      | ❌ Requires launching independent browser process, installing Playwright dependencies, downloading browser binaries, etc. | ✅ No need to launch independent browser process, directly utilizes user's already open Chrome browser |
| **User Session Reuse**  | ❌ Requires re-login                                                                                                      | ✅ Automatically uses existing login state                                                             |
| **Browser Environment** | ❌ Clean environment lacks user settings                                                                                  | ✅ Fully preserves user environment                                                                    |
| **API Access**          | ⚠️ Limited to Playwright API                                                                                              | ✅ Full access to Chrome native APIs                                                                   |
| **Startup Speed**       | ❌ Requires launching browser process                                                                                     | ✅ Only needs to activate extension                                                                    |
| **Response Speed**      | 50-200ms inter-process communication                                                                                      | ✅ Faster                                                                                              |

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20.0.0 and pnpm/npm
- Chrome/Chromium browser

### Installation Steps

1. **Download the latest Chrome extension from GitHub**

Download link: https://github.com/guodaxia103/tabrix/releases

2. **Install tabrix globally**

npm

```bash
npm install -g tabrix@latest
```

pnpm

```bash
# Method 1: Enable scripts globally (recommended)
pnpm config set enable-pre-post-scripts true
pnpm install -g tabrix@latest

# Method 2: Manual registration (if postinstall doesn't run)
pnpm install -g tabrix@latest
tabrix register
```

**Guided setup (register + next steps):** after install, you can run `tabrix setup` for the same registration flow plus a short checklist (extension load URL, `doctor`, `smoke`).

> Note: pnpm v7+ disables postinstall scripts by default for security. The `enable-pre-post-scripts` setting controls whether pre/post install scripts run. If automatic registration fails, use the manual registration command above.

3. **Load Chrome Extension**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select `your/dowloaded/extension/folder`
   - Click the extension icon to open the plugin, then click connect to see the MCP configuration
     <img width="475" alt="Screenshot 2025-06-09 15 52 06" src="https://github.com/user-attachments/assets/241e57b8-c55f-41a4-9188-0367293dc5bc" />

### Stable local verification

For a hardened local validation flow, use:

```bash
tabrix status
tabrix doctor
tabrix smoke
```

Use the popup `Refresh` button or `Disconnect -> Connect` if the UI says connected but the local service is not running yet. For the full troubleshooting flow, see [Stable Quickstart](docs/STABLE_QUICKSTART.md).

### Standalone Daemon (optional)

By default, the MCP server starts when Chrome launches the native host. To keep the MCP service online **even when Chrome is closed** (e.g., after a reboot, allowing AI clients to connect immediately):

```bash
# Start daemon in the background
tabrix daemon start

# Check daemon status
tabrix daemon status

# Stop daemon
tabrix daemon stop

# (Windows) Install autostart on login
tabrix daemon install-autostart

# (Windows) Remove autostart
tabrix daemon remove-autostart
```

> **Note**: In daemon mode, browser-specific tools (like `chrome_screenshot`) are unavailable until Chrome opens and the extension connects. Non-browser tools work normally. Daemon logs are saved to `~/.tabrix/daemon.log`.

### Remote Access (optional)

To allow LAN machines or Docker containers to connect:

1. Open the extension popup → **Remote** tab → toggle the **remote access switch** ON. The server immediately restarts on `0.0.0.0` — no browser restart needed. The preference is saved to `~/.tabrix/config.json` and persists across reconnects and browser restarts.
2. A Token is auto-generated on first enable (saved to `~/.tabrix/auth-token.json`). The popup displays the full MCP config including the `Authorization` header.
3. Allow the port through your firewall, then copy the config to the remote machine.

> **Advanced**: Set `MCP_HTTP_HOST=0.0.0.0` as an OS env var to override the config file (useful for daemon mode). Token expires in 7 days by default (`MCP_AUTH_TOKEN_TTL`). Localhost requests bypass token auth.

### Usage with MCP Protocol Clients

#### Using Streamable HTTP Connection (👍🏻 Recommended)

Add the following configuration to your MCP client configuration (using CherryStudio as an example):

> Streamable HTTP connection method is recommended

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

#### Using STDIO Connection (Alternative)

If your client only supports stdio connection method, please use the following approach:

1. First, check the installation location of the npm package you just installed

```sh
# npm check method
npm list -g tabrix
# pnpm check method
pnpm list -g tabrix
```

Assuming the command above outputs the path: /Users/xxx/Library/pnpm/global/5
Then your final path would be: /Users/xxx/Library/pnpm/global/5/node_modules/tabrix/dist/mcp/mcp-server-stdio.js

2. Replace the configuration below with the final path you just obtained

```json
{
  "mcpServers": {
    "chrome-mcp-stdio": {
      "command": "npx",
      "args": [
        "node",
        "/Users/xxx/Library/pnpm/global/5/node_modules/tabrix/dist/mcp/mcp-server-stdio.js"
      ]
    }
  }
}
```

eg：config in augment:

<img width="494" alt="截屏2025-06-22 22 11 25" src="https://github.com/user-attachments/assets/48eefc0c-a257-4d3b-8bbe-d7ff716de2bf" />

## 🛠️ Available Tools (27+)

Complete tool list: [TOOLS API (EN)](docs/TOOLS.md) | [工具 API (中文)](docs/TOOLS_zh.md)

<details>
<summary><strong>📊 Browser Management (4 tools)</strong></summary>

- `get_windows_and_tabs` - List all browser windows and tabs
- `chrome_navigate` - Navigate to URLs, refresh, or go back/forward
- `chrome_switch_tab` - Switch the current active tab
- `chrome_close_tabs` - Close specific tabs or windows
</details>

<details>
<summary><strong>🖱️ Page Interaction (6 tools)</strong></summary>

- `chrome_computer` - Mouse, keyboard, scroll, screenshot — unified interaction
- `chrome_click_element` - Click elements via CSS/XPath/ref/coordinates
- `chrome_fill_or_select` - Fill form inputs, selects, checkboxes
- `chrome_keyboard` - Simulate keyboard shortcuts and special keys
- `chrome_request_element_selection` - Human-in-the-loop element picker
- `chrome_upload_file` - Upload files to file input elements
</details>

<details>
<summary><strong>🔍 Content Reading (4 tools)</strong></summary>

- `chrome_read_page` - Accessibility tree of visible elements
- `chrome_get_web_content` - Extract HTML/text content from pages
- `chrome_get_interactive_elements` - Find clickable/interactive elements
- `chrome_console` - Capture console output (snapshot or persistent buffer)
</details>

<details>
<summary><strong>📸 Screenshots & Recording (3 tools)</strong></summary>

- `chrome_screenshot` - Advanced screenshot with element targeting and full-page
- `chrome_gif_recorder` - Record browser activity as animated GIF
- `chrome_handle_dialog` - Handle JS alert/confirm/prompt dialogs
</details>

<details>
<summary><strong>🌐 Network (3 tools)</strong></summary>

- `chrome_network_capture` - Start/stop network traffic capture (webRequest or Debugger)
- `chrome_network_request` - Send HTTP requests with browser cookies/session
- `chrome_handle_download` - Wait for downloads and return file details
</details>

<details>
<summary><strong>📈 Performance (3 tools)</strong></summary>

- `performance_start_trace` - Start a performance trace recording
- `performance_stop_trace` - Stop trace and optionally save to Downloads
- `performance_analyze_insight` - Summarize the last recorded trace
</details>

<details>
<summary><strong>📚 Data Management (4 tools)</strong></summary>

- `chrome_history` - Search browser history with time filters
- `chrome_bookmark_search` - Find bookmarks by keywords
- `chrome_bookmark_add` - Add new bookmarks with folder support
- `chrome_bookmark_delete` - Delete bookmarks
</details>

<details>
<summary><strong>🔧 Advanced / JavaScript</strong></summary>

- `chrome_javascript` - Execute JavaScript in a browser tab (CDP + fallback)
</details>

## 🧪 Usage Examples

### AI helps you summarize webpage content and automatically control Excalidraw for drawing

prompt: [excalidraw-prompt](prompt/excalidraw-prompt.md)
Instruction: Help me summarize the current page content, then draw a diagram to aid my understanding.
https://www.youtube.com/watch?v=3fBPdUBWVz0

https://github.com/user-attachments/assets/fd17209b-303d-48db-9e5e-3717141df183

### After analyzing the content of the image, the LLM automatically controls Excalidraw to replicate the image

prompt: [excalidraw-prompt](prompt/excalidraw-prompt.md)|[content-analize](prompt/content-analize.md)
Instruction: First, analyze the content of the image, and then replicate the image by combining the analysis with the content of the image.
https://www.youtube.com/watch?v=tEPdHZBzbZk

https://github.com/user-attachments/assets/60d12b1a-9b74-40f4-994c-95e8fa1fc8d3

### AI automatically injects scripts and modifies webpage styles

prompt: [modify-web-prompt](prompt/modify-web.md)
Instruction: Help me modify the current page's style and remove advertisements.
https://youtu.be/twI6apRKHsk

https://github.com/user-attachments/assets/69cb561c-2e1e-4665-9411-4a3185f9643e

### AI automatically captures network requests for you

query: I want to know what the search API for Xiaohongshu is and what the response structure looks like

https://youtu.be/1hHKr7XKqnQ

https://github.com/user-attachments/assets/dc7e5cab-b9af-4b9a-97ce-18e4837318d9

### AI helps analyze your browsing history

query: Analyze my browsing history from the past month

https://youtu.be/jf2UZfrR2Vk

https://github.com/user-attachments/assets/31b2e064-88c6-4adb-96d7-50748b826eae

### Web page conversation

query: Translate and summarize the current web page
https://youtu.be/FlJKS9UQyC8

https://github.com/user-attachments/assets/aa8ef2a1-2310-47e6-897a-769d85489396

### AI automatically takes screenshots for you (web page screenshots)

query: Take a screenshot of Hugging Face's homepage
https://youtu.be/7ycK6iksWi4

https://github.com/user-attachments/assets/65c6eee2-6366-493d-a3bd-2b27529ff5b3

### AI automatically takes screenshots for you (element screenshots)

query: Capture the icon from Hugging Face's homepage
https://youtu.be/ev8VivANIrk

https://github.com/user-attachments/assets/d0cf9785-c2fe-4729-a3c5-7f2b8b96fe0c

### AI helps manage bookmarks

query: Add the current page to bookmarks and put it in an appropriate folder

https://youtu.be/R_83arKmFTo

https://github.com/user-attachments/assets/15a7d04c-0196-4b40-84c2-bafb5c26dfe0

### Automatically close web pages

query: Close all shadcn-related web pages

https://youtu.be/2wzUT6eNVg4

https://github.com/user-attachments/assets/83de4008-bb7e-494d-9b0f-98325cfea592

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed guidelines.

## 🚧 Future Roadmap

We have exciting plans for the future development of Tabrix:

- [ ] Authentication
- [ ] Recording and Playback
- [ ] Workflow Automation
- [ ] Enhanced Browser Support (Firefox Extension)

---

**Want to contribute to any of these features?** Check out our [Contributing Guide](docs/CONTRIBUTING.md) and join our development community!

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📚 Documentation

### For Users

- [Release Notes v2.0.0](docs/RELEASE_NOTES_v2.0.0.md) — new features, fixes, migration notes
- [Why mcp-chrome? (vs Playwright / browser-use)](docs/WHY_MCP_CHROME.md) — positioning and tradeoffs
- [Stable Quickstart](docs/STABLE_QUICKSTART.md) — install, verify, first success
- [TOOLS API (EN)](docs/TOOLS.md) | [工具 API (中文)](docs/TOOLS_zh.md) — complete tool reference
- [MCP transports (HTTP / SSE / stdio)](docs/TRANSPORT.md) — which mode to use
- [Client Configuration Quick Reference](docs/CLIENT_CONFIG_QUICKREF.md) — copy-paste configs for 7 MCP clients
- [Popup Troubleshooting](docs/POPUP_TROUBLESHOOTING.md) — status dot meanings and fixes
- [Troubleshooting](docs/TROUBLESHOOTING.md) — common issue solutions

### For AI Assistants

- [AI assistant skill (portable)](skills/tabrix_browser/SKILL.md) — playbook for any MCP client

### For Developers & Contributors

- [Architecture Design](docs/ARCHITECTURE.md) — detailed technical architecture
- [Security Considerations](docs/SECURITY.md) — prompt injection risks, tool risk classification
- [Error Codes Directory](docs/ERROR_CODES.md) — unified error code reference
- [Contributing Guide](docs/CONTRIBUTING.md) — how to contribute
- [Visual Editor](docs/VisualEditor.md) — visual editor for Claude Code & Codex
