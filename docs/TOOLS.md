# Chrome MCP Server API Reference 📚

Complete reference for all available tools and their parameters.

## 📋 Table of Contents

- [Browser Management](#browser-management)
- [Page Reading & Content](#page-reading--content)
- [Page Interaction](#page-interaction)
- [Screenshots & Recording](#screenshots--recording)
- [Network](#network)
- [Performance](#performance)
- [Data Management](#data-management)
- [Advanced / JavaScript](#advanced--javascript)
- [Response Format](#response-format)

## 📊 Browser Management

### `get_windows_and_tabs`

List all currently open browser windows and tabs.

**Parameters**: None

**Response**:

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
          "title": "Example Page",
          "active": true
        }
      ]
    }
  ]
}
```

### `chrome_navigate`

Navigate to a URL, refresh the current tab, or move in browser history (back/forward).

**Parameters**:

- `url` (string, optional): URL to navigate to. Use the special values `"back"` or `"forward"` to navigate history in the target tab (replaces the old `chrome_go_back_or_forward` tool).
- `refresh` (boolean, optional): When `true`, refresh the current tab instead of navigating; `url` is ignored. Default: `false`.
- `newWindow` (boolean, optional): Create a new window (default: `false`).
- `tabId` (number, optional): Target tab for navigate, refresh, back, or forward (default: active tab).
- `windowId` (number, optional): Window to use when picking the active tab or when creating a tab in an existing window.
- `background` (boolean, optional): Do not activate the tab or focus the window (default: `false`).
- `width` (number, optional): Window width in pixels (default: 1280). If `width` or `height` is set, a new window may be created per implementation.
- `height` (number, optional): Window height in pixels (default: 720).

**Example**:

```json
{
  "url": "https://example.com",
  "newWindow": true,
  "width": 1920,
  "height": 1080
}
```

**History navigation** (replaces `chrome_go_back_or_forward`):

```json
{ "url": "back" }
```

```json
{ "url": "forward", "tabId": 123 }
```

**Refresh**:

```json
{ "refresh": true }
```

### `chrome_close_tabs`

Close one or more browser tabs.

**Parameters**:

- `tabIds` (array of numbers, optional): Tab IDs to close. If omitted with no `url`, behavior targets the active tab (see `windowId`).
- `url` (string, optional): Close tabs whose URL matches this value (alternative to `tabIds`).
- `windowId` (number, optional): When neither `tabIds` nor `url` is set, close the active tab in this window (default: current window).

**Example**:

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

Switch to a specific browser tab.

**Parameters**:

- `tabId` (number, required): The ID of the tab to switch to.
- `windowId` (number, optional): The ID of the window where the tab is located.

**Example**:

```json
{
  "tabId": 456,
  "windowId": 123
}
```

## 📄 Page Reading & Content

### `chrome_read_page`

Get an accessibility tree of visible elements in the viewport, with stable `ref_*` identifiers. Optionally focus on interactive nodes or a subtree. Does not work on `chrome://` pages; localhost may return sparse output.

**Parameters**:

- `filter` (string, optional): Use `"interactive"` for buttons, links, inputs, etc.; default includes visible structural/labeled nodes.
- `depth` (number, optional): Maximum DOM depth to traverse (integer ≥ 0); lower values reduce output size.
- `refId` (string, optional): Subtree root ref (e.g. `"ref_12"`) from a recent `chrome_read_page` in the same tab; refs may expire.
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window used when `tabId` is omitted.

**Example**:

```json
{
  "filter": "interactive",
  "depth": 12
}
```

**Response**: Includes `pageContent`, viewport info, and ref summaries. Use refs with `chrome_click_element`, `chrome_fill_or_select`, or `chrome_computer`.

### `chrome_get_web_content`

Fetch visible HTML or text from a page (current tab or a URL).

**Parameters**:

- `url` (string, optional): Page to load; if omitted, uses the active tab.
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window for active tab or new-tab creation when `url` is used.
- `background` (boolean, optional): Avoid focusing tab/window (default: `false`).
- `htmlContent` (boolean, optional): Return visible HTML; when `true`, text-oriented options are ignored (default: `false`).
- `textContent` (boolean, optional): Return visible text with metadata (default: `true` unless `htmlContent` is `true`).
- `selector` (string, optional): Limit content to this CSS selector.

**Example**:

```json
{
  "textContent": true,
  "selector": ".article-content"
}
```

### `chrome_console`

Capture console output from a tab: **snapshot** mode (default, ~2s wait) or **buffer** mode (persistent per-tab buffer, read/clear without waiting).

**Parameters**:

- `url` (string, optional): Navigate here first; if omitted, uses the active tab.
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `background` (boolean, optional): Do not activate tab/window for CDP capture (default: `false`).
- `includeExceptions` (boolean, optional): Include uncaught exceptions (default: `true`).
- `maxMessages` (number, optional): Max messages in snapshot mode (default: `100`). Superseded by `limit` when provided.
- `mode` (string, optional): `"snapshot"` | `"buffer"`.
- `buffer` (boolean, optional): Alias for `mode="buffer"` (default: `false`).
- `clear` (boolean, optional): Buffer mode: clear buffer before read (default: `false`).
- `clearAfterRead` (boolean, optional): Buffer mode: clear after read to avoid duplicates (default: `false`).
- `pattern` (string, optional): Regex filter on message/exception text; supports `/pattern/flags`.
- `onlyErrors` (boolean, optional): Only error-level messages (and exceptions if included) (default: `false`).
- `limit` (number, optional): In snapshot mode, alias for `maxMessages`; in buffer mode, limits returned rows.

**Example**:

```json
{
  "mode": "snapshot",
  "maxMessages": 50,
  "onlyErrors": true
}
```

### `chrome_get_interactive_elements`

List interactive elements (buttons, links, inputs, selects, etc.) with text, type, coordinates, and attributes.

**Parameters**:

- `textQuery` (string, optional): Fuzzy match on visible text or `aria-label`.
- `selector` (string, optional): CSS selector filter.
- `includeCoordinates` (boolean, optional): Include coordinates (default: `true`).
- `types` (array of strings, optional): e.g. `"button"`, `"link"`, `"input"`; default all types.
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.

**Example**:

```json
{
  "textQuery": "Submit",
  "types": ["button", "link"]
}
```

## 🎯 Page Interaction

### `chrome_computer`

Mouse, keyboard, and screenshot automation with CDP-oriented behavior. Prefer `ref` from `chrome_read_page` before clicking icons or small targets. Coordinates may align with recent `chrome_screenshot` / screenshot action space.

**Parameters**:

- `action` (string, required): `left_click` | `right_click` | `double_click` | `triple_click` | `left_click_drag` | `scroll` | `scroll_to` | `type` | `key` | `fill` | `fill_form` | `hover` | `wait` | `resize_page` | `zoom` | `screenshot`
- `tabId` (number, optional): Target tab (default: active tab).
- `background` (boolean, optional): Best-effort avoid focusing tab/window (default: `false`).
- `ref` (string, optional): Element ref from `chrome_read_page` (precedence over coordinates for many actions).
- `coordinates` (object, optional): `{ "x", "y" }` — viewport or screenshot space if a recent screenshot context exists.
- `startCoordinates` / `startRef` (optional): Drag start for `left_click_drag`.
- `scrollDirection` (string, optional): `up` | `down` | `left` | `right`.
- `scrollAmount` (number, optional): Ticks 1–10 (default: 3).
- `text` (string, optional): For `type` or `key` (space-separated chords, e.g. `"Backspace Enter"`, `"cmd+a"`).
- `repeat` (number, optional): For `key`, repeat count 1–100 (default: 1).
- `modifiers` (object, optional): `altKey`, `ctrlKey`, `metaKey`, `shiftKey` for click actions.
- `region` (object, optional): For `zoom`, rectangle `x0,y0,x1,y1`.
- `selector` / `value` (optional): For `fill` (value may be string | boolean | number).
- `elements` (array, optional): For `fill_form`, list of `{ ref, value }`.
- `width` / `height` (optional): For `resize_page`.
- `appear`, `timeout`, `duration` (optional): For `wait` (text vs timed wait; see schema defaults).
- `saveToDownloads` (boolean, optional): For `screenshot`, also save the PNG file to the browser downloads folder (default: `false` — returns base64 only).

**Scroll actions**:

- **`scroll`** — Scroll by a given amount at a specific position. Requires `ref` or `coordinates` to indicate where to scroll. Use `scrollDirection` (`up`/`down`/`left`/`right`) and `scrollAmount` (ticks 1–10, default 3).
- **`scroll_to`** — Scroll an element into view. Requires `ref` (from `chrome_read_page`). No coordinates or direction needed.

**Examples**:

```json
{ "action": "left_click", "coordinates": { "x": 420, "y": 260 } }
```

```json
{ "action": "scroll", "ref": "ref_3", "scrollDirection": "down", "scrollAmount": 5 }
```

```json
{
  "action": "scroll",
  "coordinates": { "x": 640, "y": 400 },
  "scrollDirection": "up",
  "scrollAmount": 3
}
```

```json
{ "action": "scroll_to", "ref": "ref_42" }
```

```json
{ "action": "key", "text": "cmd+a Backspace" }
```

```json
{ "action": "fill", "ref": "ref_7", "value": "user@example.com" }
```

### `chrome_click_element`

Click via ref, CSS/XPath selector, or coordinates. Supports iframe `frameId`.

**Parameters**:

- `selector` (string, optional): CSS or XPath (see `selectorType`).
- `selectorType` (string, optional): `css` | `xpath` (default: `css`).
- `ref` (string, optional): Ref from `chrome_read_page` (wins over `selector`).
- `coordinates` (object, optional): `{ "x", "y" }` required when using coordinate targeting.
- `double` (boolean, optional): Double-click (default: `false`).
- `button` (string, optional): `left` | `right` | `middle` (default: `left`).
- `modifiers` (object, optional): `altKey`, `ctrlKey`, `metaKey`, `shiftKey`.
- `waitForNavigation` (boolean, optional): Wait for navigation after click (default: `false`).
- `timeout` (number, optional): Wait timeout in ms (default: `5000`).
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `frameId` (number, optional): Target frame for iframes.

Provide at least one of `ref`, `selector`, or `coordinates`.

**Example**:

```json
{
  "ref": "ref_42"
}
```

### `chrome_fill_or_select`

Fill inputs, textareas, or select options; supports checkboxes and radios.

**Parameters**:

- `value` (string | number | boolean, required): Value to set.
- `selector` (string, optional): CSS or XPath.
- `selectorType` (string, optional): `css` | `xpath` (default: `css`).
- `ref` (string, optional): Ref from `chrome_read_page`.
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `frameId` (number, optional): Target frame for iframes.

Provide `ref` or `selector` to identify the element.

**Example**:

```json
{
  "ref": "ref_7",
  "value": "user@example.com"
}
```

### `chrome_keyboard`

Send key events or chords to the page (shortcuts, special keys). For long text into fields, prefer `chrome_fill_or_select`.

**Parameters**:

- `keys` (string, required): e.g. `"Enter"`, `"Ctrl+C"`, `"Hello World"`.
- `selector` (string, optional): Focus target (CSS or XPath per `selectorType`).
- `selectorType` (string, optional): `css` | `xpath` (default: `css`).
- `delay` (number, optional): Delay between keystrokes in ms (default: `50`).
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `frameId` (number, optional): Target frame for iframes.

**Example**:

```json
{
  "keys": "Ctrl+A",
  "selector": "#text-input",
  "delay": 100
}
```

### `chrome_request_element_selection`

Human-in-the-loop element picker: the user must click elements in the browser; expect seconds to minutes. Use after repeated failed location via `chrome_read_page` + click/fill/computer. Returns refs compatible with click/fill (including iframe `frameId` when applicable).

**Parameters**:

- `requests` (array, required): Each item `{ id?, name (required), description? }` — one picked element per request.
- `timeoutMs` (number, optional): Default `180000` (max `600000`).
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.

**Example**:

```json
{
  "requests": [{ "name": "Login button", "description": "Primary login in the header" }],
  "timeoutMs": 120000
}
```

### `chrome_upload_file`

Upload files to `<input type="file">` via Chrome DevTools Protocol.

**Parameters**:

- `selector` (string, required): CSS selector for the file input.
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `filePath` (string, optional): Local path.
- `fileUrl` (string, optional): Download then upload.
- `base64Data` (string, optional): Raw bytes as base64.
- `fileName` (string, optional): Filename for URL/base64 (default: `"uploaded-file"`).
- `multiple` (boolean, optional): Multi-file input (default: `false`).

**Example**:

```json
{
  "selector": "input#resume",
  "filePath": "/path/to/resume.pdf"
}
```

## 📸 Screenshots & Recording

### `chrome_screenshot`

Advanced full-page or element screenshots. Prefer `chrome_read_page` for structure and `chrome_computer` with `action="screenshot"` for new flows; use this when you need these specific options. Large full-page captures may time out on heavy pages.

**Parameters**:

- `name` (string, optional): Filename when saving PNG.
- `selector` (string, optional): Element to capture.
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `background` (boolean, optional): Best-effort capture without foreground focus (default: `false`).
- `width` (number, optional): Width in pixels (default: `800`).
- `height` (number, optional): Height in pixels (default: `600`).
- `storeBase64` (boolean, optional): Include base64 image in the response (default: `false`).
- `fullPage` (boolean, optional): Capture full scrollable page (default: `true`).
- `savePng` (boolean, optional): Save PNG to disk (default: `true`); for inline viewing, often pair `savePng: false` with `storeBase64: true`.

**Example**:

```json
{
  "selector": ".main-content",
  "fullPage": true,
  "storeBase64": true,
  "savePng": false,
  "width": 1920,
  "height": 1080
}
```

**Response** (illustrative):

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

Accept or dismiss JavaScript `alert` / `confirm` / `prompt` via CDP. Only works while a dialog is visible on the target tab.

**Parameters**:

- `action` (string, required): `accept` | `dismiss`.
- `promptText` (string, optional): Text for `prompt` when accepting.
- `tabId` (number, optional): Tab showing the dialog (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.

**Example**:

```json
{
  "action": "accept",
  "promptText": "yes"
}
```

### `chrome_gif_recorder`

Record tab activity as an animated GIF. Modes include fixed-FPS `start`, action-triggered `auto_start`, `stop`, `status`, `capture`, `clear`, and `export`. Allow a short delay between `start` and `stop` to avoid race errors.

**Parameters**:

- `action` (string, required): `start` | `stop` | `status` | `auto_start` | `capture` | `clear` | `export`.
- `tabId` (number, optional): Recording/export target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `fps` (number, optional): Fixed-FPS mode, 1–30 (default: `5`).
- `durationMs` (number, optional): Max duration for fixed-FPS (default: `5000`, max: `60000`).
- `maxFrames` (number, optional): Frame cap (defaults differ by mode; max `300`).
- `width` / `height` (number, optional): Output size (defaults `800×600`, max `1920×1080`).
- `maxColors` (number, optional): Palette size (default: `256`).
- `filename` (string, optional): Base name without extension.
- `captureDelayMs` (number, optional): Auto mode: delay after action before frame (default: `150`).
- `frameDelayCs` (number, optional): Auto mode: centiseconds per frame (default: `20`).
- `annotation` (string, optional): With `capture` in auto mode, label on frame.
- `download` (boolean, optional): For `export`, `true` downloads, `false` drag-and-drop upload (default: `true`).
- `coordinates` / `ref` / `selector` (optional): For `export` with `download=false`, drop target.
- `enhancedRendering` (boolean | object, optional): Auto mode overlays (click indicators, drag paths, labels); `true` enables defaults.

**Example**:

```json
{
  "action": "start",
  "fps": 8,
  "durationMs": 10000,
  "filename": "demo-flow"
}
```

## 🌐 Network

### `chrome_network_capture`

Unified capture: `action="start"` begins, `action="stop"` ends and returns results. Default path uses the webRequest API (lightweight; no response bodies). Set `needResponseBody=true` to use the Debugger API (response bodies; may conflict with DevTools).

**Parameters**:

- `action` (string, required): `start` | `stop`.
- `needResponseBody` (boolean, optional): Use Debugger API for bodies (default: `false`).
- `url` (string, optional): For `start`, open/navigate; if omitted, uses the active tab.
- `maxCaptureTime` (number, optional): Max capture duration in ms (default: `180000`).
- `inactivityTimeout` (number, optional): Stop after quiet period in ms (default: `60000`; `0` disables).
- `includeStatic` (boolean, optional): Include images/scripts/styles (default: `false`).
- `tabId` (number, optional): Tab to attach to for `start` / `stop`.
- `windowId` (number, optional): Window when `tabId` is omitted.

**Example**:

```json
{ "action": "start", "includeStatic": false }
```

```json
{ "action": "stop" }
```

### `chrome_network_request`

Issue an HTTP request with the browser’s cookies and context (often via a content script in a tab).

**Parameters**:

- `url` (string, required): Request URL.
- `method` (string, optional): HTTP method (default: `GET`).
- `headers` (object, optional): Request headers.
- `body` (string, optional): Raw body for methods that need it.
- `timeout` (number, optional): Timeout in ms (default: `30000`).
- `formData` (object, optional): Multipart form descriptor with optional file parts (see schema for shape).
- `tabId` (number, optional): Tab whose context runs the helper (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.

**Example**:

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

Wait for a browser download and return metadata (id, filename, url, state, size).

**Parameters**:

- `filenameContains` (string, optional): Substring filter on filename or URL.
- `timeoutMs` (number, optional): Wait timeout (default: `60000`, max: `300000`).
- `waitForComplete` (boolean, optional): Wait until finished (default: `true`).

**Example**:

```json
{
  "filenameContains": "report",
  "timeoutMs": 120000,
  "waitForComplete": true
}
```

## ⚡ Performance

### `performance_start_trace`

Start a performance trace on the page; optionally reload and/or auto-stop after a duration.

**Parameters**:

- `reload` (boolean, optional): After trace starts, reload ignoring cache.
- `autoStop` (boolean, optional): Auto-stop trace (default: `false`).
- `durationMs` (number, optional): Duration when `autoStop` is true (default: `5000`).
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.

**Example**:

```json
{
  "reload": true,
  "autoStop": true,
  "durationMs": 8000
}
```

### `performance_stop_trace`

Stop the active trace on the tab where recording started.

**Parameters**:

- `saveToDownloads` (boolean, optional): Save trace JSON to Downloads (default: `true`).
- `filenamePrefix` (string, optional): Filename prefix for the trace file.
- `tabId` (number, optional): Must match the tab that started the trace (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.

**Example**:

```json
{
  "saveToDownloads": true,
  "filenamePrefix": "trace-run-1"
}
```

### `performance_analyze_insight`

Lightweight summary of the last recorded trace on a tab (deeper analysis may require native DevTools integration).

**Parameters**:

- `insightName` (string, optional): Placeholder for future named insights (e.g. `"DocumentLatency"`).
- `tabId` (number, optional): Tab whose last trace to analyze (default: active / most recent).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `timeoutMs` (number, optional): Native analysis timeout (default: `60000`).

**Example**:

```json
{
  "insightName": "DocumentLatency",
  "timeoutMs": 90000
}
```

## 📚 Data Management

### `chrome_history`

Search browsing history with flexible time strings.

**Parameters**:

- `text` (string, optional): Filter URL/title; empty returns entries in the time window.
- `startTime` (string, optional): ISO, relative phrases, or keywords like `today` (default: ~24 hours ago).
- `endTime` (string, optional): End bound (default: now).
- `maxResults` (number, optional): Cap results (default: `100`).
- `excludeCurrentTabs` (boolean, optional): Exclude URLs open in any tab (default: `false`).

**Example**:

```json
{
  "text": "github",
  "startTime": "2024-01-01",
  "maxResults": 50
}
```

### `chrome_bookmark_search`

Search bookmarks by title/URL.

**Parameters**:

- `query` (string, optional): Match text; empty returns up to `maxResults` bookmarks.
- `maxResults` (number, optional): Default `50`.
- `folderPath` (string, optional): Limit to a folder path or folder ID.

**Example**:

```json
{
  "query": "documentation",
  "maxResults": 20,
  "folderPath": "Work/Resources"
}
```

### `chrome_bookmark_add`

Add a bookmark, optionally creating folders.

**Parameters**:

- `url` (string, optional): Page URL; if omitted, uses `tabId` / `windowId` / active tab.
- `title` (string, optional): Bookmark title (default: page title).
- `parentId` (string, optional): Folder path or ID (default: Bookmarks Bar).
- `createFolder` (boolean, optional): Create missing parent folders (default: `false`).
- `tabId` (number, optional): Tab to bookmark when `url` is omitted.
- `windowId` (number, optional): Window when `url` and `tabId` are omitted.

**Example**:

```json
{
  "url": "https://example.com",
  "title": "Example Site",
  "parentId": "Work/Resources",
  "createFolder": true
}
```

### `chrome_bookmark_delete`

Delete a bookmark by id or URL.

**Parameters**:

- `bookmarkId` (string, optional): Direct bookmark id.
- `url` (string, optional): Match by URL if id not given.
- `title` (string, optional): Disambiguate when deleting by URL.

**Example**:

```json
{
  "url": "https://example.com"
}
```

## 🧪 Advanced / JavaScript

### `chrome_javascript`

Execute JavaScript in the page via CDP `Runtime.evaluate` (with `awaitPromise` / `returnByValue`), falling back to `chrome.scripting` if the debugger is busy. Output is sanitized and size-limited.

**Parameters**:

- `code` (string, required): Runs inside an async function body; supports top-level `await` and `return`.
- `tabId` (number, optional): Target tab (default: active tab).
- `windowId` (number, optional): Window when `tabId` is omitted.
- `timeoutMs` (number, optional): Execution timeout (default: `15000`).
- `maxOutputBytes` (number, optional): Max serialized output after sanitization (default: `51200`).

**Example**:

```json
{
  "code": "return document.title",
  "timeoutMs": 5000
}
```

## 📋 Response Format

All tools return responses in the following format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "JSON string containing the actual response data"
    }
  ],
  "isError": false
}
```

For errors:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error message describing what went wrong"
    }
  ],
  "isError": true
}
```

## 🔧 Usage Examples

### Complete Workflow Example

```javascript
// 1. Navigate to a page
await callTool('chrome_navigate', {
  url: 'https://example.com',
});

// 2. Take a screenshot
const screenshot = await callTool('chrome_screenshot', {
  fullPage: true,
  storeBase64: true,
});

// 3. Start network monitoring
await callTool('chrome_network_capture', {
  action: 'start',
  maxCaptureTime: 30000,
});

// 4. Interact with the page
await callTool('chrome_click_element', {
  selector: '#load-data-button',
});

// 5. Stop capture and inspect traffic
const networkData = await callTool('chrome_network_capture', {
  action: 'stop',
});

// 6. Save bookmark
await callTool('chrome_bookmark_add', {
  title: 'Data Analysis Page',
  parentId: 'Work/Analytics',
});
```

---

## 📋 Typical Usage Scenarios

Recommended tool combinations by task goal.

### Information Retrieval

| Scenario                  | Tools                                                                    | Notes                                            |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Read and summarize page   | `chrome_read_page` → `chrome_get_web_content`                            | Accessibility tree first, then extract text/HTML |
| Find buttons and links    | `chrome_get_interactive_elements`                                        | Returns interactive elements with coordinates    |
| Check console errors      | `chrome_console` (mode: snapshot, onlyErrors: true)                      | Snapshot of current errors                       |
| Monitor console over time | `chrome_console` (mode: buffer) → wait → `chrome_console` (buffer: read) | Persistent collection                            |
| Search browsing history   | `chrome_history`                                                         | Supports keywords and time range                 |
| Find bookmarks            | `chrome_bookmark_search`                                                 | Search all bookmarks by keyword                  |

### Page Interaction

| Scenario                    | Tools                                                                     | Notes                                          |
| --------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| Fill and submit login form  | `chrome_read_page` → `chrome_fill_or_select` × N → `chrome_click_element` | Read form structure, fill fields, click submit |
| Search box input            | `chrome_fill_or_select` → `chrome_keyboard` (key: Enter)                  | Type text then press Enter                     |
| Select dropdown option      | `chrome_fill_or_select` (selector, value)                                 | Set select element value directly              |
| Upload a file               | `chrome_upload_file` (selector, filePath)                                 | Set file input via CDP                         |
| Handle alert/confirm dialog | `chrome_handle_dialog` (action: accept/dismiss)                           | Must call while dialog is showing              |
| User-assisted element pick  | `chrome_request_element_selection`                                        | Wait for user to physically click              |

### Navigation & Tab Management

| Scenario                       | Tools                                            | Notes                             |
| ------------------------------ | ------------------------------------------------ | --------------------------------- |
| Open page and verify load      | `chrome_navigate` (url) → `get_windows_and_tabs` | Navigate then confirm page loaded |
| Open in new window             | `chrome_navigate` (url, newWindow: true)         | Doesn't affect current window     |
| Batch open pages in background | `chrome_navigate` (url, background: true) × N    | Opens without stealing focus      |
| Browser back/forward           | `chrome_navigate` (url: "back"/"forward")        | Replaces old go_back_or_forward   |
| Close specific tabs            | `chrome_close_tabs` (tabIds)                     | Close by ID                       |
| Switch to a tab                | `chrome_switch_tab` (tabId)                      | Focus a specific tab              |

### Debugging & Performance

| Scenario                 | Tools                                                                                          | Notes                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Capture network traffic  | `chrome_network_capture` (start) → actions → `chrome_network_capture` (stop)                   | Start, interact, then stop to get results |
| Get response bodies      | `chrome_network_capture` (start, needResponseBody: true) → ... → stop                          | Uses Debugger API                         |
| Send custom HTTP request | `chrome_network_request` (url, method, headers, body)                                          | With browser cookies                      |
| Performance analysis     | `performance_start_trace` → actions → `performance_stop_trace` → `performance_analyze_insight` | Full trace workflow                       |
| Wait for download        | `chrome_handle_download`                                                                       | Monitor browser download events           |

### Screenshots & Recording

| Scenario                    | Tools                                                                  | Notes                           |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| Screenshot current page     | `chrome_screenshot`                                                    | Full page by default            |
| Screenshot specific element | `chrome_screenshot` (selector)                                         | Target by CSS selector          |
| Record browser activity     | `chrome_gif_recorder` (start) → actions → `chrome_gif_recorder` (stop) | Records as animated GIF         |
| Execute JavaScript          | `chrome_javascript` (code)                                             | Run custom code in page context |

### Background Mode (`background: true`)

Some tools support a `background` parameter that avoids stealing window focus or activating the target tab. This is useful for automated workflows that should not interrupt the user.

| Tool                 | `background` | How it works                                                                                                                                                                          |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chrome_navigate`    | Yes          | Opens / navigates tabs without activating or focusing the window.                                                                                                                     |
| `chrome_computer`    | Yes          | CDP-based actions (click, scroll, type, key, hover, drag) operate via the debugger protocol — no tab focus needed. `screenshot` uses CDP `Page.captureScreenshot` in background mode. |
| `chrome_screenshot`  | Yes          | Viewport capture via CDP instead of `captureVisibleTab`; full-page and selector captures still need the tab visible.                                                                  |
| `chrome_console`     | Yes          | CDP console capture without activating the tab.                                                                                                                                       |
| `chrome_web_fetcher` | Yes          | Fetches page content without focusing.                                                                                                                                                |

Tools **not** listed above (e.g. `chrome_switch_tab`, `chrome_network_capture`, `chrome_gif_recorder`) always operate in the foreground.

This API provides browser automation, performance tooling, media capture, and unified network inspection for agent workflows.
