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
  Stage 3a · Knowledge UI Map + 稳定 targetRef     [B-010 done; B-011 v1 done]
  Stage 3d · read_page(render='markdown')          [B-015 v1 done]
  Stage 3g · API Knowledge（XHR/fetch 捕获）        [B-017 v1 done] ← K1 最大杠杆（数据侧）；call 侧延后
  Stage 3f · Policy capability opt-in 枚举         [B-016 v1 done] capability allowlist 已落地；v1 只暴露 `api_knowledge`

Wave 2 —— 需 Wave 1 至少 Beta。
  Stage 3b · Experience action-path replay         [B-005 schema done, B-012 done, B-013 done, B-EXP-REPLAY-V1 v1 landed (V24-01)]
  Stage 3c · Recovery Watchdog 统一                [B-014 pool]

Wave 3 —— 战略兑现，依赖 Wave 1+2。
  Stage 3h · Context Strategy Selector             [B-018 v1 slice done]  ← K1 最大杠杆（规划侧）；v1 = 规则版选择器，完整 Stage 3h 仍在 pool
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
- **状态**：**v1 完成** —— UI Map schema + GitHub seed + lookup 已在 `B-010` 落地；稳定 `targetRef` v1 已在 `B-011` 落地（扩展端 HVO 直接产出 `tgt_<10-hex>`，click 桥接通过 per-tab registry 把 stable→snapshot ref 还原，真实浏览器黄金链路 `T5-F-GH-STABLE-TARGETREF-ROUNDTRIP` 已绿）。UI Map 消费端切换（item 6）仍待做。

### 范围

1. `KnowledgeUIMapRule { siteId, pageRole, purpose, region?, locatorHints[], actionType?, confidence? }`，hint kind 支持 `aria_name | label_regex | href_regex | css`。—— `B-010` 落地。
2. `compileKnowledgeRegistry` 编译 + 按 `(siteId, pageRole, purpose)` 建索引；重复 triple 编译期拒绝。—— `B-010` 落地。
3. `lookup/resolve-ui-map.ts` 暴露 `lookupUIMapRule` / `listUIMapRulesForPage` / `listUIMapRulesForSite`。—— `B-010` 落地。
4. GitHub seed：首批 5 个 purpose —— `repo_home.open_issues_tab` / `repo_home.open_actions_tab` / `issues_list.new_issue_cta` / `issues_list.search_input` / `actions_list.filter_input`。—— `B-010` 落地。
5. `read_page` HVO 输出加**稳定 `targetRef`**，让上游 LLM 跨重载引用同一个 HVO。—— `B-011` v1 落地。最终格式是 `tgt_<10-hex>`，由 `cyrb53(pageRole | objectSubType | role | normalizedLabel | hrefPathBucket | ordinal)` 算出；早期文档里的 `historyRef + hvoIndex + contentHash` 路径在核实阶段被证伪：`historyRef` 之前一直硬编码 `null`，`hvoIndex` 也会随列表轻微抖动而漂移。click 桥（`candidate-action.ts` + `interaction.ts` + `computer.ts`）通过 per-tab snapshot registry 把 `candidateAction.targetRef = tgt_*` 还原为当前 snapshot 的 ref；registry 里查不到（service worker 被回收 / 上游用了过期 targetRef）时立刻 fail-closed 并返回 "请先 chrome_read_page" 的明确提示。
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
- ✅ `B-011` v1 —— `read_page` HVO 稳定 `targetRef`（`tgt_<10-hex>`，由 `cyrb53(pageRole|objectSubType|role|normalizedLabel|hrefPathBucket|ordinal)` 算出）；click 桥经 per-tab registry 把 stable→snapshot ref 还原；真实浏览器黄金链路 `T5-F-GH-STABLE-TARGETREF-ROUNDTRIP` 已绿。

### 已知边界（B-011 v1）

这些是有意为之的 v1 边界 —— 不是 bug。写在这里是为了让 B-018 v2 / Stage 3a item 6 / 后续接手者别假设比实际更强的契约。

