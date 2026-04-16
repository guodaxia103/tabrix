# Tabrix T1-T16 Codex 执行提示词

最后更新：`2026-04-15 Asia/Shanghai`
适用项目：`Tabrix`
文档编号：`TPM-2026-003`
文档版本：`v2026.04.15.5`
文档状态：`active`

---

## 1. 文档说明

本文档汇总 `Tabrix` 连续执行任务池 `T1-T16` 的 `Codex` 可执行提示词。

用途：

1. 直接复制给 `Codex` 执行单个任务
2. 作为后续任务投喂模板的标准来源
3. 与主文档、执行看板一起构成完整的产品任务管理系统

配套文档：

- 主文档：`product-management/PRODUCT_TASK_SYSTEM_AND_EXECUTION_QUEUE_zh.md`
- 执行看板：`product-management/PRODUCT_TASK_BOARD_AND_UPDATE_TEMPLATE_zh.md`

统一规则：

1. 每次只投喂一个任务
2. `Codex` 必须先读代码和相关文档，再改代码
3. 所有关键改动都要补测试、验证和文档
4. 涉及浏览器主链路的任务，默认要求至少一条真实验收路径：
   - `Codex -> Claude CLI -> Tabrix MCP 服务 -> 真实 Chrome`

---

## 2. 统一投喂前缀

后续每次给 `Codex` 派活，建议统一先加这段：

```md
你正在执行 Tabrix 连续任务池中的一个任务。

通用执行要求：

- 先看代码和相关文档，再决定改动
- 只做本任务范围内的事，不顺手扩功能
- 做最小充分改动，不顺手重构无关模块
- 所有关键改动都要补最小必要测试或验证
- 所有对外行为变化都要补文档
- 最后输出：
  - 完成了什么
  - 没完成什么
  - 风险是什么
  - 实际跑了哪些验证
  - 下一任务建议是什么
```

---

## 3. T1-T16 执行提示词

## T1 主线连接方式与客户端会话模型收口

