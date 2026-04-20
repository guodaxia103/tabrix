# Memory Phase 0 设计稿 · SessionManager 持久化落地

> 文档版本：v0.1 · 2026-04-20
> 作者：项目组（Claude 总负责人；agent db 侦察与调用面侦察由 Codex CLI 并行提供事实基线）
> 背景：MKEP Memory 层当前是零——`SessionManager` 是进程内 `Map`，服务重启即失忆（详见 `docs/MKEP_CURRENT_VS_TARGET.md §2`）。Memory Phase 0 是 MKEP 全栈落地的破局起点。

---

## 0. 本轮目标与非目标

### 0.1 目标（Phase 0.1）

把 `SessionManager` 的 `tasks/sessions/steps` 从进程内 `Map` 升级成 **SQLite 持久化 + 写穿透的 Map 读缓存**，做到：

1. **服务重启不失忆**：创建过的 task/session/step 可以跨进程存活。
2. **公开 API 零变更**：所有调用方（`register-tools.ts`、测试等）保持原有调用方式，不需要加 `await`，不需要改断言。
3. **测试不退化**：现有 `reset()` 约定继续有效；新增测试覆盖"写 → 关 → 重开 → 读"闭环。
4. **CI 保持绿**：native-server 测试与 chrome-extension 测试零回归。

### 0.2 非目标（留给后续 Phase）

- **Phase 0.2**：`read-page` 生成真实 `historyRef` + 写 `MemoryPageSnapshot`。
- **Phase 0.3**：`click/fill/navigate` 等工具写 `MemoryAction`；各工具 artifactRef 真正贯通到 `MemoryEvidenceRef`。
- **Phase 1**：Memory 查询 API（CLI / MCP tool）、保留期清理策略、跨 workspace 隔离。
- **Phase 2**：Memory → Experience 归纳管道（P50 耗时、成功率、fallback 率聚合）。

---

## 1. 架构决策

### 1.1 存储选型：SQLite via `better-sqlite3` + drizzle-orm

**选 better-sqlite3**（同步 API）而不是 `sqlite3`（异步）的原因：

- `SessionManager` 当前所有方法都是**同步**的。改成异步会引发整个 MCP 工具分发链的 `await` 传染，属于 breaking change。
- better-sqlite3 已经是 `@tabrix/tabrix` 的 dependency（`app/native-server/package.json`，`pnpm.onlyBuiltDependencies` 也包含它）。
- agent 子系统已在用 `better-sqlite3 + drizzle-orm`（见 `app/native-server/src/agent/db/*`），Memory Phase 0 复用同一套工具链可以最大化基础设施复用。

### 1.2 库位置：**独立 SQLite 文件**（经侦察决定）

Codex-D 侦察结论：agent.db 用 `CREATE TABLE IF NOT EXISTS + columnExists + 手写 ALTER TABLE` 做迁移，没有正式 drizzle-kit 机制；`messages.session_id` 连外键约束都没有。把 Memory 并进去会把两个 domain 的迁移面绑死，还会继承松散的 referential integrity。

**决策**：Memory 用独立文件 `~/.chrome-mcp-agent/memory.db`（与 agent.db 同目录，便于备份；路径沿用 agent 的 `CHROME_MCP_AGENT_DATA_DIR` 环境变量覆盖语义）。

- **复用**：`app/native-server/src/agent/storage.ts` 的 `getAgentDataDir()` 直接 import；`better-sqlite3@^11.6.0 + drizzle-orm@^0.45.2` 的依赖直接复用。
- **不复用**：agent db 的 migration 套路（手写 ALTER TABLE）、N+1 查询模式、`session_service` 的扁平 service 风格。Memory 从第一天就按 repository 组织，为 Phase 0.2/0.3 事务化设计做准备。
- **未来拆库退路**：前缀表 / 跨库 join 都不是 Phase 0.1 的选项。如果未来真需要跨库，可以用 `ATTACH DATABASE` 或在应用层 join。

