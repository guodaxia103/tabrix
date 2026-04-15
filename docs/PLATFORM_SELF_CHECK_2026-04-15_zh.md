# Tabrix 平台自检查（2026-04-15）

这份自检查用于回答两个实际问题：

1. `Tabrix` 在 Ubuntu / macOS 上是否“完全不能装”
2. 当前跨平台支持里，哪些已经具备，哪些还只是“可用但有边界”

本轮结论基于：

- 当前仓库 `main`
- 对安装、注册、daemon、自启动、浏览器探测、Unix Native Host 的静态代码审查
- Windows 真实发布后验收结果作为对照基线

注意：本轮对 Ubuntu / macOS 的判断属于**静态自检查结论**，不是在真实 Ubuntu/macOS 机器上的整轮动态验收。

---

## 1. 总结结论

### 1.1 总结

当前 `Tabrix` 对 Ubuntu / macOS **不是没有支持**，而是：

- 基础安装与运行路径已经具备
- 浏览器探测、daemon、自启动、Unix Native Host 也已有实现
- 但仍存在少数平台边界，需要在文档中明确，并在后续版本继续补强

### 1.2 当前可给用户的真实表述

最准确的说法是：

1. Windows：已经过真实发布后验收，当前是主验证平台
2. Ubuntu / macOS：基础支持已在代码层具备，可以安装部署
3. Ubuntu / macOS：仍建议在真实机器上补一轮动态验收，尤其是自启动、浏览器路径探测和 Chrome/Chromium 变体路径

---

## 2. 已具备的跨平台能力

### 2.1 浏览器可执行路径探测

当前实现已覆盖：

#### Windows

- App Paths 注册表
- 常见安装目录
- `PATH` / `where`

#### macOS

- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `/Applications/Chromium.app/Contents/MacOS/Chromium`

#### Linux / Ubuntu

- `which google-chrome`
- `which google-chrome-stable`
- `which chromium`
- `which chromium-browser`

结论：

- Ubuntu / macOS 的“是否能探测到浏览器”并不是空白
- 真实浏览器自动化 readiness 已具备基础能力

### 2.2 daemon 自启动

当前实现已覆盖：

#### Windows

- `schtasks`

#### macOS

- `launchctl`

#### Linux / Ubuntu

- `systemctl --user`

结论：

- 三个平台都有 daemon 自启动方案
- 但 Linux / macOS 仍存在环境差异边界，详见风险部分

### 2.3 Unix Native Host 启动包装

当前已有：

- [run_host.sh](E:\projects\AI\copaw\mcp-chrome\app\native-server\dist\run_host.sh)

它已覆盖：

- Node 路径多来源查找
- macOS / Linux 日志目录
- 用户态可写日志路径优先
- 多种 Node 版本管理器兼容查找

结论：

- Unix Native Host 不是空实现
- Ubuntu / macOS 至少在包装层面具备完整基础

---

## 3. 当前已识别的平台风险

### 3.1 macOS 浏览器路径探测仍偏保守

当前 macOS 主要检测：

- `/Applications/Google Chrome.app/...`
- `/Applications/Chromium.app/...`

尚未覆盖：

- `~/Applications/...`
- 企业分发或自定义目录安装
- 通过 symlink 暴露的非标准路径

影响：

- 用户明明装了 Chrome，但若不在标准 `/Applications`，当前可能被误判为“浏览器未就绪”

建议后续补强：

1. 增加 `~/Applications/...` 检测
2. 增加 Spotlight / `mdfind` 或 `osascript` 辅助发现能力
3. 把自定义路径提示写进 `doctor` 建议

### 3.2 Ubuntu/Linux daemon 自启动依赖 `systemctl --user`

当前 Linux 路径采用：

- `systemctl --user daemon-reload`
- `systemctl --user enable tabrix.service`

这在桌面版 Ubuntu 上通常可用，但在以下环境不一定稳定：

- 没有 user-systemd 的极简系统
- 纯服务器 / headless 场景
- SSH 会话里未启用 linger 的用户环境
- 容器化 Ubuntu

影响：

- `daemon install-autostart` 可能无法按预期工作
- 但不等于 Tabrix 无法运行；通常只是“自动启动能力需要手动处理”

建议后续补强：

1. 在 `doctor` 中明确识别 `systemctl --user` 不可用场景
2. 提供 fallback 文档：
   - 手动启动 daemon
   - 用户 crontab / desktop autostart 替代方案

