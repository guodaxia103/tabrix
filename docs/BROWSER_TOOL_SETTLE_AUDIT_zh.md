# Browser Tool Settle Audit

## 结论

- `1020a366 feat: improve browser tool settle guidance` 解决的核心问题是：
  - 导航或切换标签页后，页面还没稳定就立刻读取/执行，导致工具误判、内容稀疏或焦点错误。
- 这次修改 **不是桥接主链修复**，而是浏览器工具层的稳态增强。
- 方向是有效的，应该保留并作为当前主线的一部分。

## 本次已覆盖的能力

- `waitForTabSettled`
  - 等待 `tab.status=complete`
  - 支持“必须发生 URL 变化”场景
  - 返回 `settled / timedOut / reason / waitedMs / readyState`
- `waitForTabActivated`
  - 等待 tab 激活和窗口聚焦完成
  - 返回 `activated / timedOut / waitedMs / windowFocused`
- 已接入的工具：
  - `chrome_navigate`
  - `chrome_switch_tab`
  - `chrome_get_web_content`
  - `chrome_read_page`（safe-first 文案与内容摘要增强）

## 为何有效

- 导航后立刻读取 DOM/文本，是浏览器自动化里最常见的“假失败”来源之一。
- 这次改动把“页面未稳”的时间窗显式建模出来，避免：
  - 读到旧 URL
  - 页面还在 loading 就截图/取文本
  - 刚切标签就开始操作，结果落到旧焦点或旧标签
- safe-first 工具描述也有帮助：
  - 先鼓励 `chrome_read_page` / `chrome_get_interactive_elements`
  - 降低直接跳到 `chrome_computer` / `chrome_javascript` 的概率

## 还未一刀切覆盖，但当前判断不应强行接入 settle 的工具

- `chrome_click_element`
  - 主要问题通常是元素定位、下载拦截、点击后导航，而不是“执行前页面 settle”
  - 更适合按 `waitForNavigation` 或点击后专项等待处理
- `chrome_fill_or_select`
  - 主要依赖输入控件是否存在，不适合默认强加页面 settle
- `chrome_get_interactive_elements`
  - 当前页面读取型工具，通常由调用者在导航后显式调用；如后续现场证明有抢跑，再补
- `chrome_screenshot`
  - 更可能需要的是“截图前渲染稳定/滚动稳定”，和导航 settle 相关但不是同一个等待条件
- `chrome_network_request`
  - 依赖当前标签上下文是否可注入，和导航 settle 弱相关

## 建议的后续优化顺序

1. 保持 `navigate / switch_tab / web_fetcher / read_page` 的 settle 主线
2. 继续观察真实助手验收里是否还有“切页后立即 click/fill/screenshot 抢跑”的证据
3. 如果证据成立，再对具体工具做最小定向等待，而不是全量一刀切
