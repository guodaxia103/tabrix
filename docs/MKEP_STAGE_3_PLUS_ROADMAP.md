# MKEP Stage 3+ 路线图（产品愿景 + 竞品借鉴融合稿）

> 文档版本：v0.3 · 2026-04-20 更新（v0.2 的基础上叠加「产品表面精简已落地」事实；v0.1 合并用户产品愿景与 API Knowledge / Context Strategy 两条新维度）
>
> v0.3 差量：
>
> - 产品表面精简（`chore/remove-non-mkep-surfaces` 分支）已执行，P2 智能助手 / P5 工作流栈 / P6 本地模型 / P7 元素标注 / P8 Visual Editor 全部从 `main` 下线，详情见 `docs/PRODUCT_PRUNING_PLAN.md` 和 `CHANGELOG.md` 的 `Unreleased`。
> - Sidepanel 已重建为 Memory / Knowledge / Experience 三个空占位 tab，Stage 3d / 3e / 3f / 3g 的落地位置已就位——所有 Stage 3+ 的 UI 任务可以直接在新的骨架上铺开。
> - `packages/shared` 的 public API 已收敛到 `{ constants, types, tools, labels, bridge-ws, read-page-contract }`，任何后续 Stage 工作都应以这 6 个模块为稳定边界。
>   起草：项目组（Claude 作为总负责人；14 个竞品调研由 Codex CLI 并行完成并经抽查核验）
>   关联文档：`docs/MKEP_CURRENT_VS_TARGET.md`（Week 2 gap 分析）· `docs/KNOWLEDGE_STAGE_1.md` · `docs/KNOWLEDGE_STAGE_2.md` · `docs/MEMORY_PHASE_0.md`（0.1/0.2/0.3）· `docs/POLICY_PHASE_0.md`
>   目的：把"已完成的 MKEP 阶段 + 产品愿景四性目标 + `E:\projects\AI\codex\competitor\` 下 14 个开源项目的实证借鉴"汇成一份 Stage 3+ 执行计划，作为后续 `feat/*` 分支的派生依据。

---

## 0. 产品愿景与北极星指标（NEW in v0.2）

### 0.1 产品定位（来自飞书文档 + 2026-04-21 用户定调）

> **Tabrix = AI 浏览器自动化执行层的头部产品。让 AI 更快、更准、更稳、更省 token 地控制用户真实登录的 Chrome，并把每次控制过程沉淀为可复用的知识 / 记忆 / 经验 / 规则。**

四大不变的护城河：

1. **用户真实登录 Chrome**：不做托管云浏览器、不自研 headless 引擎、不破坏会话/扩展生态。
2. **MCP-native**：所有能力通过 MCP 协议暴露，天然与 Codex / Claude / Cursor / Cline 等 Agent 客户端对齐。
3. **MKEP 全栈学习闭环**：Memory → Knowledge → Experience → Policy 四层持续自演化。
4. **执行层而非 Agent**：Tabrix 不做任务规划和自我对话，**把规划/评估留给上游 LLM**；自己专注"让每次调用更省、更稳、更可回溯"。

### 0.2 北极星指标（四性 KPI）

| 维度         | 指标                             | 目标态（Stage 4 末）                                      | 测量方式                                          |
| ------------ | -------------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| **省 token** | 每任务平均输入 token 数          | 相比 v2.1.0 基线 **降低 ≥ 40%**                           | MCP 上游每次 request 的 input token 求和 / 任务数 |
| **更快**     | 每动作 p50 延时                  | `click / fill / read_page` 各自 ≤ 800ms / 1500ms / 2500ms | Memory Action.endedAt - startedAt 聚合            |
| **更准**     | 任务成功率                       | 多步任务成功率 ≥ 85%                                      | Memory Session.status = completed / 总数          |
| **更稳**     | fallback + retry 率              | 任意工具 retry 率 ≤ 10% · bridge recovery 失败率 ≤ 2%     | Memory Action 的 `retryCount > 0` / 总数          |
| **懂用户**   | Experience 命中率（Stage 3b 后） | 重复站点任务中 Experience artifact 命中率 ≥ 60%           | `experience_replay` 返回非空且被采纳 / 总请求     |

**工程含义**：每一个 Stage 3+ 任务都必须回答"**它把哪个 KPI 推了多少**"，否则不立项。

---

## 1. Part I · 已完成任务回顾（对照产品愿景）

### 1.1 Policy Phase 0（#17）