### 3.3 macOS `launchctl` 仍建议做真实机器动态验收

当前实现使用：

- `launchctl load -w`
- `launchctl unload -w`

这条链在很多系统可工作，但现代 macOS 对 `launchctl` 行为更严格，长期更稳的方向通常是：

- `bootstrap`
- `bootout`

当前结论：

- 不是确认故障
- 但它值得在真实 macOS 机器上做一次专项动态验收

### 3.4 文档长期偏 Windows 主路径

虽然本轮已经补充“安装成功 != 浏览器自动化已就绪”的说明，但当前文档整体仍更偏：

- Windows
- Chrome 主安装路径
- 开发者手工 reload 扩展的流程

这不会阻止 Ubuntu / macOS 安装，但会带来：

- 用户误解平台不支持
- 遇到路径边界时不知道怎么处理

---

## 4. 当前对 Ubuntu / macOS 的结论评级

### 4.1 Ubuntu

当前评级：**可部署，建议补动态验收**

理由：

1. 浏览器探测已覆盖常见 Ubuntu 可执行名
2. Unix Native Host 包装存在且较完整
3. daemon 自启动路径已实现
4. 最大不确定性集中在：
   - `systemctl --user`
   - headless / server 环境

补充：

- 本轮已经用 Docker 做过一轮真实“安装 / 注册 / daemon / status”自检
- 结论是 Ubuntu 的服务层与浏览器探测链是可以跑通的
- 详细流程见：
  - [UBUNTU_DOCKER_SELF_CHECK_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\UBUNTU_DOCKER_SELF_CHECK_zh.md)

### 4.2 macOS

当前评级：**可部署，建议补路径与自启动专项验收**

理由：

1. 浏览器 bundle 路径已实现
2. Native Host 用户级路径与系统级路径已实现
3. daemon 自启动已有 `launchctl` 方案
4. 最大不确定性集中在：
   - 非标准安装路径
   - `launchctl` 真实机器行为

补充：

- 当前已经补了一份“没有真实 macOS 机器时可先执行的静态自检清单”
- 这份清单不替代真实动态验收，但能帮助我们先把路径、自启动、文档边界检查扎实
- 详细流程见：
  - [MACOS_STATIC_SELF_CHECK_zh.md](E:\projects\AI\copaw\mcp-chrome\docs\MACOS_STATIC_SELF_CHECK_zh.md)

---

## 5. 当前最合理的对外说法

如果现在要对外描述平台支持，建议用下面这版：

1. Windows：已作为当前主验证平台，支持完整安装、daemon、自恢复与真实会话验收
2. Ubuntu / macOS：代码层已具备基础支持，可部署安装
3. Ubuntu / macOS：仍建议在真实机器上完成补充动态验收，重点关注：
   - 浏览器路径探测
   - daemon 自启动
   - Chrome / Chromium 变体安装位置

这样既诚实，也不会把实际已有的跨平台能力说成“不支持”。

---

## 6. 建议的下一轮专项任务

### P1：Ubuntu 动态验收

建议至少覆盖：

1. `npm install -g @tabrix/tabrix`
2. `tabrix register`
3. `tabrix doctor --fix`
4. `tabrix daemon start`
5. `tabrix status --json`
6. Chrome / Chromium 自动拉起

### P1：macOS 动态验收

建议至少覆盖：

1. 标准 `/Applications` 安装 Chrome
2. `~/Applications` 安装 Chrome
3. `tabrix register`
4. `tabrix doctor --fix`
5. `tabrix daemon install-autostart`
6. 浏览器自动恢复与 bridge ready

### P2：代码补强

1. macOS 增加 `~/Applications` 探测
2. Linux `doctor` 增加 `systemctl --user` 可用性提示
3. 文档补 Ubuntu / macOS 快速排障卡

---

## 7. 当前结论

当前最准确的结论是：

**Tabrix 在 Ubuntu / macOS 上不是“有问题到不能部署”，而是“基础支持已经具备，但还需要一轮真实机器动态验收来补齐边界信心”。**

这意味着：

1. 现在可以继续对外说支持 Windows / Ubuntu / macOS
2. 但在发布说明里应保持诚实：
   - Windows 已完成真实验收
   - Ubuntu / macOS 当前为代码层支持 + 静态自检查通过
3. 下一轮最值得补的是 Ubuntu / macOS 动态专项验收
