# MKEP Knowledge Registry — Stage 1

> 状态：Design (implementation in progress on `feat/knowledge-registry-stage-1`)
> 前序：`docs/MKEP_CURRENT_VS_TARGET.md` §3 Knowledge gap + schema 初稿
> 后续：Stage 2 — HVO 分类器 + Douyin seeds 迁移 + native-server 同步

## 1. 为什么是 Stage 1

Tabrix 的 MKEP Knowledge 层目前是"散落在 TS 分支里的硬编码规则"：

| 文件                                     | 规则类别                                                 | 规模（本次侦察） |
| ---------------------------------------- | -------------------------------------------------------- | ---------------- |
| `read-page-understanding.ts`             | 通用 login / footer 词表                                 | 2 条 RegionRule  |
| `read-page-understanding-github.ts`      | GitHub Site Profile、Page Catalog、primary-region 词表   | 4 个 role 分支   |
| `read-page-understanding-douyin.ts`      | 抖音 Site Profile、URL/query/content-driven Page Catalog | 5 条主分支       |
| `read-page-high-value-objects-github.ts` | GitHub HVO priors + label classifier                     | 27 条 + 60 叶子  |
| `read-page-high-value-objects-core.ts`   | 通用 pipeline（非规则本体）                              | —                |

Stage 1 要解决的问题**只有一个**：

> **把"识别页面身份"这件事从 TS 硬编码抽成数据**，让 Registry 成为 Knowledge 层的单一入口，后续 Stage 可以在同一个 registry 上叠加 HVO 分类、UI Map、Data Hints，而不用再碰 `read-page-understanding-*` 文件。

## 2. 目标 / 非目标

### 2.1 目标（Stage 1）

1. 把以下三类规则**从 TS 表达式抽成 seed 数据**：
   - GitHub **Site Profile**（host / path 模式）
   - GitHub **Page Catalog**（URL → pageRole，4 个 role：`repo_home / issues_list / actions_list / workflow_run_detail|shell`）
   - GitHub **Primary Region anchors**（每个 pageRole 对应的 `RegionRule[]`）

2. 在扩展中建立独立的 **Knowledge Registry 模块**（`app/chrome-extension/entrypoints/background/knowledge/`），提供 `resolveSiteProfile / resolvePageRole` 两个 lookup API。

3. 把 `inferPageUnderstanding` 改造成 **registry-first, fallback-second**：默认先查 registry，miss 或被 flag 关闭时回落到现有 TS family adapter。**外部 API 签名不变**。

4. 提供 **feature flag + parity 双跑测试**，保证新旧路径在现有 fixture 上结果严格一致。

### 2.2 非目标（留给 Stage 2+）

| 项                                          | 延后原因                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| HVO classifier / priors 迁移                | T5.4.5 的 `href + objectSubType` 最好和 HVO migration 合并做；独立一条线            |
| Douyin seeds 迁移                           | 抖音有 title/content-driven 规则，比 GitHub 复杂；narrow Stage 1 先验证架构再扩站点 |
| UI Map / Data Hints                         | schema 已在 gap doc，但 Stage 1 不引入                                              |
| **租户 / workspace / owner 维度**           | 用户明确约束：**暂时不做租户**，本地单用户；Registry 所有 seed 不带 tenant 字段     |
| SQLite / native-server 同步                 | Stage 1 完全是扩展内**静态 seed**；持久化留到 Stage 2 再接 Memory 层                |
| 双端（extension ↔ server）规则分发          | 同上                                                                                |
| Learning loop（用户行为 → registry update） | Stage 4 议题，现在只落"读取"能力                                                    |

## 3. Scope 决策

候选：

- **A (narrow)**：只迁 GitHub Site Profile + Page Catalog + Primary Region
- **B (wide)**：A + GitHub label classifier + object priors + Douyin Site/Page Catalog

**采纳 A**。

理由（参考 Codex 侦察 `.tmp/knowledge-stage-1/outputs/scope.md`）：

