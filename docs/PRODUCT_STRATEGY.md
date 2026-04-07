# mcp-chrome 产品战略分析

> 撰写日期：2026-04-07
> 版本：v1.0
> 定位：面向所有 AI 助手的通用浏览器执行平台

---

## 一、市场全景

### 1.1 市场规模

| 指标                    | 数值           | 来源                                               |
| ----------------------- | -------------- | -------------------------------------------------- |
| 2024 AI 浏览器市场规模  | ~$4.5B         | Market.us                                          |
| 2026 预估               | ~$7.9B         | 多方综合                                           |
| 2032 预估               | $15B–$76.8B    | Congruence / Market.us                             |
| CAGR                    | 33%–43%        | 多方综合                                           |
| MCP SDK 月下载量        | ~9700 万       | npm (2025.11)                                      |
| MCP 已索引 Server 数量  | 10,000–17,000+ | mcp.so / Glama / Smithery                          |
| 支持 MCP 的主流 AI 平台 | 6+             | Claude, ChatGPT, Gemini, Copilot, Cursor, Windsurf |

**核心趋势**：浏览器正从「人看网页的窗口」变成「AI 操作网络的手脚」。2026 年，这个领域已从实验室 demo 进入生产级产品阶段。

### 1.2 行业时间线（关键里程碑）

| 时间    | 事件                                          |
| ------- | --------------------------------------------- |
| 2024.10 | Anthropic 发布 Computer Use 公测              |
| 2024.11 | Anthropic 开源 MCP 协议                       |
| 2025.01 | OpenAI 发布 Operator（CUA）                   |
| 2025.03 | Microsoft 发布 Playwright MCP                 |
| 2025.03 | Amazon 发布 Nova Act SDK                      |
| 2025.06 | hangwin/mcp-chrome 创建                       |
| 2025.07 | Perplexity 发布 Comet 浏览器                  |
| 2025.10 | OpenAI 发布 ChatGPT Atlas 浏览器              |
| 2025.12 | Anthropic 将 MCP 捐赠给 Linux Foundation AAIF |
| 2026.01 | Chrome 内置 Gemini auto-browse                |
| 2026.02 | OpenTabs 创建（API 劫持方案）                 |
| 2026.03 | Chrome 加速至 2 周发版周期应对竞争            |

---

## 二、竞品全景图

### 2.1 开源竞品

#### 第一梯队：巨头 + 明星项目

| 项目                           | Stars | 语言       | 方案类型                   | 核心特点                                                    | 局限性                                              |
| ------------------------------ | ----- | ---------- | -------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| **browser-use**                | 85K+  | Python     | Playwright + LLM Agent     | WebVoyager 89% 成功率；全自主 Agent 循环；模型无关          | 每步 2-5s LLM 延迟；Python 生态；需下载浏览器二进制 |
| **Playwright MCP** (Microsoft) | 30K+  | TypeScript | Accessibility Tree + MCP   | 官方微软出品；无需视觉模型；免费；GitHub Copilot 内置       | 无 AI 决策能力；确定性脚本；需独立浏览器实例        |
| **Stagehand** (Browserbase)    | 21K+  | TypeScript | Playwright + AI Primitives | act/extract/observe/agent 四原语；自愈能力；TypeScript 原生 | 深度绑定 Browserbase 云；需 LLM API 费用            |
| **Skyvern**                    | 20K+  | Python     | Vision + LLM               | 截图驱动，不依赖 DOM；无代码工作流                          | 速度慢；token 消耗大；不稳定                        |

#### 第二梯队：Chrome 扩展方案（mcp-chrome 的直接竞品）

