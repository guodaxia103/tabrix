# Memory Phase 0.3 — DOM action history

**Status**: merged into `main` (PR pending)
**Owners**: Tabrix MKEP squad
**Delivers**: `memory_actions` SQLite table, `memory://action/<uuid>` URI, post-processor coverage for
`chrome_click_element` / `chrome_fill_or_select` / `chrome_navigate` / `chrome_keyboard`, plus
`pre_snapshot_ref` linkage between actions and the most recent `memory_page_snapshots` row.

## 1. Motivation

Phase 0.2 landed page-snapshot persistence. Every `chrome_read_page` response now synthesizes a
`memory://snapshot/<uuid>` that is stable across sessions. Phase 0.3 closes the next half of the
MKEP Memory closed-loop:

> **snapshot → action → snapshot** evidence graph.

Without persisted actions, the Memory store knows what the page looked like but not what the agent
did next. Phase 0.3 captures every DOM-interaction tool call alongside the snapshot that informed
it, so later phases (Experience aggregation, adaptive Policy) can compute things like _"which
selector worked 9/10 times after that snapshot"_ or _"this task usually completes in 3.2 actions"_
without replaying the whole browser session.

## 2. Scope

In scope (four core DOM action tools):

| Tool                    | `action_kind` |
| ----------------------- | ------------- |
| `chrome_click_element`  | `click`       |
| `chrome_fill_or_select` | `fill`        |
| `chrome_navigate`       | `navigate`    |
| `chrome_keyboard`       | `keyboard`    |

Out of scope (deferred to a possible Phase 0.4 "shell actions" table):

- `chrome_switch_tab`, `chrome_close_tabs` — tab-shell events, not DOM interactions.
- `chrome_computer` — P3 fallback, not part of the Phase 0.3 `ACTION_KIND_BY_TOOL` map.

`chrome_back` / `chrome_forward` / `chrome_refresh` / opening a new tab are all represented inside
`chrome_navigate`; they collapse into the `navigate_mode` column (`url` / `refresh` / `back` /
`forward` / `new_tab`).

## 3. Data model

### 3.1 `memory_actions`

See `app/native-server/src/memory/db/schema.ts`. Highlights:

- `action_id` PK, `step_id` FK → `memory_steps` (`ON DELETE CASCADE`), `session_id` FK →
  `memory_sessions` (same cascade).
- **Stable columns**: `tool_name`, `action_kind`, `navigate_mode`, `tab_id`, `window_id`,
  `target_ref`, `target_selector`, `target_frame_id`, `url_requested`, `url_before`, `url_after`,
  `key_spec`, `value_summary`, `status`, `error_code`, `pre_snapshot_ref`, `captured_at`.
- **Blob columns**: `args_blob` (sanitized args JSON), `result_blob` (raw extension body; `NULL`
  for `fill`).
- Indexes on `step_id`, `session_id`, `action_kind`, `captured_at`.

`status` enum: `success` | `failed` | `soft_failure`.

- `success`: `isError: false` and (when body is JSON) `body.success !== false`.
- `failed`: `isError: true` (plain-text error body; produced by `createErrorResponse`).
- `soft_failure`: `isError: false` but JSON body has `"success": false` (e.g. click/fill on
  unsupported page per `interaction.ts:105-132`).

### 3.2 Snapshot lookup index

We also added a companion index on `memory_page_snapshots(tab_id, captured_at)` to make the
session-scoped "latest snapshot for this tab" query (new on `PageSnapshotRepository`) cheap.

## 4. URI scheme

```text
memory://snapshot/<uuid>     # Phase 0.2
memory://action/<uuid>       # Phase 0.3
```

Both are minted server-side. The `historyRef` is:

1. Returned as an extra `artifactRef` on the owning `ExecutionStep`.
2. Injected into the JSON body of the tool's `CallToolResult` (under `historyRef`) so MCP clients
   can thread the identifier into their own traces without waiting for a second read.

When the body is not JSON (typical of `isError: true` plain-text error responses), the `historyRef`
is still attached to the step's `artifactRefs` — inline injection is simply skipped.

## 5. Sensitive value handling

`chrome_fill_or_select` is the only action tool that carries user-provided plaintext. Phase 0.3's
contract is strict:

- **`value_summary`** — only column touching the plaintext — stores a redaction record:
  ```json
  { "kind": "redacted", "type": "string", "length": 12, "sha256": "…" }
  ```
  No prefix / preview / selector-based heuristic. If the plaintext ever needs to be re-verified,
  `sha256` is sufficient; otherwise it stays out of the database.
- **`args_blob`** — the incoming `value` field is replaced with the string `"[redacted]"` **before**
  JSON serialization. Other args (tab/frame/selector/ref) are preserved.
- **`result_blob`** — omitted entirely for `fill`. The extension's success message
  (`"Filled input#user with value '…'"`) may echo plaintext; conservative default is to drop the
  whole body.

Future-work hook: add a `Policy`-controlled setting to store hashed-only vs. fully-elided result
bodies for non-fill tools. Out of scope for Phase 0.3.

