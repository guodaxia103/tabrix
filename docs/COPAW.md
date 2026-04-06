# CoPaw Integration Guide

This guide is verified against local CoPaw `v1.0.1`.

## 1. Add the MCP client in CoPaw

CoPaw uses its own MCP config format. The working client entry is:

```json
{
  "key": "streamable-mcp-server",
  "name": "streamable-mcp-server",
  "description": "",
  "enabled": true,
  "transport": "streamable_http",
  "url": "http://127.0.0.1:12306/mcp",
  "headers": {},
  "command": "",
  "args": [],
  "env": {},
  "cwd": ""
}
```

Important details:

- CoPaw expects `transport: "streamable_http"`
- This is different from the generic MCP examples that use `streamable-http` or `mcpServers`
- The entry ends up under `mcp.clients.<key>` in `C:\Users\guo\.copaw\config.json`

## 2. Start CoPaw

You can now start it from any directory:

```powershell
copaw app
```

The default local API is:

- `http://127.0.0.1:8088`

If you are using Codex or another skill-aware assistant locally, the recommended skill is:

- [`$copaw-mcp-browser`](C:/Users/guo/.codex/skills/copaw-mcp-browser/SKILL.md)

That skill encodes a stable read-plan-act-verify playbook so the assistant is less likely to blind click or retry uselessly.

## 3. Verify the MCP client was loaded

Check the CoPaw config file:

- `C:\Users\guo\.copaw\config.json`

Check the CoPaw log:

- `C:\Users\guo\.copaw\copaw.log`

Check the local API:

```powershell
curl http://127.0.0.1:8088/api/mcp
```

The loaded client list should include:

- `streamable-mcp-server`

Before testing through CoPaw, make sure the local bridge itself is healthy:

```powershell
mcp-chrome-bridge status
mcp-chrome-bridge doctor
```

The most useful new doctor check is:

- `Chrome extension path`

This tells you which unpacked extension directory Chrome is really running. If CoPaw cannot drive the browser after a fresh build, confirm Chrome is not still using an older unpacked directory.

## 4. Verified behavior

This integration was validated against the local runtime by:

1. Loading CoPaw config from `C:\Users\guo\.copaw\config.json`
2. Initializing CoPaw's `MCPClientManager`
3. Connecting to `streamable-mcp-server`
4. Listing tools
5. Calling `get_windows_and_tabs`

The call returned real Chrome window and tab data.

Additional direct validation through CoPaw's MCP runtime:

- `chrome_navigate` can open a real local page in a new browser window
- `chrome_get_web_content` can read selector-targeted page content successfully
- `chrome_click_element` succeeds on a simple local interaction page
- `chrome_fill_or_select` succeeds on a simple local input field
- `chrome_read_page` may degrade on `chrome://` tabs or extremely sparse localhost pages, where the accessibility tree is too thin for its main extraction strategy
- `chrome_keyboard` currently behaves more like a key/chord sender than a full-text typing helper in direct CoPaw tests
- `chrome_screenshot` can time out in direct CoPaw tests even when the same tool passes through direct MCP smoke

## 5. Recommended usage pattern in CoPaw

Do not only say "use MCP". Be explicit about the tool intent and result you want.

Good prompt patterns:

### Open a page and confirm it loaded

```text
优先使用 streamable-mcp-server。
帮我在当前浏览器中打开 https://www.bilibili.com ，并确认页面标题和当前 URL。
```

### Find elements before clicking

```text
优先使用 streamable-mcp-server。
先读取当前页面的可交互元素，找到“登录”按钮，再点击它。
如果找不到，不要乱点，先告诉我候选元素。
```

### Summarize the current page

```text
优先使用 streamable-mcp-server。
读取当前标签页正文，忽略导航栏和广告，给我 5 条要点总结。
```

### Capture evidence

```text
优先使用 streamable-mcp-server。
完成操作后截一张当前页面截图，并告诉我关键结果是否已经出现。
```

### Use network tools carefully

```text
优先使用 streamable-mcp-server。
开始抓取当前页面的网络请求，只关注与搜索结果接口有关的请求，完成后停止抓包并总结关键接口。
```

## 6. Suggested browser-operation playbook for CoPaw

For reliable browser tasks, guide CoPaw in this order:

1. `确认当前窗口/标签`
2. `导航到目标页面`
3. `读取或定位可交互元素`
4. `执行点击/输入/切换标签`
5. `读取结果`
6. `必要时截图或抓包`

This avoids vague prompts that cause blind clicking.

## 7. Fast recovery checklist

If CoPaw appears to have the MCP client but browser operations do nothing:

1. Run `mcp-chrome-bridge doctor`
2. Check `Chrome extension path`
3. Open the extension popup and click `Connect`
4. Re-run `mcp-chrome-bridge status`
5. Check `http://127.0.0.1:8088/api/mcp`
6. Retry the CoPaw task with an explicit browser-operation prompt

## 8. Current caveat in CoPaw

During direct Python-side MCP client cleanup, CoPaw's underlying MCP stack currently emits a cancel-scope cleanup error while closing the HTTP client. The browser operation itself still succeeds, but shutdown logging can look noisy.

Observed symptom:

- cleanup path raises `CancelledError` during `close_all()`

Current assessment:

- the tool call itself succeeds
- the noisy error appears during CoPaw-side client cleanup, not during normal `mcp-chrome` tool execution
- repeated direct validation confirms the cleanup noise happens after successful MCP operations, during client shutdown

## 9. Best verification commands

Before debugging CoPaw, first confirm `mcp-chrome` itself is healthy:

```powershell
mcp-chrome-bridge status
mcp-chrome-bridge doctor
```

Then check CoPaw:

```powershell
curl http://127.0.0.1:8088/api/mcp
Get-Content C:\Users\guo\.copaw\copaw.log -Tail 100
```