静态风险分级 P0-P3、7 个 P3 工具 opt-in gate、31 个单测。**贡献**：协议层门禁就位。**未兑现**：静态分级、无上下文、无站点维度。

### 1.2 Memory Phase 0.1 / 0.2 / 0.3

SQLite 持久化 Session/Task/Step、`memory_page_snapshots` 存 DOM/HVO、`memory_actions` 存动作、`historyRef` 贯通、tool post-processor 回填 artifactRefs。**贡献**：Tabrix **会失败后记住**、**成功后沉淀**、**服务重启不失忆**。**未兑现**：只存不学——没聚合 success_rate / duration，没按 pageRole 归纳 recipe，没喂回 Policy。

### 1.3 Knowledge Registry Stage 1（#20）

GitHub Site Profile + Page Catalog + Primary Region Rules 数据化；`inferPageUnderstanding` 改成 registry-first；`KNOWLEDGE_REGISTRY_MODE = on | off | diff`。

### 1.4 Knowledge Registry Stage 2（#22）

GitHub HVO 分类器（URL 7 + label 27 = 34 条）迁 `KnowledgeObjectClassifier` seed；`githubObjectLayerAdapter.classify` registry-first；15 条 parity 测试保证位级等价。

**Stage 1+2 总价值**：GitHub 站点认知从 TS 分支 → 数据记录。未来加新站点理论上只加 seed。**短板**：locator hints / UI Map 仍硬编码；对象 priors / seed labels / scoring 未迁；只有 GitHub；**更关键——API 接口知识完全缺失**（见 §3 洞察 D）。

### 1.5 MKEP 就绪度变化对比

| 层         | Week 2 基线 | 当前（Stage 2 后） | 主短板                                                |
| ---------- | ----------- | ------------------ | ----------------------------------------------------- |
| Memory     | ~15%        | **~45%**           | 只"存"不"学"，无 UI、无 API 捕获                      |
| Knowledge  | ~20%        | **~55%**           | locator hints 硬编码、**无 API Knowledge**、只 GitHub |
| Experience | ~10%        | **~10%**           | **最大短板**，仍是零散手工种子                        |
| Policy     | ~35%        | **~40%**           | 静态、无上下文、无 capability 分层                    |

**整体判断**：MKEP 骨架已立，但**学习闭环未启动**，且**"API 感知"与"上下文策略"两个新维度没进过图谱**。

---

## 2. Part II · 14 个竞品关键借鉴点汇总

原始侦察报告在 `.tmp/competitor-survey/outputs/g{1,2,3,4}-*.md`。此处只列净可借鉴项，按 MKEP 四层 + 新增"战略/产品"维度归类。

### 2.1 Memory 层可借鉴

| 来源                   | 借鉴项                                                                                        | 位置                                                |
| ---------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| browser-use            | `AgentHistory` 作为持久事件流 + 五级元素回放匹配（exact/stable hash/xpath/ax name/attribute） | `browser_use/agent/service.py:1345-1403, 3499-3606` |
| page-agent             | history 作为 LLM / UI **共用**事件流                                                          | `PageAgentCore.ts:50-71, 281-289`                   |
| markitdown             | DOM → markdown 归一化 + 深层 DOM 降级为 plain text                                            | `converters/_html_converter.py:52-90`               |
| site-graph             | `visited / edges / resource_pages / error_codes / redirect_target_url` 四类标签               | `site_graph.py:31-39, 66-123`                       |
| automa                 | run history UI：搜索 / 分页 / 导出 / 跳错 / 变量快照 / 表格快照                               | `LogsHistory.vue`, `LogsVariables.vue`              |
| mcp-server-browserbase | SessionManager mutex + stale check + contextId/persist 显式配置                               | `sessionManager.ts:74-105, 262-354`                 |

### 2.2 Knowledge 层可借鉴

| 来源           | 借鉴项                                                                                                                       | 位置                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| playwright-mcp | **snapshot + element(human) + target(ref)** 三元组作为所有 action 输入                                                       | `README.md:822-832, 986-993`       |
| playwright-mcp | capability-based opt-in（`--caps=vision/pdf/devtools/testing`）                                                              | `README.md:393-423, 1277-1499`     |
| playwriter     | aria-ref 标签化截图（截图上直接带可点击 ref）                                                                                | `aria-snapshot.ts:1568-1615`       |
| stagehand      | `act / extract / observe` 三原语                                                                                             | `v3.ts:1219-1525`                  |
| page-agent     | `selectorMap + simplifiedHTML` 双表示                                                                                        | `PageController.ts:61-77, 191-206` |
| markitdown     | `accepts → convert → normalize` 分层 pipeline                                                                                | `_markitdown.py:546-620`           |
| GitNexus       | 节点 + 关系 schema 先行（`Site/Page/Object/Region/ActionPattern` + `LINKS_TO/HAS_REGION/CONTAINS_OBJECT/LEADS_TO/SUCCEEDS`） | `schema-constants.ts:11-70`        |

