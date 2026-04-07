# MCP 客户端配置速查卡

> 所有客户端均连接到同一个本地 MCP 服务，默认端口 **12306**。
> 如果你修改了端口，请将下方示例中的 `12306` 替换为实际端口。

## 前置条件

1. Chrome 扩展已加载并点击 **Connect**
2. `mcp-chrome-bridge` 已全局安装（`npm i -g mcp-chrome-bridge`）
3. 运行 `mcp-chrome-bridge doctor` 确认一切正常

---

## Streamable HTTP（推荐）

适用于支持 HTTP 传输的客户端。只需提供一个 URL 即可。

### Claude Desktop

配置文件：`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）
或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）

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

### Cursor

配置文件：`.cursor/mcp.json`（项目级）或全局 MCP 设置

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add chrome-mcp --transport http http://127.0.0.1:12306/mcp
```

或手动编辑 `~/.claude.json`：

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Codex CLI

配置文件：`~/.codex/config.json`

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### CherryStudio

在 MCP 服务器管理页面添加：

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

### Windsurf

配置文件：`.windsurf/mcp.json`（项目级）

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "serverUrl": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Dify

在 Dify 工作流的"工具"节点中配置 MCP 服务：

- **类型**：Streamable HTTP
- **URL**：`http://127.0.0.1:12306/mcp`

> 注意：Dify 如果是 Docker 部署，`127.0.0.1` 需替换为宿主机 IP 或使用 `host.docker.internal`。

---

## SSE 传输（兼容旧客户端）

部分旧版客户端不支持 Streamable HTTP，可使用 SSE 端点：

```
http://127.0.0.1:12306/sse
```

POST 消息端点：`http://127.0.0.1:12306/messages?sessionId=<id>`

---

## stdio 传输（无需 HTTP）

适用于只支持 stdio 的客户端，或网络受限环境。

先找到 stdio 脚本路径：

```bash
# npm
npm list -g mcp-chrome-bridge
# 输出路径 + /node_modules/mcp-chrome-bridge/dist/mcp/mcp-server-stdio.js

# pnpm
pnpm list -g mcp-chrome-bridge
```

### 通用 stdio 配置

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "command": "node",
      "args": ["/path/to/node_modules/mcp-chrome-bridge/dist/mcp/mcp-server-stdio.js"]
    }
  }
}
```

### npx 方式（无需提前安装）

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "command": "npx",
      "args": ["-y", "mcp-chrome-bridge-stdio"]
    }
  }
}
```

> Windows 下 `command` 可能需要改为 `"node.exe"` 或使用完整路径。

---

## 环境变量

| 变量名                        | 说明                                                                                             | 默认值       |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| `MCP_HTTP_PORT`               | MCP HTTP 端口                                                                                    | `12306`      |
| `MCP_HTTP_HOST`               | 监听地址（`127.0.0.1` / `0.0.0.0` / `localhost` / `::`）                                         | `127.0.0.1`  |
| `MCP_ALLOWED_WORKSPACE_BASE`  | 额外允许的工作目录                                                                               | （无）       |
| `CHROME_MCP_NODE_PATH`        | 覆盖 Node.js 可执行文件路径                                                                      | （自动检测） |
| `ENABLE_MCP_TOOLS`            | 白名单模式：只暴露指定工具（逗号分隔）                                                           | （全部）     |
| `DISABLE_MCP_TOOLS`           | 黑名单模式：隐藏指定工具（逗号分隔）                                                             | （无）       |
| `MCP_DISABLE_SENSITIVE_TOOLS` | 设为 `true` 禁用高风险工具 (`chrome_javascript`, `chrome_bookmark_delete`, `chrome_upload_file`) | `false`      |

---

## 验证连接

```bash
# 检查服务状态
mcp-chrome-bridge status

# 全面诊断
mcp-chrome-bridge doctor

# 冒烟测试（调用几个工具看是否正常）
mcp-chrome-bridge smoke
```

或在浏览器中访问 `http://127.0.0.1:12306/status` 查看服务状态和已连接客户端列表。

---

## 已连接客户端管理

扩展 Popup 会实时展示当前已连接的 MCP 客户端列表，包括：

- **客户端名称**（如 `cursor/1.0.0`、`claude-desktop`）
- **来源 IP**（本地显示 `127.0.0.1`，远程显示实际 IP 如 `192.168.1.100`）
- **传输方式**（HTTP 或 SSE）
- **连接时间**

如果发现不认识的 IP 连接，可以点击客户端右侧的 **✕** 按钮立即断开该会话。

> 提示：当没有 MCP 客户端连接时，Popup 显示"暂无 MCP 客户端连接"。

---

## 远程连接（跨机器 / Docker）

默认情况下 MCP 服务只监听 `127.0.0.1`（仅本机可访问）。若需要从其他机器或 Docker 容器中连接：

**第一步：启用 0.0.0.0 监听**

```bash
# 设置环境变量后启动
MCP_HTTP_HOST=0.0.0.0 mcp-chrome-bridge
```

或在全局环境中设置：

```bash
# Linux/macOS
export MCP_HTTP_HOST=0.0.0.0

# Windows PowerShell
$env:MCP_HTTP_HOST = "0.0.0.0"
```

**第二步：在远程 AI 客户端中配置**

将 `127.0.0.1` 替换为浏览器所在机器的局域网 IP：

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://192.168.1.100:12306/mcp"
    }
  }
}
```

**第三步：确认连接**

在扩展 Popup 的「已连接的客户端」列表中，应能看到远程 IP 和客户端名称。不认识的 IP 可以直接踢出。

**Docker 场景**

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://host.docker.internal:12306/mcp"
    }
  }
}
```

> ⚠️ **安全提示**：`0.0.0.0` 监听意味着局域网内任何设备都可以无认证地控制浏览器。请仅在受信任的网络环境中使用，并通过 Popup 的客户端列表监控连接。

---

## 常见问题

| 症状                | 原因                   | 解决方案                                                        |
| ------------------- | ---------------------- | --------------------------------------------------------------- |
| Connection refused  | 服务未启动             | 打开扩展 popup 点击 Connect                                     |
| Tools not appearing | 配置文件 JSON 语法错误 | 用 JSON 校验器检查配置                                          |
| Port conflict       | 12306 端口被占用       | 在扩展设置中修改端口，然后更新客户端配置                        |
| Docker 容器无法连接 | 127.0.0.1 指向容器内部 | 设 `MCP_HTTP_HOST=0.0.0.0`，用宿主 IP 或 `host.docker.internal` |
| 远程连接被拒绝      | 默认只监听 127.0.0.1   | 设 `MCP_HTTP_HOST=0.0.0.0` 并检查防火墙                         |
| Popup 显示未知 IP   | 不认识的远程客户端     | 点击 ✕ 踢出该会话                                               |
| Windows 路径问题    | `\` 未转义             | JSON 中用 `\\` 或 `/`                                           |
