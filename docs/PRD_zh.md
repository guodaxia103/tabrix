# Tabrix 产品需求文档（PRD）

> **版本**：`v1.0.0`（2026-04-21）—— 首份仓库内集中化 PRD。
> **状态**：`生效 / 产品层唯一真相源（SoT）`。
> **语言**：中文。英文正本：[`PRD.md`](./PRD.md)（中英内容口径一致；若两份不同，以中文版本号最新一份为准，并在同一 PR 中把另一份也同步过去）。
> **读者**：任何接触本仓库的 AI 助手（Codex / Claude / Cursor / Cline 等）和人类贡献者。
> **取代**：原先分散在 [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md)、[`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md)、`AGENTS.md`、以及私有飞书《Tabrix PRD v1》中的 PRD 职能。
> **配套**：[`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md) —— Stage 3a → 5e 阶段级执行计划。

---

## 0. 本文档是什么，不是什么

`Tabrix` 的 **产品层唯一真相源**（Product Single Source of Truth）。它的目标只有一个：**让任何 AI 助手（包括 Codex、Claude、Cursor 等）在接触 Tabrix 时，不会再自行定义产品、不会再自行放大承诺、不会再自行改写任务编号语义。**

本 PRD 必须做的事：

- 回答"Tabrix 是什么 / 服务谁 / 不服务谁"；
- 回答"哪些是不可动摇的架构约束"；
- 回答"Memory / Knowledge / Experience / Policy（MKEP）四层如何协作"；
- 回答"Stage 级蓝图 → Sprint 级 `B-*` 的映射关系"；
- 回答"AI 助手绝对不能对产品叙事做什么"。

本 PRD **不**承担的事（不要在这里找，也不要把这些内容塞回来）：

