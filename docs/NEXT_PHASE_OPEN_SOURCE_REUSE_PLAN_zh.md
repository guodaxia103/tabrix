# 下一阶段开源调研与复用落地方案（正式稿）

最后更新：`2026-04-12 Asia/Shanghai`
适用项目：`Tabrix / mcp-chrome`

---

## 1. 文档目标

本方案用于回答两个问题：

1. GitHub 上有哪些同类开源项目已经解决了我们下一阶段要做的问题。
2. 针对 `Tabrix / mcp-chrome` 当前代码基线，哪些能力应当直接复用，哪些只借鉴设计，哪些明确不建议自己重造。

本方案覆盖以下四个目标：

- 产品持续稳定
- 基于 MCP 服务连接真实浏览器做自动化测试
- 优化测试结果输出，将页面转为极简 JSON 树，降低 token 消耗并提升定位准确率
- 以网址为主题沉淀浏览器操作记录和经验，提升重复任务效率、准确率与 token 利用率

同时补充当前阶段的执行边界：

- 产品优先服务 AI 助手类客户端，而不是泛自动化玩家
- 连接方式当前只聚焦两条主线：`stdio` 与远程 `Streamable HTTP`
- 在远程 HTTP 未稳定打通前，不继续扩展更多连接形态

---

## 2. 当前仓库基线

当前仓库并不是从零开始，已经具备下一阶段落地的关键基础：

- 真实链路已经明确：`MCP client -> native server -> extension -> browser APIs`
- `chrome_read_page` 已有页面读取能力，但当前核心实现仍偏“可见树文本输出”，尚未升级为任务导向的极简 JSON 树
- execution session 已有 `artifactRefs` 承载能力，但 DOM artifact 还未完全挂入结果归一化链路
- `record-replay v3` 已具备 URL binding、URL trigger、flow/run 存储能力
- DOM 脱水任务草案已存在：[`docs/PROGRAM1_DOM_DEHYDRATION_TASK_LIST.md`](./PROGRAM1_DOM_DEHYDRATION_TASK_LIST.md)
- nightly 稳定性报告模板已存在：[`docs/NIGHTLY_REPORT_2026-04-11.md`](./NIGHTLY_REPORT_2026-04-11.md)

当前最关键的相关代码位置：

- `app/chrome-extension/inject-scripts/accessibility-tree-helper.js`
- `app/native-server/src/execution/session-manager.ts`
- `app/native-server/src/execution/result-normalizer.ts`
- `app/chrome-extension/entrypoints/background/record-replay-v3/`
- `packages/shared/src/tools.ts`

结论很明确：下一阶段不是重写浏览器执行链路，而是在现有链路上补齐“稳定性、结构化输出、回放经验、测试基准”这四层能力。

---

## 3. 调研范围与筛选标准

### 3.1 调研范围

本次重点调研了以下 GitHub 开源项目：

- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- [browserbase/stagehand](https://github.com/browserbase/stagehand)
- [browserbase/mcp-server-browserbase](https://github.com/browserbase/mcp-server-browserbase)
- [browser-use/browser-use](https://github.com/browser-use/browser-use)
- [rrweb-io/rrweb](https://github.com/rrweb-io/rrweb)
- [SeleniumHQ/selenium-ide](https://github.com/SeleniumHQ/selenium-ide)
- [openreplay/openreplay](https://github.com/openreplay/openreplay)
- [AutomaApp/automa](https://github.com/AutomaApp/automa)

### 3.2 筛选标准

筛选时采用以下标准：

- 与当前 `native-server + extension + real browser` 架构是否兼容
- 是否已经解决“真实浏览器自动化 / DOM 快照 / record-replay / 经验复用”中的某一关键问题
- 是否能减少我们自研成本，而不是引入更重的替代框架
- 许可证是否允许直接复用或二次分发
- 是否会增加长期维护负担

---

## 4. 调研结论总览

| 项目                                                                            | 主要价值                                                       | 许可证        | 与当前项目关系 | 建议结论                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------- | -------------- | ------------------------------ |
| [playwright-mcp](https://github.com/microsoft/playwright-mcp)                   | MCP 浏览器工具面、结构化 snapshot、扩展桥接、断言/locator 能力 | Apache-2.0    | 高匹配         | 优先借鉴，局部可复用           |
| [stagehand](https://github.com/browserbase/stagehand)                           | AI 动作缓存、自愈、`act/extract/agent` 抽象                    | MIT           | 中高匹配       | 借鉴设计，不整包引入           |
| [browser-use](https://github.com/browser-use/browser-use)                       | DOM serializer、enhanced snapshot、变量识别、持久 CLI 循环     | MIT           | 中匹配         | 借鉴实现思路，不直接依赖       |
| [rrweb](https://github.com/rrweb-io/rrweb)                                      | DOM snapshot、mutation replay、player、插件化 replay           | MIT           | 高匹配         | 优先评估直接引入               |
| [selenium-ide](https://github.com/SeleniumHQ/selenium-ide)                      | record/playback、selector 排序与回退思路、导出模型             | Apache-2.0    | 中匹配         | 借鉴 selector 策略             |
| [mcp-server-browserbase](https://github.com/browserbase/mcp-server-browserbase) | 极简高阶 MCP 工具面                                            | MIT           | 中匹配         | 仅作为高阶工具层参考           |
| [openreplay](https://github.com/openreplay/openreplay)                          | 观测、session replay、网络/console/error 聚合                  | AGPL 为主     | 中匹配         | 仅参考产品能力，不直接复用代码 |
| [automa](https://github.com/AutomaApp/automa)                                   | 可视化工作流、调度、市场化分享                                 | AGPL/商业许可 | 中匹配         | 仅参考产品形态，不直接复用代码 |

---

## 5. 项目级建议：哪些直接用，哪些借鉴，哪些不做

## 5.1 优先复用 / 集成评估

### A. Playwright MCP

建议优先吸收以下能力：

- 结构化 accessibility snapshot 的工具契约设计
- `browser_snapshot`、`browser_generate_locator`、断言类工具的输入输出形态
- 浏览器扩展桥接模式
- 现有浏览器会话复用、已登录状态复用
- 扩展连接审批与 token 鉴权机制

对 Tabrix 的直接价值：

- 可以少走一轮工具协议设计弯路
- 可以直接借鉴“真实浏览器 + 已登录标签页 + MCP 接入”的交互模型
- 可以作为我们“自动化测试工具矩阵”和“断言工具矩阵”的对标基线

不建议做的事：

- 不建议直接用 Playwright MCP 替换当前执行链路
- 不建议放弃当前 `native-server + extension` 架构去完全切到 Playwright runtime

正式决策：

- 借鉴其工具契约、扩展桥接和 token 审批流程
- 不替换 Tabrix 的核心运行时

### B. rrweb

建议优先评估以下包或能力：

- `rrweb-snapshot`
- `record/replay`
- `rrweb-player`
- mutation compaction 思路
- replay plugin 模型

对 Tabrix 的直接价值：

- 我们不需要自己重新发明一套完整的 session replay 数据结构
- 可以把失败流程回放、调试 artifact、录制回放 UI 建立在成熟生态上
- 对“记录执行过程经验”和“复盘失败原因”非常有帮助

正式决策：

- 优先评估在失败回归、record-replay debug artifact 中直接引入 rrweb 能力
- 第一阶段不做“全量录制所有会话”，先聚焦失败用例、关键流程、nightly 回归场景

---

## 5.2 局部借鉴，不整包引入

### C. Stagehand

Stagehand 最值得借鉴的不是浏览器驱动本身，而是下面三点：

- preview AI actions before running
- cache repeatable actions
- auto-caching + self-healing

它给出的核心启发是：

- 一次成功的操作，不应该每次都重新依赖 LLM 推理
- 页面变动后，应优先尝试回退链和历史成功动作，而不是立刻重新“从头理解页面”
- 浏览器自动化需要“从探索型动作”逐步沉淀为“稳定型动作”

对 Tabrix 的落地方向：

- 把它转化为 `URL Experience Memory` 的打分与复用逻辑
- 成功的点击/填写/导航行为应沉淀为可复用经验
- 优先命中缓存成功链，失败再退回 DOM 重新定位和 LLM 推理

不建议做的事：

- 不建议把 Stagehand 整个框架嵌入当前产品
- 不建议把 Tabrix 变成“另一个 AI browser framework”

### D. browser-use

browser-use 值得借鉴的点很聚焦：

- `browser_use/dom/enhanced_snapshot.py`
- `browser_use/dom/serializer/`
- `browser_use/dom/markdown_extractor.py`
- `browser_use/agent/variable_detector.py`
- 持久 CLI 循环和“浏览器保持运行”的交互方式

对 Tabrix 的落地方向：

- 吸收其 DOM serializer / enhanced snapshot 的组织方式
- 借鉴变量检测思路，支持“重复任务模板化”
- 把页面提取从“纯文本可读”升级为“动作相关节点优先”

不建议做的事：

- 不建议直接引入 Python 运行时或把核心 DOM 管线迁到 Python
- 不建议整套复刻 browser-use 的 agent loop

### E. Selenium IDE

Selenium IDE 最值得借鉴的是 selector 设计思路：

- 一个用户事件应尽可能收集更多属性
- selector 不是单点命中，而是排序后的候选集合
- 首选定位失败后，应自然退回到次优 selector

对 Tabrix 的落地方向：

- 在 `chrome_read_page` 的候选动作里增加 `fallbackChain`
- 对每个可操作节点生成更稳定的 `fingerprint`
- 在 record-replay 成功历史里保存“哪个 selector 在哪个站点最稳定”

---

## 5.3 仅做产品参考，不直接复用

### F. OpenReplay

OpenReplay 的优势主要在：

- session replay 平台化
- console/network/errors/performance 聚合
- 隐私与脱敏策略

但它以 AGPL 体系为主，更适合作为产品参考，而不适合作为我们直接拷贝代码的来源。

正式决策：

- 借鉴其“统一观测面板”和“隐私默认开启”的产品思路
- 不直接复用其核心代码

### G. Automa

Automa 在以下方向很成熟：

- 可视化工作流
- 调度执行
- workflow 分享市场
- 基于浏览器扩展的自动化产品形态

但其许可证对直接复用不友好，更适合作为远期产品形态参考。

正式决策：

- 不在本阶段自研可视化 workflow builder
- 不在本阶段复制 marketplace 体系
- 等 MCP 流程、经验库和稳定性收敛后，再评估是否需要更强的可视化层

---

## 6. 对 Tabrix 的正式决策

## 6.0 当前阶段新增执行优先级

在已有复用决策之上，当前阶段新增以下产品与工程优先级：

1. 优先保障 AI 助手产品接入体验
2. 优先打通远程 `Streamable HTTP`
3. 保持 `stdio` 作为本机稳定兜底方案
4. 暂不扩展除上述两种方式之外的连接模式

面向的优先客户端包括但不限于：

- `Copaw`
- `OpenClaw`
- `Codex`
- `Claude Desktop`
- `Cursor`
- `Cline`

一句话原则：

> 先让主流 AI 助手稳定接入和稳定控制，再考虑其它外围能力。

## 6.1 不重复造轮子的总原则

下一阶段遵循以下原则：

1. 已有成熟开源库能承接的，就不要自造底层协议或播放器。
2. 已有成熟项目已经验证过的交互模型，优先借鉴工具面和状态机，不重新拍脑袋设计。
3. 与当前架构冲突的大框架，不整包替换，只提取局部能力。
4. AGPL 或商业限制项目只做产品参考，不做代码来源。

## 6.3 新增自动化场景纳入计划

除现有远程控制能力外，后续自动化场景中新增一项明确目标：

### 场景：AI 助手发出浏览器控制命令时，浏览器未运行

预期体验不应是用户手动排障，而应尽可能自动完成整条链路：

1. 电脑重启后，守护进程自动恢复
2. AI 助手发出浏览器控制命令
3. 若 Chrome 未运行，Tabrix 自动拉起浏览器
4. 浏览器启动后，扩展自动连接 Native host
5. MCP 服务等待 browser bridge ready
6. 自动重试刚才的工具调用
7. 仅在超时或缺少扩展时才返回明确错误

该场景已纳入后续计划，但当前执行顺序明确如下：

- 第一优先级：先把远程 `Streamable HTTP` 真正打通并稳定
- 第二优先级：补齐浏览器自动拉起与自动恢复链路
- 第三优先级：再做更高层自动化抽象

## 6.2 各目标的复用决策

### 目标 1：产品持续稳定

不应重复造的轮子：

- 不再自行摸索 nightly 报告结构
- 不再把失败定位依赖于人工复盘

建议借鉴：

- Playwright MCP 的 tracing/video/assertion 思路
- rrweb 的 replay artifact 能力
- OpenReplay 的统一观测视角

最终落地：

- 建立 `PR gate + nightly gate + release gate`
- 失败回归默认保留结构化 DOM artifact、截图、GIF 或 replay artifact
- 输出统一的 nightly Markdown 报告

### 目标 2：基于 MCP 连接真实浏览器做自动化测试

不应重复造的轮子：

- 不再重新设计“真实浏览器桥接 + 标签页选择 + 连接审批”这套交互

建议借鉴：

- Playwright MCP 的 extension bridge、token 鉴权、现有标签页选择
- `mcp-server-browserbase` 的高阶工具层抽象

最终落地：

- 保持 Tabrix 现有运行时不变
- 增加真实 MCP E2E 回归套件，入口必须走 MCP，不只测内部模块
- 增加 fixture 站点覆盖登录、表单、iframe、shadow DOM、延迟渲染、复杂表格

### 目标 3：测试结果优化完善，网页结构化快照输出

不应重复造的轮子：

- 不要再沿用“长文本页面树 + LLM 全量阅读”作为默认路径

建议借鉴：

- Playwright MCP 的结构化 snapshot 方式
- browser-use 的 enhanced snapshot / serializer
- Selenium IDE 的 selector fallback 思路

最终落地：

- 延续 [`docs/PROGRAM1_DOM_DEHYDRATION_TASK_LIST.md`](./PROGRAM1_DOM_DEHYDRATION_TASK_LIST.md) 的方向
- 输出模式统一为 `compact | normal | full`
- 默认返回极简 JSON 树，完整内容走 artifact 引用
- 为可操作节点增加 `confidence`、`matchReason`、`fallbackChain`、`fingerprint`

### 目标 4：按网址沉淀浏览器操作经验

不应重复造的轮子：

- 不要重新做一套独立于现有 record-replay v3 的经验存储系统

建议借鉴：

- Stagehand 的 auto-caching / self-healing
- Selenium IDE 的 selector 排序与回退
- rrweb 的过程记录与回放思路

最终落地：

- 基于现有 `record-replay v3` 演进为 `Site Playbook / URL Experience Memory`
- 记录 `domain/path/intent/locatorChain/fingerprint/successRate/tokenCost`
- 先做“推荐与复用”，后做“自动学习与自动发布”

---

## 7. 下一阶段实施路线

## M0：复用边界定稿（0.5-1 周）

目标：

- 定稿本方案
- 明确第三方依赖可引入清单
- 建立许可证与 NOTICE 流程

输出：

- 第三方复用矩阵
- 引入审批清单
- benchmark 基线页面和测试场景清单

## M1：稳定性与真实浏览器回归（2 周）

目标：

- 打通真实 MCP E2E 回归
- 建立 nightly 报告自动化
- 明确 Tier-1 链路

优先借鉴：

- Playwright MCP 的 snapshot / locator / assertion 思路
- rrweb artifact 预埋点

## M2：DOM 脱水与 artifact 链路（2-3 周）

目标：

- `chrome_read_page` 升级为极简 JSON 树
- execution session 正式接入 DOM artifact
- 支持 `compact | normal | full`

优先借鉴：

- Playwright MCP 的结构化 snapshot
- browser-use 的 DOM serializer
- Selenium IDE 的 selector fallback

## M3：URL Experience Memory（2-3 周）

目标：

- 基于 `record-replay v3` 做网址经验库
- 同一网站重复任务优先复用历史成功链
- 降低重复任务 token 成本

优先借鉴：

- Stagehand 的缓存与自愈策略
- Selenium IDE 的 selector ranking

## M4：回放、观测与失败复盘（1-2 周）

目标：

- 失败流程支持 rrweb 或等价 replay artifact
- 报告聚合 DOM、network、console、screenshot、GIF
- 形成稳定的 nightly / regression 复盘闭环

---

## 8. 建议 backlog（可直接拆 issue）

| 编号   | 标题                                                  | 复用来源                     | 主要模块                       | 产出                     |
| ------ | ----------------------------------------------------- | ---------------------------- | ------------------------------ | ------------------------ |
| OSR-01 | 建立第三方复用矩阵与 NOTICE 流程                      | 全部                         | repo/docs                      | 第三方依赖与许可证清单   |
| OSR-02 | 建立真实 MCP E2E fixture 站点与回归框架               | Playwright MCP               | tests/fixtures/native-server   | 真浏览器自动化回归       |
| OSR-03 | 对齐扩展桥接审批与 token 鉴权模型                     | Playwright MCP               | extension/native-server        | 更稳定的连接授权流程     |
| OSR-04 | 为 `chrome_read_page` 引入 `compact/normal/full` 模式 | Playwright MCP + browser-use | extension/shared               | 极简 JSON 树输出         |
| OSR-05 | DOM artifact 正式挂入 execution session               | 当前仓库 + rrweb 思路        | native-server                  | 结构化 artifact 引用链   |
| OSR-06 | 实现 locator 排名、fallbackChain 与 fingerprint       | Selenium IDE                 | extension/read-page            | 更稳定的 click/fill 命中 |
| OSR-07 | 暴露 record-replay MCP 工具                           | 当前仓库                     | shared/native-server/extension | AI 可调用 flow/run 能力  |
| OSR-08 | 建立 URL Experience Memory v1                         | Stagehand + Selenium IDE     | record-replay-v3/storage       | 网址经验复用层           |
| OSR-09 | 引入失败流程 replay artifact                          | rrweb                        | extension/native-server/docs   | 可复盘的失败回放         |
| OSR-10 | 自动生成 nightly 稳定性与回归报告                     | OpenReplay 产品思路          | scripts/docs/ci                | 统一质量报告             |

---

## 9. 指标与验收标准

### 稳定性指标

- Tier-1 链路 nightly 通过率 `> 95%`
- 连接成功率持续提升
- P1 平均修复周期 `< 7 天`

### DOM 脱水指标

- 相同页面 token 消耗下降 `> 60%`
- `click/fill` 一次命中率 `> 85%`
- fallback 挽救率 `> 60%`

### 经验库指标

- 同一网址重复任务 token 成本下降 `> 40%`
- 重复流程复用成功率 `> 70%`
- 历史 locator 命中率持续提升

### 调试与复盘指标

- 失败回归具备结构化 DOM artifact
- 关键失败具备 replay / GIF / screenshot 至少一种
- nightly 报告可直接定位到失败步骤与页面证据

---

## 10. 许可证与合规策略

### 可以作为代码来源或依赖候选

- MIT
- Apache-2.0

### 仅可做设计参考

- AGPL
- 商业限制许可证

执行要求：

1. 如果直接引入第三方包，必须在仓库中补充许可证记录与 NOTICE。
2. 如果参考实现后自行重写，仍需在设计文档中标明参考来源。
3. 对 AGPL / 商业许可项目，只记录产品启发，不引用代码。

当前建议：

- 可以优先评估：`playwright-mcp`、`rrweb`、`stagehand`、`browser-use`、`selenium-ide`
- 不建议直接复用代码：`openreplay`、`automa`

---

## 11. 明确不做的事

本阶段明确不做以下方向：

- 不重写 Tabrix 的核心运行时为另一个 Playwright/Stagehand 框架
- 不做视觉模型驱动的重型页面理解作为默认路径
- 不做新的独立 record/replay 存储体系，绕开当前 v3
- 不先做大型可视化 workflow builder
- 不先做 marketplace，再反推底层稳定性

---

## 12. 最终建议

下一阶段的最优策略不是“多看几个项目后自己全做”，而是：

- 用 Playwright MCP 校准 MCP 工具面、真实浏览器桥接、断言与 snapshot 模型
- 用 rrweb 承接 replay artifact 与失败复盘，避免重造播放器和事件模型
- 用 Stagehand 定义 URL 经验库的缓存、自愈和重复动作复用策略
- 用 browser-use 优化 DOM serializer、结构化快照与变量抽取思路
- 用 Selenium IDE 完善 selector ranking、fallbackChain 与导出稳定性
- 对 OpenReplay、Automa 只学习产品层，不把代码带进来

一句话总结：

> Tabrix 下一阶段应该坚持“现有运行时不重写、底层能力优先复用成熟开源、产品差异化集中在本地真实浏览器 + 结构化页面理解 + URL 经验库”。

---

## 13. 调研来源

- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- [microsoft/playwright-mcp/packages/extension/README.md](https://github.com/microsoft/playwright-mcp/blob/main/packages/extension/README.md)
- [browserbase/stagehand](https://github.com/browserbase/stagehand)
- [browserbase/mcp-server-browserbase](https://github.com/browserbase/mcp-server-browserbase)
- [browser-use/browser-use](https://github.com/browser-use/browser-use)
- [rrweb-io/rrweb](https://github.com/rrweb-io/rrweb)
- [SeleniumHQ/selenium-ide](https://github.com/SeleniumHQ/selenium-ide)
- [openreplay/openreplay](https://github.com/openreplay/openreplay)
- [AutomaApp/automa](https://github.com/AutomaApp/automa)