| 项目                                 | Stars | 方案类型                             | 核心特点                                                              | 局限性                                                   |
| ------------------------------------ | ----- | ------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------- |
| **hangwin/mcp-chrome**（我们的上游） | 11K+  | Chrome 扩展 + Native Messaging + MCP | 操作用户日常 Chrome；已登录 session；37+ 工具                         | 稳定性差（184 open issues）；连接断裂频繁；缺少 AI Skill |
| **BrowserMCP**                       | 6K+   | Chrome 扩展 + MCP                    | 基于 Playwright MCP 改造；隐身能力；本地运行                          | 代码不开放构建；单人维护；功能较少                       |
| **OpenTabs**                         | 259   | Chrome 扩展 + API 劫持               | **革命性方案**：直接调用网站内部 API 而非模拟点击；2000+ 工具；插件化 | 极新（2026.02）；安全风险高；依赖逆向工程                |
| **real-browser-mcp**                 | 15    | Chrome 扩展 + WebSocket              | 极简方案；复用登录 session                                            | 功能极少；单人项目                                       |
| **OpenChrome**                       | 165   | CDP 直连                             | 无扩展依赖；27 个自愈子系统；桌面应用                                 | 单人维护；仍在早期                                       |

#### 第三梯队：基础设施层

| 项目                      | 定位             | 说明                                              |
| ------------------------- | ---------------- | ------------------------------------------------- |
| **Browserbase**           | 云浏览器基础设施 | Stagehand 背后的公司；$40M B 轮；SOC-2/HIPAA 合规 |
| **Steel** (6K stars)      | 开源云浏览器     | 自托管替代 Browserbase                            |
| **Crawl4AI** (51K stars)  | LLM 友好爬虫     | 输出 Markdown；4x 竞品速度                        |
| **Firecrawl** (82K stars) | 网页转 LLM 数据  | 数据管道；RAG 场景                                |

### 2.2 商业竞品

| 产品                                     | 定价                | 方案              | 核心卖点                                                        | 弱项                             |
| ---------------------------------------- | ------------------- | ----------------- | --------------------------------------------------------------- | -------------------------------- |
| **Claude Browser Extension** (Anthropic) | Claude Pro $20/月含 | Chrome 扩展       | 最被低估的 2026 AI 产品；自主多步执行；已登录 session；定时任务 | 仅限 Claude 生态；不对外开放 API |
| **ChatGPT Atlas** (OpenAI)               | ChatGPT Pro 订阅    | 独立浏览器        | Agent Mode；CUA 87% WebVoyager                                  | 仅 macOS；仅限 ChatGPT 生态      |
| **Google Chrome auto-browse**            | Gemini 订阅         | Chrome 内置       | 30 亿用户基数；原生集成                                         | 功能有限；不对第三方开放         |
| **Browserbase**                          | $0/20/99/月         | 云浏览器 API      | 企业级；可扩展；SOC-2                                           | 非终端用户产品；需开发           |
| **MultiOn**                              | 免费/Pro $29/月     | Chrome 扩展 + API | 自然语言 Web 任务；个人生产力                                   | Beta 阶段；复杂网站不稳定        |
| **Induced AI**                           | ~$30/月             | REST API          | 自然语言浏览器控制；无代码                                      | 不透明定价；非开源               |
| **Browserflow**                          | 免费+付费           | 录制回放          | 非技术用户友好；Google Sheets 集成                              | 不是真正的 AI native             |
| **OpenAI Operator**                      | $200/月 (Pro)       | 独立 Agent        | CUA 技术；87% 基准                                              | 极贵；仅限 ChatGPT Pro           |

### 2.3 竞品定位矩阵

```
                    面向开发者                    面向终端用户
                        │                            │
  确定性/脚本    Playwright MCP ──────────────── Browserflow
       │              │                            │
       │         Stagehand                    Claude Extension
       │              │                            │
  AI 自主        browser-use ─── mcp-chrome ─── MultiOn
       │              │         （我们）          │
       │         OpenTabs                     ChatGPT Atlas
       │              │                            │
  全托管         Browserbase ────────────────── Induced AI
```

---

## 三、我们的差异化定位

### 3.1 当前定位评估

mcp-chrome（fork 自 hangwin/mcp-chrome）的**先天优势**：

| 优势             | 说明                                                 | 竞品对比                                     |
| ---------------- | ---------------------------------------------------- | -------------------------------------------- |
| **真实 Chrome**  | 使用用户日常浏览器，继承所有已登录 session           | vs Playwright 需独立实例，丢失所有登录态     |
| **零浏览器下载** | 不需要下载 Chromium 二进制（1.2GB+）                 | vs browser-use/Playwright/Stagehand 必须下载 |
| **MCP 原生**     | 天然 MCP Server，任何 MCP 客户端即插即用             | vs browser-use 需额外包装层                  |
| **丰富工具集**   | 37+ 工具覆盖导航/内容/表单/书签/截图/性能            | vs BrowserMCP 仅有基础工具                   |
| **客户端无关**   | Claude/Cursor/CoPaw/OpenClaw/CherryStudio/n8n 均可用 | vs Claude Extension 仅限 Claude              |
| **开源免费**     | MIT 协议，自托管，无 API 费用                        | vs Browserbase/Induced 付费                  |

