# Tabrix

[![Release](https://img.shields.io/github/v/release/guodaxia103/tabrix)](https://github.com/guodaxia103/tabrix/releases)
[![NPM Version](https://img.shields.io/npm/v/%40tabrix%2Ftabrix?color=cb3837)](https://www.npmjs.com/package/@tabrix/tabrix)
[![NPM Downloads](https://img.shields.io/npm/dm/%40tabrix%2Ftabrix)](https://www.npmjs.com/package/@tabrix/tabrix)
[![许可证: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

让真实 Chrome 成为 MCP 原生的 AI 执行层。

Tabrix 由 Chrome 扩展 + 本地原生服务组成，让任意 MCP 客户端都能安全高效地操作你日常使用的浏览器会话（保留登录态、Cookie、上下文）。

面向新一代 AI 助手而设计，让模型直接工作在用户每天都在使用的浏览器里。

- 复用真实登录 Chrome 会话，而不是反复重建全新浏览器运行时
- 同时支持 `Streamable HTTP` 和 `stdio` 两条 MCP 主接入路径
- 以本地优先为默认前提，并支持基于 Token 的局域网远程接入

**文档**: [English](README.md) | [中文](README_zh.md)

---

## 为什么是 Tabrix

Tabrix 不是“再开一个新浏览器”，而是把你正在使用的 Chrome，直接升级为可被 AI 调用的执行层。

- 真实会话，开箱即用：沿用现有登录态、Cookie、扩展与标签页，无需从零重建环境
- 链路更稳更安全：基于扩展 + Native Messaging，无需长期暴露 `--remote-debugging-port`
- 远程接入已就绪：提供局域网暴露所需的 Bearer Token 鉴权、Token 管理与有效期机制（TTL）
- 客户端广泛兼容：Claude Desktop、Cursor、Claude Code CLI、Codex CLI、Cherry Studio、Windsurf、Dify 等 MCP 客户端均可接入
- 本地优先架构：浏览器状态与数据默认留在本机，隐私与合规更可控
- 面向生产运维：提供 `tabrix status` / `doctor --fix` / `smoke` / `report` 闭环能力

### 为什么真实会话更重要

很多浏览器自动化工具从“全新浏览器运行时”开始，而 Tabrix 从团队已经在用的浏览器开始。

- 不必反复重建登录环境：直接沿用已有认证标签页、Cookie 和浏览器扩展
- 更适合真实后台工作：在实际使用的 CMS、工单、CRM、客服和运营系统里完成操作
- 更适合 AI 助手：让 Codex、Claude Desktop、Cursor、Cline 等客户端接入已经带上下文的浏览器

### 为什么不是再开一个浏览器

如果你的工作流依赖真实登录浏览器，这个差别会非常直接：

| 全新浏览器运行时             | Tabrix                                          |
| ---------------------------- | ----------------------------------------------- |
| 重新登录、重新准备 Cookie    | 直接复用已经在用的浏览器会话                    |
| 从空白标签页和空白上下文开始 | 从真实标签页、扩展和当前操作上下文开始          |
| 更偏向隔离式自动化运行       | 更适合 AI 助手接入用户日常浏览器                |
| 只有浏览器控制，不等于可运维 | 额外提供 `status`、`doctor`、`smoke` 和恢复链路 |

### 场景价值

- 合规采集更稳定：复用真实会话，降低新环境与空白指纹带来的失败率
- 后台自动化更高效：覆盖 CMS、工单、运营后台等已登录流程，减少重复点击与人工切换
- 团队协作更灵活：支持局域网远程接入，同一浏览器能力可被多客户端安全调用
- 回归排障更高效：通过 `doctor --fix` 与 `smoke` 快速定位连接链路问题，显著缩短处理时间
- 页面理解更低噪声：结构化读取、Endpoint Knowledge 和操作日志帮助 AI 在安全可用时避免不必要的整页读取

## 你可以用它做什么

- 研究、测试、运营、客服场景的浏览器 Copilot
- 带语义上下文的跨标签页自动化
- 带人工确认节点的安全网页工作流
- 浏览器能力与文件/API 的 MCP 工具链组合
- 基于 Knowledge 的页面读取：在 DOM 摘要、接口形态数据和 fallback 路径之间做更小、更稳的选择

## 前 5 分钟你会得到什么

一个很典型的首次成功路径是：

1. 保持你平时就在用的 Chrome 配置和业务页面处于打开状态
2. 安装 `@tabrix/tabrix`，加载扩展，并点击一次 `连接`
3. 在 Codex、Claude Desktop、Cursor 或其他 MCP 客户端中接入 Tabrix
4. 让 AI 助手检查当前页面、列出可交互元素，或继续执行下一步导航
5. 在同一个真实浏览器会话里继续完成点击、填写、截图和校验

第一次成功的感受，应该是“AI 终于能直接用我的真实浏览器了”，而不是“我又搭了一个新的自动化沙盒”。

## 3 分钟快速开始

### 1) 安装 CLI

```bash
npm install -g @tabrix/tabrix@latest
# 或
pnpm install -g @tabrix/tabrix@latest
```

现在 Tabrix 会把“安装成功”和“浏览器自动化已就绪”分开处理：

- CLI 安装可以先成功，即使当前机器还没安装 Chrome/Chromium
- `tabrix register`、`tabrix setup`、`tabrix doctor --fix` 会检测受支持浏览器是否就绪
- 检测到的浏览器可执行路径会被持久化保存，后续自动拉起浏览器时优先复用

如果 pnpm 未执行 postinstall：

```bash
tabrix register
```

### 2) 安装 Chrome 扩展

从 [Releases](https://github.com/guodaxia103/tabrix/releases) 下载版本资产，优先使用 `tabrix-extension-vX.Y.Z.zip`，在 `chrome://extensions` 中以“加载已解压扩展程序”方式安装。
安装后请打开扩展弹窗并点击一次 `连接` 完成连接。

### 3) 本地校验

检查当前运行状态：

```bash
tabrix status
```

异常自动修复：

```bash
tabrix doctor --fix
```

重点看这几个信号：

- `tabrix doctor --json` 里会新增 `browser.executable`
- 如果已检测到 Chrome/Chromium，Tabrix 会保存真实浏览器路径，后续自动启动优先使用它
- 如果未检测到受支持浏览器，Tabrix 仍算安装成功，但会明确提示“浏览器自动化未就绪”

### 4) MCP 客户端连接

Tabrix 当前正式支持两条 MCP 主链路：

- `Streamable HTTP`：默认的本机与远程接入方式
- `stdio`：适用于只支持 stdio 的 CLI 或 MCP 宿主

#### Streamable HTTP

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

#### stdio

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "tabrix-stdio"
    }
  }
}
```

主流 MCP 客户端配置（Claude Desktop、Cursor、Claude Code CLI、Codex CLI、Cherry Studio、Windsurf、Dify 等）见：
[CLI 与 MCP 配置](docs/CLI_AND_MCP.md)（公开英文文档）

## 🌐 远程控制

远程客户端配置示例：

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://<局域网IP>:12306/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TABRIX_TOKEN>"
      }
    }
  }
}
```

在扩展弹窗开启 `远程访问` 后，MCP 服务会监听：

- `http://<局域网IP>:12306/mcp`

### 30 秒开启远程

1. 打开扩展弹窗 -> 切换到 `远程` -> 打开 `远程访问`
2. 进入 `Token 管理`，复制当前 Token（或手动刷新）
3. 将上方远程配置粘贴到 MCP 客户端，开始远程自动化

### 认证与有效期

- 远程模式必须使用 Bearer Token 认证
- 扩展 `Token 管理` 页面可查看、复制、刷新 Token
- Token 有效期可自定义：在扩展 `Token 管理` -> `重新生成 Token` 中设置有效天数（`0` 表示永不过期）
- 也可通过环境变量 `MCP_AUTH_TOKEN_TTL` 设置默认有效天数
- 若设置环境变量 `MCP_AUTH_TOKEN`，则始终以该 Token 为准

## 核心能力

- 浏览器导航、标签页/窗口管理
- 页面交互（点击、输入、键盘、上传）
- 内容读取（网页内容、可交互元素、控制台）
- 网络捕获与请求重放辅助
- Knowledge 辅助的数据源路由：当观察到或种子化的 endpoint 安全可用时，走更紧凑的读取路径
- Operation Memory 日志：记录任务/会话/步骤证据，包括路由、fallback、耗时、节省 token 和 tab hygiene 元数据
- 截图、GIF 录制、性能追踪分析
- 书签/历史记录操作与 JS 执行

### Knowledge、Memory 与 fallback 边界

Tabrix 正在朝 MKEP 模型演进：Memory 记录发生了什么，Knowledge 记录站点/页面/接口能力，Experience 复用经过验证的成功路径，Policy 决定当前任务使用哪种数据源。

当前公开边界：

- Endpoint Knowledge 记录 endpoint pattern、语义提示、confidence 和 shape summary；不存 API response body、cookie、Authorization 或 raw request body。
- 已知公开场景的 seed adapter 仍是过渡路径。任意网站 observed endpoint 的通用复用是路线图方向，不是当前对所有网站的保证。
- 当 endpoint 不可用、不安全或语义不确定时，Tabrix 应 fallback 到 scoped DOM reading，而不是把接口路径当成绝对权威。
- Operation Memory 日志是诊断和报告用的事实证据，不是自动发布 Experience，也不是用户数据缓存。

### CLI 命令总览

安装后会提供这些可执行命令（可直接复制）：

```bash
tabrix
tabrix-stdio
```

首次引导（自动检查并提示下一步）：

```bash
tabrix setup
```

注册 Native Messaging Host：

```bash
tabrix register
```

修复本地执行权限：

```bash
tabrix fix-permissions
```

修改 MCP 端口：

```bash
tabrix update-port <port>
```

查看当前运行状态：

```bash
tabrix status
```

查看当前 MCP 客户端连接配置：

```bash
tabrix config
```

诊断问题（自动修复用 `--fix`）：

```bash
tabrix doctor
```

```bash
tabrix doctor --fix
```

查看当前 MCP 客户端与最近会话：

```bash
tabrix clients
```

浏览器链路冒烟测试：

```bash
tabrix smoke
```

如果你需要在独立浏览器窗口里跑 smoke：

```bash
tabrix smoke --separate-window
```

仅 stdio 链路测试：

```bash
tabrix stdio-smoke
```

导出诊断报告（可复制到剪贴板）：

```bash
tabrix report --copy
```

守护进程控制：

```bash
tabrix daemon start
```

```bash
tabrix daemon status
```

```bash
tabrix daemon stop
```

完整命令文档见：[CLI and MCP Configuration](docs/CLI_AND_MCP.md)（英文）

完整工具清单：[TOOLS API](docs/TOOLS.md)（英文）

## 公开路线图

Tabrix 的目标不是只做一个“能跑”的浏览器工具，而是做成面向 AI 助手的顶级真实浏览器执行层。
路线图会保持公开，但只会写那些当前代码基线能真实承接的方向。

- Now：把 `Streamable HTTP`、`stdio`、重连、诊断和紧凑结构化读取做得更稳
- Next：增强 observed Endpoint Knowledge、操作日志解释能力、Markdown/文档阅读面和真实浏览器 E2E 回归
- Later：演进经审核的 Experience 复用、replay artifact 和更安全的协作工作流

完整公开路线图见：[ROADMAP.md](docs/ROADMAP.md)（英文）

## 贡献

欢迎首次贡献者和长期维护者共同参与。

- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)（英文）
- 新手任务入口：[good first issue 列表](https://github.com/guodaxia103/tabrix/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
- 社区讨论区：[GitHub Discussions](https://github.com/guodaxia103/tabrix/discussions)
- 架构说明：[ARCHITECTURE.md](docs/ARCHITECTURE.md)（英文）
- 安全模型：[SECURITY.md](SECURITY.md)
- 错误码：[ERROR_CODES.md](docs/ERROR_CODES.md)

### 高价值贡献方向

- 稳定性与重连机制
- 工具 schema 一致性与开发体验
- 跨平台安装/打包质量
- 基准测试与回归覆盖

## 社区优先（当前阶段）

现阶段我们的核心目标是先建立社区影响力和项目口碑：

- 降低新用户和新贡献者的上手门槛
- 通过透明的 release notes 与 issue 响应提升信任感
- 持续提高跨平台、跨 MCP 客户端的稳定性
- 以公开路线图和维护者反馈机制驱动迭代

长期来看，在社区规模和生态成熟后，我们会探索可持续发展路径，并确保与开源社区目标保持一致。

## 项目来源与致谢

Tabrix 是对 [`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome) 的社区延续。

感谢上游维护者与历史贡献者打下基础。
Tabrix 将持续维护、持续迭代，并提供更清晰的产品路线。

## 文档索引

公开文档已统一为英文，仅保留根目录下的 `README_zh.md`（本文档）与 `AGENTS.md` 作为中文入口。内部治理、PRD、路线图排期、审计门禁、验收资产等材料由项目维护者在本仓库之外单独管理，不属于公开贡献契约的一部分。

### 用户文档（英文）

- [Quickstart](docs/QUICKSTART.md)
- [CLI and MCP Configuration](docs/CLI_AND_MCP.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Changelog](CHANGELOG.md)
- [GitHub Releases](https://github.com/guodaxia103/tabrix/releases)

### 开发者文档（英文）

- [Docs Index](docs/README.md)
- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Project Structure](docs/PROJECT_STRUCTURE.md)
- [Product Surface Matrix](docs/PRODUCT_SURFACE_MATRIX.md)
- [Compatibility Matrix](docs/COMPATIBILITY_MATRIX.md)
- [Platform Support](docs/PLATFORM_SUPPORT.md)
- [Tools API](docs/TOOLS.md)
- [Testing](docs/TESTING.md)
- [Use Cases](docs/USE_CASES.md)
- [Roadmap](docs/ROADMAP.md)
- [Release Process](docs/RELEASE_PROCESS.md)
- [Why MCP on Chrome](docs/WHY_MCP_CHROME.md)
- [Error Codes](docs/ERROR_CODES.md)

### 内部治理文档

PRD、产品定位与技术原理、工具分层与风险分级、内部 AI 开发规则、代码入口与责任地图、T4 验收门禁、OSV 安全门禁、发布前检查清单、v2 发布门禁标准、三方复用矩阵/工作流、浏览器桥接状态机设计、Browser Tool Settle Audit、Skills 目录、维护日志等内部材料由项目维护者在本仓库之外单独管理，不属于对外贡献契约的一部分。外部贡献者与 AI 助手只需依赖本仓库公开文档即可完成公开面开发。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
