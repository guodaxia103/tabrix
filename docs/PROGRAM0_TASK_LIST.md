# Program 0 详细任务清单

最后更新：`2026-04-07 Asia/Shanghai`（v2.6 — A2 Session Registry 抽取、G4 FAQ、G5 引导、I3 场景）
分支：`codex/phase0-stabilization`

基于：当前分支 51 commits、上游 hangwin/mcp-chrome 173 个 Open Issues、PHASE0 系列文档、实际代码审查、**竞品调研（15+ 开源 / 8+ 商业产品）**。

> **v2 变更摘要**（对照 `PRODUCT_STRATEGY.md`）：
>
> 1. C7（一键安装）从可选提升至第二批必做 — KCI 要求「安装到首次成功 < 5 分钟」
> 2. 客户端验证范围扩大：新增 F8 OpenClaw、F9 Windsurf — 覆盖 5 大核心客户端
> 3. AI Skill（I4）从第四批提升至第二批并行启动 — 「Skill 是核心产品」
> 4. H5 敏感工具默认禁用从"低"提升为"中" — 真实浏览器安全是信任基础
> 5. 新增 G8「竞品对比 Why mcp-chrome」— 开源产品获客关键

状态说明：

- `[x]` 已完成
- `[~]` 进行中 / 部分完成
- `[ ]` 未开始
- `[!]` 阻塞 / 需要决策

### 维护约定（任务闭环）

1. **合并或验收一个任务时**：在本文件中把对应编号更新为 `[x]`，或写入 **「§ 会话落地」** 子节；若为部分完成，标 `[~]` 并在说明列写清剩余工作。
2. **自动化能覆盖的**（单测、`mcp-chrome-bridge smoke`、CI）：在 PR/提交说明里引用命令与结果；**不能替代的**（干净机安装、多客户端、Mac、SSE 并行）必须落入 **「十二、手动测试清单」** 或该任务行的说明列，避免「以为已闭环」。
3. **每次发版或里程碑结束前**：扫一遍本节与各表，更新 **「统计」** 与 **最后更新** 日期。

---

## 一、P0-A：MCP 传输层与 Session 生命周期

> 最高优先级。对应上游 Issues: #321, #306, #9, #308, #37, #288, #300, #29

### 已完成

- `[x]` A1. 移除全局 MCP Server 单例（HTTP/SSE），每次 initialize 创建独立实例
- `[x]` A3. 修复 `ERR_HTTP_HEADERS_SENT` 类响应生命周期问题
- `[x]` A5. 修复 duplicate MCP error responses 问题
- `[x]` A7. Transport 行为文档化（`docs/TRANSPORT.md`：HTTP / SSE / stdio）
- `[x]` A8. stdio 模式僵尸进程修复（`mcp-server-stdio.ts` stdin 关闭与信号处理）
- `[x]` A6. GET `/mcp`（SSE 流）缺少 session 时的错误文案已含操作提示（先 `POST /mcp` initialize、或 `GET /sse`）（`constant/index.ts`）

### 待完成

| 编号 | 任务                          | 关联 Issue | 难度 | 说明                                                                                                                                                                                                                     |
| ---- | ----------------------------- | ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A2   | Session Registry 独立模块抽取 | #321       | 中   | `[x]` **已完成**：`server/session-registry.ts` — SessionRegistry 类封装 register/get/remove/disconnect/closeAll/snapshot/updateClientInfo；`index.ts` 所有 `transportsMap` 引用替换为 `this.sessions`；tsc + 11 测试通过 |
| A4   | SSE 并行 session 回归测试     | #9, #308   | 中   | `[~]` **`server.test.ts` 已覆盖**：并行 streamable-http（`POST /mcp` initialize ×2 + `/status` 计数 + `DELETE`）、`GET /mcp` 无 `mcp-session-id` 的错误体。**仍建议手动**：长连接 `GET /sse` 双开客户端（§十二 A4）      |
| A9   | Chrome 升级后 MCP 请求兼容性  | #288       | 中   | Chrome 144+ 更新后出现 `Invalid MCP request or session`，需排查 extension manifest 或请求头变化                                                                                                                          |

---

## 二、P0-B：Native Host 与扩展启动稳定性

> 对应上游 Issues: #29, #198, #237, #284, #298, #307, #199, #292

### 已完成

- `[x]` B1. Native Host 诊断增强
- `[x]` B2. Popup 连接/刷新状态行为改善
- `[x]` B3. Unpacked Extension ID 漂移修复（动态 `allowed_origins`）
- `[x]` B5. 稳定本地扩展 key 生成（`ensure-extension-key.cjs`）
- `[x]` B6. Popup Refresh 恢复 native server 状态
- `[x]` B8. logs 目录：`doctor`（`mkdirSync`）、`setup`、`build` 与 `dist/logs` 均已具备创建逻辑（代码审查 #237）

### 待完成