**先天劣势**（需要在 Program 0–2 中解决）：

| 劣势         | 说明                                       | 当前状态               |
| ------------ | ------------------------------------------ | ---------------------- |
| 稳定性       | 连接断裂、僵尸进程、状态机混乱             | Program 0 正在修复     |
| 无 AI 决策层 | 只是工具集，不像 browser-use 有 Agent 循环 | 需要通过 Skill 弥补    |
| 安装摩擦     | 需手动加载扩展 + 全局安装 bridge           | 需简化                 |
| 缺乏云方案   | 仅本地运行                                 | 长期需规划             |
| 文档不足     | 缺完整 API 参考和 AI Skill                 | Program 0 I1-I5 规划中 |

### 3.2 推荐差异化定位

> **mcp-chrome = 你的 AI 助手 的「真实浏览器之手」**
>
> 不下载浏览器、不丢失登录态、不绑定任何 AI 平台。
> 一个 Chrome 扩展，让**任何** MCP 客户端操作你**已登录**的真实浏览器。

**一句话定位**：The universal real-browser MCP server for every AI assistant.

**三个核心差异化支柱**：

1. **真实浏览器（Real Browser）**：不是虚拟浏览器、不是 headless，就是你日常用的 Chrome
2. **任何 AI（Any AI）**：不绑定 Claude/ChatGPT/任何厂商，MCP 协议通吃
3. **已登录即可用（Your Sessions）**：所有已登录网站的 cookie/session 直接可用

---

## 四、产品方向与功能规划

### 4.1 产品演进路线

```
Phase 0 (当前)     Phase 1           Phase 2           Phase 3
稳定平台基座   →   执行平台核心   →   策略与记忆   →   生态与商业化
─────────────  ─────────────  ─────────────  ─────────────
连接稳定性       Task/Session     执行策略引擎     插件市场
工具可靠性       Step 模型        操作记忆         云浏览器方案
诊断体系         超时/重试/回退    学习型 Skill     企业版
AI Skill 技能包   多标签编排        模板工作流       商业化
多客户端兼容     结果验证链        知识库集成       计费系统
```

### 4.2 Phase 1：执行平台核心（最关键的差异化期）

| 功能                           | 说明                                                     | 竞品参考                  | 价值                       |
| ------------------------------ | -------------------------------------------------------- | ------------------------- | -------------------------- |
| **Task → Session → Step 模型** | 将浏览器操作抽象为可管理的执行单元                       | browser-use 的 Agent loop | 从"工具集"升级为"执行平台" |
| **智能等待与重试**             | 自动等待页面加载、元素可见；失败自动重试                 | Stagehand 的自愈机制      | 大幅提升可靠性             |
| **多标签编排**                 | AI 可同时操作多个标签页，协调数据流                      | OpenTabs 的多标签路由     | 复杂场景能力               |
| **执行结果验证**               | 每步操作后自动检查是否成功（DOM 变化/URL 变化/内容匹配） | browser-use 的验证循环    | 降低幻觉失败率             |
| **结构化错误回传**             | 统一错误码 + AI 可理解的错误描述 + 建议操作              | —                         | AI 能自主处理异常          |

### 4.3 Phase 2：策略与记忆

| 功能             | 说明                                               | 竞品参考                    | 价值                             |
| ---------------- | -------------------------------------------------- | --------------------------- | -------------------------------- |
| **操作记忆**     | 记录成功的操作路径，后续直接复用                   | Stagehand 的 action caching | 速度提升 10x；token 成本降低 90% |
| **站点知识库**   | 为每个网站积累结构化知识（选择器、API 端点、流程） | OpenTabs 的插件系统         | 越用越聪明                       |
| **执行策略引擎** | 根据站点类型自动选择最优操作方式                   | —                           | 智能化核心                       |
| **模板工作流**   | 预置常见场景（网购比价、表单填写、数据导出）       | Browserflow 的录制回放      | 降低使用门槛                     |
| **安全策略**     | 敏感操作确认、域名白名单、操作审计日志             | OpenTabs 的三级权限         | 企业可用性                       |

