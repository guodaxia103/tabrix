# MKEP Memory Phase 0.2 — `historyRef` + `memory_page_snapshots`

Status: implemented
Scope: `app/native-server` only. No extension changes.
Depends on: [Memory Phase 0.1](./MEMORY_PHASE_0.md).

## Why

Phase 0.1 made `SessionManager` persistent. But the read-page contract
still emitted `historyRef: null` and `artifactRefs` carried only
volatile `artifact://read_page/...` refs, so downstream tools and the
LLM had nothing stable to point at when recalling "the page I just
saw". Phase 0.2 closes that gap with the minimum necessary state.

## Non-goals

- Recording `chrome_click_element` / `chrome_navigate` actions. That
  is Phase 0.3.
- Cross-call deduplication. Phase 0.2 is append-only.
- Full-page content persistence. The extension already emits a
  `dom_snapshot` artifact ref; storing the page body a second time
  would double the volume without adding Memory value. Phase 0.2
  deliberately keeps only structured, query-friendly fields.
- A Memory query tool (CLI / MCP). That arrives in Phase 1.

## Architecture decision

**The snapshot is produced and persisted on the native-server side,
not the extension.** Rationale:

1. Extension is sandboxed; SQLite lives on the server.
2. The tool-call response already passes back through the native
   server on its way to the MCP client, so a post-processor in
   `handleToolCall` has the raw body and the owning `step_id` in hand.
3. Keeps `chrome_read_page` extension code purely deterministic. The
   existing response contract (`historyRef: string | null`) is
   honored: Memory fills it in when available, otherwise `null`.

Injection point: `app/native-server/src/mcp/register-tools.ts` inside
`handleToolCall`, **after** `response.status === 'success'` and
**before** `normalizeToolCallResult` / `completeStep`. This is the
single point where both raw result mutation and artifact-ref
propagation are possible, and it already exists on both the dynamic
flow success path and the regular tool success path.

## Components

```
packages/shared/src/read-page-contract.ts           (unchanged — historyRef field was already there)
app/native-server/src/memory/db/schema.ts           +memory_page_snapshots DDL
app/native-server/src/memory/db/page-snapshot-repository.ts  (new)
app/native-server/src/memory/page-snapshot-service.ts         (new)
app/native-server/src/execution/session-manager.ts  +pageSnapshots getter, reset extended
app/native-server/src/mcp/tool-post-processors.ts   (new)
app/native-server/src/mcp/register-tools.ts         +runPostProcessor on both success paths
```

## Schema

```sql
CREATE TABLE memory_page_snapshots (
  snapshot_id               TEXT PRIMARY KEY,
  step_id                   TEXT NOT NULL REFERENCES memory_steps(step_id) ON DELETE CASCADE,
  tab_id                    INTEGER,
  url                       TEXT,
  title                     TEXT,
  page_type                 TEXT,
  mode                      TEXT,
  page_role                 TEXT,
  primary_region            TEXT,
  quality                   TEXT,
  task_mode                 TEXT,
  complexity_level          TEXT,
  source_kind               TEXT,
  fallback_used             INTEGER DEFAULT 0,
  interactive_count         INTEGER DEFAULT 0,
  candidate_action_count    INTEGER DEFAULT 0,
  high_value_object_count   INTEGER DEFAULT 0,
  summary_blob              TEXT,
  page_context_blob         TEXT,
  high_value_objects_blob   TEXT,
  interactive_elements_blob TEXT,
  candidate_actions_blob    TEXT,
  protocol_l0_blob          TEXT,
  protocol_l1_blob          TEXT,
  protocol_l2_blob          TEXT,
  captured_at               TEXT NOT NULL
);
```

Indexes: `step_id`, `url`, `page_role`, `captured_at`.

**Trimming rules** (inside `buildSnapshotFromReadPageBody`):

- `interactiveElements` → first 24 entries only.
- `highValueObjects` → only `id/kind/label/ref/role/actionType/confidence/objectType/objectSubType/region/importance/sourceKind` (drop `reasons[]`, `actions[]`).
- `fullSnapshot.*`, `memoryHints`, `frameContext`, `diagnostics.tips` → dropped entirely (either XL or currently unused).

## `historyRef` format

`memory://snapshot/<uuid>` — distinct from the extension-side
`artifact://read_page/...` namespace to keep Memory / Artifact
registries orthogonal, and consistent with future Phase 0.3
`memory://action/<uuid>` and Phase 1 `memory://thread/<uuid>`.

## Post-processor contract

```ts
type ToolPostProcessor = (ctx) => { rawResult; extraArtifactRefs };
```

Guarantees:

- **Never throws.** Any failure (JSON parse, DB write, unexpected
  shape) is caught, logged at `warn`, and returns `{ rawResult:
inputResult, extraArtifactRefs: [] }`.
- **Never mutates the input `CallToolResult`.** Injection clones the
  outer object and the first content block before rewriting the text.
- **Zero cost** when no processor is registered for the tool name.

Registered processors for Phase 0.2: `chrome_read_page` only.

## Backward compatibility

- No public API change on `SessionManager`. Existing tests still pass
  unchanged (110/110, 76 pre-existing + 20 from Phase 0.1 + 14 new).
- MCP client sees the same `CallToolResult` shape for
  `chrome_read_page`; only the JSON body gains a populated `historyRef`
  where previously it was `null`. This was already a string-or-null
  field in the contract, so no consumer has to update.
- When Memory is disabled (`TABRIX_MEMORY_PERSIST=false` or DB init
  fails), post-processor short-circuits to `extraArtifactRefs: []`
  and `historyRef` stays `null`. Identical behavior to pre-0.2.

## Failure matrix

| Failure                                        | Effect on tool result | Effect on step       |
| ---------------------------------------------- | --------------------- | -------------------- |
| Memory off (`persistenceEnabled=false`)        | Unchanged             | `artifactRefs` empty |
| DB write failure (FK, unique, corruption, ...) | Unchanged             | `artifactRefs` empty |
| Non-JSON body (e.g. `{text: 'ok'}` in tests)   | Unchanged             | `artifactRefs` empty |
| Unexpected content shape                       | Unchanged             | `artifactRefs` empty |

In every failure path, a single `console.warn` line is emitted and
control returns to the regular `completeStep` / `finishSession`
flow. The main tool result path is never blocked.

## Tests

- `memory/db/page-snapshot-repository.test.ts` — 4 tests (round-trip,
  order-by-captured-at, FK enforcement, clear).
- `memory/page-snapshot-service.test.ts` — 5 tests (field extraction
  incl. slimming, persistence round-trip, non-JSON body, missing
  content, DB write failure).
- `mcp/tool-post-processors.test.ts` — 4 tests (no-op for unrelated
  tools, happy-path injection, Memory-off degradation, non-JSON
  degradation).
- `mcp/register-tools.test.ts` — added one new end-to-end test
  (`persists a page snapshot and injects historyRef for
chrome_read_page`) that drives `handleToolCall` through a mocked
  extension response and asserts both the injected `historyRef` and
  the new `artifactRefs` propagation.

## Open questions (future phases)

1. Should we add a `content_hash` column for Phase 0.3 soft
   deduplication? Currently not needed.
2. Should `interactiveElements` cap be per-mode (24 / 80 / 80) instead
   of a flat 24? Current flat cap favors Memory compactness.
3. When to introduce a `memory://thread/<uuid>` that joins multiple
   snapshots for the same navigation intent? Phase 1.
