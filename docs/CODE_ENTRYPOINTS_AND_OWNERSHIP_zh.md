# Tabrix 代码入口与责任地图

本文档不是目录介绍，而是给 AI 助手和开发者的“执行地图”：

> 遇到某类问题，应该先去看哪些文件；  
> 哪些目录是主责任区；  
> 修改时最容易漏哪些配套文件。

如果你已经知道仓库大致结构，但不知道任务该从哪下手，优先看这份文档。

---

## 1. 总体责任分区

### `app/chrome-extension/`

负责：

- 浏览器侧真实执行
- Chrome API / content script / DOM 交互
- Popup / Sidepanel / Web Editor 等前端入口
- Record-Replay v3 内核与部分运行逻辑

### `app/native-server/`

负责：

- CLI
- MCP server / transport
- 鉴权
- 状态输出
- 会话注册与桥状态
- Native Messaging Host

### `packages/shared/`

负责：

- 工具 schema
- 共享类型
- 节点模型
- 扩展与服务端之间的“共同语言”

### `docs/`

负责：

- 产品约束
- 架构解释
- 发布门槛
- 开发规则
- 验收标准

---

## 2. 常见任务对照表

## 2.1 改 Popup 连接页 / 服务配置 / 客户端列表

优先看：

- `app/chrome-extension/entrypoints/popup/App.vue`
- `app/chrome-extension/common/popup-connected-clients.ts`
- `app/chrome-extension/utils/i18n.ts`
- `app/chrome-extension/_locales/`
- `app/native-server/src/server/index.ts`
- `app/native-server/src/scripts/status.ts`

常见配套别漏：

- locale 文案
- `/status` 输出结构
- CLI `status` 文案和 JSON 结构
- README / 连接文档

## 2.2 改 transport / MCP 接入 / 客户端配置

优先看：

- `app/native-server/src/cli.ts`
- `app/native-server/src/index.ts`
- `app/native-server/src/server/index.ts`
- `app/native-server/src/mcp/`
- `docs/TRANSPORT.md`
- `docs/CLIENT_CONFIG_QUICKREF.md`

常见配套别漏：

- `stdio` 与 `Streamable HTTP` 是否仍是唯一 tier-1
- CLI 文档
- README 快速开始
- Popup 默认连接方式说明

## 2.3 改桥状态 / 会话注册 / 活跃客户端语义

优先看：

- `app/native-server/src/server/session-registry.ts`
- `app/native-server/src/server/index.ts`
- `app/native-server/src/scripts/status.ts`
- `app/chrome-extension/common/popup-connected-clients.ts`
- `docs/BROWSER_BRIDGE_STATE_DESIGN_zh.md`

常见配套别漏：

- `active / stale / disconnected`
- 原始 session 与产品侧“客户端”语义是否一致
- `/status` 是否暴露了足够字段
- Popup 是否只是 raw dump

## 2.4 改浏览器工具 schema / 工具注册

优先看：

- `packages/shared/src/tools.ts`
- `app/native-server/src/mcp/register-tools.ts`
- `app/chrome-extension/entrypoints/background/tools/index.ts`

常见配套别漏：

- 工具文档
- schema / 类型
- 工具风险分类
- 返回结构与错误码

## 2.5 改具体 browser tool 行为

优先看：

- `app/chrome-extension/entrypoints/background/tools/browser/`
- `app/chrome-extension/entrypoints/background/index.ts`
- `app/chrome-extension/inject-scripts/`

常见配套别漏：

- content-script 注入边界
- 非 web tab guard
- `target_not_found / page_not_ready / unsupported_page_type`
- 真实浏览器回归验证

## 2.6 改 Native Messaging / 扩展桥接

优先看：

- `app/native-server/src/native-messaging-host.ts`
- `app/native-server/src/index.ts`
- `app/chrome-extension/entrypoints/background/native-host.ts`
- `docs/BROWSER_BRIDGE_STATE_DESIGN_zh.md`

