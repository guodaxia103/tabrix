# Tabrix 任务证据索引与验收资产目录

最后更新：`2026-04-15 Asia/Shanghai`
适用项目：`Tabrix`
文档编号：`TPM-2026-007`
文档版本：`v2026.04.15.3`
文档状态：`active`

---

## 1. 文档目标

本文档用于统一管理 `Tabrix` 任务执行过程中产生的证据和验收资产，解决以下问题：

1. 任务做完了，但日志、截图、artifact、脚本结果散落在不同地方
2. 发版时无法快速回答“这项能力真实验证过没有”
3. nightly、release、真实助手链路验证的证据难以复用
4. 某个任务完成后，无法快速定位对应证据

---

## 2. 证据管理原则

### 2.1 证据类型

当前统一承认以下证据类型：

1. `代码级证据`
   - 测试结果
   - typecheck 结果
   - lint / audit / release check 结果

2. `链路级证据`
   - `status`
   - `doctor`
   - `smoke`
   - `stdio-smoke`
   - MCP initialize / tools/list / tools/call 结果

3. `真实助手链路证据`
   - `Codex -> Claude CLI -> Tabrix MCP 服务 -> 真实 Chrome`
   - Claude CLI 调用日志
   - 页面操作成功/失败结论

4. `页面级证据`
   - screenshot
   - GIF
   - DOM artifact
   - replay artifact

5. `发布级证据`
   - acceptance matrix
   - release note
   - release readiness checklist
   - nightly report

### 2.2 证据记录要求

每个任务完成后，至少要记录：

1. 证据编号
2. 对应任务编号
3. 证据类型
4. 证据位置
5. 证据用途
6. 是否已验证通过

---

## 3. 证据编号规则

推荐格式：

`EV-YYYY-XXX`

示例：

- `EV-2026-001`
- `EV-2026-002`

如果需要细分到任务，可加任务号：

`EV-T1-001`

---

## 4. 当前证据目录建议

### 4.1 文档类证据

| 证据         | 位置                                      | 用途             |
| ------------ | ----------------------------------------- | ---------------- |
| 验收矩阵     | `docs/ACCEPTANCE_MATRIX_2026-04-15_zh.md` | 真实验收结论     |
| 发布检查清单 | `docs/RELEASE_READINESS_CHECKLIST_zh.md`  | 发版门槛         |
| 发布说明     | `docs/RELEASE_NOTES_v2.0.8.md`            | 当前版本对外结论 |
| nightly 模板 | `docs/NIGHTLY_REPORT_2026-04-11.md`       | 夜间回归报告模板 |

### 4.2 产品管理类证据

| 证据         | 位置                                                                       | 用途               |
| ------------ | -------------------------------------------------------------------------- | ------------------ |
| 主任务系统   | `docs/product-management/PRODUCT_TASK_SYSTEM_AND_EXECUTION_QUEUE_zh.md`    | 任务制度与主任务池 |
| 执行看板     | `docs/product-management/PRODUCT_TASK_BOARD_AND_UPDATE_TEMPLATE_zh.md`     | 日常推进与回写     |
| 决策日志     | `docs/product-management/PRODUCT_DECISION_LOG_zh.md`                       | 关键产品决策       |
| 版本装箱     | `docs/product-management/PRODUCT_VERSION_PACKAGING_AND_RELEASE_PLAN_zh.md` | 任务到版本映射     |
| 依赖与风险   | `docs/product-management/PRODUCT_TASK_DEPENDENCY_AND_RISK_REGISTER_zh.md`  | 任务依赖与风险     |
| Codex 提示词 | `docs/product-management/CODEX_EXECUTION_PROMPTS_T1_T16_zh.md`             | 任务投喂执行       |

### 4.3 运行与验证类证据

当前建议按以下位置收口：

| 类型                                              | 建议位置                               |
| ------------------------------------------------- | -------------------------------------- |
| 命令输出摘要                                      | 写入任务完成记录                       |
| Claude CLI 真实链路验证结论                       | 写入任务完成记录 + acceptance 相关文档 |
| screenshot / GIF / DOM artifact / replay artifact | 由对应任务记录具体生成位置             |
| daemon / runtime 日志                             | 使用现有日志位置，并在任务回写中登记   |

---

## 5. 当前任务证据索引

## 5.1 T1-T7 主链路任务