### 1.3 访问模式：write-through cache（读 Map、写 Map + DB）

- `SessionManager` 内部继续保留 `tasks/sessions` 两个 `Map`，但定位变成 **"read-through 缓存"**。
- **写路径**：`createTask/startSession/startStep/completeStep/finishSession` 先写 DB，再更新 Map（或者反过来——由具体实现决定，但必须原子，用 `db.transaction`）。
- **读路径**：`getTask/getSession/listTasks/listSessions` 仍然读 Map；Map 在 `init()` 时从 DB 预热。
- **`reset()`**：同时清空 DB 表 + Map（仅用于测试，生产路径禁用）。

这样公开 API 保持 100% 同步、零签名变更。

### 1.4 失败回退策略

- **启动期 DB 打不开**：记录 error 日志，**回退到纯内存模式**（当前行为），打印一条明显 warning。`getDbStatus()` 暴露给健康检查。
- **运行期单次写失败**：捕获、计数、继续运行（避免把 CI 打红或把用户真实工具调用阻塞）。不允许一次写失败污染 Map。
- **未来硬化**：Phase 1 再决定是否把"写失败"升格为 tool_call 层可见错误；Phase 0 先保"可用 > 严格"。

### 1.5 并发模型

- better-sqlite3 是同步 + 串行化，天然避免读写竞争。
- WAL 模式（PRAGMA `journal_mode=WAL`）在初始化时强制开启（若 agent db 已开，则直接继承）。
- 每个写操作用 `db.transaction(() => { ... })()` 包裹，保证 Map / DB 一致。

---

## 2. Schema 设计

### 2.1 表结构

#### `memory_tasks`

```sql
CREATE TABLE IF NOT EXISTS memory_tasks (
  task_id     TEXT PRIMARY KEY,         -- uuid v4
  task_type   TEXT NOT NULL,
  title       TEXT NOT NULL,
  intent      TEXT NOT NULL,
  origin      TEXT NOT NULL,            -- e.g. 'mcp' | 'flow' | 'cli'
  owner       TEXT,                     -- nullable; actor / tenant hint
  project_id  TEXT,                     -- nullable; workspace scope hint
  labels      TEXT NOT NULL DEFAULT '[]', -- JSON array serialized
  status      TEXT NOT NULL,            -- TaskStatus
  created_at  TEXT NOT NULL,            -- ISO8601
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_tasks_created_at ON memory_tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_tasks_status     ON memory_tasks(status);
```

#### `memory_sessions`

```sql
CREATE TABLE IF NOT EXISTS memory_sessions (
  session_id        TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES memory_tasks(task_id) ON DELETE CASCADE,
  transport         TEXT NOT NULL,      -- e.g. 'stdio' | 'http'
  client_name       TEXT NOT NULL,
  workspace_context TEXT,               -- nullable for now; future: normalized
  browser_context   TEXT,               -- nullable
  summary           TEXT,
  status            TEXT NOT NULL,      -- ExecutionSessionStatus
  started_at        TEXT NOT NULL,
  ended_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_sessions_task_id    ON memory_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_memory_sessions_started_at ON memory_sessions(started_at);
```

#### `memory_steps`

```sql
CREATE TABLE IF NOT EXISTS memory_steps (
  step_id         TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES memory_sessions(session_id) ON DELETE CASCADE,
  step_index      INTEGER NOT NULL,     -- 1-based, preserves session.steps ordering
  tool_name       TEXT NOT NULL,
  step_type       TEXT NOT NULL,        -- ExecutionStepType
  status          TEXT NOT NULL,        -- ExecutionStepStatus
  input_summary   TEXT,
  result_summary  TEXT,
  error_code      TEXT,
  error_summary   TEXT,
  artifact_refs   TEXT NOT NULL DEFAULT '[]', -- JSON array serialized
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  UNIQUE (session_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_memory_steps_session_id ON memory_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_steps_tool_name  ON memory_steps(tool_name);
```

