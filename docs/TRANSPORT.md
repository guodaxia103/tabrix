# MCP 传输模式说明（HTTP / SSE / stdio）

> 对应任务 A7：客户端与部署方式不同时，请选对传输层。

## 概览

| 模式                | 典型场景                                           | 备注                                                  |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| **Streamable HTTP** | Cursor、Claude Desktop、CoPaw 等远程/本地 HTTP MCP | 默认：`http://127.0.0.1:<port>/mcp`（端口以本机为准） |
| **SSE**             | 旧版或仍使用 SSE 的 MCP 客户端                     | 需会话 ID 时见客户端文档                              |
| **stdio**           | `mcp-chrome-stdio` 子进程代理到本机 HTTP           | 父进程退出时应关闭 stdin；见 bridge 实现              |

## 行为差异（简述）

- **HTTP**：无状态请求居多；服务端可为每个 `initialize` 建立独立 MCP 实例（以当前实现为准）。
- **SSE**：长连接，注意会话 ID 与断线重连。
- **stdio**：标准输入输出承载 JSON-RPC；**父进程退出时子进程应随 stdin 关闭而退出**，避免僵尸进程。

## 远程访问

默认只监听 `127.0.0.1`。设置环境变量 `MCP_HTTP_HOST=0.0.0.0` 后，MCP 服务绑定到所有网络接口，允许其他机器或 Docker 容器通过局域网 IP 连接。

远程客户端配置示例：

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://<浏览器所在机器的局域网IP>:12306/mcp"
    }
  }
}
```

连接后可在扩展 Popup「已连接的客户端」列表中查看远程 IP 并踢出不认识的会话。

详见 [CLIENT_CONFIG_QUICKREF.md → 远程连接](./CLIENT_CONFIG_QUICKREF.md#远程连接跨机器--docker)。

## 推荐

- 一般桌面 AI 客户端：优先 **Streamable HTTP** 指向本机 bridge。
- 远程 / Docker 场景：设 `MCP_HTTP_HOST=0.0.0.0`，用宿主机 IP 连接。
- 仅当客户端只支持 stdio 时使用 **`mcp-chrome-stdio`**，并确保 MCP 宿主进程正确管理子进程生命周期。
