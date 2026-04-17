# Tabrix 公开维护日志

本文档用于记录对公开仓库协作有帮助、且已经核实的维护结论、已知缺口与后续跟进项。

它是一个轻量公开记录，不替代 GitHub Issues、Pull Requests 或内部治理系统。

收录范围：

- 已核实的公开维护结论
- 对贡献者可见的后续跟进项
- 值得长期保留的公开排障说明
- 在真实维护、自用验证或贡献者工作流中发现、且已经核实的产品改进建议

不收录：

- 内部规划系统
- 私有评审记录
- 验收证据包
- 未公开的发布门禁治理记录

## 记录格式

每条记录尽量简洁，包含：

1. 日期
2. 状态
3. 范围
4. 优先级
5. 责任归属
6. 相关项
7. 摘要
8. 证据
9. 后续动作

排序规则：

- 按时间倒序维护，最新记录放在最前面

维护约定：

- 每次在真实任务中使用 Tabrix 后，如果出现已经核实、对后续维护有帮助的可优化建议，可以作为轻量公开记录补进本日志，方便后续持续改善。

## 记录

### 2026-04-17 - 已关闭 - GitHub 排障实战的人机体验优化

- 范围：贡献者在 GitHub Actions 页面上的真实排障流程
- 优先级：中
- 责任归属：维护者 / 贡献者
- 相关项：`tabrix mcp call`、`chrome_navigate`、`chrome_read_page`、`chrome_get_web_content`、`chrome_click_element`
- 摘要：本次真实排障中，核心控制链路可用，但多 tab 场景下维护体验仍有可提升空间，尤其是上下文切换与复杂页内检索。
- 证据：
  - 在一次实操中，直接读取页面时先返回了 `chrome-extension://.../connect.html`（`unsupportedPageType: non_web_tab`），后续需要改为用新标签页重新打开目标 URL 才稳定进入目标页面，说明活动标签页上下文偶发干扰排障流畅性。
  - 在复杂的 Actions job 日志页，`chrome_get_web_content` 常表现为 sparse，仍需配合 `chrome_read_page` 与精确定位后再点击跳转到失败步骤锚点，才拿到足够完整结论。
- 后续动作：
  - 已完成闭环：
    - 在 `docs/MCP_CLI_CONFIG.md` 中落地“浏览器优先+新标签页”与复杂页提取层级。
    - 在 `docs/TROUBLESHOOTING_zh.md` 中落地 `status -> doctor --fix -> mcp tools -> 真实页面复现` 的标准排障路径。
  - 收口复核清单（按需执行）：
    - `tabrix doctor --fix`
    - `tabrix status`
    - `tabrix mcp tools`
    - `tabrix mcp call chrome_navigate --arg url=<目标URL> --arg newWindow=true`

### 2026-04-17 - 已关闭 - 恢复专项验收的人机工程与本机现场恢复

- 范围：恢复专项 smoke、本机 `Chrome` 强杀后的运行时恢复、结构化错误解析
- 优先级：中
- 责任归属：维护者 / 贡献者
- 相关项：`tabrix smoke --bridge-recovery`、`tabrix smoke --browser-path-unavailable`、`tabrix daemon start`
- 摘要：恢复链路本身已经能覆盖真实自动拉起、路径不可用和部分恢复后失败等场景，但真实维护里仍暴露出两个需要长期记住的操作事实：强杀 `Chrome` 后，本机服务有时需要显式重启；同时，真实工具失败文本可能带有 `Error calling tool: {json}; ...` 这类包装，专项验收脚本需要主动剥离才能稳定读取结构化结论。
- 证据：
  - 本次真实回归中，`Chrome` 完全未启动 -> 发真实浏览器请求 -> 自动拉起 -> 原请求成功 已通过，随后把浏览器现场恢复到了关闭状态。
  - 新增 `tabrix smoke --browser-path-unavailable` 后，真实回归已可在不修改系统目录下 `chrome.exe` 的前提下，稳定得到 `TABRIX_BROWSER_NOT_RUNNING` 与单一 `nextAction`。
  - 在本机环境里，直接 `taskkill /IM chrome.exe /F` 后，偶发会把当前本地服务一起带离可达状态，需要补一条 `tabrix daemon start` 才能回到可测态。
  - 服务端真实错误文本包含 `Error calling tool: {json}; recoveryAttempted=...` 尾巴，若 smoke 只按纯 JSON 或纯文本处理，会把本已正确返回的结构化错误误判为失败。
- 后续动作：
  - 已完成闭环：
    - `tabrix smoke --bridge-recovery --json`
    - `tabrix smoke --command-channel-recovery fail-next-send --json`
    - `tabrix smoke --command-channel-recovery fail-all-sends --json`
  - 本地测试现场收口：如需恢复可测环境，先执行 `tabrix daemon start` 再复测上述 smoke 命令。

### 2026-04-17 - 已关闭 - CLI 参数易用性与真实排障贴合度