## 6. `pre_snapshot_ref` linkage

When recording an action, `ActionService.recordFromToolCall` asks the `PageSnapshotRepository` for
the most recent snapshot **in the current session, for the same `tabId`, captured at or before the
action timestamp**. Design call-out:

- Scope is **session-local**, not cross-session, to avoid binding stale pages from other tasks to a
  new run (see `.tmp/memory-phase-0-3/outputs/action-tools.md §3`).
- No snapshot → `pre_snapshot_ref = NULL`. Callers must treat absence as "agent chose to act without
  a prior read" (totally legitimate for `chrome_navigate` at the start of a task).

SQL (prepared once, `PageSnapshotRepository#findLatestInSessionForTabStmt`):

```sql
SELECT s.*
FROM memory_page_snapshots s
JOIN memory_steps st ON st.step_id = s.step_id
WHERE s.tab_id = @tab_id
  AND st.session_id = @session_id
  AND s.captured_at <= @before_iso
ORDER BY s.captured_at DESC
LIMIT 1;
```

## 7. Post-processor integration

Phase 0.2 introduced a tool-name-keyed registry in
`app/native-server/src/mcp/tool-post-processors.ts`. Phase 0.3 extends it with **one** new
processor (`chromeActionPostProcessor`) wired to all four action tools via a
`ACTION_KIND_BY_TOOL`-driven spread:

```ts
export const TOOL_POST_PROCESSORS: Partial<Record<string, ToolPostProcessor>> = {
  chrome_read_page: chromeReadPagePostProcessor,
  ...Object.fromEntries(
    Object.keys(ACTION_KIND_BY_TOOL).map((toolName) => [toolName, chromeActionPostProcessor]),
  ),
};
```

`ToolPostProcessorContext` gains a required `sessionId` field so the processor can scope
snapshot lookups without a second `memory_steps` round trip. Both success paths in
`handleToolCall` (dynamic flow proxy + normal extension invocation) now pass
`sessionId: session.sessionId`.

### Failure matrix

| Condition                                       | Action row     | `historyRef` attached? | Inline body injection? | Main tool result                     |
| ----------------------------------------------- | -------------- | ---------------------- | ---------------------- | ------------------------------------ |
| Happy path, JSON body                           | `success`      | yes                    | yes                    | mutated (adds `historyRef` field)    |
| Happy path, JSON body, `body.success === false` | `soft_failure` | yes                    | yes                    | mutated                              |
| `isError: true`, plain-text body                | `failed`       | yes                    | no (not JSON)          | unchanged                            |
| Persistence off (`TABRIX_MEMORY_PERSIST=false`) | —              | no                     | no                     | unchanged                            |
| DB write throws (FK missing, etc.)              | —              | no                     | no                     | unchanged; one `console.warn` logged |
| Tool is not in `ACTION_KIND_BY_TOOL`            | —              | no                     | no                     | unchanged                            |

No failure mode causes `handleToolCall` to throw or to return a different error to the MCP client.
Memory bookkeeping is strictly additive.

## 8. Tests

New coverage lives next to the code:

- `app/native-server/src/memory/db/action-repository.test.ts` — round-trip, FK cascade, ordering,
  `clear()`.
- `app/native-server/src/memory/db/page-snapshot-repository.test.ts` — three new cases covering
  `findLatestInSessionForTab` (cutoff, cross-session exclusion, miss).
- `app/native-server/src/memory/action-service.test.ts` — `ACTION_KIND_BY_TOOL` coverage, fill
  redaction invariants, navigate-mode classification, failed/soft-failure statuses, DB-write
  failure degradation.
- `app/native-server/src/mcp/tool-post-processors.test.ts` — registry wiring, inline injection,
  plain-text error path still records a row, persistence-off degradation.
- `app/native-server/src/mcp/register-tools.test.ts` — two end-to-end cases covering
  `chrome_click_element` historyRef injection and `chrome_fill_or_select` redaction guarantees.

Total after Phase 0.3: 160 tests across 27 suites.

## 9. Open questions, deferred

1. **Action deduplication.** Recording every attempt keeps the original execution sequence, which
   we want for replay/debug. Deduplication (or summary rows) belongs in the future Experience
   layer, not Memory.
2. **`post_snapshot_ref`.** Phase 0.3 only captures `pre_snapshot_ref`. An auto-`chrome_read_page`
   after `chrome_navigate` is attractive but adds a second tool call per action; deferred to
   Phase 0.4+ with opt-in.
3. **Shell actions table.** `chrome_switch_tab` and `chrome_close_tabs` will live in a separate
   `memory_shell_actions` table if demand materializes; keeping them out of `memory_actions`
   preserves the DOM-interaction purity of the current table.
4. **Policy coupling.** All four tools are P0-P2 per `TOOL_RISK_TIERS`; Policy Phase 0 does not gate
   them. When Policy Phase 1 lands (adaptive risk), the recorded action history becomes the
   natural input for "has this selector worked before on this site?" evidence.
