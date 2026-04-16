# Tabrix AI 助手快速上手

本文档给第一次进入 `Tabrix` 仓库的 AI 助手使用。  
目标不是完整介绍所有细节，而是让 AI 助手在 **10 分钟内**抓住：

1. 这是什么项目
2. 当前主线能力是什么
3. 应该先看哪些代码
4. 改完后应该怎么验证

如果你是第一次进入仓库，优先读这份文档，而不是直接在仓库里盲搜。

---

## 1. 一句话先记住

> `Tabrix = 接管用户真实 Chrome 的 MCP 原生执行层。`

它不是“再开一个浏览器”，而是：

- 复用用户当前真实 Chrome 会话
- 通过 Chrome 扩展 + 本地 native server 暴露 MCP 能力
- 让 AI 客户端在真实登录态、Cookie、标签页上下文里执行浏览器自动化

更完整的定位说明看：

- `README.md`
- `docs/TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md`
- `docs/WHY_MCP_CHROME.md`

---

## 2. 当前主线是什么

当前阶段只把以下两种连接方式视为 **tier-1 正式主线**：

1. `stdio`
2. `Streamable HTTP`

不要再把其他 transport、旧入口或临时路径当成与这两者同等重要的产品面。

当前主推能力面是：

- 真实 Chrome 浏览器自动化
- MCP 客户端接入
- 远程访问与状态诊断
- 稳定执行、恢复、回放、经验复用

当前不应继续扩大的区域：

- 扩展内智能助手默认产品面
- 未成熟的 workflow UI 默认产品面
- 与主线弱相关的本地模型 / 语义索引 / 向量搜索公开能力

配套文档：

- `docs/PROJECT_REVIEW_2026Q2.md`
- `docs/FEATURE_PRUNING_REVIEW_2026Q2_zh.md`
- `docs/product-management/PRODUCT_DECISION_LOG_zh.md`

---

## 3. 先读这 6 份文档

默认推荐阅读顺序：

1. `AGENTS.md`
2. `docs/AI_DEV_RULES_zh.md`
3. `README.md`
4. `docs/TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md`
5. `docs/PROJECT_STRUCTURE_zh.md`
6. `docs/BROWSER_BRIDGE_STATE_DESIGN_zh.md`

如果任务偏产品、发布、范围控制，再补读：

- `docs/PROJECT_REVIEW_2026Q2.md`
- `docs/product-management/PRODUCT_VERSION_PACKAGING_AND_RELEASE_PLAN_zh.md`
- `docs/product-management/PRODUCT_TASK_SYSTEM_AND_EXECUTION_QUEUE_zh.md`

如果任务偏工具设计与风险边界，再补读：

- `docs/TOOLS_zh.md`
- `docs/TABRIX_TOOL_LAYERING_AND_RISK_CLASSIFICATION_zh.md`
- `docs/ERROR_CODES.md`

---

## 4. 仓库怎么记

这是一个 `pnpm` monorepo，先记住 4 个主块：

```text
tabrix/
├─ app/chrome-extension/    浏览器扩展，真正执行浏览器能力
├─ app/native-server/       本地 Node 服务，提供 CLI / MCP / Native Messaging
├─ packages/shared/         扩展与服务端共享 schema / types / 节点模型
└─ docs/                    产品、架构、规则、发布、验收文档
```

简化理解：

- **扩展侧** 负责“真正碰浏览器”
- **native-server** 负责“对外提供 CLI / MCP / 状态 / 鉴权”
- **shared** 负责“跨端说同一种话”
- **docs** 负责“定义产品、规则、边界、发布”

---

## 5. 关键运行时链路

### 5.1 MCP 工具调用链

```text
MCP Client
  -> native-server MCP / transport
  -> Native Messaging / HTTP bridge
  -> extension background
  -> browser tool
  -> Chrome API / content script / page
```

适合排查：

- 工具为什么没注册
- 工具调用为什么超时
- 扩展侧到底是谁在执行

### 5.2 浏览器桥接与恢复链

```text
Popup / MCP request
  -> native-server status / bridge state
  -> browser process check
  -> extension heartbeat / native host connection
  -> recovery orchestrator
  -> resume tool call
```

适合排查：

