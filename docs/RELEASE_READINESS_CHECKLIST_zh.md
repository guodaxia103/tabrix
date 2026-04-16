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
pnpm --filter @tabrix/extension test
pnpm --filter @tabrix/tabrix test
pnpm build
```

补充说明：

- `pnpm run audit` 现在会走仓库内置的 OSV 生产依赖审计，不再依赖已退役的 npm 旧审计端点。
- 若审计门禁异常，先查看：
  [`docs/OSV_AUDIT_GATE_zh.md`](./OSV_AUDIT_GATE_zh.md)

通过标准：

- 所有命令退出码为 `0`
- `pnpm build` 同时产出扩展和 native bridge
- 扩展构建不再出现已知的 `runner deprecated`、`BigInt target`、`:deep(...)` 压缩告警

---

## 2. 本地安装与注册

如果是源码仓验证，先确保 native bridge 已构建：

```powershell
pnpm --filter @tabrix/tabrix build
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

## 6. 守护进程验证

```powershell
tabrix daemon start
tabrix daemon status
curl http://127.0.0.1:12306/ping
tabrix daemon stop
```

通过标准：

- `daemon start` 成功返回 pid
- `daemon status` 显示 `running=true, healthy=true`
- `/ping` 返回 `200`
- `daemon stop` 成功终止进程
- `~/.tabrix/daemon.log` 有启动日志输出
- （Windows）`daemon install-autostart` / `daemon remove-autostart` 不报错

---

## 7. 远程访问验证

打开扩展弹窗 → **远程** 选项卡 → 打开**远程访问开关**（无需重启 Chrome）。

通过标准：

- 开关切换后服务立即重启在 `0.0.0.0`，Popup 远程 Tab 显示 Token、局域网 IP 和完整配置
- 关闭开关 → 断开重连 → 重启浏览器，远程保持关闭（偏好持久化到 `~/.tabrix/config.json`）
- 开启开关 → 断开重连 → 重启浏览器，远程保持开启
- 从同一局域网的另一台设备/容器能访问 `http://<LAN-IP>:12306/ping`
- 携带 `Authorization: Bearer <token>` 请求 `/mcp` 能成功 `initialize`
- 不带 Token 的远程请求返回 `401`
- localhost 请求免 Token（本机豁免）
- Token 过期后刷新能拿到新 Token

---

## 8. stdio 传输验证

```powershell
# 查看 stdio 入口文件路径
npm list -g @tabrix/tabrix
```

通过标准：

- stdio 入口文件 `mcp-server-stdio.js` 存在且可执行
- 客户端通过 stdio 配置能连接并调用工具
- 扩展 Popup 中 stdio Tab 正常显示

---

## 9. 发布阻断项

出现以下任一情况时，不建议发布：

- 根级 `lint / typecheck / build / test` 任一失败
- `doctor` 出现 `error`
- `smoke` 失败或重新出现系统弹窗干扰
- 扩展构建重新出现已知告警回归
- Chrome 实际加载的扩展路径与当前构建目录不一致
- 客户端能连上 `/mcp`，但工具调用失败
- `daemon start` 后 `daemon status` 显示 unhealthy 或无日志输出
- 远程模式下 Token 验证流程不通（无 Token 能访问 / 有效 Token 被拒）
- 本次发布涉及第三方复用，但缺少来源记录、设计参考记录或 `NOTICE` 更新
- 本次发布引用了未进入复用矩阵的重点外部项目
- `AGPL`、商业许可、混合许可或目录级例外没有完成人工复核

---

## 10. 第三方复用合规检查

如果本次版本触及外部复用，请额外确认：

- 已检查复用矩阵与第三方来源记录
- 重点外部项目分类完整
- `代码复用` 已补来源记录
- `设计借鉴` 已补设计参考记录
- 需要时已更新根目录 `NOTICE`
- 许可证边界已经人工复核

---

## 11. 2026-04-08 当前基线

本仓库在 `2026-04-08` 已重新实测通过：

- `pnpm --filter @tabrix/extension build`
- `pnpm build`
- `node app\native-server\dist\cli.js status --json`
- `node app\native-server\dist\cli.js doctor --json`
- `node app\native-server\dist\cli.js smoke --json`

当前可视为一份可复用的 Phase 0 发布前最小验收基线。