- Sprint 级执行 —— 看 [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md)。
- Stage 级执行细节 —— 看 [`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md)。
- 公开能力分层 —— 看 [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md)。
- 工具 schema —— 看 [`TOOLS.md`](./TOOLS.md) 和 `packages/shared/src/tools.ts`。
- 研发规则 —— 看 [`AGENTS.md`](../AGENTS.md)。
- 发布门禁 —— 看 [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)。

当本 PRD 与下游文档打架时，**改下游文档**（除 §12「仲裁顺序」另有约定）。

---

## 1. 一句话定义（不可动摇）

> **Tabrix = AI 浏览器自动化执行层的头部产品。把用户真实登录的 Chrome 变成一个通过 MCP 暴露的 AI 可执行运行时。**

四条护城河。**任何 PR / 特性 / 文档如果违反其中任意一条，都视为偏离产品，必须先更新 PRD 才能落地。**

| #   | 护城河                  | 含义                                                                                                                   | 对立面（禁止）                                                      |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| P1  | **用户真实登录 Chrome** | 默认路径复用用户日常 Chrome profile：已登录状态、cookies、插件、打开的标签页全部保留。                                 | 默认跑一个全新 Chromium / headless / Playwright 运行时。            |
| P2  | **MCP-native**          | 所有能力通过 MCP 暴露（`stdio` + `Streamable HTTP`，两者都是 tier-1）。                                                | 把私有 HTTP API、闭源 SDK、浏览器 IDE 作为主要公开面。              |
| P3  | **低侵入接管**          | 默认路径：`扩展 + Native Messaging + content-script + DOM`。`chrome.debugger` / CDP 是**显式、Opt-in、高风险**的分支。 | 默认走 `chrome.debugger` / CDP / remote-debugging-port 接管。       |
| P4  | **执行层，不是 Agent**  | Tabrix 只暴露原语（read / click / fill / recipe / plan-suggest）。**任务规划、目标拆解、自我对话一律交给上游 LLM**。   | Tabrix 自带 chat UI、任务循环、"自动决定下一步"启发式、内建 Agent。 |

下游任何决定 —— 架构、工具面、路线图、命名 —— 都必须能指回这四条中的至少一条。

---

## 2. 目标用户

### 2.1 主用户（今天就服务）

1. **MCP 客户端重度用户**：Codex CLI、Claude Desktop、Cursor、Cline、Cherry Studio、Dify、Windsurf 等 MCP host 的用户，希望让助手在**自己的真实 Chrome** 里干活。
2. **内部后台自动化开发者**：要在已登录的内部系统（CMS / 工单 / CRM / 管理后台 / 运维面板）里做读写流程，headless 跑不通的场景。
3. **需要 AI 在真实会话里工作的技术团队**：对"浏览器从零开始"不可接受、登录/插件/活上下文都很重要的团队。

### 2.2 次要用户（提到但不是默认叙事）

1. 局域网里共享一个开启 Tabrix 的浏览器的小团队（靠 bearer-token 鉴权）。
2. 把浏览器能力集成进内部 workflow（webhook、CI 触发）的 DevOps 团队。
3. 需要回放 / 证据 / Memory / Policy 做合规相近工作的高级用户。

### 2.3 今天**不服务**的群体（必须说清楚）

任何对外文档声称 Tabrix **覆盖 / 支持 / 已就绪** 下面任意一项，都算超纲：

1. 大型企业级浏览器自动化采购（跨团队 SLA、审计、RBAC 全套）。
2. 金融 / 医疗 / 政务等强监管行业的默认上线。
3. 声明兼容矩阵以外的跨浏览器 / 跨 OS（Safari、Firefox、非 Chrome 的 Chromium fork，除非 `PLATFORM_SUPPORT.md` 显式列出）。
4. 完全无确认的全自动 Agent（P4 已明确拒绝）。

当公开文案出现「企业级」「全站点通用」「零配置」「即插即用」等字眼时，`AGENTS.md` 的反漂移规则要求 AI 助手**先拦下**，等 PRD 先更新再落。

---

## 3. Tabrix 不是什么（排除清单）

不管仓库历史里曾经有过什么代码，下面的产品面**不属于当前产品承诺**。公开 README / 应用商店描述 / MCP host 目录 / PR 标题 / commit 信息里都不能把它们当作默认能力来讲。

1. 通用无头爬虫 / 云端浏览器自动化平台。
2. DevTools 级的 CDP 主打产品（默认 `chrome.debugger` / CDP 接管是 P3 分支，不是主路径）。
3. 浏览器 IDE / 可视化工作流 builder / Record-Replay v2/v3 宣传面。
4. 本地大模型 / 向量库 / 语义搜索产品。
5. Agent 操作系统 / 全自动"替我上班"的 Agent。
6. 跨浏览器、跨 OS 的企业级 SLA 厂商。

口径对齐：

- [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) 的 "Removed surfaces" 小节；
- [`PRODUCT_PRUNING_PLAN.md`](./PRODUCT_PRUNING_PLAN.md) 已执行的裁剪过程；
- `AGENTS.md` → `## Removed Surfaces — Must Not Be Reintroduced`。

---

## 4. 北极星 KPI

Tabrix 靠 **五个维度**打分。**只有这五个维度**能支持"Tabrix 又更好了一点"的说法。**只堆功能不是**晋升条件。

| #   | 维度         | 指标                                   | 目标（Stage 4 末）                                       | 测量口径                                      |
| --- | ------------ | -------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| K1  | **省 token** | 上游 MCP 视角的每任务平均输入 token 数 | 相比 `v2.1.0` 基线 **降 ≥ 40%**                          | MCP 每次 request 的 input token 总和 ÷ 任务数 |
| K2  | **更快**     | 每个工具 p50 延时                      | `click ≤ 800ms` · `fill ≤ 1500ms` · `read_page ≤ 2500ms` | `memory_actions.endedAt − startedAt` 聚合     |
| K3  | **更准**     | 多步任务成功率                         | **≥ 85%**                                                | `memory_sessions.status = 'completed'` ÷ 总数 |
| K4  | **更稳**     | retry + fallback + bridge 恢复失败     | `任意工具 retry ≤ 10%` · `bridge 恢复失败 ≤ 2%`          | `memory_actions.retryCount > 0` ÷ 总数        |
| K5  | **懂用户**   | 重复任务上 Experience 命中率           | 在 Stage 3b 落地后 **≥ 60%**                             | `experience_replay` 返回非空且被采纳 ÷ 请求数 |

**工程含义**：每一个 Stage / PR / backlog item 必须回答**"它推了哪个 KPI，推了多少"**。如果答案是"都没"，这个 item 就是基建 / infra，必须在 [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) 里打 `Layer: X` 标签。

基线、测量区间、抽样规则放在 [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) 和按 KPI 做的 Memory / Experience 视图里，**不**塞进本 PRD。

---

## 5. 架构 —— MKEP + 支撑层

Tabrix 是一个四层学习闭环，架在工具面和传输层之上。

```
 ┌────────────────────────────────────────────────────────────────┐
 │                      上游 LLM（MCP 客户端）                     │
 │         Codex · Claude · Cursor · Cline · Cherry · Dify        │
 └──────────────┬─────────────────────────────────┬───────────────┘
                │ stdio / Streamable HTTP         │
 ┌──────────────▼─────────────────────────────────▼───────────────┐
 │                 Tabrix 工具面（28+ 个 MCP 工具）                │
 │  read · navigate · click · fill · screenshot · network · …     │
 │  （+ 未来的 Agent 原语：tabrix_choose_context · replay）        │
 └──────────────┬─────────────────────────────────────────────────┘
                │ Policy 检查（P0/P1/P2/P3 + capability opt-in）  │
 ┌──────────────▼────────────────────────────────────────────────┐ │
 │                MKEP 核心 —— 自我演化闭环                       │ │
 │                                                               │ │
 │   ┌──────────┐   ┌────────────┐   ┌────────────┐  ┌────────┐  │ │
 │   │  Memory  │──▶│ Knowledge  │──▶│ Experience │──│ Policy │  │ │
 │   │ (SQLite) │   │ (Registry) │   │  (replay)  │  │(gating)│  │ │
 │   └────▲─────┘   └─────▲──────┘   └─────▲──────┘  └────▲───┘  │ │
 │        │                │                 │             │     │ │
 │        └────────────────┴── Recovery Watchdog ──────────┘     │ │
 └───────────────────────────────────────────────────────────────┘ │
                │                                                  │
 ┌──────────────▼──────────────────────────────────────────────────┘
 │              浏览器层 —— 用户真实登录的 Chrome                  │
 │         Chrome 扩展（MV3）+ Native Messaging bridge              │
 │    默认路径：content-script / DOM。P3 路径：chrome.debugger     │
 └─────────────────────────────────────────────────────────────────┘
```

### 5.1 Memory 层

**职责**：持久化、可回放的"发生过什么"记录 —— Session → Task → Step，外加 PageSnapshot 和 Action 证据。

**当前成熟度**：约 45% —— `memory_sessions` / `memory_tasks` / `memory_steps` 已 SQLite 持久化（`app/native-server/src/memory/db/`）；`memory_page_snapshots` + `memory_actions` 已写入真实数据；Sidepanel Memory tab 已出 readable 时间线，支持筛选/搜索/下钻（`B-001`…`B-006`）。

**目标态**：每一次 MCP 工具调用都产出一行可回放的 `{ historyRef, contentHash, targetRef, locator, outcome }` 证据；服务重启不失忆。

**差距**（见 `MKEP_CURRENT_VS_TARGET.md`）：

- `historyRef` 已进 DTO 契约，但 `read_page` 只是部分回填；
- `memory_actions.retryCount` / `fallbackUsed` 已采集但未聚合进 K4；
- 跨 session 的洞察聚合还没做（`memory_insights` 是 Stage 3i）。

**代码触点**：

- `app/native-server/src/memory/**` —— schema + 仓储 + SessionManager + 后处理器；
- `app/chrome-extension/entrypoints/sidepanel/tabs/Memory*.vue` —— 查看器；
- `packages/shared/src/memory.ts` —— 跨进程 DTO 契约。

### 5.2 Knowledge 层

**职责**：**数据优先**地描述 Web —— 站点档案、页面目录、主区域规则、HVO（高价值对象）分类器种子、UI Map 规则、API 接口目录。

**当前成熟度**：约 55% —— Knowledge Registry Stage 1 + 2 已落地（GitHub site profile + HVO 分类器）。Stage 3a 刚落地第一批 UI Map 规则（`B-010`，GitHub 5 条）。

**目标态**：加一个新站点 = 加一个 seed 文件，**不**改 `read-page-understanding-<family>.ts`。locator hints / API endpoint / page catalog 全部从 Registry 数据出。

**差距**：

- `read_page` HVO 的 `targetRef` 还不稳（重载就变，Stage 3a 的 `B-011`）；
- 非 GitHub 家族的 locator hints 还在 TS adapter 里硬编码；
- API Knowledge **v1 已落地（Stage 3g 的 `B-017`，仅捕获、GitHub-first、capability gate）**；call 层（`knowledge_call_api`）和 Sidepanel 按站 toggle 留在 v2；
- 只有 GitHub 真正数据化；抖音 / 创作者中心还在 TS 分支（Stage 4c）。

**代码触点**：

- `app/chrome-extension/entrypoints/background/knowledge/**` —— seeds / registry / lookup；
- `app/chrome-extension/entrypoints/background/tools/browser/read-page-*.ts` —— 消费方；
- **中立性不变式**：`read-page-understanding-core.ts` 不能出现任何站点专用词汇 —— 由 `tests/read-page-understanding-core-neutrality.test.ts` 守护（`AGENTS.md` 规则 16）。

### 5.3 Experience 层

**职责**：把 Memory 投影成**可复用的 action path 和 locator 偏好** —— "上次在这个页面、这个 intent 下，什么成了。"

**当前成熟度**：约 35% —— schema 已落地（`experience_action_paths` / `experience_locator_prefs`，`B-005`）；Sprint 3 落地了第一条写路径（`B-012`），把终态 Memory session 幂等投影到 `experience_action_paths`；读侧 MCP 工具 `experience_suggest_plan` 已在 `B-013` 落地（P0、native-handled）。

**目标态**：上游 LLM 调 `experience_suggest_plan(intent, pageRole?)`，Tabrix 返回那个 `(pageRole, intent)` 桶里排序后的 action path 列表，配五级 locator 回退。**这个 plan 只是原语**，上游 LLM 决定采不采纳。

**差距**：

- 写侧 MCP 工具（`experience_replay` / `experience_score_step`）还没暴露 —— Stage 3b 后续项（Sprint 4+，写/执行路径需先过 Policy review）；
- 导入导出还没（Stage 4a 的 `B-020`）。

**代码触点**：

- `app/native-server/src/memory/db/schema.ts` 的 `EXPERIENCE_CREATE_TABLES_SQL`；
- `app/native-server/src/memory/experience/` 的 `experience-aggregator.ts` + `experience-repository.ts`（`B-012` 第一条写路径）；
- `app/chrome-extension/entrypoints/sidepanel/tabs/ExperienceTab.vue` 占位 UI。

### 5.4 Policy 层

**职责**：每一个 MCP 工具的风险分级 + capability opt-in +（未来）上下文动态重分级。

**当前成熟度**：约 45% —— `TOOL_RISK_TIERS`（P0/P1/P2/P3）+ `requiresExplicitOptIn` 已落 `packages/shared/src/tools.ts`；P3 工具默认隐藏，除非 env allow-list 打开。`B-016` v1 又加了一层**正交**的 feature 级 gate —— `TabrixCapability` 枚举（v1：`api_knowledge`）+ `TABRIX_POLICY_CAPABILITIES` env，`B-017` v1 的 API Knowledge 捕获是它的第一个消费者。

**目标态**：Policy 是**上下文感知**的 —— `PolicyContext = { toolName, pageRole, siteId, recentFailureRate, apiEndpointCalled }` 驱动动态分级（比如 `chrome_javascript` 在 GitHub issues 页是 P2，在 `bank.com` 是 P3）。

**差距**：

- 今天是静态的，没 pageRole / siteId 上下文（Stage 4b）；
- `TabrixCapability` 枚举已存在（`B-016` v1）但目前是 **feature 级**（一项：`api_knowledge`）；按工具粒度的 capability 注解 + `TABRIX_POLICY_ALLOW_P3` 迁移已推迟（Stage 3f 后续）；
- 没有用户级覆盖层。

**代码触点**：

- `packages/shared/src/tools.ts` —— 风险分级 + opt-in 注解；
- `app/native-server/src/policy/**` —— gate + allow-list。

### 5.5 支撑层

**工具面（现在约 28 个 MCP 工具）** —— 真正可调用的表面。分组定义在 `packages/shared/src/tools.ts::TOOL_NAMES.BROWSER`。详见 §7。

**传输层** —— `stdio` 和 `Streamable HTTP`，两个都是 GA。不规划第三种传输；任何看起来像 HTTP 但不是 MCP 的东西（比如 Sidepanel 用的 `/memory/*` 路由，见 `B-001`）必须说明为何**不是**MCP 工具。

**Recovery Watchdog（未来）** —— Stage 3c 把现有四种 fallback（dialog-prearm / interaction / screenshot / read-page 稀疏树）统一成一个 `RecoveryWatchdog` 家族（`B-014`）。

**Context Strategy Selector（未来，战略级）** —— Stage 3h 加 `tabrix_choose_context(intent, url?)` → `ContextBundle`，是**省 token 的最大单点杠杆**（`B-018`）。§9.3 讲为什么。

---

## 6. 能力分层

本 PRD **不**复制能力分层表。SoT 是 [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md)，四个分层：`GA` · `Beta` · `Experimental` · `Internal`。

### 6.1 晋升硬约束

1. 把某个能力从 `Experimental` → `Beta` 或 `Beta` → `GA` 的 PR **必须**先改 `PRODUCT_SURFACE_MATRIX.md`，再动 README / 应用商店 / 对外文案。
2. PR 描述必须列：(a) 晋升证据、(b) KPI 推动（见 §4）、(c) 封闭的 `B-*`、(d) 相关的 `RELEASE_READINESS_CRITERIA_v2` 门禁。
3. `PRODUCT_SURFACE_MATRIX.md` 胜过 README / 应用商店 / 路线图的任何不一致 —— 下游跟上游走，不可反推。
4. 标签为 `Experimental` 的能力**不能**出现在 `README.md` / `README_zh.md` / 应用商店展示里被当作默认能力讲。

### 6.2 当前概览（snapshot）

（写这份 PRD 时的快照 —— 引用前先核对 `PRODUCT_SURFACE_MATRIX.md`。）

| 能力                                                                                  | 分层           |
| ------------------------------------------------------------------------------------- | -------------- |
| 真实 Chrome 执行（扩展）                                                              | `GA`           |
| MCP 传输 `stdio` + `Streamable HTTP`                                                  | `GA`           |
| 核心浏览器工具（read / navigate / click / fill / screenshot / network / diagnostics） | `GA`           |
| `status` / `doctor` / `smoke` / `report`                                              | `GA`           |
| 局域网远程访问 + bearer-token                                                         | `Beta`         |
| Policy P0–P3 + P3 opt-in                                                              | `Beta`         |
| Knowledge Registry（GitHub site profile + HVO）                                       | `Beta`         |
| Memory 持久化（Session / Task / Step / PageSnapshot / Action）                        | `Beta`         |
| Sidepanel Memory / Knowledge / Experience tab                                         | `Experimental` |
| Experience replay / locator 回退 / Recovery helpers                                   | `Experimental` |

---

## 7. MCP 工具面

### 7.1 现有工具（枚举 + 风险分级）

权威清单：`packages/shared/src/tools.ts::TOOL_NAMES.BROWSER`。本表是**新人入门快照**；如果与代码不一致，**以代码为准**。

| 工具                                                                                         | 风险         | 用途（一句话）                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_windows_and_tabs`                                                                       | P0           | 列出 Chrome 窗口和标签页。                                                                                                                                   |
| `chrome_read_page`                                                                           | P0           | 结构化页面快照 + HVO（主要读工具）。                                                                                                                         |
| `chrome_get_interactive_elements`                                                            | P0           | 列出带稳定 ref 的可交互元素。                                                                                                                                |
| `chrome_get_web_content`                                                                     | P0           | 纯文本 / markdown 页面内容。                                                                                                                                 |
| `chrome_screenshot`                                                                          | P0           | 视口 / 元素截图。                                                                                                                                            |
| `chrome_console`                                                                             | P0           | 读 DevTools console 输出。                                                                                                                                   |
| `chrome_history`                                                                             | P0           | 查历史（受限）。                                                                                                                                             |
| `chrome_bookmark_search`                                                                     | P0           | 查书签。                                                                                                                                                     |
| `chrome_network_capture`                                                                     | P1           | 抓 HAR-style 网络事件。                                                                                                                                      |
| `chrome_navigate`                                                                            | P1           | 当前 / 新标签导航。                                                                                                                                          |
| `chrome_switch_tab`                                                                          | P1           | 切换活动标签。                                                                                                                                               |
| `chrome_gif_recorder`                                                                        | P1           | 录制当前标签 GIF。                                                                                                                                           |
| `performance_start_trace` / `_stop` / `_analyze_insight`                                     | P1           | Trace + 轻量 summary。                                                                                                                                       |
| `chrome_click_element`                                                                       | P2           | 带验证语义的点击（见 `CLICK_CONTRACT_REPAIR_V1.md`，`B-023`）。                                                                                              |
| `chrome_fill_or_select`                                                                      | P2           | 填输入框 / 选下拉。                                                                                                                                          |
| `chrome_keyboard`                                                                            | P2           | 键盘按键分发。                                                                                                                                               |
| `chrome_handle_dialog`                                                                       | P2           | 接受 / 关闭原生弹窗。                                                                                                                                        |
| `chrome_handle_download`                                                                     | P2           | 接受 / 关闭下载。                                                                                                                                            |
| `chrome_close_tabs`                                                                          | P2           | 关标签。                                                                                                                                                     |
| `chrome_bookmark_add` / `chrome_bookmark_delete`                                             | P2           | 书签写入。                                                                                                                                                   |
| `chrome_request_element_selection`                                                           | P2           | 让用户手动选元素（human-in-loop）。                                                                                                                          |
| `chrome_javascript`                                                                          | P3（opt-in） | 在 content world 跑任意 JS。                                                                                                                                 |
| `chrome_inject_script`                                                                       | P3（opt-in） | 注入脚本到标签页。                                                                                                                                           |
| `chrome_send_command_to_inject_script`                                                       | P3（opt-in） | 给注入脚本发命令。                                                                                                                                           |
| `chrome_userscript`                                                                          | P3（opt-in） | 用户脚本管理。                                                                                                                                               |
| `chrome_upload_file`                                                                         | P3（opt-in） | 文件上传。                                                                                                                                                   |
| `chrome_computer`                                                                            | P3（opt-in） | 坐标级鼠标/键盘输入。                                                                                                                                        |
| `chrome_network_capture_start` / `_stop` / `_request` / `_debugger_start` / `_debugger_stop` | P3（内部）   | 高级网络 / 调试器 —— 内部用，不默认 listTools。                                                                                                              |
| `experience_suggest_plan`                                                                    | P0           | 给 `(intent, pageRole?)` 返回排序后的只读 action path 列表。Native-handled（不走扩展桥）。Memory 关闭时返回 `status: 'no_match'`（不抛错）。`B-013` 已落地。 |

### 7.2 规划中工具（本 PRD 点名的未来原语）

| 工具                     | 规划 Stage         | 层                     | 用途                                                                         |
| ------------------------ | ------------------ | ---------------------- | ---------------------------------------------------------------------------- |
| `tabrix_choose_context`  | 3h（`B-018`）      | Knowledge + Experience | 给 `(intent, url?)`，返回最小 token 的 `ContextBundle` —— **最大 K1 杠杆**。 |
| `experience_replay`      | 3b（`B-013` 之后） | Experience             | 用变量替换执行历史 action path。暴露前需先做 Policy review。                 |
| `experience_score_step`  | 3b（`B-013` 之后） | Experience             | 让上游 LLM 把步骤结果写回 Memory。暴露前需先做 Policy review。               |
| `knowledge_describe_api` | 3g（`B-017`）      | Knowledge              | 列出某站点已捕获的 `KnowledgeApiEndpoint[]`。                                |
| `knowledge_call_api`     | 3g（`B-017`）      | Knowledge              | 用用户真实 Chrome cookie 调用站点 API。                                      |

### 7.3 工具面不变式

1. 工具**必须**声明风险分级。上线门禁：`TOOL_RISK_TIERS[toolName]` 有对应条目。
2. **低侵入优先** —— P0/P1/P2 工具不能默认走 CDP / `chrome.debugger`。工具如需 CDP，它就是 P3。
3. 工具名必须体现风险 —— "安全名 + Debugger 实现"是命名缺陷。
4. 每个工具返回必须让调用方区分出 **success** / **dispatch-succeeded-but-no-outcome** / **failure** / **fallback-used**。`chrome_click_element` 的 `B-023` 后形态是参考样本（见 `packages/shared/src/click.ts`）。
5. 加 / 删工具 / 改 schema 是 Policy 决定（`AGENTS.md` → "Tiered Execution Model" → "Fast-lane must not do" §2）—— 任何 AI 助手跑在 fast-lane 时都必须停下升级，不能单方面决定。

---

## 8. 明确**不做**清单（战略护城河）

| 反模式                             | 代表竞品                                    | Tabrix 不做的原因                                                                       |
| ---------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| 云托管浏览器作为默认路径           | Browserbase / stagehand / browser-use cloud | 破坏 P1（用户真实登录 Chrome）。                                                        |
| 自研 headless 引擎                 | Lightpanda                                  | 投入与定位不匹配；破坏 P1。                                                             |
| 以可视化 Block workflow 为产品核心 | automa                                      | 破坏 P4（执行层，非 workflow SaaS）。我们可以抄"运行历史 UI"，但不会变成 automa。       |
| LLM 改运行时 harness               | browser-harness                             | 破坏可审计性；破坏 P3（低侵入）。                                                       |
| 页内 JS copilot                    | page-agent                                  | 价值在跨标签 / 跨站，不在单页。                                                         |
| 任意 JS 作为主接口                 | playwriter `execute`                        | 破坏 Policy Phase 0；我们把 `chrome_javascript` 固定在 P3 opt-in。                      |
| Tabrix 自己跑 Agent 主循环         | —                                           | 破坏 P4。规划留给上游 LLM。我们给原语，不替人决策。                                     |
| 从 Memory 自动提 GitHub issue      | —                                           | 隐私 + token 成本 + 误报风险。替换方案：本地 `memory_insights` + 手动复制（Stage 3i）。 |
| 联网 Experience marketplace        | —                                           | Phase-0 只做本地文件导入导出 + PII redact（Stage 4a）；marketplace 放 Stage 5+。        |

AI 助手识别到上面任何一条被违反，**必须拦下 PR 问用户**，不是先做后说。

---

## 9. 战略差异化（值得反复讲的三件事）

三件事，做到了 Tabrix 就和 14 个调研过的竞品都不一样。三件都已进路线图，但值得显式讲一下，因为**这是押的宝**。

### 9.1 真实登录 Chrome + MCP-native

当前市场上唯一的这种形态。云浏览器厂商拿不到用户真实 cookie；纯 MCP server 没有浏览器控制。**Tabrix 在交集上**。

### 9.2 MKEP —— 自我演化的执行层

每次调用都经同一个 `Memory → Knowledge → Experience → Policy` 闭环。每次调用都让下次更便宜 / 更快 / 更准。**14 个竞品没一个跑全这个闭环**。

### 9.3 Context Strategy Selector（Stage 3h · 省 token 引擎）

所有竞品的角度都是"给 LLM **多**一张表"（snapshot / markdown / HVO / screenshot）。**没人做"只给 LLM 它真正需要的那一张表"**。

`tabrix_choose_context(intent, url?, constraints?) → ContextBundle` 吃 `(intent, siteId, pageRole, 有没有 Experience?, 有没有 API Knowledge?)`，路由到最小 token 策略：

```
intent: "列出 repo X 的 issues"
  → strategy: api_only                               (~200 token，3g 种好后命中率≈100%)

intent: "分析 workflow 为何失败"
  → strategy: experience_replay + read_page json scoped  (~2000 token)

intent: "探索未知站点"
  → strategy: read_page(render='markdown') + observe     (~5000 token，只首次)

intent: "填复杂表单"
  → strategy: read_page json (HVO 稳定 ref) + knowledge.uiMap
```

这是 K1 **单点最大杠杆**。前提是 Stage 3a / 3b / 3d / 3g 都至少到 `Beta` —— 所以 §11 把这几个 Stage 排得最靠前。

### 9.4 API Knowledge（Stage 3g · 未被其他竞品覆盖的空位）

现代 SPA 的真实语义在 XHR/fetch 里，不在 DOM 里。调研的 14 个竞品**没一个**把"站点 API 目录"当 Knowledge 一等公民。捕获 `urlPattern + request/response schema + pagination + auth`，通过 `knowledge_call_api` 重用用户真实 Chrome cookie（云浏览器做不到的事），**同时**命中 K1（省 token）、K2（更快）、K3（更准）。

**v1 状态（B-017，2026-04-22）**：仅捕获、GitHub-first、capability gate（`TABRIX_POLICY_CAPABILITIES=api_knowledge`）。落地 `knowledge_api_endpoints` 表，附带硬性 PII 保证（只持久化 header _名_ / query _键_ / body _键_ / shape 描述；永不存原始 token、cookie、response 文本）。v1 **明确不**做 `knowledge_call_api`、JSON-Schema 推断、Sidepanel 按站 toggle —— 这几样都要等 B-018 验出读侧确实有人用，再开 call 表面。

---

## 10. 任务编号体系

Tabrix 用 **三套协同的编号**。不是冗余，每套对应不同抽象。

### 10.1 `T*` —— 飞书主任务编号（产品级语义）

- 归属：私有飞书"Tabrix 主任务管理总表"（仅仓库 owner 维护）。
- `T0..T15` 定义产品级语义契约：每个主任务是什么、owner、依赖、状态。
- **不**镜像进仓库。AI 助手**禁止**在仓库里发明新 `T*` ID。需要新 `T*` 时，停下来让 owner 在飞书上开。

### 10.2 `B*` —— Sprint backlog item（执行级）

- 归属：本仓库 [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md)。
- 任何非 trivial 特性 / 重构 commit 必须在 body 里引用 `B-*` ID（`AGENTS.md` 规则 20）。
- 尺寸：`S ≤ 0.5 天` · `M 0.5–1.5 天` · `L 1.5–3 天` · `XL > 3 天`。
- 合入 `B-done` **不**等于关闭 `T*`上一级 —— 产品级关闭仍需飞书侧签字 + 发布就绪证据。

### 10.3 `Stage 3a..5e` —— MKEP 路线图阶段

- 归属：[`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md)（新） + 旧 [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md)。
- Stage 是**战略**单元："UI Map 数据化" = Stage 3a。
- 一个 Stage 对应一个或多个 `B-*`。

