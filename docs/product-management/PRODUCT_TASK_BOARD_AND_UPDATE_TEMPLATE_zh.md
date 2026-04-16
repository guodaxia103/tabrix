# Tabrix 执行看板与任务回写模板

最后更新：`2026-04-16 Asia/Shanghai`
适用项目：`Tabrix`
文档编号：`TPM-2026-002`
文档版本：`v2026.04.16.1`
文档状态：`active`
飞书留档：`https://www.feishu.cn/docx/Tx7Ed9rHsocadWxmWOdckPounrd`

---

## 1. 文档目标

本文档是 `product-management/PRODUCT_TASK_SYSTEM_AND_EXECUTION_QUEUE_zh.md` 的配套执行文档，用于解决两个实际问题：

1. 后续在飞书里如何用更适合阅读的“看板视图”管理 `T1-T16`
2. 每完成一个任务后，应该如何标准化回写本地与飞书文档

本文件更偏执行，不替代主任务系统文档。

当前飞书文档：

- `https://www.feishu.cn/docx/Tx7Ed9rHsocadWxmWOdckPounrd`
- 主文档飞书地址：`https://www.feishu.cn/docx/KTrod3bQGoGZCfxPGsNckLoNnrd`

---

## 2. 使用规则

### 2.1 本文档什么时候用

以下场景默认使用本文档：

1. 查看当前任务池总览
2. 判断下一项最适合执行的任务
3. 任务开始时更新状态
4. 任务完成后补回写记录
5. 准备同步飞书时复制模板内容

### 2.2 与主文档的关系

- 主文档负责：
  - 任务制度
  - 版本制度
  - 完整任务定义
- 本文档负责：
  - 飞书友好的执行看板
  - 标准回写模板
  - 任务完成后的更新动作清单

### 2.3 AI 助手首次入仓必读

如果执行者是第一次进入 `Tabrix` 仓库，开始任何任务前，默认先读：

1. `AGENTS.md`
2. `docs/product-management/AI_ONBOARDING_QUICKSTART_zh.md`
3. `docs/AI_DEV_RULES_zh.md`
4. `docs/product-management/CURRENT_CAPABILITIES_AND_BOUNDARIES_zh.md`
5. `docs/product-management/CODE_ENTRYPOINTS_AND_OWNERSHIP_zh.md`

推荐目的：

- 先统一产品主线与边界
- 再统一代码入口和真相源认知
- 最后再进入具体任务执行

---

## 3. 执行看板

### 3.1 当前主看板

| 任务 | 标题                                       | 级别    | 建议版本 | 当前状态    | 下一动作                               |
| ---- | ------------------------------------------ | ------- | -------- | ----------- | -------------------------------------- |
| T1   | 主线连接方式与客户端会话模型收口           | Blocker | v2.0.9   | done        | 切换到 T2 助手命令恢复链路             |
| T2   | 助手命令恢复链路                           | Blocker | v2.0.9   | in_progress | 收口状态机、readiness gate、按需恢复   |
| T3   | 核心 browser tool 统一保护协议             | Blocker | v2.0.9   | todo        | 统一非 web / 未稳定 / 未命中语义       |
| T4   | 真实验收门禁化                             | Blocker | v2.0.9   | todo        | 固化 fast/full 与第二客户端验收        |
| T5   | Codex 客户端一等接入                       | Blocker | v2.0.9   | todo        | 收口 Codex 接入路径与文档              |
| T6   | 第三方复用矩阵与 NOTICE 流程               | Blocker | v2.0.9   | done        | 切换到 T1 双链路协议回归               |
| T7   | 真实 MCP E2E fixture 站点与回归框架        | Blocker | v2.0.9   | todo        | 建立真正走 MCP 的 E2E 回归             |
| T8   | DOM 脱水与极简 JSON 树输出                 | Target  | v2.1.0   | todo        | 让 read_page 支持 compact/normal/full  |
| T9   | DOM artifact 接入 execution session        | Target  | v2.1.0   | todo        | 打通 artifactRefs 与 result normalizer |
| T10  | locator 排名 / fallbackChain / fingerprint | Target  | v2.1.0   | todo        | 提升 click/fill/read-page 命中稳定性   |
| T11  | URL Experience Memory v1                   | Target  | v2.1.0   | todo        | 基于 v3 沉淀站点经验复用               |
| T12  | 失败流程 replay artifact                   | Target  | v2.1.0   | todo        | 建立失败证据和可回放能力               |
| T13  | nightly 稳定性与回归报告自动化             | Target  | v2.0.9   | todo        | 建立 nightly gate 和统一报告           |
| T14  | 智能助手退出默认产品面                     | Target  | v2.0.x   | todo        | 收缩默认产品位，降级 experimental      |
| T15  | 工作流 UI 降级，保留 v3 内核               | Target  | v2.0.x   | todo        | 收缩 UI 承诺，保留内核                 |
| T16  | 本地模型 / 语义索引 / 向量搜索退场评估     | Stretch | v2.0.x   | todo        | 做正式退场评估和最小收缩               |

