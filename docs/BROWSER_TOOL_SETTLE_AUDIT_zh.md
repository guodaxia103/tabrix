# Browser Tool Settle 审计与落地复盘（适配当前主分支）

`browser tool settle` 的核心作用是解决“动作太快导致的假失败”：  
导航、切换标签后页面尚未稳定就执行读取/操作，会造成读取空内容、聚焦错位、点击错位等高频问题。

## 1. 结论

该方向与当前主线一致，已具备足够现实价值，建议继续保持：

- 先让工具在“页面稳定”时执行，再继续动作；
- 失败时尽量返回可解释的稳定性信息；
- 不把这类等待逻辑硬塞给所有工具，避免过度延迟。

## 2. 已有能力（主分支可见）

- `waitForTabSettled`：支持导航后等待 `tab.status=complete`，并支持“必须 URL 变化”约束；
- `waitForTabActivated`：支持窗口激活与标签焦点确认；
- `chrome_navigate`、`chrome_switch_tab`、`chrome_get_web_content`、`chrome_read_page` 已接入前置稳定控制；
- 运行时已加入“先读页面再行动”的 Safe-first 说明，减少直接触发高风险工具的倾向。

## 3. 不建议“一刀切”接入的工具

以下工具的主要问题与 `settle` 并不总是同构，建议按场景做最小化补齐：

- `chrome_click_element`：更关注定位准确性和点击后导航；
- `chrome_fill_or_select`：更关注输入元素存在性与字段语义；
- `chrome_screenshot`：需要的是“渲染稳定 / 截图前等待”而非导航完成；
- `chrome_network_request`：主要取决于请求注入与上下文，未必等同于导航 settle。

## 4. 当前建议（可落地）

1. 保持 `navigate / switch_tab / get_web_content / read_page` 的 settle 主线；
2. 真实客户端运行时收集是否存在“切页后立即 click/fill/screenshot 抢跑”的证据；
3. 只对出现证据的工具补最小定向等待，不扩散为全量策略。

## 5. 评估指标（最小验收）

- 同一类页面场景下，`chrome_read_page` 的空/稀疏内容回报率下降；
- `smoke --json` 通过率提升；
- 真实客户端的“导航后首读失败”告警下降；
- 仍保持 `--keep-tab` 场景下可复现的稳定等待耗时可控。
