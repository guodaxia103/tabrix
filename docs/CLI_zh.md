# Tabrix CLI 命令参考

## 可执行命令

- `tabrix`：主命令行入口。
- `tabrix-stdio`：stdio MCP 服务入口。

## 远程认证提醒

- 远程模式（`0.0.0.0` / 局域网）必须使用 Bearer Token。
- Token 可在扩展弹窗的 `Token 管理` 页面查看、复制与刷新。
- Token 有效期可在 `Token 管理` 刷新时自定义。
- `MCP_AUTH_TOKEN_TTL` 可设置默认有效天数（`0` 为永不过期）。

## 主要命令

| 命令                        | 作用                         | 常见场景                               |
| --------------------------- | ---------------------------- | -------------------------------------- |
| `tabrix setup`              | 首次安装引导。               | 新机器首次安装。                       |
| `tabrix register`           | 注册 Native Messaging Host。 | 手动注册/重注册。                      |
| `tabrix fix-permissions`    | 修复本地执行权限。           | 脚本或 host 权限报错。                 |
| `tabrix update-port <port>` | 更新 stdio 配置端口。        | 自定义端口对齐。                       |
| `tabrix status`             | 查看本地服务运行状态。       | 使用前快速健康检查。                   |
| `tabrix doctor`             | 诊断安装与运行问题。         | 排查连接与环境问题。                   |
| `tabrix config`             | 打印 MCP 客户端连接配置。    | 查看本地/远程/stdio 配置与当前 token。 |
| `tabrix clients`            | 查看 MCP 客户端连接状态。    | 检查当前活跃客户端组与最近会话。       |
| `tabrix smoke`              | 浏览器链路冒烟测试。         | 端到端验证（含 Chrome）。              |
| `tabrix stdio-smoke`        | stdio 链路冒烟测试。         | 只验证 stdio 模式。                    |
| `tabrix report`             | 生成诊断报告。               | 提交 issue 时附带上下文。              |
| `tabrix daemon <action>`    | 管理守护进程生命周期。       | 后台常驻模式。                         |

## 推荐主命令集

如果只记一套稳定心智模型，优先记这几个：

1. `tabrix setup`：首次安装与下一步引导。
2. `tabrix status`：快速健康检查。
3. `tabrix doctor --fix`：诊断并自动修复常见问题。
4. `tabrix config`：直接打印可复制的 MCP 连接配置。
5. `tabrix clients`：查看当前是谁连着。
6. `tabrix smoke`：验证真实浏览器链路是否端到端正常。
7. `tabrix report --copy`：导出排障上下文。

其他命令继续保留，但更适合视作高级命令或兼容命令，而不是默认日常主命令集。

## 常用参数

- `tabrix register --browser <chrome|chromium|all>`：按浏览器目标注册。
- `tabrix register --detect`：自动探测已安装浏览器。
- `tabrix doctor --fix`：自动修复常见问题。
- `tabrix report --copy`：将 Markdown 诊断复制到剪贴板。
- `tabrix report --output <file>`：诊断输出到文件。
- `tabrix status --json`：机器可读状态输出。
- `tabrix config --json`：机器可读 MCP 配置输出。
- `tabrix clients --json`：机器可读客户端/会话快照输出。
- `tabrix smoke --json`：机器可读冒烟输出。
- `tabrix smoke --separate-window`：在独立浏览器窗口中运行 smoke，而不是默认在当前窗口里开临时标签页。

## 高级 / 兼容命令

- `tabrix register`：保留为手动注册与重注册入口。
- `tabrix fix-permissions`：保留为权限损坏时的定向修复命令。
- `tabrix update-port <port>`：保留为低频高级命令，用于自定义端口对齐。
- `tabrix stdio-smoke`：保留为显式的 stdio 传输验证命令，不和普通浏览器 smoke 混在一起。
- `tabrix daemon <action>`：继续放在统一命名空间下，属于运维型命令，不是日常交互主命令。

## Daemon 子动作

- `tabrix daemon start`
- `tabrix daemon stop`
- `tabrix daemon status`
- `tabrix daemon install-autostart`
- `tabrix daemon remove-autostart`

## 快速流程

```bash
# 1) 首次安装
tabrix setup

# 2) 完整校验
tabrix status
tabrix doctor
tabrix config
tabrix clients
tabrix smoke

# 3) 排障并生成报告
tabrix doctor --fix
tabrix report --copy
```