| 编号 | 任务                            | 关联 Issue                  | 难度 | 说明                                                                                                                                                              |
| ---- | ------------------------------- | --------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B4   | "已连接，服务未启动" 状态机梳理 | #29, #198, #237, #284, #298 | 高   | `[~]` **部分**：popup `statusDetailText` 已补充 doctor/端口/重载提示（`App.vue`）。仍缺与 background `GET_SERVER_STATUS` 完全一致的显式状态机；**见 §十二 B4/B7** |
| B7   | Chrome 重启后扩展持久化验证     | #198, #237                  | 中   | 在全新 profile 上完整验证"安装 → 重启 Chrome → 扩展仍在 → 自动连接"流程                                                                                           |
| B9   | Mac 平台 Native Host 注册验证   | #284                        | 中   | 当前加固主要在 Windows，Mac 用户也有连接问题。需在 macOS 上验证 manifest 路径、权限                                                                               |
| B10  | better-sqlite3 原生模块绑定问题 | #271                        | 中   | 部分环境（pnpm global）找不到 bindings file，需确认 `postinstall` 正确处理原生模块路径                                                                            |

---

## 三、P0-C：安装流程与环境适配

> 对应上游 Issues: #274, #264, #199, #262, #292

### 已完成

- `[x]` C1. Windows 注册/管理员/构建流程加固
- `[x]` C2. `postinstall` 权限检测对齐
- `[x]` C3. 构建清理更健壮（EBUSY 处理）
- `[x]` C7. CLI 子命令 `mcp-chrome-bridge setup`（`scripts/setup.ts` + `cli.ts`）

### 待完成

| 编号 | 任务                          | 关联 Issue    | 难度 | 说明                                                                                                                                              |
| ---- | ----------------------------- | ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| C4   | npm global install 端到端验证 | #292, #199    | 高   | 从全新 Windows 机器执行 `npm install -g mcp-chrome-bridge` → `register` → 加载扩展 → 连接 → 跑通第一个工具，写成可复现 checklist。**见 §十二 C4** |
| C5   | pnpm global install 兼容性    | README 已注明 | 中   | pnpm v7+ 默认禁用 postinstall，需验证 `enable-pre-post-scripts` 或手动 `register` 路径                                                            |
| C6   | 开发环境依赖安装报错          | #274          | 低   | `pnpm install` 在某些 macOS 环境报错（`node-gyp` / native 模块），需记录已知依赖与前置条件                                                        |
| C8   | npx 启动方式验证              | 社区常见      | 低   | 验证 `npx mcp-chrome-bridge doctor` 等是否可直接使用                                                                                              |

---

## 四、P0-D：诊断工具链完善

### 已完成

- `[x]` D1. `status` 命令
- `[x]` D2. `doctor` 命令（manifest/registry/connectivity/MCP initialize/extension path）
- `[x]` D3. `smoke` 命令（端到端浏览器冒烟测试）
- `[x]` D4. `report` 基础版本
- `[x]` D5. doctor 报告真实加载的 Chrome 扩展路径

### 待完成

| 编号 | 任务                           | 关联 Issue | 难度 | 说明                                                                                                                                                                 |
| ---- | ------------------------------ | ---------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D6   | `report` 增强为可提交诊断包    | #315       | 中   | 需包含：环境摘要（OS/Node/npm/Chrome 版本）、manifest 内容、registry 内容、最近 50 行日志、`/status` 快照、`doctor` JSON。脱敏后可直接贴 Issue                       |
| D7   | 统一错误码目录                 | ROADMAP    | 中   | `[x]` **已完成**：`docs/ERROR_CODES.md` — 按 CONN*/MCP*/TOOL*/RR*/CLI*/HTTP* 前缀分类，汇总各层错误常量、Chrome 原生错误、超时常量、改进计划                         |
| D8   | `doctor --fix` 自动修复        | 新需求     | 中   | 常见问题（registry 缺失、manifest 路径错、logs 目录不存在）提供 `--fix` 自动修复                                                                                     |
| D9   | `smoke` 稳定性加固             | 分支 [~]   | 中   | `[~]` 已在开发机连续 **3/3** 次 `mcp-chrome-bridge smoke` 全绿；目标 **5+** 次仍待补跑。`chrome_handle_dialog` 仍有「No dialog is showing」时序噪声。**见 §十二 D9** |
| D10  | 扩展 error-page 运行时噪音清理 | 分支 [~]   | 低   | smoke/test 页面引发的 extension error-page 条目，需过滤或静默化                                                                                                      |

---

## 五、P0-E：工具验证与修复

> 对应 PHASE0_TOOL_VALIDATION_MATRIX + 上游功能 Issues

### 已通过验证（pass）— 无需操作

