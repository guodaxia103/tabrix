# mcp-chrome 小白交付手册

最后更新：`2026-04-06 17:35 Asia/Shanghai`

这份手册面向第一次使用 `mcp-chrome` 的用户。

目标只有一个：

**从零开始，在 Windows 上把插件装好、连上、验证成功、跑通第一个任务。**

## 一、你需要什么

- 已安装 Chrome 浏览器
- 已安装 Node.js
- 本地仓库：
  [mcp-chrome](D:\projects\ai\codex\mcp-chrome)
- 稳定扩展目录：
  [chrome-mcp-server-1.0.0](D:\projects\ai\chrome-mcp-server-1.0.0)

## 二、最快安装路径

### 1. 构建并注册本地 bridge

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

### 3. 在 Chrome 里加载扩展

1. 打开 `chrome://extensions/`
2. 开启 `开发者模式`
3. 点 `加载已解压的扩展程序`
4. 选择：
   [D:\projects\ai\chrome-mcp-server-1.0.0](D:\projects\ai\chrome-mcp-server-1.0.0)
5. 打开扩展 popup
6. 点一次 `连接`

### 4. 验证是否成功

```powershell
cd D:\projects\ai\codex\mcp-chrome
node app\native-server\dist\cli.js doctor
node app\native-server\dist\cli.js status
node app\native-server\dist\cli.js smoke
```

看到下面这些，说明成功：

- `doctor` 里 `connectivity` 是 `ok`
- `doctor` 里 `runtime.status` 是 `ok`
- `doctor` 里 `mcp.initialize` 是 `ok`
- `status` 显示 `Running: yes`
- `smoke` 最终成功

## 三、第一个 MCP 配置

适合大多数客户端的配置：

```json
{
  "mcpServers": {
    "chrome-mcp-server": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

## 四、CoPaw 配置

如果你用 CoPaw，配置项是：

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

## 五、第一次成功任务

建议你先跑这类最简单任务：

### 1. 打开页面并确认标题

```text
优先使用浏览器 MCP。打开 https://example.com ，然后告诉我页面标题和当前 URL。
```

### 2. 读取主内容，而不是先截图

```text
优先使用浏览器 MCP。先读取当前页面主内容，告诉我页面的核心文字内容，不要先截图。
```

### 3. 导航后再验证

```text
优先使用浏览器 MCP。导航到目标网页后，重新确认当前窗口、标签页和 URL。
```

## 六、出问题时先看哪里

### 情况 1：扩展能看到，但服务没起来

先做：

1. 打开扩展 popup
2. 点 `断开`
3. 再点 `连接`
4. 再跑：

```powershell
node app\native-server\dist\cli.js doctor
```

### 情况 2：Chrome 重启后扩展不见了

先确认你加载的是固定目录：

- [D:\projects\ai\chrome-mcp-server-1.0.0](D:\projects\ai\chrome-mcp-server-1.0.0)

不要反复切换加载不同 build 目录。

### 情况 3：工具调用失败

先跑：

```powershell
node app\native-server\dist\cli.js doctor --json
node app\native-server\dist\cli.js status
```

然后看：

- 扩展 popup 是否显示 `服务运行中`
- `doctor` 里的 `Chrome extension path` 是否正确

## 七、推荐使用原则

- 先读页面，再操作页面
- 先用结构化内容、DOM、JS 状态，不要把截图当主方法
- 截图只用来做视觉确认或保底排障
- 页面不稳定时，先重新读取标签页和 URL，再决定是否继续点击

## 八、如果你是开发者

推荐固定开发习惯：

```powershell
pnpm --filter chrome-mcp-server build
robocopy D:\projects\ai\codex\mcp-chrome\app\chrome-extension\.output\chrome-mv3 D:\projects\ai\chrome-mcp-server-1.0.0 /MIR
node app\native-server\dist\cli.js doctor
```

每次改扩展后都同步到同一个稳定目录，不要换目录。
