# 统一错误码目录

本文档汇总 Chrome MCP Server 各层的错误码、错误常量和错误消息。
当你遇到错误时，可按错误码前缀快速定位来源模块。

---

## 错误码命名规范

| 前缀    | 来源模块      | 说明                                 |
| ------- | ------------- | ------------------------------------ |
| `CONN_` | 连接层        | Native Messaging、WebSocket 通信错误 |
| `MCP_`  | MCP 协议层    | Session 管理、请求处理               |
| `TOOL_` | 工具执行层    | 工具调用失败、参数校验               |
| `RR_`   | Record-Replay | 录制回放引擎错误                     |
| `CLI_`  | CLI 命令      | doctor/smoke/register 等命令错误     |
| `HTTP_` | HTTP 服务     | Fastify 路由级错误                   |

---

## 连接层错误 (CONN\_)

定义位置：`app/native-server/src/constant/index.ts` → `ERROR_MESSAGES`  
定义位置：`app/chrome-extension/common/constants.ts` → `ERROR_MESSAGES`

| 错误常量                    | 消息                                   | 触发场景                                   |
| --------------------------- | -------------------------------------- | ------------------------------------------ |
| `NATIVE_HOST_NOT_AVAILABLE` | Native host connection not established | Native Messaging 连接未建立时收到 MCP 请求 |
| `NATIVE_CONNECTION_FAILED`  | （扩展侧）连接 Native host 失败        | 注册信息错误或 bridge 未安装               |
| `NATIVE_DISCONNECTED`       | （扩展侧）Native host 连接断开         | bridge 进程崩溃或被终止                    |
| `SERVER_STATUS_LOAD_FAILED` | （扩展侧）加载服务状态失败             | storage 读取异常                           |
| `SERVER_STATUS_SAVE_FAILED` | （扩展侧）保存服务状态失败             | storage 写入异常                           |

### Chrome 原生 Native Messaging 错误

这些由 Chrome 直接报告，非项目定义：

| 错误消息                                                     | 原因                           | 修复                     |
| ------------------------------------------------------------ | ------------------------------ | ------------------------ |
| `Specified native messaging host not found`                  | manifest 未注册                | `tabrix register`        |
| `Access to the specified native messaging host is forbidden` | 扩展 ID 不在 `allowed_origins` | 重新 `register`          |
| `Native host has exited`                                     | bridge 进程异常退出            | 查看 logs，运行 `doctor` |
| `Error when communicating with the native messaging host`    | 非法 JSON 输出                 | 确认 Node.js >= 20       |

---

## MCP 协议层错误 (MCP\_)

定义位置：`app/native-server/src/constant/index.ts` → `ERROR_MESSAGES`  
定义位置：`app/native-server/src/server/index.ts`

| 错误常量                       | HTTP 状态码 | 消息                                                | 触发场景                |
| ------------------------------ | ----------- | --------------------------------------------------- | ----------------------- |
| `SERVER_NOT_RUNNING`           | 503         | Server is not actively running                      | 服务处于非运行状态      |
| `INVALID_MCP_REQUEST`          | 400         | Invalid MCP request or session                      | 请求格式不合法          |
| `INVALID_SESSION_ID`           | 400         | Invalid or missing MCP session ID                   | sessionId 缺失或不存在  |
| `INVALID_SSE_SESSION`          | 400/405     | （多行）SSE/GET /mcp 需有效 session                 | SSE 会话管理异常        |
| `REQUEST_TIMEOUT`              | 504         | Request to extension timed out                      | 扩展响应超时            |
| `MCP_SESSION_DELETION_ERROR`   | 500         | Internal server error during MCP session deletion   | 删除 session 时内部错误 |
| `MCP_REQUEST_PROCESSING_ERROR` | 500         | Internal server error during MCP request processing | 处理请求时内部错误      |
| `INTERNAL_SERVER_ERROR`        | 500         | Internal Server Error                               | 未分类的服务端错误      |

---

## 工具执行层错误 (TOOL\_)

定义位置：`app/native-server/src/mcp/register-tools.ts`  
定义位置：`app/native-server/src/execution/result-normalizer.ts`  
定义位置：`app/chrome-extension/common/constants.ts` → `ERROR_MESSAGES`

### MCP 工具返回的 errorCode

| errorCode 字符串                | 说明                   | 触发场景                                            |
| ------------------------------- | ---------------------- | --------------------------------------------------- |
| `tool_not_available`            | 工具不可用             | 请求的工具名不在已注册列表中                        |
| `tool_call_error`               | 工具调用失败（归一化） | 工具执行返回 isError，由 result-normalizer 统一包装 |
| `tool_call_exception`           | 工具调用异常           | 工具执行过程抛出未捕获异常                          |
| `dynamic_flow_error`            | 动态流程错误           | Record-Replay 流程执行失败                          |
| `dynamic_flow_resolution_error` | 动态流程解析错误       | 流程 JSON 解析或参数校验失败                        |

### 扩展侧工具错误常量

| 错误常量                | 说明                              |
| ----------------------- | --------------------------------- |
| `TOOL_EXECUTION_FAILED` | 工具执行失败（通用）              |
| `INVALID_PARAMETERS`    | 参数校验失败                      |
| `PERMISSION_DENIED`     | 权限不足（如 chrome:// 页面限制） |
| `TAB_NOT_FOUND`         | 指定的 tabId 不存在               |
| `ELEMENT_NOT_FOUND`     | CSS/XPath 选择器未匹配到元素      |
| `NETWORK_ERROR`         | 网络请求失败                      |

---

## Record-Replay 错误 (RR\_)

