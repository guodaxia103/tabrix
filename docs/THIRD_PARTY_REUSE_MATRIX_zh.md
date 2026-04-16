# 第三方复用矩阵

最后更新：`2026-04-15 Asia/Shanghai`
适用范围：`Tabrix` 仓库级第三方代码、依赖、设计参考

本矩阵给后续任务一个统一边界：外部项目先分类，再决定是直接引入、参考重写，还是只做设计参考。不要把“许可证允许”误读成“当前阶段就应该整包引入”。

相关文档：

- [第三方复用工作流](./THIRD_PARTY_REUSE_WORKFLOW_zh.md)
- [Third-Party Reuse Workflow](./THIRD_PARTY_REUSE_WORKFLOW.md)
- [third-party 来源记录目录](./third-party/README.md)
- [`NOTICE`](../NOTICE)

## 快速规则

- `直接依赖 / 直接引代码`：仅限已核对到包级或目标路径级许可证的宽松许可证材料；必须补 `NOTICE` 和来源记录。
- `参考实现后自行重写`：允许参考思路、结构和接口设计；禁止复制受限代码；必须补来源记录。
- `仅设计参考`：`AGPL`、商业限制、或许可证边界不清的仓库，只记录产品启发，不进入 Tabrix 代码。

## 重点项目复用矩阵

| 项目 | 许可证 | 与 Tabrix 的关系 | 复用分类 | 允许方式 | 禁止方式 | 推荐落地方向 |
| --- | --- | --- | --- | --- | --- | --- |
| [playwright-mcp](https://github.com/microsoft/playwright-mcp) | Apache-2.0 | 最接近 Tabrix 主线的 MCP 浏览器工具契约、结构化 snapshot、扩展桥接参考 | 可局部复用 / 依赖候选 | 借鉴工具契约、扩展桥接、locator/assertion 设计；未来若引入局部源码或包，先核对目标路径/包许可证并补 `NOTICE` | 不把它当成 Tabrix 运行时替代；不在未保留 Apache-2.0 归因和变更声明时直接复制代码 | `snapshot`/`locator`/断言工具契约、连接审批与 token 流程 |
| [rrweb](https://github.com/rrweb-io/rrweb) | MIT | 最适合承接 replay artifact、DOM snapshot、失败复盘播放器 | 优先直接依赖候选 | 可作为未来直接依赖或局部引码候选；保留 MIT 许可证与版权信息 | 不因为可复用就脱离现有 `record-replay v3` 另起一套存储体系；不默认录制所有会话 | 失败流程 replay artifact、DOM/mutation 调试证据、回放 UI |
| [stagehand](https://github.com/browserbase/stagehand) | MIT | 对 URL Experience Memory、自愈、动作缓存很有启发，但与当前运行时不应整包耦合 | 仅设计/实现借鉴 | 可参考 caching、self-healing、`act/extract/agent` 抽象并自行重写；未来若直接引包，需额外核对包级许可证和运行时边界 | 不整包嵌入 Stagehand；不把 Browserbase 定向能力当成 Tabrix 默认依赖 | `URL Experience Memory` 的命中、回退、自愈策略 |
| [browser-use](https://github.com/browser-use/browser-use) | MIT | 适合借鉴 DOM serializer、enhanced snapshot、变量检测思路 | 仅设计/实现借鉴 | 可参考实现组织方式后在 TypeScript 侧重写；未来若直接引包，先核对具体包与分发物许可证 | 不直接引入 Python agent loop；不把核心 DOM 管线迁到 Python 运行时 | 动作相关节点优先的 JSON 树、变量提取、持久会话交互 |
| [selenium-ide](https://github.com/SeleniumHQ/selenium-ide) | Apache-2.0 | selector 排名、回退链、record/playback 思路对 Tabrix 有稳定性价值 | 设计借鉴，可局部复用 | 可借鉴 selector ranking、fallbackChain、导出模型；必要时可评估局部 Apache-2.0 代码并补归因 | 不引入整套 IDE/导出运行时；不在未保留归因时直接复制代码 | `fingerprint`、`fallbackChain`、站点级 locator 稳定性排序 |
| [openreplay](https://github.com/openreplay/openreplay) | 混合许可证：仓库默认 AGPL-3.0，部分目录 MIT，`ee/` 另有单独许可证 | 可借鉴统一观测面板、隐私默认开启、session replay 产品形态 | 仅设计参考 | 只记录产品能力与信息架构启发；如未来确需使用其 MIT 子目录，必须单独核对目标路径后重新评估 | 不把仓库整体当成可直接代码来源；不引入默认 AGPL 代码；不碰 `ee/` 或其他受限部分 | 失败观测面板、隐私与脱敏默认项 |
| [automa](https://github.com/AutomaApp/automa) | 混合许可证：AGPL 或 Automa Commercial License | 可借鉴工作流编排、分享、扩展形态，但不适合作为代码来源 | 仅设计参考 | 只参考工作流产品形态和交互抽象 | 不直接复制仓库代码；不引入 AGPL/商业限制代码；不把 marketplace/builder 代码并入 Tabrix | 远期 workflow UX 参考，不纳入当前主线实现 |

## 当前结论

### 可以作为直接依赖或局部代码来源候选

- `playwright-mcp`
- `rrweb`
- `selenium-ide`

说明：

- 这三类项目的仓库许可证允许后续评估直接依赖或局部引码。
- 但真正落地前，仍要核对目标包、目标目录、发布分发物以及上游 `NOTICE` 要求。

### 当前阶段更适合参考重写

- `stagehand`
- `browser-use`

说明：

- 许可证本身宽松，但当前主线不希望引入其运行时、语言栈或产品框架。
- 因此默认归类为“参考实现后自行重写”，而不是“直接依赖”。

### 明确不能作为直接代码来源

- `openreplay`
- `automa`

说明：

- 两者都存在 `AGPL` 或商业限制边界。
- 为保持规则简单，当前仓库将其统一视为“仅设计参考”，不接受“实现方便所以先复制一点”的例外。

## 边界提醒

- 仓库许可证和 npm 包许可证不一致时，以“实际引入的包或路径”重新判断，未核清前一律不得合入。
- 仓库主体为 MIT/Apache-2.0，但目标子目录或子包另有许可证时，以目标子目录或子包为准。
- 只有产品思路参考、没有代码引用时，不更新 `NOTICE`，但仍应在 `docs/third-party/` 留下来源记录。

## 许可证核对来源

- [playwright-mcp LICENSE](https://github.com/microsoft/playwright-mcp/blob/main/LICENSE)
- [stagehand LICENSE](https://github.com/browserbase/stagehand/blob/main/LICENSE)
- [browser-use LICENSE](https://github.com/browser-use/browser-use/blob/main/LICENSE)
- [rrweb LICENSE](https://github.com/rrweb-io/rrweb/blob/master/LICENSE)
- [selenium-ide LICENSE](https://github.com/SeleniumHQ/selenium-ide/blob/trunk/LICENSE)
- [openreplay LICENSE](https://github.com/openreplay/openreplay/blob/main/LICENSE)
- [automa LICENSE.txt](https://github.com/AutomaApp/automa/blob/main/LICENSE.txt)