### 4.4 Phase 3：生态与商业化

| 功能              | 说明                                    | 竞品参考                 | 价值                      |
| ----------------- | --------------------------------------- | ------------------------ | ------------------------- |
| **插件/扩展市场** | 社区贡献站点适配器、工作流模板          | OpenTabs 的 plugin 生态  | 生态飞轮                  |
| **云浏览器方案**  | 提供托管的浏览器实例（可选）            | Browserbase              | 企业场景；无需本地 Chrome |
| **团队协作**      | 共享工作流模板、操作记忆、站点知识      | —                        | 企业版核心                |
| **API Gateway**   | HTTP API 层，供 n8n/Dify/工作流平台调用 | —                        | 打通自动化生态            |
| **计量与计费**    | 按操作量/会话量计费                     | Browserbase/Induced 定价 | 收入来源                  |

---

## 五、核心竞争力分析

### 5.1 竞争力 SWOT

#### Strengths（优势）

1. **真实浏览器独占优势**：在所有开源方案中，Chrome 扩展方案是唯一能直接操作用户已登录浏览器的途径。这不是"nice to have"，而是大量实际场景的刚需（登录态网站操作、内部系统、付费内容）
2. **MCP 原生 + 客户端无关**：随着 MCP 成为行业标准（97M 月下载），mcp-chrome 的定位天然受益
3. **工具集丰富度**：37+ 工具覆盖面远超 BrowserMCP、real-browser-mcp 等竞品
4. **上游社区验证**：hangwin/mcp-chrome 的 11K stars 证明了需求真实性

#### Weaknesses（劣势）

1. **稳定性是最大短板**：上游 184 open issues，连接断裂是头号问题
2. **无 AI 推理层**：与 browser-use/Stagehand 相比，缺乏 AI 决策循环
3. **安装体验有摩擦**：需手动加载 Chrome 扩展，对比 `npx @playwright/mcp` 一行命令
4. **单人/小团队维护**：vs Microsoft（Playwright MCP）、Browserbase（Stagehand）、browser-use 300+ 贡献者

#### Opportunities（机会）

1. **AI 助手爆发期**：OpenClaw、CoPaw、Claude Desktop、Cursor 等 AI 助手正在快速普及，每个都需要浏览器能力
2. **Chrome 扩展方案没有真正的领导者**：hangwin 已 3 个月未更新，BrowserMCP 代码不可构建，机会窗口清晰
3. **MCP 生态红利**：一次开发，所有 MCP 客户端可用
4. **OpenTabs 验证了方向**：API 劫持方案太激进，但证明了「真实浏览器 + AI」的需求
5. **企业 RPA 替代潮**：$58B 市场正在从传统 RPA 向 AI Agent 迁移

#### Threats（威胁）

1. **Google Chrome 内置 Gemini auto-browse**：最大威胁 —— 如果 Chrome 原生提供 AI 浏览能力且开放 MCP，扩展方案的价值降低
2. **Claude Browser Extension**：Anthropic 官方方案质量高，但锁定 Claude 生态
3. **browser-use 的生态优势**：85K stars + 300 贡献者 + 商业化云服务
4. **Playwright MCP 的微软背书**：30K stars + 微软维护 + VS Code/Copilot 内置
5. **WebMCP 标准**：如果网站原生暴露 MCP 工具，中间层价值下降

### 5.2 护城河构建策略

我们不可能在每个维度与巨头竞争。**护城河在于深度聚焦「真实浏览器 × 任何 AI」这个交叉点**：

```
                Playwright MCP        browser-use
                (独立浏览器)           (独立浏览器)
                     │                     │
    ─────────────────┼─────────────────────┼──────────
                     │                     │
  Claude Extension   │    ★ mcp-chrome ★   │   OpenTabs
  (锁定 Claude)      │  (真实浏览器×任何AI) │   (API劫持)
                     │                     │
    ─────────────────┼─────────────────────┼──────────
                     │                     │
                Google auto-browse    ChatGPT Atlas
                (锁定 Google)         (锁定 OpenAI)
```

