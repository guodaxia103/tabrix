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

### 2026-04-17 - 进行中 - CLI 参数易用性与真实排障贴合度

- 范围：`tabrix mcp call --args` 在 PowerShell 下的真实维护使用体验
- 优先级：中
- 责任归属：维护者 / 贡献者
- 相关项：`tabrix mcp call`、GitHub Actions 页面排查、PowerShell
- 摘要：浏览器优先排障链路已经可用，但 `--args` 仍要求手写 JSON 字符串，在 PowerShell 下容易因为引号与转义出错，增加真实维护任务中的摩擦。
- 证据：
  - 本次在真实 GitHub Actions 页面排查过程中，多次因为 PowerShell 下的 JSON 转义问题触发 `MCP call failed: Expected property name or '}' in JSON...` 这类参数解析错误。
  - 在改用单引号包裹 JSON 或使用 `ConvertTo-Json` 构造参数后，同样的 `chrome_navigate`、`chrome_read_page`、`chrome_get_web_content` 调用可以稳定成功。
  - 当前已经把 GitHub 场景示例补进 `tabrix mcp --help`，但 shell 级别的参数易用性仍然依赖使用者掌握引号细节。
- 后续动作：
  - 评估为 `tabrix mcp call` 增加更低摩擦的参数输入方式，例如 `--args-file`、重复 `--arg key=value`，或 shell 友好的对象输入模式。
  - 在 CLI 文档或帮助示例中补充一条 PowerShell 风格的参数示例，降低 Windows 维护场景中的试错成本。
  - 后续继续把真实自用中已经核实的摩擦点记入本日志，但仍保持轻量，不把公开文档写成内部任务系统。

### 2026-04-17 - 进行中 - 基于真实 GitHub 排障的产品自用反馈

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
  - 明确并文档化复杂页面排查优先链路：`chrome_read_page` -> `chrome_get_web_content` -> `chrome_get_interactive_elements` -> 截图/控制台 -> `chrome_javascript` 仅作为显式兜底。
  - 在日常维护中加入至少一条可重复的 GitHub 场景浏览器验证路径，让复杂公开网页得到稳定覆盖，而不是只靠临时排障触发。
  - 评估补一个更低摩擦的维护者 MCP 调试入口，减少排障时必须手写本地脚本的成本。
  - 后续继续用真实登录态浏览器任务验证产品能力，而不只停留在协议层或最小冒烟层验证。

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
