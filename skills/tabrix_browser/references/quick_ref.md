# 工具快速参考（概念层）

> 以运行时 `tools/list` 为准；此处为辅助记忆。

| 用途           | 工具                                               |
| -------------- | -------------------------------------------------- |
| 标签枚举       | `get_windows_and_tabs`                             |
| 导航           | `chrome_navigate`                                  |
| 读页（结构化） | `chrome_read_page`, `chrome_get_web_content`       |
| 点击 / 填表    | `chrome_click_element`, `chrome_fill_or_select`    |
| 坐标/键鼠/滚动 | `chrome_computer`                                  |
| 截图           | `chrome_screenshot`                                |
| 网络           | `chrome_network_capture`, `chrome_network_request` |
| 控制台 / JS    | `chrome_console`, `chrome_javascript`              |

只读类工具通常可安全重复调用；写入、下载、书签变更等需确认用户意图。
