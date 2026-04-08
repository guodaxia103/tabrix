# 发布前检查清单（Phase 0）

这份清单用于发布扩展包、交付本地 bridge，或在本机做一次完整冷启动验收。

目标不是“命令能跑”，而是确认用户首装链路中的关键环节都已经闭环：

`build -> setup/register -> connect -> status -> doctor -> smoke -> MCP client`

---

## 1. 构建闸门

在仓库根目录运行：

```powershell
pnpm lint
pnpm typecheck
pnpm --filter chrome-mcp-server test
pnpm --filter mcp-chrome-bridge test
pnpm build
```

通过标准：

- 所有命令退出码为 `0`
- `pnpm build` 同时产出扩展和 native bridge
- 扩展构建不再出现已知的 `runner deprecated`、`BigInt target`、`:deep(...)` 压缩告警

---

## 2. 本地安装与注册

如果是源码仓验证，先确保 native bridge 已构建：

```powershell
pnpm --filter mcp-chrome-bridge build
```

首次安装或注册丢失时，执行：

```powershell
node app\native-server\dist\cli.js setup
```

如果只需要重新注册 Native Messaging：

```powershell
node app\native-server\dist\cli.js register
```

通过标准：

- Chrome Native Messaging manifest 指向当前 `dist\run_host.bat`
- Chrome 注册表项存在且路径正确
- 扩展已从固定目录加载，后续不要频繁切换 unpacked 路径

---

## 3. 扩展连接检查

在 Chrome 中确认：

1. 打开 `chrome://extensions/`
2. 扩展已加载且路径正确
3. 点击扩展 popup
4. 点击 `Connect`

通过标准：

- popup 显示服务已连接
- 端口与本地 bridge 配置一致
- 如启用了远程访问，popup 中能看到 token / LAN 信息

---

## 4. 运行时健康检查

建议按这个顺序执行：

```powershell
node app\native-server\dist\cli.js status --json
node app\native-server\dist\cli.js doctor --json
node app\native-server\dist\cli.js smoke --json
```

通过标准：

- `status --json`
  - `status` 为 `ok`
  - `isRunning=true`
  - `nativeHostAttached=true`
- `doctor --json`
  - `ok=true`
  - `summary.error=0`
  - `Connectivity`、`Runtime status`、`MCP initialize` 为 `ok`
- `smoke --json`
  - `ok=true`
  - `tools/list` 显示 `28 tools available`
  - `chrome_screenshot`、`chrome_computer`、`chrome_upload_file`、`performance_trace` 为 `ok`
  - 默认 smoke 不应再触发系统“另存为”窗口
  - 默认 smoke 会跳过 `chrome_handle_dialog` 的真实弹框步骤，避免桌面残留模态框

---

## 5. MCP 客户端接入检查

至少选择一个真实客户端验证：

- Claude Desktop
- Claude Code
- Cherry Studio
- 其他支持 Streamable HTTP 的 MCP 客户端

推荐配置：

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

通过标准：

- 客户端能成功 `initialize`
- 能拉取工具列表
- 至少完成一个真实工具调用，例如：
  - `get_windows_and_tabs`
  - `chrome_read_page`
  - `chrome_screenshot`

---

## 6. 发布阻断项

出现以下任一情况时，不建议发布：

- 根级 `lint / typecheck / build / test` 任一失败
- `doctor` 出现 `error`
- `smoke` 失败或重新出现系统弹窗干扰
- 扩展构建重新出现已知告警回归
- Chrome 实际加载的扩展路径与当前构建目录不一致
- 客户端能连上 `/mcp`，但工具调用失败

---

## 7. 2026-04-08 当前基线

本仓库在 `2026-04-08` 已重新实测通过：

- `pnpm --filter chrome-mcp-server build`
- `pnpm build`
- `node app\native-server\dist\cli.js status --json`
- `node app\native-server\dist\cli.js doctor --json`
- `node app\native-server\dist\cli.js smoke --json`

当前可视为一份可复用的 Phase 0 发布前最小验收基线。
