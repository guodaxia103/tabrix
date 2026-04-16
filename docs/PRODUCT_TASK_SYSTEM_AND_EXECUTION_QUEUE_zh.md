# Tabrix 产品任务系统与连续执行队列

最后更新：`2026-04-16 Asia/Shanghai`
适用项目：`Tabrix`
文档编号：`TPM-2026-001`
文档版本：`v2026.04.16.1`
文档状态：`active`
飞书留档：`https://www.feishu.cn/docx/KTrod3bQGoGZCfxPGsNckLoNnrd`

---

## 1. 文档目标

本文档用于统一管理 `Tabrix` 的产品任务、文档版本、执行状态与留档规则，确保后续：

1. 本地有一份可版本化、可追踪的主文档
2. 飞书有一份同步留档版本
3. `Codex` 能按统一任务规格连续执行，不因上下文变化而跑偏
4. 每完成一个任务后，都有明确的文档更新动作，而不是只改代码不留痕

---

## 2. 文档管理原则

作为合格的高级产品经理，`Tabrix` 后续文档管理默认遵守以下原则：

1. **本地与飞书双留档**
   - 本地 `md` 是可版本化主文档
   - 飞书文档是团队协作与长期归档版本

2. **任务、状态、版本三件事分开管理**
   - 任务按能力池组织
   - 状态按执行进度组织
   - 版本号按发布与文档更新组织

3. **文档必须跟随任务变化更新**
   - 新增任务要补文档
   - 任务完成后要改状态
   - 任务边界变化后要补版本说明

4. **不能只管理“计划”，还要管理“完成后的留痕”**
   - 完成了什么
   - 验证了什么
   - 影响了哪些版本
   - 下一步接什么任务

---

## 3. 文档版本规则

### 3.1 任务主文档版本号

本主文档版本采用：

`vYYYY.MM.DD.N`

示例：

- `v2026.04.15.1`
- `v2026.04.15.2`

含义：

- `YYYY.MM.DD`：文档更新日期
- `N`：当日第几次正式更新

### 3.2 何时必须升版本

以下场景必须升文档版本号：

1. 新增任务
2. 删除任务
3. 任务优先级变化
4. 任务范围、验收标准、版本归属发生变化
5. 有任务状态从 `todo` 变成 `in_progress`、`done`、`blocked`
6. 补充了真实验收、发布条件、风险结论

### 3.3 版本记录要求

每次更新主文档时，必须同步补一条版本记录，至少包含：

- 更新时间
- 更新人/执行者
- 变更摘要
- 受影响任务

---

## 4. 任务状态规则

### 4.1 统一状态值

所有任务统一使用以下状态：

- `todo`：尚未开始
- `in_progress`：正在执行
- `done`：已完成并通过当前验收
- `blocked`：被真实问题阻塞
- `deferred`：明确延后
- `dropped`：明确取消

### 4.2 Blocker / Target / Stretch

这是版本级别，不是执行状态：

- `Blocker`：不完成不能进入目标版本
- `Target`：本版本希望完成，但不绝对阻塞发版
- `Stretch`：有价值，但可后置

---

## 5. 每完成一个任务后必须做什么

后续 `Codex` 或其它执行者每完成一个任务，产品文档管理必须同步完成以下动作：

1. 更新本地主文档中的任务状态
2. 在任务下补充：
   - 完成日期
   - 主要改动
   - 验收结果
   - 风险与未完成项
   - 下一任务建议
3. 更新文档版本号
4. 同步飞书文档
5. 如果任务影响发布：
   - 补 release note 候选项
   - 补 compatibility / acceptance / checklist 对应文档

### 5.1 任务完成记录模板

每个任务完成后，建议至少补以下字段：

```md
完成记录：
- 完成时间：
- 执行者：
- 主要改动：
- 验收结果：
- 风险/遗留：
- 下一任务建议：
```

---

## 6. 飞书留档规则

后续 `Tabrix` 的任务计划管理和产品文档默认同步到飞书。

飞书留档规则：

1. 本地主文档是源文档
2. 飞书文档是协作留档副本
3. 每次主文档有正式版本更新时，同步飞书
4. 飞书文档标题建议带版本号或日期
5. 如果飞书已有同名主文档，优先更新而不是重复创建

推荐飞书文档标题：

