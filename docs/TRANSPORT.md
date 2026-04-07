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

## 推荐

- 一般桌面 AI 客户端：优先 **Streamable HTTP** 指向本机 bridge。
- 仅当客户端只支持 stdio 时使用 **`mcp-chrome-stdio`**，并确保 MCP 宿主进程正确管理子进程生命周期。
