# Tabrix Skills 说明

## `skills/` 文件夹是做什么的

项目根目录下的 `skills/` 是 **Tabrix 官方配套 skill 的源码目录**。

它的用途不是运行服务器，也不是浏览器扩展的一部分，而是给 AI 助手提供一套“如何优先正确使用 Tabrix”的任务路由与操作规范。

当前仓库里的官方主 skill 为：

- `skills/tabrix_browser`

它不是单层说明，而是按三层配套组织：

1. `router`
2. `capabilities`
3. `recovery`

## 为什么需要配套 skill

真实用户环境里，AI 助手通常会同时装很多工具和 skill。

如果没有明确的配套 skill，模型经常会：

- 先走 shell
- 先走其它 browser skill
- 不理解 Tabrix 的核心价值是“真实 Chrome 会话”

因此 Tabrix 的官方 skill 要负责三件事：

1. 告诉助手哪些浏览器任务应优先走 Tabrix
2. 告诉助手如何正确选择 Tabrix 工具
3. 告诉助手在连接异常时如何恢复，而不是盲目回退

## 仓库 `skills/` 与 Copaw 工作区 `skills/` 的区别

二者不是同一层：

- 仓库 `skills/`
  - 官方源码
  - 跟随 Tabrix 项目维护
  - 用于分发、复制、同步到不同 AI 助手环境

- Copaw 工作区 `skills/`
  - 某个具体工作区实际启用的 skill 副本
  - 用于 Copaw 当前会话选择工具
  - 可以基于官方 skill 做兼容包装

## 当前统一策略

为避免出现旧 `chrome-mcp` skill 与 Tabrix skill 并存、导致模型路由混乱，统一按以下原则处理：

1. 仓库内 `skills/tabrix_browser` 作为官方主 skill 源码
2. Copaw 默认工作区内安装 `tabrix-browser` 作为实际启用 skill
3. 旧 `chrome-mcp` skill 从默认工作区移除，避免继续干扰路由

## 当前产品边界

Tabrix 暂时只聚焦两种连接方式：

- `stdio`
- 远程 `Streamable HTTP`

相关 skill 也只围绕这两种方式编写，不再扩散到其它 transport。