`Tabrix 产品任务系统与连续执行队列 v2026.04.15.1`

当前飞书文档：

- `https://www.feishu.cn/docx/KTrod3bQGoGZCfxPGsNckLoNnrd`

配套执行文档：

- 本地：`docs/PRODUCT_TASK_BOARD_AND_UPDATE_TEMPLATE_zh.md`
- 飞书：`https://www.feishu.cn/docx/Tx7Ed9rHsocadWxmWOdckPounrd`

配套决策文档：

- 本地：`docs/PRODUCT_DECISION_LOG_zh.md`
- 飞书：`https://www.feishu.cn/docx/HddFdfv9HovpeyxFQ2zcqSMVnxf`

Codex 提示词文档：

- 本地：`docs/CODEX_EXECUTION_PROMPTS_T1_T16_zh.md`
- 飞书：`https://www.feishu.cn/docx/BwXudPMOKoyNJrxSeHCcL955nuf`

版本装箱文档：

- 本地：`docs/PRODUCT_VERSION_PACKAGING_AND_RELEASE_PLAN_zh.md`
- 飞书：`https://www.feishu.cn/docx/RWZRdkKCAoX6U1x0eYzcT6XNn6b`

依赖与风险文档：

- 本地：`docs/PRODUCT_TASK_DEPENDENCY_AND_RISK_REGISTER_zh.md`
- 飞书：`https://www.feishu.cn/docx/FIgwdmErwoOSOdxPZ3LcIf8JnHd`

证据索引文档：

- 本地：`docs/PRODUCT_EVIDENCE_INDEX_AND_ACCEPTANCE_ASSETS_zh.md`
- 飞书：`https://www.feishu.cn/docx/BRLFdsyrLodZfQxeaYyczR24nLh`

AI Onboarding 文档：

- 本地：`docs/AI_ONBOARDING_QUICKSTART_zh.md`
- 飞书：`https://www.feishu.cn/wiki/VIp7wNPwmi0vh2kWURecBR2bnSg`

当前能力面与边界文档：

- 本地：`docs/CURRENT_CAPABILITIES_AND_BOUNDARIES_zh.md`
- 飞书：`https://www.feishu.cn/wiki/FHnSw3s0CiXTsTkL5H9cw0DfnOd`

代码入口与责任地图文档：

- 本地：`docs/CODE_ENTRYPOINTS_AND_OWNERSHIP_zh.md`
- 飞书：`https://www.feishu.cn/wiki/QSulwOEOWivre7klZ8Fc4hTJnDf`

---

## 7. Codex 任务规格统一模板

后续给 `Codex` 的所有任务，统一采用以下结构：

1. 任务标题
2. 任务背景
3. 任务目标
4. 范围内
5. 范围外
6. 具体执行项
7. 产品约束
8. 边界与异常
9. 验收标准
10. 交付物
11. 建议版本
12. 版本级别
13. 兼容性影响
14. 发布前必须验证项
15. 完成后下一任务建议

### 7.1 真实助手链路验证固定要求

涉及浏览器主链路的任务，默认要求至少包含一条真实验收路径：

`Codex -> Claude CLI -> Tabrix MCP 服务 -> 真实 Chrome`

该路径应作为正式验收，而不是临时测试说明。

---

### 7.2 AI 助手首次进入仓库的默认阅读顺序

后续任何 AI 助手第一次进入 `Tabrix` 仓库，默认按以下顺序建立上下文：

1. `AGENTS.md`
2. `docs/AI_ONBOARDING_QUICKSTART_zh.md`
3. `docs/AI_DEV_RULES_zh.md`
4. `README.md`
5. `docs/CURRENT_CAPABILITIES_AND_BOUNDARIES_zh.md`
6. `docs/CODE_ENTRYPOINTS_AND_OWNERSHIP_zh.md`

目的：

1. 不再让 AI 助手自己在十几份文档里盲猜阅读顺序
2. 先建立产品主线与边界，再进入代码定位
3. 降低“看过规则但没抓到业务上下文”的偏差

如果任务偏桥状态、恢复、客户端会话、状态真相源，再补读：

- `docs/BROWSER_BRIDGE_STATE_DESIGN_zh.md`
- `docs/PROJECT_STRUCTURE_zh.md`
- `docs/PROJECT_REVIEW_2026Q2.md`