### 2.3 Experience 层可借鉴

| 来源            | 借鉴项                                                                      | 位置                                    |
| --------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| stagehand       | **缓存上下文 + agent replay**：绑定 variables + selector scope + stable env | `v3.ts:1901-2257`, `caching.mdx:10-155` |
| browser-use     | 历史回放五级元素匹配                                                        | `agent/service.py:3499-3606`            |
| browser-use     | watchdog 族（captcha/dialog/download/recording/security）独立挂到 session   | `browser/session.py:1603-1710`          |
| playwright-mcp  | tracing / video / pick-locator / highlight                                  | `README.md:1277-1458`                   |
| automa          | **block 级 onError.retry/retryTimes/fallback 可视化**                       | `EditBlockSettings.vue:71-85`           |
| browser-harness | stale session 自动重挂                                                      | `daemon.py:183-186`                     |
| page-agent      | 每步必须产出 `memory + next_goal + action`                                  | `PageAgentCore.ts:351-410`              |

### 2.4 Policy 层可借鉴

| 来源           | 借鉴项                                 | 位置                           |
| -------------- | -------------------------------------- | ------------------------------ |
| playwright-mcp | 能力族 opt-in                          | `README.md:393-423`            |
| webmcp         | origin / client-pair 权限记账          | `README.md:582-589`            |
| browser-use    | `allowed_domains` + `SecurityWatchdog` | `browser/session.py:1633-1660` |

### 2.5 战略级（非 MKEP 某一层）

| 来源                  | 战略含义                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| webmcp                | Tabrix 长期可定位为 **"WebMCP bridge + fallback executor"**（站点有 webmcp 就转发，没有就 fallback 到 read_page + HVO） |
| automa                | 不做 workflow marketplace，但 run history UI + node 级 onError 编辑可抄                                                 |
| Lightpanda            | 不自研 headless，但接口要像 agent-native 产品一样轻                                                                     |
| stagehand/browserbase | 不走云浏览器主路径，但 session mutex / contextId / persist 值得学                                                       |

---

## 3. Part III · 五大合成洞察（NEW · D/E 是本次扩展）

### 洞察 A · "三原语 + Target Ref"是浏览器 Agent 的公共语言

- stagehand / browserbase-mcp 都把入口收敛到 `act / extract / observe`
- playwright-mcp / playwriter 要求 action 吃 stable `target ref` 而非 CSS
- **对 Tabrix**：保留 28 个细粒度 MCP 工具（MCP-native 优势），**在其上加一层 Agent-facing 三原语**；所有 action 消费**来自 read_page HVO 的 stable target ref**

### 洞察 B · Experience = Memory 的可重放物化投影

- stagehand 缓存 variables + selector scope + replay plan（不是缓存 DOM）
- browser-use AgentHistory 直接支持五级元素回放
- **对 Tabrix**：Experience 不另起炉灶，而是 `MemoryAction + MemoryPageSnapshot + 成功/失败` 聚合出的投影

### 洞察 C · Recovery 从主流程拆出去

- browser-use watchdog 族
- browser-harness daemon stale-rebind · playwriter relay-state · automa block 级 onError
- **对 Tabrix**：散落在 `dialog-prearm.ts / interaction.ts / screenshot.ts / read-page.ts` 的 fallback 统一收成 `RecoveryWatchdog` 表

### 洞察 D · API 感知是 Knowledge 层被所有竞品遗漏的维度（NEW）

- 现代 SPA 的真实语义大部分在 XHR / fetch 里，DOM 只是视图层
- 14 个竞品**没有一个**把"站点 API 接口目录"作为 Knowledge 一等公民——browser-use 只在 session 层抓 network、playwright-mcp 的 `browser_network_requests` 只作为单次调试证据、mcp-playwright 只透传响应
- **对 Tabrix**：这是可以甩开整个赛道的位置。捕获页面访问时触发的 XHR/fetch、抽取 URL pattern + request/response schema，沉淀成 `KnowledgeApiEndpoint` 表。LLM 做"查 GitHub 某 repo 最近 issues" 不再需要打开页面/爬 DOM，直接 `GET /api/v3/repos/:owner/:repo/issues`——**省 token + 更快 + 更准**三性同时兑现
- 对应 Stage 3g

