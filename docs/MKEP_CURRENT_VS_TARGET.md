# MKEP 现状 vs 目标态（Week 2 对齐稿）

> 文档版本：v0.1 · 2026-04-20
> 起草：项目组（Claude 作为总负责人；Memory / Knowledge / Experience 章节的现状调查由 Codex CLI 并行完成并经抽查核验）
> 目的：把当前 `main_tabrix` 代码库的实际形态对照 MKEP（Memory / Knowledge / Experience / Policy）四层做一次实证 gap 分析，作为后续路线图的事实基线。

---

## 0. 执行摘要（TL;DR）

1. **Memory 层接近零**：`SessionManager` 只是两个进程内 `Map`，`historyRef/memoryHints` 字段被硬编码为 `null/[]`，`artifactRefs` 从未被真正填充。Tabrix 今天**不会失败后记住**、**不会成功后沉淀**。服务重启即失忆。
2. **Knowledge 层被伪装成 TypeScript**：GitHub/抖音 站点知识以硬编码 `read-page-understanding-*.ts` 和 `read-page-high-value-objects-github.ts` 形式存在，没有数据层、没有版本/ownership、没有学习写入口。
3. **Experience 层有零散雏形但无归纳闭环**：dialog prearm、screenshot CDP→helper fallback、read-page 稀疏树回退、candidate-action 的 locator 优先级顺序都是 Experience 的"手工种子"，但不与 Memory 对接，无法从历史中自我更新。
4. **Policy 层已有 Phase 0 骨架**：`TOOL_RISK_TIERS` + `P3 explicit opt-in gate` 已落地（见 `docs/POLICY_PHASE_0.md`）。需要的下一步是把风险判定从"静态风险表"升级到"Memory + Knowledge 驱动的上下文风险判定"。
5. **战略判断**：Tabrix 当前是一个"**带硬编码站点适配的 MCP 工具合集 + 独立的 record-replay 运行时 + 新的 Policy 骨架**"。要达到产品定位的"记忆 → 学习 → 更优执行"，**下一阶段的唯一核心是把 Memory 真正落地**，因为 Memory 是 Experience 和 Policy 的真源，没有 Memory 其他三层都只能停留在硬编码阶段。

---

## 1. 评估方法

- **MKEP 参考**：Feishu wiki《Tabrix 记忆、知识、经验、规则能力规划 v2026.04.17.2》，本轮摘要固化在 `.tmp/mkep-week2/mkep-context.md`（后续将择要并入本文附录或独立 wiki）。
- **评估维度**：对每一层考察 4 件事——(1) 代码里**实际**有什么（带文件:行号），(2) 与目标态差距（✅/🟡/❌），(3)"看似有实则没有"的陷阱，(4) 最小抽象 + 演进建议。
- **证据纪律**：本文所有事实性断言均带具体文件路径与行号。读不到就明说"未找到"。**抽查** `session-manager.ts`、`read-page.ts`、`candidate-action.ts` 三处核心引用，事实与 Codex 侦察报告一致。

---

## 2. Memory 层：现状 vs 目标态

### 2.1 现状盘点

**Session / Task / Step 模型**

- `SessionManager` 只用两个进程内 `Map` 保存 `tasks/sessions`；`reset()` 直接清空，**无持久化**。`app/native-server/src/execution/session-manager.ts:38-40,172-175`
- `Task` 含 `taskType/title/intent/origin/owner/projectId/labels`；`ExecutionSession` 含 `transport/clientName/workspaceContext/browserContext/steps`；`ExecutionStep` 含 `toolName/inputSummary/resultSummary/errorCode/artifactRefs`。`app/native-server/src/execution/types.ts:9-51`
- 每次 MCP 工具调用都新建 `task -> session -> step`，但实际只传 `taskType/title/intent/origin/labels` 与 `transport/clientName/inputSummary`，**`owner/projectId/workspaceContext/browserContext` 从未被填充**。`app/native-server/src/mcp/register-tools.ts:900-918`

**HistoryRef / MemoryHints 现状（重点陷阱）**