1. **稳定 `targetRef` 只对 ref-backed HVO 真正端到端可执行。** 每 tab 的快照 registry（`stable-target-ref-registry.ts`）只在 HVO 同时具备 `targetRef` 和 per-snapshot `ref` 时才记录映射（见 `read-page.ts` 里 `recordStableTargetRefSnapshot` 调用处的 `obj.targetRef && obj.ref` 守卫）。纯 synthetic / seed 派生的 HVO 即使被打了 `tgt_<10-hex>` 用于稳定性证据，click 桥对它的调用会 fail-closed（`unresolved_stable_target_ref`）—— 上游需要驱动交互时必须挑 ref-backed HVO。把可执行覆盖率扩开是 v2（Stage 3a item 6 / UI Map 消费切换）的事。
2. **`historyRef` 当前只是轻量级快照相关性 ID，不是强内容锚（不等价于 `contentHash`）。** 扩展层会写 `historyRef = read://<host>/<pageRoleSlug>/<sha8>`（按内容 seed 派生），但 native server 的快照 post-processor 会无条件把 wire 层的值覆盖成 `memory://snapshot/<uuid>`（SQLite 快照行 ID）。所以上游 MCP 客户端看到的是 uuid，不是内容哈希。B-011 的稳定 `targetRef` **不**依赖 `historyRef` 来稳定 —— 它的派生纯粹是 `(pageRole | objectSubType | role | normalizedLabel | hrefPathBucket | ordinal)`。把 `historyRef` 升级成真正的 `contentHash` 等价物（让它能作为二级抗漂锚）是单独的 follow-up，不算在 B-011 v1 内。

### V23-02 增量加固 —— 已落地（单测层守护）

v2.3.0 主线的 `V23-02` 包在 B-011 v1 的派生公式之上加了一层显式的稳定性增量加固，**不重做** v1 的任何部分：

- **`tests/stable-target-ref-stability.test.ts`** 把三种稳定性以命名场景方式钉死：（a）装饰性兄弟删除（两次快照之间一个无身份信息的 skeleton 行消失，存活的 HVO 仍拿同一个 `targetRef`）；（b）class / aria 样式抖动不能进入身份输入（builder 的输入形契约被钉住）；（c）reload 形态的重标注（每个 per-snapshot `ref` 都换新，身份元组不变 → 同一个 `targetRef`）。同时显式钉住"视觉相同的兄弟元素必须靠 ordinal 区分"这一契约。
- 与 (c) 对应的真实浏览器跨 reload 场景是 `tabrix-private-tests` 仓库里的 `T5-F-GH-STABLE-TARGETREF-CROSS-RELOAD`（read_page → 拿 `targetRef` → reload tab → read_page → 断言 `targetRef` 相同 → click 桥经 registry 还原）。按 AGENTS 第 17 条该场景留在私库。
- 没有动 `targetRef` 派生、per-tab snapshot registry、click 桥本身 —— V23-02 是对已经落地的 v1 表面所做的 regression-hardening 锁。

### V23-03 / B-015 —— Markdown 渲染路径 + L2 source routing 已落地（2026-04-22）

v2.3.0 主线的 `V23-03` 包首次落地了 `read_page(render='markdown')` 与 §11.5 的 L2 source routing 表面。这是 `B-015` 第一次发版，并且**完全是叠加性变更** —— JSON 模式的输出字节级保持不变。

- **共享契约**：`packages/shared/src/read-page-contract.ts` 新增 `ReadPageRenderMode = 'json' | 'markdown'`，给 `ReadPageExtensionFields` 加 `renderMode` + `markdown` 字段，并把 `ReadPageTaskLevel2` 扩展出 `domJsonRef` / `markdownRef` / `knowledgeRef` 三条 source routing 字段（全部可选、向后兼容）。`packages/shared/src/tools.ts` 在 `chrome_read_page` 的 MCP 输入 schema 上新增可选 `render` 参数。
- **扩展端**：`app/chrome-extension/entrypoints/background/tools/browser/read-page.ts` 校验新的 `render` 参数（未知值直接 fail-closed），当 `render='markdown'` 时挂一条 `dom_markdown` artifact ref，并通过新的纯函数 `read-page-markdown.ts` 生成 Markdown 投影。该投影**故意不携带** `ref` / `targetRef`，强制 §4.3 不变式：Markdown 是**阅读表面，不是执行表面** —— JSON 的 HVO / `candidateActions` / 稳定 `targetRef` 仍然是点击/填写的执行真相。
- **L2 source routing**：`read-page-task-protocol.ts` 的 `buildLevel2` 现在会用第一个 `dom_snapshot` artifact 填 `domJsonRef`（永远存在），用显式传入的 `markdownArtifactRef` 填 `markdownRef`（仅在调用方主动要求 Markdown 时存在），`knowledgeRef = null`（B-017 的 runtime 调用面尚未落地，留位）。当 Markdown 存在时，`'readable_markdown'` 也会镜像写入老的 `expansions` 列表，方便走 v1 形契约的调用方发现新源。
- **测试**：`tests/read-page-render-markdown.test.ts` 钉死五条契约（标题/对象/可交互元素渲染、`ref`/`targetRef` 不泄漏、空快照语义、bullet 数量硬上限、markdown artifact ref 的确定性）。`tests/read-page-l2-source-routing.test.ts` 钉死四条 routing 契约（默认 `markdownRef = null`、显式 `markdownArtifactRef` 才打开 routing、防御性地不从 `artifactRefs` 自动发现 markdown、`defaultAccess` 仅在 `mode='full'` 时切换）。
- **未变更**：稳定 `targetRef` 派生、per-tab snapshot registry、click 桥、所有现有 JSON 输出字段。从不传 `render` 的上游调用方看到的就是 v1 的 payload。