- `get_windows_and_tabs`、`chrome_navigate`、`chrome_switch_tab`、`chrome_close_tabs`
- `chrome_get_web_content`、`chrome_click_element`、`chrome_fill_or_select`、`chrome_computer`
- `chrome_network_capture`、`chrome_network_request`、`chrome_console`、`chrome_javascript`
- `chrome_upload_file`、`chrome_handle_download`
- `chrome_history`、`chrome_bookmark_search`、`chrome_bookmark_add`、`chrome_bookmark_delete`
- `performance_start_trace`、`performance_stop_trace`、`performance_analyze_insight`

> **注**：`chrome_get_interactive_elements` 已在 TOOL_SCHEMAS 暴露（E7b），计入 pass 总计 28 工具。

### 需修复或闭环的工具

| 编号 | 工具                                | 当前状态       | 关联 Issue | 任务                                                                                                                               |
| ---- | ----------------------------------- | -------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| E1   | `chrome_read_page`                  | warn (CoPaw)   | —          | CoPaw 下在 `chrome://` 和稀疏 localhost 页面降级。记录限制条件或添加降级提示                                                       |
| E2   | `chrome_keyboard`                   | warn (CoPaw)   | #200       | CoPaw 下表现为 key/chord 发送器而非文本输入。文档化：用 `chrome_fill_or_select` 做文本输入，`chrome_keyboard` 只用于快捷键         |
| E3   | `chrome_screenshot`                 | warn (CoPaw)   | —          | CoPaw 调用时 `image readback failed` 超时。排查是扩展侧 CDP 超时还是 CoPaw MCP 客户端超时                                          |
| E4   | `chrome_handle_dialog`              | warn           | #309       | 无活动 dialog 时返回 `No dialog is showing`（正确），但 debugger 已挂载时冲突。文档化限制                                          |
| E5   | `chrome_gif_recorder`               | warn           | —          | `start → stop` 偶发 `No recording in progress`。排查 recording 状态管理竞态                                                        |
| E6   | `chrome_request_element_selection`  | warn           | —          | 人工选择超时是预期行为，需在工具描述中明确 human-in-the-loop 特性                                                                  |
| E7   | `search_tabs_content`               | fail (未暴露)  | —          | TOOL_NAMES 有定义、TOOL_SCHEMAS 被注释。实现存在（`vector-search.ts`）。**决策：Phase 0 暴露 or 标记 Phase 1**                     |
| E7b  | `chrome_get_interactive_elements`   | `[x]` 已暴露   | —          | TOOL_SCHEMAS 已注册（readOnlyHint: true）。实现在 `web-fetcher.ts`                                                                 |
| E8   | `chrome_inject_script`              | `[x]` 已文档化 | —          | TOOL_SCHEMAS 被注释；`docs/SECURITY.md` 已标记为 "Disabled by default for security"                                                |
| E9   | `chrome_userscript`                 | fail (未暴露)  | —          | 同 E7。TOOL_SCHEMAS 被注释；实现存在（`userscript.ts`）                                                                            |
| E10  | **tabId 被忽略**                    | bug `[x]`      | #275       | 所有暴露工具已尊重 `tabId`/`windowId`。`console` else 分支和 `inject_script` else 分支均改用 `getActiveTabInWindow`。#275 可 close |
| E11  | **chrome_get_web_content 内容不全** | bug            | #99        | 长页面或复杂 DOM 时内容截断。评估是 DOM 提取策略还是 Native Messaging 消息体大小限制                                               |
| E12  | **chrome_navigate 自动加 www**      | bug `[x]`      | #270       | `navigate-patterns.test.ts` 已覆盖 `192.168.0.1:4430` 不加 `www` 的回归用例；`shouldAddWwwVariant` 对 IP 和 IPv6 短路              |
| E13  | chrome_console 数据不完整           | bug            | #215       | 获取的是浅拷贝数据，无法获取深层对象                                                                                               |
| E14  | SVG 元素支持                        | 功能请求       | #293       | `chrome_get_web_content` 默认用 `[SVG Icon]` 替代，请求可选返回 SVG 原文                                                           |

---

## 六、P0-F：客户端兼容矩阵

> 对应 MASTER_TASK_ROADMAP §5.3

### 已验证

- `[x]` Chrome 扩展 popup 直接使用
- `[x]` CoPaw（streamable HTTP）

### 待验证