- 浏览器没开为什么没自动恢复
- 扩展没连为什么状态还显示在线
- command channel 为什么未就绪

### 5.3 Record-Replay / 工作流链

```text
background bootstrap
  -> record-replay-v3 domain
  -> engine
  -> storage
  -> dynamic flow tools
```

适合排查：

- flow 发布与触发
- 回放恢复
- v3 内核行为

---

## 6. 改哪类问题，先看哪

### 改连接 / transport / MCP 接入

优先看：

- `app/native-server/src/cli.ts`
- `app/native-server/src/index.ts`
- `app/native-server/src/server/index.ts`
- `app/native-server/src/mcp/`
- `docs/TRANSPORT.md`

### 改 Popup / 连接状态 / 远程开关

优先看：

- `app/chrome-extension/entrypoints/popup/`
- `app/chrome-extension/common/popup-*.ts`
- `app/native-server/src/server/index.ts`
- `app/native-server/src/scripts/status.ts`

### 改浏览器工具 / 页面交互

优先看：

- `packages/shared/src/tools.ts`
- `app/chrome-extension/entrypoints/background/tools/`
- `app/chrome-extension/entrypoints/background/index.ts`

### 改桥状态 / 自动恢复 / 会话注册

优先看：

- `app/native-server/src/server/session-registry.ts`
- `app/native-server/src/server/index.ts`
- `docs/BROWSER_BRIDGE_STATE_DESIGN_zh.md`

### 改 record-replay v3 / flow

优先看：

- `app/chrome-extension/entrypoints/background/record-replay-v3/`
- `packages/shared/src/node-spec*.ts`

### 改 Agent / Codex / Claude 适配

优先看：

- `app/native-server/src/agent/`
- `app/native-server/src/server/routes/agent.ts`
- `docs/SKILLS_zh.md`

---

## 7. 先用哪组命令验证

### 纯文档改动

- 检查改动范围只在文档

### 单模块逻辑修复

- 先跑对应定向测试
- 再跑对应包测试

### 扩展代码改动

- `pnpm -C app/chrome-extension test`
- `pnpm -C app/chrome-extension typecheck`
- 如影响真实浏览器行为：重新 build 并 reload unpacked 扩展

### native-server 改动

- 定向测试
- `pnpm -C app/native-server test:ci`
- 必要时 `pnpm -C app/native-server build`

### 跨扩展 + native-server 链路改动

- `pnpm run test:core`
- 必要时 `pnpm run typecheck`

### 高风险主链路改动

- `pnpm run typecheck`
- `pnpm run test:core`
- 必要时 `pnpm run audit`
- 必要时 `pnpm run release:check`

---

## 8. 什么时候必须做真实验证

以下改动不能只停留在代码级测试：

- transport / MCP 接入路径
- 浏览器恢复与桥状态
- Popup 连接行为
- 浏览器工具真实交互
- 扩展 build / reload 后行为
- 发布、安装、平台兼容

真实验证要明确你验证的是哪一层：

1. 代码级测试通过
2. 集成级通过
3. 本机真实服务通过
4. 真实浏览器现场通过
5. 真实助手链路通过

推荐真实助手链路：

```text
Codex -> Claude CLI -> Tabrix MCP 服务 -> 真实 Chrome
```

---

## 9. 第一次进仓最容易犯的错

1. 把历史 CI 红叉当成当前主线仍然失败
2. 在脏工作区里直接 `pull / rebase / merge`
3. 把代码级测试通过说成现场已通过
4. 改了扩展源码但没 build / reload 就下结论
5. 把 service 在线误认为浏览器自动化 ready
6. 把原始 session dump 当“活跃客户端”
7. 在非主线能力面继续扩需求

---

## 10. 第一次任务结束时怎么回报

默认至少说清：

1. 做了什么
2. 没做什么
3. 跑了哪些验证
4. 哪些只是代码级 / 集成级通过
5. 哪些真实链路还没验证
6. 当前风险和下一步建议

---

## 11. 如果你只记三句话

1. `Tabrix` 的主线是“真实 Chrome + MCP + 稳定执行”，不是堆更多产品面。
2. 先分清“代码改了”“build 了”“真实运行实例切到新代码了”这三件事。
3. 先用最小改动和最小验证闭环推进，不要顺手重构整个系统。