### 洞察 E · Context Strategy Selector 是 Tabrix 真正 unique 的位置（NEW）

- 所有竞品都在"给 LLM 多一张表"（snapshot / markdown / HVO / screenshot），但没人做"按规则**只给 LLM 它需要的那张表**"
- 用户愿景里的"AI 助手会自动调用 Tabrix 提供的技能和 MCP 工具，跟进 Tabrix 的规则自动选择 经验/知识/网页 JSON/MD/API 接口数据"就是这个意思
- **对 Tabrix**：新增 MCP 工具 `tabrix_choose_context(intent, url?) → { strategy, artifacts }`，规则库驱动选择：
  - **"未知站点 + 探索型任务"** → `read_page(render='markdown') + observe`
  - **"已有 Knowledge 站点 + 查数据"** → `knowledge.pageCatalog + knowledge.apiEndpoints`（不读页面）
  - **"已有 Experience 的重复任务"** → `experience_replay + 最近一次 historyRef`
  - **"复杂表单填写"** → `read_page JSON(HVO stable refs) + knowledge.uiMap`
  - **"只要提取数据"** → `knowledge.apiEndpoints` 直接接口调用
- 这**是省 token 的最大引擎**——上游 LLM 不再被动吃 read_page 30KB JSON，而是被动态路由到最小必要上下文
- 对应 Stage 3h

---

## 4. Part IV · Stage 3 - Stage 5 完整任务清单（v0.2 重写）

### 4.0 总体节奏与依赖图

```
Stage 3a (K · UI Map)   ┐
Stage 3d (K/M · render) ┤─→ Stage 3b (E · Action Path Replay) ──┐
Stage 3g (K · API)     ─┘                                       │
                                                                 ├─→ Stage 4a (E · Shared / Export)
Stage 3c (E/P · Watchdog)                                        │
Stage 3f (P · Capability)                                        │
Stage 3h (K/E · Context Strategy) ←─ 依赖 3a/3b/3d/3g            │
Stage 3e (M · Run History UI)                                    │
Stage 3i (M · Insight 表) ──────────────────────────────────────┘
```

### 4.1 Stage 3a — Knowledge Registry Stage 3 · UI Map / Locator Hints 数据化

**KPI 贡献**：更准 · 更稳 · 省 token（稳定 ref 降低 retry）

**范围**：

- 新增 `KnowledgeUIMapRule`（siteId + pageRole + purpose → locatorHints[]），schema 见 `docs/MKEP_CURRENT_VS_TARGET.md §3.4`。
- 迁移 `candidate-action.ts:43-88` 隐含的 locator 优先级顺序。
- **关键**：`read_page` HVO 输出增加 **stable targetRef**（Memory `historyRef` + HVO index + contentHash），对应洞察 A。
- GitHub 先行；沿用 `KNOWLEDGE_REGISTRY_MODE = on | off | diff`。

**优先级 P0** · **规模 M** · **依赖 无** · **MKEP K**

### 4.2 Stage 3b — Experience Phase 0 · Action Path Replay

**KPI 贡献**：省 token · 更快 · 懂用户

**范围**：

- Schema：`ExperienceActionPath(taskIntent, pageRole, steps[], successRate, p50Ms)`、`ExperienceLocatorPreference(pageRole, elementPurpose, order, stats)`；从 Memory Phase 0.2 的 `memory_actions` 聚合而成
- 新增 MCP 工具：
  - `experience_suggest_plan(intent, pageRole?) → ActionPath | null`（Agent planning primitive · 对应用户愿景的"任务拆解"暴露点）
  - `experience_replay(intent, variables) → execution plan`
  - `experience_score_step(stepId, result)`（让上游 Agent 反馈评分写回 Memory）
- 五级 locator 回放（抄 browser-use）：`exact ref → stable hash → xpath → ax name → attribute`，按 Experience 统计动态重排
- **关键边界**：Tabrix 不做任务拆解决策（留给上游 LLM）；只暴露 primitives

**优先级 P0** · **规模 L** · **依赖 3a** · **MKEP E + M**

