# Windows 安装常见问题 FAQ

> 适用于 Windows 10/11 环境下使用 `npm` 或 `pnpm` 全局安装 `mcp-chrome-bridge` 的场景。

---

## 1. "Specified native messaging host not found"

**原因**：Chrome 找不到 Native Messaging manifest 文件，通常是 `register` 没跑或失败。

**修复**：

```powershell
mcp-chrome-bridge register
mcp-chrome-bridge doctor
```

确认以下路径存在 `com.chromemcp.nativehost.json`：

```
%APPDATA%\Google\Chrome\NativeMessagingHosts\
```

---

## 2. 以管理员身份安装后无法连接

**原因**：管理员 CMD/PowerShell 下 `npm install -g` 会把 postinstall 注册写进管理员上下文，普通用户启动的 Chrome 找不到。

**修复**：

```powershell
# 用普通用户权限重新注册
mcp-chrome-bridge register
```

> 提示：始终用**普通用户**执行全局安装和注册。只有 `register --system` 才需要管理员。

---

## 3. pnpm 安装后 register 没有自动执行

**原因**：pnpm v7+ 默认禁用 postinstall 脚本。

**修复**（二选一）：

```powershell
# 方法 1：开启 postinstall（推荐）
pnpm config set enable-pre-post-scripts true
pnpm install -g mcp-chrome-bridge

# 方法 2：手动注册
pnpm install -g mcp-chrome-bridge
mcp-chrome-bridge register
```

---

## 4. Node.js 版本管理器（nvm / fnm / volta）导致找不到 node

**原因**：Native host 进程使用 manifest 中的绝对路径启动脚本，如果 node 是版本管理器提供的 shim，Chrome 可能无法正确解析。

**修复**：

```powershell
# 方法 1：设置环境变量指向实际 node.exe
set CHROME_MCP_NODE_PATH=C:\Program Files\nodejs\node.exe
mcp-chrome-bridge register

# 方法 2：让 doctor 自动修复
mcp-chrome-bridge doctor --fix
```

`doctor --fix` 会把当前 `node.exe` 的完整路径写入 `node_path.txt`。

---

## 5. 端口 12306 被占用（EADDRINUSE）

**原因**：另一个进程已占用 12306 端口，或上一次 bridge 没有正确退出。

**排查**：

```powershell
netstat -ano | findstr :12306
# 找到 PID 后：
taskkill /PID <pid> /F
```

**或改用其他端口**：在扩展 popup 设置中修改端口，然后更新客户端配置。

---

## 6. 防火墙或安全软件拦截 localhost

**原因**：某些企业安全软件会拦截 `127.0.0.1` 的连接。

**修复**：

- 将 `127.0.0.1:12306` 加入防火墙白名单
- 或在安全软件中放行 `node.exe` 的本地网络访问

---

## 7. JSON 配置中的路径转义

**原因**：Windows 路径使用 `\`，在 JSON 中需要转义。

**错误写法**：

```json
{ "command": "C:\Users\me\node.exe" }
```

**正确写法**：

```json
{ "command": "C:\\Users\\me\\node.exe" }
```

或使用正斜杠（Node.js 和 Chrome 都支持）：

```json
{ "command": "C:/Users/me/node.exe" }
```

---

## 8. 扩展重新加载后连接断开

**原因**：在 `chrome://extensions/` 页面重新加载扩展会生成新的 Extension ID（unpacked 模式），旧的 manifest 中 `allowed_origins` 不匹配。

**修复**：

```powershell
# 重新注册以更新 allowed_origins
mcp-chrome-bridge register
# 重新加载扩展后点击 Connect
```

> 提示：项目已内置稳定 key 生成逻辑（`ensure-extension-key.cjs`），但首次加载仍可能需要注册。

---

## 9. 构建时 dist 目录 EBUSY 警告

**原因**：Windows 下如果 native host 进程正在运行，`dist` 目录的文件会被锁定。

**说明**：这是**非致命警告**，构建仍会完成。如果需要干净构建：

1. 在扩展 popup 中点击 Disconnect
2. 等待几秒后重新构建
3. 构建完成后重新 Connect

---

## 10. Chrome 加载了旧的扩展目录

**原因**：Chrome 记住的是**首次加载时的目录路径**。换目录重新构建后，Chrome 仍然读取旧目录。

**修复**：

- 始终使用固定目录加载扩展
- 或用 `robocopy` 同步到固定目录：

```powershell
robocopy .\app\chrome-extension\.output\chrome-mv3 C:\stable-ext /MIR
```

- 用 `mcp-chrome-bridge doctor` 检查 "Chrome extension path" 是否指向正确目录

---

## 快速诊断清单

遇到问题时，按顺序执行：

```powershell
# 1. 检查版本
mcp-chrome-bridge -V
node -v

# 2. 全面诊断
mcp-chrome-bridge doctor

# 3. 查看服务状态
mcp-chrome-bridge status

# 4. 冒烟测试
mcp-chrome-bridge smoke
```

如果 `doctor` 报错，按提示修复后重新连接扩展。

---

## 相关文档

- [Popup 状态排障表](POPUP_TROUBLESHOOTING.md) — 按颜色圆点诊断
- [客户端配置速查卡](CLIENT_CONFIG_QUICKREF.md) — 各客户端配置 JSON
- [错误码目录](ERROR_CODES.md) — 错误消息速查
- [Windows 安装指南](WINDOWS_INSTALL_zh.md) — 完整安装步骤