```md
任务标题：T1 主线连接方式与客户端会话模型收口

任务目标：
让 Popup 与服务端状态模型同时收口到统一口径：

- 用户侧只看到 `stdio` 与 `远程（Streamable HTTP）` 两种正式连接方式
- `远程（Streamable HTTP）` 成为默认主路径，并默认处于已开启、带鉴权令牌的安全可复制状态
- `localhost HTTP` 若继续存在，只能作为 `远程（Streamable HTTP）` 的本机实现细节，并明确区分“本机免 Token”与“远程需 Token”
- 客户端列表不再展示原始 `Streamable HTTP` session dump，而是展示“有效活跃客户端 / 活跃 MCP 会话”

范围内：

- 去掉 Popup 顶层 `本机` 标签，将其收回为 `远程（Streamable HTTP）` 下的实现细节
- 顶层只保留 `stdio` 与 `远程（Streamable HTTP）`
- 默认选中 `远程（Streamable HTTP）`
- 服务可用后默认开启远程访问并确保 Token 已就绪
- 明确 `localhost HTTP` 与局域网远程 HTTP 的展示与鉴权语义
- 重定义客户端列表语义，补 `lastSeenAt / state / cleanup`
- 定义 `active / stale / disconnected` 的最小状态规则与清理策略
- 更新必要文档、状态接口语义与验收口径
- 将真实助手链路验证纳入正式验收
- 收口 Popup 打开时的默认只读行为，取消默认自动重连
- 将 `2 个会话` 等底层 session 数降级为次级诊断信息
- 为 `mcp` 这类泛化客户端名建立更友好的展示与识别策略

范围外：

- 不新增 transport
- 不扩展新 browser tool
- 不改产品定位
- 不做无关 UI 重构

重点执行项：

- 阅读 Popup、status 接口、SessionRegistry、transport、CLI、error codes 相关文档和代码
- 梳理 Popup 当前 `本机 / stdio / 远程` 三模式与项目正式主线的冲突点
- 将 `本机` 从顶层产品模式中移除，保持本机 localhost HTTP 仅作为 `远程（Streamable HTTP）` 的实现细节或说明
- 将 `远程（Streamable HTTP）` 设为默认选中项，并确保远程开关、Token 和复制配置默认可用
- 明确并统一以下产品语义：
  - `本机 HTTP（免 Token）`
  - `远程 HTTP（需 Token）`
  - `stdio`
- 审查当前客户端列表数据来源，区分“原始 session 快照”和“有效活跃客户端”
- 为客户端列表定义并实现最小状态模型：
  - `active`
  - `stale`
  - `disconnected`
- 为 stale/disconnected 会话建立最小清理策略，至少满足：
  - 主列表只展示 active
  - 手动断开的条目不继续停留在主列表
  - stale 会话可以自动清理或一键清理
- 如同一客户端重复重连产生多条 session，优先实现归并或最小可理解展示，避免继续把 67 条原始 session 当成 67 个有效客户端
- `127.0.0.1` 的本机 HTTP 客户端不得被误表达为“远程客户端”；如 UI 需要展示来源，应优先语义化为“本机 · HTTP（免 Token）”
- 更新 README、transport、status、popup、troubleshooting 等必要文档或说明

产品约束：

- stdio 和 Streamable HTTP 是当前唯一 tier-1 transport
- `本机 HTTP` 不再作为第三种产品模式对外暴露
- `localhost HTTP` 仍可作为 `Streamable HTTP` 的本机实现细节存在，但仅限本机请求豁免 Token；非本机 HTTP 请求必须 Bearer 鉴权
- 远程默认开启不能出现“无鉴权暴露窗口”
- 客户端主列表必须表达“当前有效活跃客户端”，不能继续等同于原始 session dump
- UI 不能把 `127.0.0.1` 误导成“局域网远端客户端”
- 打开 Popup 默认应该是“观察状态”，不是“再次发起连接”
- 如果状态已健康，打开 Popup 前后不应凭空新增 session
- `sessionCount > 1` 应保留诊断价值，但不能长期污染主文案
- 对 `mcp` 这类通用名字，优先展示上报名；如语义过泛，再补次级来源说明，而不是伪造为 `codex/claude`
- 状态字段和 UI 文案必须可供人类和 AI 客户端共同理解
- 返回结构尽量向后兼容
- 不允许用临时脚本掩盖真实状态问题

发布前必须验证项：

- pnpm run typecheck
- pnpm run test:core
- Popup 两种模式验证
- 默认远程开启与 Token 就绪验证
- `localhost HTTP（免 Token）` 与远程 HTTP（需 Token）语义验证
- 客户端列表活跃/失效/手动断开治理验证
- 打开 Popup 前后 `status --json` 对照验证
- 多 session 弱化后的真实 UI 验收
- 一次真实客户端接入验证
- 一次真实助手链路验证：Codex -> Claude CLI -> Tabrix -> 真实 Chrome

完成后下一任务建议：
T2 助手命令恢复链路
```

## T2 助手命令恢复链路

```md
任务标题：T2 助手命令恢复链路

任务目标：
当浏览器未启动、bridge 断开或 command channel 未就绪时，系统尽量自动恢复，并让同一请求继续执行，而不是要求用户从头再来。

范围内：

- 按需浏览器拉起
- bridge 自动重连或单步修复建议
- tool call 前 readiness gate
- MCP 服务侧可信桥接状态
- 恢复链路状态快照、日志和对外可诊断输出

范围外：

- 不新增 transport
- 不依赖助手脚本掩盖状态问题
- 不在无浏览器任务时偷偷启动浏览器
- 不做云端编排系统

重点执行项：

- 阅读桥接状态机、transport、CLI、error codes、troubleshooting 相关文档和代码
- 梳理 daemon、browser process、native host、extension bridge、command channel 的状态源
- 明确哪些状态由 MCP 服务侧统一维护
- 在浏览器自动化 tool call 前统一增加 readiness gate
- 收口浏览器未运行、bridge 断开、command channel 未就绪的恢复路径
- 让 status/doctor/report 能观察恢复相关状态与结果

产品约束：

- 状态先于动作
- 先观察，后恢复
- 只有收到浏览器自动化任务时才允许启动浏览器
- MCP 服务为桥接状态真相源

发布前必须验证项：

- pnpm run typecheck
- pnpm run test:core
- 浏览器关闭场景恢复测试
- bridge 断连场景恢复测试
- command channel 未就绪场景测试
- 一次真实助手链路恢复验证

完成后下一任务建议：
T3 核心 browser tool 统一保护协议
```

