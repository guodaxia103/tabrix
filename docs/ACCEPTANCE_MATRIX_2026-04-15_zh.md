# Tabrix 验收矩阵（2026-04-15）

这份矩阵用于回答 3 个问题：

1. 当前 `Tabrix` 到底哪些主线能力已经真实通过
2. 哪些能力只适合人工协作，不应混入无人值守通过率
3. 下一次发版前，哪些项目还需要继续补验收

本矩阵以 `2026-04-15` 当前仓库 `main` 为准，基于：

- 代码级门禁：
  - `pnpm -C app/chrome-extension typecheck`
  - `pnpm run test:core`
- 真实助手会话验收：
  - `powershell -ExecutionPolicy Bypass -File scripts\run-claude-acceptance.ps1 -Profile fast`
  - `powershell -ExecutionPolicy Bypass -File scripts\run-claude-acceptance.ps1 -Profile full`

并补充纳入本轮 `v2.0.8` 发布后验收：

- `tabrix status --json`
- `tabrix smoke --json`
- 发布后的扩展 reload / 版本对齐检查
- Windows 桌面黑窗回归观察

---

## 1. 当前结论

### 1.1 主结论

当前 `Claude` 主线无人值守验收已经通过。

通过的核心前提：

1. daemon 常驻可用
2. 扩展执行桥已就绪
3. `bridge.bridgeState=READY`
4. `commandChannelConnected=true`
5. 无人值守主线工具在真实会话中可连续完成
6. 验收结束后无监听残留、无临时标签页残留、无桌面阻塞弹框残留

### 1.2 `v2.0.8` 发布后追加结论

`v2.0.8` 发布后，本机再次完成了一轮发布后最小真实验收，结论如下：

1. 本地 CLI、daemon、扩展产物已统一到 `2.0.8`
2. `tabrix status --json` 返回：
   - `bridgeState=READY`
   - `commandChannelConnected=true`
   - `commandChannelType=websocket`
   - `runtimeConsistency.verdict=consistent`
3. `tabrix smoke --json` 通过
4. `Claude fast / full` 再次通过，无残留 `62100/62101` 监听
5. Windows 下验收辅助进程黑窗问题已补强，但仍建议后续继续观察真实桌面现场

### 1.3 当前不应误解的点

1. `nativeHostAttached=false` 不再代表 daemon 模式不可用
   - 当前 daemon 模式以 WebSocket 执行桥为准
2. `qwenpaw` 仅完成配置基线核对
   - 尚未纳入本轮真实工具验收通过范围
3. `chrome_request_element_selection` 仍然属于人工协作型工具
   - 不计入无人值守通过率

---

## 2. 运行基线矩阵

| 项目                  | 状态   | 说明                                                                |
| --------------------- | ------ | ------------------------------------------------------------------- |
| `tabrix daemon` 常驻  | 已通过 | `tabrix status --json` 可稳定返回                                   |
| `/status` bridge 快照 | 已通过 | 能返回 `bridgeState / commandChannelConnected / commandChannelType` |
| 浏览器关闭时状态归因  | 已通过 | 可返回 `BROWSER_NOT_RUNNING`                                        |
| 浏览器运行且扩展在线  | 已通过 | 可返回 `READY`                                                      |
| WebSocket 执行桥      | 已通过 | `commandChannelConnected=true`                                      |
| 运行实例一致性        | 已通过 | `Runtime instance matches current workspace build.`                 |

---

## 3. Claude 验收矩阵

### 3.1 `fast` 验收

| Case           | 类型       | 状态 | 结论                                      |
| -------------- | ---------- | ---- | ----------------------------------------- |
| `group-core-1` | unattended | 通过 | 标签页读取 / 页面读取 / 交互元素读取正常  |
| `group-core-2` | unattended | 通过 | 点击 / 填写 / 键盘 / JS / console 正常    |
| `group-core-3` | unattended | 通过 | 网络请求 / 网络捕获 / 截图 / history 正常 |
| `group-core-4` | unattended | 通过 | 书签增删查 / 静默下载正常                 |
| `group-core-5` | unattended | 通过 | `computer` / `performance trace` 正常     |

### 3.2 `full` 验收

| Case                         | 类型          | 状态 | 结论                                                                       |
| ---------------------------- | ------------- | ---- | -------------------------------------------------------------------------- |
| `group-core-1`               | unattended    | 通过 | 通过                                                                       |
| `group-core-2`               | unattended    | 通过 | 通过                                                                       |
| `group-core-3`               | unattended    | 通过 | 通过                                                                       |
| `group-core-4`               | unattended    | 通过 | 通过                                                                       |
| `group-core-5`               | unattended    | 通过 | 通过                                                                       |
| `group-full-1-dialog`        | unattended    | 通过 | 原生 `prompt` 已由 `chrome_handle_dialog` 成功接管，`#promptOut=tabrix-ok` |
| `group-full-2-gif`           | unattended    | 通过 | GIF 录制链路通过                                                           |
| `group-full-3-upload-select` | collaborative | 单列 | 文件上传通过；元素选择属于人工协作型，不计无人值守通过率                   |
| `group-full-4-close-tabs`    | unattended    | 通过 | 新窗口 / 切换 / 关闭标签页通过                                             |

