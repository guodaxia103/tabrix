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

## 正式发布步骤

1. 更新版本号与对应发布说明。
2. 将改动合并到 `main`。
3. 创建并推送 Tag：

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

4. GitHub Actions（`Release Tabrix`）会自动执行：

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