## T3 核心 browser tool 统一保护协议

```md
任务标题：T3 核心 browser tool 统一保护协议

任务目标：
让所有核心 browser tool 在非 web 页面、页面未稳定、元素未命中、权限受限等场景下，返回统一、稳定、可供 AI 客户端消费的结构化结果，并与错误码目录、工具分层文档保持一致。

范围内：

- 盘点核心 browser tools 的保护与失败语义
- 补齐统一 guard
- 统一 reason / errorCode / pageType / recommendedAction
- 区分 Safe / Assisted / Debugger 风险表达
- 补测试和文档

范围外：

- 不重写全部 browser tools
- 不扩展新工具
- 不做完整视觉模型兜底

重点执行项：

- 阅读工具分层、错误码、工具文档和当前 browser tools 实现
- 盘点核心 tools 并按 Safe / Assisted / Debugger 分类
- 为 content-script 型主线工具统一 unsupported_page_type、page_not_ready、target_not_found、permission_denied、tab_not_found 等语义
- 清理底层注入错误、runtime 噪音泄漏路径
- 对 Debugger Tools 明确风险表达

产品约束：

- Safe Tools 是默认主能力面
- Debugger Tools 不能伪装成普通低痕迹能力
- 相同故障的 reason 与 recommendedAction 必须尽量一致

发布前必须验证项：

- pnpm run typecheck
- pnpm run test:core
- 非 web tab 回归测试
- page_not_ready / target_not_found 场景验证
- 一次真实助手链路验证

完成后下一任务建议：
T4 真实验收门禁化
```

## T4 真实验收门禁化

```md
任务标题：T4 真实验收门禁化

任务目标：
把真实助手验收正式纳入 Tabrix 的发布门禁，形成可重复、可追溯、可解释的 fast / full 验收体系，并补第二个核心客户端的真实验收基线。

范围内：

- 固化 fast / full 两级真实验收体系
- 明确 PR gate / nightly gate / release gate
- 规范验收产物与失败证据留存
- 将至少第二个核心客户端纳入真实验收
- 更新验收矩阵、发布说明和相关文档

范围外：

- 不追求一次覆盖所有客户端
- 不做复杂测试平台重构
- 不把人工协作型能力强行计入无人值守通过率

重点执行项：

- 阅读 ACCEPTANCE_MATRIX、RELEASE_READINESS_CHECKLIST、RELEASE_PROCESS、PROJECT_REVIEW 和现有 acceptance 脚本
- 梳理当前已有真实验收资产和 fast / full 边界
- 正式定义 PR / nightly / release 三类门禁
- 规范 fast / full 的边界和证据要求
- 补第二个核心客户端的真实验收，优先 Codex 或 qwenpaw

产品约束：

- 真实验收结果必须可解释、可复现
- 无人值守通过率不能混入人工协作型工具
- 不能只验证“能连上”，必须验证“真实工具主线能通过”

发布前必须验证项：

- pnpm run typecheck
- pnpm run test:core
- fast 真实验收
- full 真实验收
- 第二客户端至少一轮主线验证
- 一次标准真实助手链路验证

完成后下一任务建议：
T5 Codex 客户端一等接入
```

## T5 Codex 客户端一等接入