1. **现有测试护栏最强的是 understanding 面**（`read-page-understanding.test.ts` 覆盖 4 个 pageRole 基线 + `read-page-mode.test.ts` 覆盖输出面契约）。A 只动 understanding 路径，回归风险最低。
2. **B 牵涉 HVO 主链**（`read-page-task-protocol.ts:486-500` → `buildHighValueObjects`），同时会和悬挂中的 `feat/t5-4-5-hvo-href-subtype-and-pagerole-fix` 分支强耦合 —— 不如让 HVO migration 作为 Stage 2 的一个独立 PR 和 T5.4.5 一起处理。
3. **产品可见性**：Site Profile + Page Catalog 是用户视角"我在哪个站的哪种页面"的最直观一层。Stage 1 交付后，外部的`docs/KNOWLEDGE_STAGE_1.md` + seed 文件就是一份"Tabrix 认识多少网站"的人类可读清单。
4. **单 PR 体量可控**：预估 6–10 个新文件、~400 LOC + ~200 LOC 测试。

## 4. 架构

### 4.1 模块目录

```text
app/chrome-extension/entrypoints/background/knowledge/
├── types.ts                          # 全部 Knowledge 类型
├── registry/
│   └── knowledge-registry.ts         # 装载 seeds + 编译 regex + index by siteId
├── seeds/
│   ├── github.ts                     # GitHub Site Profile + Page Catalog + Primary Region
│   └── douyin.ts                     # 占位（Stage 1 只导出空数组，保证 Stage 2 扩展点存在）
├── lookup/
│   ├── resolve-site-profile.ts       # (url) → siteId | null
│   └── resolve-page-role.ts          # ({siteId, url, title, content}) → PageUnderstandingSummary | null
└── feature-flag.ts                   # KNOWLEDGE_REGISTRY_MODE 常量 + helpers
```

**决策理由**：

- 四级结构与 `docs/MKEP_CURRENT_VS_TARGET.md` §3.4 schema 一一对齐，未来叠加 `resolve-object-priors.ts`、`resolve-ui-map.ts` 时不需要重组目录。
- `registry/` 只负责 **装载 + 索引**（把 seeds 合并、把 regex source 编译成 `RegExp`、按 `siteId` 建 map）。
- `lookup/` 是**纯函数**，消费方 `inferPageUnderstanding` 只导入 `lookup/*`，不直接摸 registry/seeds。

### 4.2 数据类型（`types.ts`）

保持与 gap doc §3.4 schema 一致，但**只落 Stage 1 需要的三种**：

```ts
import type { ReadPagePrimaryRegionConfidence } from '@tabrix/shared';
import type { PageRole } from '../tools/browser/read-page-understanding-core';

export type KnowledgePatternSource = string; // 保存成字符串，lookup 时编译成 RegExp

export interface CompiledKnowledgePattern {
  readonly source: string;
  readonly pattern: RegExp;
}

/** 识别站点身份 */
export interface KnowledgeSiteProfile {
  readonly siteId: string;
  readonly match: {
    readonly hosts?: readonly string[];
    readonly urlPatterns?: readonly KnowledgePatternSource[];
  };
  /** Stage 1 占位；Stage 2 可加 locales / anchors / authMode */
}

/** URL / title / content → pageRole */
export interface KnowledgePageRoleRule {
  readonly siteId: string;
  readonly pageRole: PageRole;
  readonly match: {
    readonly urlPatterns?: readonly KnowledgePatternSource[];
    readonly titlePatterns?: readonly KnowledgePatternSource[];
    readonly contentPatterns?: readonly KnowledgePatternSource[];
  };
  readonly primaryRegions?: readonly KnowledgePrimaryRegionRule[];
  /** 当 primaryRegions 全部不命中时的保底 */
  readonly fallback?: {
    readonly primaryRegion?: string | null;
    readonly primaryRegionConfidence?: ReadPagePrimaryRegionConfidence;
  };
}

export interface KnowledgePrimaryRegionRule {
  readonly region: string;
  readonly patterns: readonly KnowledgePatternSource[];
  readonly minMatches?: number;
  readonly priority?: number;
  readonly confidence: ReadPagePrimaryRegionConfidence;
}

/** 装载后的 registry 视图（供 lookup 使用） */
export interface CompiledKnowledgeRegistry {
  readonly siteProfiles: ReadonlyMap<string, CompiledSiteProfile>;
  readonly pageRoleRulesBySite: ReadonlyMap<string, readonly CompiledPageRoleRule[]>;
}
```

