---
name: chrome_mcp_browser
description: Use the Chrome MCP (mcp-chrome) tools to operate the user's real Chrome — tabs, navigation, page content, forms, and diagnostics. Prefer structured page reads over screenshots; handle connection and timeout failures with clear user guidance.
metadata:
  version: 1
---

# Chrome MCP 浏览器技能

面向 **任意 MCP 客户端**（Cursor、Claude、CoPaw、OpenClaw 等）。本机需已安装并连接 [mcp-chrome](https://github.com/hangwin/mcp-chrome)（扩展 + `mcp-chrome-bridge`）。

## 最短成功路径

1. 确认 bridge 与扩展已连接：让用户运行 `mcp-chrome-bridge doctor`（或通过 MCP 调用与连接相关的诊断，若存在）。
2. `get_windows_and_tabs` — 确认当前标签与 `tabId`。
3. `chrome_navigate` — 打开目标 URL（或 `refresh` 当前页）。
4. `chrome_read_page` 或 `chrome_get_web_content` — 取结构化内容（优先于截图）。
5. `chrome_fill_or_select` / `chrome_click_element` / `chrome_computer` — 按页面操作。
6. 再次读取或 `get_windows_and_tabs` — 验证结果。

## 工具选择（决策树）

- **列出窗口/标签** → `get_windows_and_tabs`
- **打开/刷新/历史前进后退** → `chrome_navigate`（必填 `url` 除非 `refresh`）
- **可读文本、表单、链接结构** → 优先 `chrome_read_page`；需简化正文时 `chrome_get_web_content`
- **点击/填写** → `chrome_click_element`、`chrome_fill_or_select`
- **坐标级操作 / 滚动 / 复合动作** → `chrome_computer`
- **仅当结构读不到时再截图** → `chrome_screenshot`（体积大、慢）
- **网络/控制台调试** → `chrome_network_*`、`chrome_console`、`chrome_javascript`（注意安全边界）

## 失败回退

| 现象                 | 建议                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| 连接失败 / MCP 报错  | 检查扩展是否已加载、bridge 是否运行、`doctor` 输出；重启 Chrome 与 bridge |
| 工具超时             | 缩小范围（单标签、少步骤）；避免长截图与大页面一次读完                    |
| 元素找不到           | 刷新后再 `chrome_read_page`；改用语义/文案而非脆弱选择器                  |
| `chrome://` 或受限页 | 说明浏览器限制，改用普通 https 页验证流程                                 |

## 标准失败回复模板

向用户说明时包含：**发生了什么 → 可能原因 → 建议命令或操作**（例如：「请先执行 `mcp-chrome-bridge setup` 或 `doctor`，确认 Native Messaging 已注册」）。

## 参考

- 工具列表与参数以项目内 MCP `tools/list` 为准；人类可读摘要见 `docs/TOOLS.md` / `docs/TOOLS_zh.md`。
- 竞品与定位见 `docs/WHY_MCP_CHROME.md`。