**我们占据的独特位置**：开源 + 真实浏览器 + 已登录 session + MCP 标准 + 客户端无关。

这个交叉点上**没有强有力的竞争者**：

- Playwright MCP 需要独立浏览器实例，无法使用已登录 session
- Claude Extension 锁定 Claude 生态
- BrowserMCP 代码不可构建，单人维护
- OpenTabs 太新（259 stars），且 API 劫持方案安全风险大
- real-browser-mcp 功能太少

### 5.3 关键竞争力指标（KCI）

我们需要在以下指标上建立领先：

| 指标               | 目标                    | 衡量方式                                      |
| ------------------ | ----------------------- | --------------------------------------------- |
| **连接可靠性**     | 99.5%+ session 保持率   | 8 小时压测无断连                              |
| **工具成功率**     | 95%+ 工具调用成功率     | 标准化测试套件                                |
| **安装到首次成功** | < 5 分钟                | 新用户实测                                    |
| **AI 客户端覆盖**  | 5+ 主流客户端验证通过   | CoPaw/Claude Desktop/Cursor/Windsurf/OpenClaw |
| **AI Skill 质量**  | AI 首次正确执行率 > 80% | 标准化场景测试                                |
| **社区活跃度**     | 月增 100+ stars         | GitHub 追踪                                   |

---

## 六、面向 AI 助手生态的产品策略

### 6.1 AI 助手生态现状（2026.04）

| AI 助手            | 类型           | MCP 支持      | 浏览器能力现状                  | mcp-chrome 机会        |
| ------------------ | -------------- | ------------- | ------------------------------- | ---------------------- |
| **Claude Desktop** | 桌面 AI        | ✅ 原生       | 有自己的 Browser Extension      | 补充企业/自动化场景    |
| **Cursor**         | AI IDE         | ✅ 原生       | Playwright MCP 为主             | 提供真实浏览器调试能力 |
| **Windsurf**       | AI IDE         | ✅ 原生       | 类似 Cursor                     | 同上                   |
| **CoPaw**          | AI 助手框架    | ✅ Skill 系统 | 无内置浏览器                    | **核心价值场景**       |
| **OpenClaw**       | 开源个人 AI    | ✅ MCP 原生   | 有内置 browser 工具，但功能有限 | **核心价值场景**       |
| **CherryStudio**   | 桌面 AI 客户端 | ✅ MCP        | 无                              | **核心价值场景**       |
| **n8n**            | 工作流平台     | ✅ MCP 节点   | 有 Playwright 节点              | 提供真实浏览器选项     |
| **Dify**           | AI 应用平台    | ✅ 工具       | 有限                            | 扩展浏览器能力         |
| **Claude Code**    | 终端 AI        | ✅ 原生       | Playwright MCP                  | 真实浏览器补充         |

### 6.2 分层适配策略

```
┌─────────────────────────────────────────────────────┐
│            Layer 3: 场景模板（人人可用）               │
│  网购比价 / 表单填写 / 数据导出 / 内容摘要 / 站点监控    │
├─────────────────────────────────────────────────────┤
│            Layer 2: AI Skill（AI 助手可用）            │
│  SKILL.md + 决策树 + 回退策略 + 错误模板 + 最佳实践      │
├─────────────────────────────────────────────────────┤
│            Layer 1: MCP 工具集（开发者可用）            │
│  37+ 工具 + JSON API + 结构化错误 + annotations         │
├─────────────────────────────────────────────────────┤
│            Layer 0: 浏览器连接基座（稳定可靠）           │
│  Chrome 扩展 ↔ Native Server ↔ MCP Transport           │
└─────────────────────────────────────────────────────┘
```

### 6.3 针对关键 AI 助手的适配计划

#### OpenClaw 适配（高优先级）

OpenClaw 是 2026 年增长最快的开源个人 AI 助手（"2026 is the year of personal agents"），其架构天然适合 mcp-chrome：