- 契约层有 `historyRef?: string|null`、`memoryHints?: ReadPageMemoryHint[]`。`packages/shared/src/read-page-contract.ts:78-82,158-170`
- 生产者是 `read-page` 的 `buildExtensionLayer()`，当前**硬编码返回 `historyRef: null`、`memoryHints: []`**，调查范围内未找到消费者。`app/chrome-extension/entrypoints/background/tools/browser/read-page.ts:540-555`

**持久化层现状**

- 执行 Memory 本身未持久化（Map）。
- 仓库里**有别的持久化但不是这套执行 Memory**：native-server 的 agent 子系统用 `better-sqlite3 + drizzle` 落 `projects/sessions/messages`（`app/native-server/src/agent/db/schema.ts:16-145`），record-replay v3 用 IndexedDB 落 `runs/events/...`（`app/chrome-extension/entrypoints/background/record-replay-v3/storage/db.ts:7-166`）。这两个体系**都不回填 MCP 的 session/step**。

**证据（Evidence）链路**

- `read-page` 只生成 tab 级伪 ref：`artifact://read_page/tab-<id>/{normal|full}`，与 session/step 无主键关联。`app/chrome-extension/entrypoints/background/tools/browser/read-page.ts:410-415`
- `ExecutionStep.artifactRefs` 存在，但 `normalizeToolCallResult()` 固定给 `artifacts: []`，`handleToolCall()` 在 `completeStep()` 时**从未传 `artifactRefs`**。`app/native-server/src/execution/result-normalizer.ts:20-60`, `app/native-server/src/mcp/register-tools.ts:977-1094`

### 2.2 Gap 对照（MKEP Memory 五级）

| 要素     | 标记 | 说明                                                                                                             |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| Session  | 🟡   | 有 title/intent/origin/time/client，但无稳定 actor/tenant；上下文字段未实际填充；**不持久化**                    |
| Page     | 🟡   | `read-page` 有 url/title/pageRole/primaryRegion/quality，**未见 contentHash、settle 状态、与 session/step 绑定** |
| Action   | 🟡   | `ExecutionStep` 记录了工具名与摘要；`candidateActions.targetRef/locatorChain` 是页面**建议**，不是实际执行轨迹   |
| Result   | 🟡   | 类型支持 success/warning/failure，但 normalizer 实际只产出 success/failure，错误码近乎通用值                     |
| Evidence | ❌   | 无闭环；伪 `artifactRef` + RR-v3 截图事件都不写入 MCP session/step                                               |

### 2.3"看似有实则没有"的陷阱

- `SessionManager` 像 Memory，实则**进程内状态**，服务重启即失忆。
- `historyRef/memoryHints` 像记忆接口，实则**恒为 null/[]**。
- `artifact://read_page/...` 像证据引用，实则只是按 tabId 拼的字符串。
- HVO 的 `provenance/classificationReasons/scoringReasons` 像经验沉淀，实则只是**单次 read-page 的解释性输出**。

### 2.4 Memory Schema 最小初稿

```ts
interface MemorySession {
  id: string;
  intent: string;
  origin: 'mcp' | 'flow';
  actor?: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
}

interface MemoryPageSnapshot {
  id: string;
  sessionId: string;
  url: string;
  title: string;
  pageRole?: string;
  contentHash?: string;
  settleState?: 'settled' | 'sparse' | 'fallback';
}

interface MemoryAction {
  id: string;
  sessionId: string;
  pageSnapshotId?: string;
  toolName: string;
  targetRef?: string;
  locator?: { type: string; value: string };
  result: 'success' | 'failure' | 'partial';
  errorCode?: string;
  startedAt: string;
  endedAt?: string;
}

interface MemoryEvidenceRef {
  id: string;
  sessionId: string;
  actionId?: string;
  kind: 'dom_snapshot' | 'screenshot' | 'network_log' | 'hvo_snapshot';
  ref: string;
}
```

### 2.5 演进建议