### V23-04 / B-018 v1.5 —— choose_context 决策遥测 + outcome 回写 + markdown 分支已落地（2026-04-22）

`V23-04` 包把 `tabrix_choose_context` 从 v1 的无状态选择器升级为 v1.5 的闭环表面，可以回答"刚才挑的策略到底有没有省下一次 `read_page`"，同时 v1 默认行为完全保留。

- **遥测表**（DDL 在 `app/native-server/src/memory/db/schema.ts`，幂等 `CREATE IF NOT EXISTS`）：`tabrix_choose_context_decisions`（每次 `status='ok'` 的选择写一行：`decision_id` / `intent_signature` / `page_role` / `site_family` / `strategy` / `fallback_strategy` / `created_at`）+ `tabrix_choose_context_outcomes`（每次 outcome 回写一行，FK 回到 decisions）。`intent_signature` 沿用 B-013 已经在 Experience 查询里用的归一化形式；**永远不存** 原始 `intent` 字符串。
- **决策回写**：`runTabrixChooseContext` 在遥测被注入时追加一条 decision 行，并在 `TabrixChooseContextResult` 上新增不透明的 `decisionId` 字段。遥测写失败（磁盘满 / DB 锁住等）只会让 `decisionId` 缺失，**绝不**冒泡成 tool error —— 选择器表面在持久化生病时仍然和 v1 一样可用。
- **Outcome 回写工具**：新 MCP 工具 `tabrix_choose_context_record_outcome`（P0、纯 INSERT、native-handled）。输入 `{decisionId, outcome}`，outcome ∈ `{reuse, fallback, completed, retried}`（封闭集合，`tools.ts` 的 JSON schema 已经在客户端校验，server 端 runner 仍重复校验，因为 MCP host 不可信）。返回三种结构化状态：`ok`（写入成功）、`invalid_input`（参数畸形，`isError: true`）、`unknown_decision`（参数合法但找不到对应 decision —— 调用方据此区分"决策丢了"和"权限不足"）。`choose-context.test.ts` 钉死 P0 风险等级。
- **Markdown 阅读分支**：`read_page_markdown` 加入 `ContextStrategyName`。选择器在 (a) 没 experience 命中、(b) 没可用 knowledge 目录、(c) `siteFamily === 'github'`、(d) `pageRole` 在新增的手工白名单 `MARKDOWN_FRIENDLY_PAGE_ROLES` 里时，才路由到这个策略（白名单当下生效的是 `repo_home`；`issue_detail` / `pull_request_detail` / `discussion_detail` / `wiki` / `release_notes` / `commit_detail` 已预先列好，等 understanding 层的 pageRole 发射器跟上后会自动启用）。白名单之外仍然是 v1 的 `read_page_required`，纯 JSON 调用方零行为变化。Markdown 仍然只是**阅读表面** —— JSON HVO / candidateActions / `targetRef` 仍是执行真相（B-015 / V23-03 不变式）。
- **发版证据**：`pnpm run release:choose-context-stats`（`scripts/release-choose-context-stats.mjs`）—— 只读脚本，从遥测表里聚合策略分布与 outcome 比例。它会拒绝在 V23-04 之前的旧 DB 上工作，避免报告里悄悄写"0 行"其实是表都还没建。支持 `--since <ISO>` / `--json` / `--db <file>`，适合 v2.3.0 打 tag 之前手工跑一次。
- **测试**：`choose-context.test.ts` 新增 21 条用例（markdown 分支路由、telemetry decisionId 暴露、telemetry 写失败的隔离、outcome runner 输入校验、unknown_decision 分支、outcome 写失败的隔离）；`memory/telemetry/choose-context-telemetry.test.ts` 用真实 `:memory:` SQLite 跑 8 条仓库级用例（PK 冲突、空字段、聚合、`since` 过滤）。Strategy-set 守卫测试扩展到枚举 v1.5 的四个名字，以后再加策略仍需要显式编辑这里。

