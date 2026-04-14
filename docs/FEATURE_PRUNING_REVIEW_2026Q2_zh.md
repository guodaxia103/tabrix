# 当前功能裁剪评估（2026 Q2）

最后更新：`2026-04-12 Asia/Shanghai`
适用项目：`Tabrix / mcp-chrome`

---

## 1. 目标

本评估用于回答一个实际问题：

> 当前项目中的智能助手、工作流管理、元素标记管理、本地模型等功能，哪些在未来产品方向上价值有限，应该裁剪、降级或彻底移除？

本评估不只看“功能名字是否好听”，而是结合以下四个维度判断：

- 是否服务于 `Tabrix = 真实 Chrome 的 MCP 执行层` 这一主定位
- 是否已经进入公开产品能力面
- 是否具备足够测试和维护闭环
- 继续保留的收益，是否明显大于维护成本

---

## 2. 当前主线定位

从 README、工具暴露面和现有路线图看，`Tabrix` 当前真正清晰的主线是：

- 真实浏览器连接与稳定性
- MCP 工具链
- 页面结构化读取与自动化执行
- record/replay 与可复用浏览器流程

这意味着一个功能是否值得保留，核心要看它是否强化了上述主线，而不是它本身是否“功能完整”。

---

## 3. 结论总览

| 功能                                        | 当前状态                                | 未来价值判断 | 建议                             |
| ------------------------------------------- | --------------------------------------- | ------------ | -------------------------------- |
| 智能助手（AgentChat + native agent server） | 实现重、耦合深、测试偏少                | 对主线偏航   | `降级为实验功能，退出默认产品面` |
| 工作流管理（record-replay-v3 内核）         | 实现成熟、测试较多                      | 高价值       | `保留并继续投资`                 |
| 工作流可视化 Builder / 工作流 UI            | UI 存在，但入口被锁、对外“Coming Soon”  | 中低价值     | `先下线 UI，保留内核`            |
| 旧版 record-replay v2                       | 代码量大，与 v3 并存                    | 低价值       | `尽快迁移后删除`                 |
| 元素标记管理（Element Marker）              | 轻量、可用、无测试、已被 read_page 引用 | 中低价值     | `保留底层，移除独立产品位`       |
| 本地模型 / 语义索引 / 向量搜索              | 实现重、公开面已收缩、测试弱            | 低价值       | `优先删除`                       |

---

## 4. 逐项评估

## 4.1 智能助手

### 当前实现

智能助手并不是一个轻量页面，而是一整条独立产品线：

- Native 侧存在完整的 agent 子系统：`app/native-server/src/agent`
- Sidepanel 侧存在完整会话、项目、设置、附件、时间线 UI
- 后端路由完整暴露：`/agent/projects`、`/agent/sessions`、`/agent/chat/...`
- 还与 quick panel、web editor、open project 等流程联动

代码体量大致如下：

- agent native：`19` 个文件，约 `5958` 行
- agent UI：`43` 个文件，约 `10183` 行

但覆盖度并不与体量匹配：

- extension 侧直接相关测试仅 `2` 个
- server 侧主要是路由可访问级别覆盖，不是完整行为回归

另外还有一个很关键的问题：

- UI 暴露了 `claude / codex / cursor / qwen / glm`
- 实际 server 注册的引擎只有 `CodexEngine` 和 `ClaudeEngine`

这说明它已经开始出现“产品承诺大于实际交付”的风险。

### 与主线的关系

智能助手更像“在扩展里再做一个 coding agent / IDE companion”，而不是 MCP 浏览器执行层本身。

它没有强化以下主线：

- MCP 浏览器工具稳定性
- DOM 结构化读取
- 真实浏览器自动化测试
- URL 经验库

相反，它会明显分散维护精力到：

- 会话管理
- 项目管理
- 模型/CLI 兼容
- 流式消息渲染
- 附件缓存
- open project / open file 集成

### 正式建议

建议不要把智能助手继续作为默认产品能力发展。

推荐动作：