```md
任务标题：T5 Codex 客户端一等接入

任务目标：
让 Codex 成为 Tabrix 的一等客户端，具备最短配置、明确验证路径、稳定错误提示和清晰文档。

范围内：

- 梳理 Codex 当前接入方式
- 输出最短可复制配置
- 补首个成功工具调用验证路径
- 补排障说明和已知限制
- 将官方 skills/tabrix_browser 作为产品交付的一部分维护

范围外：

- 不改 Codex 产品本身
- 不引入私有协议
- 不为了 Codex 破坏其他客户端兼容性

重点执行项：

- 审查当前 Codex 集成逻辑、注入配置和运行时行为
- 形成最短接入指南
- 形成首个成功工具调用验证路径
- 明确推荐 transport、前置条件和常见失败场景
- 将 Codex 纳入兼容矩阵优先位置

产品约束：

- 接入体验短、清楚、少隐藏前提
- 配置示例必须可复制、可验证
- 不暴露仅对内部环境有效的默认参数

发布前必须验证项：

- 一轮真实 Codex 接入验证
- initialize -> tools/list -> tools/call 在 Codex 下通过
- 一次真实助手链路验证

完成后下一任务建议：
T6 第三方复用矩阵与 NOTICE 流程
```

## T6 第三方复用矩阵与 NOTICE 流程

```md
任务标题：T6 第三方复用矩阵与 NOTICE 流程

任务目标：
建立仓库级第三方复用矩阵，并配套 NOTICE / 来源记录 / 设计参考记录流程，让后续所有外部复用都有清晰边界。

范围内：

- 整理重点参考项目的复用分类
- 建立许可证与 NOTICE 记录机制
- 建立“代码复用 / 设计借鉴 / 禁止直接复用”模板
- 将该规范接入后续任务与文档流程

范围外：

- 不实际引入第三方代码
- 不新增第三方运行时依赖
- 不做泛依赖审计

重点执行项：

- 阅读 NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh、贡献流程和发布流程相关文档
- 梳理 playwright-mcp、rrweb、stagehand、browser-use、selenium-ide、openreplay、automa 的许可证与建议使用方式
- 输出复用矩阵
- 设计 NOTICE / 来源记录规范

产品约束：

- AGPL 或商业限制项目不能作为直接代码来源
- 规则要简单、可执行、可复用

发布前必须验证项：

- 重点外部项目分类完整
- 许可证边界经人工复核

完成后下一任务建议：
T1 双链路协议回归
```

## T7 真实 MCP E2E fixture 站点与回归框架

```md
任务标题：T7 真实 MCP E2E fixture 站点与回归框架

任务目标：
建立一套走真实 MCP 链路的 E2E fixture 站点与回归框架，覆盖主线页面类型和关键交互结构。

范围内：

- 建立或整理 fixture 页面集合
- 建立从 MCP 入口触发的 E2E 回归框架
- 覆盖登录态、表单、iframe、shadow DOM、延迟渲染、复杂表格
- 输出可复用的基线测试场景

范围外：

- 不做云端大规模测试平台
- 不引入新的 transport
- 不一次覆盖所有客户端

重点执行项：

- 梳理已有 fixture 和 smoke 资产
- 设计 fixture 页面集合
- 建立从 initialize -> tools/list -> tools/call 真正走 MCP 的回归入口
- 让测试能区分链路问题、页面结构问题、工具行为问题

产品约束：

- 入口必须是真实 MCP
- fixture 页面要偏真实操作，不要只有玩具 DOM

发布前必须验证项：

- 至少一轮完整 MCP E2E 跑通
- 回归结果可重复
- 失败输出可读、可归因
- 一次真实助手链路验证

完成后下一任务建议：
T13 nightly 稳定性与回归报告自动化
```

## T8 DOM 脱水与极简 JSON 树输出