### 4.3 Stage 3c — Recovery Watchdog 统一化

**KPI 贡献**：更稳 · 更准

**范围**：

- `RecoveryWatchdog` 接口（trigger / pageRoleScope / recoverySteps / cooldownMs）
- 现有 4 类 recovery（dialog / download / screenshot / sparse-tree）改造成 watchdog
- 预留 `captcha / rate-limit / stale-session / login-expired` 扩展点（不实现）
- 配合 mcp-server-browserbase 的 session mutex 姿势

**优先级 P1** · **规模 M** · **依赖 无（可与 3a 并行）** · **MKEP E + P**

### 4.4 Stage 3d — read_page Markdown 视图 + Agent Step Envelope

**KPI 贡献**：省 token

**范围**：

- `read_page(render = 'json' | 'markdown')`，默认 json 不改主协议
- `memory_page_snapshots` 增加 `readable_markdown` 列（懒计算）
- 可选 `agentStep` envelope JSON schema（非强制，MCP client 可在 prompt 中引用）

**优先级 P1** · **规模 S** · **依赖 无** · **MKEP K + M**

### 4.5 Stage 3e — Run History UI（Sidepanel Runs tab）

**KPI 贡献**：懂用户（自我运维 + 排障）

**范围**：

- Sidepanel 新增 "Runs" tab：Session/Task 列表、事件流、变量快照、失败 step 高亮
- 与 RR-v3 的 `rr_v3.listRuns / getEvents` 对齐，不造第二套历史孤岛
- 复制 historyRef 到剪贴板

**优先级 P1** · **规模 M** · **依赖 无** · **MKEP M**

### 4.6 Stage 3f — Policy Capability Opt-in 标准化

**KPI 贡献**：更稳（可审计）

**范围**：

- `TabrixCapability` 枚举：`vision / elevated_js / download / devtools / testing / cross_origin_nav`
- 每个 P2/P3 工具显式声明所需 capability
- `TABRIX_POLICY_ALLOW_P3` → `TABRIX_POLICY_CAPABILITIES`（兼容 ≥ 6 个月）
- `MemoryAction` 增加 `policyCapabilities` 字段
- 为 Stage 4b 的 origin/siteId 动态策略留接口

**优先级 P1** · **规模 S** · **依赖 无** · **MKEP P + M**

### 4.7 Stage 3g — API Knowledge · 网络层感知（NEW · 金点子 #1）

**KPI 贡献**：省 token（**最大**）· 更快 · 更准

**动机**：现代 SPA 真实语义在 XHR/fetch 里，而不是 DOM 里。14 个竞品无一把 API 接口作为 Knowledge 一等公民。这是 Tabrix 能甩开整个赛道的空位。

**范围**：

- **捕获层**：Chrome 扩展通过 `chrome.debugger.attach` + `Network.requestWillBeSent / responseReceived` 事件监听页面访问时触发的 XHR / fetch（**只在 Knowledge Capture Mode opt-in 时启用**，默认关闭以保护隐私）
- **归纳层**：把同一 URL pattern 的多次请求聚合成 `KnowledgeApiEndpoint`：
  ```ts
  interface KnowledgeApiEndpoint {
    siteId: string;
    pageRole?: string;           // 通常在哪个 pageRole 下被触发
    method: 'GET' | 'POST' | ...;
    urlPattern: string;          // e.g. /api/v3/repos/:owner/:repo/issues
    requestSchema?: JsonSchema;  // 从多次样本推断
    responseSchema?: JsonSchema;
    paginationHint?: 'offset' | 'cursor' | 'none';
    authRequired?: boolean;
    rateLimitHint?: string;
    seenCount: number;
    lastSeenAt: string;
  }
  ```
- **新增 MCP 工具**：
  - `knowledge_describe_api(siteId, pageRole?) → endpoints[]`
  - `knowledge_call_api(endpointId, params)`（调用时复用当前 Chrome 的登录 cookie，这是 Tabrix 独有的护城河——云托管浏览器做不到）
- **隐私/Policy**：
  - 默认关闭，需用户在 Sidepanel opt-in（capability = `knowledge.capture_api`）
  - 请求/响应 body 里的 PII 字段（token/password/email 模式）自动 redact 后才入库
  - 每个 siteId 可单独开关
- **里程碑**：GitHub 先行（已有 Stage 1+2 基础），覆盖 `issues / actions / workflow_runs / prs / contents` 5 类 API