### 4.3 Lookup 算法（与当前 TS family adapter 行为一致）

`resolvePageRole({siteId, url, title, content, context})` 的执行顺序严格对齐 `githubPageFamilyAdapter.infer`（`read-page-understanding-github.ts:121-175`）：

1. 取出 `pageRoleRulesBySite.get(siteId)`。
2. 按 seed 数组里**声明顺序**依次 match（GitHub 现状就是 `workflow_run_detail → actions_list → issues_list → repo_home` 的顺序，seed 必须保持一致）。
3. 对第一个 URL 匹配的 rule：
   - 如果有 `primaryRegions`，复用现有 `resolvePrimaryRegion(sources, rules, fallbackRegion, fallbackConfidence)`（`read-page-understanding-core.ts:101-135`）—— **Stage 1 不重新实现 scoring**，而是把 compiled patterns 喂给它。
   - 否则用 `fallback` 的 `primaryRegion / confidence`。
4. 所有 rule 都 miss 返回 `null` → 消费方回落到 `inferLoginRequired / inferFallback`。

关键：**Stage 1 的 lookup 不改变 scoring 语义**。唯一的新增逻辑是"从 seed 编译出的 `RegionRule[]` 送给已有的 `resolvePrimaryRegion`"。

### 4.4 Feature flag（`feature-flag.ts`）

```ts
export type KnowledgeRegistryMode = 'off' | 'on' | 'diff';

export const KNOWLEDGE_REGISTRY_MODE: KnowledgeRegistryMode = 'on';
```

- `off`：跳过 registry，`inferPageUnderstanding` 直接走 TS family adapter（回滚开关）。
- `on`（默认）：先查 registry；miss 再走 TS family adapter；命中直接返回 registry 结果。
- `diff`：registry 和 fallback 都跑，结果不一致时 `console.warn` 打印 diff；**返回值仍以 fallback 为准**（避免 registry 回归影响生产）。

**为什么是内部常量而不是 env / chrome.storage**：

- Stage 1 目标是"数据化"，还没有到"用户可配置"阶段；env / storage 会牵出设置 UI / 持久化 / 同步等跨层 wiring。
- 开发期切模式只需改一行常量重打包，成本极低。
- Stage 2 真要做 cross-process 同步时再升级。

### 4.5 Consumer 改造：`inferPageUnderstanding`

**外部签名不变**。内部改为：

```ts
export function inferPageUnderstanding(url, title, pageContent): PageUnderstandingSummary {
  const ctx = buildUnderstandingContext(url, title, pageContent);

  if (KNOWLEDGE_REGISTRY_MODE !== 'off') {
    const siteId = resolveSiteProfile(ctx);
    if (siteId) {
      const hit = resolvePageRole({ siteId, context: ctx });
      if (hit) {
        if (KNOWLEDGE_REGISTRY_MODE === 'diff') {
          const fallback = runLegacyFamilyAdapters(ctx);
          if (!deepEqualSummary(hit, fallback)) {
            console.warn('[tabrix/knowledge] registry/fallback diff', { url, hit, fallback });
          }
          return fallback ?? hit; // diff 模式以 fallback 为准
        }
        return hit;
      }
    }
  }

  const familySummary = runLegacyFamilyAdapters(ctx);
  if (familySummary) return familySummary;

  const loginSummary = inferLoginRequired(ctx);
  if (loginSummary) return loginSummary;

  return inferFallback(ctx);
}
```

`runLegacyFamilyAdapters` 保持现状（即当前的 `PAGE_FAMILY_ADAPTERS` 数组依次跑），作为 Stage 1 的回落**不删**。

## 5. Seeds 迁移表

### 5.1 GitHub Site Profile（`seeds/github.ts` → `SITE_PROFILE`）