```md
任务标题：T8 DOM 脱水与极简 JSON 树输出

任务目标：
把 chrome_read_page 升级为面向 AI 执行的结构化极简 JSON 树，并支持 compact / normal / full 三种输出模式。

范围内：

- 为 chrome_read_page 设计三档输出模式
- 默认走极简 JSON 树
- 完整信息通过 artifact 引用承载
- 让输出更偏动作相关节点优先

范围外：

- 不迁移到 Python DOM 管线
- 不重做全部 tool schema
- 不替换现有执行链路

重点执行项：

- 审查现有 read_page 输出结构与消费依赖
- 设计 compact / normal / full 的字段边界
- 默认输出优先包含动作相关节点
- 为可操作节点预留 confidence、matchReason、fallbackChain、fingerprint
- 完整内容走 artifactRefs

产品约束：

- 默认输出必须显著降低 token 消耗
- 不能因为极简而牺牲关键操作信息
- 优先服务 click / fill / read-page 协同

发布前必须验证项：

- chrome_read_page 三模式验证
- 至少一轮真实页面对比
- 与 click/fill 协作场景验证

完成后下一任务建议：
T9 DOM artifact 接入 execution session
```

## T9 DOM artifact 接入 execution session

```md
任务标题：T9 DOM artifact 接入 execution session

任务目标：
让结构化 DOM artifact 成为 execution session 的正式组成部分，并能被 result normalizer、回归报告和失败分析统一消费。

范围内：

- DOM artifact 的生成、挂载、引用
- 与 execution session 生命周期打通
- 与 result normalizer 输出打通
- 为后续报告与回放预留引用方式

范围外：

- 不先做复杂 artifact 浏览器 UI
- 不引入全量 rrweb 录制
- 不重构整个 session manager

重点执行项：

- 审查 session-manager、result-normalizer、artifactRefs 路径
- 定义 DOM artifact 的最小数据结构和存储位置
- 让相关工具把 DOM artifact 挂进 session
- 让结果归一化输出能返回 artifact 引用

产品约束：

- artifact 要稳定、可诊断、便于后续报告消费
- 不应默认把超大 DOM 塞进普通 tool result

发布前必须验证项：

- 真实会话中 artifact 可生成
- artifactRefs 引用可追溯
- 清理与失效策略行为明确

完成后下一任务建议：
T10 locator 排名 / fallbackChain / fingerprint
```

## T10 locator 排名 / fallbackChain / fingerprint

```md
任务标题：T10 locator 排名 / fallbackChain / fingerprint

任务目标：
在 read_page / interactive elements / click / fill / record-replay 相关链路中建立 locator 排名、fallbackChain 和 fingerprint 机制，提升长期命中率与自愈能力。

范围内：

- locator 候选集合设计
- fallbackChain 生成与使用
- fingerprint 生成与记录
- 命中原因与置信度输出

范围外：

- 不做完整 AI 自愈框架
- 不完全替代现有 ref 机制
- 不引入外部运行时

重点执行项：

- 审查现有 selector engine、候选链、ref 解析路径
- 设计 locator ranking 规则，至少覆盖 css / attr / aria / xpath / text
- 为可操作节点生成稳定 fingerprint
- 在相关输出中补 fallbackChain / matchReason / confidence
- 在 click/fill 失败时优先尝试候选回退

产品约束：

- 优先强化 Safe Tools
- 回退逻辑必须可解释
- 不要让回退链过重影响性能

发布前必须验证项：

- 关键页面 click/fill 回归
- fallbackChain 样例验证
- 页面变化前后命中对比

完成后下一任务建议：
T11 URL Experience Memory v1
```

## T11 URL Experience Memory v1

