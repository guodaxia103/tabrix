# 第三方复用工作流

最后更新：`2026-04-15 Asia/Shanghai`
适用范围：所有引用外部 GitHub 仓库、npm 包、代码片段、设计实现的任务与 PR

相关文档：

- [第三方复用矩阵](./THIRD_PARTY_REUSE_MATRIX_zh.md)
- [Third-Party Reuse Matrix](./THIRD_PARTY_REUSE_MATRIX.md)
- [third-party 来源记录目录](./third-party/README.md)
- [`NOTICE`](../NOTICE)

## 1. 三步判断

### A. 先判断你用的是哪一类

- `直接依赖 / 直接引代码`
  - 你准备引入 npm 包、vendoring 第三方源码、复制上游实现，或把第三方文件随发布产物一起分发。
- `参考实现后自行重写`
  - 你阅读了外部实现，但最终在 Tabrix 中自己重写，不复制受限源码。
- `仅设计参考`
  - 你只借鉴产品形态、交互思路、信息架构、指标设计，不把代码带进仓库。

### B. 再判断许可证边界

- `MIT`、`Apache-2.0`：
  - 可以进入“直接依赖 / 直接引代码”候选池，但仍要核对具体包、具体路径、具体发布物。
- `AGPL`、商业限制、混合但未核清：
  - 默认降级为“仅设计参考”。
- 仓库和包、仓库和子目录许可证不一致：
  - 以“你实际要引入的包/目录”为准；未核清前不得合入。

### C. 最后决定记录动作

- `直接依赖 / 直接引代码`
  - 更新 `NOTICE`
  - 在 `docs/third-party/` 新增或更新来源记录
  - 在 PR 描述中写清项目、版本/commit、目标路径、许可证
- `参考实现后自行重写`
  - 不更新 `NOTICE`
  - 在 `docs/third-party/` 新增或更新来源记录
  - 在 PR 描述中写清参考仓库、参考范围、明确“未复制受限代码”
- `仅设计参考`
  - 不更新 `NOTICE`
  - 在 `docs/third-party/` 新增或更新来源记录
  - 在记录中标记为 `design-only`

## 2. `NOTICE` 何时更新

只有以下情况需要改 `NOTICE`：

- 新增直接依赖，且该依赖会进入发布产物或源码分发范围
- vendoring 第三方源码、脚本、模板、静态资源
- 从 Apache-2.0 项目直接带入代码，且上游带有 `NOTICE` 或其他归因要求

以下情况不更新 `NOTICE`：

- 只读过源码后自行重写
- 只借鉴产品形态或设计思路
- 只在 issue / 文档中列出调研来源

## 3. 来源记录规则

来源记录统一放在 `docs/third-party/`，规则保持简单：

- 一个上游项目一个文件，例如 `docs/third-party/rrweb.md`
- 同一项目多次使用时，在同一文件中追加新日期或新任务节
- 文件模板见 [docs/third-party/README.md](./third-party/README.md)

每条来源记录至少写清：

- 上游项目与仓库链接
- 核对的版本、tag、commit 或包版本
- 仓库根许可证，以及实际使用的包/目录许可证
- 复用分类：`direct` / `rewrite` / `design-only`
- 影响的 Tabrix 任务、PR、文件路径
- 是否更新 `NOTICE`
- 明确写出“复制了什么”或“没有复制代码，只参考设计/实现思路”

## 4. AGPL / 商业限制项目的固定规则

- `AGPL` 或商业限制项目默认标记为 `design-only`
- 这类来源可以出现在调研文档、矩阵、来源记录里
- 这类来源不能作为“先复制进来，后面再处理许可证”的过渡方案
- 如果未来真要使用其中某个 MIT 子目录或单独授权部分，必须单独核对目标路径并重新做决策；在核对完成前，仓库规则仍按 `design-only` 执行

## 5. 未来直接引 npm 包时的额外检查

- 不只看 GitHub 仓库首页许可证
- 还要核对 npm 包元数据、包内 `LICENSE`/`NOTICE`、发布说明和实际分发文件
- 若仓库是 MIT，但发布包带入了不同许可证资源或额外限制，以发布包为准
- 若核对结果不清晰，PR 不合并

## 6. PR / Release 最小门禁

### PR 必须回答

- 本 PR 是否用了第三方代码、依赖或设计参考？
- 属于 `direct`、`rewrite` 还是 `design-only`？
- `NOTICE` 是否需要更新？
- `docs/third-party/` 的来源记录在哪里？

### Release 必须确认

- 本次发布新增或更新的直接依赖，是否都已有来源记录
- 需要归因的第三方材料，是否都已经写入 `NOTICE`
- 是否有 `AGPL` / 商业限制代码误入发布范围

## 7. 当前仓库结论

- 能进入直接依赖候选池：`playwright-mcp`、`rrweb`、`selenium-ide`
- 当前更适合参考重写：`stagehand`、`browser-use`
- 明确只做设计参考：`openreplay`、`automa`