| 优先级     | 动作                                                                                                  | 改动位置                                                                        | 验证                                     |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| **P0 / S** | `ExecutionSession/Step` 落 SQLite（"会消失的 Memory"先变成真存储）                                    | `app/native-server/src/execution/*`，新增 `execution/db/*`                      | 单测：重启后仍可查询 session/step        |
| **P0 / S** | `read-page` 生成真实 `historyRef` 并写 `MemoryPageSnapshot`                                           | `read-page.ts`, `packages/shared/src/read-page-contract.ts`, 新增 snapshot repo | 同 session 下可回查 page 快照            |
| **P1 / M** | 把 `targetRef/locatorChain` 从"候选"提升到"实际动作日志"；click/fill/navigate 等工具写 `MemoryAction` | `candidate-action.ts`, `interaction.ts`                                         | 端到端一次 click 后能查到目标 ref + 结果 |
| **P1 / M** | 把 `artifactRefs` 真正贯通（read-page DOM/HVO、screenshot、network capture）                          | 各工具 + `completeStep()`                                                       | step 查询可列出 evidence refs            |
| **P2 / M** | 评估复用 RR-v3 `run/event` schema（**借思路不混表**）                                                 | 调研 spike                                                                      | MCP Memory 与 flow history 不耦死        |

---

## 3. Knowledge 层：现状 vs 目标态

### 3.1 硬编码 Knowledge 反模式盘点

**`read-page-understanding-github.ts`**

- Site Profile：GitHub 站点识别只靠 repo URL/path 正则（`app/chrome-extension/entrypoints/background/tools/browser/read-page-understanding-github.ts:10-11`）。
- Page Catalog：pageRole 枚举 `repo_home / issues_list / actions_list / workflow_run_detail` 硬编码路由（同文件 `13-172`）。
- UI Map：每个 role 的 primary region 是一张"文本锚点 → region"表（`issues_results`、`workflow_run_summary` 的关键词集、优先级、confidence）。
- Data Hints：`workflow_run_detail` 的 `summary/jobs/artifacts/logs` 本质是该页结构化信息分布规律，目前混在 region 规则里（同文件 `81-102`）。

**`read-page-understanding-douyin.ts`**

- Site Profile、Page Catalog、UI Map、Data Hints 同样以中文 regex 常量形式散落在 `9-191` 行。

**`read-page-high-value-objects-github.ts`**

- Page Catalog / Object Priors：不同 pageRole 的高价值对象优先级、L0 前缀、seed labels 都是静态表（`30-101`）。
- Data Hints：`label -> objectType + region` 分类表，`Summary/Jobs/Artifacts/Logs` 是纯规则数据（`121-160`, `221-239`）。
- Ranking Knowledge：噪声词降权、preferred labels 加权埋在 TS 分支（`171-196`, `273-302`）。
- 契约缺口：public contract 只有 `objectType/region`，更细的 `objectSubType` 知识还停留在适配器内部（`packages/shared/src/read-page-contract.ts:83-116`，已在 T5.4.5 补齐）。

### 3.2 跨站共性模式（Knowledge schema 的字段候选）

1. `host/urlPattern -> pageRole`
2. `pageRole -> primaryRegion rules(patterns/minMatches/priority/confidence)`
3. `pageRole -> seed labels / preferred labels / noise labels`
4. `pageRole + label/ariaRole -> objectType/region`
5. `anchors/footer/login/i18n lexicon`（说明**多语言词表**是 Knowledge 子概念而非实现细节，见 `read-page-understanding-core.ts:47-115`）

### 3.3 Gap 对照

| 要素         | 标记 | 说明                                                                                                         |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------------ |
| Site Profile | 🟡   | 只有 domain + footer/login 词表；**未见 auth mode / rate limit / anti-bot / tenant scope 结构**              |
| Page Catalog | 🟡   | 硬编码 role 枚举，**无独立 Knowledge 表、无 schema/version/ownership**                                       |
| UI Map       | ❌   | 调查范围内**没有**"pageRole + purpose → stable locator hint"表；locator 在运行时从 interactive elements 生成 |
| Data Hints   | 🟡   | region 词表、seed label、object classifier 已有但散落，且 taskMode hints 残留 GitHub-flavored 常量           |

### 3.4 数据驱动 Knowledge Schema 初稿

