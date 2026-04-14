# Tabrix 产品定位与技术原则

最后更新：`2026-04-12 Asia/Shanghai`
适用项目：`Tabrix`

---

## 1. 文档目标

本文档用于统一回答以下问题：

1. `Tabrix` 到底是什么产品，而不是什么产品。
2. `Tabrix` 在浏览器自动化赛道中的主定位是什么。
3. 后续功能设计、工具设计、架构演进时，应遵守哪些技术原则。
4. 面对 `Playwright MCP`、`Chrome DevTools MCP`、`WebMCP` 等方向时，`Tabrix` 应借鉴什么，拒绝什么。

本文档不是营销文案，而是产品与技术的共同约束文档。后续新增能力、重构、裁剪、文档对外表述，都应以本文档为基线。

---

## 2. 一句话定位

> `Tabrix = 接管用户真实 Chrome 的 MCP 原生执行层，并以低痕迹方式完成稳定、可复用、可回放的浏览器自动化。`

这句话包含四个关键词：

- **真实 Chrome**
- **MCP 原生执行层**
- **低痕迹接管**
- **稳定、可复用、可回放**

---

## 3. 产品定位

## 3.1 Tabrix 是什么

`Tabrix` 是一个由 **Chrome 扩展 + 本地 bridge / native server + MCP 协议接入层** 组成的浏览器执行平台。

它的核心价值不是“再开一个自动化浏览器”，而是：

- 直接工作在用户已经在使用的浏览器中
- 复用现有登录态、Cookie、扩展、标签页和站点上下文
- 通过 MCP 把这些能力安全暴露给 AI 客户端
- 在真实浏览器里建立稳定的页面读取、页面交互、回放、经验复用能力

这一定义与当前仓库已有文档保持一致，尤其是：

- [README_zh.md](E:\projects\AI\copaw\mcp-chrome\README_zh.md)
- [WHY_MCP_CHROME.md](E:\projects\AI\copaw\mcp-chrome\docs\WHY_MCP_CHROME.md)
- [PROJECT_REVIEW_2026Q2.md](E:\projects\AI\copaw\mcp-chrome\docs\PROJECT_REVIEW_2026Q2.md)

## 3.2 Tabrix 不是什么

`Tabrix` 不应被定义为：

- 又一个通用无头爬虫框架
- 又一个以 `CDP` 为核心的调试控制器
- 又一个“重开浏览器实例”的 AI 自动化 runtime
- 在扩展里并行承载大量与主线弱相关的产品线

更具体地说：

- 它不应默认像 `Playwright` 那样启动一套独立浏览器运行时
- 它不应默认像 `Chrome DevTools MCP` 那样通过调试协议附着浏览器
- 它不应为了“更强控制力”而牺牲“真实会话、低痕迹、低打扰”这条主线

---

## 4. 核心用户价值

`Tabrix` 的核心用户价值应始终围绕以下四点展开：

## 4.1 真实会话复用

用户不需要重建自动化环境。

系统应优先复用：

- 已登录会话
- Cookie
- 当前标签页上下文
- 浏览器安装的扩展环境
- 用户已经形成的浏览行为状态

## 4.2 低痕迹接管

AI 可以操作用户原生浏览器，但不应轻易暴露出“调试器附着”“远程调试端口暴露”“额外浏览器实例”等高识别痕迹。

这条原则是 `Tabrix` 与多数通用浏览器自动化方案最大的分界线。

## 4.3 稳定自动化

`Tabrix` 不只是要“能点到”，还要：

- 更稳定地定位元素
- 更稳地等待页面状态
- 更少误操作
- 更好处理 iframe / shadow DOM / 延迟渲染 / 复杂后台页面

## 4.4 可复用与可回放

同一网址、同一任务、同一后台流程，不应每次都重新依赖大模型从零理解。

系统应逐步沉淀：

- 结构化页面快照
- selector / fingerprint / fallbackChain
- record-replay 流程
- 网址经验库
- 失败复盘 artifact

---

## 5. 与同类方案的关系

## 5.1 对 Playwright MCP 的态度

`Playwright MCP` 的优势主要在：

