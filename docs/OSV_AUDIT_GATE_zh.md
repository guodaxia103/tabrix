# Tabrix 生产依赖安全审计门禁（OSV）

本仓库生产依赖安全门禁不再依赖退役的 npm 旧接口，而是使用仓内实现的 OSV 批量查询：

- `pnpm audit --prod --audit-level high` 已不再作为主线门禁；
- `pnpm run audit` 统一走 `scripts/audit-prod.mjs`。

## 1. 实现边界（当前主线）

1. 提取生产依赖树（`pnpm list -r --prod --json --depth Infinity`）；
2. 过滤 `workspace:/`, `link:`, `file:` 等非外部包来源；
3. 按 `package + version` 去重后使用 OSV 批量接口查询；
4. 仅将 `HIGH / CRITICAL` 作为阻塞级别；
5. 与历史的 `pnpm audit` 相比，依赖由外部退役端点切为可审计、可扩展的仓内脚本。

## 2. 门禁语义（重要）

- 默认关注生产依赖；
- `HIGH / CRITICAL` 阻塞；
- `MODERATE / LOW` 记录但不阻塞。

变更门槛前请记录原因（例如 CVSS 语义或告警策略变更），避免把门禁降级当成临时修复。

## 3. 故障处理建议

遇到 `audit` 失败时按顺序判断：

1. 依赖树提取是否异常；
2. OSV API 是否可达（网络/DNS）；
3. 失败是否来自真实漏洞；
4. 确认后是否只应在 `scripts/audit-prod.mjs` 上修复，而非在流水线中简单 `ignore`。

## 4. 与发布流程的关系

`release:check` 中包含发布门禁，`pnpm run audit` 是正式安全门禁的一部分。  
涉及新复用或版本更新前，仍应确保单一真相源一致：

- `package.json` 的版本与脚本入口；
- `scripts/audit-prod.mjs` 的实现；
- 对应 `release:check`/CI 记录。

## 5. 后续可选增强

- 输出更友好的人类可读摘要；
- 增加一条单测覆盖“workspace/link/file”过滤正确性；
- 增加 `MODERATE` 通道化告警，不与 `HIGH/CRITICAL` 混淆。

本门禁目标是“真实阻塞，不做遮羞布式规避”。