1. 从 popup / sidepanel 的默认导航中移除智能助手产品位。
2. 将智能助手改为 `experimental` 或仅开发者模式可见。
3. 保留底层代码一段时间，观察是否有内部团队真实使用。
4. 若 `1-2` 个版本内没有明确使用场景，独立拆仓或彻底下线。

### 结论

`智能助手` 不是“马上删代码”的第一优先项，但它非常适合先退出默认产品面。  
它对未来主线价值不高，且长期维护成本明显偏高。

---

## 4.2 工作流管理

这里必须拆成三部分看，不能一刀切。

### A. record-replay-v3 内核

这是当前最有保留价值的部分。

证据：

- `app/chrome-extension/entrypoints/background/record-replay-v3`
- 约 `63` 个文件，约 `10980` 行
- 测试约 `24` 个文件
- 已经具备 flow / run / trigger / queue / recovery / rpc / debugger 基础能力
- native-server 已支持动态 flow 工具代理

它直接支撑未来这些方向：

- 真实浏览器自动化回归
- 网址经验库
- 失败流程复盘
- record/replay 与可重复执行

### 结论

`record-replay-v3` 必须保留，而且是下一阶段重点资产。

---

### B. 工作流 UI / Sidepanel / Builder

这部分价值要明显低于内核。

现状：

- popup 中工作流入口直接显示 `Coming Soon`
- sidepanel 中工作流入口被主动锁住
- `handleWorkflowLocked()` 直接弹“under development”
- 但 builder 页面和大量 UI 代码已经存在

代码体量：

- workflow UI + builder：约 `6` 个主要入口文件，约 `2258` 行
- 但 builder 还大量依赖旧版 `record-replay/types`

这说明：

- 内核准备得比 UI 更成熟
- UI 产品面还没准备好
- 现在继续维护 visual builder，短期 ROI 很低

### 正式建议

1. 暂时移除 popup 首页里的工作流产品入口。
2. sidepanel 中不要再保留“可见但点不开”的入口。
3. builder 页面改为内部调试入口，而不是用户入口。
4. 对外只保留 run/list/export 这类稳定能力，不保留 builder 承诺。

### 结论

`工作流管理` 不能整体删。  
应该删的是“未成熟的 UI 产品面”，保留的是“record-replay-v3 内核”。

---

### C. 旧版 record-replay v2

这是当前最明显的“技术债重复层”。

现状：

- background 同时初始化 `record-replay` 和 `record-replay-v3`
- v3 还通过 adapter 复用 v2 action handler
- builder 也大量依赖 v2 types

代码体量：

- v2：`71` 个文件，约 `12123` 行

这意味着仓库目前实际上同时维护了两套流程系统。

### 正式建议

1. 把 v2 明确标记为迁移态，不再新增功能。
2. 先完成：
   - v3 对 v2 action/types 的去依赖
   - builder / UI 对 v2 types 的替换
3. 完成迁移后，优先删除 v2。

### 结论

`旧版 record-replay v2` 对未来价值很低，应作为明确的删除目标。

---

## 4.3 元素标记管理

### 当前实现

元素标记管理并不大：

- background + popup 相关实现总计约 `3` 个文件，约 `654` 行
- 没有独立测试

但它并不是完全孤立的：

- `chrome_read_page` 已读取当前 URL 对应的 markers
- markers 会被作为高优先级提示并合并到返回结构中

也就是说，它在今天已经承担了一点“用户手工纠偏”的作用。

### 与主线的关系

这个功能本质上是：

- 手工 selector pinning
- 临时人工校正

它对未来 `URL Experience Memory` 有一定相似性，但不是最终形态。

未来真正更有价值的会是：

- 自动生成 fingerprint
- selector ranking + fallbackChain
- 站点级成功经验沉淀

一旦这些能力成熟，单独维护一套“元素标记管理”页面的必要性会下降。

### 正式建议

建议不要继续把它当成独立产品功能建设。

推荐动作：

1. 保留底层 marker storage 和 `read_page` 兼容能力。
2. 取消 popup / sidepanel 中单独的“元素标记管理”产品位。
3. 将 marker 能力退化为：
   - 调试辅助
   - fallback 手工 pin
   - 未来经验库迁移桥接层