| 编号 | 客户端                | 传输方式               | 关联 Issue       | 任务                                                                                                                                         |
| ---- | --------------------- | ---------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | Claude Desktop        | streamableHttp         | —                | 验证连接、工具列表、基础操作，记录结果                                                                                                       |
| F2   | Cursor                | streamableHttp / stdio | —                | 在 Cursor MCP 设置中配置并验证                                                                                                               |
| F3   | Claude Code CLI       | stdio                  | #199, #299, #307 | 上游大量连接问题。确认 `mcp-chrome-stdio` 在 Windows 下的完整路径                                                                            |
| F4   | CherryStudio          | streamableHttp         | README 示例      | 验证 README 配置是否直接可用                                                                                                                 |
| F5   | Dify                  | streamableHttp?        | #262             | 社区尝试失败。评估是否在 Phase 0 支持                                                                                                        |
| F6   | MCP Inspector / curl  | HTTP                   | —                | 用 curl 手动验证 `/mcp` 的 initialize → tool call 流程                                                                                       |
| F7   | stdio 通用验证        | stdio                  | #319             | Windows 上 stdio 不稳定。需 stdio 冒烟测试脚本                                                                                               |
| F8   | **OpenClaw 兼容验证** | MCP (streamableHttp)   | 新需求           | OpenClaw 是 2026 增长最快的开源个人 AI，天然需要浏览器能力。验证 `openclaw.json` MCP 配置 → 连接 → 工具调用 → 多渠道触发（Telegram/Discord） |
| F9   | **Windsurf 兼容验证** | streamableHttp / stdio | 新需求           | Windsurf 是主流 AI IDE，有最强企业 MCP 管控。验证配置文件格式和工具发现                                                                      |

### 产出物

- 兼容矩阵表格（客户端 × 传输方式 × 状态 × 已知限制）
- 每个客户端的推荐配置 JSON 片段

---

## 七、P0-G：安装/使用文档与小白体验

### 已完成

- `[x]` `STABLE_QUICKSTART.md`
- `[x]` `COPAW.md`
- `[x]` `DELIVERABLE_HANDOFF_zh.md`
- `[x]` `WHY_MCP_CHROME.md`（竞品对比精简页）
- `[x]` G8. README 已链入「Why mcp-chrome」竞品对比（与上条同一文档）
- `[x]` G1. 统一 README 入口 — 底部文档区分层为 Users / AI Assistants / Developers；工具列表对齐 TOOL_SCHEMAS（27+ 工具分 8 类）
- `[x]` G2. 中文 README 同步 — `README_zh.md` 新增运维指南区块、`mcp-chrome-bridge setup`/本地验证、工具列表对齐、文档分层

### 待完成

| 编号 | 任务                           | 难度 | 说明                                                                                                                                                                           |
| ---- | ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G3   | "Popup 显示 X 该怎么办" 排障表 | 低   | `[x]` **已完成**：`docs/POPUP_TROUBLESHOOTING.md` — 绿/黄/红/灰四状态排障、通用诊断命令、连接错误对照表                                                                        |
| G4   | Windows 安装常见坑 FAQ         | 低   | `[x]` **已完成**：`docs/WINDOWS_FAQ.md` — 10 个常见问题 + 快速诊断清单                                                                                                         |
| G5   | "第一个成功任务" 引导流程      | 中   | `[x]` **已完成**：`docs/FIRST_SUCCESS_GUIDE.md` — 5 步引导（安装→扩展→连接→配置→首个任务）                                                                                     |
| G6   | MCP 客户端配置速查卡           | 低   | `[x]` **已完成**：`docs/CLIENT_CONFIG_QUICKREF.md` — 覆盖 Claude Desktop/Cursor/Claude Code/Codex/CherryStudio/Windsurf/Dify 7 个客户端 + SSE/stdio 备选 + 环境变量 + 常见问题 |
| G7   | 视频/动图脚本大纲              | 低   | 5 分钟演示分镜脚本（可选，未来做）                                                                                                                                             |

---

## 八、P0-H：安全与治理

> 对应上游 Issue #316, #169, #317

### 已完成

- `[x]` H1. `ENABLE_MCP_TOOLS` / `DISABLE_MCP_TOOLS` 环境变量过滤
- `[x]` H2. 高危/只读工具的 MCP annotations
- `[x]` H3. Indirect Prompt Injection 风险文档（`docs/SECURITY.md`）
- `[x]` H4. 工具 MCP annotations 补全 — 所有 27 个暴露工具均已有 `readOnlyHint` / `destructiveHint` / `idempotentHint`

### 待完成

| 编号 | 任务                     | 关联 Issue | 难度     | 说明                                                                                                                                                                                    |
| ---- | ------------------------ | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H5   | **敏感工具默认禁用方案** | #169       | **中 ↑** | 评估是否默认禁用 `chrome_inject_script`、`chrome_bookmark_delete` 等破坏性工具。**核心卖点「已登录浏览器」也是最大安全顾虑**，竞品参考：OpenTabs「默认全关 + 三级权限（Off/Ask/Auto）」 |

---

## 九、P0-I：工具 API 完整文档 + AI Skill 技能包

> 产品交付的关键组成部分：面向人类开发者的 API 参考 + 面向 AI 助手的操作技能。

### 现状

