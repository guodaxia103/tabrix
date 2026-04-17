# Tabrix 公开文档

本目录仅保留 `Tabrix` 对外公开的文档。

它面向：

- 用户上手与功能使用
- 通过 CLI / MCP 集成的开发者
- 参与公共代码库协作的贡献者
- 发布、安全与合规阅读者

本目录不存放内部产品管理或评审材料。

这类内容将保留在内部治理文档中，并在公开发布前完成重写。  
实现方案说明、审计记录、验收证据、发布门禁维护说明、治理记录应归入内部文档，不放在此目录。

## 收录范围

- README、安装、快速上手与故障排查指南
- AI 贡献者入门与公开协作规则
- CLI、工具、Transport 与架构参考
- 项目结构、发布、安全与变更记录文档
- 面向公开用户的合规与贡献指导

## 高价值入口

- `AI_CONTRIBUTOR_QUICKSTART_zh.md`：公共仓库内 AI 贡献者的首站上手文档
- `AI_DEV_RULES_zh.md`：AI 辅助开发的公开开发规则
- `PRODUCT_SURFACE_MATRIX.md` / `PRODUCT_SURFACE_MATRIX_zh.md`：公开能力边界与分层定义
- `TESTING.md` / `TESTING_zh.md`：贡献者验收标准
- `PLATFORM_SUPPORT.md` / `PLATFORM_SUPPORT_zh.md`：当前公开平台支持状态
- `COMPATIBILITY_MATRIX.md` / `COMPATIBILITY_MATRIX_zh.md`：当前 MCP 客户端和环境兼容状态
- `CODE_ENTRYPOINTS_AND_OWNERSHIP_zh.md`：常见变更类型的执行分工
- `STABLE_QUICKSTART.md`：面向用户的首次成功路径
- `BROWSER_TOOL_SETTLE_AUDIT_zh.md`：浏览器工具稳定化与优化复盘
- `RELEASE_READINESS_CHECKLIST_zh.md`：发布前 Phase 0 验收清单
- `BROWSER_BRIDGE_STATE_DESIGN_zh.md`：浏览器桥接状态机与自动恢复设计
- `OSV_AUDIT_GATE_zh.md`：生产依赖安全门禁与 OSV 方案说明
- `ROADMAP.md` / `ROADMAP_zh.md`：公开产品方向与贡献者可见的优先级
- `USE_CASES.md` / `USE_CASES_zh.md`：面向新用户的真实使用场景
- `ARCHITECTURE.md` / `ARCHITECTURE_zh.md`：公开架构总览
- `PROJECT_STRUCTURE.md` / `PROJECT_STRUCTURE_zh.md`：代码库地图与模块职责

## 命名规范

- 尽量使用稳定的 `UPPER_SNAKE_CASE.md` 命名风格
- 中文公开文档使用 `_zh.md` 后缀
- 避免使用 `draft`、`latest`、`temp` 等临时状态词作为文件名
- 非必要不发布内部评审或规划草稿；如需发布，需确保文件本身就是对外文档
- `README.md`、`README_zh.md`、`CHANGELOG.md` 及版本化发布说明为例外

## 公开真相来源

对于 `docs/` 下文档，仓库本身为最终真实来源。
