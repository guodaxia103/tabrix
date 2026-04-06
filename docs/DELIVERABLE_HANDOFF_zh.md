# mcp-chrome Phase 0 交付包

最后更新：`2026-04-06 19:05 Asia/Shanghai`

如果你是第一次使用 `mcp-chrome`，只看这一份就够了。

目标：

1. 装好
2. 连上
3. 验证通过
4. 跑通第一个任务

## 一、推荐阅读顺序

1. [BEGINNER_HANDOFF_zh.md](D:\projects\ai\codex\mcp-chrome\docs\BEGINNER_HANDOFF_zh.md)
2. [STABLE_QUICKSTART.md](D:\projects\ai\codex\mcp-chrome\docs\STABLE_QUICKSTART.md)
3. [COPAW.md](D:\projects\ai\codex\mcp-chrome\docs\COPAW.md)

如果你只想最快上手，先看第 1 个。

## 二、最短安装路径

### 1. 构建和注册 bridge

```powershell
cd D:\projects\ai\codex\mcp-chrome
pnpm install
pnpm --filter mcp-chrome-bridge build
node app\native-server\dist\cli.js register --browser chrome
```

### 2. 构建扩展并同步到稳定目录

```powershell
cd D:\projects\ai\codex\mcp-chrome
pnpm --filter chrome-mcp-server build
robocopy D:\projects\ai\codex\mcp-chrome\app\chrome-extension\.output\chrome-mv3 D:\projects\ai\chrome-mcp-server-1.0.0 /MIR
```

### 3. 在 Chrome 加载扩展

1. 打开 `chrome://extensions/`
2. 开启 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择：
   [D:\projects\ai\chrome-mcp-server-1.0.0](D:\projects\ai\chrome-mcp-server-1.0.0)
5. 打开扩展 popup
6. 点一次 `连接`

### 4. 验证成功

```powershell
cd D:\projects\ai\codex\mcp-chrome
node app\native-server\dist\cli.js doctor
node app\native-server\dist\cli.js status
node app\native-server\dist\cli.js smoke
```

通过标准：

- `doctor` 中 `connectivity` 为 `ok`
- `doctor` 中 `runtime.status` 为 `ok`
- `doctor` 中 `mcp.initialize` 为 `ok`
- `status` 显示 `Running: yes`
- `smoke` 通过

## 三、CoPaw 配置

```json
{
  "key": "streamable-mcp-server",
  "name": "streamable-mcp-server",
  "description": "",
  "enabled": true,
  "transport": "streamable_http",
  "url": "http://127.0.0.1:12306/mcp",
  "headers": {},
  "command": "",
  "args": [],
  "env": {},
  "cwd": ""
}
```

启动：

```powershell
copaw app
```

API 检查：

```powershell
curl http://127.0.0.1:8088/api/mcp
```

## 四、第一个成功任务

### 浏览器 MCP 直接调用

```text
优先使用浏览器 MCP。打开 https://example.com ，告诉我页面标题和当前 URL。
```

### CoPaw

```text
优先使用 streamable-mcp-server。
打开 https://example.com ，确认页面标题和当前 URL。
```

## 五、常见问题

### 1. Chrome 重启后扩展不见了

只加载这个稳定目录：

- [D:\projects\ai\chrome-mcp-server-1.0.0](D:\projects\ai\chrome-mcp-server-1.0.0)

不要切换加载不同目录。

### 2. 扩展显示已连接但服务没启动

按顺序试：

1. `断开`
2. `连接`
3. `刷新`
4. 再跑：

```powershell
node app\native-server\dist\cli.js doctor
```

### 3. CoPaw 已经配置 MCP，但行为不稳定

先检查：

```powershell
node app\native-server\dist\cli.js doctor
curl http://127.0.0.1:8088/api/mcp
Get-Content C:\Users\guo\.copaw\copaw.log -Tail 100
```

### 4. 为何不要默认先截图

因为截图只是保底方案。

优先顺序应是：

1. 结构化页面内容
2. DOM / JS 状态
3. 网络和控制台
4. 截图仅用于视觉确认

## 六、当前已知限制

- `search_tabs_content` 当前未在实际 `tools/list` 公开面中暴露
- `chrome_inject_script` / `chrome_send_command_to_inject_script` 当前 bridge 公开面不可用
- CoPaw 在较长会话下仍可能出现 `502 Bad Gateway` + `CancelledError`
- `chrome_keyboard` 在 CoPaw 下更像按键/组合键工具，不适合直接整段文本输入
- `chrome_screenshot` 在 CoPaw 下仍可能超时

## 七、交付判断

如果你现在要做试用，优先走这些稳定能力：

- 标签页 / 窗口获取
- 导航
- 页面正文读取
- 点击
- 填表
- 网络请求
- 书签/历史
- 下载等待

如果你是开发/运维，最终状态请看：

- [PHASE0_COMPLETION_CHECKLIST.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_COMPLETION_CHECKLIST.md)
- [PHASE0_TOOL_VALIDATION_MATRIX.md](D:\projects\ai\codex\mcp-chrome\docs\PHASE0_TOOL_VALIDATION_MATRIX.md)
