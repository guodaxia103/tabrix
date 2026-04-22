# Tabrix Policy Phase 0 — Risk Tiers & Explicit Opt-In

> Status: **In progress** (implementation landing on `feat/policy-phase-0-risk-tiers`)
> Version: v0.1 (design)
> Depends on: [ROADMAP.md](ROADMAP.md), Feishu wiki《Tabrix 记忆、知识、经验、规则能力规划 v2026.04.17.2》

## 1. 目标

本篇只覆盖 MKEP 中 **Policy（规则）** 层的 **Phase 0 最小闭环**。

### 1.1 本阶段范围内

- 给 Tabrix 所有 MCP 工具打上 `riskTier: P0 | P1 | P2 | P3` 分级标签
- 给 5 类**无条件高风险工具**（以及已有的 3 个 SENSITIVE 工具）统一上 `requiresExplicitOptIn: true`，默认对 AI 助手不可见、不可调用
- 在既有 MCP dispatch 层（`handleToolCall`）注入 Policy gate
- 返回结构化的 `TABRIX_POLICY_DENIED_P3` 失败 payload，给调用方明确的放行路径
- 前置声明 `needsUserConfirmation` 契约字段，供 Phase 1 Policy `confirm` 档消费

### 1.2 本阶段范围外（Phase 1+）

- Site / PageRole / Task / User-Team 级策略（需要 Memory + Knowledge 先落地）
- `confirm` / `suggest` 决策执行链路（需要客户端协议协作）
- 经验复用许可边界（依赖 Experience 层）
- 审计视图 / 团队治理（依赖 Memory 持久化 + 多租户模型）
- Dynamic flow tools (`flow.*`) 的 riskTier 继承（Phase 1 内补）

### 1.3 不可妥协的约束

- **向后兼容**：现有 `MCP_DISABLE_SENSITIVE_TOOLS` / `ENABLE_MCP_TOOLS` / `DISABLE_MCP_TOOLS` 环境变量必须继续工作
- **安全默认**：升级后默认行为**更严**（P3 opt-in 工具默认不可用），但提供清晰的 escape hatch（`TABRIX_POLICY_ALLOW_P3`）
- **不触动 T5 路线**：不碰 HVO 管线、record-replay、read-page 契约
- **无客户端修改要求**：Phase 0 不要求 MCP 客户端支持新字段（新字段作为 Tabrix 私有扩展，客户端忽略即可）

---

## 2. 风险分级（Risk Tiers）

依据 Feishu 文档《Tabrix 记忆、知识、经验、规则能力规划 v2026.04.17.2》第四节 Policy 一、动作风险等级：

| Tier   | 语义                                                                 | 默认策略                               | 典型 Tabrix 工具                                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0** | 只读：读页面、提取结构化数据、截图、列表浏览、打开详情页             | **自动执行**                           | `chrome_read_page`、`chrome_get_web_content`、`chrome_get_interactive_elements`、`chrome_screenshot`、`chrome_console`、`chrome_history`、`chrome_bookmark_search`、`get_windows_and_tabs`、`search_tabs_content`、`chrome_handle_download`（被动等待）、`chrome_request_element_selection`（human-in-loop 只读）、`performance_analyze_insight` |
| **P1** | 可逆：切换 tab、展开/折叠、排序/筛选、刷新页面、导航、性能追踪       | **自动执行 + 记录**                    | `chrome_switch_tab`、`chrome_navigate`、`chrome_network_capture`、`chrome_network_request`、`performance_start_trace`、`performance_stop_trace`、`chrome_gif_recorder`                                                                                                                                                                           |
| **P2** | 半敏感：填表单但不提交、点击按钮、模拟键盘、关 tab、改书签、上传文件 | **需站点/任务级放行**                  | `chrome_click_element`、`chrome_fill_or_select`、`chrome_keyboard`、`chrome_close_tabs`、`chrome_bookmark_add`、`chrome_handle_dialog`                                                                                                                                                                                                           |
| **P3** | 高风险：能执行任意操作，或已知"发布/删除/支付/投递"类                | **默认 block，必须 opt-in 或 confirm** | `chrome_javascript`、`chrome_computer`、`chrome_inject_script`、`chrome_send_command_to_inject_script`、`chrome_userscript`、`chrome_bookmark_delete`、`chrome_upload_file`                                                                                                                                                                      |

> **P2 的真实风险取决于动作目标在当前 pageRole 下是什么**（click "Filter" ≠ click "Publish"）。Phase 0 不做 target context 判定，全部默认 P2；Phase 1/2 会结合 Knowledge 层 pageRole + objectSubType 做细化。

### 2.1 Schema 约定

新增 Tabrix 私有工具注解扩展（不破坏 MCP 标准 `annotations`）：

```ts
// packages/shared/src/tools.ts
export type TabrixRiskTier = 'P0' | 'P1' | 'P2' | 'P3';

export interface TabrixToolPolicyAnnotations {
  /** Tabrix-level risk classification (MKEP Policy). */
  riskTier: TabrixRiskTier;
  /**
   * When true, this tool is hidden from listTools and rejected on callTool
   * unless the caller is in the explicit opt-in allowlist.
   */
  requiresExplicitOptIn?: boolean;
}
```

