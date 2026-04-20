# Tabrix 交付级就绪标准 v2

本文是 `RELEASE_READINESS_CHECKLIST_zh.md`（Phase 0 最小闭环）的**上层补充**。
Phase 0 回答 "能不能跑"，本文回答 "能不能对外说这是产品交付级 / GA"。

适用版本：`v2.1+`
状态：`active`

---

## 0. 和 Phase 0 的关系

| 层级                | 文档                                  | 回答的问题                                                    |
| ------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Phase 0             | `RELEASE_READINESS_CHECKLIST_zh.md`   | 本次扩展包 / 本机 bridge 能不能正常装、连、跑                 |
| **Phase 1（本文）** | `RELEASE_READINESS_CRITERIA_v2_zh.md` | 该版本能不能**对外声明交付级**（GA、公开 headline、企业可用） |

Phase 0 过 ≠ Phase 1 过。Phase 1 的每一项都是发布阻断项。

---

## 1. 四道硬门槛

对外声明 "交付级" 前，以下四个维度**全部**必须达标。任何一道未达标，只允许用 `Developer Preview` / `Beta` 叙事发布。

### 门槛 A：架构中立性（Architecture Neutrality）

目的：证明核心层没有被某一个站点家族绑架，后续新家族引入不会推倒重来。

必过项：

- `read-page-understanding-core.ts` 零站点词：
  - 不出现特定站点（GitHub / 抖音 / 创作者中心等）的中文 / 英文专属 anchor
  - `PageRole` 枚举只包含**行业中立**角色（如 `dashboard / list / detail / document / form / workflow / search_result / media_asset / login_required / outer_shell / unknown`）
- 站点家族规则全部位于 `*-<family>.ts` 适配层：
  - 至少存在 2 个 family adapter（当前以 `github` 为基线，计划引入第二个验证中立性）
  - 每新增 1 个 family，core 行 / 枚举 / 词典数量**不得上升**
- 对象层（`highValueObjects`）不再 hard-code 在 `read-page-task-protocol.ts`：
  - 独立模块：`read-page-high-value-objects-{core,<family>}.ts`
  - `read-page-task-protocol.ts` 行数 ≤ 400
- 单元测试证据：
  - `core` 层在 "去除所有 family adapter" 情况下，对 GitHub 基线页输出 `pageRole = unknown` 或通用角色，而非特判角色

### 门槛 B：真实验收面（Acceptance Surface）

目的：把 "全行业通用" 的宣称兑现到**可数的覆盖**。

必过项：

- 公开验收家族 ≥ **3 个**（首批建议：`github` / `enterprise_backoffice` / `content_longform`）
- 每个家族公开基线页 ≥ **4 个**，合计 ≥ `12/12`
- 真实 MCP E2E 框架（见 T7）已落地：
  - 至少 10 条 E2E case 连续 7 次通过
  - 通过入口必须是真实 MCP 客户端调用，不允许模块级伪装
- 长尾负样本监控：
  - 抽样 ≥ 100 个真实公网域，非断言式跑通 `read_page`
  - 记录 `pageRole` / `primaryRegion` / 失败分布；回归门禁：**崩溃率 = 0**、`unknown` 比例无急剧突增（30 天窗口波动 ≤ 15%）
- Flaky rate：核心 CI job 最近 30 次稳定通过率 ≥ **95%**

### 门槛 C：可靠执行与可观测性（Self-healing & Observability）

目的：证明 "AI 能靠谱用" 不是玄学，而是有数据支撑的闭环。

必过项：

- T9 `fallbackChain` / locator 降级已合并，关键工具（`chrome_click` / `chrome_fill` / `chrome_read_page`）均接入
- T10 Policy v1 至少支持：`allow / suggest / confirm / block` 四档
- 默认敏感域 deny-list 生效（见门槛 D）
- T8 证据层 + T13 nightly：
  - nightly 每日跑公开验收矩阵，连续 7 天通过率 ≥ **95%**
  - 失败样本自动生成 artifact（截图 + DOM 快照 + trace）
- T4 "理解质量回归" 指标上线：
  - 每次 CI 打印 `taskMode / pageRole / primaryRegion / highValueObjects` 命中率
  - 相比上一 `release/` 分支退化 > **3 个百分点** → 阻断

### 门槛 D：企业级非功能（Enterprise Non-functional）

目的：让企业场景（团队 / RPA / 受监管行业）能放心接入。