### 3.2 默认推荐顺序

1. T6
2. T1
3. T2
4. T3
5. T4
6. T5
7. T7
8. T13
9. T8
10. T9
11. T10
12. T11
13. T12
14. T14
15. T15
16. T16

---

## 4. 任务开始时怎么更新

当某个任务正式开始执行时，至少要更新以下内容：

1. 主文档里的任务状态：`todo -> in_progress`
2. 本文档里的看板状态：`todo -> in_progress`
3. 文档版本号递增
4. 飞书文档同步更新

### 4.1 任务开始模板

```md
任务启动记录：

- 任务编号：
- 任务标题：
- 启动时间：
- 执行者：
- 当前状态：in_progress
- 启动原因：
- 计划完成的范围：
- 明确不做的范围：
- 预期验收：
- 下一次同步点：
```

---

## 5. 任务完成后怎么回写

任务完成后，默认必须同时回写：

1. 主文档
2. 本文档
3. 飞书文档

### 5.1 最低回写要求

至少补以下内容：

- 状态变更：`in_progress -> done` 或 `blocked`
- 完成时间
- 执行者
- 主要改动
- 验收结果
- 风险与遗留
- 下一任务建议

### 5.2 标准回写模板

```md
任务完成记录：

- 任务编号：
- 任务标题：
- 完成时间：
- 执行者：
- 当前状态：done
- ## 主要改动：
  -
  -
- ## 验收结果：
  -
- 真实助手链路验证：
  - 是否需要：
  - 实际执行路径：
  - 验证结论：
  - 证据位置：
- ## 风险与遗留：
  -
- ## 影响文档：
  -
- ## 影响版本：
- ## 下一任务建议：
```

### 5.3 阻塞模板

```md
任务阻塞记录：

- 任务编号：
- 任务标题：
- 阻塞时间：
- 执行者：
- 当前状态：blocked
- ## 已完成部分：
  -
- ## 阻塞原因：
- ## 是否可绕过：
- ## 建议处理动作：
- ## 下一任务建议：
```

---

## 6. 真实助手链路验证回写模板

凡是涉及浏览器主链路的任务，建议补这一段：

```md
真实助手链路验证记录：

- 验证日期：
- 验证链路：
  - Codex -> Claude CLI -> Tabrix MCP 服务 -> 真实 Chrome
- 验证目标任务：
- 测试指令摘要：
- 页面/站点：
- 结果：
  - 成功 / 失败
- 关键证据：
  - Claude CLI 日志：
  - Tabrix 状态/输出：
  - 页面截图 / GIF / DOM artifact / replay artifact：
- 结论：
- 是否可复现：
```

---

## 7. 飞书同步动作清单

每次飞书同步时，至少检查以下内容：

1. 标题是否带当前文档版本号
2. 当前状态是否已同步
3. 新增任务是否已出现
4. 完成记录是否已写入
5. 飞书内容是否与本地主文档一致
6. onboarding / 边界 / 入口类文档是否已同步到索引

### 7.1 飞书同步建议顺序

1. 先更新本地 `md`
2. 再同步飞书
3. 再检查飞书展示效果
4. 最后把飞书链接写回本地主文档或本文件

---

## 8. 每周建议维护动作

即使没有新任务完成，也建议周期性维护：

1. 检查当前是否仍按推荐顺序推进
2. 检查是否有任务需要从 `todo` 改为 `deferred`
3. 检查文档版本与飞书是否一致
4. 检查是否需要补新的 release note 候选项
5. 检查是否有新的真实验收结论需要写回

---

## 9. 当前飞书协作建议

飞书中建议至少保留两份文档：