### 2.2 字段与 TypeScript 类型一致性

本 Phase 对 `ExecutionStep / ExecutionSession / Task` 的字段**不新增不减少**——Schema 字段一一对应现有 `app/native-server/src/execution/types.ts`。后续 Phase 0.2/0.3 才会新增 `page_snapshot_id`、`evidence_refs` 等字段到独立表。

### 2.3 序列化策略

- `labels: string[]` → SQLite 存 JSON 字符串；读时 `JSON.parse`，写时 `JSON.stringify`。
- `artifactRefs: string[]` → 同上。
- 时间戳全部用 ISO8601 字符串（与现有 `nowIso()` 完全一致）。
- 所有枚举用 TypeScript literal type 的原始字符串存储（不做 enum int 映射，方便手工排查）。

### 2.4 迁移策略

- **v0 启动即建表**：`CREATE TABLE IF NOT EXISTS` 模式。没有任何历史数据需要迁移（旧版 Memory 是内存态，进程死就没了）。
- **未来 Phase**：如需改 schema，沿用 agent db 已有的 migration 机制（Codex-D 报告确认后具体化）。

---

## 3. 模块结构

```
app/native-server/src/execution/
  types.ts                    # 现有，不改
  session-manager.ts          # 改造：保持公开 API，底层对接 memory/db
  result-normalizer.ts        # 现有，不改

app/native-server/src/memory/  # 新增（MKEP Memory 层的专属命名空间）
  db/
    index.ts                  # 模块导出
    client.ts                 # DB 连接 + 初始化 + WAL + CREATE TABLE
    schema.ts                 # 裸 SQL DDL（drizzle-orm 不是必须；Phase 0.1 用 prepared SQL 更直接）
    task-repository.ts
    session-repository.ts
    step-repository.ts
    row-mappers.ts            # Row <-> DTO 映射
```

> 为什么把 DB 层放到 `src/memory/db/` 而不是 `src/execution/db/`：Memory 是 MKEP 的独立层，未来会接纳 `page-snapshot-service`（Phase 0.2）、`action-service`（Phase 0.3）。把命名空间起在 `memory/` 下，后续新增模块时不需要再次搬家。`SessionManager` 作为**现有公开入口**保留在 `execution/`，内部切到 repo，保证零 breaking。

### 3.1 Repository 契约示例

```ts
export interface TaskRepository {
  insert(task: Task): void;
  update(taskId: string, patch: Partial<Task>): void;
  get(taskId: string): Task | undefined;
  list(): Task[];
  clear(): void; // 仅测试
}
```

Session / Step repo 同形态，全同步 API，内部用 `db.prepare(...).run(...)` / `.all()` / `.get()`。

### 3.2 SessionManager 改造后骨架

```ts
export interface SessionManagerOptions {
  dbPath?: string; // 覆盖默认 DB 路径；':memory:' 表示 in-memory 实例（测试用）
  persistenceEnabled?: boolean; // false 走纯 Map 模式（failsafe / 测试）
}

export class SessionManager {
  private tasks = new Map<string, Task>();
  private sessions = new Map<string, ExecutionSession>();
  private readonly repos: {
    task: TaskRepository;
    session: SessionRepository;
    step: StepRepository;
  } | null;
  private readonly persistenceEnabled: boolean;
  private readonly persistenceMode: 'disk' | 'memory' | 'off';

  constructor(options?: SessionManagerOptions) {
    const { repos, persistenceMode } = tryInitRepos(options);
    this.repos = repos;
    this.persistenceMode = persistenceMode;
    this.persistenceEnabled = repos !== null;
    if (this.repos) this.hydrateFromDb();
  }

  // 所有 public 方法保持同步，签名不变。
  // 写路径：DB first → Map。
  // 读路径：Map first（fast path）。

  public getPersistenceStatus() {
    return { mode: this.persistenceMode, enabled: this.persistenceEnabled };
  }
}

// 单例：
// - 生产环境：使用默认 DB 路径 + 持久化。
// - NODE_ENV=test 或 JEST_WORKER_ID 存在：自动切 ':memory:'，避免污染用户真实 DB。
// - 任何 DB 初始化失败：回退纯 Map 模式（persistenceMode='off'），发一条 warn 日志。
export const sessionManager = new SessionManager();
```

