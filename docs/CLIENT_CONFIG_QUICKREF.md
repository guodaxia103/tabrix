# MCP 客户端配置速查卡

> 所有客户端均连接到同一个本地 MCP 服务，默认端口 **12306**。
> 如果你修改了端口，请将下方示例中的 `12306` 替换为实际端口。

## 前置条件

1. Chrome 扩展已加载并点击 **Connect**
2. `tabrix` 已全局安装（`npm i -g @tabrix/tabrix@latest`）
3. 运行 `tabrix doctor` 确认一切正常

---

## Streamable HTTP（推荐）

适用于支持 HTTP 传输的客户端。只需提供一个 URL 即可。

### Claude Desktop

配置文件：`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）
或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）

```json
{
  "mcpServers": {
    "tabrix": {
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
    "tabrix": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add tabrix --transport http http://127.0.0.1:12306/mcp
```

或手动编辑 `~/.claude.json`：

```json
{
  "mcpServers": {
    "tabrix": {
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
    "tabrix": {
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
    "tabrix": {
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
    "tabrix": {
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

## stdio 传输（备用方案）

适用于只支持 stdio 的客户端，或网络受限环境。

先找到 stdio 脚本路径：

```bash
# npm
npm list -g @tabrix/tabrix
# 输出路径 + /node_modules/@tabrix/tabrix/dist/mcp/mcp-server-stdio.js

# pnpm
pnpm list -g @tabrix/tabrix
```

### 全局安装后直接使用（推荐）

`npm i -g @tabrix/tabrix@latest` 后，`tabrix-stdio` 命令即可用：

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "tabrix-stdio"
    }
  }
}
```

### node + 绝对路径

如果 `tabrix-stdio` 命令不在 PATH 中：

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "node",
      "args": ["/path/to/node_modules/@tabrix/tabrix/dist/mcp/mcp-server-stdio.js"]
    }
  }
}
```

### npx 方式（无需提前全局安装）

```json
{
  "mcpServers": {
    "tabrix": {
      "command": "npx",
      "args": ["-p", "@tabrix/tabrix", "tabrix-stdio"]
    }
  }
}
```

> Windows 下如果 `tabrix-stdio` 找不到，尝试 `tabrix-stdio.cmd` 或使用 node + 绝对路径方式。

---

## 环境变量

| 变量名                        | 说明                                                                                             | 默认值       |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| `MCP_HTTP_PORT`               | MCP HTTP 端口                                                                                    | `12306`      |
| `MCP_HTTP_HOST`               | 监听地址覆盖（优先级高于 `~/.tabrix/config.json`；推荐用扩展开关代替）                           | `127.0.0.1`  |
| `MCP_AUTH_TOKEN`              | 远程访问 Bearer Token（可选，设置后优先使用该值）                                                | （未设置）   |
| `MCP_AUTH_TOKEN_TTL`          | Token 过期天数（`0` = 永不过期）                                                                 | `7`          |
| `MCP_ALLOWED_WORKSPACE_BASE`  | 额外允许的工作目录                                                                               | （无）       |
| `CHROME_MCP_NODE_PATH`        | 覆盖 Node.js 可执行文件路径                                                                      | （自动检测） |
| `ENABLE_MCP_TOOLS`            | 白名单模式：只暴露指定工具（逗号分隔）                                                           | （全部）     |
| `DISABLE_MCP_TOOLS`           | 黑名单模式：隐藏指定工具（逗号分隔）                                                             | （无）       |
| `MCP_DISABLE_SENSITIVE_TOOLS` | 设为 `true` 禁用高风险工具 (`chrome_javascript`, `chrome_bookmark_delete`, `chrome_upload_file`) | `false`      |

---

## 验证连接

```bash
# 检查服务状态
tabrix status

# 全面诊断
tabrix doctor

# 冒烟测试（调用几个工具看是否正常）
tabrix smoke
```

或在浏览器中访问 `http://127.0.0.1:12306/status` 查看服务状态、有效活跃客户端和最近会话状态。

---

## 有效活跃客户端管理

扩展 Popup 主列表现在展示的是“有效活跃客户端 / 活跃 MCP 会话”，不是原始 session dump。它会实时显示：

- **客户端名称**（如 `cursor/1.0.0`、`claude-desktop`）
- **来源 IP**（本地显示 `127.0.0.1`，远程显示实际 IP 如 `192.168.1.100`）
- **活跃 MCP 会话数**（同一客户端重复重连会被归并）
- **最近活跃时间**

如果发现不认识的 IP 连接，可以点击客户端右侧的 **✕** 按钮立即断开该客户端组对应的全部活跃会话。

`/status` 中对应语义如下：

- `data.transports.clients`：仅 `active` 客户端组，供 Popup 主列表使用
- `data.transports.sessions`：最近的 `active / stale / disconnected` 会话快照，供排障使用
- `data.transports.cleanup`：stale 清理阈值与最近一次 sweep 信息

> 提示：当没有有效活跃客户端时，Popup 会显示“当前没有有效活跃的 MCP 客户端”。

---

## 远程连接（跨机器 / Docker）

默认产品主线路径是 `Remote (Streamable HTTP)`。在 Popup 中，当本地服务进入可用状态后，会自动确保远程访问已开启且 Bearer Token 已就绪。若需要从其他机器或 Docker 容器中连接：

**第一步：启用远程监听**

**推荐**：打开扩展弹窗 → **远程** 选项卡 → 打开**远程访问开关**。服务立即重启在 `0.0.0.0`，无需重启浏览器。偏好持久化到 `~/.tabrix/config.json`。

高级 / 守护进程场景也可通过环境变量覆盖（优先级高于配置文件）：

```bash
# Linux/macOS
export MCP_HTTP_HOST=0.0.0.0

# Windows PowerShell
$env:MCP_HTTP_HOST = "0.0.0.0"
```

**第二步：确认 Token 认证**

开启远程后，请在扩展 Popup 的「Token 管理」页面确认当前 Token，并复制包含 `Authorization` 头的完整配置。你可以在“重新生成 Token”时自定义有效天数（`0` = 永不过期）。

也可通过环境变量手动指定：

```powershell
# Windows PowerShell
[Environment]::SetEnvironmentVariable("MCP_AUTH_TOKEN", "your-secret-token", "User")
```

本机（`127.0.0.1`）请求免 Token，远程 IP 必须携带 `Authorization: Bearer <token>` 头。

**第三步：开放 Windows 防火墙**（管理员 PowerShell）

```powershell
netsh advfirewall firewall add rule name="Tabrix MCP Bridge" dir=in action=allow protocol=tcp localport=12306
```

**第四步：在远程 AI 客户端中配置**

扩展 Popup 的配置模板会自动识别本机 LAN IP 并显示在配置 JSON 中（优先 WLAN/Ethernet，过滤 VPN/虚拟网卡）。直接复制即可使用。

也可以手动将 `127.0.0.1` 替换为浏览器所在机器的局域网 IP：

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://192.168.1.100:12306/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-token"
      }
    }
  }
}
```

**第五步：确认连接**

在扩展 Popup 的「已连接的客户端」列表中，应能看到远程 IP 和客户端名称。不认识的 IP 可以直接踢出。

**第六步（Docker 场景）**

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://host.docker.internal:12306/mcp"
    }
  }
}
```

> Token 默认 7 天过期；可通过 `MCP_AUTH_TOKEN_TTL` 调整默认值，或在 Popup「Token 管理」中重新生成并自定义有效天数。

---

## 常见问题

| 症状                | 原因                     | 解决方案                                                                        |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| Connection refused  | 服务未启动               | 打开扩展 popup 点击 Connect                                                     |
| Tools not appearing | 配置文件 JSON 语法错误   | 用 JSON 校验器检查配置                                                          |
| Port conflict       | 12306 端口被占用         | 在扩展设置中修改端口，然后更新客户端配置                                        |
| Docker 容器无法连接 | 127.0.0.1 指向容器内部   | 用扩展远程开关或设 `MCP_HTTP_HOST=0.0.0.0`，用宿主 IP 或 `host.docker.internal` |
| 远程连接被拒绝      | 默认只监听 127.0.0.1     | 用扩展远程开关开启，或设 `MCP_HTTP_HOST=0.0.0.0` 并检查防火墙                   |
| 远程连接返回 401    | Token 缺失/不匹配/已过期 | 从 Popup 远程 Tab 复制最新 Token；过期则点"重新生成"                            |
| Popup 显示未知 IP   | 不认识的远程客户端       | 点击 ✕ 踢出该会话                                                               |
| Windows 路径问题    | `\` 未转义               | JSON 中用 `\\` 或 `/`                                                           |