- `siteId: 'github'`
- `match.hosts: ['github.com']`
- `match.urlPatterns[0]`：保真拷贝 `read-page-understanding-github.ts:10` 里 `GITHUB_REPO_URL_PATTERN` 的 regex source：

  ```text
  ^https://github\.com/[^/]+/[^/]+(?:[/?#]|$)
  ```

### 5.2 GitHub Page Catalog（`seeds/github.ts` → `PAGE_ROLE_RULES`）

Rule 声明顺序必须和 `githubPageFamilyAdapter.infer` 里的判断顺序（`read-page-understanding-github.ts:132,144,154,164`）保持一致：

1. `workflow_run_detail` — urlPattern 保真 `^/actions/runs/\d+`；primaryRegions 用 `GITHUB_PRIMARY_REGION_RULES.workflow_run_detail`；此条启用 §5.3 的 `dualOutcome`（summary 命中 → detail；否则 shell）。
2. `actions_list` — urlPattern 保真拷贝 `read-page-understanding-github.ts:144` 原式；primaryRegions 用 `.actions_list`。
3. `issues_list` — urlPattern 保真拷贝 `read-page-understanding-github.ts:154` 原式；primaryRegions 用 `.issues_list`。
4. `repo_home` — urlPattern 保真拷贝 `read-page-understanding-github.ts:164` 原式（空字符串或单斜杠根）；primaryRegions 用 `.repo_home`。

### 5.3 workflow_run_detail 的稳定契约（T5.4.5 之后）

T5.4.5 之后（`read-page-understanding-github.ts:132-151`），`workflow_run_detail` 的 `pageRole` 对 `/actions/runs/<id>` URL **始终稳定**；`primaryRegion` 独立承担"summary 是否 hydrate"的信号。因此 GitHub seed 里此条规则**不需要 `dualOutcome`**，只保留 `fallback.primaryRegion='workflow_run_shell'`。

`dualOutcome` 机制本身仍保留在 Stage 1 的 `types.ts` / `compile`/`resolvePageRole` 里，作为未来真正需要"region-promotes-role"表达的站点（例如 Stage 2 若引入某类列表/详情共路由）预留的抽象。

### 5.3.1 旧契约归档（仅供历史参考）

在 T5.4.5 落地前，`read-page-understanding-github.ts:132-142` 曾经有一个"primary-region 的 `region` 值反过来决定最终 `pageRole`"的逻辑：

```ts
return region.region === 'workflow_run_summary'
  ? buildGithubSummary('workflow_run_detail', ...)
  : buildGithubSummary('workflow_run_shell', ...);
```

Stage 1 把它表达成 seed 里的 **`dualOutcome` 机制**：

```ts
dualOutcome: {
  primaryRegionToRole: { 'workflow_run_summary': 'workflow_run_detail' },
  defaultRole: 'workflow_run_shell',
}
```

`resolvePageRole` 看到 rule 带 `dualOutcome` 时，优先按 `region.region` 映射 pageRole；否则按 `rule.pageRole`。这是 Stage 1 唯一一处"声明式覆盖命令式"的额外抽象。

### 5.4 Primary Region patterns（完整迁移）

每条 `KnowledgePrimaryRegionRule` 对应 `GITHUB_PRIMARY_REGION_RULES[role][i]`（`read-page-understanding-github.ts:13-104`），共 **8 条 RegionRule，约 29 条 pattern**。seed 文件按 role 分组、pattern 直接写 regex source 字符串。

## 6. 测试策略

### 6.1 新增测试

1. **registry 单测**（`knowledge/registry/knowledge-registry.test.ts`）
   - seeds 装载成功（不抛）
   - 所有 `KnowledgePatternSource` 能编译成合法 `RegExp`
   - index by `siteId` 工作正常
2. **lookup 单测**（`knowledge/lookup/resolve-*.test.ts`）
   - `resolveSiteProfile(githubUrl) === 'github'`
   - `resolveSiteProfile(douyinUrl) === null`（Stage 1 douyin seeds 空）
   - `resolvePageRole` 对 4 个 GitHub pageRole 场景返回和 legacy adapter 相同的 `PageUnderstandingSummary`