### 10.4 交叉引用规则

| 层级  | 回答的问题                       | 归属                 |
| ----- | -------------------------------- | -------------------- |
| `T*`  | "这个产品任务还在范围内吗？"     | 飞书（仅 owner）     |
| Stage | "这件事的战略目标、为什么要做？" | `TASK_ROADMAP_zh.md` |
| `B*`  | "这周 PR 在干什么？"             | `PRODUCT_BACKLOG.md` |

不确定时，默认是 `B*`。AI 助手**禁止**新建 Stage 编号 —— 新 Stage 是路线图级决策。

---

## 11. 路线图鸟瞰（Stage 层）

完整细节、DoD、`B-*` 映射在 [`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md)。这里只让新读者看到形状。

```
Wave 1（近期可并行，互不阻塞）
  3a · Knowledge UI Map + 稳定 targetRef       （B-010 done；B-011 待启动）
  3d · read_page(render='markdown')             （B-015 pool）
  3g · API Knowledge（捕获 v1）                 （B-017 v1 done；v2 在 pool） ← K1 最大杠杆（数据侧）
  3f · Policy capability opt-in 枚举            （B-016 v1 done）

Wave 2（依赖 Wave 1 至少 Beta）
  3b · Experience action-path replay            （B-005 schema done，B-012 done，B-013 done —— 写侧 replay/score_step 暂缓）
  3c · Recovery Watchdog 统一化                 （B-014 pool）

Wave 3（战略价值集中兑现）
  3h · Context Strategy Selector                （B-018 v1 slice done；完整 Stage 3h DoD 仍在 pool） ← K1 最大杠杆（规划侧）；v1 = 规则版选择器
  3e · Run History UI                           （B-001..B-006 提前在 Sprint 1+2 落地）
  3i · Memory Insights 表 + Sidepanel tab       （B-019 pool）

Wave 4（用户价值放大）
  4a · Experience 导入导出 + PII redact         （B-020 pool）
  4b · Policy 动态上下文                        （暂无 B-*）
  4c · 抖音 + 跨站 family 迁移                  （暂无 B-*）

Wave 5（远期，无具体时间）
  5a · Experience 自学习写回
  5b · Knowledge Graph 升级（Site × Page × Object × Action × API）
  5c · WebMCP Bridge
  5d · Experience Marketplace（签名 / 信任评分 / 社区分发）
  5e · 个人 userPreference 层
```

---

## 12. 仲裁顺序（SoT 冲突时）

文档打架时，从上往下应用。上层赢。如果上层写错了，在同一 PR 里一起改，**不**能下层悄悄改掉。

1. [`AGENTS.md`](../AGENTS.md) —— 研发规则。
2. **本 PRD** —— 产品身份 + 反漂移。
3. [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) + 发布就绪标准 —— 上线门禁。
4. [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) —— 能力分层。
5. [`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md) —— Stage 级执行。
6. [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) —— Sprint 级 `B-*`。
7. [`TOOLS.md`](./TOOLS.md) + `packages/shared/src/tools.ts` —— 工具契约。
8. [`SECURITY.md`](../SECURITY.md) —— 安全模型（安全话题上硬性凌驾其他文档）。
9. 飞书主任务管理总表 —— 仅 owner 可见的产品任务状态。
10. 其他仓库 / 飞书文档 —— 辅助材料。

