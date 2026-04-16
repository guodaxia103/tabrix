# Tabrix 工具分层与风险分级清单

最后更新：`2026-04-12 Asia/Shanghai`
适用项目：`Tabrix`

---

## 1. 文档目标

本文档用于把 `Tabrix` 当前浏览器工具体系拆清楚，回答以下问题：

1. 当前有哪些浏览器工具，分别做什么。
2. 哪些工具符合 `Tabrix` 的主定位，哪些已经偏向高风险调试路径。
3. 哪些工具应继续作为默认能力，哪些应改为受限模式，哪些应明确标记为调试器能力。
4. 每类工具后续可借鉴哪些外部项目来提升准确性、稳定性和可维护性。

本文档是 [`TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md`](./TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md) 的执行层配套文档。

---

## 2. 分层原则

结合 `Tabrix` 的主定位：

> 真实浏览器 + 低痕迹接管 + 稳定自动化 + 经验复用

浏览器工具应分为以下三层：

## 2.1 Safe Tools

定义：

- 默认低痕迹
- 默认不应触发 `chrome.debugger`
- 高频调用
- 应作为 `Tabrix` 的主能力面

适用场景：

- 导航
- 页面读取
- 内容提取
- 基础交互
- 常规标签页与浏览器管理

## 2.2 Assisted Tools

定义：

- 主体仍服务主线
- 但可能包含多种执行路径或更强权限分支
- 默认可用，但需要更清晰的模式标识、回退逻辑和诊断信息

适用场景：

- 高级网络捕获
- 截图/录屏/导出
- userscript 特殊执行模式

## 2.3 Debugger Tools

定义：

- 明确使用 `CDP` 或 `chrome.debugger`
- 可能触发浏览器调试提示
- 不应被误认为“低痕迹默认能力”
- 必须显式标明风险和传输路径

适用场景：

- 调试器式 JS 执行
- DevTools 级 tracing
- 底层输入派发
- 文件上传、对话框处理等底层能力

---

## 3. 分层总览

## 3.1 Safe Tools

| 工具                                | 功能说明                                    | 当前判断 | 后续方向                        |
| ----------------------------------- | ------------------------------------------- | -------- | ------------------------------- |
| `get_windows_and_tabs`              | 枚举当前浏览器窗口与标签页                  | Safe     | 保持轻量只读                    |
| `chrome_navigate`                   | 打开 URL、刷新、前进后退、标签页切换式导航  | Safe     | 保持默认主路径                  |
| `chrome_read_page`                  | 读取页面可见结构并生成稳定 `ref`            | Safe     | 升级为结构化极简 JSON 树        |
| `chrome_get_web_content`            | 抓取页面可见文本/HTML 与元数据              | Safe     | 与 DOM artifact 进一步打通      |
| `chrome_get_interactive_elements`   | 提取按钮、链接、输入框等可交互元素          | Safe     | 增强排序与候选链                |
| `chrome_click_element`              | 基于 `ref`、selector 或坐标执行点击         | Safe     | 优先强化 ref 与 selector 稳定性 |
| `chrome_fill_or_select`             | 填写表单、切换 checkbox/radio/select        | Safe     | 强化事件一致性与回退链          |
| `chrome_keyboard`                   | 发送键盘快捷键和特殊按键                    | Safe     | 继续走 DOM / 页面输入能力       |
| `chrome_request_element_selection`  | 请求用户在页面手动点选元素                  | Safe     | 保留为 HITL 兜底                |
| `chrome_switch_tab`                 | 切换标签页                                  | Safe     | 保持简单直接                    |
| `chrome_close_tabs`                 | 关闭标签页                                  | Safe     | 保持简单直接                    |
| `chrome_history`                    | 读取浏览历史                                | Safe     | 保持工具稳定性                  |
| `chrome_bookmark_search/add/delete` | 书签查询与管理                              | Safe     | 保持工具稳定性                  |
| `chrome_network_request`            | 以浏览器上下文发起请求，复用 cookie/session | Safe     | 继续强化浏览器上下文能力        |

## 3.2 Assisted Tools

| 工具                          | 功能说明                                          | 当前判断 | 后续方向                             |
| ----------------------------- | ------------------------------------------------- | -------- | ------------------------------------ |
| `chrome_network_capture`      | 抓取页面网络请求；默认轻量模式，高级模式可抓 body | Assisted | 保留双模式，但要把高风险分支显式化   |
| `chrome_screenshot`           | 页面/元素截图，普通模式与高级模式并存             | Assisted | 区分普通截图与 DevTools 级截图       |
| `chrome_gif_recorder`         | 录制页面交互为 GIF                                | Assisted | 明确依赖链与数据来源                 |
| `chrome_userscript`           | 注入或运行用户脚本                                | Assisted | 将 `once` / 特权模式单独标记         |
| `performance_analyze_insight` | 对 trace 结果做摘要分析                           | Assisted | 与 tracing 结果解耦更清晰            |
| `chrome_handle_download`      | 等待并读取下载结果                                | Assisted | 保持，但需明确是否依赖前序高权限链路 |