MCP 标准 `annotations` 里同时保留 `readOnlyHint / destructiveHint / idempotentHint`，不改动。

### 2.2 `needsUserConfirmation` 前置声明（Phase 1 消费）

Phase 0 先在 result contract 里占位，Phase 1 由 MCP 协议层消费：

```ts
export interface TabrixPolicyDecisionHint {
  /** True when Phase 1 determines the tool call needs user confirmation before executing. */
  needsUserConfirmation?: boolean;
  /** Human-readable reason if needsUserConfirmation=true. */
  confirmReason?: string;
}
```

Phase 0 **不设值**，只声明类型。

---

## 3. Explicit Opt-In 机制

### 3.1 P3 opt-in 名单（7 个工具）

| 工具名                                 | 原因                         | 历史                        |
| -------------------------------------- | ---------------------------- | --------------------------- |
| `chrome_javascript`                    | 任意 JS 执行                 | 已在 `SENSITIVE_TOOL_NAMES` |
| `chrome_computer`                      | 坐标级鼠标键盘，任意视觉操作 | **新增**                    |
| `chrome_inject_script`                 | 页面脚本注入                 | **新增**                    |
| `chrome_send_command_to_inject_script` | 与注入脚本通信               | **新增**                    |
| `chrome_userscript`                    | 用户脚本持久化执行           | **新增**                    |
| `chrome_bookmark_delete`               | 删除用户数据                 | 已在 `SENSITIVE_TOOL_NAMES` |
| `chrome_upload_file`                   | 上传本地文件到远端           | 已在 `SENSITIVE_TOOL_NAMES` |

### 3.2 Env-var 放行接口

新增一个 Tabrix 级策略环境变量：

```bash
# 默认：所有 7 个 P3 opt-in 工具被隐藏 + 调用拒绝
# 全量放行（回到 v2.1.x 行为）：
TABRIX_POLICY_ALLOW_P3=all

# 精细放行（仅允许特定工具）：
TABRIX_POLICY_ALLOW_P3=chrome_javascript,chrome_computer
```

### 3.3 与现有 env-var 的组合规则

按优先级从高到低：

1. `ENABLE_MCP_TOOLS` （明确白名单）仍然胜出——显式列出的 P3 工具放行
2. `DISABLE_MCP_TOOLS` （明确黑名单）仍然胜出——列出的工具被排除（即使是 P0 也会被排除）
3. `TABRIX_POLICY_ALLOW_P3=all` 或 `TABRIX_POLICY_ALLOW_P3=<list>` 放行对应 P3 工具
4. `MCP_DISABLE_SENSITIVE_TOOLS=true` 向后兼容：等价于默认 strict（无实际效果变化）
5. 默认（上述均未设置）：7 个 P3 opt-in 工具被隐藏 + 调用拒绝

### 3.4 决策流程图

```
callTool(name)
  │
  ├─ ENABLE_MCP_TOOLS set?
  │    └─ yes + name in list → ALLOW
  │    └─ yes + name NOT in list → DENY (tool_not_available)
  │
  ├─ DISABLE_MCP_TOOLS set + name in list → DENY (tool_not_available)
  │
  ├─ requiresExplicitOptIn(name)?
  │    └─ no → ALLOW
  │    └─ yes:
  │         ├─ TABRIX_POLICY_ALLOW_P3 includes name (or "all") → ALLOW
  │         └─ otherwise → DENY (TABRIX_POLICY_DENIED_P3)
  │
  └─ default → ALLOW
```

---

## 4. 错误 Payload 契约

Policy 拒绝时返回的结构化 payload：

```json
{
  "code": "TABRIX_POLICY_DENIED_P3",
  "message": "Tool \"chrome_javascript\" is classified as P3 (high risk) and blocked by default.",
  "riskTier": "P3",
  "requiresExplicitOptIn": true,
  "summary": "高风险工具已被 Tabrix Policy 默认拦截。",
  "hint": "如需放行，请在启动环境中设置 TABRIX_POLICY_ALLOW_P3 变量（例如 TABRIX_POLICY_ALLOW_P3=chrome_javascript 或 TABRIX_POLICY_ALLOW_P3=all）。",
  "nextAction": null
}
```

- **区分度**：与现有 `tool_not_available`（tool disabled）和 `TABRIX_TOOL_CALL_FAILED`（tool error）区分开，便于 AI 助手和客户端做 UX 对接
- **可学习**：payload 中 `riskTier` + `requiresExplicitOptIn` 字段是机器可读的，方便未来做"统一策略说明页"

---

## 5. 对现有用户的影响

### 5.1 会 break 的场景

- 用户此前依赖 `chrome_javascript` / `chrome_computer` / `chrome_inject_script` / `chrome_send_command_to_inject_script` / `chrome_userscript` 且未显式用 `ENABLE_MCP_TOOLS` 白名单
- 升级后这些工具默认不再对 AI 助手暴露

### 5.2 迁移路径