```md
任务标题：T11 URL Experience Memory v1

任务目标：
基于现有 record-replay v3，为同一站点或 URL 的重复任务沉淀可复用经验，优先复用历史成功链，降低 token 成本并提升重复任务成功率。

范围内：

- 基于 record-replay v3 设计经验存储模型
- 记录成功动作与失败恢复信息
- 支持“推荐与复用”优先
- 为后续自动学习预留结构

范围外：

- 不单独新建一套平行工作流引擎
- 不做全自动自学习发布系统
- 不做复杂可视化产品

重点执行项：

- 梳理 record-replay v3 中已有 flow/run/trigger/storage 基础
- 设计经验条目模型：domain/path/intent/locatorChain/fingerprint/successRate/tokenCost/lastSuccessAt
- 定义经验命中与推荐规则
- 让 click/fill/navigation/read-page 相关路径能读取并优先尝试历史成功链

产品约束：

- 首版以推荐和复用为主，不做黑盒自动决策
- 经验命中必须可解释
- 经验数据要与站点上下文绑定

发布前必须验证项：

- 至少一组重复站点任务复用验证
- 命中/回退/失败数据可追踪
- 性能与存储增长行为可接受

完成后下一任务建议：
T12 失败流程 replay artifact
```

## T12 失败流程 replay artifact

```md
任务标题：T12 失败流程 replay artifact

任务目标：
为关键失败场景引入可复盘的 replay artifact，并和 DOM artifact、截图、GIF、network/console 证据形成统一证据链。

范围内：

- 失败场景的 replay artifact 采集与引用
- 与现有 artifact/session/report 链路打通
- 支持关键失败回放，而不是全量录制

范围外：

- 不做全量 session replay 平台
- 不做复杂播放器产品界面
- 不强行把所有成功流程都录下来

重点执行项：

- 评估 rrweb 在当前架构中的最小引入方式
- 定义哪些失败场景必须保留 replay artifact
- 让 replay artifact 与 DOM artifact、截图、GIF 统一进入 evidence 链
- 规范敏感信息和隐私处理策略

产品约束：

- 首版只做失败优先
- 证据要能帮助定位
- 录制成本和存储成本必须可控
- 隐私与脱敏默认从严

发布前必须验证项：

- 至少一轮失败回放验证
- artifact 引用可追踪
- 敏感信息处理规则明确

完成后下一任务建议：
T13 nightly 稳定性与回归报告自动化
```

## T13 nightly 稳定性与回归报告自动化

```md
任务标题：T13 nightly 稳定性与回归报告自动化

任务目标：
建立 nightly 稳定性与回归报告自动化，让项目质量不再依赖人工复盘和零散结论。

范围内：

- 建立 nightly gate
- 自动汇总主链路结果与失败证据
- 输出统一 Markdown 报告
- 与 PR/release 验收形成分层闭环

范围外：

- 不搭建复杂外部监控平台
- 不把 nightly 当成唯一质量门槛
- 不做花哨仪表盘优先于可读报告

重点执行项：

- 梳理已有 PR gate、release check、真实验收资产
- 确定 nightly 必跑清单：双链路主流程、核心 tools、真实 MCP E2E、关键失败证据保留
- 自动汇总 nightly 结果为 Markdown 报告
- 报告中包含通过/失败概览、失败 case、artifact 引用、与上一轮相比变化

产品约束：

- 报告适合人读，也适合后续 AI 消费
- 失败报告必须带证据引用
- nightly 目标是发现回归，不是制造噪音

发布前必须验证项：

- 至少一轮自动 nightly 成功输出
- 失败 case 能附带证据
- 报告结构可复用
- 一次真实助手链路验证

完成后下一任务建议：
T14 智能助手退出默认产品面
```

## T14 智能助手退出默认产品面

```md
任务标题：T14 智能助手退出默认产品面

任务目标：
将智能助手能力从默认产品面降级为 experimental 或开发者模式能力，降低对外承诺，减少主线干扰。

范围内：

- 调整 popup / sidepanel / 导航中的默认产品位
- 将智能助手标记为 experimental 或仅开发者可见
- 对外文档同步收缩承诺
- 保留底层代码供内部观察

范围外：

- 不要求立即删除全部代码
- 不要求独立拆仓
- 不重做 agent 子系统

重点执行项：

- 梳理智能助手在 popup、sidepanel、路由、文档中的可见入口
- 移除或隐藏默认产品位
- 增加 experimental/dev-mode gating
- 清理对外文档中超出实际交付的承诺

产品约束：

- 对外表达必须诚实
- 不影响当前主线浏览器能力
- 不应继续“承诺大于交付”

发布前必须验证项：

- 默认导航验证
- 旧入口无明显残留误导
- 主线功能不受影响

完成后下一任务建议：
T15 工作流 UI 降级，保留 v3 内核
```