### V3 引擎 (`RR_ERROR_CODES`)

定义位置：`app/chrome-extension/entrypoints/background/record-replay-v3/domain/errors.ts`

使用 `RRError` 类，包含 `code`、`message`、可选 `data`/`retryable`/`cause`。

| 错误码                   | 说明              | 可重试 |
| ------------------------ | ----------------- | ------ |
| `VALIDATION_ERROR`       | 流程/步骤校验失败 | 否     |
| `UNSUPPORTED_NODE`       | 不支持的节点类型  | 否     |
| `DAG_INVALID`            | DAG 结构无效      | 否     |
| `DAG_CYCLE`              | DAG 中存在循环    | 否     |
| `TIMEOUT`                | 操作超时          | 是     |
| `TAB_NOT_FOUND`          | 标签页不存在      | 否     |
| `FRAME_NOT_FOUND`        | iframe 不存在     | 否     |
| `TARGET_NOT_FOUND`       | 目标元素未找到    | 是     |
| `ELEMENT_NOT_VISIBLE`    | 元素不可见        | 是     |
| `NAVIGATION_FAILED`      | 页面导航失败      | 是     |
| `NETWORK_REQUEST_FAILED` | 网络请求失败      | 是     |
| `SCRIPT_FAILED`          | 脚本执行失败      | 否     |
| `PERMISSION_DENIED`      | 权限不足          | 否     |
| `TOOL_ERROR`             | 工具调用错误      | 否     |
| `RUN_CANCELED`           | 执行被取消        | 否     |
| `RUN_PAUSED`             | 执行被暂停        | 否     |
| `INTERNAL`               | 内部错误          | 否     |
| `INVARIANT_VIOLATION`    | 不变量违反        | 否     |

### V2 Action 层 (`ActionErrorCode`)

定义位置：`app/chrome-extension/entrypoints/background/record-replay/actions/types.ts`

| 错误码                   | 对应 V3 错误码           |
| ------------------------ | ------------------------ |
| `VALIDATION_ERROR`       | `VALIDATION_ERROR`       |
| `TIMEOUT`                | `TIMEOUT`                |
| `TAB_NOT_FOUND`          | `TAB_NOT_FOUND`          |
| `FRAME_NOT_FOUND`        | `FRAME_NOT_FOUND`        |
| `TARGET_NOT_FOUND`       | `TARGET_NOT_FOUND`       |
| `ELEMENT_NOT_VISIBLE`    | `ELEMENT_NOT_VISIBLE`    |
| `NAVIGATION_FAILED`      | `NAVIGATION_FAILED`      |
| `NETWORK_REQUEST_FAILED` | `NETWORK_REQUEST_FAILED` |
| `DOWNLOAD_FAILED`        | —                        |
| `ASSERTION_FAILED`       | —                        |
| `SCRIPT_FAILED`          | `SCRIPT_FAILED`          |
| `UNKNOWN`                | `INTERNAL`               |

---

## HTTP 状态码约定

定义位置：`app/native-server/src/constant/index.ts` → `HTTP_STATUS`

| 常量                    | 值  | 使用场景               |
| ----------------------- | --- | ---------------------- |
| `OK`                    | 200 | 正常响应               |
| `ACCEPTED`              | 202 | MCP SSE 初始化完成     |
| `BAD_REQUEST`           | 400 | 参数错误、无效 session |
| `NOT_FOUND`             | 404 | 路由不存在             |
| `METHOD_NOT_ALLOWED`    | 405 | HTTP 方法不匹配        |
| `INTERNAL_SERVER_ERROR` | 500 | 服务端内部错误         |
| `SERVICE_UNAVAILABLE`   | 503 | 服务不可用             |
| `GATEWAY_TIMEOUT`       | 504 | 扩展响应超时           |

---

## 超时常量

定义位置：`app/native-server/src/constant/index.ts` → `TIMEOUTS`

| 常量                         | 默认值         | 说明                 |
| ---------------------------- | -------------- | -------------------- |
| `DEFAULT_REQUEST_TIMEOUT_MS` | 120000 (2min)  | MCP 工具调用默认超时 |
| `HEALTH_CHECK_TIMEOUT_MS`    | 5000           | 健康检查超时         |
| `SESSION_IDLE_TIMEOUT_MS`    | 600000 (10min) | SSE session 空闲超时 |

---

## 消息类型常量

定义位置：`app/native-server/src/constant/index.ts` → `NATIVE_MESSAGE_TYPE`  
定义位置：`packages/shared/src/types.ts` → `NativeMessageType`

Native Messaging 层使用消息类型来区分请求/响应/错误：

| 类型                     | 说明                           |
| ------------------------ | ------------------------------ |
| `MCP_REQUEST`            | MCP 请求（server → extension） |
| `MCP_RESPONSE`           | MCP 响应（extension → server） |
| `ERROR`                  | 通用错误                       |
| `ERROR_FROM_NATIVE_HOST` | Native host 层错误             |
| `TOOL_CALL`              | 工具调用请求                   |
| `TOOL_RESULT`            | 工具调用结果                   |

---

## 改进计划

当前项目使用多处分散的字符串常量定义错误。后续建议：

1. **统一 ErrorCode 枚举**：在 `packages/shared` 中定义全局 `ErrorCode` 枚举，各模块引用
2. **结构化错误响应**：所有 HTTP 和 MCP 错误统一为 `{ code: string, message: string, details?: unknown }`
3. **错误码前缀化**：按本文档的前缀规范（CONN*/MCP*/TOOL*/RR*）重命名现有常量
4. **国际化**：错误消息支持 i18n，分离错误码和展示文案