`SECURITY.md` 在身份问题上排在本 PRD 之下，但在"这能不能上线"的问题上高于其他一切。AI 助手拿不准时，**按 SECURITY.md 最严的解读**走。

---

## 13. 反漂移条款（AI 助手硬约束）

这些条款会被执行。违反的 PR 要由 AI 助手**自己**拦下，不等用户注意。

### 13.1 产品叙事以本 PRD 为最高口径

生成 README / 营销文案 / commit body / PR 描述时：

1. 本 PRD。
2. `PRODUCT_SURFACE_MATRIX.md`。
3. `RELEASE_PROCESS.md` + 发布就绪标准。
4. `ROADMAP.md`。
5. `README.md` / `README_zh.md`。

下游跟着上游走。**禁止反推** —— "README 说了 X，所以 PRD 一定错了"不成立。

### 13.2 核心层禁止站点专用词汇

由 `tests/read-page-understanding-core-neutrality.test.ts` 守护。任何站点专用（GitHub / 抖音 / 专有后台）内容必须落在 `*-<family>.ts` adapter。

### 13.3 不允许无根据的能力承诺

`PRODUCT_SURFACE_MATRIX.md` 没有对应证据的以下措辞**禁止**出现在对外文案里：**「企业级」「全站点通用」「universal」「零配置」「GA」（在 GA 门禁过之前）「即插即用」（在 `QUICKSTART.md` 给出可验证首次成功路径之前）**。