```ts
type KnowledgePattern = string; // regex source
type Confidence = 'low' | 'medium' | 'high' | null;

interface KnowledgeSiteProfile {
  siteId: string;
  match: { hosts?: string[]; urlPatterns?: KnowledgePattern[] };
  locales?: string[];
  anchors?: string[];
  loginHints?: {
    patterns: KnowledgePattern[];
    credentialPatterns?: KnowledgePattern[];
    region?: string;
  };
  footerHints?: {
    legalPatterns: KnowledgePattern[];
    negativeContentPatterns?: KnowledgePattern[];
    maxAnchorMatches?: number;
    maxTrimmedLength?: number;
    fallbackRegion?: string;
  };
  authMode?: 'cookie_session' | 'sms_login' | 'unknown';
  antiBotHints?: string[];
}

interface KnowledgePageRoleRule {
  siteId: string;
  pageRole: string;
  match: {
    urlPatterns?: KnowledgePattern[];
    titlePatterns?: KnowledgePattern[];
    contentPatterns?: KnowledgePattern[];
  };
  primaryRegions?: Array<{
    region: string;
    patterns: KnowledgePattern[];
    minMatches?: number;
    priority?: number;
    confidence: Confidence;
  }>;
  fallback?: {
    pageRole?: string;
    primaryRegion?: string | null;
    primaryRegionConfidence?: Confidence;
  };
}

interface KnowledgeObjectClassifier {
  siteId: string;
  pageRole?: string;
  urlPatterns?: KnowledgePattern[];
  labelPatterns?: KnowledgePattern[];
  hrefPatterns?: KnowledgePattern[];
  ariaRoles?: string[];
  objectType: ReadPageObjectType;
  objectSubType: string;
  region?: string | null;
  seedLabels?: string[];
  scoreDelta?: number;
  reason?: string;
}

interface KnowledgeUIMap {
  siteId: string;
  pageRole: string;
  purpose: string; // e.g. 'submit_issue_cta', 'search_input'
  region?: string | null;
  locatorHints: Array<
    | { kind: 'aria_name'; value: string; role?: string }
    | { kind: 'label_regex'; value: KnowledgePattern; role?: string }
    | { kind: 'href_regex'; value: KnowledgePattern }
    | { kind: 'css'; value: string }
  >;
  actionType?: 'click' | 'fill' | 'navigate';
  confidence?: Confidence;
}
```

**关键要求**：这份 schema 必须能把今天 GitHub / 抖音 TS 文件里的**每一条规则**翻译成一条数据记录。当前抽查示例：

```ts
const githubWorkflowRunDetailRole: KnowledgePageRoleRule = {
  siteId: 'github',
  pageRole: 'workflow_run_detail',
  match: { urlPatterns: ['^https://github\\.com/[^/]+/[^/]+/actions/runs/\\d+'] },
  primaryRegions: [
    {
      region: 'workflow_run_summary',
      patterns: [
        '\\bsummary\\b',
        '\\bshow all jobs\\b',
        '\\bjobs?\\b',
        '\\bartifacts?\\b',
        '\\blogs?\\b',
      ],
      minMatches: 1,
      priority: 1000,
      confidence: 'high',
    },
  ],
};
```

### 3.5 迁移路径（硬编码 → 数据驱动）

- **阶段 1（落地优先）**：引入 `knowledge-registry`。入口改造：`inferPageUnderstanding`、`githubHighValueObjectAdapter.resolve`、`githubObjectLayerAdapter.classify/scorePrior`——先读 Knowledge 表，查不到再走现有 TS fallback（现有 T5 验收套件可以保护回归）。观测：双跑 diff `pageRole/primaryRegion/highValueObjects`。回退：feature flag。
- **阶段 2**：从 Memory 挖规则（URL→pageRole、成功点击 label、成功 ref/aria/css locator），写到 Knowledge "候选区"供人审后入表。兼容策略：Knowledge 命中只加分，不直接覆盖 fallback。
- **阶段 3**：family adapter 退化为极薄解释器；GitHub/抖音 TS 文件仅保留最小保底或测试夹具；taskMode hints 完全迁到 Knowledge 表。

### 3.6 Open Questions

- **写入权**：自动学习直接入表 vs "候选区 + 人审"？
- **作用域**：全局共享 / 租户私有 / "全局种子 + 私有覆盖"？
- **冲突仲裁**：同一 pageRole 多套 locator/classifier 怎么打分？
- **契约下沉**：`objectSubType` 是否要加入 `packages/shared` 公共契约？
- **子概念扩展**：i18n 词汇包应独立建模，不抽出来会继续把 Knowledge 伪装成实现细节。