### 结论

`元素标记管理` 不值得继续作为独立模块发展。  
建议“保留底层、移除前台入口、最终并入 URL 经验库”。

---

## 4.4 本地模型

### 当前实现

这里的“本地模型”并不是聊天大模型，而是：

- 语义相似度模型
- 向量数据库
- 本地内容索引
- 语义搜索工具链

相关实现包括：

- `semantic-similarity-engine.ts`
- `content-indexer.ts`
- `vector-database.ts`
- `background/semantic-similarity.ts`
- `background/tools/browser/vector-search.ts`
- popup `LocalModelPage.vue`

代码体量约：

- `6` 个核心文件，约 `5219` 行

但成熟度并不高：

- 测试几乎没有，只有 transformers mock
- `search_tabs_content` schema 已从公开工具面注释掉
- `TOOLS_zh.md` 已明确说明它“不再对外暴露”
- popup 仍保留“Local Models”独立页面
- 同时还引入了 wasm、offscreen、IndexedDB、模型缓存、清理逻辑等额外复杂度

### 与主线的关系

这个方向的问题不是“完全没用”，而是：

- 它不是当前主线的最短路径
- 它与 DOM 脱水、URL 经验库相比，优先级明显低
- 它需要持续维护模型下载、缓存、索引一致性、数据库清理
- 但现在并没有形成公开、稳定、被依赖的产品能力

从当前主线看，未来更可能成立的是：

- `chrome_read_page` 极简 JSON 树
- flow/run 经验复用
- rrweb artifact

而不是在扩展里维护一整套本地 embedding 搜索系统。

### 正式建议

`本地模型 / 语义索引 / 向量搜索` 是当前最适合删除的模块。

推荐动作：

1. 移除 popup 中的 `Local Models` 页面。
2. 删除 `search_tabs_content` 相关隐藏能力。
3. 删除 semantic engine / vector db / content indexer 主链路。
4. 清理 offscreen 初始化、模型缓存、wasm 依赖与存储清理逻辑。

前提只有一个：

- 团队确认没有明确的“离线语义搜索”短期产品计划。

### 结论

如果目标是聚焦主线，`本地模型` 应该是第一批清理对象。

---

## 5. 建议的裁剪优先级

## P0：立即从产品面移除

- Local Models 页面
- Workflow `Coming Soon` 入口
- Sidepanel 中被锁住的 Workflow 入口
- 默认展示的智能助手入口

说明：

- 这些内容要么未成熟，要么偏离主线，要么已经不对外暴露
- 继续展示只会提高认知噪音和维护负担

## P1：进入迁移或实验模式

- 智能助手：改为 `experimental`
- 元素标记管理：退化为内部/调试功能
- Builder：仅内部入口保留

## P2：完成迁移后删除

- 旧版 record-replay v2
- v2 类型依赖与 adapter 过渡层

## P3：明确产品计划后再决定

- 智能助手底层是否拆仓
- 元素标记底层是否并入 URL Experience Memory

---

## 6. 推荐的最终产品面

如果以“聚焦主线”为目标，建议把用户看到的产品面收敛成：

- 连接与稳定性
- MCP 配置与远程访问
- 页面读取与执行
- record-replay v3 的运行与复盘
- Web Editor（如确认继续）

不建议继续作为首页一级功能保留的有：

- 智能助手
- 本地模型
- 元素标记管理
- 未完成的工作流 builder

---

## 7. 最终结论

最应该优先清理的是：

1. `本地模型 / 语义索引 / 向量搜索`
2. `工作流的未成熟 UI 产品面`
3. `旧版 record-replay v2`

最应该从默认产品面降级的是：

1. `智能助手`
2. `元素标记管理`

最不应该删的是：

1. `record-replay-v3 内核`

一句话总结：

> 未来真正有价值的是“真实浏览器 MCP 执行 + DOM 脱水 + 经验复用 + 可回放流程”，而不是在扩展里继续并行养一套智能助手和本地语义搜索产品线。