## T15 工作流 UI 降级，保留 v3 内核

```md
任务标题：T15 工作流 UI 降级，保留 v3 内核

任务目标：
退出未成熟的 workflow UI 默认产品面，只保留对外稳定能力和内部调试入口，继续投资 record-replay v3 内核。

范围内：

- 移除或隐藏默认 workflow UI 产品位
- builder 页面改为内部/调试入口
- 对外仅保留稳定能力面
- 文档同步更新

范围外：

- 不删除 record-replay v3 内核
- 不阻断 flow/run/list/export 等稳定能力
- 不立即重写 workflow UI

重点执行项：

- 梳理 popup、sidepanel、builder 页面和相关入口
- 移除“可见但点不开”“Coming Soon”的默认承诺
- 将 builder 入口改为内部或调试模式可见
- 审查对旧 record-replay 类型的强依赖

产品约束：

- 用户不应再看到半成品承诺
- 不影响内核继续演进
- 主线表达回到“真实 Chrome + MCP + 稳定执行”

发布前必须验证项：

- 主导航验证
- v3 内核能力基本回归
- 旧入口无明显误导

完成后下一任务建议：
T16 本地模型 / 语义索引 / 向量搜索退场评估
```

## T16 本地模型 / 语义索引 / 向量搜索退场评估

```md
任务标题：T16 本地模型 / 语义索引 / 向量搜索退场评估

任务目标：
对本地模型 / 语义相似度 / 内容索引 / 向量搜索相关能力做系统性评估，产出明确的保留、降级、删除结论，并在合适范围内完成最小产品面收缩。

范围内：

- 盘点相关代码、依赖、入口、文档、测试
- 判断主线价值、真实使用情况、维护成本
- 输出保留 / 降级 / 删除三类结论
- 如存在明显不应继续暴露的默认产品位，完成最小必要收缩

范围外：

- 不在没有评估的前提下粗暴删除全部代码
- 不影响当前主链路
- 不新增新的本地模型能力

重点执行项：

- 阅读 FEATURE_PRUNING_REVIEW、PROJECT_REVIEW、产品定位文档和相关实现
- 盘点 semantic similarity、model cache、content indexer、vector search、local model 初始化相关代码与依赖
- 明确区分“主线仍依赖 / 可降级为内部能力 / 可以删除或准备删除”
- 检查这些能力是否仍出现在 popup、sidepanel、CLI、README、docs 中
- 若存在明显偏离主线的默认入口，完成最小收缩

产品约束：

- 任何结论都必须服务 Tabrix 当前主线
- 不能为了“技术上做过”继续占用默认产品位
- 对外文档必须与实际能力一致

发布前必须验证项：

- pnpm run typecheck
- pnpm run test:core
- 主链路 smoke 或等价验证
- 文档与实际入口一致性检查

完成后下一任务建议：
回到主线强化任务，优先 T8 / T9 / T10 / T11 / T12 中当前最接近落地的一项
```

---

## 4. 版本记录

### v2026.04.15.3

- 为 `T1` 补充 `localhost HTTP` 与远程 HTTP 的鉴权/展示边界
- 明确 `127.0.0.1` 不应被误表达为远端客户端

### v2026.04.15.2

- 将 `T1` 从“`双链路协议回归`”升级为“`主线连接方式与客户端会话模型收口`”
- 将 `T1` 执行重点从 transport 抽象统一，收口到 Popup 两模式、默认远程、客户端列表语义与失效会话治理

### v2026.04.15.1

- 建立 `T1-T16` 的 `Codex` 执行提示词独立文档
- 收口统一投喂前缀
- 补齐 `T1-T16` 的可执行提示词内容
