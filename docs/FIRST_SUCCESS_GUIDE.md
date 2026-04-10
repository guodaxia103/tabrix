# 第一个成功任务：从安装到 AI 控制浏览器

> 5 分钟内完成安装并让 AI 助手成功执行第一个浏览器操作。

---

## 第一步：安装 tabrix（1 分钟）

```bash
npm install -g tabrix@latest
```

安装成功后运行：

```bash
tabrix doctor
```

如果所有项目都显示 ✅，进入下一步。如果有 ❌，按提示修复（通常是 `tabrix register`）。

---

## 第二步：加载 Chrome 扩展（1 分钟）

1. 从 [GitHub Releases](https://github.com/guodaxia103/tabrix/releases) 下载最新扩展包
2. 解压到一个**固定目录**（后续不要移动）
3. 打开 Chrome → 地址栏输入 `chrome://extensions/`
4. 打开右上角**开发者模式**
5. 点击**加载已解压的扩展程序** → 选择解压目录
6. 扩展图标会出现在浏览器工具栏

---

## 第三步：连接扩展（30 秒）

1. 点击工具栏上的扩展图标，打开 Popup
2. 点击 **Connect** 按钮
3. 等待状态圆点变为 🟢 绿色，显示"服务运行中 (端口: 12306)"

> 如果是黄色或红色，参考 [Popup 排障表](POPUP_TROUBLESHOOTING.md)。

---

## 第四步：配置 AI 客户端（1 分钟）

在你的 AI 客户端中添加 MCP 服务器配置。以下是最常见的几种：

**Cursor**（`.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

**Claude Desktop**（配置文件）：

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

**Claude Code CLI**：

```bash
claude mcp add chrome-mcp --transport http http://127.0.0.1:12306/mcp
```

> 更多客户端配置见 [配置速查卡](CLIENT_CONFIG_QUICKREF.md)。

---

## 第五步：执行第一个任务（1 分钟）

在 AI 客户端中发送以下指令之一：

### 任务 A：查看当前打开的标签页

> "列出我当前打开的所有浏览器标签页"

AI 会调用 `get_windows_and_tabs`，返回所有窗口和标签的列表。

### 任务 B：打开一个网页

> "帮我打开 https://github.com"

AI 会调用 `chrome_navigate`，在浏览器中打开 GitHub。

### 任务 C：截图当前页面

> "对当前页面截一张图"

AI 会调用 `chrome_screenshot`，返回页面截图。

---

## 成功了！接下来可以试试

- **"读取当前页面的内容并总结"** — 使用 `chrome_read_page` + `chrome_get_web_content`
- **"在搜索框中输入 'MCP protocol' 并点击搜索"** — 使用 `chrome_fill_or_select` + `chrome_click_element`
- **"搜索我的浏览历史中关于 AI 的记录"** — 使用 `chrome_history`
- **"把当前页面加入书签"** — 使用 `chrome_bookmark_add`
- **"录制接下来 10 秒的浏览器操作为 GIF"** — 使用 `chrome_gif_recorder`

---

## 遇到问题？

| 症状                 | 快速解决                              |
| -------------------- | ------------------------------------- |
| AI 说"找不到工具"    | 重启 AI 客户端，确认配置文件语法正确  |
| 绿灯亮但工具调用失败 | `tabrix smoke` 验证端到端连通         |
| 页面操作无反应       | 确认目标页面不是 `chrome://` 内部页面 |
| 截图返回错误         | 等待页面完全加载后重试                |

详细排障请参考：

- [Popup 排障表](POPUP_TROUBLESHOOTING.md)
- [Windows 常见问题](WINDOWS_FAQ.md)
- [完整工具文档](TOOLS_zh.md)
