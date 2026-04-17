# 发布前检查清单（Phase 0）

这是发布扩展包、交付本地 bridge 或进行本机冷启动验收的最小闭环清单。  
目标不是“命令能跑”，而是让用户首装链路从 install 到可用完整闭环。

建议执行顺序：  
`build -> setup/register -> connect -> status -> doctor -> smoke -> MCP client`

## 1. 构建闸门

在仓库根目录执行：

```powershell
pnpm lint
pnpm typecheck
pnpm --filter @tabrix/extension test
pnpm --filter @tabrix/tabrix test
pnpm build
pnpm run audit
```

通过标准：

- 上述命令全部返回码 0；
- `pnpm build` 产出 native-server 与 extension；
- `pnpm run docs:check` 与 `pnpm run i18n:check` 如发布分支有变更可额外执行。

## 2. 本地安装与注册

```powershell
pnpm -C app/native-server build
tabrix setup
```

首次安装或注册异常时执行：

```powershell
tabrix register
```

通过标准：

- Native Messaging manifest 指向当前构建产物；
- 注册/安装后能在 Chrome 扩展页看到对应拓展且路径稳定。

## 3. 扩展连接检查

在 Chrome 中确认：

1. 打开 `chrome://extensions/`
2. 扩展已加载且路径正确（优先固定到当前 build 输出目录）
3. 打开扩展 popup，点击 `Connect`
4. popup 中显示服务连接正常

通过标准：

- 服务端口与本机配置一致；
- 本机端 token 与远程配置展示一致（如已开启远程）。

## 4. 运行时健康检查

```powershell
tabrix status --json
tabrix doctor --json
tabrix smoke --json
```

通过标准：

- `status --json`
  - `status = ok`
  - `isRunning = true`
- `doctor --json`
  - `ok = true`
  - 关键项（Connectivity / Runtime status / MCP initialize）为 `ok`
- `smoke --json`
  - `ok = true`
  - `chrome_screenshot` / `chrome_computer` / `chrome_upload_file` / `performance_trace` 可执行
  - 默认流程不引入桌面模态弹窗干扰。

## 5. MCP 客户端接入检查

至少验证一个支持 Streamable HTTP 的客户端：

- Claude Desktop / Claude Code / Cherry Studio / Codex（任一）

推荐配置（可按客户端实际格式调整）：

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

通过标准：

- 初始化成功；
- 工具列表可拉取；
- 至少完成一次真实工具调用：`get_windows_and_tabs`、`chrome_read_page`、`chrome_screenshot`。

## 6. 守护进程与远程入口

```powershell
tabrix daemon start
tabrix daemon status
tabrix daemon stop
```

通过标准：

- `daemon start`/`stop` 可正常执行；
- `daemon status` 显示健康运行；
- 需要 `config`/`clients` 时，能够拿到当前客户端连接与配置。

## 7. 发布阻断项

出现以下任一项时，不建议发布：

- `lint / typecheck / test / build` 任一失败；
- `doctor` 报错；
- `smoke` 失败；
- 扩展加载路径与当前构建目录不一致；
- 客户端初始化成功但工具调用失败；
- 远程 Token 验证链路不通（无 Token 可访问 / 有效 Token 被拒）。

## 8. 第三方复用合规检查（如适用）

如本次变更涉及复用，请额外确认：

- 对应条目已进入 `docs/THIRD_PARTY_REUSE_MATRIX.md`；
- 代码复用和设计借鉴均有来源记录；
- `NOTICE` 与许可证复核完成（如涉及）；
- 复用边界记录完整。

## 9. 里程碑基线

本清单可作为发布前可复用的最低验收基线，并在版本变化后按该顺序更新。