---

## 4. Experience 层：现状 vs 目标态

### 4.1 现状盘点

**Task Recipe（任务配方）**

- 未找到"高层意图 → 有序步骤链"的通用 Experience 抽象。
- `read-page-task-protocol.ts` 产出 `taskMode / L0 / L1 / L2 / candidateActionIds`，是**页面理解摘要**，不是可复用 recipe（`app/chrome-extension/entrypoints/background/tools/browser/read-page-task-protocol.ts:53-60,249-281,454-474`）。
- 最接近 recipe 的是 record-replay 的 `Flow.steps/nodes/edges`（`app/chrome-extension/entrypoints/background/record-replay/types.ts:102-138`），但它是**录制/编排产物，不是从 Memory 归纳出的最佳路径**；工具层只做 `flowId -> runFlow`（`app/chrome-extension/entrypoints/background/tools/record-replay.ts:7-23`）。

**Locator Preference（定位器优先级）**

- 执行入口在 `interaction.ts:136`（非独立 `click.ts`）。
- 当前优先级**硬编码**：`explicitRef > candidate.targetRef > explicitSelector(css/xpath) > candidate locator ref > candidate locator css`（`app/chrome-extension/entrypoints/background/tools/browser/candidate-action.ts:43-88`）。
- `read_page` 会给候选动作挂 `targetRef` 并在 `locatorChain` 放 `aria`/`css`，但真正执行时只消费 `ref/css/xpath`（`interaction.ts:276-306,382`）。
- `screenshot.ts` 只支持 `selector/fullPage/background`，没有 `ref/text` 选择链（`screenshot.ts:49,153,233,250`）。

**Recovery Strategy（恢复策略）——已有的"手工种子"**

- 点击前 dialog prearm，TTL 8s（`dialog-prearm.ts:4,29`）。
- `handle_dialog` 重试轮询（`dialog.ts:14,87-157`）。
- 点击下载链接时的 preflight intercept（`interaction.ts:139,323,353,423`）。
- 截图的 CDP → helper fallback（`screenshot.ts:153,185,233`）。
- `read_page` 稀疏树时回退到 `get_interactive_elements` 并记录 `fallbackUsed/fallbackSource`（`read-page.ts:732,951,961-1000`）。
- **缺**：统一限流 backoff、CAPTCHA fallback、跨工具恢复规则库。

**Record-Replay 模块本质**

- `browser/record-replay-*.ts` 未找到；实际入口在 `app/chrome-extension/entrypoints/background/tools/record-replay.ts`。
- 本质是 **flow 发布与执行运行时**（`Flow/nodes/edges` 编排模型、`ExecutionOrchestrator` 执行器、`flow-store` 发布/列出）。可作为 Experience 的"承载壳"，但**不是**"从历史自动学习"的 Experience 层。

**统计与学习信号**

- 通用 `session-manager` / `execution/types.ts` 只有 `stepType/status/startedAt/endedAt/errorCode/errorSummary/artifactRefs`——**无 duration/success_rate/retry_count 聚合**。
- RR-v3 run log 里有 `tookMs/fallbackUsed/fallbackFrom/fallbackTo`（`record-replay/types.ts:146-157,172`），但**没并入通用 session Memory**。

### 4.2 Gap 对照

| 要素                 | 标记 | 说明                                                          |
| -------------------- | ---- | ------------------------------------------------------------- |
| Task Recipe          | 🟡   | 有 Flow + candidateActions，**没有"按意图自动挑最佳路径"**    |
| Locator Preference   | 🟡   | 有固定顺序，**没有 pageRole + elementPurpose 驱动的偏好学习** |
| Recovery Strategy    | 🟡   | 有 tool-local fallback/retry，**没有统一 recovery catalog**   |
| Action Decomposition | 🟡   | 有 candidateActions + Flow DAG，**未与 Memory 形成闭环**      |

### 4.3 Experience 最小抽象初稿