- 更成熟的自动化工程经验
- 更稳定的等待、定位、断言能力
- 更规范的工具面设计
- 更完整的自动化运行时抽象

`Tabrix` 应借鉴这些优点，但不应把自己改造成“另一个 Playwright runtime”。

应借鉴：

- 工具契约清晰度
- 元素定位与等待策略
- 错误分类
- 自动化稳定性工程经验

不应复制：

- 默认独立浏览器实例路线
- 将用户原生浏览器边缘化的运行时模型

## 5.2 对 Chrome DevTools MCP 的态度

`Chrome DevTools MCP` 的优势主要在：

- 底层观测能力强
- 页面、网络、性能、调试信息能力完整
- 对 Chrome 内部能力覆盖深

`Tabrix` 应把它视为 **底层诊断与少数特权能力参考对象**，而不是主路线模板。

应借鉴：

- 诊断能力
- 性能 tracing
- 特殊场景下的底层兜底思路

不应复制：

- 默认通过调试附着控制浏览器
- 让高频基础工具依赖 `chrome.debugger`

## 5.3 对 WebMCP 的态度

`WebMCP` 更接近 `Tabrix` 的理念方向：

- 更强调页面/浏览器原生能力暴露
- 更强调非调试器式接入
- 更接近“让真实网页成为 agent 可调用环境”

`Tabrix` 不需要照搬 `WebMCP` 的协议形态，但应在理念上向它靠近：

- 默认走低痕迹接入
- 优先使用扩展桥接、页面注入、消息通信
- 尽量不让“调试器控制”成为默认心智

## 5.4 更广的参考对象

`Tabrix` 的产品与技术判断，不应局限于 `Playwright MCP`、`Chrome DevTools MCP`、`WebMCP` 三个项目。

结合当前仓库的调研文档：

- [NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md)
- [FEATURE_PRUNING_REVIEW_2026Q2_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\FEATURE_PRUNING_REVIEW_2026Q2_zh.md)

`Tabrix` 下一阶段更合理的参考集合应至少包括以下几类：

### A. 浏览器自动化与工具面基线

- `microsoft/playwright-mcp`
- `browserbase/mcp-server-browserbase`
- `browser-use/browser-use`

这类项目主要帮助 `Tabrix` 思考：

- MCP 工具面如何设计得更稳定
- 页面 snapshot、locator、assertion 如何更结构化
- agent 与浏览器之间的调用契约如何更清晰

### B. 低层自动化稳定性与动作复用

- `browserbase/stagehand`
- `SeleniumHQ/selenium-ide`

这类项目主要帮助 `Tabrix` 思考：

- 如何把一次成功动作沉淀为可复用经验
- 如何给 selector 建立候选链、排序和回退机制
- 如何让自动化从“探索型动作”演进为“稳定型动作”

### C. DOM 快照、回放与失败复盘

- `rrweb-io/rrweb`
- `openreplay/openreplay`

这类项目主要帮助 `Tabrix` 思考：

- 页面结构和变化过程如何记录
- 失败任务如何可回放、可定位、可解释
- DOM artifact、GIF、console、network、replay 如何形成统一复盘面

### D. 产品形态与长期演进参考

- `AutomaApp/automa`
- `WebMCP`

这类项目主要帮助 `Tabrix` 思考：

- 长期是否需要更高层工作流能力
- 如何让浏览器能力沉淀为可共享、可组合、可调度的资产
- 如何在不偏离主线的前提下扩展协作和自动化抽象层

## 5.5 正确的参考方法

`Tabrix` 不应简单地把外部项目分成“竞争对手”或“抄不抄”。

更合理的方式是：

- 用 `Playwright MCP` 校准 MCP 工具面和真实浏览器桥接体验
- 用 `Stagehand` 校准动作缓存、自愈和经验复用策略
- 用 `browser-use` 校准 DOM serializer、结构化 snapshot 和变量抽取思路
- 用 `Selenium IDE` 校准 selector ranking、fallbackChain 和导出稳定性
- 用 `rrweb` 校准回放 artifact、失败复盘与事件模型
- 用 `OpenReplay` 校准统一观测与排障面板的产品思路
- 用 `Automa` 和 `WebMCP` 校准长期产品形态，但不让它们主导当前主线

