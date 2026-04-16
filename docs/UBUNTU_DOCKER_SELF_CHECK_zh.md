# Ubuntu Docker 自检

这份文档对应一个现实问题：

如果现在没有真实 Ubuntu 机器，`Tabrix` 还能不能先做一轮有价值的安装与运行自检？

答案是：**可以，但它验证的是“安装 / CLI / daemon / 浏览器探测”层，不替代真实桌面浏览器与扩展验收。**

本轮这套方案已经在本机 Docker 环境实际跑通过一次，说明它不是纸面流程。

---

## 1. 这套自检验证什么

当前 Docker 自检会验证：

1. Ubuntu 24.04 容器内安装 Node.js 22
2. 安装 Google Chrome Stable
3. 安装当前仓库依赖并构建：
   - `@tabrix/shared`
   - `@tabrix/tabrix`
4. 执行：
   - `tabrix register --detect`
   - `tabrix doctor --json`
   - `tabrix daemon start`
   - `tabrix status --json`
   - `tabrix daemon stop`
5. 断言至少以下能力成立：
   - 能解析到 Linux 下的 Chrome 可执行路径
   - Native Messaging manifest 能写到 Linux 系统路径
   - CLI 可以构建并运行
   - daemon 可以启动
   - `status --json` 可用

---

## 2. 这套自检不验证什么

Docker 方案**不替代**以下真实机器能力：

1. Chrome 扩展真实加载
2. 浏览器桌面窗口行为
3. 浏览器未启动时的真实自动拉起体验
4. Ubuntu 桌面用户会话下的扩展 reconnect
5. 真正的 GUI 自动化

也就是说，它更像：

**Ubuntu 安装与服务层验收**

而不是：

**Ubuntu 桌面浏览器全链路验收**

---

## 3. 如何运行

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-ubuntu-docker-self-check.ps1
```

它会自动：

1. 构建 `docker/ubuntu-self-check/Dockerfile`
2. 在容器内安装 Node.js 与 Chrome
3. 构建当前仓库
4. 运行自检脚本

成功时你会看到类似输出：

```text
[ubuntu-self-check] doctor browser executable: /usr/bin/google-chrome (linux-which)
[ubuntu-self-check] manifest path: /etc/opt/chrome/native-messaging-hosts/com.tabrix.nativehost.json
[ubuntu-self-check] status bridge state: BROWSER_NOT_RUNNING
[ubuntu-self-check] completed
```

---

## 4. 相关文件

- [docker/ubuntu-self-check/Dockerfile](../docker/ubuntu-self-check/Dockerfile)
- [docker/ubuntu-self-check/run-self-check.sh](../docker/ubuntu-self-check/run-self-check.sh)
- [scripts/run-ubuntu-docker-self-check.ps1](../scripts/run-ubuntu-docker-self-check.ps1)

---

## 5. 当前结论

这套 Docker 自检适合回答：

- Ubuntu 下能不能安装
- CLI 能不能构建
- 浏览器探测逻辑是不是正常
- daemon/status 链路是不是能跑

它不适合回答：

- Ubuntu 桌面上浏览器扩展是否完全正常
- 扩展桥接与真实浏览器自动化是否全部通过

所以最合理的策略是：

1. 先用 Docker 补 Ubuntu 安装与服务层信心
2. 后续有真实 Ubuntu 机器时，再补桌面浏览器动态验收

---

## 6. 当前已验证到的真实结论

基于本轮本机 Docker 实跑：

1. Ubuntu 容器内可以安装 Node.js 22 与 Google Chrome Stable
2. 当前仓库源码可以在 Ubuntu 容器内完成：
   - `pnpm install`
   - `@tabrix/shared build`
   - `@tabrix/tabrix build`
3. `tabrix register --detect` 能在 Linux 系统路径写出 Native Messaging manifest
4. `tabrix doctor --json` 能正确识别 Linux 下的 Chrome 可执行路径
5. `tabrix daemon start` + `tabrix status --json` 可以跑通
6. 在没有真实桌面浏览器扩展连接时，`bridgeState=BROWSER_NOT_RUNNING` 是合理结果，不是故障