```ts
interface ExperienceTaskRecipe {
  taskKey: string; // Memory.task.intent + Memory.page.pageRole
  pageRole: string;
  preconditions: string[];
  steps: Array<{
    toolName: string;
    locatorStrategyId?: string;
    successRate: number; // aggregate(Memory.result.success)
    p50Ms?: number;
  }>;
}

interface ExperienceLocatorPreference {
  pageRole: string;
  elementPurpose: string; // from Knowledge UI map or clustered action labels
  order: Array<'ref' | 'css' | 'xpath' | 'aria' | 'text' | 'coords'>;
  successRateByLocator: Record<string, number>;
}

interface ExperienceRecoveryRule {
  trigger: string; // Memory.errorCode/errorSummary
  pageRole?: string;
  recoverySteps: string[];
  cooldownMs?: number;
}

interface ExperienceStat {
  key: string;
  runs: number;
  successRate: number;
  p50Ms?: number;
  retryRate?: number;
  fallbackRate?: number;
}
```

**闭环要求**：每个字段都能说清楚"从 Memory 哪些字段聚合而来"。Experience 不是另起炉灶，而是 **Memory 的物化投影**。

### 4.4 与 Memory / Knowledge 的接口

- Experience 从 **Memory** 读：intent / pageRole / primaryRegion / toolName / target locator / result / error / fallback / duration / evidence。
- Experience 从 **Knowledge** 读：pageRole 目录 / 元素 purpose / 稳定 UI map。
- Experience 被谁读：planning 选 recipe/locator/recovery；policy 在高失败率或低置信场景收紧自动执行；runtime 按偏好执行并**回写 Memory**。

### 4.5 演进建议与陷阱

| 优先级     | 动作                                                                                        | 说明                                        |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **P0 / S** | 通用 session-manager 补 `duration/retry/fallback` 字段，对齐 RR `tookMs/fallback*`          | 没有这些信号，Experience 无法从 Memory 归纳 |
| **P0 / M** | 把 `candidate-action.ts` 的硬编码顺序抽成 `LocatorPreferenceResolver`，默认保留现顺序       | 为后续"从 Memory 学 locator 偏好"留插桩点   |
| **P1 / M** | 把已有 dialog/download/screenshot/read_page fallback 提炼为统一 `ExperienceRecoveryRule` 表 | 把手工种子显式化                            |
| **P1 / M** | 用成功执行的 `candidateActionIds` / Flow run 归纳 `ExperienceTaskRecipe`，设最小晋升门槛    | recipe 不是录就是学                         |

**陷阱识别**：不要把手工录制的 Flow、或 `PAGE_ROLE_TASK_MODE_HINTS` 这类站点硬编码（`read-page-task-protocol.ts:101-110`）误当成"已学习出的 Experience"。

---

## 5. Policy 层：现状 vs 目标态

### 5.1 现状盘点

已有 **Phase 0 骨架**（详见 `docs/POLICY_PHASE_0.md`）：

- **`TabrixRiskTier`** 类型（P0/P1/P2/P3）+ `TabrixToolPolicyAnnotations` 接口。`packages/shared/src/tools.ts`
- **中心化 `TOOL_RISK_TIERS`** 映射表（覆盖所有 28 个在用 MCP 工具 + 3 个已注释工具）。`packages/shared/src/tools.ts`
- **`P3_EXPLICIT_OPT_IN_TOOLS`** 集合（7 个 P3 工具）。
- **`TABRIX_POLICY_ALLOW_P3`** 环境变量（`all` 或逗号分隔列表）控制 P3 工具是否可用。
- **Policy gate** 嵌入在 `handleToolCall` 中，在已有 `ENABLE_MCP_TOOLS/DISABLE_MCP_TOOLS/MCP_DISABLE_SENSITIVE_TOOLS` 过滤**之后**执行；违反时返回结构化错误 `code: 'TABRIX_POLICY_DENIED_P3'`。`app/native-server/src/mcp/register-tools.ts`
- `listTools` 动态注入 `riskTier + requiresExplicitOptIn` 到 annotations，让 MCP client 感知风险。
- 测试覆盖：31 个新单测（risk tier coverage invariants + opt-in 策略 + 端到端 policy gate），`native-server` 101 tests + `chrome-extension` 808 tests 零回归。