必过项：

- 远程访问安全：
  - Bearer Token 支持 TTL（默认不超过 30 天）
  - 支持 rotation / revoke，不需要重启 bridge
  - 审计日志：每次远程调用落盘 `{time, clientId, tool, argsHash, outcome}`
  - 速率限制：默认 `60 req / min / token`，可配置
- 敏感域默认 deny-list：
  - 至少覆盖：主流银行、密码管理器（1Password / Bitwarden / Dashlane / LastPass）、主流邮箱管理后台、主流医疗服务
  - deny-list 可被用户显式关闭但默认开启
  - 触发时返回结构化 `error.code = policy_sensitive_domain_blocked`
- 跨平台覆盖：
  - `Windows 10/11` × `Chrome stable` ✅
  - `macOS 13+` × `Chrome stable` ✅
  - `Linux (Ubuntu LTS)` × `Chrome stable` ✅
  - 至少一种备选 Chromium 系浏览器（Edge / Brave）冒烟通过
- 升级与兼容：
  - 遵守 SemVer，`MAJOR` 变更必须在 CHANGELOG 列出破坏项
  - MCP tool schema 至少维持一个 `MINOR` 版本的向后兼容承诺
  - 扩展 / native-server 版本不一致时的行为在 `TRANSPORT.md` 有明文
- Manifest V3 生命周期：
  - `TRANSPORT.md` 显式说明 service worker 空闲被回收时的重连语义
  - 有长连接 keep-alive 心跳或等效机制
- 供应链安全：
  - `pnpm run audit` 在 CI 阻断
  - 构建产物 checksum 公布
  - NOTICE / 第三方矩阵与实际复用一致

---

## 2. 北极星指标（上线即度量）

GA 版本必须公布以下指标基线，并在发布后持续度量：

| 指标                                | 目标基线     | 数据来源                  |
| ----------------------------------- | ------------ | ------------------------- |
| 安装 → 首次成功率（30 min 内）      | ≥ 60 %       | 匿名遥测（opt-in）        |
| 主链路调用成功率（近 7 天）         | ≥ 98 %       | 客户端自报 / nightly      |
| `read_page` p95 token               | ≤ 基线 × 1.2 | fixture 回归              |
| 恢复闭环成功率（bridge 故障注入下） | ≥ 90 %       | `smoke --bridge-recovery` |
| nightly 通过率                      | ≥ 95 %       | T13                       |
| 安全事件（30 天）                   | = 0 高危     | 审计日志 + SECURITY issue |

---

## 3. 叙事对齐（PM 校对项）

发布前，以下四处文案必须统一且可兑现：

- `README.md` / `README_zh.md`
- `docs/ROADMAP.md` / `ROADMAP_zh.md`
- `docs/PRODUCT_SURFACE_MATRIX.md` / `..._zh.md`
- Chrome Web Store 描述 / 商店截图文案

禁止出现：

- "全行业 / 所有网站 / Any website" 这类只有 1–2 家族验收的强承诺
- 把 `Experimental` / `Beta` 能力写成 `GA` 叙事
- 与 `PRODUCT_SURFACE_MATRIX` 矩阵不一致的对外能力宣称

---

## 4. 发布阻断项（硬红线）

出现以下任一项，不允许对外发布 GA：

- 门槛 A / B / C / D 中任一未达标
- 北极星指标中任一项未公布或低于基线
- 对外叙事与 `PRODUCT_SURFACE_MATRIX` 矩阵不一致
- 私有测试资产（`.private-artifacts` / `.private-tests`）未从主仓移除或隔离
- CHANGELOG 缺破坏性变更说明
- 最近 30 天核心 CI flaky rate > 5 %

---

## 5. 使用方式

1. 每个准备 GA 的版本开一个 `release/` 分支
2. 在 PR 中引用本文，逐条勾选证据链接（CI 运行 / fixture 报告 / artifact URL）
3. 所有门槛通过后再合并；不通过时按 `Developer Preview` / `Beta` 命名对外发布

## 6. 相关文档

- `RELEASE_READINESS_CHECKLIST_zh.md`（Phase 0）
- `RELEASE_PROCESS_zh.md`
- `PRODUCT_SURFACE_MATRIX_zh.md`
- `ROADMAP_zh.md`
- `SECURITY.md`
- `THIRD_PARTY_REUSE_MATRIX.md`
