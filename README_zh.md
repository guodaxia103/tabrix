# Tabrix

[![Release](https://img.shields.io/github/v/release/guodaxia103/tabrix)](https://github.com/guodaxia103/tabrix/releases)
[![NPM Version](https://img.shields.io/npm/v/%40tabrix%2Ftabrix?color=cb3837)](https://www.npmjs.com/package/@tabrix/tabrix)
[![NPM Downloads](https://img.shields.io/npm/dm/%40tabrix%2Ftabrix)](https://www.npmjs.com/package/@tabrix/tabrix)
[![许可证: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

让真实 Chrome 成为 MCP 原生的 AI 执行层。

Tabrix 由 Chrome 扩展 + 本地原生服务组成，让任意 MCP 客户端都能安全高效地操作你日常使用的浏览器会话（保留登录态、Cookie、上下文）。

**文档**: [English](README.md) | [中文](README_zh.md)

---

## 为什么是 Tabrix

Tabrix 不是“再开一个新浏览器”，而是把你正在使用的 Chrome，直接升级为可被 AI 调用的执行层。

- 真实会话，开箱即用：沿用现有登录态、Cookie、扩展与标签页，无需从零重建环境
- 链路更稳更安全：基于扩展 + Native Messaging，无需长期暴露 `--remote-debugging-port`
- 远程控制默认可用：内置 Bearer Token 鉴权、Token 管理与有效期机制（TTL）
- 客户端广泛兼容：Claude Desktop、Cursor、Cline、Cherry Studio、Dify 等 MCP 客户端均可接入
- 本地优先架构：浏览器状态与数据默认留在本机，隐私与合规更可控
- 面向生产运维：提供 `tabrix status` / `doctor --fix` / `smoke` / `report` 闭环能力

### 场景价值

- 合规采集更稳定：复用真实会话，降低新环境与空白指纹带来的失败率
- 后台自动化更高效：覆盖 CMS、工单、运营后台等已登录流程，减少重复点击与人工切换
- 团队协作更灵活：支持局域网远程接入，同一浏览器能力可被多客户端安全调用
- 回归排障更高效：通过 `doctor --fix` 与 `smoke` 快速定位连接链路问题，显著缩短处理时间

## 你可以用它做什么

- 研究、测试、运营、客服场景的浏览器 Copilot
- 带语义上下文的跨标签页自动化
- 带人工确认节点的安全网页工作流
- 浏览器能力与文件/API 的 MCP 工具链组合

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

### 4) MCP 客户端连接（Streamable HTTP）

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

主流 AI 助手与 MCP 客户端配置（[OpenClaw](https://github.com/openclaw/openclaw)、[CoPaw](https://github.com/guodaxia103/copaw)、Claude Desktop、Cursor、Cline、Cherry Studio、Dify 等）见：
[客户端配置速查](docs/CLIENT_CONFIG_QUICKREF.md)

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
- 截图、GIF 录制、性能追踪分析
- 书签/历史记录操作与 JS 执行

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

诊断问题（自动修复用 `--fix`）：

```bash
tabrix doctor
```

```bash
tabrix doctor --fix
```

浏览器链路冒烟测试：

```bash
tabrix smoke
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

完整命令文档见：[CLI_zh.md](docs/CLI_zh.md)

完整工具清单：
[工具 API (中文)](docs/TOOLS_zh.md) | [TOOLS API (EN)](docs/TOOLS.md)

## 路线图（开源 + 产品）

- [ ] 智能 DOM 理解与高强度脱水管线
- [ ] 工作流录制与可复现回放
- [ ] 策略化安全与权限模型
- [ ] 团队工作区与多操作者协同
- [ ] Firefox 扩展支持

如果你想共建路线图条目，欢迎提 issue（带 proposal 和架构思路）。

## 贡献

欢迎首次贡献者和长期维护者共同参与。

- 贡献指南：[CONTRIBUTING_zh.md](docs/CONTRIBUTING_zh.md)
- 新手任务入口：[good first issue 列表](https://github.com/guodaxia103/tabrix/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
- 社区讨论区：[GitHub Discussions](https://github.com/guodaxia103/tabrix/discussions)
- 架构说明：[ARCHITECTURE_zh.md](docs/ARCHITECTURE_zh.md)
- 安全模型：[SECURITY.md](docs/SECURITY.md)
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

### 用户文档

- [CLI 命令参考](docs/CLI_zh.md)
- [快速入门](docs/STABLE_QUICKSTART.md)
- [传输模式（Streamable HTTP / stdio）](docs/TRANSPORT.md)
- [Popup 排障](docs/POPUP_TROUBLESHOOTING.md)
- [故障排除](docs/TROUBLESHOOTING_zh.md)
- [Release Notes v2.0.5](docs/RELEASE_NOTES_v2.0.5.md)
- [Release Notes v2.0.4](docs/RELEASE_NOTES_v2.0.4.md)
- [Release Notes v2.0.3](docs/RELEASE_NOTES_v2.0.3.md)

### 开发者文档

- [架构设计](docs/ARCHITECTURE_zh.md)
- [项目结构指南](docs/PROJECT_STRUCTURE_zh.md)
- [产品定位与技术原则](docs/TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md)
- [工具分层与风险分级清单](docs/TABRIX_TOOL_LAYERING_AND_RISK_CLASSIFICATION_zh.md)
- [贡献指南](docs/CONTRIBUTING_zh.md)
- [发布流程](docs/RELEASE_PROCESS_zh.md)
- [可视化编辑器](docs/VisualEditor_zh.md)

## 许可证

MIT，详见 [LICENSE](LICENSE)。