---

## 8. 连续执行总任务总表

### 8.1 Blocker

| 编号 | 标题 | 建议版本 | 当前状态 |
|------|------|----------|----------|
| T1 | 主线连接方式与客户端会话模型收口 | v2.0.9 | done |
| T2 | 助手命令恢复链路 | v2.0.9 | todo |
| T3 | 核心 browser tool 统一保护协议 | v2.0.9 | todo |
| T4 | 真实验收门禁化 | v2.0.9 | todo |
| T5 | Codex 客户端一等接入 | v2.0.9 | todo |
| T6 | 第三方复用矩阵与 NOTICE 流程 | v2.0.9 | done |
| T7 | 真实 MCP E2E fixture 站点与回归框架 | v2.0.9 | todo |

### 8.2 Target

| 编号 | 标题 | 建议版本 | 当前状态 |
|------|------|----------|----------|
| T8 | DOM 脱水与极简 JSON 树输出 | v2.1.0 | todo |
| T9 | DOM artifact 接入 execution session | v2.1.0 | todo |
| T10 | locator 排名 / fallbackChain / fingerprint | v2.1.0 | todo |
| T11 | URL Experience Memory v1 | v2.1.0 | todo |
| T12 | 失败流程 replay artifact | v2.1.0 | todo |
| T13 | nightly 稳定性与回归报告自动化 | v2.0.9 | todo |
| T14 | 智能助手退出默认产品面 | v2.0.x | todo |
| T15 | 工作流 UI 降级，保留 v3 内核 | v2.0.x | todo |

### 8.3 Stretch

| 编号 | 标题 | 建议版本 | 当前状态 |
|------|------|----------|----------|
| T16 | 本地模型 / 语义索引 / 向量搜索退场评估 | v2.0.x | todo |

### 8.4 推荐执行顺序

1. T6
2. T1
3. T2
4. T3
5. T4
6. T5
7. T7
8. T13
9. T8
10. T9
11. T10
12. T11
13. T12
14. T14
15. T15
16. T16

---

## 9. 详细任务卡

## T1 主线连接方式与客户端会话模型收口

- 目标：让 Popup 与服务端状态模型同时收口到统一口径：
  - 用户侧只看到 `stdio` 与 `远程（Streamable HTTP）` 两种正式连接方式
  - `远程（Streamable HTTP）` 成为默认主路径，并默认处于已开启、带鉴权令牌的安全可复制状态
  - 客户端列表不再展示原始 `Streamable HTTP` 会话堆积，而是展示“有效活跃客户端 / 活跃 MCP 会话”
- 范围内：
  - 去掉 Popup 顶层 `本机` 标签，将其收回为 `远程（Streamable HTTP）` 下的实现细节
  - 默认选中 `远程（Streamable HTTP）`
  - 服务可用后默认开启远程访问并确保 Token 已就绪
  - 重定义客户端列表语义，补 `lastSeenAt / state / recommended cleanup`
  - 定义 `active / stale / disconnected` 的最小状态规则与清理策略
  - 更新必要文档、文案、状态接口语义与验收口径
- 范围外：
  - 不新增 transport
  - 不扩展新 browser tool
  - 不改产品定位
  - 不做无关 UI 重构
- 产品约束：
  - 当前只承认 `stdio` 与 `Streamable HTTP` 两条 tier-1 transport
  - `本机 HTTP` 不再作为第三种产品模式对外暴露
  - 远程默认开启不能出现“无鉴权暴露窗口”
  - 客户端主列表必须表达“当前有效活跃客户端”，不能继续等同于原始 session dump
  - stale / disconnected 会话不能长期堆积在主列表
- 验收标准：
  - Popup 顶层只保留 `stdio` 与 `远程（Streamable HTTP）`
  - 默认打开 Popup 时进入 `远程（Streamable HTTP）`
  - 默认远程访问已开启，且 Token 已可用
  - 客户端列表展示的是有效活跃客户端，不是历史会话堆积
  - 手动断开的客户端不会继续留在主列表
  - stale 会话可自动清理或一键清理
  - 文档、UI 文案、状态接口语义一致
  - 包含真实助手链路验证