### 5.2 Gap 对照（MKEP Policy 目标态）

| 要素                           | 标记 | 说明                                                                      |
| ------------------------------ | ---- | ------------------------------------------------------------------------- |
| 静态风险分级                   | ✅   | Phase 0 已覆盖                                                            |
| 显式 opt-in gate               | ✅   | Phase 0 已覆盖（`TABRIX_POLICY_ALLOW_P3`）                                |
| 按站点/pageRole/任务的动态风险 | ❌   | Phase 0 未包含——需要 Knowledge + Memory 做上下文判断                      |
| 审计轨迹                       | 🟡   | Policy 拒绝有结构化错误，但**没有持久化审计日志**（受 Memory 层缺失阻塞） |
| 回滚意图/撤销能力              | ❌   | 完全未涉及，属于 P3 层工具自身契约，Phase 1+ 再谈                         |
| 用户级/租户级策略覆盖          | ❌   | Phase 0 是全局策略，无 per-user/per-tenant 策略                           |

### 5.3"看似有实则没有"的陷阱

- Phase 0 的风险是**静态标签**——`chrome_javascript` 永远 P3，但如果用户在 GitHub issues 页面执行一段只读 JavaScript vs 在银行后台执行同一段 JS，风险应**不同**。真正的 Policy 需要上下文（pageRole + Memory 的历史）。
- `TABRIX_POLICY_DENIED_P3` 是**阻断型**；MKEP 目标态的 Policy 应该是**渐进的**——低置信上下文先弹确认、中置信允许执行并加强审计、高置信才静默放行。

### 5.4 演进建议

| 优先级     | 动作                                                                                                  | 依赖                                          |
| ---------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **P0 / S** | 把 Policy 决策写入 Memory（`MemoryAction` 加 `policyDecision` 字段）                                  | 依赖 Memory 层 P0                             |
| **P1 / M** | 引入 `PolicyContext = { toolName, pageRole?, siteId?, recentFailureRate? }`，支持按 pageRole 覆盖风险 | 依赖 Knowledge 层阶段 1 + Experience 基础聚合 |
| **P1 / S** | 结构化审计日志（P2/P3 工具每次调用写一条 audit 记录）                                                 | 依赖 Memory 层 P0                             |
| **P2 / M** | 用户级/租户级 policy 覆盖层（个人可收紧不可放宽）                                                     | 独立                                          |

---

## 6. 跨层就绪矩阵

| 层             | 契约          | 实现            | 持久化                            | 学习闭环 | 产品就绪度 |
| -------------- | ------------- | --------------- | --------------------------------- | -------- | ---------- |
| **Memory**     | 🟡 部分       | 🟡 内存态 Map   | ❌                                | ❌       | ~15%       |
| **Knowledge**  | 🟡 含在适配器 | 🟡 硬编码 TS    | ❌                                | ❌       | ~20%       |
| **Experience** | ❌ 无统一契约 | 🟡 零散手工种子 | ❌                                | ❌       | ~10%       |
| **Policy**     | ✅ Phase 0    | ✅ Phase 0      | 🟡（错误返回结构化，无 audit 表） | ❌ 静态  | ~35%       |

**关键观察**：Policy 就绪度最高，但**天花板被 Memory 封死**——没有 Memory，Policy 无法演进成上下文感知的动态策略。Memory 是整个 MKEP 的**基础依赖**。

---

## 7. 迁移路径（季度级）

### Q1（Memory 主 · Policy 增量）

- 落地 `MemorySession/PageSnapshot/Action/EvidenceRef` 的 SQLite 存储（复用 `better-sqlite3 + drizzle`，与 agent db 分库或同库不同 schema）。
- `read-page` 生产真实 `historyRef` + 写 PageSnapshot；`click/fill/navigate` 写 Action；各工具 artifactRef 回填。
- Policy 增量：把每次 policy 决策写入 Memory；上线最小审计视图。

### Q2（Knowledge 数据驱动 · Experience 雏形）

- 引入 `knowledge-registry`，GitHub/抖音 TS 规则迁为数据并保留 fallback。
- 从 Memory 挖成功 locator/pageRole 规则灌到 Knowledge "候选区"。
- `LocatorPreferenceResolver` 抽象落地；recovery rule catalog 收敛。

