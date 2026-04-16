# Tabrix 代码入口与责任地图

本文档是公开仓库里的执行地图。

目标不是重复目录树，而是帮助贡献者快速回答：

1. 遇到某类问题先看哪些文件
2. 哪些目录是主责任区
3. 修改时最容易漏哪些配套文档或验证

## 1. 总体责任分区

### `app/chrome-extension/`

负责：

- 浏览器侧真实执行
- Chrome API / content script / DOM 交互
- Popup / Sidepanel / Web Editor 等前端入口
- 浏览器工具执行与扩展状态表达

### `app/native-server/`

负责：

- CLI
- MCP server / transport
- 鉴权
- 状态输出
- 会话注册与桥状态
- Native Messaging Host

### `packages/shared/`

负责：

- 工具 schema
- 共享类型
- 节点模型
- 扩展与服务端之间的共同协议

### `docs/`

负责：

- 产品边界
- 架构解释
- 协作规则
- 测试与发布要求

## 2. 常见任务入口

### 2.1 改 Popup 连接页 / 服务配置 / 客户端列表

优先看：

- `app/chrome-extension/entrypoints/popup/`
- `app/chrome-extension/common/`
- `app/native-server/src/server/`
- `docs/STABLE_QUICKSTART.md`
- `docs/TROUBLESHOOTING.md` / `docs/TROUBLESHOOTING_zh.md`

### 2.2 改 transport / MCP 接入 / 客户端配置

优先看：

- `app/native-server/src/cli.ts`
- `app/native-server/src/index.ts`
- `app/native-server/src/server/`
- `app/native-server/src/mcp/`
- `docs/TRANSPORT.md`
- `docs/CLIENT_CONFIG_QUICKREF.md`

### 2.3 改桥状态 / 会话注册 / 诊断输出

优先看：

- `app/native-server/src/server/`
- `app/native-server/src/scripts/status.ts`
- `app/native-server/src/scripts/doctor.ts`
- `app/chrome-extension/common/`
- `docs/TESTING_zh.md`

### 2.4 改工具 schema / 工具注册

优先看：

- `packages/shared/src/tools.ts`
- `app/native-server/src/mcp/register-tools.ts`
- `app/chrome-extension/entrypoints/background/tools/`
- `docs/TOOLS.md` / `docs/TOOLS_zh.md`

### 2.5 改产品定位 / 公开能力边界 / 文档治理

优先看：

- `docs/README.md`
- `docs/PRODUCT_SURFACE_MATRIX_zh.md`
- `docs/TABRIX_PRODUCT_POSITIONING_AND_TECHNICAL_PRINCIPLES_zh.md`
- `docs/TABRIX_TOOL_LAYERING_AND_RISK_CLASSIFICATION_zh.md`

## 3. 修改时最容易漏的配套项

- README 与 docs 索引入口
- `TRANSPORT.md` 与客户端配置说明
- `TOOLS*.md` 与 schema 改动是否同步
- `TESTING*.md` 与真实验证结论是否一致
- `RELEASE_PROCESS*.md` 是否仍反映当前发布门禁

## 4. 使用建议

如果你已经知道大致目录，但还不知道任务该从哪下手，优先读：

1. `AGENTS.md`
2. `AI_CONTRIBUTOR_QUICKSTART_zh.md`
3. 本文档
4. 对应任务域文档
