# Tabrix 发布流程

本文档定义 Tabrix 仓库的标准发布流程。

## 版本策略

- 对外发布主包：`@tabrix/tabrix`
- 运行时共享包：`@tabrix/shared`
- 根工作区版本（`package.json`）必须与 `@tabrix/tabrix` 一致
- `@tabrix/extension` 版本必须与 `@tabrix/tabrix` 一致
- 发布 Tag 仅允许以下格式：
- `vX.Y.Z`
- `tabrix-vX.Y.Z`

## 发布说明要求

每个版本必须提供：

- `docs/RELEASE_NOTES_vX.Y.Z.md`

发布工作流会在缺少该文件时阻断发布。

## 发布前检查

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm run release:check
pnpm run i18n:check
pnpm run typecheck
pnpm run test:core
pnpm run audit
```

审计门禁说明：

- `pnpm run audit` 现在不再依赖已退役的 npm 旧审计端点，而是使用仓库内置、由 `scripts/audit-prod.mjs` 实现的 OSV 生产依赖安全门禁。
- `pnpm run release:check` 继续负责发布元数据和发布说明文件的阻断校验。

如果本次版本包含新的第三方复用，还必须完成人工合规检查：

- 复用项目应已有复用矩阵登记，并完成来源记录闭环
- `代码复用` 已补来源记录，且需要时已更新根目录 `NOTICE`
- `设计借鉴` 已补设计参考记录
- `AGPL`、商业许可、混合许可或目录级例外边界已完成人工复核

## 正式发布步骤

1. 更新版本号与对应发布说明。
2. 如本版本引入新的第三方复用，先完成来源记录 / `NOTICE` / 人工许可证复核。
3. 将改动合并到 `main`。
4. 创建并推送 Tag：

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. GitHub Actions（`Release Tabrix`）会自动执行：

- 发布元数据校验
- 质量闸门检查
- 若 npm 不存在 `@tabrix/shared`，先发布共享包
- 再发布 `@tabrix/tabrix`（Token 或 Trusted Publishing 模式）
- 上传扩展 zip 与 npm tarball 到 GitHub Release

## 手动发布（workflow_dispatch）

手动触发 `Release Tabrix` 时：

- `tag`：必填，已有 Tag（例如 `v2.0.5`）
- `publish_npm=false`：只生成 Release 资产，不发 npm
- `publish_npm=true`：若该版本未发布则发布到 npm

## 回滚与热修复

- 不覆盖已发布的 npm 版本。
- 如需修复，递增补丁号（`X.Y.Z+1`）并重新发布。
- 若仅 GitHub Release 文案有误，直接编辑 Release 内容，保持 Tag 不变。

## 第三方复用发布闸门

出现以下任一情况时，不应发布：

- 本次发布新增了第三方代码/资产复用，但没有来源记录
- 本次发布需要更新 `NOTICE`，但尚未更新
- 本次发布引用了未进入复用矩阵的外部项目
- 对 `AGPL`、商业许可、混合许可或目录级例外没有完成人工复核
