# macOS 静态自检

这份文档对应一个现实问题：

如果当前没有真实 macOS 机器，`Tabrix` 能不能先做一轮有价值的兼容性自检？

答案是：**可以，但它只能验证“代码路径 / 安装路径 / 自启动设计 / 浏览器探测覆盖面”这一层，不能替代真实 macOS 桌面动态验收。**

---

## 1. 这套静态自检验证什么

在没有真实 macOS 机器时，当前最值得确认的是：

1. 浏览器路径探测是否覆盖 macOS 主安装路径
2. Native Messaging manifest 写入路径是否包含 macOS 用户级与系统级位置
3. daemon 自启动方案是否包含 macOS 分支
4. 浏览器自动拉起逻辑是否没有写死 Windows / Linux 路径
5. 文档是否明确说明了 macOS 当前支持边界

这类检查不能证明“真的好用”，但可以较早发现：

- 明显缺分支
- 路径写死
- launchctl 方案缺失
- 文档误导

---

## 2. 当前已经具备的 macOS 基础

基于当前代码静态审查，Tabrix 已具备这些 macOS 基础能力：

### 2.1 浏览器可执行路径探测

当前已覆盖：

- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `/Applications/Chromium.app/Contents/MacOS/Chromium`

说明：

- 标准 `/Applications` 安装路径已有代码支持
- 如果用户把浏览器装在标准位置，当前探测逻辑是有机会直接工作的

### 2.2 Native Messaging 路径

当前代码已经覆盖 macOS 的 Native Messaging 相关路径分支，说明：

- 不是“只写了 Windows 注册表”
- 也不是“只有 Linux manifest 路径”

### 2.3 daemon 自启动

当前实现已有 macOS 的：

- `launchctl`

这说明：

- macOS 自启动不是空白
- 至少在设计层面已经被纳入支持范围

---

## 3. 当前静态检查已识别的风险

### 3.1 浏览器路径探测仍偏保守

当前主要覆盖：

- `/Applications/...`

尚未覆盖：

- `~/Applications/...`
- 企业分发路径
- 自定义安装路径
- symlink 暴露的非标准路径

这意味着：

- 用户可能明明装了 Chrome
- 但如果不在标准 `/Applications`，Tabrix 可能会误判“浏览器未就绪”

### 3.2 `launchctl` 需要真实机器动态验证

当前实现是有 macOS 分支的，但静态存在不等于动态一定稳定。

尤其需要关注：

- 现代 macOS 的 `launchctl load -w / unload -w`
- 与登录用户上下文的关系
- LaunchAgent 的真实加载行为

所以目前更准确的表述是：

**“有实现，但还需要真实机动态验收确认行为稳定。”**

### 3.3 无法用 Docker 替代

这一点很重要：

- Docker 不能替代 macOS 桌面用户态
- 也不能验证 `.app` 路径、`launchctl`、真实扩展加载、浏览器窗口行为

所以 macOS 这条最多只能做到：

**静态自检 + 文档约束**

而不能像 Ubuntu 那样先做一轮 Docker 自检。

---

## 4. 当前最合理的结论

当前对 macOS 最准确的说法是：

1. `Tabrix` 不是“不支持 macOS”
2. 当前代码已经具备：
   - 浏览器探测基础
   - Native Messaging 基础
   - daemon 自启动基础
3. 但还没有真实 macOS 机器上的整轮动态验收结果
4. 因此现在应表述为：

**“macOS 基础支持已具备，建议在真实机器上补一轮动态验收。”**

---

## 5. 没有真实 macOS 机器时，建议至少做哪些事

如果暂时没有真实机器，可以先把这些静态检查做扎实：

1. 检查浏览器路径探测是否覆盖：
   - `/Applications/...`
   - `~/Applications/...` 是否缺失
2. 检查 Native Messaging 路径分支是否齐全
3. 检查 `launchctl` 命令分支是否存在
4. 检查浏览器自动拉起逻辑是否没有平台写死
5. 检查 README / 安装文档是否明确说明：
   - macOS 当前是“基础支持已具备”
   - 真实动态验收待补

这些事情不能替代真实验收，但能显著降低后面在真实 macOS 机器上一次性踩大坑的概率。

---

## 6. 下一轮真实 macOS 机器验收建议

一旦后面拿到真实 macOS 机器，建议至少覆盖：

1. Chrome 安装在 `/Applications`
2. Chrome 安装在 `~/Applications`
3. `npm install -g @tabrix/tabrix`
4. `tabrix register`
5. `tabrix doctor --fix`
6. `tabrix daemon install-autostart`
7. 浏览器未启动时自动拉起
8. 扩展 reconnect
9. `tabrix status --json` 中 bridge 状态是否正确

---

## 7. 当前结论

当前最准确的结论是：

**没有真实 macOS 机器时，可以先做一轮有价值的静态自检，但不能把它当成真实可用性的最终证明。**

所以最合理的策略是：

1. 先把静态检查与文档说明做扎实
2. Ubuntu 先用 Docker 补服务层信心
3. macOS 等后续有真实机器时，再补动态验收