### 3.3 测试隔离合约

Codex-E 调用面报告指出 3 种测试模式：

1. **fresh-instance**（`session-manager.test.ts`）：每个测试 `new SessionManager(...)`，需要通过 `{ dbPath: ':memory:' }` 注入独立 DB。
2. **共享单例 + afterEach reset**（`register-tools.test.ts`, `bridge-recovery.test.ts`）：需要保证 `reset()` 把 DB 也清空。单例本身在 test env 下已经是 `:memory:` 实例，不会污染磁盘。
3. **shared 单例 + 手动 reset**（`server.test.ts`）：同上。

合约：

- `reset()` 必须**事务性清空**三张 Memory 表 + 两个 Map。
- `SessionManager` 构造器在 `process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID` 时，默认 `dbPath=':memory:'`。调用方如需跨进程持久化自测，显式传 `dbPath`。

---

## 4. 向后兼容与失败回退

### 4.1 兼容矩阵

| 场景                     | 行为                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| DB 文件不存在            | 启动时自动建库建表                                                                    |
| DB 目录无写权限          | 回退纯内存模式，打印 warning，继续提供服务                                            |
| DB 文件被别的进程锁      | 同上，回退纯内存                                                                      |
| 表 schema 不匹配（罕见） | 启动时用 `CREATE TABLE IF NOT EXISTS` 不会破坏已有表；若字段缺失由后续 migration 处理 |
| 单次写失败               | try/catch，计数 + 日志，不阻塞主流程                                                  |
| 单元测试                 | 默认用 in-memory sqlite（`:memory:`）或 `persistenceEnabled: false`                   |

### 4.2 Feature Flag

增加一个环境变量 `TABRIX_MEMORY_PERSIST`（默认 `true`）。设为 `false` 强制走纯内存模式，便于灰度或排障。

### 4.3 可观测性：`/status` 暴露 persistenceMode

Codex-E 指出 `server/index.ts:918-920` 的 `/status` 消费 `listTasks/listSessions`。本 Phase 会在 `/status` 的 execution 快照里新增一个 `persistenceMode` 字段：

```json
{
  "execution": {
    "tasks": [...],
    "sessions": [...],
    "persistenceMode": "disk"   // 'disk' | 'memory' | 'off'
  }
}
```

这样 CI / 调试 / 部署巡检可以明确识别"是否真落盘"，杜绝"以为持久化了但其实降级成 Map"的沉默故障。

---

## 5. 测试策略

### 5.1 单元测试（新增）

`app/native-server/src/execution/db/__tests__/`：

1. `task-repository.test.ts` — insert/get/update/list/clear，带边界（labels 空、owner null、时间戳格式）。
2. `session-repository.test.ts` — 同上 + 外键级联。
3. `step-repository.test.ts` — 同上 + `(session_id, step_index)` 唯一约束 + 序号递增正确性。

每份测试用 `better-sqlite3(':memory:')` 独立实例，不共享全局 sessionManager。

### 5.2 集成测试（扩写）

`app/native-server/src/execution/session-manager.test.ts`（如已存在）补：

1. **同步 API 不变**：createTask → startSession → startStep → completeStep → finishSession 的返回值和行为与当前实现 1:1 一致。
2. **持久化闭环**：手工构造一个 sessionManager 实例、写入 N 条数据、重新实例化同一 DB → 数据完整可读。
3. **reset 行为**：`reset()` 清理 DB + Map。
4. **失败回退**：给一个坏 DB（路径无权限），验证回退内存模式后主路径不崩。

