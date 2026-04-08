# Chrome MCP Server 🚀

[![许可证: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Chrome 扩展](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://developer.chrome.com/docs/extensions/)

> 🌟 **让chrome浏览器变成你的智能助手** - 让AI接管你的浏览器，将您的浏览器转变为强大的 AI 控制自动化工具。

**📖 文档**: [English](README.md) | [中文](README_zh.md)

> 项目仍处于早期阶段，正在紧锣密鼓开发中，后续将有更多新功能，以及稳定性等的提升，如遇bug，请轻喷

---

## 🎯 什么是 Chrome MCP Server？

Chrome MCP Server 是一个基于chrome插件的 **模型上下文协议 (MCP) 服务器**，它将您的 Chrome 浏览器功能暴露给 Claude 等 AI 助手，实现复杂的浏览器自动化、内容分析和语义搜索等。与传统的浏览器自动化工具（如playwright）不同，**Chrome MCP server**直接使用您日常使用的chrome浏览器，基于现有的用户习惯和配置、登录态，让各种大模型或者各种chatbot都可以接管你的浏览器，真正成为你的日常助手

## ✨ 新功能(2025/12/30)

- **让 Claude Code / Codex 也能使用的可视化编辑器**：详情请看 [VisualEditor](docs/VisualEditor_zh.md)
- **稳定运行时诊断**：使用 `mcp-chrome-bridge status`、`doctor`、`report` 快速排障

## 📘 运维指南

- [快速入门](docs/STABLE_QUICKSTART.md)
- [CoPaw 集成指南](docs/COPAW.md)
- [Phase 0 工具验证矩阵](docs/PHASE0_TOOL_VALIDATION_MATRIX.md)

## ✨ 核心特性

- 😁 **chatbot/模型无关**：让任意你喜欢的llm或chatbot客户端或agent来自动化操作你的浏览器
- ⭐️ **使用你原本的浏览器**：无缝集成用户本身的浏览器环境（你的配置、登录态等）
- 💻 **完全本地运行**：纯本地运行的mcp server，保证用户隐私
- 🚄 **Streamable http**：Streamable http的连接方式
- 🏎 **跨标签页** 跨标签页的上下文
- 🧠 **语义搜索**：内置向量数据库和本地小模型，智能发现浏览器标签页内容
- 🔍 **智能内容分析**：AI 驱动的文本提取和相似度匹配
- 🌐 **28 个工具**：支持截图、网络监控、交互操作、书签管理、浏览历史等完整浏览器自动化能力
- 🚀 **SIMD 加速 AI**：自定义 WebAssembly SIMD 优化，向量运算速度提升 4-8 倍

## 🆚 与同类项目对比

| 对比维度           | 基于Playwright的MCP Server                                          | 基于Chrome插件的MCP Server                                    |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| **资源占用**       | ❌ 需启动独立浏览器进程，需要安装Playwright依赖，下载浏览器二进制等 | ✅ 无需启动独立的浏览器进程，直接利用用户已打开的Chrome浏览器 |
| **用户会话复用**   | ❌ 需重新登录                                                       | ✅ 自动使用已登录状态                                         |
| **浏览器环境保持** | ❌ 干净环境缺少用户设置                                             | ✅ 完整保留用户环境                                           |
| **API访问权限**    | ⚠️ 受限于Playwright API                                             | ✅ Chrome原生API全访问                                        |
| **启动速度**       | ❌ 需启动浏览器进程                                                 | ✅ 只需激活插件                                               |
| **响应速度**       | 50-200ms进程间通信                                                  | ✅ 更快                                                       |

## 🚀 快速开始

### 环境要求

- Node.js >= 20.0.0 和 （npm 或 pnpm）
- Chrome/Chromium 浏览器

### 安装步骤

1. **从github上下载最新的chrome扩展**

下载地址：https://github.com/hangwin/mcp-chrome/releases

2. **全局安装mcp-chrome-bridge**

npm

```bash
npm install -g mcp-chrome-bridge
```

pnpm

```bash
# 方法1：全局启用脚本（推荐）
pnpm config set enable-pre-post-scripts true
pnpm install -g mcp-chrome-bridge

# 方法2：如果 postinstall 没有运行，手动注册
pnpm install -g mcp-chrome-bridge
mcp-chrome-bridge register
```

**引导式安装（注册 + 后续步骤）：** 安装完成后，运行 `mcp-chrome-bridge setup` 执行注册并查看后续检查清单（扩展加载 URL、`doctor`、`smoke`）。

> 注意：pnpm v7+ 默认禁用 postinstall 脚本以提高安全性。`enable-pre-post-scripts` 设置控制是否运行 pre/post 安装脚本。如果自动注册失败，请使用上述手动注册命令。

3. **加载 Chrome 扩展**
   - 打开 Chrome 并访问 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"，选择 `your/dowloaded/extension/folder`
   - 点击插件图标打开插件，点击连接即可看到mcp的配置
     <img width="475" alt="截屏2025-06-09 15 52 06" src="https://github.com/user-attachments/assets/241e57b8-c55f-41a4-9188-0367293dc5bc" />

### 本地验证

安装完成后，使用以下命令验证环境：

```bash
mcp-chrome-bridge status
mcp-chrome-bridge doctor
mcp-chrome-bridge smoke
```

如果 popup 显示已连接但本地服务未启动，点击 popup 的 `刷新` 按钮或 `断开 → 连接`。详细排障流程见 [快速入门](docs/STABLE_QUICKSTART.md)。

### 在支持MCP协议的客户端中使用

#### 使用streamable http的方式连接（👍🏻推荐）

将以下配置添加到客户端的 MCP 配置中以cherryStudio为例：

> 推荐用streamable http的连接方式

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

#### 使用stdio的方式连接（备选）

假设你的客户端仅支持stdio的连接方式，那么请使用下面的方法：

1. 先查看你刚刚安装的npm包的安装位置

```sh
# npm 查看方式
npm list -g mcp-chrome-bridge
# pnpm 查看方式
pnpm list -g mcp-chrome-bridge
```

假设上面的命令输出的路径是：/Users/xxx/Library/pnpm/global/5
那么你的最终路径就是：/Users/xxx/Library/pnpm/global/5/node_modules/mcp-chrome-bridge/dist/mcp/mcp-server-stdio.js

2. 把下面的配置替换成你刚刚得到的最终路径

```json
{
  "mcpServers": {
    "chrome-mcp-stdio": {
      "command": "npx",
      "args": [
        "node",
        "/Users/xxx/Library/pnpm/global/5/node_modules/mcp-chrome-bridge/dist/mcp/mcp-server-stdio.js"
      ]
    }
  }
}
```

比如：在augment中的配置如下：

<img width="494" alt="截屏2025-06-22 22 11 25" src="https://github.com/user-attachments/assets/07c0b090-622b-433d-be70-44e8cb8980a5" />

## 🛠️ 可用工具 (28)

完整工具列表：[工具 API (中文)](docs/TOOLS_zh.md) | [TOOLS API (EN)](docs/TOOLS.md)

<details>
<summary><strong>📊 浏览器管理 (4个工具)</strong></summary>

- `get_windows_and_tabs` - 列出所有浏览器窗口和标签页
- `chrome_navigate` - 导航到 URL、刷新、前进/后退
- `chrome_switch_tab` - 切换当前显示的标签页
- `chrome_close_tabs` - 关闭特定标签页或窗口
</details>

<details>
<summary><strong>🖱️ 页面交互 (6个工具)</strong></summary>

- `chrome_computer` - 鼠标、键盘、滚动、截图 — 统一交互工具
- `chrome_click_element` - 通过 CSS/XPath/ref/坐标 点击元素
- `chrome_fill_or_select` - 填充表单输入、下拉框、复选框
- `chrome_keyboard` - 模拟键盘快捷键和特殊按键
- `chrome_request_element_selection` - 人工辅助元素选择器
- `chrome_upload_file` - 上传文件到文件输入框
</details>

<details>
<summary><strong>🔍 内容读取 (4个工具)</strong></summary>

- `chrome_read_page` - 页面可见元素的可访问性树
- `chrome_get_web_content` - 从页面提取 HTML/文本内容
- `chrome_get_interactive_elements` - 查找可交互元素
- `chrome_console` - 捕获控制台输出（快照模式或持久缓冲）
</details>

<details>
<summary><strong>📸 截图与录制 (3个工具)</strong></summary>

- `chrome_screenshot` - 高级截图：元素定位、全页面、自定义尺寸
- `chrome_gif_recorder` - 录制浏览器操作为动态 GIF
- `chrome_handle_dialog` - 处理 JS alert/confirm/prompt 弹窗
</details>

<details>
<summary><strong>🌐 网络 (3个工具)</strong></summary>

- `chrome_network_capture` - 启动/停止网络流量捕获（webRequest 或 Debugger）
- `chrome_network_request` - 使用浏览器 cookie/session 发送 HTTP 请求
- `chrome_handle_download` - 等待下载完成并返回文件详情
</details>

<details>
<summary><strong>📈 性能 (3个工具)</strong></summary>

- `performance_start_trace` - 启动性能追踪录制
- `performance_stop_trace` - 停止追踪并可选保存到下载目录
- `performance_analyze_insight` - 分析最近录制的追踪摘要
</details>

<details>
<summary><strong>📚 数据管理 (4个工具)</strong></summary>

- `chrome_history` - 搜索浏览器历史记录，支持时间过滤
- `chrome_bookmark_search` - 按关键词查找书签
- `chrome_bookmark_add` - 添加新书签，支持文件夹
- `chrome_bookmark_delete` - 删除书签
</details>

<details>
<summary><strong>🔧 高级 / JavaScript</strong></summary>

- `chrome_javascript` - 在浏览器标签页中执行 JavaScript（CDP + 回退）
</details>

## 🧪 使用示例

### ai帮你总结网页内容然后自动控制excalidraw画图

prompt: [excalidraw-prompt](prompt/excalidraw-prompt.md)
指令：帮我总结当前页面内容，然后画个图帮我理解
https://www.youtube.com/watch?v=3fBPdUBWVz0

https://github.com/user-attachments/assets/f14f79a6-9390-4821-8296-06d020bcfc07

### ai先分析图片的内容元素，然后再自动控制excalidraw把图片模仿出来

prompt: [excalidraw-prompt](prompt/excalidraw-prompt.md)|[content-analize](prompt/content-analize.md)
指令：先看下图片是否能用excalidraw画出来，如果则列出所需的步骤和元素，然后画出来
https://www.youtube.com/watch?v=tEPdHZBzbZk

https://github.com/user-attachments/assets/4f0600c1-bb1e-4b57-85ab-36c8bdf71c68

### ai自动帮你注入脚本并修改网页的样式

prompt: [modify-web-prompt](prompt/modify-web.md)
指令：帮我修改当前页面的样式，去掉广告
https://youtu.be/twI6apRKHsk

https://github.com/user-attachments/assets/aedbe98d-e90c-4a58-a4a5-d888f7293d8e

### ai自动帮你捕获网络请求

指令：我想知道小红书的搜索接口是哪个，响应体结构是什么样的
https://youtu.be/1hHKr7XKqnQ

https://github.com/user-attachments/assets/dc7e5cab-b9af-4b9a-97ce-18e4837318d9

### ai帮你分析你的浏览记录

指令：分析一下我近一个月的浏览记录
https://youtu.be/jf2UZfrR2Vk

https://github.com/user-attachments/assets/31b2e064-88c6-4adb-96d7-50748b826eae

### 网页对话

指令：翻译并总结当前网页
https://youtu.be/FlJKS9UQyC8

https://github.com/user-attachments/assets/aa8ef2a1-2310-47e6-897a-769d85489396

### ai帮你自动截图（网页截图）

指令：把huggingface的首页截个图
https://youtu.be/7ycK6iksWi4

https://github.com/user-attachments/assets/65c6eee2-6366-493d-a3bd-2b27529ff5b3

### ai帮你自动截图（元素截图）

指令：把huggingface首页的图标截取下来
https://youtu.be/ev8VivANIrk

https://github.com/user-attachments/assets/d0cf9785-c2fe-4729-a3c5-7f2b8b96fe0c

### ai帮你管理书签

指令：将当前页面添加到书签中，放到合适的文件夹
https://youtu.be/R_83arKmFTo

https://github.com/user-attachments/assets/15a7d04c-0196-4b40-84c2-bafb5c26dfe0

### 自动关闭网页

指令：关闭所有shadcn相关的网页
https://youtu.be/2wzUT6eNVg4

https://github.com/user-attachments/assets/83de4008-bb7e-494d-9b0f-98325cfea592

## 🤝 贡献指南

我们欢迎贡献！请查看 [CONTRIBUTING_zh.md](docs/CONTRIBUTING_zh.md) 了解详细指南。

## 🚧 未来发展路线图

我们对 Chrome MCP Server 的未来发展有着激动人心的计划：

- [ ] 身份认证

- [ ] 录制与回放

- [ ] 工作流自动化

- [ ] 增强浏览器支持（Firefox 扩展）

---

**想要为这些功能中的任何一个做贡献？** 查看我们的[贡献指南](docs/CONTRIBUTING_zh.md)并加入我们的开发社区！

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 📚 文档

### 用户文档

- [为什么选 mcp-chrome？(vs Playwright / browser-use)](docs/WHY_MCP_CHROME.md) — 定位与取舍
- [快速入门](docs/STABLE_QUICKSTART.md) — 安装、验证、首次成功
- [工具 API (中文)](docs/TOOLS_zh.md) | [TOOLS API (EN)](docs/TOOLS.md) — 完整工具参考
- [MCP 传输方式 (HTTP / SSE / stdio)](docs/TRANSPORT.md) — 选择哪种模式
- [客户端配置速查卡](docs/CLIENT_CONFIG_QUICKREF.md) — 7 种 MCP 客户端配置，复制即用
- [Popup 状态排障表](docs/POPUP_TROUBLESHOOTING.md) — 状态圆点含义与修复方法
- [故障排除](docs/TROUBLESHOOTING_zh.md) — 常见问题解决方案
- [CoPaw 集成指南](docs/COPAW.md) — 与 CoPaw AI 客户端配合使用

### AI 助手文档

- [AI 助手技能包（跨客户端通用）](skills/chrome_mcp_browser/SKILL.md) — 任意 MCP 客户端可用的操作手册

### 开发者文档

- [架构设计](docs/ARCHITECTURE_zh.md) — 详细技术架构说明
- [安全考量](docs/SECURITY.md) — Prompt Injection 风险、工具风险分类
- [错误码目录](docs/ERROR_CODES.md) — 统一错误码参考
- [贡献指南](docs/CONTRIBUTING_zh.md) — 如何参与贡献
- [可视化编辑器](docs/VisualEditor_zh.md) — Claude Code & Codex 可视化编辑器

## 微信交流群

拉群的目的是让踩过坑的大佬们互相帮忙解答问题，因本人平时要忙着搬砖，不一定能及时解答

![IMG_6296](https://github.com/user-attachments/assets/ecd2e084-24d2-4038-b75f-3ab020b55594)