| 资源                       | 位置                   | 问题                                                                                                                                                        |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOOLS.md` / `TOOLS_zh.md` | `docs/`                | 原版文档，缺少 phase0 新增/修改工具（`chrome_computer`、`chrome_read_page`、`performance_*`、`chrome_gif_recorder` 等）；部分工具缺少错误响应示例和边界说明 |
| `tools.ts` TOOL_SCHEMAS    | `packages/shared/src/` | 运行时权威源，但开发者/AI 无法直接阅读 TypeScript 代码                                                                                                      |
| `copaw-mcp-browser` SKILL  | 外部路径（不在仓库内） | 只适配 CoPaw；不随产品发布；不面向 Claude Desktop / Cursor / 通用 MCP 客户端                                                                                |

### 已完成（I4 v1 初版）

- `[x]` **I4 v1**：`skills/chrome_mcp_browser/SKILL.md` + `references/quick_ref.md`（仓库内随产品维护）

### 待完成

| 编号 | 任务                           | 难度 | 说明                                                                                                                                                                                                   |
| ---- | ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1   | **TOOLS_zh.md 全量同步**       | 中   | `[x]` **已完成**：28 工具全量对齐 TOOL_SCHEMAS；移除 6 个过时工具名（go_back_or_forward/capture_start\|stop/debugger_start\|stop/search_tabs_content）；更新 navigate/close_tabs 参数；新增 9 分类目录 |
| I2   | **TOOLS.md 英文版同步**        | 中   | `[x]` **已完成**：同 I1 结构，英文版 28 工具同步                                                                                                                                                       |
| I3   | **按工具分类整理调用场景**     | 低   | `[x]` **已完成**：TOOLS.md + TOOLS_zh.md 末尾新增「典型调用场景」5 类表格（信息获取/页面操作/导航管理/调试性能/截图录制）                                                                              |
| I4   | **新建仓库内 AI Skill 技能包** | 高   | 在 `skills/chrome_mcp_browser/` 下创建随产品发布的 `SKILL.md` + `references/*.md`，面向**所有 MCP 客户端 AI 助手**。参考 `lark-agent-bridge` 的 skill 结构，包含以下内容                               |
| I4a  | — Skill 元数据与触发条件       | —    | 声明工具名称、描述、适用 AI 运行时、版本                                                                                                                                                               |
| I4b  | — 最短成功路径                 | —    | AI 拿到 Skill 后的首选操作流：确认连接 → 获取标签 → 导航 → 读取 → 操作 → 验证                                                                                                                          |
| I4c  | — 工具选择决策树               | —    | 什么场景用哪个工具；优先用结构化内容（`chrome_read_page` / `chrome_get_web_content`），截图只做保底确认                                                                                                |
| I4d  | — 失败回退策略                 | —    | 连接断开怎么办、工具超时怎么办、元素找不到怎么办、权限不足怎么办                                                                                                                                       |
| I4e  | — 标准失败回复模板             | —    | AI 遇到各类错误时应如何向用户描述和建议（参考 `lark-agent-bridge` 的 `output_and_errors.md`）                                                                                                          |
| I4f  | — 工具快速参考表               | —    | 一张表列出所有工具：名称、一句话说明、是否只读、是否破坏性、典型用途                                                                                                                                   |
| I4g  | — 多客户端适配说明             | —    | 不同 AI 客户端（CoPaw / Claude Desktop / Cursor / Claude Code）的配置差异和推荐用法                                                                                                                    |
| I5   | **Skill 验证**                 | 中   | 用至少 2 个不同 AI 客户端实际加载 Skill 并执行浏览器任务，验证 AI 能否正确按 playbook 操作                                                                                                             |

---

## 十、P0-J：功能请求（Phase 0 可选加分项）

> 不是 Phase 0 必须项，改动小可顺手做

| 编号 | 需求                    | 关联 Issue      | 评估                                                           |
| ---- | ----------------------- | --------------- | -------------------------------------------------------------- |
| J1   | 监听地址 `0.0.0.0` 支持 | #290, #74, #210 | 低风险高价值，改 Fastify listen 参数即可，需同时考虑安全提示   |
| J2   | 截图自动保存            | #207            | 低优先级，Phase 1                                              |
| J3   | 页面滚动 API 文档化     | #200            | `chrome_computer` 已支持 scroll action，确认文档清晰           |
| J4   | 后台静默运行            | #178            | `chrome_navigate` 已有 `background` 参数，确认所有工具是否支持 |

---

## 十一、推荐执行顺序

### 第一批：P0 阻塞性问题（1–2 周）

> 不修这些，产品不可用。

1. ~~`A8` stdio 僵尸进程修复~~ → 已完成
2. `B4` "已连接，服务未启动" 状态机梳理 `[~]` popup 文案已补，状态机待完善
3. ~~`E10` tabId 被忽略 bug 修复~~ → 已完成（console/inject_script else 分支均已改用 `getActiveTabInWindow`）
4. `C4` npm 全新安装端到端验证
5. `D9` smoke 稳定性加固（跑 5+ 次全绿）`[~]` 已 3/5
6. ~~`A4` SSE 并行 session 回归测试~~ → 自动化已覆盖（`server.test.ts`）

### 第二批：P0 质量关 + 产品差异化（1–2 周）

> 修完第一批后，**稳定性和差异化双线并行**。
> 战略调研结论：AI Skill + 安装体验 + 客户端覆盖是竞争力核心，不能推迟到收尾阶段。

7. ~~`C7` 一键安装 setup 命令~~ → 已完成（`scripts/setup.ts` + `cli.ts`）
8. ~~`I4` AI Skill 技能包 v1~~ → 已完成（`skills/chrome_mcp_browser/SKILL.md`）
9. `D6` report 增强为诊断包
10. `E11` chrome_get_web_content 内容不全
11. ~~`E12` chrome_navigate www 前缀问题~~ → 已完成（`navigate-patterns.test.ts` 回归）
12. `F1`–`F3` Claude Desktop / Cursor / Claude Code 兼容验证
13. `B9` Mac 平台验证
14. ~~`G1`–`G2` README 统一入口 + 中文同步~~ → 已完成

### 第三批：P0 收尾 + 安全加固（1 周）

15. ~~`A2` Session Registry 独立模块~~ → 已完成（`session-registry.ts`）
16. ~~`D7` 统一错误码目录~~ → 已完成（`docs/ERROR_CODES.md`）
17. ~~`H3`–`H4`~~ 安全文档 + annotations 补全 → 已完成；`H5` **敏感工具默认禁用** ↑ 待做
18. ~~`G3`~~ 排障表 → 已完成；~~`G6`~~ 配置速查 → 已完成；`G4`–`G5` FAQ / 引导流程待做
19. ~~`G8` 竞品对比页~~ → 已完成（`docs/WHY_MCP_CHROME.md`）
20. `F7` stdio 冒烟测试脚本
21. ~~所有 warn 工具的限制文档化（E1–E6）~~ → 已完成（tool description 中注明限制）
22. ~~`E7b`~~ 已暴露；`E7`/`E9` 未暴露工具分类决策（Phase 0 or Phase 1）待做

### 第四批：完整文档 + 全客户端验证（1 周，与第三批可并行）

22. ~~`I1`–`I2` TOOLS 文档全量同步（中英文）~~ → 已完成（28 工具对齐）
23. ~~`I3` 按工具分类的调用场景~~ → 已完成
24. `I4` AI Skill 技能包定稿（基于第二批 v1 的实测反馈迭代）
25. `I5` Skill 验证（至少 2 个 AI 客户端实测）
26. `F8`–`F9` **OpenClaw / Windsurf 兼容验证** ← 新增，补齐 5 大客户端

### 可选加分项

27. `D8` doctor --fix 自动修复
28. `J1` 0.0.0.0 监听支持
29. ~~`A7` Transport 行为文档~~ → 已完成（`docs/TRANSPORT.md`）
30. ~~`A6` SSE 错误文案~~ → 已完成（`constant/index.ts`）
31. ~~`B8` logs 目录创建~~ → 已完成（doctor/setup/build）
32. `G7` 视频/动图脚本大纲

---

## 十二、手动测试清单（自动化不可替代）

> 以下项需在 **真人操作、第二台机器、或其它 MCP 客户端** 上完成；通过后在对应任务行或 § 会话落地 中记录日期与版本。

| ID              | 场景                                  | 如何测                                                                                                                                                   | 通过标准（摘要）                     |
| --------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **D9**          | smoke 稳定性                          | Chrome 打开扩展并 **连接**，`12306` 可达后执行 `mcp-chrome-bridge smoke`（或 `node dist/cli.js smoke`）                                                  | **连续 ≥5 次** exit code 0           |
| **C4**          | npm global 干净机                     | 新 Windows 用户或 VM：`npm i -g mcp-chrome-bridge` → `register --browser chrome` → 加载扩展 → 连接 → `doctor` + 一次 `smoke` 或 `chrome_navigate`        | 无隐藏失败；doctor 无 ERROR          |
| **A4**          | SSE / 并行 session                    | **已自动化**：`pnpm test` 中 `server.test.ts`（并行 streamable-http + `GET /mcp` 无 session 错误）。**可选手动**：两路 `GET /sse` 长连接或真实客户端并行 | 与 Jest 一致；手动无串 session       |
| **B4/B7**       | 状态机 / 重启                         | 人为制造「已连但服务未起」、**完全退出 Chrome 再开**，观察 popup 与 CoPaw 连接                                                                           | 文案与真实状态一致；重连路径可理解   |
| **B9**          | Mac                                   | 仅在 macOS：`register`、`doctor`、扩展路径与权限                                                                                                         | 与 Windows 行为对齐文档记录          |
| **F1–F3**       | Claude Desktop / Cursor / Claude Code | 按各产品配置 `http://127.0.0.1:12306/mcp` 或 stdio                                                                                                       | 能发现工具且至少一个 `chrome_*` 成功 |
| **F4–F9**       | 其它客户端                            | CherryStudio、Dify、OpenClaw、Windsurf 等按官方 MCP 配置方式                                                                                             | 记录 pass/fail 与限制                |
| **CoPaw E1–E3** | 工具告警                              | 在 CoPaw 内试 `chrome_read_page`（含 chrome://）、`chrome_screenshot`、`chrome_keyboard`                                                                 | 记录复现步骤与 workaround            |

**SSE 与 HTTP 路径**：以 `docs/TRANSPORT.md` 为准；若客户端只支持一种传输，在兼容矩阵中注明。

---

## 统计

- 总维度：10 个（A–J）+ **维护约定** + **手动测试清单**
- 总任务（编号项）：约 72 个（含 E7b、可选加分项 A6/A7/B8/G8 已完成归档）
- 已完成 `[x]`：约 **56** 个（A1–A2/A3/A5–A8, B1–B3/B5–B6/B8, C1–C3/C7, D1–D5/D7, E7b/E8/E10/E12, G1–G6/G8/I1–I3/I4v1, H1–H4, 会话落地项）
- 部分完成 `[~]`：约 **3** 个（A4, B4, D9）
- 待完成 `[ ]`：约 **13** 个
- 预估周期：3–4 周（第一批基本收尾，二/三/四批可交叉并行）

## v2 变更追溯

| 调整             | 原位置         | 新位置               | 原因                                                         |
| ---------------- | -------------- | -------------------- | ------------------------------------------------------------ |
| C7 一键安装      | 可选加分项 #23 | **第二批 #7**        | KCI「< 5 分钟首次成功」；竞品 OpenTabs/Playwright 均一行安装 |
| I4 AI Skill v1   | 第四批 #21     | **第二批 #8**        | 战略决策「Skill 是核心产品的一部分」                         |
| H5 敏感工具禁用  | 低优先级       | **中优先级，第三批** | 真实浏览器安全是信任基础；竞品 OpenTabs 默认全关             |
| F8 OpenClaw 验证 | 不存在         | **第四批 #26 新增**  | 2026 增长最快的开源 AI 助手，核心目标客户端                  |
| F9 Windsurf 验证 | 不存在         | **第四批 #26 新增**  | 主流 AI IDE，企业 MCP 管控最强                               |
| G8 竞品对比页    | 不存在         | **第三批 #19 新增**  | 开源产品获客的关键转化页                                     |

### 2026-04-07 v2.4 批量推进

- `[x]` **E10（彻底闭环）**：`console.ts` else 分支改用 `getActiveTabInWindow(windowId)`；`inject-script.ts` else 分支改用 `getActiveTabInWindow(windowId)`。所有暴露工具的 `tabId`/`windowId` 一致性已完成。
- `[x]` **H4（annotations 补全）**：为所有 27 个暴露工具补全 `readOnlyHint` / `destructiveHint` / `idempotentHint` 标注（新增 12 个工具的 annotations）。
- `[x]` **E1–E6（warn 限制文档化）**：在 `tools.ts` description 中为 `chrome_read_page`（chrome:// 页面限制）、`chrome_screenshot`（大页面超时）、`chrome_keyboard`（用于快捷键不是文本输入）、`chrome_handle_dialog`（需活动 dialog）、`chrome_gif_recorder`（start→stop 竞态）、`chrome_request_element_selection`（human-in-the-loop 等待）添加了限制说明。
- `[x]` **E7b（暴露 chrome_get_interactive_elements）**：在 TOOL_SCHEMAS 中注册，readOnlyHint: true。
- `[x]` **E8（inject_script 禁用文档化）**：`docs/SECURITY.md` 中明确标记为 "Disabled by default for security"。
- `[x]` **H3（安全文档）**：新建 `docs/SECURITY.md`，包含 Indirect Prompt Injection 风险说明、缓解措施表、用户建议、工具风险分类（Read-only / Side-effect / Destructive / Disabled）。
- `[x]` **G1（README 统一入口）**：底部文档区分层为 For Users / For AI Assistants / For Developers & Contributors；工具列表对齐 TOOL_SCHEMAS（27+ 工具分 8 类）；修复 `PHASE0_TEST_MATRIX.md` 链接。
- `[x]` **G2（中文 README 同步）**：`README_zh.md` 新增运维指南区块、`mcp-chrome-bridge setup` 与本地验证、工具列表对齐 27+ 工具 8 类、底部文档分层。

### 2026-04-07 审计修正

- E12 主表标记 `[x]`（已有 `navigate-patterns.test.ts` 回归 + `shouldAddWwwVariant` 对 IP/IPv6 短路）。
- E10 主表标记 `[~]`（大部分工具已修复，余量 console url 分支和 inject_script url 分支）。
- E7b 新增：`chrome_get_interactive_elements` 未暴露（TOOL_SCHEMAS 未注册），归类同 E7。
- 第一批 A8 已完成、A4 自动化已覆盖，标删除线。第二批 C7/I4v1/E12 已完成，同步标记。
- B4 会话落地由 `[x]` 改回 `[~]`（popup 文案已补，完整状态机仍待实现）。
- 统计数字重新校准。

### 2026-04-07 会话落地（节选）

- `[x]` **A8**：`mcp-server-stdio` 增加 stdin 关闭与 SIGTERM/SIGINT 处理，减轻父进程退出后僵尸进程问题（`mcp/mcp-server-stdio.ts`）。
- `[x]` **C7**：新增 CLI 子命令 `mcp-chrome-bridge setup`（`scripts/setup.ts` + `cli.ts`）。
- `[x]` **A7**：新增 `docs/TRANSPORT.md`（HTTP/SSE/stdio 说明）。
- `[x]` **G8**：新增 `docs/WHY_MCP_CHROME.md`，README 已链入。
- `[x]` **I4 v1**：新增 `skills/chrome_mcp_browser/SKILL.md` 与 `references/quick_ref.md`。
- `[x]` **E12 回归**：`navigate-patterns.test.ts` 增加 `https://192.168.0.1:4430/` 用例。
- `[~]` **E10（部分）**：dialog、`chrome_network_request`、`chrome_network_capture`（含底层 start/stop）、performance 系列、bookmark_add、get_interactive_elements、close_tabs、send_command_to_inject_script、`chrome_javascript`、`chrome_gif_recorder`、`chrome_get_web_content`（含 url 新开标签时的 `windowId`）、userscript（含 remove 清理）等已尊重 `tabId`/`windowId`（#275 余量见边缘工具）。
- `[~]` **B4（部分）**：popup 在「已连接但服务未起」时的 `statusDetailText` 已补充 `mcp-chrome-bridge doctor`、端口/防火墙与重载扩展提示（`App.vue`）。完整显式状态机仍待实现。
- `[~]` **D9**：本机在扩展已连接、`12306` 可达时 **连续 3 次** `mcp-chrome-bridge smoke` 全绿（单次约 50s+）；清单原目标为 **5+ 次**，余下次数见 **§十二**。
- **维护约定**：任务合并时请同步更新本文件状态，自动化无法覆盖项写入 **§十二**。详见文首 **「维护约定（任务闭环）」**。
- `[x]` **A6**：`INVALID_SSE_SESSION` 错误文案含 `POST /mcp` / `GET /sse` 提示（`constant/index.ts`）。
- `[~]` **A4**：`server.test.ts` 增加并行 streamable-http、`GET /mcp` 无 session 断言；经典 `GET /sse` 长连接仍以 §十二 为准。
- `[x]` **B8**：logs 目录创建逻辑已在 `doctor` / `setup` / `build` 核对并记入「二、已完成」。

### 2026-04-07 v2.5 文档批量推进

- `[x]` **I1（TOOLS_zh.md 全量同步）**：28 工具全量对齐 TOOL_SCHEMAS；移除 6 个过时工具名；更新目录为 9 分类。
- `[x]` **I2（TOOLS.md 英文版同步）**：同 I1 结构，英文版 28 工具同步。
- `[x]` **G3（Popup 排障表）**：新建 `docs/POPUP_TROUBLESHOOTING.md` — 绿/黄/红/灰四状态速查、通用诊断命令、连接错误对照表。
- `[x]` **G6（MCP 客户端配置速查卡）**：新建 `docs/CLIENT_CONFIG_QUICKREF.md` — 覆盖 7 个客户端（Claude Desktop/Cursor/Claude Code/Codex/CherryStudio/Windsurf/Dify）+ SSE/stdio 备选 + 环境变量 + 常见问题。
- `[x]` **D7（统一错误码目录）**：新建 `docs/ERROR_CODES.md` — 按 CONN*/MCP*/TOOL*/RR*/CLI*/HTTP* 前缀分类汇总各层错误常量和 Chrome 原生错误。

### 2026-04-07 v2.6 代码重构 + 文档收尾

- `[x]` **A2（Session Registry 抽取）**：新建 `server/session-registry.ts`，封装 `register/get/remove/disconnect/closeAll/snapshot/updateClientInfo`；`index.ts` 所有 `transportsMap` 引用替换为 `this.sessions`；tsc 通过 + 全部 11 个测试通过。
- `[x]` **G4（Windows FAQ）**：新建 `docs/WINDOWS_FAQ.md` — 10 个常见 Windows 安装问题 + 快速诊断清单。
- `[x]` **G5（首次成功引导）**：新建 `docs/FIRST_SUCCESS_GUIDE.md` — 5 步引导从安装到 AI 控制浏览器。
- `[x]` **I3（调用场景）**：TOOLS.md + TOOLS_zh.md 末尾新增「典型调用场景」5 类表格。