1. 主文档：
   - `Tabrix 产品任务系统与连续执行队列`
2. 执行文档：
   - `Tabrix 执行看板与任务回写模板`

其中：

- 主文档负责完整制度和任务定义
- 执行文档负责日常推进与回写

---

## 10. 最新任务完成记录

### T1 主线连接方式与客户端会话模型收口

- 启动时间：`2026-04-15`
- 执行者：`产品线程 + Codex CLI`
- 当前状态：`done`
- 启动原因：
  - 当前 Popup 仍暴露 `本机 / stdio / 远程` 三种模式，和项目已确认的两条主线 transport 不一致
  - 客户端列表直接展示原始 `Streamable HTTP` session 快照，导致同一客户端重连后堆积出大量无效条目
- 本轮计划范围：
  - 去掉 `本机` 顶层模式，只保留 `stdio` 与 `远程（Streamable HTTP）`
  - 默认选中并默认开启 `远程（Streamable HTTP）`
  - 明确 `localhost HTTP` 与局域网远程 HTTP 的展示与鉴权语义
  - 将客户端列表重定义为“有效活跃客户端 / 活跃 MCP 会话”，补最小状态与清理策略
  - 同步状态接口语义、文档与验收口径
- 明确不做的范围：
  - 不新增 transport
  - 不扩展新 browser tool
  - 不做无关页面重构
- 预期验收：
  - Popup 顶层只保留两种模式
  - 默认远程开启且 Token 已就绪
  - UI 与文档能清楚区分：`本机 HTTP（免 Token）`、`远程 HTTP（需 Token）`、`stdio`
  - 客户端主列表不再展示历史无效 session 堆积
  - `127.0.0.1` 本机 HTTP 不被误看成远端客户端
  - 包含真实助手链路验证
- 下一次同步点：`Codex CLI 完成首轮实现与验证后`

### T1 主线连接方式与客户端会话模型收口

- 完成时间：`2026-04-15`
- 执行者：`产品线程 + Codex CLI`
- 当前状态：`done`
- 主要改动：
  - Popup 顶层正式收口为 `远程（Streamable HTTP）` 与 `stdio`
  - 默认配置区落在 `远程`，并默认提供带 Bearer 的可复制远程配置
  - 客户端来源从原始 `127.0.0.1 · HTTP` 收口为语义化表达：`本机 · HTTP（免 Token）`
  - 单会话客户端不再重复显示 `1 个会话`
  - 顶部主标签默认只保留 `有效活跃客户端`
- 验收结果：
  - 已完成验证：`pnpm run typecheck`、`pnpm -C packages/shared build`、`pnpm run test:core`
  - 已完成验证：`pnpm -C app/chrome-extension exec vitest run tests/popup-connected-clients.test.ts`
  - 已完成验证：`pnpm -C app/chrome-extension build`
  - 已完成验证：`stdio-smoke`
  - 已完成验证：带 Token 的 `Streamable HTTP smoke`
  - 已完成真实 Popup 验证：默认 `远程`、两模式收口、客户端行文案收口、时间文案收短
  - 已完成真实 Popup 打开前后状态对照：`active/client` 不增长
- 风险与遗留：
  - 浏览器内部页 / 扩展页上的内容脚本注入报错仍需在 `T3` 统一收口为结构化失败
- 下一任务建议：`T2 助手命令恢复链路`

### T2 助手命令恢复链路

- 启动时间：`2026-04-16`
- 执行者：`产品线程 + Codex CLI`
- 当前状态：`in_progress`
- 启动原因：
  - `T1` 已完成连接方式、客户端会话模型和 Popup 默认只读状态的收口
  - 主线下一阶段需要把浏览器未启动、bridge 未就绪、command channel 未就绪的恢复能力做成真实产品能力
- 当前已完成：
  - 扩展背景页已向本机服务回写 `/bridge/recovery/start` 与 `/bridge/recovery/finish`
  - 本机服务已新增恢复状态路由，`status/doctor` 可读取 `recoveryAttempts / recoveryInFlight / lastRecoveryAction`
  - 已完成扩展侧恢复事件测试与服务端路由测试
  - 已完成 `pnpm -C app/chrome-extension exec vitest run tests/native-host.test.ts`
  - 已完成 `pnpm -C app/native-server exec jest src/server/bridge-recovery-routes.test.ts src/server/bridge-state.test.ts --runInBand`
  - 已完成 `pnpm -C app/chrome-extension build`、`pnpm -C app/native-server build`、`pnpm run extension:reload`、`stdio-smoke`