- 版本级别：`Blocker`
- 当前状态：`done`
- 最新执行进展：
  - `Codex CLI` 已完成首轮代码实现，包含 Popup 两模式收口、默认远程准备、客户端列表归并与服务端会话状态治理
  - 已完成 `typecheck`、`packages/shared build`、`test:core`
  - 已完成真实 Chrome 扩展挂载态下的 Popup 验证、真实客户端接入验证，以及一轮真实助手链路验证
  - 已完成两种正式连接方式验证：`stdio-smoke` 通过；带 Token 的 `Streamable HTTP smoke` 通过
  - 已完成客户端来源文案收口：`127.0.0.1` 不再直接暴露为原始 IP，默认显示为“本机 · HTTP（免 Token）”；单会话时不再重复显示 `1 个会话`
  - 运行态确认当前扩展与本机 MCP 服务均已切回当前仓库代码，`runtimeConsistency.verdict = consistent`
  - 已完成 Popup 默认只读状态收口：默认不再打开即重连，多 session 已降为次级诊断，真实 Popup 打开前后 `active/client` 对照保持不增长
  - 已完成泛客户端名展示优化：对 `mcp` 等通用上报名优先保留原名，必要时结合 `userAgent` 推断为更可理解的产品名，否则回落为中性 `MCP 客户端`
- 风险与遗留：
  - 浏览器内部页 / 扩展页上的内容脚本注入报错仍需在 `T3` 统一收口为结构化失败
  - 会话终态保留窗口内仍会在诊断视图看到 `disconnected` 记录，这是预期的次级诊断信息，不再计入主列表活跃客户端
- 下一任务建议：`T2 助手命令恢复链路`

## T2 助手命令恢复链路

- 目标：浏览器未启动、bridge 断开或 command channel 未就绪时，系统尽量自动恢复并继续执行同一请求。
- 范围内：
  - 按需拉起浏览器
  - bridge 自动重连或单步修复建议
  - tool call 前 readiness gate
  - MCP 服务侧可信桥接状态
- 范围外：
  - 不新增 transport
  - 不依赖助手脚本掩盖状态问题
  - 不在无浏览器任务时偷偷启动浏览器
- 产品约束：
  - 状态先于动作
  - 先观察，后恢复
  - MCP 服务为真相源
- 验收标准：
  - 浏览器关闭时，同一请求能恢复继续
  - bridge 断连时，可恢复或明确报错
  - `status/doctor/report` 可观察恢复状态
  - 包含真实助手链路恢复验证
- 版本级别：`Blocker`
- 当前状态：`todo`

## T3 核心 browser tool 统一保护协议

- 目标：所有核心 browser tool 在非 web 页面、页面未稳定、元素未命中等场景下返回统一、可解析、可恢复的结构化结果。
- 范围内：
  - 盘点核心工具保护与失败语义
  - 补齐统一 guard
  - 统一 `reason / pageType / recommendedAction / errorCode`
  - 区分 Safe / Assisted / Debugger 工具风险表达
- 范围外：
  - 不重写全部工具
  - 不扩展新工具
- 产品约束：
  - Safe Tools 是默认主能力面
  - Debugger Tools 不能伪装成普通能力
- 验收标准：
  - 非 web tab 场景统一结构化失败
  - 不再暴露注入噪音
  - page_not_ready / target_not_found 语义清晰
  - 包含真实助手链路验证
- 版本级别：`Blocker`
- 当前状态：`todo`

## T4 真实验收门禁化

- 目标：把真实助手验收升级成正式发布门禁，形成 `fast / full` 两级体系，并纳入第二个核心客户端。
- 范围内：
  - 固化 `fast / full`
  - 明确 `PR gate / nightly gate / release gate`
  - 规范验收产物和失败证据
  - 纳入第二个核心客户端
- 范围外：
  - 不一次覆盖所有客户端
  - 不把人工协作型能力计入无人值守通过率
- 产品约束：
  - 真实验收结果必须可解释、可复现
  - 不允许只验证“能连上”而不验证真实调用
- 验收标准：
  - `fast / full` 边界清楚
  - 至少两个客户端形成真实验收记录
  - release 候选版必须附带真实验收结论
- 版本级别：`Blocker`
- 当前状态：`todo`

## T5 Codex 客户端一等接入

