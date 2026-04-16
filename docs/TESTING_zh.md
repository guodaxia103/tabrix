# Tabrix 测试与验证指南

本文档说明贡献者在宣称“任务已完成”前，应该如何做最小但可信的验证。

## 验证原则

- 优先选择能证明改动正确的最小验证集
- 明确区分代码级验证与真实运行时验证
- 如果没有重建并 reload unpacked extension，就不要宣称浏览器侧已验证
- 如果结论涉及真实用户路径，就必须验证那条真实路径

## 常见验证层级

| 层级 | 证明什么 |
| --- | --- |
| 单测 / 定向测试 | 变更逻辑在隔离条件下成立 |
| 包级构建 / typecheck | 相关包仍可编译 |
| CLI / 运行时验证 | 本地服务链路仍然成立 |
| 真实浏览器验证 | 扩展 + native path 在真实 Chrome 会话中成立 |

## 按改动类型推荐的验证

### 纯文档改动

- 检查链接与导航入口
- 确认 README 与 docs 索引仍指向正确文件

### native-server / CLI / MCP 改动

- `pnpm -C app/native-server build`
- 可用时补定向测试
- `tabrix status`
- `tabrix doctor`
- `tabrix smoke`

### 扩展改动

- `pnpm -C app/chrome-extension build`
- 可用时补定向测试
- `pnpm run extension:reload`
- 对改动行为做真实浏览器验证

### 共享协议 / 工具 schema 改动

- `pnpm -C packages/shared build`
- 补相关 native-server / extension 构建
- 如行为变化，补工具链路 smoke 验证

## 稳定本地验收闭环

对扩展或运行时相关任务，默认验收闭环是：

1. 构建改动涉及的包
2. 如改到浏览器侧，reload unpacked extension
3. 跑最小必要 CLI / smoke 验证
4. 如结论涉及真实行为，再补真实浏览器验证

## 面向发布的验证

如果任务接近发布面，还应补读：

- `RELEASE_PROCESS_zh.md`
- `PLATFORM_SUPPORT_zh.md`

## 输出验证结论时必须说明

1. 改了什么
2. 验证了什么
3. 没验证什么
4. 还剩什么风险