一句话说：

> `Tabrix` 应该广泛借鉴成熟项目的局部优点，但所有借鉴都必须服务于“真实浏览器 + 低痕迹接管 + 稳定自动化”这一主线，而不是把项目重新拼装成另一个方向的产品。

---

## 6. 产品级原则

## 6.1 第一原则：真实浏览器优先

凡是设计新能力时，优先考虑：

- 是否工作在用户当前浏览器
- 是否复用现有状态
- 是否不要求用户迁移到新的浏览器 runtime

## 6.2 第二原则：低痕迹优先于高控制力

在大多数真实业务场景中，`更隐` 比 `更强` 更重要。

这意味着默认路径应优先选择：

- 扩展注入
- content script
- DOM 读取
- chrome.scripting
- 页面消息通信

而不是默认选择：

- `chrome.debugger.attach`
- `Runtime.evaluate`
- `Input.dispatchMouseEvent`
- `Page.captureScreenshot`

只有在默认路径无法满足、且价值足够高时，才允许进入更高风险手段。

## 6.3 第三原则：高频能力必须安全默认

高频浏览器工具必须默认走低痕迹路径。

尤其包括：

- 页面读取
- 内容提取
- 点击
- 填写
- 键盘
- 导航

这些工具不允许通过隐式逻辑自动升级到高风险调试路径。

## 6.4 第四原则：工具边界必须可见

调用方必须知道当前走的是哪条执行路径。

每个工具都应显式可识别：

- `transport = extension`
- `transport = dom`
- `transport = cdp`

并明确说明：

- 是否可能触发浏览器调试提示
- 是否会影响用户当前页面可见状态
- 是否属于高风险能力

## 6.5 第五原则：经验沉淀优先于重复推理

成功的自动化动作，不应每次重新依赖模型理解。

应优先沉淀与复用：

- 结构化页面快照
- selector ranking
- fallbackChain
- fingerprint
- record-replay 历史
- URL Experience Memory

---

## 7. 技术级原则

## 7.1 默认执行路径原则

默认执行层顺序应为：

1. 扩展桥接
2. DOM / content script 能力
3. 页面注入与消息通信
4. 受限、显式开启的高风险能力

其中第 4 层不应默认参与普通工具执行。

## 7.2 `CDP` 使用原则

`CDP` 不是禁用能力，但在 `Tabrix` 中必须是 **显式、受限、边缘化** 的能力。

仅适合：

- 性能 tracing
- 特殊诊断
- 部分难以通过 DOM 完成的浏览器底层操作
- 工具链中的兜底模式

不适合：

- 页面交互默认实现
- 高频点击/输入主路径
- 用户以为是“原生浏览器低痕迹接管”的默认体验

## 7.3 禁止隐式升级原则

禁止以下行为成为默认机制：

- 工具调用过程中自动 `attach debugger`
- 未声明风险的情况下自动切换到 `CDP`
- 低风险工具通过内部 fallback 进入高风险链路

一旦确需切换：

- 必须显式标记
- 必须让上层感知
- 必须在日志与返回结果中可追踪

## 7.4 结构化页面理解原则

`Tabrix` 的页面理解主线不应是“把整页转成长文本给模型读”，而应是：

- 极简 JSON 树
- 动作相关节点优先
- 节点带 fingerprint 与候选定位链
- 结果尽量以 artifact 引用，而不是长文本输出

这与现有规划保持一致：

- [PROGRAM1_DOM_DEHYDRATION_TASK_LIST.md](E:\projects\AI\copaw\mcp-chrome\docs\PROGRAM1_DOM_DEHYDRATION_TASK_LIST.md)
- [NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md)

## 7.5 record-replay 优先原则

`record-replay-v3` 是 `Tabrix` 的核心长期资产。

未来稳定性、复用率、团队协作能力，应优先建立在：

- flow / run / trigger / replay
- 失败 artifact
- 网址经验复用

