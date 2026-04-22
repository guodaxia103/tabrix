# Tabrix 任务路线图（Stage 3a → 5e）

> **版本**：`v1.0.0`（2026-04-21）—— [`PRD_zh.md`](./PRD_zh.md) 的配套文。
> **语言**：中文。英文正本：[`TASK_ROADMAP.md`](./TASK_ROADMAP.md)（两份内容对等；改其中一份必须同 PR 改另一份）。
> **状态**：`生效 / Stage 级执行 SoT`。
> **取代**：[`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md) 的路线图部分。老文档保留作历史参考，**这份是活的**。
> **Sprint 执行**：[`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) —— 本文每个 Stage 对应那边的若干 `B-*`。

---

## 0. 怎么用这份文档

如果你是一个刚接手 Tabrix 的 AI 助手，**按这个顺序读**：

1. [`AGENTS.md`](../AGENTS.md) —— 研发规则。
2. [`PRD_zh.md`](./PRD_zh.md) —— 产品身份 + 硬约束。
3. **本文** —— 哪个 Stage 活着、下一步是什么、什么明令禁止。
4. [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) —— 本周你能领的 `B-*`。

每个 Stage 下面是固定模板：

- **ID 与名称** —— `Stage <id>`，如 `Stage 3a`。
- **MKEP 层** —— `M` / `K` / `E` / `P` / `X`（跨层）。
- **KPI** —— 推哪一个北极星维度（`省 token` · `更快` · `更准` · `更稳` · `懂用户`）。
- **优先级 / 规模 / 依赖** —— `P0..P2` · `S/M/L/XL` · 上游 Stage。
- **范围** —— 包含什么。
- **非范围** —— 明确排除什么（让 Stage 能收敛、能完成）。
- **Definition of Done（DoD）** —— 完成的硬信号。
- **关联 `B-*`** —— 本 Stage 由哪些 Sprint item 交付。
- **给接手 AI 的提示** —— 踩过的坑、约定、不变式。

不确定时：**不要先扩范围再更新本文**。范围蔓延是 Stage 卡死最常见的原因。

---

## 1. 波次图（依赖全景）

```
Wave 1 —— 近期可并行，不阻塞。
  Stage 3a · Knowledge UI Map + 稳定 targetRef     [B-010 done; B-011 next]
  Stage 3d · read_page(render='markdown')          [B-015 pool]
  Stage 3g · API Knowledge（XHR/fetch 捕获）        [B-017 pool]  ← K1 最大杠杆（数据侧）
  Stage 3f · Policy capability opt-in 枚举         [B-016 pool]

Wave 2 —— 需 Wave 1 至少 Beta。
  Stage 3b · Experience action-path replay         [B-005 schema done, B-012 done, B-013 done]
  Stage 3c · Recovery Watchdog 统一                [B-014 pool]

Wave 3 —— 战略兑现，依赖 Wave 1+2。
  Stage 3h · Context Strategy Selector             [B-018 pool]  ← K1 最大杠杆（规划侧）
  Stage 3e · Run History UI                        [B-001..B-006 Sprint 1+2 已落地]
  Stage 3i · Memory Insights 表                    [B-019 pool]

Wave 4 —— 用户价值放大。
  Stage 4a · Experience 导入导出 + PII redact      [B-020 pool]
  Stage 4b · Policy 动态上下文                     [暂无 B-*]
  Stage 4c · 抖音 + 跨站 family 迁移               [暂无 B-*]

Wave 5 —— 远期，无具体时间。
  Stage 5a · Experience 自学习写回
  Stage 5b · Knowledge Graph 升级
  Stage 5c · WebMCP Bridge
  Stage 5d · Experience Marketplace
  Stage 5e · 个人 userPreference 层
```

**跨 Stage 的并行轨道**（不归任何 Wave 管）：

- 工具契约正确性 —— [`CLICK_CONTRACT_REPAIR_V1.md`](./CLICK_CONTRACT_REPAIR_V1.md)（B-023 done；其他工具的类似修复待排）。
- 基建护栏 —— bundle-size gate（B-007, B-021）、schema-cite 规则（B-009）、测试约定（B-008）。

---

## 2. Stage 3a · Knowledge UI Map + 稳定 `targetRef`

- **层**：`K`
- **KPI**：`更准` · `更稳` · `省 token`
- **优先级**：`P0` · **规模**：`M` · **依赖**：无
- **状态**：**部分完成** —— UI Map schema + GitHub seed + lookup 已在 `B-010` 落地。稳定 `targetRef` 是 `B-011`，待做。

### 范围

