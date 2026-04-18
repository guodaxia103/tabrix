# Tabrix T4 第二阶段：抖音登录态黄金场景门禁

本文件定义 T4 第二阶段最小工程化资产：把抖音登录态黄金场景验收从“一次性人工操作”收敛为可重复执行、可结构化记录、可沉淀证据的门禁输出。

## 1. 目标与范围

当前范围（已落地）：

- 固定两个登录态黄金场景：
  - `DY-L4-001` 抖音热点宝热点读取
  - `DY-L4-002` 抖音创作者中心概览读取
- 提供可重复执行入口：
  - `pnpm run t4:douyin-golden-baseline`
- 固定标准化输出字段：
  - 场景编号、是否通过、耗时、关键指标提取结果、证据路径、artifact 引用
- 明确只读/导航边界：
  - 仅允许 `chrome_navigate` 与 `chrome_read_page`
  - 明确禁止高风险写操作

当前不做：

- 表格/列表智能全量实现
- Knowledge / Policy / Memory
- T10 / T11 / T12 完整能力
- 发布/提交类高风险动作

## 2. 执行入口

```bash
pnpm run t4:douyin-golden-baseline
```

常用参数：

- `--hotspot-url <url>`：覆盖 `DY-L4-001` 起始 URL
- `--hotspot-url-candidates <url1,url2,...>`：覆盖 `DY-L4-001` 候选热点入口列表
- `--creator-url <url>`：覆盖 `DY-L4-002` 起始 URL
- `--out-dir <path>`：输出目录（默认 `.tmp/t4-douyin-golden`）
- `--timeout-ms <ms>`：单工具调用超时
- `--non-strict`：即使场景阻塞也返回 0（默认阻塞时退出 1）

环境变量（可选）：

- `TABRIX_DY_HOTSPOT_URL`
- `TABRIX_DY_HOTSPOT_URL_CANDIDATES`（逗号分隔）
- `TABRIX_DY_CREATOR_URL`

## 3. 场景输入与允许动作

### 3.1 DY-L4-001 抖音热点宝热点读取

- 输入：
  - 起始 URL（默认 `TABRIX_DY_HOTSPOT_URL` 或脚本默认值）
- 允许动作：
  - `chrome_navigate`
  - `chrome_read_page`
- 目标结构化输出：
  - `pageRole`
  - `primaryRegion`
  - `hotspotMetricLabels`
  - `taskEntryHead`

### 3.2 DY-L4-002 抖音创作者中心概览读取

- 输入：
  - 起始 URL（默认 `TABRIX_DY_CREATOR_URL` 或脚本默认值）
- 允许动作：
  - `chrome_navigate`
  - `chrome_read_page`
- 目标结构化输出：
  - `pageRole`
  - `primaryRegion`
  - `creatorMetricLabels`
  - `taskEntryHead`

## 4. 标准输出字段

每个场景输出至少包含：

- `scenarioId`
- `pageType`
- `passed`
- `successRate`
- `durationMs`
- `tokenEstimate`
- `payloadBytes`
- `keyIndicators`（结构化业务结果）
- `evidenceRef`
- `artifactRefs`
- `readOnlyBoundary`
- `loginState`
- `failureCategory`
- `hotspotEntryDiagnosis`（仅 `DY-L4-001`）

套件输出包含：

- `suiteId`（`T4-DY-LOGIN-GOLDEN`）
- `scenarioCount`
- `passedCount`
- `blocked`
- `releaseCandidateEligible`

## 5. 验收逻辑（最小版）

- 登录态守卫：
  - 若识别到 `login_required` 或登录门页关键词，场景失败，不尝试自动登录
- 业务信号守卫：
  - 热点宝场景需命中热点相关指标标签
  - 创作者中心场景需命中概览相关指标标签
- 热点入口校准守卫（仅 `DY-L4-001`）：
  - 先按候选入口列表逐个导航并探测
  - 命中热点页信号后再进入正式快照验收
  - 若候选入口均未命中，则输出明确失败分类
- 风险守卫：
  - 若出现高风险写操作工具，场景失败

### 5.1 DY-L4-001 失败分类

`DY-L4-001` 当前会明确输出以下分类：

- `account_no_hotspot_permission`
  - 典型信号：多个热点候选入口都落到 `.../data/following/following` 等关注页回退
- `entry_unavailable_or_redirected`
  - 典型信号：候选入口未命中热点页，且不符合“权限回退”特征
- `page_signal_not_matched`
  - 典型信号：已进入热点相关页面，但结构化业务信号不足
- `account_login_required`
  - 典型信号：命中登录门页

### 5.2 候选入口优先级

`DY-L4-001` 的候选入口按以下顺序去重执行：

1. `--hotspot-url`
2. `--hotspot-url-candidates`
3. `TABRIX_DY_HOTSPOT_URL_CANDIDATES`
4. 脚本内默认候选入口

## 6. 证据沉淀

- 输出目录：
  - `.tmp/t4-douyin-golden/<run-id>/summary.json`
- 场景证据：
  - `.tmp/t4-douyin-golden/<run-id>/evidence/dy-l4-001.json`
  - `.tmp/t4-douyin-golden/<run-id>/evidence/dy-l4-002.json`

每个场景证据文件保留：

- 输入与允许动作
- 实际工具调用路径
- 各模式快照结果
- 结构化业务判定