### 给接手 AI 的提示

- **核心中立性不变式**由 `tests/read-page-understanding-core-neutrality.test.ts` 守护 —— `read-page-understanding-core.ts` 里不能出现 GitHub 字面量。弄挂这个测试 = 阻塞。
- Locator hint 的四个 kind 跟 `docs/MKEP_CURRENT_VS_TARGET.md:229-242` 对齐；不要在没更新路线图的情况下加第五个。
- 早期 B-011 设计稿里写的 "`historyRef + hvoIndex + contentHash`" 已被实际落地的派生键**替代**。不要再把 `hvoIndex` 塞回组合键 —— index 会随装饰性列表抖动漂移（`historyRef` 自身也还不是内容哈希，原因见上面"已知边界"#2）。

---

## 3. Stage 3b · Experience Phase 0 · Action Path Replay

- **层**：`E`（读 `M`）
- **KPI**：`省 token` · `更快` · `懂用户`
- **优先级**：`P0` · **规模**：`L` · **依赖**：`Stage 3a`
- **状态**：**schema 已落、聚合器已落、读侧 MCP 工具已落；写侧 `experience_replay` v1 + `experience_score_step` v1 + 复合会话评分 已在 v2.4.0 (V24-01 / V24-02) 落地** —— `B-005`（schema）Sprint 2 落地；`B-012`（聚合器）+ `B-013` 的只读 `experience_suggest_plan` 已在 Sprint 3 落地；`experience_replay` v1（bridged、P1、capability-gated、仅 GitHub）2026-04-22 经 V24-01 落地；`experience_score_step` v1 + replay 引擎逐步写回钩子 + session-end 复合评分（按 `taskWeights` v1，写回失败采用隔离策略）2026-04-23 经 V24-02 落地；候选排序 / fallback ladder 仍在 pool（V24-03）。

### 范围