1. `KnowledgeUIMapRule { siteId, pageRole, purpose, region?, locatorHints[], actionType?, confidence? }`，hint kind 支持 `aria_name | label_regex | href_regex | css`。—— `B-010` 落地。
2. `compileKnowledgeRegistry` 编译 + 按 `(siteId, pageRole, purpose)` 建索引；重复 triple 编译期拒绝。—— `B-010` 落地。
3. `lookup/resolve-ui-map.ts` 暴露 `lookupUIMapRule` / `listUIMapRulesForPage` / `listUIMapRulesForSite`。—— `B-010` 落地。
4. GitHub seed：首批 5 个 purpose —— `repo_home.open_issues_tab` / `repo_home.open_actions_tab` / `issues_list.new_issue_cta` / `issues_list.search_input` / `actions_list.filter_input`。—— `B-010` 落地。
5. `read_page` HVO 输出加**稳定 `targetRef`** = `historyRef` + HVO index + `contentHash`，让上游 LLM 跨重载引用同一个 HVO。—— `B-011` 待做。
6. `candidate-action.ts` 渐进迁移硬编码的 locator 优先级到 UI Map lookup。—— 渐进；受 `KNOWLEDGE_REGISTRY_MODE = on | off | diff` 控制。

### 非范围

- 抖音 UI Map 规则（Stage 4c）。
- `read_page` 公开 DTO schema 除了新增 `targetRef` 之外的改动。
- `candidate-action.ts` 一次性全切 —— Stage 3a 只铺数据 lookup，消费端渐进切换。

### DoD

- `read_page` 返回稳定 `targetRef`，在 GitHub 基线上对 ≥ 80% HVO 能跨重载 round-trip。
- `pnpm --filter @tabrix/extension test` ≥ 15 个测试覆盖 compile / 声明顺序 / 重复 reject / lookup / 回退。
- Knowledge Stage 1/2 原有测试零改动全绿（无回退）。
- `docs:check` 干净。

### 关联 `B-*`

- ✅ `B-010` —— `KnowledgeUIMapRule` schema + GitHub seed + 只读 lookup（done）。
- ⬜ `B-011` —— `read_page` HVO 稳定 `targetRef`（`historyRef` + HVO index + `contentHash`）。

### 给接手 AI 的提示

- **核心中立性不变式**由 `tests/read-page-understanding-core-neutrality.test.ts` 守护 —— `read-page-understanding-core.ts` 里不能出现 GitHub 字面量。弄挂这个测试 = 阻塞。
- Locator hint 的四个 kind 跟 `docs/MKEP_CURRENT_VS_TARGET.md:229-242` 对齐；不要在没更新路线图的情况下加第五个。
- `targetRef` 里的 `contentHash` 必须对装饰性 DOM 变化（比如 class 切换）稳定；从 hash `accessible name + role` 起步。

---

## 3. Stage 3b · Experience Phase 0 · Action Path Replay

- **层**：`E`（读 `M`）
- **KPI**：`省 token` · `更快` · `懂用户`
- **优先级**：`P0` · **规模**：`L` · **依赖**：`Stage 3a`
- **状态**：**schema 已落、聚合器已落、读侧 MCP 工具已落；写侧 MCP 工具待续** —— `B-005`（schema）Sprint 2 落地；`B-012`（聚合器）+ `B-013` 的只读 `experience_suggest_plan` 已在 Sprint 3 落地；`experience_replay` / `experience_score_step` 仍在 pool（P1，需先做 Policy review）。

### 范围

