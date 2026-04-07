# Popup 状态排障表

扩展弹出窗口（Popup）通过一个彩色圆点展示当前连接状态。  
下表列出了每种状态的含义、常见原因和修复方法。

---

## 状态速查

| 圆点颜色 | 状态文本                   | 含义                                     | 严重程度 |
| -------- | -------------------------- | ---------------------------------------- | -------- |
| 🟢 绿色  | "服务运行中 (端口: 12306)" | 一切正常，MCP 服务已就绪                 | —        |
| 🟡 黄色  | "已连接，服务未启动"       | Native host 通信正常，但 HTTP 服务未启动 | 中       |
| 🔴 红色  | "服务未连接"               | 与 native host 的通信完全断开            | 高       |
| ⚪ 灰色  | "正在检测…"                | 正在建立连接，尚未得到结果               | 低       |

---

## 🟢 绿色 — 服务运行中

**说明**：扩展已通过 Native Messaging 连接到本地 `mcp-chrome-bridge`，HTTP/MCP 服务在指定端口正常监听。

**如果看到绿色但 AI 客户端仍无法调用工具**：

| 检查项             | 操作                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| 客户端配置是否正确 | 参见 [客户端配置速查卡](CLIENT_CONFIG_QUICKREF.md)，确认 URL 和端口一致 |
| 端口是否匹配       | Popup 显示的端口号需与客户端配置的端口一致                              |
| 防火墙/代理        | 确保 `127.0.0.1:端口` 未被拦截                                          |
| 客户端是否需要重启 | 部分客户端（Claude Desktop、Cursor）修改配置后需重启才生效              |

---

## 🟡 黄色 — 已连接，服务未启动

**说明**：Chrome 扩展能通过 Native Messaging 与本地 `mcp-chrome-bridge` 通信，但 HTTP 服务未成功启动。

**常见原因与修复**：

| 原因                     | 修复方法                                                       |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 服务启动中，尚未完成     | 等待 3–5 秒后点击 **刷新** 按钮                                |
| 端口被占用               | `netstat -ano                                                  | findstr :12306`（Windows）或 `lsof -i :12306`（macOS），关闭占用进程或在扩展设置中更换端口 |
| Node.js 版本过低         | 需要 Node.js >= 20.0.0，运行 `node -v` 检查                    |
| Native host 进程异常退出 | 终端运行 `mcp-chrome-bridge doctor` 查看详细诊断               |
| 首次安装后未完成注册     | 运行 `mcp-chrome-bridge register` 或 `mcp-chrome-bridge setup` |

**快速排障流程**：

```
1. 点击 Popup 的「刷新」按钮
2. 如果仍然黄色 → 打开终端运行：mcp-chrome-bridge doctor
3. 检查 doctor 输出中的 ❌ 项，逐一修复
4. 在 chrome://extensions/ 页面重新加载扩展
5. 重新点击 Connect
```

---

## 🔴 红色 — 服务未连接

**说明**：Chrome 扩展无法与本地 `mcp-chrome-bridge` 建立 Native Messaging 通信。

**常见原因与修复**：

| 原因                          | 修复方法                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| `mcp-chrome-bridge` 未安装    | `npm install -g mcp-chrome-bridge`                                   |
| Native host manifest 未注册   | `mcp-chrome-bridge register`                                         |
| 注册的 manifest 路径失效      | 重新运行 `mcp-chrome-bridge register`（升级或移动安装目录后常见）    |
| Chrome 扩展未正确加载         | `chrome://extensions/` → 开启开发者模式 → 重新加载扩展               |
| Chrome 刚启动，扩展尚未初始化 | 等待几秒后点击 Connect                                               |
| Windows 注册表路径不正确      | `mcp-chrome-bridge doctor` 会检查并给出修复建议                      |
| 扩展 ID 变更（重新加载后）    | 重新运行 `mcp-chrome-bridge register`，因为 manifest 中记录了扩展 ID |

**快速排障流程**：

```
1. 确认 mcp-chrome-bridge 已安装：npm list -g mcp-chrome-bridge
2. 重新注册：mcp-chrome-bridge register
3. 在 chrome://extensions/ 重新加载扩展
4. 点击 Connect
5. 如果仍然红色 → mcp-chrome-bridge doctor
```

---

## ⚪ 灰色 — 正在检测

**说明**：刚打开 Popup 或刚点击 Connect，正在尝试建立连接。

| 情况             | 操作                                                    |
| ---------------- | ------------------------------------------------------- |
| 等待 5 秒后变绿  | 正常，无需处理                                          |
| 长时间停留在灰色 | 关闭 Popup 重新打开；如果反复灰色，按红色的排障流程处理 |

---

## 通用诊断命令

```bash
# 综合诊断（检查 Node.js 版本、manifest 注册、端口占用等）
mcp-chrome-bridge doctor

# 查看服务状态
mcp-chrome-bridge status

# 冒烟测试（调用几个工具验证端到端通路）
mcp-chrome-bridge smoke

# 诊断报告（收集完整环境信息）
mcp-chrome-bridge report
```

---

## 连接错误信息

当 Popup 底部显示"最近一次连接错误"时，参考以下对照表：

| 错误关键字                                                   | 可能原因                                          | 修复                                               |
| ------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------- |
| `Specified native messaging host not found`                  | Manifest 未注册或路径错误                         | `mcp-chrome-bridge register`                       |
| `Access to the specified native messaging host is forbidden` | 扩展 ID 未包含在 manifest 的 `allowed_origins` 中 | 重新 `register`                                    |
| `Native host has exited`                                     | bridge 进程崩溃                                   | 查看 logs 目录下的日志，运行 `doctor`              |
| `Error when communicating with the native messaging host`    | bridge 输出了非法 JSON                            | 确认 Node.js 版本 >= 20 且无全局 require hook 干扰 |
| `EADDRINUSE`                                                 | 端口已被占用                                      | 换端口或关闭占用进程                               |