1. Schema：`experience_action_paths(page_role, intent_signature, step_sequence, success_count, failure_count, last_used_at, …)` + `experience_locator_prefs(page_role, element_purpose, preferred_selector_kind, preferred_selector, hit_count, …)`。—— `B-005` 落地。
2. **聚合器**（`B-012`，done）：扫描 `memory_sessions.status ∈ {completed, failed, aborted}` 且 `aggregated_at IS NULL`；join `memory_tasks` 取 intent；按 `step_index` 读 `memory_steps`；投影到 `experience_action_paths`。重复运行不会二次计数。
3. `memory_sessions.aggregated_at` 列通过 guarded migration 加（SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`）。
4. MCP 工具：`experience_suggest_plan(intent, pageRole?, limit?) → ExperienceActionPathPlan[]` 已在 `B-013` 落地（P0 只读、native-handled，不走扩展桥；按 `success_count` → 净成功数 → 最近使用 → 确定性 ID 排序）。`experience_replay(actionPathId, variableSubstitutions, targetTabId, maxSteps) → ExperienceReplayResult` 已在 **V24-01（v2.4.0）** 落地：bridged 工具，`P1` + `requiresExplicitOptIn` + 新 capability `experience_replay`；支持步骤集合限定为 `chrome_click_element` / `chrome_fill_or_select`；变量替换白名单 = `['queryText','targetLabel']`；聚合器对 `experience_replay:<actionPathId>` 类 task intent 走特殊路径，把 success/failure delta 投影回原始 Experience 行。`experience_score_step({actionPathId, stepIndex, observedOutcome, historyRef?, replayId?, evidence?}) → TabrixExperienceScoreStepResult` 已在 **V24-02（v2.4.0）** 落地：native（非 bridged）工具，`P1` + `requiresExplicitOptIn`；**复用** `experience_replay` capability（不新开钥匙——按 Policy 决定，捕获/使用绑定）；step 级 outcome → `success_delta`/`failure_delta` 投影统一收敛在 `ExperienceRepository.recordReplayStepOutcome` 单一来源；`experience_replay` 引擎本身在每一步执行后也调用同一条写回钩子（V24-01 的会话现在能自动累计 success/failure 计数）；session-end 复合评分（确定性、按 `taskWeights` v1、按 `EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS` 做 recency decay）由 aggregator 在 replay session 上写入。SQLite 写失败采用 **隔离** 策略，写入新表 `experience_writeback_warnings`，replay 路径绝不会被 I/O 抖动卡住——参见 `.claude/handoffs/` 下的 V24-02 失败处理契约。
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
- ✅ `B-EXP-REPLAY-V1` —— `experience_replay` v1 **已在 v2.4.0 (V24-01, 2026-04-22) 落地**：bridged MCP 工具 + capability gate + 聚合器特殊路径 + chooser 分支。2026-04-23 锁定的 owner 决策按原样落地；详见 `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` §10 与 `.claude/handoffs/v2_4_0_v24_01_experience_replay_v1.md`。真实浏览器验收场景（`t5-G-experience-replay`）走 `tabrix-private-tests` 的兄弟 PR。

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
- **状态**：v1 已完成（2026-04-22，V23-03）—— `B-015` v1 已端到端落地。详见上方 §"V23-03 / B-015 —— Markdown 渲染路径 + L2 source routing 已落地（2026-04-22）"。剩余 pool 工作：`agentStep` JSON schema 发布（范围 3）与 `memory_page_snapshots.readable_markdown` 懒列（范围 2）。

### 范围

1. `chrome_read_page(render = 'json' | 'markdown')` —— 默认保持 `json`；无 break change。**v1 已落地（2026-04-22）。**
2. `memory_page_snapshots.readable_markdown` 列（懒计算）。_Pool —— v1 未落地。_
3. 可选：`agentStep` envelope JSON schema 发到 `packages/shared/src/`，方便 MCP 客户端在 prompt 里引用。_Pool —— v1 未落地。_

### 非范围

- HTML → markdown 规则超越已有 `get_web_content` 的范围。
- 新加一个 MCP 工具。
- 改默认 render。

### DoD

- `render='markdown'` 跑通；GitHub 基线上 p95 token 数比 `render='json'` 低 ≥ 40%。
- Snapshot 稳定：同一页面两次拿 `render='markdown'` 字节一致（同 `contentHash` → 同 bytes）。
- `pnpm --filter @tabrix/extension test` 至少加 5 个测试。

### 关联 `B-*`

- ✅ `B-015` v1 —— `read_page(render='markdown')` + 单测于 2026-04-22 落地（V23-03）。范围 2（snapshot 列）与范围 3（`agentStep` envelope 发布）仍为 pool。

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
- **状态**：`v1 done (2026-04-22)` —— `B-016`。v1 只落了枚举 + env 解析；按工具粒度的 capability 注解、`TABRIX_POLICY_ALLOW_P3` ↔ `TABRIX_POLICY_CAPABILITIES` 迁移都明确推迟，让 v1 紧贴 `B-017` 这一刀。

### 范围

1. `TabrixCapability` 枚举（v1：`api_knowledge`；未来 `vision | elevated_js | download | devtools | testing | cross_origin_nav` 等会按 feature 单独追加，**不**做大爆炸式重命名）。
2. 每个 P2/P3 工具显式声明所需 capability（`tools.ts`）。**已推迟 —— 与 v1 正交；v1 这层 gate 是 feature 级（如 API Knowledge 捕获），不是 tool 级。**
3. env：`TABRIX_POLICY_ALLOW_P3` → `TABRIX_POLICY_CAPABILITIES`（保持 6 个月以上兼容）。**已推迟 —— v1 把 `TABRIX_POLICY_CAPABILITIES` 当成额外开关、与 `TABRIX_POLICY_ALLOW_P3` 并行运行；尚未做迁移 / 弃用通道。**
4. `MemoryAction.policyCapabilities` 字段（给 Insights tab 和未来审计用）。**已推迟。**
5. 为 Stage 4b 的 origin/siteId 动态策略留接口（保留不实现）。**已推迟。**

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
- **状态**：`v1 done (2026-04-22)` —— `B-017`。v1 落地的是 **GitHub-first、仅捕获**；`knowledge_call_api`、Sidepanel 按站 toggle、JSON-Schema 推断、跨站点覆盖都明确**不在 v1**，仍留在 pool。

### v1 落地 (2026-04-22)

- 新增 `knowledge_api_endpoints` 表（幂等 migration；按 `(site, endpoint_signature)` 去重，`sample_count` / `first_seen_at` / `last_seen_at` 维护溯源）。
- 纯转换器在 `app/native-server/src/memory/knowledge/api-knowledge-capture.ts`：覆盖 9 类 GitHub family（issues / pulls / actions runs / actions workflows / search/issues / search/repositories / repo metadata + 各 `:number` / `:run_id` 详情），加 `unclassified` 兜底，但 redaction 一视同仁。
- 通过新的 `chrome_network_capture` post-processor 接入 —— **MCP 表面零变更**、扩展层零变更。捕获受 `api_knowledge` capability 控制，默认关。
- 硬性 PII 保证（在三层上回归测试 —— 纯转换器、仓库、post-processor）：永不持久化原始 header value、cookie、query value、request body value、response body 文本。只存 header _名_、query _键_、body _键_、`hasAuth` / `hasCookie` 布尔标记，以及粗粒度的响应 shape 描述。

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

- ✅ `B-017` v1 —— 仅捕获、GitHub-first、capability gate、PII-safe（2026-04-22 落地）。剩余 v2（call 层、JSON-Schema 推断、Sidepanel 按站 toggle、其他站点）仍在同一个 `B-017` 名下；排到 v2 时再单独拆 sub-ID。

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
- **状态**：v1 最小切片 2026-04-22 落地 —— `B-018`（规则版 selector 作为 native `tabrix_choose_context` 接入；详见 `docs/B_018_CONTEXT_SELECTOR_V1.md`）。完整 Stage 3h DoD（决策表、telemetry、多站点）仍在 pool。

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

- 🟡 `B-018` —— `tabrix_choose_context` v1 最小切片落地（规则版选择器，GitHub-first，三策略）；seed 决策表 + 多站点仍未做。详见 `docs/B_018_CONTEXT_SELECTOR_V1.md`。

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

1. `B-015` 后续项 —— Stage 3d 范围 2 + 3（`memory_page_snapshots.readable_markdown` 懒列 + `agentStep` envelope JSON schema 发布）。`B-015` v1（`render='markdown'` 参数本体）已于 2026-04-22 落地（V23-03），只剩可选的持久化 + envelope 尾巴。
2. `B-018` v2 —— 在 v1 选择器之上完成 Stage 3h 完整 DoD（现已可消费 `B-011` 的稳定 `targetRef`）。
3. Stage 3a 后续项 —— `candidate-action.ts` 的 UI Map 消费切换（Stage 3a item 6，`B-011` 留下来的尾巴）。
4. Stage 3b 写侧后续项 —— `experience_replay` v1 **已在 v2.4.0 (V24-01) 落地**；`experience_score_step` + 复合会话评分 **已在 v2.4.0 (V24-02, 2026-04-23) 落地**（capability 复用 + 写回隔离）；候选排序 / fallback ladder（V24-03）仍是后续项。

`B-011` v1 已于 2026-04-22 落地（HVO 稳定 `targetRef` 端到端：扩展端产出 `tgt_<10-hex>`，click 桥经 per-tab registry 还原 stable→snapshot ref，真实浏览器黄金链路 `T5-F-GH-STABLE-TARGETREF-ROUNDTRIP` 已绿）。

`B-016` / `B-017` v1 已于 2026-04-22 落地（仅捕获、GitHub-first、受 capability gate 控制）。`B-017` v2（call 层 / JSON-Schema 推断 / Sidepanel 按站 toggle）**暂不**进入下个 sprint 候选 —— 等 `B-018` 把读侧需求验出来再排。

---

## 21. Changelog

| 版本     | 日期       | 变更                                                                                                                                                                                                                                                                    |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v1.0.0` | 2026-04-21 | 首份仓库内集中化 Stage 级路线图。取代 [`MKEP_STAGE_3_PLUS_ROADMAP.md`](./MKEP_STAGE_3_PLUS_ROADMAP.md) 的路线图部分（老文档保留作历史参考）。覆盖 `Stage 3a → 5e`（17 个 Stage），含 DoD + `B-*` 映射。                                                                 |
| `v1.1.0` | 2026-04-22 | `B-016` + `B-017` v1 落地 —— capability gate（`TABRIX_POLICY_CAPABILITIES=api_knowledge`）+ GitHub-first 仅捕获 API Knowledge。v2（`knowledge_call_api` / Sidepanel 按站 toggle / 跨站点 / JSON-Schema 推断）明确推迟。Stage 3f / Stage 3g 章节同步 v1-vs-future 差异。 |