常见配套别漏：

- 本机服务重启
- 扩展 reload
- 真相源在服务端还是扩展端
- 心跳与连接状态是否一致

## 2.7 改 Record-Replay v3 / Flow / 触发器

优先看：

- `app/chrome-extension/entrypoints/background/record-replay-v3/`
- `packages/shared/src/node-spec*.ts`
- `packages/shared/src/rr-graph.ts`

常见配套别漏：

- flow schema
- storage
- trigger / engine
- 回放失败与恢复证据

## 2.8 改 Sidepanel / Agent Chat / Codex / Claude 适配

优先看：

- `app/chrome-extension/entrypoints/sidepanel/`
- `app/native-server/src/agent/`
- `app/native-server/src/server/routes/agent.ts`
- `docs/SKILLS_zh.md`

常见配套别漏：

- 客户端兼容矩阵
- 会话/消息结构
- 流式输出与附件
- 产品边界，不要扩大非主线能力面

## 2.9 改发布 / 安装 / doctor / smoke / report

优先看：

- `app/native-server/src/scripts/`
- `docs/RELEASE_PROCESS.md`
- `docs/RELEASE_READINESS_CHECKLIST_zh.md`
- `docs/FIRST_SUCCESS_GUIDE.md`
- `docs/POPUP_TROUBLESHOOTING.md`

常见配套别漏：

- 首小时成功路径
- Windows 安装差异
- 真实验收门禁
- release evidence

---

## 3. 哪些文件是高频真相源

如果时间紧，只能先看少数文件，优先看这批：

### 产品与规则真相源

- `AGENTS.md`
- `docs/AI_DEV_RULES_zh.md`
- `docs/TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md`
- `docs/PROJECT_REVIEW_2026Q2.md`

### 服务端主线真相源

- `app/native-server/src/server/index.ts`
- `app/native-server/src/cli.ts`
- `app/native-server/src/native-messaging-host.ts`
- `app/native-server/src/server/session-registry.ts`

### 扩展侧主线真相源

- `app/chrome-extension/entrypoints/background/index.ts`
- `app/chrome-extension/entrypoints/popup/App.vue`
- `app/chrome-extension/entrypoints/background/tools/`

### 协议层真相源

- `packages/shared/src/tools.ts`

---

## 4. 修改时最容易漏的配套项

### 改 Popup 时最容易漏

- `/status` 后端结构
- locale 文案
- CLI `status`
- 文档截图与文案示例

### 改 native-server 时最容易漏

- build / daemon restart
- 当前运行实例是否切到新代码
- doctor / smoke / report 输出
- 扩展端对新字段是否兼容

### 改 browser tool 时最容易漏

- 非 web tab
- 页面未稳定
- ref 失效
- fallbackChain
- 返回结构化错误而不是 runtime 噪音

### 改记录/回放时最容易漏

- shared node schema
- 旧数据兼容
- storage 迁移
- 失败证据

---

## 5. 文件级责任理解方式

当你打开一个文件时，先判断它属于哪一层：

1. **产品面文件**
   - 用户会直接看到或依赖其行为
2. **服务端真相源**
   - 最终状态、返回结构、桥状态由它说了算
3. **扩展执行层**
   - 真正碰浏览器、DOM、Chrome API
4. **共享协议层**
   - 两边都依赖，改动要更克制
5. **文档 / 流程层**
   - 决定外部表述、验收和发布

很多问题的根因，就是把“显示层”当成“真相源”来改。

---

## 6. 一条任务的默认切入顺序

推荐按这个顺序切入：

1. 先读产品 / 规则文档
2. 再找真相源文件
3. 再找执行层文件
4. 最后找 UI / 文案 / 测试配套

不要一上来就先改最显眼的页面文件。

---

## 7. 一句话总结

> 在 `Tabrix` 里，真正重要的不是“哪个页面看起来不对”，而是先分清：真相源在哪、执行层在哪、配套文件在哪，再做最小改动闭环。
