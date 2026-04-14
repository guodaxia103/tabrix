# Tabrix 项目结构指南

本文档从“代码放在哪里、功能是怎么串起来的”两个角度，快速说明 Tabrix 当前仓库结构，方便后续开发时定位入口文件。

配套文档：

- 架构设计：`docs/ARCHITECTURE_zh.md`
- 贡献流程：`docs/CONTRIBUTING_zh.md`
- CLI 命令：`docs/CLI_zh.md`
- 工具清单：`docs/TOOLS_zh.md`

## 1. 仓库总览

Tabrix 是一个 `pnpm` monorepo，核心由“Chrome 扩展 + 本地原生服务 + 共享协议层 + WASM 加速包”组成。

```text
tabrix/
├─ app/
│  ├─ chrome-extension/    # 浏览器扩展，真正执行浏览器能力
│  └─ native-server/       # 本地 Node 服务，提供 CLI / MCP / Native Messaging
├─ packages/
│  ├─ shared/              # 共享类型、工具 schema、流程图定义
│  └─ wasm-simd/           # Rust/WebAssembly SIMD 数学加速
├─ docs/                   # 用户与开发者文档
├─ scripts/                # 仓库级脚本，例如 i18n / release / 清理 / wasm 复制
├─ skills/                 # Tabrix 自带 Skill 说明
├─ prompt/                 # 一些提示词模板
└─ releases/               # 发布相关说明
```

## 2. Workspace 分工

### `app/chrome-extension/`

浏览器侧主程序。真正和 Chrome API、页面 DOM、内容脚本、录制回放、语义检索打交道的代码都在这里。

关键目录：

- `entrypoints/background/`
  - 扩展后台主入口，统一初始化 Native Host、工具执行器、录制回放、语义引擎、Quick Panel、Web Editor 等能力。
  - `index.ts` 是最重要的后台入口。
- `entrypoints/background/tools/`
  - 浏览器工具实现目录。
  - `browser/*.ts` 里包含导航、点击、键盘、截图、网络、JS 执行、书签、历史、上传等工具。
- `entrypoints/background/record-replay-v3/`
  - 新版流程编排和回放引擎。
  - `domain/` 放领域模型，`engine/` 放运行时、调度、触发器、恢复机制，`storage/` 放持久化。
- `entrypoints/popup/`
  - 扩展弹窗 UI，主要负责连接状态、远程访问、端口与 Native Host 状态展示。
- `entrypoints/sidepanel/`
  - 侧边栏 UI，承载 Agent Chat、工作流列表、RR-V3 调试界面等。
- `entrypoints/web-editor-v2/`
  - 页面可视化编辑器相关逻辑。
- `inject-scripts/`
  - 注入到页面环境的脚本，负责页面交互、观测、截图辅助、网络辅助、录制等。
- `shared/`
  - 扩展内复用逻辑，目前包含 selector、element picker、quick panel 等。
- `utils/`
  - 语义相似度、向量检索、截图上下文、offscreen 管理、IndexedDB 封装等通用能力。
- `workers/`
  - ONNX / WASM / 向量计算相关 worker 与产物。
- `tests/`
  - `vitest` 测试，重点覆盖 popup 状态、record-replay、web-editor-v2 等模块。

### `app/native-server/`

本地 Node 服务，负责把扩展能力包装成 CLI、HTTP MCP 服务和 Native Messaging Host。

关键目录：

- `src/index.ts`
  - 服务主入口，负责把 HTTP Server 和 Native Messaging Host 绑定在一起。
- `src/cli.ts`
  - CLI 命令入口，对外暴露 `tabrix` 和 `tabrix-stdio`。
- `src/server/`
  - Fastify 服务层。
  - 包含 `/ping`、`/status`、认证、MCP 路由、Agent 路由、会话注册表等。
- `src/mcp/`
  - MCP server 与工具注册。
  - `register-tools.ts` 会把 `@tabrix/shared` 里的工具 schema 暴露给客户端，并把执行请求转发给扩展。
- `src/native-messaging-host.ts`
  - Native Messaging Host，实现 Node 与扩展之间的双向消息桥接。
- `src/scripts/`
  - CLI 子命令实现，例如 `register`、`doctor`、`status`、`smoke`、`report`、`setup`、`daemon`。
- `src/execution/`
  - 工具调用和流程执行状态管理、结果归一化。
- `src/agent/`
  - Agent 相关后端能力。
  - 包含项目管理、消息/会话管理、流式输出、附件处理，以及 `codex` / `claude` 引擎适配。

### `packages/shared/`

浏览器扩展和原生服务之间的共享协议层。

主要内容：

