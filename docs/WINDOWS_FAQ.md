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

## 8. 扩展重新加载后连接断开 / "Access to the specified native messaging host is forbidden"

**原因**：Chrome 扩展的 Extension ID 变化后，Native Messaging manifest 中 `allowed_origins` 仍指向旧 ID。

**修复**：

```powershell
# 自动诊断并修复（推荐）
mcp-chrome-bridge doctor --fix
```

`doctor --fix` 会自动：

1. 从当前构建的 `manifest.json` 的 `key` 字段计算出确定性 ID
2. 合并 Chrome 已加载扩展的 ID
3. 重新生成 `allowed_origins` 并写入 Native Messaging manifest

如果自动修复不生效，手动执行：

```powershell
mcp-chrome-bridge register
```

> 提示：项目内置稳定 key 生成逻辑（`ensure-extension-key.cjs`），确保同一台机器上 Extension ID 在重新构建后保持不变。`register` 命令现在通过三层来源合并 `allowed_origins`（key 计算 + Chrome 发现 + 兜底常量），即使扩展 ID 发生变化也能自动适配。

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

## 11. 远程连接后 Popup 配置中 IP 不正确

**原因**：设置 `MCP_HTTP_HOST=0.0.0.0` 后，Popup 自动选择本机网卡 IP 显示在配置模板中。如果机器上有 VPN 或虚拟网卡，可能选中了非预期的 IP。

**说明**：Popup 按优先级排序本机网卡：WLAN/Wi-Fi > Ethernet > 其他物理网卡 > 虚拟网卡/VPN。`192.168.x.x` 和 `10.x.x.x` 段获得额外加权。

**修复**：如果自动选择的 IP 不对，手动复制配置后将 URL 中的 IP 替换为实际局域网 IP 即可。

---

## 12. 远程连接被防火墙拦截

**原因**：Windows 防火墙默认不允许外部访问 12306 端口。

**修复**（以管理员身份运行 PowerShell）：

```powershell
netsh advfirewall firewall add rule name="MCP Chrome Bridge" dir=in action=allow protocol=tcp localport=12306
```

验证：

```powershell
netstat -ano | findstr :12306
```

应显示 `0.0.0.0:12306` 处于 `LISTENING` 状态。

---

## 13. 远程连接返回 401 Unauthorized

**原因**：Token 缺失、不匹配或已过期。监听 `0.0.0.0` 时远程 IP 需携带正确 Token。

**诊断步骤**：

1. 打开扩展 Popup → 「远程」Tab，查看当前 Token 及过期时间
2. 若 Token 已过期，点击"重新生成"
3. 复制 Token 到客户端配置：

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://<局域网IP>:12306/mcp",
      "headers": {
        "Authorization": "Bearer <从 Popup 复制的 Token>"
      }
    }
  }
}
```

本机（`127.0.0.1`）请求免 Token。`/ping`、`/status` 端点不需要认证。

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