### 13.4 禁止多 SoT

- 不要把本 PRD 的段落复制进 README / ROADMAP 当"本地 SoT"。
- 不要把飞书主任务总表复制进 `docs/` 当"本地备份"。
- 不要在 commit 信息或代码注释里重定义共享类型。
- **引用上游**（链接 + 段落 + 版本）。**永远不要镜像**。

### 13.5 禁止隐式晋升

`Experimental → Beta` 或 `Beta → GA` **必须先改** `PRODUCT_SURFACE_MATRIX.md`，附带晋升证据。README 把未晋升能力描述成 `GA` —— 漂移，必须回退。

### 13.6 禁止仓库内新建 `T*` ID

如果一件事需要新 master task，停下来找 owner。**不**要在 commit / 文档里发明 `T16` / `T17`。

### 13.7 PRD 不替代其他 SoT

"本 PRD 说了 X"**不**是实现层问题的最终答案。实现层答案在：

- 能力分层 → `PRODUCT_SURFACE_MATRIX.md`。
- 上线门禁 → `RELEASE_PROCESS.md`。
- 工具 schema → `packages/shared/src/tools.ts`。
- 安全模型 → `SECURITY.md`。
- 研发规则 → `AGENTS.md`。
- 任务状态 → `PRODUCT_BACKLOG.md` + 飞书。