1. Schema：`experience_action_paths(page_role, intent_signature, step_sequence, success_count, failure_count, last_used_at, …)` + `experience_locator_prefs(page_role, element_purpose, preferred_selector_kind, preferred_selector, hit_count, …)`。—— `B-005` 落地。
2. **聚合器**（`B-012`，done）：扫描 `memory_sessions.status ∈ {completed, failed, aborted}` 且 `aggregated_at IS NULL`；join `memory_tasks` 取 intent；按 `step_index` 读 `memory_steps`；投影到 `experience_action_paths`。重复运行不会二次计数。
3. `memory_sessions.aggregated_at` 列通过 guarded migration 加（SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`）。
4. MCP 工具：`experience_suggest_plan(intent, pageRole?, limit?) → ExperienceActionPathPlan[]` 已在 `B-013` 落地（P0 只读、native-handled，不走扩展桥；按 `success_count` → 净成功数 → 最近使用 → 确定性 ID 排序）。`experience_replay(intent, variables) → plan` 与 `experience_score_step(stepId, result)` 是显式后续项（必须先过 Policy review 再暴露）。
5. 回放时五级 locator 回退：`exact ref → stable hash → xpath → ax name → attribute`，按 Experience 统计动态重排。

### 非范围

- `B-012` 里**不**写 `experience_locator_prefs` —— 另开 item。
- 跨用户分享 / 导入导出（Stage 4a）。
- marketplace / 社区化（Stage 5d）。
- 改 Memory schema（除了 `aggregated_at`）。

### DoD

- 同一 `(pageRole, intent)` 累计 ≥ 10 个 completed session 后，`experience_suggest_plan` 对 GitHub 重复任务返回非空。
- GitHub 基线上 K5（`懂用户`）可测 ≥ 30%（爬向 60% 目标）。
- 聚合器幂等：同一 Memory 状态跑两次，Experience 行一模一样。
- `pnpm --filter @tabrix/tabrix test` 绿，≥ 4 个聚合器测试（空 / 单 session / 幂等 replay / 失败计数）。

### 关联 `B-*`

- ✅ `B-005` —— Experience schema seed（done）。
- ✅ `B-012` —— Experience action-path aggregator（done）。
- ✅ `B-013` —— `experience_suggest_plan` MCP 工具（已落；`experience_replay` / `experience_score_step` 推迟，详见 backlog 中 B-013 的 "Next" 段）。

### 给接手 AI 的提示

- Tabrix 是**执行层，不是 Agent**（PRD §1 P4）。`experience_suggest_plan` 返回 plan —— **上游 LLM 决定采不采纳**。不要在 Tabrix 里加"自动选 plan"的逻辑。
- `intent_signature` 归一化是隐藏难点："列出 repo X 的 issues"和"显示 repo X 的 issues"必须进同一个桶。当前 v1 刻意做轻量规则（小写 + trim + 合并空白）；只有在桶质量证据不足时再升级。
- B-012 v1 的 `step_sequence` JSON 是 `{ toolName, status, historyRef }` —— 保留 `historyRef`，让 replay 能重新拉同一个 page snapshot。

---

## 4. Stage 3c · Recovery Watchdog 统一

- **层**：`E` + `P`
- **KPI**：`更稳` · `更准`
- **优先级**：`P1` · **规模**：`M` · **依赖**：无（可与 Wave 1 并行）
- **状态**：pool —— `B-014`。

### 范围

1. `RecoveryWatchdog` 接口：`{ trigger, pageRoleScope, recoverySteps, cooldownMs }`。
2. 把现有 4 种 fallback 改造成 watchdog：
   - `dialog-prearm.ts` —— 原生弹窗自动接受 / 取消；
   - `interaction.ts` —— click / fill 在 stale ref 上的回退；
   - `screenshot.ts` —— CDP → content-script 回退；
   - `read-page.ts` —— 稀疏树回退。
3. **预留不实现**的扩展点：`captcha` / `rate-limit` / `stale-session` / `login-expired`。
4. 可选：如果 watchdog 流程暴露出竞态，引入 session 级 mutex（抄 `mcp-server-browserbase`）。

### 非范围

- 实现 captcha / rate-limit watchdog。
- 改任何工具的公开契约。
- 把无关的状态机也一起合并进来。

### DoD

- 4 种现有 fallback 走统一 `RecoveryWatchdog` 接口编译通过。
- 工具行为无改动（回归测试绿）。
- `docs/TESTING.md` 记录怎么注入合成故障测 watchdog。
- Memory 里抓到一个 K4（`bridge 恢复失败率`）基线，方便未来对比。

### 关联 `B-*`

- ⬜ `B-014` —— Recovery Watchdog 统一。

### 给接手 AI 的提示

- 这是**重构**，不要做成"一个 PR 加 6 个新 watchdog"。范围是**统一现有 4 个**，不是**新增**。
- `cooldownMs` 必须按 page/session 尊重；cooldown 坏了 watchdog 会震荡。
- 完成三连击 commit 后走 `AGENTS.md` 规则 15 的架构债 review。

---

## 5. Stage 3d · `read_page(render='markdown')` + Agent Step Envelope

- **层**：`K` + `M`
- **KPI**：`省 token`
- **优先级**：`P1` · **规模**：`S` · **依赖**：无
- **状态**：pool —— `B-015`。

### 范围

1. `chrome_read_page(render = 'json' | 'markdown')` —— 默认保持 `json`；无 break change。
2. `memory_page_snapshots.readable_markdown` 列（懒计算）。
3. 可选：`agentStep` envelope JSON schema 发到 `packages/shared/src/`，方便 MCP 客户端在 prompt 里引用。

### 非范围

- HTML → markdown 规则超越已有 `get_web_content` 的范围。
- 新加一个 MCP 工具。
- 改默认 render。

### DoD

- `render='markdown'` 跑通；GitHub 基线上 p95 token 数比 `render='json'` 低 ≥ 40%。
- Snapshot 稳定：同一页面两次拿 `render='markdown'` 字节一致（同 `contentHash` → 同 bytes）。
- `pnpm --filter @tabrix/extension test` 至少加 5 个测试。

### 关联 `B-*`

- ⬜ `B-015` —— `read_page(render='markdown')` + 单测。

### 给接手 AI 的提示

- markdown 路径**不能**绕过 HVO extractor —— 上游 LLM 即使要 markdown 也要 `highValueObjects[]`。响应体形态：`{ render: 'markdown', markdown: string, highValueObjects: [...] }`。
- 不要在没治理决策的情况下重新引回被删除的 `@tabrix/markdown-worker` 之类的面（`AGENTS.md` → Removed Surfaces）。

---

## 6. Stage 3e · Run History UI（Sidepanel "Memory" tab）

- **层**：`M`
- **KPI**：`懂用户`（运维 / 排障价值）
- **优先级**：`P1` · **规模**：`M` · **依赖**：无
- **状态**：**完成** —— Sprint 1+2 已交付核心面。

### 已交付范围

- `B-001` —— native-server `/memory/*` 读 API（session 列表、step drill-down、task fetch）。
- `B-002` —— Sidepanel Memory tab session 列表（分页、status 色点、step 数、duration）。
- `B-003` —— Session → step 下钻：每步 status / 工具名 / duration / 错误暴露 / "Copy historyRef"按钮。
- `B-006` —— Status 筛选 chip + 搜索 + "跳到最后一个失败"。

### 未做（延后）

- 服务端搜索（`GET /memory/sessions?q=`）—— 未来候选。
- 虚拟滚动 —— 用分页替代（默认 20 行/页，上限 500）。
- 变量快照 inspector —— 等 Experience 把它聚合好之后，以不同 Stage 形态回来。

### DoD

- ✅ Sidepanel Memory tab 默认渲染 20 条；点击展开 step；Copy historyRef 可用；筛选 + 搜索 + 跳到失败都能用。
- ✅ 没有把被删除的 Smart Assistant / AgentChat 面重新引回来。
- ✅ Bundle size 在 25/40 kB（JS）+ 20/22 kB（CSS）gate 之内（`scripts/check-bundle-size.mjs`）。

### 关联 `B-*`（全 `done`）

- ✅ `B-001`、`B-002`、`B-003`、`B-006`。

### 给接手 AI 的提示

- Memory tab 未来的新能力（变量快照、action-path 可视化）必须复用 `useMemoryTimeline` composable —— 不要 fork 状态管理。
- 这个 composable 故意放在 `entrypoints/shared/composables/` 下，让 popup 未来也能消费同一数据源。

---

## 7. Stage 3f · Policy Capability Opt-in 标准化

- **层**：`P` + `M`
- **KPI**：`更稳`（可审计）
- **优先级**：`P1` · **规模**：`S` · **依赖**：无
- **状态**：pool —— `B-016`。

### 范围

1. `TabrixCapability` 枚举：`vision | elevated_js | download | devtools | testing | cross_origin_nav`。
2. 每个 P2/P3 工具显式声明所需 capability（`tools.ts`）。
3. env：`TABRIX_POLICY_ALLOW_P3` → `TABRIX_POLICY_CAPABILITIES`（保持 6 个月以上兼容）。
4. `MemoryAction.policyCapabilities` 字段（给 Insights tab 和未来审计用）。
5. 为 Stage 4b 的 origin/siteId 动态策略留接口（保留不实现）。

### 非范围

- 基于 siteId 的动态策略（Stage 4b）。
- Capability 切换 UI（Sidepanel Policy 面更远）。
- 打碎现有 `TABRIX_POLICY_ALLOW_P3` env。

### DoD

- 所有 P3 工具都有命名 capability；`TABRIX_POLICY_ALLOW_P3=1` 仍然全开（兼容）。
- `packages/shared/src/tools.ts` 发布 `TabrixCapability`。
- native-server policy gate 从工具注解读 capability，不从另开的表读。
- `pnpm -r typecheck` 和 gate 测试绿。

### 关联 `B-*`

- ⬜ `B-016` —— `TabrixCapability` 枚举 + env 迁移。

### 给接手 AI 的提示

- Policy 层改动属于 **owner-lane** 工作（`AGENTS.md` "Tiered Execution Model" → "Fast-lane must not do" §2）。接手的 AI 助手必须保持在 owner-lane（先设计 → 写成方案 → 再动手），不能把它当成机械的 fast-lane 任务下放。
- 废弃要友好：如果 `TABRIX_POLICY_ALLOW_P3=1`，保持 6 个月继续解锁 P3，每进程打印一次弃用警告。

---

## 8. Stage 3g · API Knowledge · 网络层感知

> **当前最大的竞争空位** —— 调研的竞品里**没一个**把站点 API 当 Knowledge 一等公民。

- **层**：`K` + `P`
- **KPI**：`省 token`（**最大**）· `更快` · `更准`
- **优先级**：`P0` · **规模**：`L` · **依赖**：`Stage 3f`（capability 框架）
- **状态**：pool —— `B-017`。

### 范围

1. **捕获层**：Opt-in 的 XHR/fetch 监听（`chrome.debugger.attach` + `Network.requestWillBeSent/responseReceived`）。**默认关**，靠 capability `knowledge.capture_api` 开。
2. **归纳层**：把重复请求收敛成 `KnowledgeApiEndpoint`：
   ```ts
   interface KnowledgeApiEndpoint {
     siteId: string;
     pageRole?: string;
     method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
     urlPattern: string; // /api/v3/repos/:owner/:repo/issues
     requestSchema?: JsonSchema;
     responseSchema?: JsonSchema;
     paginationHint?: 'offset' | 'cursor' | 'none';
     authRequired?: boolean;
     rateLimitHint?: string;
     seenCount: number;
     lastSeenAt: string;
   }
   ```
3. **MCP 工具**：
   - `knowledge_describe_api(siteId, pageRole?) → endpoints[]`；
   - `knowledge_call_api(endpointId, params)` —— 复用用户真实 Chrome cookie（**护城河**：云浏览器做不到）。
4. **隐私 / Policy**：
   - 默认关；Sidepanel 有明显按 `siteId` 的 opt-in 开关；
   - PII redact（`token` / `password` / `email` 模式）在**落库前**跑；
   - 按 siteId 单独开关。
5. **里程碑**：GitHub 先 —— 覆盖 `issues` / `actions` / `workflow_runs` / `prs` / `contents`（5 类）。

### 非范围

- 跨用户 / 跨机器 API 目录共享（不做 —— siteId 级只共享 `urlPattern` + `responseSchema`，**不**共享 payload 样本）。
- 非 HTTP 协议（WebSocket / SSE）—— 更远。
- 用户没 opt-in 就去调 API。

### DoD

- GitHub 上一次捕获会话后，`knowledge_describe_api(siteId: 'github.com')` 返回 ≥ 5 条带合法 JSON schema 的 endpoint。
- `knowledge_call_api` 用真实 cookie 对 `GET /repos/:owner/:repo/issues` 来回跑通。
- 隐私测试：PII fixture（`authorization: Bearer …` / `password: …` / `email: foo@bar.com`）不出现在 SQLite 行里。
- 新装默认关；opt-in 是 Sidepanel 显式动作。

### 关联 `B-*`

- ⬜ `B-017` —— API Knowledge 捕获 + schema + redact（XL，可能拆）。

### 给接手 AI 的提示

- `chrome.debugger.attach` 是 P3 路径（PRD §1 P3 低侵入）。本 Stage 是**有意、opt-in 的 P3 分支** —— opt-in 默认关，标签关闭时 debugger 不能悬挂。
- PII redact 必须**在 `INSERT` 前**跑；事后擦除不行（捕获到擦除之间会漏）。
- GitHub 是 MVP；GitHub 没到 Beta 前不要加抖音 / 小红书端点。

---

## 9. Stage 3h · Context Strategy Selector

> **规划侧 `省 token` 最大单点杠杆。**

- **层**：`K` + `E`
- **KPI**：`省 token`（**最大**）· `更快` · `懂用户`
- **优先级**：`P0` · **规模**：`L` · **依赖**：`Stage 3a` + `Stage 3b` + `Stage 3d` + `Stage 3g` 都至少 Beta
- **状态**：pool —— `B-018`。

### 范围

1. 新 MCP 工具 `tabrix_choose_context(intent, url?, constraints?) → ContextBundle`：
   ```ts
   interface ContextBundle {
     strategy:
       | 'api_only'
       | 'knowledge_light'
       | 'read_page_markdown'
       | 'read_page_json'
       | 'experience_replay'
       | 'read_page_json_plus_ui_map';
     reasoning: string;
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
     tokenBudget: number;
     fallbackStrategy?: string;
   }
   ```
2. 决策规则表（作为 Knowledge Registry 的 seed 数据）：
   `intent 模式 × siteId 是否已知 × pageRole 是否已知 × 是否有 Experience × 是否有 API Knowledge → strategy`。
3. 自学习：每次 Agent 采纳的 strategy + 结果（成功/失败 + 耗时 + token）写回 Memory；下次同 intent 按成功率重排。
4. Stage 3h 是 Experience 的**消费面**，Stage 3b 是**生产面**。

### 非范围

- Strategy 偏好写回 Knowledge Registry seed（Stage 5a）。
- 用模型挑 strategy —— v1 只做规则。
- 跨用户 strategy 共享。

### DoD

- GitHub 基线上 top-10 重复 intent，Stage 3g + 3b 到 Beta 后，`tabrix_choose_context` 在 ≥ 70% 调用里选 `api_only` 或 `experience_replay`（而非 `read_page_json`）。
- GitHub 基线 token 成本对比 Stage 3h 前下降 ≥ 25%（按 MCP 侧 input token 求和计算）。
- 规则表是**数据**不是**代码** —— 加一条规则不要求改 TS。

### 关联 `B-*`

- ⬜ `B-018` —— `tabrix_choose_context` + seed 决策表。

### 给接手 AI 的提示

- 这个 Stage **只有在它的四个依赖都 Beta 后**才有价值。早启动就是 `read_page_json` 永远兜底，K1 不动。
- 不要让它变成"Tabrix 成 Agent 了"。它选 context，**不选**下一步。

---

## 10. Stage 3i · Memory Insights 表 + Sidepanel Insights tab

- **层**：`M` + `E`
- **KPI**：`更准`（长期）
- **优先级**：`P2` · **规模**：`M` · **依赖**：`Stage 3e`（共享 Sidepanel UI 层）
- **状态**：pool —— `B-019`。

### 范围

1. 新表 `memory_insights`：
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
     occurrences: number;
     suggestion?: string;
     firstSeenAt: string;
     lastSeenAt: string;
     status: 'new' | 'acknowledged' | 'copied_to_issue' | 'wont_fix';
   }
   ```
2. Sidepanel 新增 "Insights" tab —— 按 severity 排序、去重合并计数、一键"复制 issue markdown"（**仅剪贴板，不联网**）。
3. 聚合：定期扫描近期 Memory，按 6 种 `type` 标记。

### 非范围

- 自动提 GitHub issue（PRD §8 —— 永不，直到 `AGENTS.md` 治理决策）。
- 匿名 telemetry 上报 —— Stage 5+ 候选。
- 基于 ML 的异常检测 —— v1 只做静态规则。

### DoD

- 合成 fixture 下，6 种 `type` 全部能写进 `memory_insights`。
- Sidepanel Insights tab 能渲染并复制 markdown；剪贴板 round-trip 验证过。
- 本 Stage 不产生任何网络请求。

### 关联 `B-*`

- ⬜ `B-019` —— `memory_insights` 表 + Sidepanel tab。

### 给接手 AI 的提示

- v1 **绝对不加**"提交上游"按钮。仅剪贴板是产品不变式。
- 复制出来的 markdown 要含 `historyRef`、page URL、工具名、出现次数、首/末见时间 —— 让人不用打开 Tabrix 就能 triage。

---

## 11. Stage 4a · Experience 本地导入导出（社区种子）

- **层**：`E`
- **KPI**：`懂用户`（长期社区效应）
- **优先级**：`P1` · **规模**：`M` · **依赖**：`Stage 3b` 到 Beta
- **状态**：pool —— `B-020`。

### 范围

1. `experience_export(taskIntent | pageRole | all) → JSON file`。
2. `experience_import(file) → diff + dry-run + 用户确认`。
3. **PII redact**：导出前按 `password | token | authorization | cookie | session`（case-insensitive）剥离字段，用户显式 opt-in 才保留。
4. Schema 版本化：`experienceSchemaVersion: 1`，跨版本导入时自动迁移。
5. 信任：导入强制 `dry-run` 预览，列出将被覆盖的 locator prefs / action paths，用户确认后才写。

### 非范围

- 联网 marketplace / 社区评分 / 远端拉取（Stage 5d）。
- 超越"加了 X，覆盖 Y"的差分 UI。
- 签名 / notarization（Stage 5d）。

### DoD

- 同机器上 export → import round-trip，`(pageRole, intent)` 桶字节级一致。
- PII 正则测试：Memory 里注入的 secret 不出现在导出文件。
- Dry-run 不可绕过（不存在"强制导入"标志）。

### 关联 `B-*`

- ⬜ `B-020` —— `experience_export` / `experience_import` + redact + dry-run。

### 给接手 AI 的提示

- marketplace / 联网共享明确更远。Stage 4a **只做本地文件**。不要加"publish"按钮。
- PII redact 默认"剥离"；保留 secret 必须是用户显式 opt-in，**绝不能**反过来。

---

## 12. Stage 4b · Policy 动态上下文

- **层**：`P`
- **KPI**：`更稳` · `更准`
- **优先级**：`P1` · **规模**：`M` · **依赖**：`Stage 3f` + `Stage 3g` + Memory 聚合就绪
- **状态**：暂无 `B-*`。

### 范围

1. `PolicyContext = { toolName, pageRole, siteId, recentFailureRate, apiEndpointCalled }` 传入每次 gate 判定。
2. 动态重分级：比如 `chrome_javascript` 在 `github.com/issues` 是 P2，在 `bank.com` 是 P3。
3. 用户级覆盖层 —— 个人可**收紧**（不可放宽 —— 放宽是 owner 级决策）。
4. 审计日志 UI（`memory_insights` 的子集）。

### 非范围

- 对 policy 决策做 ML —— 只用静态规则 + Memory 信号。
- 跨组织 policy 共享。

### DoD

- Memory 里的 policy 决策带完整 `PolicyContext`（Insights 里能搜）。
- 至少一条可工作的重分级规则（如 `chrome_javascript` 在 `bank.com` 即使 env 放开 P3，也仍是 P3）—— 可复现。

### 给接手 AI 的提示

- **不要**在重分级过程里削弱任何已有 P3 工具。重分级只能单向（更严），除非 owner 在 PR 里显式 opt-in。

---

## 13. Stage 4c · Knowledge Stage 4 · 抖音 + 跨站 family

- **层**：`K`
- **KPI**：`更准`（覆盖扩张）
- **优先级**：`P2` · **规模**：`M` · **依赖**：`Stage 3a` 稳定
- **状态**：暂无 `B-*`。

### 范围

1. 把 `read-page-understanding-douyin.ts`（+ 创作者中心）的所有规则迁到 Registry seed。
2. 抽象 "Video/Social family"（抖音 / B 站 / YouTube 共享的 pattern：feed / 创作者面板 / 评论 / 上传）。
3. Registry 覆盖后，清退硬编码 TS adapter。

### 非范围

- 同 Stage 加新 family（比如"搜索引擎 family"）。
- 对非 GitHub 站点跑公开 benchmark（更远）。

### DoD

- 所有抖音 TS adapter 代码走 `docs/KNOWLEDGE_STAGE_1.md` + `STAGE_2.md` 的 Registry 路径。
- 抖音上 parity 测试：迁移前 TS adapter 的输出在代表性 fixture 上**字节级**等价。

### 给接手 AI 的提示

- 抖音专用 fixture 放私有 `tabrix-private-tests` 仓库，**不**进本仓（`AGENTS.md` 规则 17）。
- 不要把真实抖音 DOM 粘进公开测试文件。

---

## 14. Stage 5a · Experience 自学习写回

- **层**：`K` + `E`
- **KPI**：`懂用户` · `更准`
- **优先级**：未来 · **规模**：`L` · **依赖**：Stage 3b + 3h 稳定 ≥ 一个 sprint
- **状态**：暂无 `B-*`。

### 范围

Tabrix 自动从 Memory + Experience 挖出成功 locator / path 偏好，写入 Knowledge 的**候选区**。人（仓库 maintainer）评审后才升 Registry seed。

### 非范围

- 跳过人审直接自动写回。
- 跨用户的共享学习（破坏隐私不变式）。

### DoD

- 仓库 maintainer 每周走一次 review；活跃站点上每周 ≥ 5 个候选行。
- 没有 `memory_insights` 的 `api_schema_drift` / `locator_flaky` 不经人审直接写 Knowledge。

---

## 15. Stage 5b · Knowledge Graph 升级

- **层**：`K`
- **KPI**：`更准` · `懂用户`
- **优先级**：未来 · **规模**：`XL` · **依赖**：Stage 3a + 3g + 4c 都稳定
- **状态**：暂无 `B-*`。

### 范围

把扁平 Registry 表升级成图：`Site × Page × Object × Action × API`，关系 `LINKS_TO` / `HAS_REGION` / `CONTAINS_OBJECT` / `LEADS_TO` / `SUCCEEDS`（参考 GitNexus schema）。启用：

- "下一步候选动作"推断；
- 相似路径召回；
- 失败路径回避。

### 非范围

- 在图上跑 embedding（Stage 5+，而且只有语义搜索回路线图才谈）。
- 外挂 Neo4j / 专用图数据库 —— 图跑在现有 SQLite 上。

### DoD

- 待定 —— 取决于 Stage 5a 成熟度。

---

## 16. Stage 5c · WebMCP Bridge

- **层**：`X`
- **KPI**：`更快` · `省 token`
- **优先级**：未来 · **规模**：`L` · **依赖**：WebMCP 外部标准化
- **状态**：暂无 `B-*`。

### 范围

当站点自带 WebMCP 端点时，Tabrix 做 bridge：有 WebMCP 就转发，没就回退到 `read_page + HVO`。

### 非范围

- WebMCP 外部标准稳定前自己实现。
- 站点侧 WebMCP 注入。

### DoD

- 待定 —— 取决于 WebMCP 规范成熟度。

---

## 17. Stage 5d · Experience Marketplace

- **层**：`E`
- **KPI**：`懂用户`
- **优先级**：未来 · **规模**：`XL` · **依赖**：Stage 4a 稳定 ≥ 6 个月
- **状态**：暂无 `B-*`。

### 范围

签名 + 信任评分 + 社区分发的 Experience bundle。带 provenance 和恶意 recipe 检测的联网导入导出。

### 非范围

- Stage 4a（本地导入导出）落地并稳定之前都不做。
- 商业化。

### DoD

- 待定 —— 取决于 Stage 4a 成熟度。

### 给接手 AI 的提示

任何在 Stage 4a 绿 6 个月之前标着"marketplace"的 PR 都过早了；拦下问。

---

## 18. Stage 5e · 个人 `userPreference` 层

- **层**：`M`
- **KPI**：`懂用户`
- **优先级**：未来 · **规模**：`M` · **依赖**：Memory 累计 ≥ 3 个月数据
- **状态**：暂无 `B-*`。

### 范围

Memory 加 `user_preferences { key, value, sourceSessionId, confidence }` —— 从反复出现的模式里捕获（比如"问 issues 时用户总选 repo X"）。

### 非范围

- 跨用户汇聚。
- 在列还没加之前就在营销文案里喊"个性化"。

### DoD

- 待定。

---

## 19. 跨 Stage 轨道（非 Stage 范畴）

### 19.1 工具契约正确性

灵感来自 `B-023`（`chrome_click_element` 假成功缺陷）。每个工具的响应契约必须能区分：

- `dispatchSucceeded` —— content-script 路径到底跑了没？
- `observedOutcome` —— 到底变了啥（enum：`cross_document_navigation | spa_route_change | hash_change | new_tab_opened | dialog_opened | menu_opened | state_toggled | selection_changed | dom_changed | focus_changed | download_intercepted | no_observed_change | verification_unavailable`）；
- `verification` —— 裸信号 bool；
- `success` —— 派生，**绝不**等同于"promise 决了"。

**下一批候选**：`chrome_fill_or_select` / `chrome_keyboard` / `chrome_navigate` 也该按这个路子来，每个开独立 `B-*`。

### 19.2 基建护栏

- `scripts/check-bundle-size.mjs` —— JS 25/40 kB，CSS 20/22 kB（B-007 + B-021）。
- Memory / Knowledge / Experience 或共享 DTO 的 schema-cite 规则（B-009）。
- `docs/EXTENSION_TESTING_CONVENTIONS.md` —— `fetch` / `AbortController` / `chrome.storage` 模式（B-008）。
- 同一 MKEP 层连续 3 个 `feat:` / `fix:` commit 后做一次架构 review（`AGENTS.md` 规则 15）。

### 19.3 被删除面不变式

加任何 MCP 工具 / 后台监听 / Sidepanel tab / 共享类型之前，对照 `AGENTS.md` → Removed Surfaces。如果 PR 会把那些面**换个名字**带回来，停下问。

---

## 20. 当前 Sprint 快照（2026-W19 · Sprint 3）

（动态快照 —— 每个 sprint review 更新；权威副本在 [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md)。）

| Sprint          | 状态                | item                                                                               |
| --------------- | ------------------- | ---------------------------------------------------------------------------------- |
| Sprint 1（W17） | `closed 2026-04-20` | `B-001..B-004` 全 done。                                                           |
| Sprint 2（W18） | `closed 2026-04-20` | `B-005..B-009` 全 done。                                                           |
| Sprint 3（W19） | **active**          | `B-010 done · B-021 done · B-023 done · B-012 done · B-013 done · B-022 planned`。 |

### 下一 Sprint（Sprint 4）候选，从 pool 拉

没阻塞的话按这个顺序捡：

1. `B-011` —— 稳定 `targetRef`（把 Stage 3a 真正收掉）。
2. Stage 3b 写侧后续项 —— `experience_replay` + `experience_score_step`（需要先做 Policy review；目前没有单独 backlog ID）。
3. `B-015` —— `read_page(render='markdown')`（Stage 3d，小而 K1 大）。
4. `B-016` —— `TabrixCapability` 枚举（Stage 3f，解锁 Stage 3g）。

**不要**在 `B-016` 至少 `review` 之前拉 `B-017`（API Knowledge）—— API Knowledge 依赖 capability 框架。

---

## 21. Changelog

| 版本     | 日期       | 变更                                                                                                                                                                                                    |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v1.0.0` | 2026-04-21 | 首份仓库内集中化 Stage 级路线图。取代 [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md) 的路线图部分（老文档保留作历史参考）。覆盖 `Stage 3a → 5e`（17 个 Stage），含 DoD + `B-*` 映射。 |