### Q3（Experience 闭环 · Policy 动态化）

- 从 Memory 聚合 `ExperienceStat/TaskRecipe/LocatorPreference/RecoveryRule`。
- Policy 引入 `PolicyContext`，支持按 pageRole/siteId 覆盖风险分级。
- 用户级策略覆盖层上线。

### Q4（硬编码清退 · 全栈学习）

- GitHub/抖音 TS 适配器退化为最小保底；Knowledge 主导 95%+ 站点识别。
- Policy 从"阻断型"升级为"渐进型"（确认/加强审计/静默）。
- Memory→Experience→Policy 自动反馈链闭环。

---

## 8. 风险与 Open Questions

1. **存储选型一致性**：Memory 用 `better-sqlite3 + drizzle`（与 agent db 对齐），还是走 IndexedDB（与 RR-v3 对齐）？两套并存会把 Memory 分裂成 server 侧 + extension 侧两份，需要明确边界。
2. **隐私/多租户**：Memory 天然含用户行为敏感数据，加密、保留期、跨设备同步策略需要与产品团队拉齐。
3. **Knowledge 学习写入权限**：自动写 vs 候选区 vs 全量人审——影响冷启速度 vs 可靠性。
4. **Experience 归纳冷启**：前 N 次没有历史数据时 Experience 全部回退到硬编码 default，**不要伪装成"已学习"**。
5. **Policy 动态化 vs 可解释性**：上下文感知 policy 必须让用户看懂"为什么这次被允许/阻止"——需要把 Memory 中的 policy 决策暴露到可见 UI。
6. **T5 验收套件的地位**：随着 Knowledge 数据化，T5 套件（`tabrix-private-tests`）必须继续是 Knowledge 层的**回归护栏**，双跑 diff 是迁移阶段 1 的必要门槛。

---

## 附录 A · 本文引用到的核心文件速查表

| 领域       | 文件                                                                                                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Memory     | `app/native-server/src/execution/session-manager.ts`, `app/native-server/src/execution/types.ts`, `app/native-server/src/execution/result-normalizer.ts`, `app/native-server/src/mcp/register-tools.ts`, `app/chrome-extension/entrypoints/background/tools/browser/read-page.ts`, `packages/shared/src/read-page-contract.ts` |
| Knowledge  | `app/chrome-extension/entrypoints/background/tools/browser/read-page-understanding-core.ts`, `read-page-understanding-github.ts`, `read-page-understanding-douyin.ts`, `read-page-high-value-objects-core.ts`, `read-page-high-value-objects-github.ts`, `read-page-task-protocol.ts`                                          |
| Experience | `app/chrome-extension/entrypoints/background/tools/browser/interaction.ts`, `candidate-action.ts`, `screenshot.ts`, `dialog.ts`, `dialog-prearm.ts`, `app/chrome-extension/entrypoints/background/record-replay/**`, `app/chrome-extension/entrypoints/background/tools/record-replay.ts`                                      |
| Policy     | `packages/shared/src/tools.ts`, `app/native-server/src/policy/phase0-opt-in.ts`, `app/native-server/src/mcp/register-tools.ts`, `docs/POLICY_PHASE_0.md`                                                                                                                                                                       |

## 附录 B · 调查过程与复用方式

本文 §2/§3/§4 的"现状盘点 + Gap 对照 + Schema 初稿"章节由 Codex CLI 三个并行只读侦察任务产出，prompt 与原始产出保存在 `.tmp/mkep-week2/`（prompts: `prompt-memory.md` / `prompt-knowledge.md` / `prompt-experience.md`；outputs: `outputs/memory.md` / `outputs/knowledge.md` / `outputs/experience.md`）。抽查 `session-manager.ts:38-40`、`read-page.ts:546-547`、`candidate-action.ts:43-88` 三处关键引用与代码一致，无幻觉。后续章节（执行摘要 / Policy / 就绪矩阵 / 迁移路径 / 风险）由项目组整合撰写。此工作流可复用于下一阶段的 Memory schema 详设、Knowledge registry 技术选型等调查任务，显著节省主 Agent 的 token 成本。