本 PRD 给产品身份；它**不**回答 schema 问题。

### 13.8 禁止悄悄移除硬约束

任何对 §1 / §3 / §8 / §13 条款的删除或削弱，PR 描述里必须列出被改动的原文、说明原因、更新 `AGENTS.md` 交叉引用、通过 `pnpm run docs:check`。

---

## 14. 变更治理

### 14.1 怎么改本 PRD

1. 开 `docs/…` 分支；改 `docs/PRD.md` + `docs/PRD_zh.md`（两份必须一起改）。
2. 头部版本号改成 `v<major>.<minor>.<patch>` + 日期。
3. PR 描述标明：`新增条款` / `条款加强` / `条款削弱` / `条款删除`。
4. 如果是 `削弱` 或 `删除`，**列出所有受影响条款的原文**。
5. 跑 `pnpm run docs:check`。
6. 合入后在 §16 changelog 里加一行，**与 PR 同一 commit**，不准跟进补。

### 14.2 review 节奏

1. 每次里程碑版本升（`v2.x` → `v2.(x+1)`）走一次完整 PRD review。
2. 每个 sprint 闭环后做一次轻量 review —— 通常就是对一下 §11 是否还跟 `PRODUCT_BACKLOG.md` 对得上。

---

## 15. 相关真相源