- OpenClaw 以 MCP 为核心工具协议 → mcp-chrome 直接可用
- OpenClaw 可 24/7 后台运行 + cron 定时 → 需要稳定的浏览器连接
- OpenClaw 多渠道（WhatsApp/Telegram/Discord）→ 用户不在电脑前也能操作浏览器
- **行动项**：发布 `@mcp-chrome/openclaw-plugin` 或在 ClawHub 上架

#### CoPaw 适配（已在进行）

- 已有 `copaw-mcp-browser` skill 基础
- **行动项**：将 skill 内置到仓库，随产品发布

#### 通用 MCP 客户端

- 确保 stdio + SSE + Streamable HTTP 三种 transport 都稳定
- 发布 `npx mcp-chrome-bridge` 一行安装
- **行动项**：MCP 客户端配置速查卡（5 种主流客户端的复制粘贴配置）

---

## 七、路线图优先级排序

### 短期（1–2 月）：生存期

> 目标：**成为 Chrome 扩展 MCP 方案中最稳定、最易用的选择**

1. **Program 0 完成**：连接稳定性、工具可靠性、诊断体系
2. **AI Skill 技能包 v1**：让 AI 助手能正确使用所有工具
3. **一键安装体验**：`npx mcp-chrome-bridge setup`
4. **5 大客户端验证**：CoPaw / Claude Desktop / Cursor / OpenClaw / Claude Code

### 中期（3–6 月）：差异化期

> 目标：**从「工具集」升级为「执行平台」**

5. **Program 1 核心**：Task/Session/Step 模型 + 超时重试 + 结果验证
6. **操作记忆 v1**：成功路径缓存，减少 LLM 调用
7. **站点适配器 v1**：高频网站（GitHub/Google/Amazon）预置知识
8. **API Gateway**：HTTP 层供 n8n/Dify 等工作流平台调用

### 长期（6–12 月）：壁垒期

> 目标：**建立网络效应和生态壁垒**

9. **插件市场 v1**：社区贡献站点适配器和工作流模板
10. **云浏览器选项**：可选的托管浏览器实例
11. **企业版**：团队协作、审计日志、SSO
12. **商业化**：按需付费的云服务 + 企业订阅

---

## 八、风险与应对

| 风险                                   | 概率  | 影响 | 应对策略                                                                      |
| -------------------------------------- | ----- | ---- | ----------------------------------------------------------------------------- |
| Google Chrome 原生 AI 浏览取代扩展方案 | 中    | 高   | 深耕 AI 助手集成层（Skill/策略/记忆），Chrome 原生无法覆盖；保持 MCP 兼容     |
| browser-use 添加 Chrome 扩展支持       | 中    | 高   | 在稳定性和安装体验上建立先发优势；深耕 TypeScript/Node.js 生态                |
| Playwright MCP 添加 Chrome 扩展模式    | 低-中 | 高   | 已有迹象（README 提到 Chrome Extension mode）；以丰富工具集和 AI Skill 差异化 |
| MCP 被替代协议取代                     | 低    | 高   | MCP 已进入 Linux Foundation，被主流厂商采纳，短期内不会被替代                 |
| 安全事件（扩展被利用）                 | 中    | 高   | 实施 Program 0 安全治理；默认禁用破坏性工具；操作审计日志                     |
| 维护团队精力不足                       | 高    | 中   | 聚焦核心差异化功能；不追求全面覆盖；借力社区                                  |

---

## 九、总结

### 一句话

> mcp-chrome 的机会在于成为「真实浏览器 × 任何 AI」交叉点上的标准产品。这个位置目前没有强有力的竞争者，但窗口期有限——需要在 1-2 个月内解决稳定性问题并建立 AI Skill 生态。

### 三个关键决策

1. **稳定性优先于功能数量**：宁可 20 个 100% 可靠的工具，不要 50 个 80% 可靠的工具
2. **Skill 是核心产品的一部分，不是附属文档**：AI Skill 的质量直接决定 AI 助手能否正确使用产品
3. **聚焦「真实浏览器」定位，不要试图成为 browser-use**：我们不做 AI Agent 框架，我们做 AI Agent 的浏览器手脚

---

_本文档将随市场变化定期更新。下次更新计划：Program 0 完成后。_