- 目标：让 `Codex` 成为 Tabrix 的一等客户端，具备最短配置、明确验证路径、稳定错误提示和清晰文档。
- 范围内：
  - 梳理 Codex 当前接入方式
  - 输出最短配置
  - 补首个成功调用路径
  - 补排障说明和已知限制
  - 维护官方 `skills/tabrix_browser`
- 范围外：
  - 不改 Codex 产品本身
  - 不引入私有协议
- 产品约束：
  - 接入体验短、清楚、少隐藏前提
  - 配置示例必须可复制、可验证
- 验收标准：
  - 新用户可在 10 分钟内完成接入并跑通首个 tool call
  - Codex 在兼容矩阵中有明确结论
- 版本级别：`Blocker`
- 当前状态：`todo`

## T6 第三方复用矩阵与 NOTICE 流程

- 目标：建立第三方复用矩阵，并配套 NOTICE / 来源记录 / 设计参考记录流程。
- 范围内：
  - 整理重点参考项目复用分类
  - 建立许可证与 NOTICE 记录机制
  - 建立“代码复用 / 设计借鉴 / 禁止直接复用”模板
- 范围外：
  - 不实际引入第三方代码
  - 不做泛依赖审计
- 产品约束：
  - AGPL / 商业限制项目不能作为直接复制代码来源
  - 规则必须简单、可执行
- 验收标准：
  - 有明确复用矩阵
  - 三类边界清楚
  - 后续任务和 PR 可直接复用该规则
- 版本级别：`Blocker`
- 当前状态：`done`
- 完成记录：
  - 完成时间：`2026-04-15`
  - 执行者：`Codex CLI + 产品线程复核`
  - 主要改动：新增第三方复用矩阵、复用工作流、`docs/third-party/` 记录目录与 `NOTICE` 基线；将规则接入贡献指南、发布流程、发布前检查清单、PR 模板；从 `NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md` 回链到正式落地文档
  - 验收结果：`THIRD_PARTY_REUSE_MATRIX*`、`THIRD_PARTY_REUSE_WORKFLOW*`、`docs/third-party/README.md`、`NOTICE` 已落地；流程入口文件已能看到复用规则或检查项；本次为文档/流程改动，未运行自动化测试
  - 风险/遗留：当前只建立了仓库级基线，尚未把第三方复用检查接入 `release:check` 或 CI 自动阻断；`docs/third-party/` 目录目前只有模板和规则，后续真实复用任务仍需逐项补来源记录
  - 下一任务建议：`T1 双链路协议回归`

## T7 真实 MCP E2E fixture 站点与回归框架

- 目标：建立一套真正从 MCP 入口触发的 E2E fixture 站点与回归框架。
- 范围内：
  - 建立 fixture 页面/站点集合
  - 覆盖登录、表单、iframe、shadow DOM、延迟渲染、复杂表格
  - 建立从 MCP 入口触发的回归框架
- 范围外：
  - 不做云端大规模测试平台
  - 不一次覆盖全部客户端
- 产品约束：
  - 入口必须是真实 MCP，不允许只测内部函数
- 验收标准：
  - 真实 MCP E2E case 可稳定跑通
  - 能明确归因链路问题、工具问题、页面结构问题
- 版本级别：`Blocker`
- 当前状态：`todo`

## T8 DOM 脱水与极简 JSON 树输出

- 目标：将 `chrome_read_page` 升级为面向 AI 执行的结构化极简 JSON 树，并支持 `compact / normal / full`。
- 范围内：
  - 三档输出模式
  - 默认极简 JSON 树
  - 完整内容走 artifact
  - 动作相关节点优先
- 范围外：
  - 不迁移到 Python 管线
  - 不重做全部 tool schema
- 产品约束：
  - 默认输出必须显著降低 token 消耗
  - 不能牺牲关键操作信息
- 验收标准：
  - 三模式可用
  - token 成本明显下降
  - 与 click/fill 协同更稳定
- 版本级别：`Target`
- 当前状态：`todo`

## T9 DOM artifact 接入 execution session

- 目标：让结构化 DOM artifact 成为 execution session 正式组成部分，并被 result normalizer、回归报告和失败分析统一消费。
- 范围内：
  - DOM artifact 生成、挂载、引用
  - 与 session/result normalizer 打通
  - 为失败复盘与报告预留引用
- 范围外：
  - 不先做复杂 artifact UI
  - 不重构整个 session manager
