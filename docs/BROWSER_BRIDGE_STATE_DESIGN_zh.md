# Tabrix 浏览器桥接状态机与自动恢复实施设计（现有主线对齐版）

本页用于把“浏览器自动化是否可用”从“临时猜测/单次重试”升级为“可观测、可恢复、可归因”的状态体系。  
核心目标与主分支一致：不新增 transport，不改变 AI 助手接入模型，只提升稳定性与故障解释能力。

## 1. 适配当前主线的价值边界

当前主线已经有：

- 常驻 `tabrix daemon`（可 `start/stop/status`）；
- 本地/远程 MCP 入口已稳定；
- Native Host 注册、扩展 auto-connect 与基础重连路径；
- `tabrix status / tabrix doctor / tabrix smoke` 作为第一道诊断链路。

当前尚未完全闭环的是：

- 统一的桥接真相模型（服务层、浏览器层、扩展层状态未完全融合）；
- 扩展主动心跳与服务端统一状态更新；
- 标准化恢复编排与错误归因码体系。

因此本设计文档建议作为下一阶段实现说明，不替代当前可执行路径。

## 2. 状态模型（可落地目标）

建议 MCP 服务维护单一 `bridgeState`，并按“可执行可恢复”分层：

1. `READY`：服务、扩展、浏览器通道可执行；
2. `BROWSER_NOT_RUNNING`：服务在线但浏览器未运行；
3. `BROWSER_RUNNING_EXTENSION_UNAVAILABLE`：浏览器在跑但扩展未连上；
4. `BRIDGE_CONNECTING`：系统正在恢复连接；
5. `BRIDGE_DEGRADED`：曾短时异常、当前可用；
6. `BRIDGE_BROKEN`：恢复失败，需要用户介入。

建议状态对象（`BridgeRuntimeState`）至少包含：

- `bridgeState`
- `browserProcessRunning`
- `extensionHeartbeatAt`
- `nativeHostAttached`
- `lastBridgeErrorCode`
- `lastRecoveryAction`
- `lastRecoveryAt`
- `recoveryAttempts`

## 3. 设计原则（与当前代码契合）

1. 先读状态再执行工具调用，避免“服务在、浏览器不在”导致错判。
2. 不再依赖模糊日志拼接来判断可用性，统一走结构化状态字段。
3. 仅在浏览器相关工具调用时触发按需恢复，不在 `tools/list`、`status`、`doctor` 等查询类场景拉起浏览器。
4. 关键失败必须返回结构化错误码，避免让 AI 看到“泛泛的连接失败”。

## 4. 推荐恢复动作（V1.0）

当浏览器工具调用前发现非 `READY` 时，按优先级触发恢复：

1. `BROWSER_NOT_RUNNING`：按需启动浏览器；
2. `BROWSER_RUNNING_EXTENSION_UNAVAILABLE`：触发扩展重连动作；
3. `BRIDGE_BROKEN`：执行受限恢复流程并返回明确归因。

建议恢复超时分层：

- 浏览器启动：`12s`
- 扩展连接/心跳：`15s`
- 全链路恢复预算：`30s`

## 5. 扩展侧心跳与状态上报（建议）

主线尚无完整心跳接口，建议后续以最小化方式引入：

- 扩展每 `5s` 上报一次 `POST /bridge/heartbeat`
- 服务端 15 秒未收到则标记 `EXTENSION_HEARTBEAT_STALE`
- 心跳返回应可指导扩展是否继续工作（重试、等待）

此项建议可分阶段实现，先在 `status` 上补充状态字段，再接入完整 heartbeat。

## 6. 与现有命令的映射

- 运行态检查：`tabrix status --json` / `tabrix doctor --fix`
- 配置与远程信息：`tabrix config`
- 客户端视图：`tabrix clients`
- 主干验证：`tabrix smoke --json`
- 常驻模式维护：`tabrix daemon start/stop/status`

## 7. 验收标准（可测）

1. 浏览器关闭后，`bridgeState` 15 秒内不再是 `READY`；
2. 重新连接扩展并稳定后，状态返回 `READY`；
3. 非准备态触发自动恢复后，成功执行一次 `chrome_read_page`；
4. 失败时返回稳定错误码，不再出现“纯文本模糊报错”；
5. 错误归因可区分“服务在线但浏览器不可用”和“服务可达但扩展未连上”。

## 8. 风险与规避

- 状态抖动：引入 `DEGRADED` 中间状态，避免 READY 与 BROKEN 直接跳变。
- 误启动：只允许在真实浏览器工具调用时拉起浏览器。
- 误导用户：所有恢复失败必须返回结构化建议（如重启扩展、刷新连接、检查 manifest）。

## 9. 当前建议优先级

1. `BridgeRuntimeState` 与 `status/doctor` 可观测字段；
2. 受控恢复的工具前置检查；
3. 回归异常归因与错误码；
4. 扩展心跳作为优化项逐步接入。
