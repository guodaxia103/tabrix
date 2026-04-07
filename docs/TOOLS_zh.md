# Chrome MCP Server API 参考 📚

所有可用工具及其参数的完整参考（与 `packages/shared/src/tools.ts` 中的 `TOOL_SCHEMAS` 一致）。

## 📋 目录

- [浏览器管理](#浏览器管理)
- [页面读取与内容](#页面读取与内容)
- [页面交互](#页面交互)
- [截图与录制](#截图与录制)
- [网络](#网络)
- [性能](#性能)
- [数据管理](#数据管理)
- [高级 / JavaScript](#高级--javascript)
- [响应格式](#响应格式)

## 📊 浏览器管理

### `get_windows_and_tabs`

列出当前打开的所有浏览器窗口和标签页。

**参数**：无

**响应**：

```json
{
  "windowCount": 2,
  "tabCount": 5,
  "windows": [
    {
      "windowId": 123,
      "tabs": [
        {
          "tabId": 456,
          "url": "https://example.com",
          "title": "示例页面",
          "active": true
        }
      ]
    }
  ]
}
```

### `chrome_navigate`

导航到指定 URL、刷新当前标签页，或通过浏览器历史前进/后退。`url` 为 `"back"` 或 `"forward"` 时在目标标签页执行历史导航（替代已合并的 `chrome_go_back_or_forward`）。

**参数**：

- `url` (字符串，可选)：要打开的 URL。特殊值：`"back"`、`"forward"` 表示在目标标签页中前进/后退。
- `newWindow` (布尔值，可选)：是否在新窗口中打开（默认：false）。
- `tabId` (数字，可选)：指定已有标签页 ID；若提供则对该标签页执行导航/刷新/前进/后退。
- `windowId` (数字，可选)：目标窗口 ID；在未指定 `tabId` 时用于选取活动标签页，或在已有窗口中新建标签页。
- `background` (布尔值，可选)：尽量不抢焦点（不激活标签页或聚焦窗口），默认 false。
- `width` (数字，可选)：窗口宽度（像素，默认 1280）。提供 `width` 或 `height` 时会创建新窗口。
- `height` (数字，可选)：窗口高度（像素，默认 720）。
- `refresh` (布尔值，可选)：为 true 时刷新当前活动标签页，忽略 `url`，默认 false。

**示例**：

```json
{
  "url": "https://example.com",
  "newWindow": true,
  "width": 1920,
  "height": 1080
}
```

```json
{
  "url": "back",
  "tabId": 456
}
```

### `chrome_close_tabs`

关闭一个或多个浏览器标签页。

**参数**：

- `tabIds` (数字数组，可选)：要关闭的标签页 ID 列表；未提供时关闭活动标签页。
- `url` (字符串，可选)：关闭匹配此 URL 的标签页；可与 `tabIds` 二选一使用场景。
- `windowId` (数字，可选)：当未设置 `tabIds` 与 `url` 时，关闭该窗口中的活动标签页（默认：当前窗口）。

**示例**：

```json
{
  "tabIds": [123, 456]
}
```

```json
{
  "url": "https://example.com/legacy",
  "windowId": 789
}
```

### `chrome_switch_tab`

切换到指定的浏览器标签页。

**参数**：

- `tabId` (数字，必需)：要切换到的标签页 ID。
- `windowId` (数字，可选)：该标签页所在窗口的 ID。

**示例**：

```json
{
  "tabId": 456,
  "windowId": 123
}
```

## 📄 页面读取与内容

### `chrome_read_page`

获取页面可见元素的可访问性树。仅返回视口内可见的元素。可选筛选仅交互元素。若返回中仍缺少目标元素，可配合 `chrome_computer` 的 `action="screenshot"` 获取屏幕坐标后按坐标操作。

**限制**：不适用于 `chrome://` 或浏览器内部页面；在稀疏的 localhost 页面上可能返回降级结果。

**参数**：

- `filter` (字符串，可选)：`"interactive"` 时仅包含按钮/链接/输入等交互元素（默认：全部可见元素）。
- `depth` (数字，可选)：遍历 DOM 的最大深度（整数 ≥ 0），越小输出越少、性能越好。
- `refId` (字符串，可选)：从某元素的 `refId`（如 `"ref_12"`）为根的子树；`refId` 须来自同一标签页最近一次 `chrome_read_page` 响应（可能过期）。
- `tabId` (数字，可选)：目标标签页（默认：活动标签页）。
- `windowId` (数字，可选)：未指定 `tabId` 时用于选取该窗口的活动标签页。

**示例**：

```json
{
  "filter": "interactive",
  "depth": 8,
  "tabId": 456
}
```

### `chrome_computer`

统一的鼠标、键盘、滚动与截图交互工具。

**参数**：

- `tabId` (数字，可选)：目标标签页（默认：活动标签页）。
- `background` (布尔值，可选)：部分操作尽量不聚焦标签/窗口（尽力而为），默认 false。
- `action` (字符串，**必需**)：`left_click` | `right_click` | `double_click` | `triple_click` | `left_click_drag` | `scroll` | `scroll_to` | `type` | `key` | `fill` | `fill_form` | `hover` | `wait` | `resize_page` | `zoom` | `screenshot`。
- `ref` (字符串，可选)：来自 `chrome_read_page` 的元素引用；点击/滚动/输入等优先于坐标。
- `coordinates` (对象，可选)：`{ x, y }`，截图空间或视口坐标。
- `startCoordinates` (对象，可选)：拖拽起点 `{ x, y }`。
- `startRef` (字符串，可选)：拖拽起点 ref（替代 `startCoordinates`）。
- `scrollDirection` (字符串，可选)：`up` | `down` | `left` | `right`。
- `scrollAmount` (数字，可选)：滚动刻度 1–10，默认 3。
- `text` (字符串，可选)：`type` 时为文本；`key` 时为按键序列（空格分隔，如 `"Backspace Enter"` 或 `"cmd+a"`）。
- `repeat` (数字，可选)：`action=key` 时重复次数 1–100，默认 1。
- `modifiers` (对象，可选)：点击时的修饰键 `altKey`、`ctrlKey`、`metaKey`、`shiftKey`。
- `region` (对象，可选)：`action=zoom` 时矩形区域 `{ x0, y0, x1, y1 }`（视口或截图空间像素）。
- `selector` (字符串，可选)：`fill` 时 CSS 选择器（替代 ref）。
- `value` (字符串/布尔/数字，可选)：`fill` 时填入值。
- `elements` (数组，可选)：`fill_form` 时 `{ ref, value }[]`。
- `width`、`height` (数字，可选)：`resize_page` 时视口宽高。
- `appear` (布尔值，可选)：`wait` 带文本时等待出现（true，默认）或消失（false）。
- `timeout` (数字，可选)：`wait` 带文本时超时毫秒（默认 10000，最大 120000）。
- `duration` (数字，可选)：`wait` 时等待秒数（最大 30s）。

**示例**：

```json
{
  "action": "left_click",
  "ref": "ref_12",
  "tabId": 456
}
```

### `chrome_console`

捕获浏览器标签页的控制台输出。支持快照模式（默认，约 2s 等待）与缓冲模式（按标签页持久缓冲，可即时读取/清空）。

**参数**：

- `url` (字符串，可选)：导航到该 URL 后采集控制台；未提供则使用当前活动标签页。
- `tabId` (数字，可选)：目标标签页（默认：活动标签页）。
- `windowId` (数字，可选)：未指定 `tabId` 时选取该窗口活动标签页。
- `background` (布尔值，可选)：通过 CDP 采集时不激活标签/聚焦窗口，默认 false。
- `includeExceptions` (布尔值，可选)：包含未捕获异常，默认 true。
- `maxMessages` (数字，可选)：快照模式最大消息数（默认 100）；若提供 `limit` 则 `limit` 优先。
- `mode` (字符串，可选)：`snapshot` | `buffer`。
- `buffer` (布尔值，可选)：等同于 `mode="buffer"`，默认 false。
- `clear` (布尔值，可选)：仅缓冲模式：读取前清空缓冲，默认 false。
- `clearAfterRead` (布尔值，可选)：仅缓冲模式：读取后清空，避免重复，默认 false。
- `pattern` (字符串，可选)：对消息/异常文本的正则过滤，支持 `/pattern/flags`。
- `onlyErrors` (布尔值，可选)：仅返回 error 级别消息（`includeExceptions=true` 时含异常），默认 false。
- `limit` (数字，可选)：限制返回条数；快照中等同于 `maxMessages`，缓冲模式中限制从缓冲读取的条数。

**示例**：

```json
{
  "mode": "buffer",
  "clearAfterRead": true,
  "tabId": 456
}
```

### `chrome_get_web_content`

从网页获取可见 HTML 或文本内容。

**参数**：

- `url` (字符串，可选)：要获取内容的 URL；未提供则使用当前活动标签页。
- `tabId` (数字，可选)：目标标签页（默认：活动标签页）。
- `windowId` (数字，可选)：未指定 `tabId` 时选取该窗口活动标签页；在新开标签页时可在该窗口创建。
- `background` (布尔值，可选)：获取时不激活标签/聚焦窗口，默认 false。
- `htmlContent` (布尔值，可选)：为 true 时返回可见 HTML；为 true 时忽略 `textContent`（默认 false）。
- `textContent` (布尔值，可选)：为 true 时返回可见文本及元数据（默认 true）；`htmlContent` 为 true 时忽略。
- `selector` (字符串，可选)：仅返回匹配 CSS 选择器元素内的内容。

**示例**：

```json
{
  "textContent": true,
  "selector": ".article-content",
  "tabId": 456
}
```

### `chrome_get_interactive_elements`

获取页面中的可交互元素（按钮、链接、输入框、下拉框等），包含文本、类型、坐标与属性等，便于在交互前发现可操作 UI。

**参数**：

- `textQuery` (字符串，可选)：在可交互元素中模糊匹配可见文本或 `aria-label`。
- `selector` (字符串，可选)：CSS 选择器过滤。
- `includeCoordinates` (布尔值，可选)：是否在响应中包含坐标（默认 true）。
- `types` (字符串数组，可选)：包含的元素类型（如 `"button"`、`"link"`、`"input"`、`"select"`）；默认全部类型。
- `tabId` (数字，可选)：目标标签页（默认：活动标签页）。
- `windowId` (数字，可选)：未指定 `tabId` 时选取该窗口活动标签页。

**响应**（示例）：

```json
{
  "elements": [
    {
      "selector": "#submit-button",
      "type": "button",
      "text": "提交",
      "visible": true,
      "clickable": true
    }
  ]
}
```

## 🎯 页面交互

### `chrome_click_element`

在网页上点击元素。支持 CSS 选择器、XPath、`chrome_read_page` 返回的 ref，或视口坐标。比 `chrome_computer` 更聚焦简单点击场景。

**参数**：

- `selector` (字符串，可选)：CSS 或 XPath（由 `selectorType` 指定）。
- `selectorType` (字符串，可选)：`css` | `xpath`（默认 `css`）。
- `ref` (字符串，可选)：来自 `chrome_read_page` 的元素引用，优先于 `selector`。
- `coordinates` (对象，可选)：`{ x, y }` 视口坐标。
- `double` (布尔值，可选)：是否双击，默认 false。
- `button` (字符串，可选)：`left` | `right` | `middle`，默认 left。
- `modifiers` (对象，可选)：点击时按住 `altKey`、`ctrlKey`、`metaKey`、`shiftKey`。
- `waitForNavigation` (布尔值，可选)：点击后是否等待导航完成，默认 false。
- `timeout` (数字，可选)：等待超时毫秒（默认 5000）。
- `tabId` (数字，可选)、`windowId` (数字，可选)：目标标签页/窗口。
- `frameId` (数字，可选)：iframe 目标帧 ID。

**示例**：

```json
{
  "ref": "ref_3",
  "tabId": 456
}
```

### `chrome_fill_or_select`

填充或选择表单控件（input、textarea、select、checkbox、radio 等）。可用 CSS/XPath 或 ref 定位。

**参数**：

- `selector` (字符串，可选)：CSS 或 XPath。
- `selectorType` (字符串，可选)：`css` | `xpath`（默认 `css`）。
- `ref` (字符串，可选)：来自 `chrome_read_page`，优先于 `selector`。
- `value` (字符串/数字/布尔，**必需**)：填入值；复选/单选为布尔；下拉为选项值或文本。
- `tabId` (数字，可选)、`windowId` (数字，可选)、`frameId` (数字，可选)。

**示例**：

```json
{
  "selector": "#email-input",
  "value": "user@example.com"
}
```

### `chrome_keyboard`

模拟键盘按键与组合键。向表单输入长文本时优先使用 `chrome_fill_or_select`；本工具适合快捷键与特殊键。

**参数**：

- `keys` (字符串，**必需**)：如 `"Enter"`、`"Tab"`、`"Ctrl+C"`、`"Shift+Tab"` 或连续字符。
- `selector` (字符串，可选)：接收键盘事件的元素 CSS/XPath。
- `selectorType` (字符串，可选)：`css` | `xpath`。
- `delay` (数字，可选)：按键间隔毫秒（默认 50）。
- `tabId` (数字，可选)、`windowId` (数字，可选)、`frameId` (数字，可选)。

**示例**：

```json
{
  "keys": "Ctrl+A",
  "selector": "#text-input",
  "delay": 100
}
```

### `chrome_request_element_selection`

人工辅助元素选择（human-in-the-loop）。用户需在浏览器中实际点击元素，等待时间可能从数秒到数分钟。建议在 `chrome_read_page` 与 `chrome_click_element` / `chrome_fill_or_select` / `chrome_computer` 约 3 次仍无法可靠定位时使用。返回的 ref 可与点击/填充等工具配合（含 iframe `frameId`）。

**参数**：

- `requests` (数组，**必需**)：每项对应一次选择，用户点击页面完成一项。项字段：`id`（可选，稳定关联 ID）、`name`（**必需**，展示给用户的短标签）、`description`（可选，详细说明）。
- `timeoutMs` (数字，可选)：完成全部选择的超时（默认 180000 ms，最大 600000 ms）。
- `tabId` (数字，可选)、`windowId` (数字，可选)。

**示例**：

```json
{
  "requests": [
    {
      "name": "登录按钮",
      "description": "点击右上角主登录按钮"
    }
  ],
  "timeoutMs": 120000
}
```

### `chrome_upload_file`

通过 CDP 将文件上传到表单的 `<input type="file">` 元素。

**参数**：

- `selector` (字符串，**必需**)：文件输入元素的 CSS 选择器。
- `tabId` (数字，可选)、`windowId` (数字，可选)。
- `filePath` (字符串，可选)：本机路径。
- `fileUrl` (字符串，可选)：先下载再上传的 URL。
- `base64Data` (字符串，可选)：Base64 文件数据。
- `fileName` (字符串，可选)：使用 URL 或 Base64 时的文件名（默认 `"uploaded-file"`）。
- `multiple` (布尔值，可选)：是否多文件，默认 false。

**示例**：

```json
{
  "selector": "input[type=file]#avatar",
  "filePath": "C:\\Users\\me\\avatar.png",
  "tabId": 456
}
```

## 📸 截图与录制

### `chrome_screenshot`

对当前页面或指定元素进行截图。新用法可优先 `chrome_computer` 的 `action="screenshot"`；需要本工具的高级选项时使用本工具。

**限制**：整页或超大视口在复杂页面上可能超时；失败时可缩小视口或改用 `chrome_computer`。

**参数**：

- `name` (字符串，可选)：保存为 PNG 时的名称。
- `selector` (字符串，可选)：元素截图的 CSS 选择器。
- `tabId` (数字，可选)、`windowId` (数字，可选)、`background` (布尔值，可选)：后台尽力截图说明见 schema。
- `width` (数字，可选)、`height` (数字，可选)：像素（默认 800×600）。
- `storeBase64` (布尔值，可选)：返回 Base64（默认 false），需要直接查看页面时建议 true。
- `fullPage` (布尔值，可选)：是否整页（默认 true）。
- `savePng` (布尔值，可选)：是否保存 PNG 文件（默认 true）；若主要为了在对话中查看，可设 `savePng` 为 false 且 `storeBase64` 为 true。

**示例**：

```json
{
  "selector": ".main-content",
  "fullPage": true,
  "storeBase64": true,
  "width": 1920,
  "height": 1080
}
```

**响应**：

```json
{
  "success": true,
  "base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "dimensions": {
    "width": 1920,
    "height": 1080
  }
}
```

### `chrome_handle_dialog`

通过 CDP 处理 JavaScript 对话框（`alert` / `confirm` / `prompt`）。仅在对话框正在显示时有效，否则返回错误。

**参数**：

- `action` (字符串，**必需**)：`accept` | `dismiss`。
- `promptText` (字符串，可选)：接受 `prompt` 时填入的文本。
- `tabId` (数字，可选)、`windowId` (数字，可选)。

**示例**：

```json
{
  "action": "accept",
  "promptText": "确认输入",
  "tabId": 456
}
```

### `chrome_gif_recorder`

将浏览器活动录制为 GIF。固定帧率模式（`action="start"`）适合动画/视频；自动捕获（`action="auto_start"`）在 `chrome_computer` 或 `chrome_navigate` 等操作成功时抓帧，更适合交互节奏。**注意**：快速连续 `start`→`stop` 可能因初始化时序出现「无进行中的录制」类错误，建议间隔至少数百毫秒。

**参数**：

- `action` (字符串，**必需**)：`start` | `stop` | `status` | `auto_start` | `capture` | `clear` | `export`。
- `tabId` (数字，可选)、`windowId` (数字，可选)。
- `fps` (数字，可选)：固定帧率模式 1–30，默认 5。
- `durationMs` (数字，可选)：固定帧率最大时长（默认 5000，最大 60000）。
- `maxFrames` (数字，可选)：最大帧数（固定帧率默认 50，自动模式默认 100，最大 300）。
- `width`、`height` (数字，可选)：输出 GIF 尺寸（默认约 800×600，有上限）。
- `maxColors` (数字，可选)：调色板颜色数（默认 256）。
- `filename` (字符串，可选)：输出文件名（不含扩展名）。
- `captureDelayMs` (数字，可选)：自动模式下动作后延迟再截帧（默认 150）。
- `frameDelayCs` (数字，可选)：自动模式下每帧显示时长（厘秒，默认 20 即约 200ms/帧）。
- `annotation` (字符串，可选)：`action="capture"` 时在帧上叠加的文字。
- `download` (布尔值，可选)：`export` 时 true 为下载 GIF，false 为拖拽上传等，默认 true。
- `coordinates`、`ref`、`selector` (可选)：`export` 且 `download=false` 时拖拽目标。
- `enhancedRendering` (对象或 true，可选)：自动模式下点击指示、拖拽路径、标签等叠加层；传 `true` 启用默认配置。

**示例**：

```json
{
  "action": "start",
  "fps": 8,
  "durationMs": 10000,
  "tabId": 456
}
```

## 🌐 网络

### `chrome_network_capture`

统一的网络捕获工具。`action="start"` 开始捕获，`action="stop"` 停止并返回结果。`needResponseBody=true` 时使用 Debugger API 捕获响应体（可能与 DevTools 冲突）；默认 webRequest 模式较轻量但无响应体。

**参数**：

- `action` (字符串，**必需**)：`start` | `stop`。
- `needResponseBody` (布尔值，可选)：是否捕获响应体（默认 false）。
- `url` (字符串，可选)：`start` 时导航并捕获；未提供则用当前活动标签页。
- `maxCaptureTime` (数字，可选)：最大捕获时长毫秒（默认 180000）。
- `inactivityTimeout` (数字，可选)：无活动后停止（默认 60000）；设为 0 禁用。
- `includeStatic` (布尔值，可选)：是否包含图片/脚本/样式等静态资源（默认 false）。
- `tabId` (数字，可选)、`windowId` (数字，可选)。

**示例**：

```json
{
  "action": "start",
  "url": "https://api.example.com",
  "needResponseBody": false,
  "maxCaptureTime": 60000
}
```

```json
{
  "action": "stop",
  "tabId": 456
}
```

**响应**（`stop` 示例）：

```json
{
  "success": true,
  "capturedRequests": [
    {
      "url": "https://api.example.com/data",
      "method": "GET",
      "status": 200,
      "responseTime": 150
    }
  ],
  "summary": {
    "totalRequests": 15,
    "captureTime": 5000
  }
}
```

### `chrome_network_request`

在浏览器上下文中发起网络请求（携带 Cookie 等）。可向页面注入辅助脚本并在该页环境中执行请求。

**参数**：

- `url` (字符串，**必需**)：请求 URL。
- `method` (字符串，可选)：HTTP 方法（默认 GET）。
- `headers` (对象，可选)：请求头。
- `body` (字符串，可选)：请求体（POST/PUT 等）。
- `timeout` (数字，可选)：超时毫秒（默认 30000）。
- `formData` (对象，可选)：multipart/form-data 描述，会覆盖 `body`；可含 `fields` 与 `files` 数组等（详见实现）。
- `tabId` (数字，可选)、`windowId` (数字，可选)：注入与执行上下文的标签页。

**示例**：

```json
{
  "url": "https://api.example.com/data",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"key\": \"value\"}"
}
```

### `chrome_handle_download`

等待浏览器下载完成并返回文件详情（id、filename、url、state、size 等）。

**参数**：

- `filenameContains` (字符串，可选)：按文件名或 URL 子串过滤。
- `timeoutMs` (数字，可选)：超时（默认 60000，最大 300000）。
- `waitForComplete` (布尔值，可选)：是否等待到完成（默认 true）。

**示例**：

```json
{
  "filenameContains": "report",
  "timeoutMs": 120000,
  "waitForComplete": true
}
```

## ⚡ 性能

### `performance_start_trace`

在选定页面上开始性能追踪录制。可选在开始后自动重载页面，和/或在短时后自动停止。

**参数**：

- `reload` (布尔值，可选)：开始追踪后是否自动忽略缓存刷新页面。
- `autoStop` (布尔值，可选)：是否自动停止追踪，默认 false。
- `durationMs` (数字，可选)：`autoStop` 为 true 时的自动停止时长（默认 5000 ms）。
- `tabId` (数字，可选)、`windowId` (数字，可选)。

**示例**：

```json
{
  "reload": true,
  "autoStop": true,
  "durationMs": 8000,
  "tabId": 456
}
```

### `performance_stop_trace`

停止当前页面上的性能追踪录制。

**参数**：

- `saveToDownloads` (布尔值，可选)：是否将追踪保存为 JSON 到「下载」文件夹（默认 true）。
- `filenamePrefix` (字符串，可选)：下载文件名前缀。
- `tabId` (数字，可选)、`windowId` (数字，可选)：须与开始录制时一致（默认活动标签页）。

### `performance_analyze_insight`

对最近一次录制的追踪做轻量摘要。深度分析（如 CWV）需在原生侧集成 DevTools 追踪引擎。

**参数**：

- `insightName` (字符串，可选)：预留的洞察名称（如 `"DocumentLatency"`），当前多为说明用途。
- `tabId` (数字，可选)、`windowId` (数字，可选)：解析「该标签页最近一次结果」；省略时使用活动标签页或最近录制。
- `timeoutMs` (数字，可选)：原生宿主侧分析超时（默认 60000，大追踪可适当增大）。

## 📚 数据管理

### `chrome_history`

检索与搜索 Chrome 浏览历史。

**参数**：

- `text` (字符串，可选)：在 URL 与标题中搜索；留空则在时间范围内返回条目。
- `startTime`、`endTime` (字符串，可选)：支持 ISO、相对时间（如 `"1 day ago"`）及 `now`/`today`/`yesterday` 等；默认约为过去 24 小时至当前。
- `maxResults` (数字，可选)：最大条数（默认 100）。
- `excludeCurrentTabs` (布尔值，可选)：为 true 时排除当前任意标签页已打开的 URL（默认 false）。

**示例**：

```json
{
  "text": "github",
  "startTime": "2024-01-01",
  "maxResults": 50
}
```

### `chrome_bookmark_search`

按标题与 URL 搜索书签。

**参数**：

- `query` (字符串，可选)：关键词；留空可列出（受 `maxResults` 限制）。
- `maxResults` (数字，可选)：最大条数（默认 50）。
- `folderPath` (字符串，可选)：限定在某个文件夹路径或文件夹 ID 下搜索。

**示例**：

```json
{
  "query": "文档",
  "maxResults": 20,
  "folderPath": "工作/资源"
}
```

### `chrome_bookmark_add`

添加新书签。

**参数**：

- `url` (字符串，可选)：未提供时使用 `tabId`/`windowId` 对应标签页或活动页 URL。
- `title` (字符串，可选)：书签标题（默认页面标题）。
- `parentId` (字符串，可选)：父文件夹路径或 ID（默认书签栏）。
- `createFolder` (布尔值，可选)：是否自动创建不存在的父文件夹（默认 false）。
- `tabId` (数字，可选)、`windowId` (数字，可选)。

**示例**：

```json
{
  "url": "https://example.com",
  "title": "示例网站",
  "parentId": "工作/资源",
  "createFolder": true
}
```

### `chrome_bookmark_delete`

按书签 ID 或 URL 删除书签。

**参数**：

- `bookmarkId` (字符串，可选)：书签 ID（与 `url` 二选一或按实现约定）。
- `url` (字符串，可选)：按 URL 匹配删除。
- `title` (字符串，可选)：按 URL 删除时辅助匹配标题。

**示例**：

```json
{
  "url": "https://example.com"
}
```

## 🧪 高级 / JavaScript

### `chrome_javascript`

在浏览器标签页中执行 JavaScript。使用 CDP `Runtime.evaluate`（含 awaitPromise、returnByValue），在调试器忙碌时自动回退到 `chrome.scripting.executeScript`。输出会脱敏并默认截断。

**参数**：

- `code` (字符串，**必需**)：在 async 函数体中执行，支持顶层 `await` 与 `return`。
- `tabId` (数字，可选)、`windowId` (数字，可选)。
- `timeoutMs` (数字，可选)：执行超时（默认 15000）。
- `maxOutputBytes` (数字，可选)：脱敏后最大输出字节（默认 51200）。

**示例**：

```json
{
  "code": "return document.title",
  "tabId": 456,
  "timeoutMs": 10000
}
```

## 📋 响应格式

所有工具都返回以下格式的响应：

```json
{
  "content": [
    {
      "type": "text",
      "text": "包含实际响应数据的 JSON 字符串"
    }
  ],
  "isError": false
}
```

错误时：

```json
{
  "content": [
    {
      "type": "text",
      "text": "描述出错原因的错误消息"
    }
  ],
  "isError": true
}
```

## 🔧 使用示例

### 完整工作流示例

```javascript
// 1. 导航到页面
await callTool('chrome_navigate', {
  url: 'https://example.com',
});

// 2. 读取可访问性树或交互元素
await callTool('chrome_read_page', { filter: 'interactive' });
await callTool('chrome_get_interactive_elements', {});

// 3. 截图（或使用 chrome_computer action=screenshot）
const screenshot = await callTool('chrome_screenshot', {
  fullPage: true,
  storeBase64: true,
});

// 4. 统一网络捕获：开始 → 操作 → 停止
await callTool('chrome_network_capture', {
  action: 'start',
  maxCaptureTime: 30000,
});
await callTool('chrome_click_element', {
  selector: '#load-data-button',
});
const networkData = await callTool('chrome_network_capture', {
  action: 'stop',
});

// 5. 历史后退（已合并到 chrome_navigate）
await callTool('chrome_navigate', { url: 'back' });

// 6. 保存书签
await callTool('chrome_bookmark_add', {
  title: '数据分析页面',
  parentId: '工作/分析',
});
```

本文档与 `TOOL_SCHEMAS` 中当前暴露的 **28** 个工具保持一致；已合并或不再对外暴露的工具（如 `chrome_go_back_or_forward`、拆分的网络捕获/调试器启停、`search_tabs_content`）请以上述替代用法为准。