- 产品约束：
  - artifact 要稳定、可诊断、便于报告消费
  - 不能把超大 DOM 默认塞进普通 tool result
- 验收标准：
  - DOM artifact 可正式挂入 execution session
  - result normalizer 能稳定返回 artifact 引用
- 版本级别：`Target`
- 当前状态：`todo`

## T10 locator 排名 / fallbackChain / fingerprint

- 目标：建立 locator 排名、fallbackChain 和 fingerprint 机制，提升 click/fill/read-page 的长期命中率与自愈能力。
- 范围内：
  - locator 候选集合
  - fallbackChain
  - fingerprint
  - 命中原因与置信度输出
- 范围外：
  - 不做完整 AI 自愈框架
  - 不替代现有 ref 机制
- 产品约束：
  - 优先强化 Safe Tools
  - 回退逻辑必须可解释
- 验收标准：
  - read-page / click / fill 可输出或消费 fallbackChain
  - 页面轻微变化后，一次命中率或 fallback 挽救率提升
- 版本级别：`Target`
- 当前状态：`todo`

## T11 URL Experience Memory v1

- 目标：基于 `record-replay v3` 沉淀同站点重复任务的可复用经验，优先复用历史成功链，降低 token 成本。
- 范围内：
  - 设计经验存储模型
  - 记录成功动作与失败恢复信息
  - 支持推荐与复用优先
- 范围外：
  - 不做全自动自学习发布系统
  - 不做复杂可视化产品
- 产品约束：
  - 首版以推荐与复用为主
  - 经验命中必须可解释
- 验收标准：
  - 同站点重复任务可优先尝试历史成功链
  - 至少一类任务 token 成本下降
- 版本级别：`Target`
- 当前状态：`todo`

## T12 失败流程 replay artifact

- 目标：为关键失败场景引入可复盘 replay artifact，并与 DOM artifact、截图、GIF 等证据统一成失败复盘链路。
- 范围内：
  - 失败场景 replay artifact
  - 与 session/report/evidence 链路打通
  - 优先失败，不做全量录制
- 范围外：
  - 不做全量 session replay 平台
  - 不做复杂播放器产品界面
- 产品约束：
  - 首版只做失败优先
  - 存储成本和隐私风险必须可控
- 验收标准：
  - 关键失败至少保留一种强证据
  - 至少一类失败可通过 replay 快速复盘
- 版本级别：`Target`
- 当前状态：`todo`

## T13 nightly 稳定性与回归报告自动化

- 目标：建立 nightly 稳定性与回归报告自动化，形成 `PR gate + nightly gate + release gate` 的持续质量闭环。
- 范围内：
  - nightly gate
  - 自动汇总主链路结果与失败证据
  - 输出统一 Markdown 报告
- 范围外：
  - 不搭建复杂外部监控平台
  - 不做花哨仪表盘优先于可读报告
- 产品约束：
  - 报告适合人读，也适合 AI 消费
  - 失败必须附证据引用
- 验收标准：
  - nightly 报告可自动生成
  - 主链路回归结果可稳定汇总
  - 报告能直接定位失败 case 与证据
- 版本级别：`Target`
- 当前状态：`todo`

## T14 智能助手退出默认产品面

- 目标：将扩展内智能助手降级为 `experimental` 或开发者模式能力，降低对外承诺，减少对主线干扰。
- 范围内：
  - 调整默认产品位
  - 增加 experimental/dev-mode gating
  - 同步收缩对外文档承诺
- 范围外：
  - 不要求立即删除全部代码
  - 不重做 agent 子系统
- 产品约束：
  - 对外表达必须诚实
  - 不影响主线浏览器能力
- 验收标准：
  - 默认产品面不再突出智能助手
  - 对外文档不再把它当主能力承诺
- 版本级别：`Target`
- 当前状态：`todo`

## T15 工作流 UI 降级，保留 v3 内核

- 目标：退出未成熟 workflow UI 默认产品面，只保留稳定能力和内部调试入口，继续投资 `record-replay v3` 内核。
- 范围内：
  - 移除或隐藏默认 workflow UI 产品位
  - builder 改为内部/调试入口
  - 对外只保留稳定能力面
- 范围外：
  - 不删除 `record-replay v3` 内核
  - 不立即重写 workflow UI