| 任务 | 关键证据类型                     | 最低要求                                                                                                                         |
| ---- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| T1   | 连接方式收口与活跃客户端治理证据 | typecheck + test:core + Popup 两模式验证 + 默认远程开启/Token 就绪验证 + 活跃/失效/手动断开客户端治理验证 + 一次真实助手链路验证 |
| T2   | 恢复链路结果                     | 浏览器关闭恢复 + bridge 断连恢复 + 一次真实助手链路恢复验证                                                                      |
| T3   | 工具失败语义验证                 | 非 web tab / page_not_ready / target_not_found 场景验证 + 一次真实助手链路验证                                                   |
| T4   | 验收门禁证据                     | fast/full 验收记录 + 第二客户端验证 + 副作用检查                                                                                 |
| T5   | Codex 接入证据                   | 最短接入验证 + 首个成功 tool call + 兼容矩阵条目                                                                                 |
| T6   | 复用边界证据                     | 第三方复用矩阵 + NOTICE 规则 + 许可证复核记录                                                                                    |
| T7   | 真 E2E 证据                      | fixture case 结果 + 真实 MCP E2E 跑通记录                                                                                        |

## 5.2 T8-T12 差异化能力任务

| 任务 | 关键证据类型   | 最低要求                                                   |
| ---- | -------------- | ---------------------------------------------------------- |
| T8   | 结构化输出对比 | 三模式输出样例 + token 成本对比 + 与 click/fill 协同结果   |
| T9   | artifact 证据  | DOM artifact 引用样例 + session/result normalizer 对接结果 |
| T10  | 命中率证据     | fallbackChain 样例 + 命中前后对比                          |
| T11  | 经验复用证据   | 重复任务复用样例 + token 成本或成功率收益                  |
| T12  | 失败复盘证据   | replay/GIF/screenshot/DOM artifact 中至少一种强证据        |

## 5.3 T13-T16 治理与裁剪任务

| 任务 | 关键证据类型         | 最低要求                               |
| ---- | -------------------- | -------------------------------------- |
| T13  | nightly 报告证据     | 自动生成的 nightly 报告 + 失败证据引用 |
| T14  | 产品面收缩证据       | 默认入口变更前后说明 + 文档同步结果    |
| T15  | workflow UI 降级证据 | UI 收缩结果 + v3 内核回归结果          |
| T16  | 退场评估证据         | 模块盘点表 + 保留/降级/删除结论        |

---

## 6. 任务完成后如何登记证据

推荐在任务完成记录中补这一段：

```md
证据记录：

- 证据编号：
- 对应任务：
- 证据类型：
- 证据位置：
- 是否通过：
- 用途说明：
```

如果一个任务有多份证据，可补多条。

### 6.1 最新登记示例：T6

```md
证据记录：

- 证据编号：EV-T6-001
- 对应任务：T6
- 证据类型：复用边界证据
- 证据位置：
  - docs/THIRD_PARTY_REUSE_MATRIX_zh.md
  - docs/THIRD_PARTY_REUSE_WORKFLOW_zh.md
  - docs/third-party/README.md
  - NOTICE
  - docs/CONTRIBUTING.md
  - docs/RELEASE_PROCESS.md
  - docs/RELEASE_READINESS_CHECKLIST_zh.md
  - .github/pull_request_template.md
  - docs/NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md
- 是否通过：是
- 用途说明：证明仓库级第三方复用矩阵、NOTICE 基线、来源记录目录和流程入口已正式落地
```

---

## 7. 真实助手链路证据模板

```md
真实助手链路证据：

- 证据编号：
- 对应任务：
- 验证链路：
  - Codex -> Claude CLI -> Tabrix MCP 服务 -> 真实 Chrome
- 指令摘要：
- 页面/站点：
- 结果：
  - 成功 / 失败
- 日志位置：
- 页面证据位置：
- 结论：
```

---

## 8. 发版前最少证据集

### 8.1 `v2.0.9`

发版前至少应能拿出：

1. `T1-T7` 的关键完成记录
2. `fast / full` 验收记录
3. 双链路主流程验证结果
4. 至少一条真实助手链路证据
5. E2E fixture 回归结果
6. release readiness checklist

### 8.2 `v2.1.0`

发版前至少应能拿出：

1. `T8-T12` 的关键对比样例
2. DOM artifact 样例
3. locator/fallbackChain 命中率证据
4. experience memory 的复用收益样例
5. 至少一类失败 replay 证据

---

## 9. 后续维护要求

每次任务完成后，建议同步检查：

1. 是否已补完成记录
2. 是否已补证据记录
3. 是否已同步飞书
4. 是否需要把证据写回 acceptance / nightly / release 文档

---

## 10. 版本记录

### v2026.04.15.3

- 将 `T1` 的最低证据要求从“双链路验证结果”更新为“连接方式收口与活跃客户端治理证据”
- 明确 `T1` 需保留 Popup 两模式、默认远程开启、Token 就绪和失效会话治理验证结果

### v2026.04.15.2

- 记录 `T6` 的首条正式证据示例 `EV-T6-001`
- 明确 `T6` 的证据位置、用途和通过结论

### v2026.04.15.1

- 建立 Tabrix 任务证据索引与验收资产目录
- 明确证据类型、证据编号规则、任务证据最低要求
- 明确 `v2.0.9` 与 `v2.1.0` 的发版前最少证据集