- 范围：`tabrix mcp call --args` 在 PowerShell 下的真实维护使用体验
- 优先级：中
- 责任归属：维护者 / 贡献者
- 相关项：`tabrix mcp call`、GitHub Actions 页面排查、PowerShell
- 摘要：浏览器优先排障链路保持可用，并已修复 `tabrix mcp call` 的参数输入摩擦点。
- 证据：
  - `tabrix mcp call` 新增了可重复的 `--arg key=value` 输入方式，并在值上支持 JSON 解析（如数字/布尔值/对象）。
  - 新增了 `--args-file <path>` 入口，支持将复杂参数放到文件里，避免 PowerShell 转义误伤。
  - 帮助示例同步补充了真实维护场景（`--arg` 与 `--args-file`）。
  - 在 `app/native-server/src/scripts/mcp-inspect.test.ts` 增加了 `--arg` 与 `--args-file` 的参数验证用例，并验证了无效输入的快速失败行为。
- 后续动作：
  - 已完成本项闭环。仅在真实维护中仍出现频繁 PowerShell 误报时再考虑进一步封装。

### 2026-04-17 - 已关闭 - 基于真实 GitHub 排障的产品自用反馈

- 范围：Tabrix 在真实 GitHub Actions 页面上的浏览器控制工作流
- 优先级：中
- 责任归属：维护者 / 贡献者
- 相关项：`tabrix status`、`tabrix doctor`、`tabrix smoke --json`
- 摘要：核心运行链路已经比较稳，但面对复杂网页排障场景时，任务化使用体验仍有提升空间。
- 证据：
  - 当前工作区构建下的 `tabrix status`、`tabrix doctor`、`tabrix smoke --json` 均通过，说明桥接、扩展和本地 MCP 运行时在本次排障期间是健康的。
  - 通过 Tabrix 驱动真实登录态浏览器，成功打开 GitHub Actions job 页面、读取页面内容，并从渲染后的页面正文中恢复出失败 advisory 文本。
  - 为了在复杂页面上拿到足够精确的结论，本次排障仍额外使用了 `chrome_javascript` 读取 `document.body.innerText`，说明页面读取层的人机工程还不够强，复杂网页上仍需原始 JS 回退。
- 后续动作：
  - 已完成：在 `docs/TROUBLESHOOTING_zh.md` 与 `docs/MCP_CLI_CONFIG.md` 中补齐复杂页面排查链路与 GitHub 排障模板，并加入 `tabrix smoke` 回归命令建议。
  - 闭环完成：复杂页面排查链路与恢复验收命令已统一落地，可用于后续同类场景复测。

### 2026-04-17 - 已关闭 - GitHub 排障工作流

- 范围：GitHub 可视化失败的贡献者排障流程
- 优先级：高
- 责任归属：维护者 / 贡献者
- 相关项：GitHub Actions `CI #110`、Tabrix 驱动的浏览器排查
- 摘要：当失败信息已经能在 GitHub 网页中看到时，贡献者应优先使用 Tabrix 驱动真实浏览器排查，再退回 API-only 或 CLI-only 路径。
- 证据：
  - 这次问题在切换到 Tabrix 驱动的真实登录态 Chrome 页面排查后，更快拿到了准确失败文本。
  - 即使 `gh` 未登录、公共日志接口受限，浏览器侧页面读取仍能恢复关键失败信息。
  - 已补一个更低摩擦的维护者入口：`tabrix mcp tools` 与 `tabrix mcp call <tool>`，降低了排障时必须手写本地脚本的成本。
  - 已用当前仓库的真实 GitHub 仓库页完成浏览器侧验证，证明贡献者可以沿 `tabrix status` -> `tabrix doctor` -> `tabrix mcp call ...` 的路径直接进入网页排查。
- 后续动作：后续继续沿这条默认顺序维护；若未来 GitHub 页面读取能力或帮助入口再次退化，再单独重新打开相关维护项。

### 2026-04-17 - 已关闭 - CI 审计失败归因

- 范围：GitHub Actions `CI` 工作流，`Production audit (high)` 门禁
- 优先级：高
- 责任归属：已由贡献者核实
- 相关项：GitHub Actions `CI #110`、GitHub Actions `CI #111`、提交 `650638b`
- 摘要：本次 CI 阻塞已确认来自 `protobufjs@6.11.4` 及其通告 `GHSA-xq3m-2v4x-88gg`，不是 `fastify`。
- 证据：
  - 历史失败：GitHub Actions `CI #110` 死在 `Production audit (high)`。
  - 通过 Tabrix 在 GitHub job 页面做真实浏览器读取时，页面正文明确显示 `tabrix audit: HIGH/CRITICAL production vulnerabilities detected`，随后列出 `protobufjs@6.11.4`。
  - 当前头提交验证：`main` 上本地执行 `pnpm run audit` 已通过。
  - 当前头提交验证：提交 `650638b`（`fix: upgrade onnxruntime-web to eliminate protobufjs CVE path`）之后，GitHub Actions `CI #111` 已恢复为成功。
  - 依赖对照：`app/native-server/package.json` 中 `fastify` 在红转绿前后都保持 `^5.8.5`，可排除其为本次事件的直接根因。
- 后续动作：继续以 OSV 门禁结果作为生产依赖阻塞判断依据；遇到 CI 失败时，先确认具体失败包与 advisory，再给出归因。
