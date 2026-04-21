# Tabrix Product Pruning Plan — 2026.04.20

> 本文件记录一次"产品表面精简"的具体执行清单与风险评估。对应分支：`chore/remove-non-mkep-surfaces`。
> 目标：把不在 MKEP（Memory / Knowledge / Experience / Policy）主线上的产品表面全部下线，为 Stage 3+ 让路。
>
> 执行决策（来自产品负责人）：
>
> - **Q1 元素标注管理 → 清**
> - **Q2 Visual Editor (`web-editor-v2`) → 清**
> - **Q3 Sidepanel：直接下线旧三 tab，上线空的 Memory / Knowledge / Experience 三 tab 占位**

## 0. 执行原则

1. **分层 commit**：每一类清退一个 commit，便于 review 和 revert。
2. **先裁入口、再删文件**：先把启动器、路由、tab 注册点断开，让编译先 de-couple；再批量 `rm` 孤儿目录。
3. **关键耦合先迁移**：遇到 `agent/storage.getAgentDataDir` 这种被 Memory 层引用的工具函数，先迁到中性位置再删。
4. **保留 shared/selector/**：`fingerprintSimilarity` 是字符串相似度，与 ONNX 无关，是 Policy P0 locator 必须依赖的。
5. **CHANGELOG 驱动**：每个 commit 同步更新 `CHANGELOG.md`，最终在 PR body 里汇总。

## 1. 要清退的 5 大产品表面

### 1.1 智能助手 (Smart Assistant)

| 入口                                                                                         | 说明                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `app/native-server/src/agent/**`                                                             | 19 files / 217 KB — AgentChatService、EngineBridge、Codex/Claude engines |
| `app/native-server/src/server/routes/agent.ts`                                               | HTTP routes                                                              |
| `app/native-server/src/server/index.ts`                                                      | 裁剪：拿掉 `AgentStreamManager` / `ClaudeEngine` / `CodexEngine`         |
| `app/native-server/src/server/routes/index.ts`                                               | 裁剪：拿掉 `registerAgentRoutes` re-export                               |
| `app/chrome-extension/entrypoints/sidepanel/components/AgentChat.vue`                        | 1500+ 行 Vue shell                                                       |
| `app/chrome-extension/entrypoints/sidepanel/components/agent/**`                             | 9 files / 17 KB                                                          |
| `app/chrome-extension/entrypoints/sidepanel/components/agent-chat/**`                        | 29 files / 255 KB                                                        |
| `app/chrome-extension/entrypoints/sidepanel/composables/useAgent*.ts` + `useOpenProject*.ts` | Agent composables                                                        |
| `app/chrome-extension/entrypoints/sidepanel/styles/agent-chat.css`                           | 专用样式                                                                 |
| `app/chrome-extension/entrypoints/background/quick-panel/**`                                 | AI Chat Panel 浮窗（整系 = Agent 的入口）                                |
| `app/chrome-extension/shared/quick-panel/**`                                                 | Shadow-DOM AI Chat 组件库                                                |
| `app/chrome-extension/common/agent-models.ts`                                                | Agent engine 配置常量                                                    |
| `packages/shared/src/agent-types.ts`                                                         | `AgentProject / AgentSession / AgentMessage / RealtimeEvent` 等          |

**关键耦合（必须处理）**：

- `app/native-server/src/memory/db/client.ts` 里 `import { getAgentDataDir } from '../../agent/storage'`
  → **迁移**：新建 `app/native-server/src/shared/data-dirs.ts`，把 `getAgentDataDir / getDatabasePath / getDefaultWorkspaceDir / getDefaultProjectRoot` 搬过去（环境变量名保持 `CHROME_MCP_AGENT_*` 以保持兼容）。Memory 层改为 `import from '../../shared/data-dirs'`。

- `packages/shared/src/index.ts` re-export 了 `agent-types.ts`
  → 同步删除。

### 1.2 工作流 (Record-Replay / Workflow)

| 入口                                                                                           | 说明                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `app/chrome-extension/entrypoints/background/record-replay/**`                                 | RR-V2（~71 files / 439 KB）                            |
| `app/chrome-extension/entrypoints/background/record-replay-v3/**`                              | RR-V3 engine + storage + triggers（~63 / 363 KB）      |
| `app/chrome-extension/entrypoints/background/tools/record-replay.ts`                           | MCP tool `run_flow`                                    |
| `app/chrome-extension/entrypoints/background/index.ts`                                         | 裁剪：拿掉 `initRecordReplayListeners` / `bootstrapV3` |
| `app/chrome-extension/entrypoints/sidepanel/components/workflows/**`                           | 3 files / 34 KB                                        |
| `app/chrome-extension/entrypoints/sidepanel/components/rr-v3/**`                               | 1 file / 13 KB                                         |
| `app/chrome-extension/entrypoints/sidepanel/components/SidepanelNavigator.vue`                 | 旧三 tab 导航（sidepanel 重建时会被替换）              |
| `app/chrome-extension/entrypoints/sidepanel/composables/useWorkflowsV3.ts`                     | Workflow composable                                    |
| `app/chrome-extension/entrypoints/popup/components/builder/**`                                 | Node builder（只服务 RR 可视化编辑）                   |
| `app/chrome-extension/common/{step-types,node-types}.ts`                                       | 本地副本                                               |
| `app/chrome-extension/tests/record-replay*/**`                                                 | 对应测试                                               |
| `packages/shared/src/{rr-graph,step-types,node-spec,node-spec-registry,node-specs-builtin}.ts` | 共享类型                                               |

**关键耦合**：

- 部分 `tools/browser/*.ts` 和 `native-host.ts` 里出现 `TOOL_NAMES`，这是 shared/tools.ts 里的常量 → 保留 tools.ts，只删 rr-graph / step-types / node-spec。
- `app/chrome-extension/entrypoints/options/App.vue` 引用 `TOOL_NAMES` → 无影响。

### 1.3 本地模型 (Local Semantic / ONNX)

| 入口                                                                                                                                           | 说明                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `packages/wasm-simd/**`                                                                                                                        | 独立包                         |
| `app/chrome-extension/workers/**`                                                                                                              | **~32 MB** ONNX/WASM 资产      |
| `app/chrome-extension/utils/{content-indexer,vector-database,semantic-similarity-engine,simd-math-engine,model-cache-manager,text-chunker}.ts` | 运行时                         |
| `app/chrome-extension/utils/offscreen-manager.ts`                                                                                              | Offscreen 通信                 |
| `app/chrome-extension/entrypoints/offscreen/**`                                                                                                | Offscreen 页面                 |
| `app/chrome-extension/entrypoints/background/semantic-similarity.ts`                                                                           | background 侧适配              |
| `app/chrome-extension/entrypoints/background/tools/browser/vector-search.ts`                                                                   | MCP tool `search_tabs_content` |
| `app/chrome-extension/public/libs/ort.min.js`                                                                                                  | ONNX runtime                   |
| `app/chrome-extension/entrypoints/popup/components/LocalModelPage.vue`                                                                         | popup UI                       |
| `app/chrome-extension/entrypoints/popup/components/ModelCacheManagement.vue`                                                                   | popup UI                       |
| `app/chrome-extension/tests/__mocks__/{transformers,hnswlib-wasm-static}.ts`                                                                   | mocks                          |

**关键耦合**：

- `utils/i18n.ts` 里有 `similarity` 关键字（文本）→ 不影响。
- `shared/selector/fingerprint.ts` 的 `fingerprintSimilarity` 是独立字符串算法 → **保留**。
- `entrypoints/background/index.ts` 里 `initializeSemanticEngineIfCached` / `cleanupModelCache` → 裁剪删除。

### 1.4 元素标注管理 (Element Markers)

| 入口                                                                            | 说明                     |
| ------------------------------------------------------------------------------- | ------------------------ |
| `app/chrome-extension/entrypoints/background/element-marker/**`                 | storage + handlers       |
| `app/chrome-extension/inject-scripts/element-marker.js`                         | in-page marker script    |
| `app/chrome-extension/entrypoints/popup/components/ElementMarkerManagement.vue` | popup UI                 |
| `app/chrome-extension/entrypoints/sidepanel/App.vue` 里的 element-markers tab   | sidepanel 重建时一并替换 |
| `app/chrome-extension/common/element-marker-types.ts`                           | 类型                     |
| `app/chrome-extension/tests/element-marker*/**`                                 | 对应测试                 |

### 1.5 元素选择器 (Element Picker)

| 入口                                                                          | 说明                      |
| ----------------------------------------------------------------------------- | ------------------------- |
| `app/chrome-extension/entrypoints/background/tools/browser/element-picker.ts` | MCP tool `element_picker` |
| `app/chrome-extension/shared/element-picker/**`                               | 2 files                   |
| `app/chrome-extension/inject-scripts/element-picker.js`（如有）               | content script            |

> 注：Element Picker 是 human-in-the-loop 选择器，与 Element Marker 管理不完全等价。用户明确要求清退 "元素标注管理"，Picker 我也建议一起清（它服务于 Smart Assistant 的 element 选择流程，Assistant 已清则无消费者）。

### 1.6 Visual Editor (Web Editor v2)

| 入口                                                        | 说明                |
| ----------------------------------------------------------- | ------------------- |
| `app/chrome-extension/entrypoints/web-editor-v2/**`         | 61 files / 1,286 KB |
| `app/chrome-extension/entrypoints/background/web-editor/**` | background 适配     |
| `app/chrome-extension/common/web-editor-types.ts`           | 类型                |
| `app/chrome-extension/tests/web-editor-v2/**`               | 测试                |

## 2. Sidepanel UI 重建

**旧三 tab**：`workflows / agent-chat / element-markers` → 全部删除。

**新三 tab 占位**（空，等 Stage 3e/3f/3g 落实）：

- **Memory** — 未来展示 Memory SQLite 里的 Task / ExecutionSession / ExecutionStep（Stage 3e Run History UI）。
- **Knowledge** — 未来展示 Knowledge Registry 的 SiteProfile / PageCatalog / UIMap / ApiEndpoint（Stage 3d / 3g）。
- **Experience** — 未来展示 Experience Deck（Stage 4）。

每个 tab 先上"Coming in Stage 3x"占位卡片 + 指向 `docs/MKEP_STAGE_3_PLUS_ROADMAP.md` 的链接。

## 3. 入口裁剪清单

这些文件**裁剪**（不删除）：

- `app/native-server/src/server/index.ts`
- `app/native-server/src/server/routes/index.ts`
- `app/native-server/src/memory/db/client.ts`
- `app/chrome-extension/entrypoints/background/index.ts`
- `app/chrome-extension/entrypoints/background/tools/browser/index.ts`
- `app/chrome-extension/entrypoints/sidepanel/App.vue`（整体重建）
- `app/chrome-extension/entrypoints/popup/App.vue`（删掉 LocalModel / ElementMarker / Builder 三个入口）
- `packages/shared/src/index.ts`（减 re-export）
- `app/chrome-extension/common/message-types.ts`（删 Agent / RR / ElementMarker / WebEditor / QuickPanel 的 message 常量）
- `app/chrome-extension/manifest / wxt.config.ts`（删 `offscreen.html` / `builder.html` 等入口，如果有）

## 4. 执行顺序 (commit 序列)

1. **P0 / 基础设施迁移**
   - `refactor(native-server): extract data-dirs to shared module`（迁 `getAgentDataDir`）
2. **P1 / Sidepanel UI 重建**
   - `feat(sidepanel): rebuild UI with MKEP placeholder tabs (Memory/Knowledge/Experience)`
3. **P2 / 清退 Smart Assistant 栈**
   - `chore: remove smart assistant stack (agent + quick-panel + AgentChat UI)`
4. **P3 / 清退 Workflow 栈**
   - `chore: remove workflow stack (record-replay v2/v3 + popup builder)`
5. **P4 / 清退本地模型栈**
   - `chore: remove local model stack (ONNX + semantic + vector-search)`
6. **P5 / 清退 Element Markers + Picker**
   - `chore: remove element marker and picker stacks`
7. **P6 / 清退 Visual Editor**
   - `chore: remove web-editor-v2 visual editor stack`
8. **P7 / 共享包收尾**
   - `refactor(shared): prune deprecated domain types (rr-graph/step-types/node-spec/agent-types)`
9. **P8 / 文档与 CHANGELOG**
   - `docs: update product surface matrix, project structure, stage 3+ roadmap v0.3`

## 5. 验收

- [ ] `pnpm -r typecheck` 通过
- [ ] `pnpm test` 通过（被删模块的测试也一并移除）
- [ ] Extension `pnpm build` 产物体积**显著下降**（预期 > 30 MB 来自 `workers/`）
- [ ] Popup 只剩 MCP 服务状态 + 配置，不再有 LocalModel / ElementMarker / Builder 入口
- [ ] Sidepanel 打开后看到 Memory / Knowledge / Experience 三个空 tab
- [ ] `packages/shared` 的 public API 只保留：`constants / types / tools / labels / bridge-ws / read-page-contract`

## 6. 风险与回退

| 风险                                                                          | 缓解                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `getAgentDataDir` 迁移没覆盖到 agent/db/ 内部引用                             | 先做 P0 迁移，跑测试；再删 agent                                                                      |
| Memory/Policy/Knowledge 测试有隐式依赖 agent types                            | 事先跑 `grep -r '@tabrix/shared' app/native-server/src/memory app/native-server/src/policy`           |
| Options 页 `TOOL_NAMES` 里引用到被删的 tool id                                | 保留 shared/tools.ts 全部 TOOL_NAMES；只删 vector-search / element-picker 对应 id 并让 options 页过滤 |
| MCP schema 里的 `search_tabs_content` / `element_picker` 被外部 AI 客户端调用 | CHANGELOG 里声明为 BREAKING；Policy 层保持向后兼容（调用返回 `tool_removed` 错误码）                  |
| 用户 `~/.chrome-mcp-agent/` 目录里有 agent.db（历史会话）                     | 不主动删除磁盘数据；只是代码层不再读写                                                                |
| CI 流水线里有针对 RR-V3 的测试                                                | 删除测试文件时同步检查 `vitest.config.ts` / `turbo.json`                                              |

## 7. 后续（不在本 PR 内）

- Stage 3a Locator V5 / 3b Policy Engine / 3c Experience Cache / 3d Knowledge UIMap — 都在下线后的空白画布上展开。
- `docs/MKEP_STAGE_3_PLUS_ROADMAP.md` 同步 v0.3：把"依赖已清退"更新到各任务的前置条件。