---

## 4. 无人值守主线门禁结果

### 4.1 本轮已通过的无人值守能力

1. 导航
2. 页面读取
3. 交互元素读取
4. 点击
5. 输入 / 选择
6. 键盘快捷键
7. JavaScript 执行
8. Console 快照
9. 网络请求
10. 网络捕获
11. 截图
12. 下载（静默）
13. 书签增删查
14. 历史记录读取
15. Performance trace / insight
16. `computer` 截图能力
17. GIF 录制
18. 关闭标签页
19. 原生 dialog 处理

### 4.2 当前明确不纳入无人值守通过率的项目

1. `chrome_request_element_selection`
   - 原因：本质是人工协作型工具，需要用户参与选取

---

## 5. 这轮专门修透的阻塞项

### 5.1 `dialog` 真实会话阻塞

本轮之前，`group-full-1-dialog` 是唯一主线 blocker。最终修复包括：

1. 缩短验收页 `prompt()` 触发延迟
2. 点击后预热 dialog 会话，避免原生对话框出现时 debugger 会话附着过晚
3. 保持 `chrome_handle_dialog` 只走原生链路，不用 JS 注入绕过

相关代码：

- [app/native-server/src/scripts/smoke.ts](E:\projects\AI\copaw\mcp-chrome\app\native-server\src\scripts\smoke.ts)
- [scripts/claude-smoke-server.cjs](E:\projects\AI\copaw\mcp-chrome\scripts\claude-smoke-server.cjs)
- [app/chrome-extension/entrypoints/background/tools/browser/dialog-prearm.ts](E:\projects\AI\copaw\mcp-chrome\app\chrome-extension\entrypoints\background\tools\browser\dialog-prearm.ts)
- [app/chrome-extension/entrypoints/background/tools/browser/interaction.ts](E:\projects\AI\copaw\mcp-chrome\app\chrome-extension\entrypoints\background\tools\browser\interaction.ts)

---

## 6. 代码级门禁结果

| 项目                                     | 状态  |
| ---------------------------------------- | ----- |
| `pnpm -C app/chrome-extension typecheck` | 通过  |
| `pnpm run test:core`                     | 通过  |
| 扩展测试文件数                           | `57`  |
| 扩展测试总数                             | `710` |
| native-server 测试套件数                 | `9`   |
| native-server 测试总数                   | `48`  |

---

## 7. 当前残余事项

### 7.1 已知非 blocker

1. `qwenpaw`
   - 已具备配置基线
   - 尚未做真实工具级验收

2. `chrome_request_element_selection`
   - 已明确归类为人工协作型
   - 不属于当前主线 blocker

### 7.2 下一轮建议优先级

1. 用 `qwenpaw` 复刻一次主线无人值守验收
2. 形成面向发布的“客户端兼容矩阵”
3. 再整理下一版 release note

---

## 8. 平台自检查摘要

本轮已对 Ubuntu / macOS 的部署安装路径做过一轮静态自检查，结论是：

1. 不是“未支持”，而是“基础支持已具备，仍有边界需要明确”
2. 已有能力包括：
   - Linux 使用 `which google-chrome / google-chrome-stable / chromium / chromium-browser`
   - macOS 使用应用 bundle 路径探测 Chrome / Chromium
   - Linux daemon 自启使用 `systemctl --user`
   - macOS daemon 自启使用 `launchctl`
   - Unix Native Host 使用 `run_host.sh`
3. 当前已识别的主要风险：
   - macOS 目前主要检测 `/Applications/...`，未覆盖 `~/Applications/...` 等非常见安装位置
   - Ubuntu/Linux 的 daemon 自启依赖 `systemctl --user`，在无 user-systemd 或 headless 极简环境下可能需要手动处理
   - 文档过去更偏 Windows / Chrome 主路径，已补说明但仍值得继续完善

详细结论见：

- [PLATFORM_SELF_CHECK_2026-04-15_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\PLATFORM_SELF_CHECK_2026-04-15_zh.md)

## 9. 是否具备继续发版准备条件

当前结论：**具备进入下一步发版准备的条件**。

理由：

1. daemon 与扩展执行桥主链已稳定
2. `Claude` 主线无人值守验收已通过
3. 最后的 `dialog` blocker 已真实收口
4. 验收结束后没有残留副作用

仍建议在正式发版前补做：

1. `qwenpaw` 一轮主线验收
2. 一版简明 release note / 对外变更说明