- `tools.ts`：MCP 工具 schema，是“新增工具”时最先要改的地方之一。
- `types.ts` / `constants.ts`：跨端通用类型和常量。
- `step-types.ts`、`rr-graph.ts`、`node-spec*.ts`
  - 录制回放和节点编排模型定义。
- `agent-types.ts`
  - Agent 能力用到的共享类型。

### `packages/wasm-simd/`

Rust 写的 SIMD 数学加速包，主要给扩展侧的语义相似度和向量运算提供性能支持。

主要文件：

- `src/lib.rs`：核心 Rust 实现
- `Cargo.toml`：Rust 构建配置
- `BUILD.md` / `README.md`：WASM 构建说明

## 3. 三条核心链路

### MCP 工具调用链

```text
MCP Client
  -> app/native-server/src/mcp/register-tools.ts
  -> app/native-server/src/native-messaging-host.ts
  -> app/chrome-extension/entrypoints/background/native-host.ts
  -> app/chrome-extension/entrypoints/background/tools/*
  -> Chrome APIs / content script / page
```

适合排查：

- 工具为什么没有出现在 MCP 工具列表里
- 工具调用为什么超时
- 某个工具在扩展侧具体由谁执行

### 扩展连接与状态链

```text
popup / sidepanel
  -> background/native-host.ts
  -> chrome.runtime.connectNative(...)
  -> native-server/src/native-messaging-host.ts
  -> native-server/src/server/index.ts
```

适合排查：

- 点击 Connect 后为什么没有连上
- 远程访问、Token、端口状态为什么不一致

### 工作流 / Record-Replay V3 链

```text
sidepanel workflows / background bootstrap
  -> record-replay-v3/domain
  -> record-replay-v3/engine
  -> record-replay-v3/storage
  -> background/tools/record-replay.ts 或动态 flow 工具
```

适合排查：

- 流程发布、触发、调度、恢复
- v2 到 v3 的兼容转换
- 动态 `flow.<slug>` 工具生成

## 4. 常见开发入口

### 新增一个浏览器工具

建议阅读顺序：

1. `packages/shared/src/tools.ts`
2. `app/chrome-extension/entrypoints/background/tools/index.ts`
3. 对应的 `app/chrome-extension/entrypoints/background/tools/browser/*.ts`
4. `app/native-server/src/mcp/register-tools.ts`

### 修改弹窗连接体验

优先看：

- `app/chrome-extension/entrypoints/popup/`
- `app/chrome-extension/common/popup-*.ts`
- `app/chrome-extension/entrypoints/background/native-host.ts`

### 修改 Agent / 侧边栏能力

优先看：

- `app/chrome-extension/entrypoints/sidepanel/components/agent-chat/`
- `app/chrome-extension/entrypoints/sidepanel/composables/useAgent*.ts`
- `app/native-server/src/server/routes/agent.ts`
- `app/native-server/src/agent/*`

### 修改工作流 / 录制回放

优先看：

- `app/chrome-extension/entrypoints/background/record-replay-v3/`
- `app/chrome-extension/tests/record-replay-v3/`
- `packages/shared/src/node-spec*.ts`

### 修改服务端鉴权、远程访问和状态页

优先看：

- `app/native-server/src/server/auth.ts`
- `app/native-server/src/server/index.ts`
- `app/native-server/src/scripts/status.ts`
- `app/chrome-extension/entrypoints/background/native-host.ts`

## 5. 推荐阅读顺序

如果要快速进入开发状态，建议按这个顺序读：

1. `README_zh.md`
2. `docs/ARCHITECTURE_zh.md`
3. 本文档
4. `packages/shared/src/tools.ts`
5. `app/native-server/src/mcp/register-tools.ts`
6. `app/chrome-extension/entrypoints/background/index.ts`
7. 你准备修改的具体模块目录

## 6. 当前仓库的一些观察

- 代码主体已经从“单纯浏览器工具集”扩展到了“三层系统”：
  - MCP 服务层
  - 浏览器执行层
  - Agent / Workflow 产品层
- `record-replay-v3` 和 `sidepanel/agent-chat` 是当前最复杂、最值得提前建立上下文的两个区域。
- `packages/shared/` 是跨端稳定边界。只要涉及工具 schema、流程节点定义或共享类型，优先先看这里，能显著减少两端不一致的问题。

## 7. 后续维护建议

- 新增顶层能力时，优先在本文档补充“目录职责 + 开发入口”，比只写发布说明更利于后续协作。
- 如果以后新增独立 workspace（例如桌面端、Firefox 扩展、云端控制台），建议继续按 `app/*` 或 `packages/*` 分层，保持 monorepo 心智模型稳定。