3. **parity 测试**（`read-page-understanding.parity.test.ts`）
   - 用现有 `read-page-understanding.test.ts` 的 fixtures + 新加几条边界 case
   - 对每条 fixture **同时跑 registry 路径和 legacy 路径**，断言 `deepEqualSummary`
   - parity 测试在 `KNOWLEDGE_REGISTRY_MODE === 'on'` 和 `'off'` 两种状态下都必须通过

### 6.2 既有测试不能破坏

| 文件                                          | 关键断言（Codex 侦察行号）                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `read-page-understanding.test.ts`             | `read-page-understanding.test.ts:31-40,67-76,79-88,91-124`（4 个 GitHub role 基线）    |
| `read-page-mode.test.ts`                      | `read-page-mode.test.ts:23-40`（`artifactRefs / historyRef / memoryHints` 输出面契约） |
| `read-page-high-value-objects-github.test.ts` | HVO 线 Stage 1 不动，测试必须继续绿                                                    |

### 6.3 Parity 运行入口

提供一个内部辅助：

```ts
function pageRoleParityCheck(fixture: PageFixture) {
  const viaRegistry = resolveViaRegistry(fixture);
  const viaLegacy = resolveViaLegacyAdapters(fixture);
  expect(viaRegistry).toEqual(viaLegacy);
}
```

放在 `knowledge/__tests__/parity.ts` 作为共享工具，被 parity suite 使用。

## 7. 回滚策略

| 场景                   | 动作                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| 生产发现 registry 误判 | 把 `KNOWLEDGE_REGISTRY_MODE` 改成 `'off'` 发新版                    |
| 某条 seed 引入回归     | 删除该条 seed，Registry miss 后自动回落到 TS 分支                   |
| 整个 registry 打不开   | `try/catch` 包裹装载，失败时打一行 `console.warn` + 强制走 fallback |

Stage 1 的回滚面**非常薄** —— 因为 legacy adapter 完整保留，一个常量切换就能回到原样。

## 8. 开放问题 / Stage 2 候选

1. **T5.4.5 悬挂分支** `feat/t5-4-5-hvo-href-subtype-and-pagerole-fix` 比 main 多 1 commit（HVO 的 `href + objectSubType`）。Stage 1 不依赖它，但 Stage 2 做 HVO 迁移时**必须先把它并入 main**，否则 Registry 里的 HVO classifier seeds 会和实际 HVO 生产代码错位。

2. **Douyin seed 形态**。抖音有 title/content-driven 规则（`DOUYIN_RANK_PANEL_PATTERN` 等），Stage 2 时需要验证当前 schema 的 `titlePatterns / contentPatterns` 字段够不够表达；如果不够，schema 反向扩容。

3. **Registry 是否需要打包校验**。Stage 1 规模小，编译失败直接单测拦；规模到几百条时要考虑 build-time 校验（类似 i18n-check）。

4. **与 native-server 的 Knowledge 同步**。MKEP 长期目标是 Memory/Knowledge 两层都有持久化，但 Stage 1 主动 scope-out 了 —— Stage 3 议题。

## 9. 交付 checklist

- [ ] `docs/KNOWLEDGE_STAGE_1.md` 本文
- [ ] `knowledge/` 模块骨架（types + registry + seeds skeleton + lookup + flag）
- [ ] GitHub seeds 完整覆盖 Site Profile + Page Catalog + Primary Region
- [ ] Douyin seeds 空骨架（导出空数组 + 文件说明）
- [ ] `inferPageUnderstanding` 改造为 registry-first
- [ ] Registry / lookup 单测
- [ ] Parity 测试 `read-page-understanding.parity.test.ts`
- [ ] 既有 `read-page-understanding.test.ts` / `read-page-mode.test.ts` / `read-page-high-value-objects-github.test.ts` 绿
- [ ] `CHANGELOG.md` `[Unreleased] > Added` 条目
- [ ] PR 草稿 + 手动合并（沿用当前 MCP/PAT 的规避流程）