1. 用户设置 `TABRIX_POLICY_ALLOW_P3=all` 即可恢复旧行为
2. 推荐用户改用精细放行：仅允许自己真正需要的 P3 工具
3. 下一版 CHANGELOG / README 需显著标注

### 5.3 版本号

- Phase 0 作为 v2.2.0 发布（minor bump）：行为变化但无 API 不兼容，工具仍然存在仅被默认 gate 住
- 不是 major bump，因为：(a) API 契约不变 (b) 工具注解只是新增 (c) 提供明确 escape hatch

---

## 6. 实现计划（Phase 0）

| #   | 内容                                                                     | 文件                                            | 测试                             |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------- |
| 1   | `TabrixRiskTier` 类型 + `TabrixToolPolicyAnnotations`                    | `packages/shared/src/tools.ts`                  | -                                |
| 2   | 给 `TOOL_SCHEMAS` 每个工具加 `riskTier` + 必要时 `requiresExplicitOptIn` | `packages/shared/src/tools.ts`                  | `tools.policy.test.ts`（全覆盖） |
| 3   | 导出 `P3_EXPLICIT_OPT_IN_TOOLS` 常量                                     | `packages/shared/src/tools.ts`                  | 同上                             |
| 4   | Policy 模块：`isToolExplicitlyAllowed` / `buildPolicyDeniedPayload`      | `app/native-server/src/policy/phase0-opt-in.ts` | `phase0-opt-in.test.ts`          |
| 5   | `filterToolsByEnvironment` 增强 P3 过滤                                  | `app/native-server/src/mcp/register-tools.ts`   | `register-tools.policy.test.ts`  |
| 6   | `handleToolCall` 注入 Policy gate                                        | 同上                                            | 同上                             |
| 7   | 设计稿 & CHANGELOG 说明                                                  | `docs/POLICY_PHASE_0.md`、`CHANGELOG.md`        | -                                |

---

## 6.5 Phase 0 增量（v2.4.0 / V24-01）：第一个非 P3 的 `requiresExplicitOptIn` 工具

V24-01 (`experience_replay` v1) 引入了 Phase 0 第一个 **非 P3** 但仍需显式 opt-in 的工具，建立了**"capability-gated visibility"**模式与既有 P3 路径并行：

- **门控机制**：`experience_replay` 的 `riskTier = 'P1'`，但 `annotations.requiresExplicitOptIn = true`。它**不**进入 `P3_EXPLICIT_OPT_IN_TOOLS`（否则会被错误地按 P3 处理），而是登记到 `packages/shared/src/tools.ts` 的 `CAPABILITY_GATED_TOOLS: Map<string, TabrixCapability>` 中，映射到新加入的 capability `'experience_replay'`。
- **visibility 与 dispatch 都看 capability**：`app/native-server/src/mcp/register-tools.ts` 在 `filterToolsByPolicy` 之后再跑一次 `filterToolsByCapability(parseCapabilityAllowlist(env).enabled)`——`listTools` 与 `callTool` 两条路径都会读这一同一个 capability 集合（来自 `TABRIX_POLICY_CAPABILITIES`，token 形式 `experience_replay,api_knowledge` 或 `all`）。
- **拒绝码与 P3 区分**：capability 未启用时返回的失败码是 `'capability_off'`（不是 `TABRIX_POLICY_DENIED_P3`）。两个码故意分开，因为运维动作不同——`capability_off` 提示"在启动环境里把 capability 加进 `TABRIX_POLICY_CAPABILITIES`"，`TABRIX_POLICY_DENIED_P3` 提示"在启动环境里设置 `TABRIX_POLICY_ALLOW_P3`"。
- **被拒绝时不开 Memory session**：与 P3 拒绝路径一致，capability 拒绝在 dispatch 之前发生，不会写入任何 `memory_sessions` / `memory_steps`，避免污染 Experience 聚合。

这一模式为后续 P0/P1/P2 的可选高敏感工具（如未来的 `experience_score_step`、`knowledge_*` 写侧扩展）提供了独立于 P3 通道的可见性 + 调用门控；P3 通道继续承载"无条件高风险"工具。

---

## 7. Phase 1 预告（不在本篇范围）

Phase 1 会在本篇基础上扩展：

- 把 `needsUserConfirmation` / `confirmReason` 从占位变为 MCP 协议约定的返回字段
- 引入 P2 的动作级 target context 判定（依赖 Knowledge 层 pageRole + objectSubType）
- 引入 Memory 层对每次 Policy 判定的审计记录
- 把 Dynamic flow tools (`flow.*`) 的 riskTier 设为"录制时的最高步骤 tier"

---

## 8. Open Questions（留给 Phase 1 回答）

1. MCP 协议层 `confirm` 档的具体回传字段名和客户端介入通道——是否直接使用 `needsUserConfirmation: true` + 客户端 poll，还是设计独立的 `tools/confirm` 子协议？
2. 企业版 Policy override 的存储位置——本地 native-server 配置文件？远端管控平面？
3. `TABRIX_POLICY_ALLOW_P3` 是否需要细化为 `TABRIX_POLICY_ALLOW_P2` / `TABRIX_POLICY_ALLOW_P1_RECORDED` 等多级？