## 3.3 Debugger Tools

| 工具                      | 功能说明                              | 当前判断 | 后续方向                   |
| ------------------------- | ------------------------------------- | -------- | -------------------------- |
| `chrome_javascript`       | 在页面执行 JS 并返回结果              | Debugger | 默认不应作为低痕迹能力暴露 |
| `chrome_computer`         | 通用鼠标/键盘/拖拽/滚动/缩放/截图工具 | Debugger | 必须拆分为安全版与高风险版 |
| `chrome_console`          | 抓控制台日志与异常                    | Debugger | 明确标注依赖调试器会话     |
| `chrome_handle_dialog`    | 处理 alert/confirm/prompt             | Debugger | 作为显式高风险能力保留     |
| `chrome_upload_file`      | 向文件输入框上传文件                  | Debugger | 保留但明确为特权能力       |
| `performance_start_trace` | 启动性能 tracing                      | Debugger | 仅作为诊断/调优工具        |
| `performance_stop_trace`  | 结束性能 tracing                      | Debugger | 仅作为诊断/调优工具        |

---

## 4. 默认产品面建议

## 4.1 应作为默认能力面暴露的工具

以下工具应构成 `Tabrix` 的“主能力面”：

- `chrome_navigate`
- `chrome_read_page`
- `chrome_get_web_content`
- `chrome_get_interactive_elements`
- `chrome_click_element`
- `chrome_fill_or_select`
- `chrome_keyboard`
- `chrome_network_request`
- `get_windows_and_tabs`
- `chrome_history`
- `chrome_bookmark_*`

理由：

- 这些工具最符合“真实浏览器 + 低痕迹接管”
- 最容易成为自动化工作流的基础积木
- 最应该优先优化准确率、等待策略和结构化输出

## 4.2 不应默认伪装成普通能力的工具

以下工具即使继续保留，也不应让调用方误以为它们与 Safe Tools 等价：

- `chrome_javascript`
- `chrome_computer`
- `chrome_console`
- `chrome_handle_dialog`
- `chrome_upload_file`
- `performance_start_trace`
- `performance_stop_trace`

这些工具必须在以下至少一处体现风险：

- 工具命名
- 工具文档
- schema 字段
- 返回值

---

## 5. 风险定义

## 5.1 低风险

特征：

- 不依赖 `chrome.debugger`
- 不触发浏览器调试提示
- 对用户当前浏览体验扰动较小

## 5.2 中风险

特征：

- 可能存在多个执行模式
- 某些模式可能进入更高权限或更高可见性链路
- 需要通过参数、模式名或返回字段显式说明

## 5.3 高风险

特征：

- 使用 `chrome.debugger` 或等价 `CDP` 调试会话
- 可能触发浏览器调试提示
- 容易偏离 `Tabrix` 的低痕迹定位
- 只能作为显式、受限、可诊断能力保留

---

## 6. 每层的设计要求

## 6.1 Safe Tools 设计要求

Safe Tools 必须满足：

1. 默认不走 `CDP`
2. 不允许内部静默升级到 `chrome.debugger`
3. 返回结构中应保留足够诊断信息，但不能把实现复杂度暴露成用户心智负担
4. 优先加强：
   - locator 稳定性
   - DOM 结构化输出
   - wait / retry / recover 机制
   - iframe / shadow DOM 兼容

## 6.2 Assisted Tools 设计要求

Assisted Tools 必须满足：

1. 显式区分普通模式与高风险模式
2. 返回结构中应包含：
   - `transport`
   - `mode`
   - `fallbackUsed`
   - `warnings`
3. 对高风险模式提供清晰提示
4. 文档中要写清“何时建议使用、何时不建议使用”

## 6.3 Debugger Tools 设计要求

Debugger Tools 必须满足：

1. 显式标明为高风险
2. 不参与默认低痕迹链路
3. 文档必须写明可能触发浏览器调试提示
4. 返回结构必须带上：
   - `transport: "cdp"`
   - `riskLevel: "high"`
   - `mayShowDebugBanner: true`
5. 优先作为：
   - 诊断工具
   - 受限模式
   - 兜底模式

---

## 7. 当前重点整改对象

结合当前仓库状态，优先级建议如下。

## P0

- `chrome_javascript`
- `chrome_computer`

理由：

- 高频
- 易误导
- 对主定位伤害最大

### `chrome_javascript`

当前问题：

- 语义上像“普通页面 JS 能力”
- 实现却明确走 `CDP Runtime.evaluate`

建议：