- 当前剩余动作：
  - 继续收口浏览器未启动、bridge 未就绪、command channel 未就绪三类真实恢复场景
  - 补 `Codex -> Claude CLI -> Tabrix -> Chrome` 的真实恢复链路验收
  - 回写 `status/doctor/report` 的最终用户侧诊断口径
- 下一任务建议：`继续完成 T2，不切换到 T3`

### T6 第三方复用矩阵与 NOTICE 流程

- 完成时间：`2026-04-15`
- 执行者：`Codex CLI + 产品线程复核`
- 当前状态：`done`
- 主要改动：
  - 新增 `THIRD_PARTY_REUSE_MATRIX` 中英双语文档
  - 新增 `THIRD_PARTY_REUSE_WORKFLOW` 中英双语文档
  - 新增 `docs/third-party/README.md` 与 `NOTICE` 基线
  - 将规则接入 `CONTRIBUTING`、`RELEASE_PROCESS`、`RELEASE_READINESS_CHECKLIST`、PR 模板
  - 从 `NEXT_PHASE_OPEN_SOURCE_REUSE_PLAN_zh.md` 回链到正式落地文档
- 验收结果：
  - 仓库内已存在正式矩阵、工作流、来源记录目录和 `NOTICE`
  - 流程入口文件已能看到第三方复用检查项
  - 本次为文档/流程改动，未运行自动化测试
- 风险与遗留：
  - 尚未把第三方复用规则接进 `release:check` 或 CI 自动阻断
  - 真实发生复用时，仍需在 `docs/third-party/` 逐项补项目级来源记录
- 下一任务建议：`T1 双链路协议回归`

---

## 11. 版本记录

### v2026.04.16.1

- 将 `T1` 状态收口为 `done`
- 将 `T2` 状态切换为 `in_progress`
- 回写 `T1` 最终验收与 `T2` 启动记录

### v2026.04.15.11

- 删除顶层任务编号 `T1A`，执行看板重新收口为正式的 `T1-T16`
- 将 `T1` 状态统一收口为 `in_progress`
- 将 Popup 去动作化、多 session 弱化、客户端名展示优化改为 `T1` 的当前剩余动作

### v2026.04.15.10

- 回写 Popup 首轮体验修正结果：默认不再打开即重连、多 session 降为次级诊断、Popup 前后 `active/client` 对照保持 `0 -> 0`

### v2026.04.15.9

- 将“Popup 打开即重连”“多 session 主文案过重”“泛化客户端名如 mcp 的展示策略”纳入执行看板
- 该变更在 `v2026.04.15.11` 已纠偏并并回 `T1`

### v2026.04.15.8

- 将 `T1` 从 `in_progress` 更新为 `done`
- 补充 `T1` 正式完成回写：两种连接方式验证、Popup 实机签收、客户端文案收口结论

### v2026.04.15.7

- 将 `localhost HTTP` 与局域网远程 HTTP 的鉴权/展示边界补入 `T1`
- 明确 `127.0.0.1` 本机 HTTP 不应被误表达为远端客户端

### v2026.04.15.6

- 新增 AI 助手首次入仓必读清单
- 补充 onboarding / 边界 / 入口类文档的同步检查项

### v2026.04.15.5

- 回写 `T1` 首轮执行结果，明确“代码实现已完成、真实链路验收待补”
- 保持 `T1` 状态为 `in_progress`，不提前关单

### v2026.04.15.4

- 将 `T1` 状态从 `todo` 更新为 `in_progress`
- 将 `T1` 标题更新为“主线连接方式与客户端会话模型收口”
- 增加 `T1` 正式启动记录，收口本轮执行范围、非范围与预期验收

### v2026.04.15.3

- 将 `T6` 状态更新为 `done`
- 登记第一条正式任务完成结果，确认执行看板开始从“制度文档”进入“实际任务运行态”

### v2026.04.15.2

- 补充飞书留档链接
- 明确本地执行文档与飞书执行文档的一一映射

### v2026.04.15.1

- 建立 Tabrix 执行看板与任务回写模板
- 补充任务开始模板、任务完成模板、任务阻塞模板
- 补充真实助手链路验证回写模板
- 补充飞书同步动作清单