**优先级 P0** · **规模 L** · **依赖 3f（capability 框架）** · **MKEP K + P**

### 4.8 Stage 3h — Context Strategy Selector（NEW · 金点子 #2）

**KPI 贡献**：省 token（**最大**）· 更快 · 懂用户

**动机**：用户愿景里的"AI 助手按 Tabrix 规则自动选择经验/知识/JSON/MD/API"。14 个竞品都在"给 LLM 多一张表"，Tabrix 独一家做"**只给 LLM 它需要的那张表**"。

**范围**：

- 新增 MCP 工具 `tabrix_choose_context(intent, url?, constraints?) → ContextBundle`，返回字段：
  ```ts
  interface ContextBundle {
    strategy:
      | 'api_only'
      | 'knowledge_light'
      | 'read_page_markdown'
      | 'read_page_json'
      | 'experience_replay'
      | 'read_page_json_plus_ui_map';
    reasoning: string; // 给 LLM 看的决策解释
    artifacts: Array<{
      kind:
        | 'experience'
        | 'knowledge_api'
        | 'knowledge_ui_map'
        | 'read_page'
        | 'markdown'
        | 'historyRef';
      payload: unknown;
      tokenEstimate: number;
    }>;
    tokenBudget: number; // 总预算
    fallbackStrategy?: string; // 若主策略失败用哪个
  }
  ```
- **决策规则表**（Knowledge Registry 扩展，作为 seed 数据）：
  ```
  intent 模式 × siteId 是否已知 × pageRole 是否已知 × 是否有 Experience × 是否有 API Knowledge
     → 推荐 strategy
  ```
  示例规则：
  - "list issues" + siteId=github + 有 API → `api_only`（~200 token，命中率 100%）
  - "分析 workflow 失败原因" + 有 Experience → `experience_replay + read_page JSON scoped`（~2000 token）
  - "探索未知站点" → `read_page markdown + observe`（~5000 token，但只首次）
- **自学习**：每次 Agent 采纳的 strategy + 结果（成功/失败 + 耗时 + token）写回 Memory；下次同 intent 按成功率重排
- **与 Stage 3b 的关系**：Stage 3h 是 Experience 的**消费面**，Stage 3b 是**生产面**

**优先级 P0** · **规模 L** · **依赖 3a / 3b / 3d / 3g 都需要至少 Beta** · **MKEP K + E**

### 4.9 Stage 3i — Memory Insight 表（缓冲版"自改进闭环"）

**KPI 贡献**：更准 · 更稳（长期）

**动机**：用户愿景里的"不合理操作 → 自动记录"。**不直接提 issue**（避免噪声/隐私/token 风险）。

**范围**：

- 新表 `memory_insights`：
  ```ts
  interface MemoryInsight {
    id: string;
    type:
      | 'unexpected_failure'
      | 'locator_flaky'
      | 'retry_loop'
      | 'fallback_triggered'
      | 'policy_denied'
      | 'api_schema_drift';
    severity: 'info' | 'warn' | 'error';
    siteId?: string;
    pageRole?: string;
    toolName?: string;
    sampleSessionId: string;
    sampleActionId: string;
    occurrences: number; // 去重合并计数
    suggestion?: string;
    firstSeenAt: string;
    lastSeenAt: string;
    status: 'new' | 'acknowledged' | 'copied_to_issue' | 'wont_fix';
  }
  ```
- Sidepanel 新增 "Insights" tab：按 severity 排序、一键生成 issue markdown（**复制到剪贴板，不联网**）
- Stage 5+ 再考虑 opt-in 的 anonymous telemetry

**优先级 P2** · **规模 M** · **依赖 3e（共享 UI 层）** · **MKEP M + E**

### 4.10 Stage 4a — Experience 本地导入导出（社区效应前置）

**KPI 贡献**：懂用户（长期社区效应）

**动机**：用户愿景里的"用户分享/导入导出对某网页的最优操作经验"。**阶段 0 只做本地文件**，marketplace 放到 Stage 5+。

**范围**：

- `experience_export(taskIntent | pageRole | all) → JSON file`
- `experience_import(file) → diff + dry-run + confirm`
- **PII redact**：导出前自动识别并移除 `/password|token|authorization|cookie|session/i` 匹配的字段，用户 opt-in 才保留
- **Schema 版本化**：`experienceSchemaVersion: 1`，跨版本自动迁移
- **信任**：导入时强制 `dry-run` 预览，显示将覆盖的 locator preferences / action paths，用户确认后才写入
- **不做**：联网 marketplace、社区评分、远端拉取（全部 Stage 5+）