- 拆为安全版与高风险版，或在命名中明确 `cdp`
- 默认路径应优先考虑页面注入/扩展执行能力
- 保留 `CDP` 作为显式特权模式，而不是默认模式

可借鉴项目：

- `Playwright MCP`：工具契约清晰度
- `browser-use`：更偏页面语义层的抽象

### `chrome_computer`

当前问题：

- 名称像“通用浏览器动作工具”
- 实现中大量动作已走 `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent`、`Page.captureScreenshot`
- 与低痕迹默认能力定位冲突最大

建议：

- 拆为：
  - 安全版 DOM/扩展交互工具
  - 显式高风险的 `computer_cdp` 类工具
- 对截图、点击、输入、键盘分别寻找默认低痕迹实现

可借鉴项目：

- `Playwright MCP`：动作链编排、等待、稳定性
- `Selenium IDE`：selector 备选与回退
- `Stagehand`：成功动作缓存与自愈

## P1

- `chrome_console`
- `chrome_handle_dialog`
- `chrome_upload_file`
- `performance_start_trace`
- `performance_stop_trace`

理由：

- 属于合理的高权限工具
- 但必须与默认主能力面分离

可借鉴项目：

- `Chrome DevTools MCP`：底层能力组织方式
- `OpenReplay`：观测与诊断面整合思路

## P2

- `chrome_network_capture`
- `chrome_screenshot`
- `chrome_gif_recorder`
- `chrome_userscript`

理由：

- 这些工具值得保留
- 但当前模式区分还不够清楚

可借鉴项目：

- `rrweb`：记录、回放、失败复盘 artifact
- `browser-use`：更轻量的结构化页面快照
- `Stagehand`：面向任务的稳定动作封装

---

## 8. 借鉴矩阵

| 项目                                 | 最值得借鉴的点                                | 对应到 Tabrix 的落点                   |
| ------------------------------------ | --------------------------------------------- | -------------------------------------- |
| `microsoft/playwright-mcp`           | MCP 工具面、snapshot、locator、assertion 契约 | Safe Tools 的契约清晰化                |
| `browserbase/stagehand`              | 动作缓存、自愈、稳定动作抽象                  | 网址经验库、动作复用                   |
| `browser-use/browser-use`            | DOM serializer、enhanced snapshot、变量抽取   | `chrome_read_page` 和结构化页面理解    |
| `SeleniumHQ/selenium-ide`            | selector ranking、fallbackChain、导出思路     | click/fill/read_page 的稳定性提升      |
| `rrweb-io/rrweb`                     | DOM snapshot、事件记录、回放模型              | 失败复盘、artifact、record-replay 增强 |
| `openreplay/openreplay`              | 统一观测、console/network/error 聚合          | 诊断面与排障工作流                     |
| `browserbase/mcp-server-browserbase` | 更高层 MCP 工具抽象                           | 高层自动化工具面参考                   |
| `AutomaApp/automa`                   | 工作流产品形态与可视化经验                    | 长期产品形态参考，不主导当前主线       |

---

## 9. 推荐的工具演进方向

## 9.1 Safe Tools 演进方向

重点投入：

- 结构化 DOM 脱水
- locator 候选链
- 元素 fingerprint
- wait / retry / recover
- 网址经验库

这部分是 `Tabrix` 的核心护城河。

## 9.2 Assisted Tools 演进方向

重点投入：

- 模式显式化
- artifact 输出一致化
- 风险提示和返回结构标准化

这部分是 `Tabrix` 的能力扩展层。

## 9.3 Debugger Tools 演进方向

重点投入：

- 限制默认暴露面
- 明确高风险标识
- 用于诊断、回放、性能分析和少数特权操作

这部分不是 `Tabrix` 的核心卖点，但可以成为其“高级能力补充层”。

---

## 10. 正式结论

`Tabrix` 的浏览器工具体系，不应继续维持“工具名像普通浏览器能力、实现却混入高风险调试路径”的状态。

更合理的目标是：

- 用 `Safe Tools` 承担主定位
- 用 `Assisted Tools` 承担扩展能力
- 用 `Debugger Tools` 承担特权和诊断能力

这样才能真正把：

- 准确性
- 稳定性
- 低痕迹

三件事统一在同一个产品与技术框架内。

一句话总结：

> `Tabrix` 的工具体系应当以 Safe Tools 为核心，以 Assisted Tools 为扩展，以 Debugger Tools 为边缘特权，而不是让 Debugger 路径污染默认浏览器接管体验。

---

## 11. 参考文档

- [TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md](./TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md)
- [TOOLS.md](./TOOLS.md)
- [WHY_MCP_CHROME.md](./WHY_MCP_CHROME.md)
- [ARCHITECTURE_zh.md](./ARCHITECTURE_zh.md)
- [DOCUMENTATION_VISIBILITY_POLICY_zh.md](./DOCUMENTATION_VISIBILITY_POLICY_zh.md)
