# Tabrix AI 贡献者快速上手

这份文档面向在公开仓库中协作的 AI 助手与开发者。

目标是让首次进入仓库的人在较短时间内理解：

1. `Tabrix` 是什么
2. 当前主线能力是什么
3. 修改代码时先看哪些文档和目录
4. 如何做最小必要验证

## 1. 一句话定位

`Tabrix = 让 AI 接入用户真实 Chrome 的 MCP 执行层。`

它不是一个新浏览器，而是通过：

- Chrome 扩展
- 本地 native server
- MCP transport

把真实 Chrome 会话、标签页和工具能力暴露给 AI 客户端。

建议先读：

- `README.md`
- `docs/WHY_MCP_CHROME.md`
- `docs/ARCHITECTURE_zh.md`

## 2. 当前主线

当前主线重点放在：

- `stdio`
- `Streamable HTTP`
- 真实 Chrome 工具调用
- 状态诊断、排障与发布流程

请优先围绕这些主线理解和改动代码。

## 3. 先读这几份文档

默认顺序：

1. `AGENTS.md`
2. `docs/AI_DEV_RULES_zh.md`
3. `README.md`
4. `docs/PROJECT_STRUCTURE_zh.md`
5. `docs/ARCHITECTURE_zh.md`
6. `docs/TRANSPORT.md`
7. `docs/TOOLS_zh.md`
8. `docs/TROUBLESHOOTING_zh.md`

如果任务涉及发布或安全，再补读：

- `docs/RELEASE_PROCESS_zh.md`
- `docs/SECURITY.md`
- `docs/THIRD_PARTY_REUSE_MATRIX_zh.md`
- `docs/THIRD_PARTY_REUSE_WORKFLOW_zh.md`

## 4. 仓库结构速记

```text
tabrix/
├─ app/chrome-extension/    浏览器扩展
├─ app/native-server/       本地服务、CLI、MCP 入口
├─ packages/shared/         跨端共享类型与 schema
└─ docs/                    公开文档
```

最常见的入口：

- 改 Popup 或扩展交互：`app/chrome-extension/`
- 改 MCP、status、doctor、smoke：`app/native-server/`
- 改共享协议：`packages/shared/`

## 5. 验证原则

默认遵守：

- 小步改动
- 先验证再提交
- 不把无关文件混进同一提交

常见验证：

- 扩展侧：`pnpm -C app/chrome-extension build`
- 自动刷新扩展：`pnpm run extension:reload`
- 服务端：`pnpm -C app/native-server build`
- 主链路：`stdio-smoke`、远程 `smoke`

如果声称“浏览器行为已验证”，必须确保当前浏览器里加载的是新扩展构建。

## 6. 公开与内部边界

GitHub 公开仓库主要承载用户、开发者和贡献者所需的稳定文档。

内部 PM 任务系统、内部评审记录、夜测、验收资产和私有治理台账不属于公开树的一部分。

如果你需要理解公开文档边界，请读：

- `docs/README.md`

如果你是在维护者本地环境里协作，可能还会接触更细的内部治理文档；但公开仓库协作默认以这里列出的公开文档为准。
