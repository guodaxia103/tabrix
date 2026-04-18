# Tabrix T4 GitHub 公共基线门禁（工程化起步）

本文件定义 T4 第一阶段的最小工程化资产：把 GitHub 公共场景验收从“人工口头结论”收敛为可重复执行、可结构化记录的门禁输出。

## 1. 目标与范围

当前范围（已落地）：

- 固定 4 个 GitHub 公共基线页面类型：
  - `repo_home`
  - `issues_list`
  - `actions_list`
  - `workflow_run_detail`
- 提供可重复运行入口（脚本）并统一输出格式
- 提供提交后追踪记录（commit/checks/阻塞/异常分类）

当前不做：

- 登录态黄金场景门禁化（如抖音后台）
- Knowledge / Table-List / Policy / Memory
- T10/T11/T12 的完整 fallback/self-healing 体系

## 2. 执行入口

### 2.1 GitHub 公共基线执行

```bash
pnpm run t4:github-baseline -- --owner microsoft --repo TypeScript
```

常用参数：

- `--out-dir <path>`：输出目录（默认 `.tmp/t4-github-baseline`）
- `--timeout-ms <ms>`：单工具调用超时
- `--non-strict`：即使出现阻塞场景也返回 0（默认阻塞时退出 1）

### 2.2 提交后追踪（Post-submit）

```bash
pnpm run t4:post-submit -- --owner guodaxia103 --repo tabrix --commit <sha>
```

常用参数：

- `--out-file <path>`：追踪记录输出路径（默认 `.tmp/t4-post-submit/<sha>.json`）
- `--token <github_token>`：显式传入 GitHub token（可选）
- `--non-strict`：发现阻塞检查时不退出 1

## 3. 标准输出字段

### 3.1 场景执行输出（`t4:github-baseline`）

每个场景至少包含：

- `scenarioId`
- `pageType`
- `passed`
- `successRate`
- `durationMs`
- `tokenEstimate`
- `payloadBytes`
- `keyResultSummary`
- `evidenceRef`
- `artifactRefs`

并附带 `modeMetrics`（`compact/normal/full` 三档体积、耗时、token估算）。

### 3.2 提交后追踪输出（`t4:post-submit`）

输出包含：

- `commitSha`
- `checks[]`（name/status/conclusion/detailsUrl/blocking）
- `summary.blocked`
- `summary.exceptionBreakdown`
- `exceptions[]`（category、nextAction）

## 4. 异常分类规则（最小版）

- `environment`：典型为 `timed_out / cancelled / startup_failure`
- `quality`：典型为 `typecheck/build/test/docs/audit/quality` 类失败
- `product`：典型为 `smoke/acceptance/baseline/e2e/real` 类真实场景失败

## 5. 结果解释建议

当 `summary.blocked = true` 时，默认视为阻塞态，需要继续闭环：

1. 先按分类执行 `nextAction`
2. 修复后重跑对应命令
3. 重新生成新一轮 JSON 证据

## 6. 后续扩展方向（不在本轮实现）

- 接入登录态黄金场景（L4）
- 引入更稳定的 workflow detail 语义断言（Summary/Show all jobs 前置）
- 接入 nightly/候选发布流水线
- 增加跨版本趋势对比（token、耗时、成功率、误点击率）

## 7. 第二阶段入口（登录态黄金场景）

T4 第二阶段已提供抖音登录态黄金场景门禁入口：

```bash
pnpm run t4:douyin-golden-baseline
```

详细说明见：

- `docs/T4_DOUYIN_LOGIN_GOLDEN_GATE_zh.md`