### 5.3 现有测试保护

- `register-tools.test.ts` **不改断言**。Phase 0.1 的 API 保持兼容，但测试里 `beforeEach` 需要调用 `sessionManager.reset()`（如果还没有）。侦察任务 E 会告诉我哪些测试需要补。

### 5.4 CI 回归

- `pnpm --filter @tabrix/tabrix typecheck` 必须绿。
- `pnpm --filter @tabrix/tabrix test` 必须零回归（当前 101 tests）。
- `pnpm --filter @tabrix/extension test` 不受影响（无代码改动）。

---

## 6. 风险登记

| 风险                                                                  | 可能性                    | 影响       | 缓解                                                      |
| --------------------------------------------------------------------- | ------------------------- | ---------- | --------------------------------------------------------- |
| `better-sqlite3` 原生模块在 Windows/Linux/macOS 某个环境编译/加载失败 | 中                        | 服务启不来 | 失败回退纯内存模式（§4.1）；CI 在主流平台跑               |
| 与 agent db 共库导致 migration 互相牵制                               | 低                        | 升级耦合   | 独立 schema 文件 + `memory_*` 表前缀，保留拆库退路        |
| write-through 在高频 tool_call 下成为性能瓶颈                         | 低（better-sqlite3 极快） | 延迟增加   | WAL + `PRAGMA synchronous=NORMAL`；必要时引入 write batch |
| 测试互污染（跨测试共享全局 sessionManager）                           | 中                        | 偶发 flaky | `beforeEach` 强制 reset；`:memory:` 测试实例              |
| 数据文件体积无限增长                                                  | 中                        | 磁盘占用   | 留给 Phase 1：TTL / 主动压缩 / 按 task 归档               |

---

## 7. 验收清单

- [ ] `execution/db/*` 模块落地，全部同步 API。
- [ ] `SessionManager` 改造完成，公开 API 零变更。
- [ ] 新增单元测试：3 份 repo 测试 + 2 份集成测试（持久化闭环 + 失败回退）。
- [ ] `typecheck` 与现有测试套件全部绿。
- [ ] `docs:check` 通过（本设计稿挂进 `docs/` 已计入）。
- [ ] `.env` 文档（`TABRIX_MEMORY_PERSIST` 开关、DB 文件路径）补充到对应 README / `docs/CLI_AND_MCP.md`（如果需要）。
- [ ] 提交 commit 消息遵循 commitlint 规则（subject 全小写、body 行 ≤ 100）。

---

## 8. Open Questions（待决策）

1. **DB 文件路径**：沿用 agent db 的同文件，还是新起一个 `memory.sqlite`？等 Codex-D 报告核实 agent db 的实际文件定位逻辑后再定。
2. **Phase 0.1 是否就允许 Memory 查询 API？** 建议**不做**——Phase 0.1 只专注把数据真正落下来，查询 API 留给 Phase 1，避免范围蔓延。
3. **Workspace / tenant 隔离**：Phase 0.1 schema 里保留了 `owner/project_id` 列但不强制；Phase 1 再做过滤语义。
4. **Memory 与 RR-v3 的关系**：RR-v3 有自己的 IndexedDB（浏览器侧），Memory 在 native-server 侧。两者**不合并**，各自维护；未来通过 `historyRef` / `artifactRef` 做引用桥接。

---

## 附录 A · 侦察产出

- Codex-D 输出：`.tmp/memory-phase-0/outputs/agent-db.md`（agent db 架构现状 + 选型推荐）
- Codex-E 输出：`.tmp/memory-phase-0/outputs/callsites.md`（SessionManager 调用面 + 改造影响）

这两份产出将用于本设计稿 §1.2 / §5.3 的最终定案，定案后本稿将推到 v0.2。