而不是建立在大量临时、一次性的探索式动作之上。

---

## 8. 工具设计原则

## 8.1 工具必须分层

建议将浏览器工具分为三层：

### A. Safe Tools

默认低痕迹、默认开放、适合高频调用。

例如：

- 导航
- 页面读取
- 内容提取
- 交互元素发现
- 点击
- 填写
- 键盘

### B. Assisted Tools

可能带来更强能力，但需要更明确的运行条件和回退逻辑。

例如：

- network capture 的高级模式
- userscript 的特殊执行模式
- 录屏、截图的高级能力

### C. Debugger Tools

明确使用 `CDP` 或 `chrome.debugger`，必须显式标注为高风险模式。

例如：

- 高风险 JavaScript 执行
- 调试器式浏览器控制
- DevTools 级 tracing
- 通过 debugger 完成的文件上传或对话框处理

## 8.2 工具命名必须反映风险

如果某工具走 `CDP`，应在命名、文档或模式参数上让调用方一眼可见。

不能继续维持下面这种模糊关系：

- 名字像普通浏览器工具
- 实现却默认走 debugger 路线

## 8.3 返回结构必须可诊断

工具返回结果建议统一包含：

- `transport`
- `riskLevel`
- `fallbackUsed`
- `artifactRefs`
- `warnings`

这样上层 agent、用户和调试流程才能知道：

- 当前到底走的是哪条链路
- 是否已经偏离默认安全路径

---

## 9. 明确不做的事

未来阶段，`Tabrix` 不应走向以下方向：

- 不把自己重写成另一个 `Playwright` 框架
- 不把默认浏览器控制建立在 `CDP` 上
- 不把“调试器可控制性”当作主卖点
- 不把扩展内智能助手、本地语义模型等偏航功能继续作为主线
- 不为了功能丰富度牺牲真实浏览器会话和低痕迹特性

这与当前功能裁剪方向保持一致：

- [FEATURE_PRUNING_REVIEW_2026Q2_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\FEATURE_PRUNING_REVIEW_2026Q2_zh.md)

---

## 10. 正式结论

`Tabrix` 的长期正确方向，不是成为“最强的浏览器调试器 MCP”，也不是成为“又一个通用自动化框架”。

它最有价值、最应长期坚持的方向是：

> 让 AI 以低痕迹、低打扰、低识别风险的方式，稳定接管用户真实浏览器，并把这种接管能力沉淀为可复用、可回放、可协作的 MCP 执行层。

从这条主线反推，后续所有产品与技术决策都应围绕三件事：

1. 更准
2. 更稳
3. 更隐

其中“更隐”不是附属目标，而是 `Tabrix` 的核心护城河之一。

---

## 11. 后续执行建议

基于本文档，建议立即推进以下后续文档或工作项：

1. 输出《Tabrix 工具分层与风险分级清单》
2. 输出《Tabrix Safe Tools / Debugger Tools 迁移计划》
3. 审核现有工具默认实现，识别所有隐式 `CDP` 路径
4. 将工具文档补齐 `transport / riskLevel / mayShowDebugBanner`
5. 对高频工具设立“低痕迹回归测试”基线

---

## 12. 参考文档

- [README_zh.md](E:\projects\AI\copaw\mcp-chrome\README_zh.md)
- [WHY_MCP_CHROME.md](E:\projects\AI\copaw\mcp-chrome\docs\WHY_MCP_CHROME.md)
- [PROJECT_REVIEW_2026Q2.md](E:\projects\AI\copaw\mcp-chrome\docs\PROJECT_REVIEW_2026Q2.md)
- [NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md)
- [FEATURE_PRUNING_REVIEW_2026Q2_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\FEATURE_PRUNING_REVIEW_2026Q2_zh.md)
- [ARCHITECTURE.md](E:\projects\AI\copaw\mcp-chrome\docs\ARCHITECTURE.md)
- [TOOLS.md](E:\projects\AI\copaw\mcp-chrome\docs\TOOLS.md)
- [TRANSPORT.md](E:\projects\AI\copaw\mcp-chrome\docs\TRANSPORT.md)
