# Ubuntu Xvfb 增强自检

## 作用

在没有真实 Ubuntu 桌面机器时，补一层比普通 Docker 更强的验证：

- `Tabrix` 可安装
- `register` / `doctor` / `build` 可运行
- `Google Chrome` 可以在 `Xvfb` 提供的图形环境里成功拉起并保持存活

## 不能替代什么

- 不能替代真实 Ubuntu 桌面下的扩展加载与连接验收
- 不能替代真实用户会话下的自动恢复、窗口管理与扩展桥接验收

## 运行方式

```powershell
pnpm run ubuntu:xvfb-self-check
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-ubuntu-xvfb-self-check.ps1
```

## 通过标准

- Docker 镜像可构建
- Ubuntu 容器中可完成：
  - `pnpm install --frozen-lockfile`
  - `@tabrix/shared build`
  - `@tabrix/tabrix build`
  - `tabrix register --detect`
  - `tabrix doctor --json`
- `google-chrome-stable` 能在 `Xvfb` 图形会话中成功启动并保持存活数秒

## 价值边界

- 这是一层“Ubuntu 图形会话近似验证”
- 它比普通无头 Docker 更接近真实桌面，但仍不等于真实 Ubuntu 机器