- 产品约束：
  - 用户不应再看到半成品承诺
  - 主线表达回到“真实 Chrome + MCP + 稳定执行”
- 验收标准：
  - 默认产品面不再暴露未成熟 workflow UI
  - `record-replay v3` 内核能力不受影响
- 版本级别：`Target`
- 当前状态：`todo`

## T16 本地模型 / 语义索引 / 向量搜索退场评估

- 目标：对本地模型 / 语义相似度 / 内容索引 / 向量搜索相关能力做系统性评估，产出保留、降级、删除结论，并完成最小产品面收缩。
- 范围内：
  - 盘点相关代码、依赖、入口、文档、测试
  - 输出保留 / 降级 / 删除三类结论
  - 如适合，完成最小默认入口收缩
- 范围外：
  - 不粗暴删除全部代码
  - 不影响主链路
- 产品约束：
  - 任何结论都必须服务主线
  - 对外文档必须与实际能力一致
- 验收标准：
  - 有正式退场评估结论
  - 默认产品面不再突出低 ROI 能力
  - 主链路回归不受影响
- 版本级别：`Stretch`
- 当前状态：`todo`

---

## 10. 后续执行规则

后续所有任务执行默认采用以下流程：

1. 从本任务池中选择下一任务
2. 用统一任务规格生成给 `Codex` 的执行提示词
3. `Codex` 完成任务、测试、文档更新
4. 回写本地主文档
5. 同步飞书
6. 如影响版本发布，补对应 release / checklist / acceptance 文档

---

## 11. 版本记录

### v2026.04.16.1

- 将 `T1` 正式收口为 `done`
- 回写 `T1` 最终验收结果：`stdio-smoke`、带 Token 的远程 `smoke`、真实 Popup 打开前后活跃会话不增长
- 保持 `T2` 为 `todo`，不在本轮 `T1` 收口提交中提前切换状态

### v2026.04.15.11

- 新增 AI onboarding 文档索引
- 把 AI 首次入仓默认阅读顺序正式接入主任务系统文档
- 补齐本地与飞书链接闭环

### v2026.04.15.10

- 记录 `T1` 首轮代码实现已完成，但任务状态继续保持 `in_progress`
- 明确 `T1` 当前缺口为：真实 Chrome/扩展挂载态验证、真实客户端接入验证、真实助手链路验证

### v2026.04.15.9

- 将 `T1` 从“`双链路协议回归`”重写为“`主线连接方式与客户端会话模型收口`”
- 将 `T1` 状态从 `todo` 更新为 `in_progress`
- 将 `T1` 范围收口到：连接方式二元化、默认远程开启、客户端列表语义重定义、stale/disconnected 会话治理

### v2026.04.15.8

- 将 `T6` 状态从 `todo` 更新为 `done`
- 补充 `T6` 完成记录、验收结果、风险与下一任务建议
- 准备同步执行看板与证据索引中的 `T6` 完成留痕

### v2026.04.15.7

- 登记任务证据索引与验收资产目录
- 形成主文档、执行文档、决策日志、提示词文档、版本装箱文档、依赖风险文档、证据索引文档七件套

### v2026.04.15.6

- 登记任务依赖与风险清单
- 形成主文档、执行文档、决策日志、提示词文档、版本装箱文档、依赖风险文档六件套

### v2026.04.15.5

- 登记版本装箱与发布任务表
- 形成主文档、执行文档、决策日志、提示词文档、版本装箱文档五件套

### v2026.04.15.4

- 登记配套决策文档与 Codex 提示词文档
- 形成主文档、执行文档、决策日志、提示词文档四件套

### v2026.04.15.3

- 登记配套执行文档与飞书执行文档链接
- 明确主文档与执行文档的双文档关系

### v2026.04.15.2

- 补充飞书留档链接
- 明确本地文档与飞书文档的一一映射
- 当前飞书文档：`https://www.feishu.cn/docx/KTrod3bQGoGZCfxPGsNckLoNnrd`

### v2026.04.15.1

- 建立 `Tabrix` 产品任务系统主文档
- 收口文档管理规则、本地与飞书双留档规则、任务状态规则、任务完成后更新动作
- 整理 `T1-T16` 连续执行任务池
- 明确真实助手链路验证要求：`Codex -> Claude CLI -> Tabrix MCP 服务 -> 真实 Chrome`
