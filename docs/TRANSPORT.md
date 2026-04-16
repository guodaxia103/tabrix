# MCP 传输模式说明（Streamable HTTP / stdio）

> 对应任务 A7：客户端与部署方式不同时，请选对传输层。
> SSE 经典模式（`GET /sse` + `POST /messages`）已在 v2.12 移除。
> 当前阶段只将 `Streamable HTTP` 与 `stdio` 视为正式主线连接方式。

## 概览

| 模式                | 端点                  | 典型场景                                           | 备注                                                                  |
| ------------------- | --------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| **Streamable HTTP** | `POST /mcp`           | Cursor、Claude Desktop、CoPaw 等远程/本地 HTTP MCP | 当前主线；`http://127.0.0.1:<port>/mcp` 或 `http://LAN_IP:<port>/mcp` |
| **stdio**           | stdin/stdout JSON-RPC | Claude Code CLI 等不经网络的本地客户端             | 当前主线；子进程代理到本机 HTTP                                       |

> Popup 顶层产品模式也只允许这两种：`Remote (Streamable HTTP)` 与 `stdio`。`localhost HTTP` 仍然存在，但只作为 `Streamable HTTP` 的本机实现细节，不再作为第三种对外模式。

## 当前支持的连接方式详解

### 1. Streamable HTTP（推荐）

客户端向 `POST /mcp` 发送 JSON-RPC 请求（`initialize`、`tools/call` 等），服务端返回 JSON-RPC 响应。这是 MCP 规范推荐的标准传输方式。

```
客户端 → POST /mcp { "method": "initialize", ... }
服务端 ← 200 { "result": { "capabilities": ... } }
客户端 → POST /mcp { "method": "tools/list" }
服务端 ← 200 { "result": { "tools": [...] } }
```

**适用客户端**：Cursor、Claude Desktop、CoPaw、CherryStudio、Windsurf、Dify、MCP Inspector

### 2. Streamable HTTP 的事件流能力

Streamable HTTP 客户端在完成 `POST /mcp` initialize 后，可以用 `GET /mcp`（携带 `mcp-session-id` header）订阅服务端推送事件（如工具执行进度）。

说明：

- 这是 `Streamable HTTP` 的组成能力，不是单独对外宣传的第三种连接模式
- 当前产品文档、UI 和排障路径，均应围绕 `Streamable HTTP` 与 `stdio` 两种主线模式展开

### 3. stdio（标准输入/输出，备用但正式支持）

通过子进程 `tabrix-stdio` 桥接，AI 客户端直接通过 stdin/stdout 传输 JSON-RPC，子进程内部代理到本机 HTTP 服务。

```
AI 客户端 ↔ stdin/stdout ↔ tabrix-stdio ↔ HTTP 127.0.0.1:12306/mcp
```

**适用客户端**：Claude Code CLI、任何仅支持 stdio 的 MCP 宿主

## 行为差异（简述）

- **HTTP**：无状态请求居多；服务端为每个 `initialize` 建立独立 MCP 实例。支持并行多客户端。
- **stdio**：标准输入输出承载 JSON-RPC；**父进程退出时子进程应随 stdin 关闭而退出**，避免僵尸进程。

## 远程访问

默认只监听 `127.0.0.1`。开启远程后，MCP 服务绑定到所有网络接口（`0.0.0.0`），允许其他机器或 Docker 容器通过局域网 IP 连接。

### 开启方式

**方式一（推荐）：扩展 Popup 开关**

打开扩展弹窗 → **远程** 选项卡 → 打开**远程访问开关**。服务立即重启在 `0.0.0.0`，无需重启浏览器。偏好持久化到 `~/.tabrix/config.json`，断开重连或重启浏览器后保持不变。

当前 Popup 行为：

- 默认选中 `Remote (Streamable HTTP)` 选项卡
- 本地服务进入 `running` 后，会自动确保远程访问已开启
- 若缺少 Token，会在远程配置对外可复制前自动创建默认 Bearer Token

**方式二（高级 / 守护进程）：环境变量覆盖**

设置系统环境变量 `MCP_HTTP_HOST=0.0.0.0`（优先级高于配置文件）：