**优先级 P1** · **规模 M** · **依赖 3b 完成** · **MKEP E**

### 4.11 Stage 4b — Policy 动态上下文化

**KPI 贡献**：更稳 · 更准

**范围**：

- `PolicyContext = { toolName, pageRole, siteId, recentFailureRate, apiEndpointCalled }`
- 按 pageRole / siteId 动态覆盖风险分级（如 `chrome_javascript` 在 GitHub issues 页 P2、在 bank.com P3）
- 用户级覆盖层（个人可收紧不可放宽）
- 审计日志 UI（Memory Insights 的 subset）

**优先级 P1** · **规模 M** · **依赖 3f / 3g / Memory 聚合就绪** · **MKEP P**

### 4.12 Stage 4c — Knowledge Registry Stage 4 · 抖音 + 跨站 family

**KPI 贡献**：更准（扩大覆盖面）

**范围**：

- 迁移 `read-page-understanding-douyin.ts` 全部规则到 seed
- 抽象 "Video/Social family"（抖音、B 站、YouTube 共享的 Knowledge patterns）
- 清退 TS 适配器里的硬编码

**优先级 P2** · **规模 M** · **依赖 3a 稳定** · **MKEP K**

### 4.13 Stage 5（远期展望，不定具体时间）

- **Stage 5a · Experience 自学习写回**：从 Memory 自动挖成功 locator / path，写到 Knowledge 候选区，人审后入正式表
- **Stage 5b · Knowledge Graph 升级**：按 GitNexus / site-graph 思路，规则表升级成 Site × Page × Object × Action × API 的图（支持 "下一步候选动作" / "相似路径召回" / "失败路径回避"）
- **Stage 5c · WebMCP Bridge**：当 webmcp 走向标准化，Tabrix 实现 bridge 模式
- **Stage 5d · Experience Marketplace**：签名 / 信任评分 / 社区分发（Stage 4a 稳定半年后）
- **Stage 5e · 个性化 `userPreference`**：Memory 增加个人偏好字段，真正"懂用户"

---

## 5. Part V · 明确的"不抄 / 不做"清单（战略护城河）

| 反模式                          | 代表竞品                                    | Tabrix 不抄原因                                                                                                                         |
| ------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 云托管浏览器主路径              | Browserbase / stagehand / browser-use cloud | Tabrix 核心价值是用户真实登录 Chrome                                                                                                    |
| 自研 headless 浏览器            | Lightpanda                                  | 资源投入与定位不匹配                                                                                                                    |
| Block 可视化 workflow 为中心    | automa                                      | Tabrix 是执行层不是 workflow SaaS，Visual Editor 是配角                                                                                 |
| LLM 改运行时 harness            | browser-harness                             | 牺牲可审计性换自由度                                                                                                                    |
| 页面内 JS copilot               | page-agent                                  | Tabrix 价值在跨页跨站全会话                                                                                                             |
| 任意 JS 执行作为主接口          | playwriter `execute`                        | Policy Phase 0 不能抹掉                                                                                                                 |
| **Tabrix 自己做 Agent 主循环**  | —                                           | **留给上游 LLM（Codex / Claude / Cursor）**。Tabrix 只暴露 primitives（`experience_suggest_plan / score_step`），不做"每步最优评估"决策 |
| **自动提 GitHub issue**         | —                                           | 误报率 / 隐私 / token 风险。改为本地 `memory_insights` + 手动复制                                                                       |
| **联网 Experience marketplace** | —                                           | 先做本地导入导出 + PII redact，marketplace 放 Stage 5 以后                                                                              |

---

## 6. Part VI · 执行顺序与交付节奏

**建议 PR 串**（每 PR 遵循现有规范：`feat/*` 分支 + CHANGELOG + parity/diff 兜底 + 全量测试）：