### 15.1 仓库（公开）

- [`TASK_ROADMAP_zh.md`](./TASK_ROADMAP_zh.md) —— Stage 级执行计划（本 PRD 的配套）。
- [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) —— Sprint 级 `B-*` SoT。
- [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md) —— 能力分层注册表。
- [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md) —— 旧路线图（保留作参考；头注指向本文）。
- [`MKEP_CURRENT_VS_TARGET.md`](./MKEP_CURRENT_VS_TARGET.md) —— 各层的 gap 分析。
- [`KNOWLEDGE_STAGE_1.md`](./KNOWLEDGE_STAGE_1.md) / [`KNOWLEDGE_STAGE_2.md`](./KNOWLEDGE_STAGE_2.md) —— Knowledge 基础。
- [`MEMORY_PHASE_0.md`](./MEMORY_PHASE_0.md) / [`_0_2`](./MEMORY_PHASE_0_2.md) / [`_0_3`](./MEMORY_PHASE_0_3.md) —— Memory 基础。
- [`POLICY_PHASE_0.md`](./POLICY_PHASE_0.md) —— Policy 基础。
- [`CLICK_CONTRACT_REPAIR_V1.md`](./CLICK_CONTRACT_REPAIR_V1.md) —— 点击工具契约重建（B-023）。
- [`TOOLS.md`](./TOOLS.md) —— 工具 schema。
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) + [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) —— 代码地图。
- [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) + [`PLATFORM_SUPPORT.md`](./PLATFORM_SUPPORT.md) + [`COMPATIBILITY_MATRIX.md`](./COMPATIBILITY_MATRIX.md) —— 发布。
- [`SECURITY.md`](../SECURITY.md) + [`ERROR_CODES.md`](./ERROR_CODES.md) —— 安全 + 错误码。
- [`AGENTS.md`](../AGENTS.md) —— 研发规则。
- `README.md` / `README_zh.md` / `CHANGELOG.md` / `CONTRIBUTING.md`。

### 15.2 私有（仅 owner —— **不要镜像进仓库**）

- 飞书《Tabrix PRD v1》（本 PRD 的上游孪生）。
- 飞书《Tabrix 主任务管理总表》（`T*` 状态）。
- 飞书《Tabrix 任务编号治理与 SoT 规范》（T / B / Stage 契约）。
- 飞书《Tabrix 产品决策日志》（决策日志）。
- 飞书《Tabrix 可交付产品能力落地路线图》（交付排期）。

owner 维护这几份。AI 助手**禁止**在公开文件里引用飞书 URL。

---

## 16. Changelog

| 版本     | 日期       | 变更                                                                                                                                                                                                                                                                                                             |
| -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v1.0.0` | 2026-04-21 | 首份仓库内集中化 PRD。合并原先分散在 `PRODUCT_SURFACE_MATRIX.md`（能力分层）、`MKEP_STAGE_3_PLUS_ROADMAP.md`（事实上的产品愿景）、`AGENTS.md`（混进了一些叙事）、私有飞书《Tabrix PRD v1》的 PRD 职能。新增 Stage 级配套文 `TASK_ROADMAP_zh.md`。`MKEP_STAGE_3_PLUS_ROADMAP.md` 保留作历史参考，加头注指回本文。 |