```powershell
# Windows PowerShell（系统级，重启后生效）
[Environment]::SetEnvironmentVariable("MCP_HTTP_HOST", "0.0.0.0", "User")
```

### 开放防火墙

Windows 需管理员权限：

```powershell
netsh advfirewall firewall add rule name="Tabrix MCP Bridge" dir=in action=allow protocol=tcp localport=12306
```

### 确认监听状态

```powershell
netstat -ano | findstr :12306
# 应显示 0.0.0.0:12306 LISTENING
```

### Popup 自动识别 LAN IP

监听 `0.0.0.0` 时，扩展 Popup 的远程配置会自动显示本机的实际局域网 IP（优先 WLAN/Ethernet，过滤 VPN/虚拟网卡），无需手动查找 IP。

### Token 认证

监听 `0.0.0.0` 时，远程请求必须携带 Bearer Token。Token 默认有效期 7 天，可通过 `MCP_AUTH_TOKEN_TTL` 环境变量调整（`0` = 永不过期）；也可在扩展 Popup「Token 管理」中重新生成时自定义有效天数。

也可以通过 `MCP_AUTH_TOKEN` 环境变量手动指定 Token（此时自动生成不生效，Token 永不过期）。

认证规则：

- **本机**（`127.0.0.1` / `::1`）请求**免 Token**
- **非本机** IP 请求需携带 `Authorization: Bearer <token>` 头，否则返回 `401 Unauthorized`
- `/ping`、`/status`、`/auth/token`、`/auth/refresh` 为公开端点

Token 管理端点（仅本机可用）：

- `GET /auth/token` — 查看当前 Token 信息
- `POST /auth/refresh` — 重新生成 Token（旧 Token 立即失效）

扩展 Popup 的「远程」Tab 会自动获取并显示当前 Token，可一键复制或刷新。

远程客户端配置示例：

```json
{
  "mcpServers": {
    "tabrix": {
      "url": "http://<浏览器所在机器的局域网IP>:12306/mcp",
      "headers": {
        "Authorization": "Bearer <从 Popup 复制的 Token>"
      }
    }
  }
}
```

连接后可在扩展 Popup「有效活跃客户端」列表中查看远程 IP 并踢出不认识的客户端组。

## `/status` 与客户端列表语义

`/status` 的 `data.transports` 现在分两层表达：

- `clients`：主列表语义。只返回 `active` 的客户端组，按 `clientIp + clientName + clientVersion` 归并，不再把原始 Streamable HTTP session dump 直接当成客户端列表。
- `sessions`：排障语义。返回最近的 `active / stale / disconnected` 会话快照。

新增最小治理字段：

- `lastSeenAt`：最近一次请求命中该会话的时间
- `state`：`active` / `stale` / `disconnected`
- `sessionStates`：三种状态的当前计数
- `cleanup`：当前 stale 判定阈值、终态保留时间、最近一次 sweep 信息

最小规则：

- `active`：仍在活跃窗口内的 MCP 会话，会出现在 Popup 主列表
- `stale`：超过阈值未再活动的旧会话，会被自动移出主列表并记录到最近终态列表
- `disconnected`：手动断开或客户端正常关闭的会话，不继续停留在主列表

详见 [CLIENT_CONFIG_QUICKREF.md → 远程连接](./CLIENT_CONFIG_QUICKREF.md)。

## 推荐

- 一般桌面 AI 客户端：优先 **Streamable HTTP** 指向本机 bridge。
- 远程 / Docker 场景：用扩展开关或设 `MCP_HTTP_HOST=0.0.0.0`，用宿主机 IP 连接。
- 仅当客户端只支持 stdio 时使用 **`tabrix-stdio`**，并确保 MCP 宿主进程正确管理子进程生命周期。

当前机器上的可复制连接配置可直接用：

- `tabrix config`

当前连接到服务的客户端和最近会话可直接用：

- `tabrix clients`

## 当前阶段优先级

对于 Tabrix 当前阶段，连接方式优先级明确如下：

1. `远程 Streamable HTTP`
2. `本机 stdio`

在远程 `Streamable HTTP` 尚未完全稳定前，不继续扩展更多连接模式，也不让其它模式分散排障与测试精力。
