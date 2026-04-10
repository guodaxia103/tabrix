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

| 命令                        | 作用                         | 常见场景                  |
| --------------------------- | ---------------------------- | ------------------------- |
| `tabrix setup`              | 首次安装引导。               | 新机器首次安装。          |
| `tabrix register`           | 注册 Native Messaging Host。 | 手动注册/重注册。         |
| `tabrix fix-permissions`    | 修复本地执行权限。           | 脚本或 host 权限报错。    |
| `tabrix update-port <port>` | 更新 stdio 配置端口。        | 自定义端口对齐。          |
| `tabrix status`             | 查看本地服务运行状态。       | 使用前快速健康检查。      |
| `tabrix doctor`             | 诊断安装与运行问题。         | 排查连接与环境问题。      |
| `tabrix smoke`              | 浏览器链路冒烟测试。         | 端到端验证（含 Chrome）。 |
| `tabrix stdio-smoke`        | stdio 链路冒烟测试。         | 只验证 stdio 模式。       |
| `tabrix report`             | 生成诊断报告。               | 提交 issue 时附带上下文。 |
| `tabrix daemon <action>`    | 管理守护进程生命周期。       | 后台常驻模式。            |

## 常用参数

- `tabrix register --browser <chrome|chromium|all>`：按浏览器目标注册。
- `tabrix register --detect`：自动探测已安装浏览器。
- `tabrix doctor --fix`：自动修复常见问题。
- `tabrix report --copy`：将 Markdown 诊断复制到剪贴板。
- `tabrix report --output <file>`：诊断输出到文件。
- `tabrix status --json`：机器可读状态输出。
- `tabrix smoke --json`：机器可读冒烟输出。

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
tabrix smoke

# 3) 排障并生成报告
tabrix doctor --fix
tabrix report --copy
```