| 阶段     | 内容                                          | 预计 PR 数 | KPI 贡献                     |
| -------- | --------------------------------------------- | ---------- | ---------------------------- |
| Stage 3a | Knowledge Stage 3 · UI Map + Stable targetRef | 1-2        | 更准 / 更稳 / 省 token       |
| Stage 3d | read_page Markdown + Agent Step Envelope      | 1          | 省 token                     |
| Stage 3g | **API Knowledge（金点子 #1）**                | 2-3        | **省 token / 更快 / 更准**   |
| Stage 3b | Experience Phase 0 · Action Path Replay       | 2-3        | 省 token / 更快 / 懂用户     |
| Stage 3c | Recovery Watchdog                             | 1          | 更稳 / 更准                  |
| Stage 3f | Policy Capability Opt-in                      | 1          | 更稳                         |
| Stage 3h | **Context Strategy Selector（金点子 #2）**    | 1-2        | **省 token / 更快 / 懂用户** |
| Stage 3e | Run History UI                                | 1-2        | 懂用户                       |
| Stage 3i | Memory Insight 表                             | 1          | 更准（长期）                 |
| Stage 4a | Experience 导入导出                           | 1          | 懂用户                       |
| Stage 4b | Policy 动态上下文化                           | 1-2        | 更稳 / 更准                  |
| Stage 4c | Knowledge Stage 4 · 抖音迁移                  | 1          | 更准                         |

**建议开工顺序**（并行路径）：

**Wave 1（1-2 周内并行启动，互不阻塞）**：

- Stage 3a（Knowledge UI Map + Stable targetRef）
- Stage 3d（Markdown 视图 · 小改动）
- Stage 3g（**API Knowledge · 金点子 #1**，先做 Capture 层 spike，隐私审计同步）
- Stage 3f（Policy Capability，为 3g 提供 capability 框架）

**Wave 2（Wave 1 基础就绪后）**：

- Stage 3b（Experience Phase 0，依赖 3a）
- Stage 3c（Recovery Watchdog，独立）

**Wave 3（最具战略价值，依赖前两波）**：

- Stage 3h（**Context Strategy Selector · 金点子 #2**，综合 3a/3b/3d/3g 成果）
- Stage 3e（Run History UI）
- Stage 3i（Memory Insight）

**Wave 4（用户价值放大）**：

- Stage 4a（Experience 导入导出）
- Stage 4b（Policy 动态化）
- Stage 4c（抖音迁移）

---

## 7. Open Questions（产品决策点）

1. **API Knowledge 默认态**：默认关闭（用户 opt-in capability）还是默认开启（默认关闭是对的——但会拉慢 Knowledge 积累速度）？**当前建议：默认关闭，Sidepanel 有明显开关**。
2. **Context Strategy Selector 自学习写回**：Stage 3h 自学习产生的 strategy 偏好直接写 Knowledge Registry 还是候选区人审？**当前建议：Stage 3h 写 Memory 聚合表，不直接改 Knowledge seed；Stage 5a 再做写回**。
3. **Experience schema 冷启动**：前 N 次无历史时，`experience_suggest_plan` 返回 null 还是"手工录制 seed + 有默认回退"？**当前建议：返回 null，Tabrix 不伪装成"已学习"**。
4. **API Knowledge 跨用户隐私**：不同用户看到同一 site 的 API 目录是否应该差异化（某些 API 只有某些权限才看到）？**当前建议：siteId 级共享 urlPattern 和 schema，不共享样本 payload**。
5. **KPI 测量基线**：省 token -40% 是相对 v2.1.0 还是 Stage 2 后？需产品确认。

---

## 附录 A · 本文引用到的关键产物

- Codex 并行侦察 prompts：`.tmp/competitor-survey/prompt-g{1,2,3,4}-*.md`
- Codex 并行侦察 outputs：`.tmp/competitor-survey/outputs/g{1,2,3,4}-*.md`
- 前置 gap 分析：`docs/MKEP_CURRENT_VS_TARGET.md`
- 已完成阶段设计：`docs/POLICY_PHASE_0.md` · `docs/MEMORY_PHASE_0.md`（0.1/0.2/0.3）· `docs/KNOWLEDGE_STAGE_1.md` · `docs/KNOWLEDGE_STAGE_2.md`

## 附录 B · v0.1 → v0.2 变更

- **新增**：产品愿景章（§0）、北极星 KPI（§0.2）
- **新增**：洞察 D（API 感知）、洞察 E（Context Strategy）
- **新增**：Stage 3g（API Knowledge · 金点子 #1）
- **新增**：Stage 3h（Context Strategy Selector · 金点子 #2）
- **新增**：Stage 3i（Memory Insight 缓冲版自改进）
- **新增**：Stage 4a（Experience 本地导入导出）
- **调整**：每个 Stage 显式标注 KPI 贡献
- **调整**：执行顺序改为 4 波并行
- **显化**：Tabrix 不做 Agent 主循环的边界（护城河清单新增 3 条）
