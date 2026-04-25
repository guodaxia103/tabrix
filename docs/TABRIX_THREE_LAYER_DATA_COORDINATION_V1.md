# Tabrix Three-Layer Structure × DOM JSON × Markdown × API Data Coordination v1

> **Status**: v1 rule document. Defines how the `summary / overview / detail` structure should coordinate with Tabrix's data sources.
> **Scope tier**: Internal product and architecture rule. This document does not change any public MCP contract by itself.
> **Companion docs**:
>
> - [`TASK_ROADMAP.md`](./TASK_ROADMAP.md)
> - [`B_018_CONTEXT_SELECTOR_V1.md`](./B_018_CONTEXT_SELECTOR_V1.md)

---

## 1. Why This Document Exists

Tabrix now has the beginnings of two different but related capabilities:

1. A **three-layer task view** on top of `read_page`:
   - `L0` = summary
   - `L1` = overview
   - `L2` = detail entrypoint
2. Multiple **underlying data sources**:
   - DOM semantic JSON (`read_page` default path)
   - future DOM Markdown (`read_page(render='markdown')`)
   - API Knowledge capture (`knowledge_api_endpoints`, capture-only in v1)

Without an explicit coordination rule, these can drift into three bad outcomes:

- the same page is described three times in different formats
- the planner picks the wrong source for the task
- API data and DOM state get mixed together in ways that break execution correctness

This document defines the intended separation:

> **The three-layer structure is the upper-level understanding and routing protocol.**
>
> **DOM JSON, Markdown, and API data are lower-level detail sources.**

The goal is not "more formats." The goal is:

- lower token cost
- clearer task framing
- better source selection
- safer execution against the real visible page

---

## 2. Core Principle

Tabrix should not treat:

- DOM JSON,
- DOM Markdown,
- API data,

as competing representations of the same page.

Instead:

- **L0 / L1 / L2 answer _how much_ context the caller needs**
- **DOM JSON / Markdown / API data answer _where_ that context should come from**

In short:

- **Three-layer structure = progressive disclosure**
- **Data-source choice = execution and reading strategy**

---

## 3. Separation of Responsibilities

### 3.1 Three-Layer Structure

The three-layer structure owns **task-oriented framing**.

#### `L0` — Summary

Purpose:

- identify what the page is
- state the likely task framing
- point the caller to the current focus

It should answer:

- "What kind of page am I on?"
- "What is the shortest safe reading of the page for the current task?"

`L0` must stay short and anchored in observable signals. It is not free-form narrative.

#### `L1` — Overview

Purpose:

- list the main objects, actions, and regions worth considering
- expose the primary paths the caller can take next

It should answer:

- "What are the top actionable or inspectable things here?"
- "Which detail channels are worth expanding?"

`L1` is the bridge between page understanding and action planning.

#### `L2` — Detail Entrypoint

Purpose:

- expose where deeper detail can be pulled from
- identify the best detail source for the next step

It should answer:

- "If I need more detail, which source should I open?"
- "Should I expand DOM detail, readable Markdown, or API-backed structure?"

`L2` is not "more text." It is a controlled deepening contract.

### 3.2 Data Sources

The data sources own **detail fidelity**, not top-level framing.

#### DOM semantic JSON

Primary use:

- execution
- visible-page truth
- interactive elements
- stable refs / candidate actions / verifier inputs

This is the default source for action-heavy pages.

#### DOM Markdown

Primary use:

- low-token reading
- long textual pages
- content-heavy pages where structure matters more than interaction density

This is the preferred source for human-readable page comprehension when action precision is not the first concern.

#### API data / API Knowledge

Primary use:

- structured list/detail data
- pagination / filtering / sort awareness
- data-first SPAs where the DOM is only a projection of underlying structured records

This is the preferred source for understanding data shape, not for asserting what the user can physically click right now.

---

## 4. Hard Invariants

These are the rules Tabrix should hold even as the implementation evolves.

### 4.1 DOM is the source of visible execution truth

If the task is:

- click
- fill
- verify navigation
- verify visible state
- decide whether an element is actually actionable

then the final authority is the **visible DOM / semantic page state**, not API data.

API data may explain the page. It does not replace what is visibly present and interactable.

### 4.2 API data is the source of structured data truth

If the task is:

- inspect a list schema
- understand fields in rows
- reason about pagination or filters
- understand whether the site has an underlying structured entity model

then API data may be the better detail source than DOM.

DOM may still be used to validate whether the corresponding structure is surfaced to the user.

### 4.3 Markdown is for efficient reading, not action precision

Markdown should be treated as a **reading surface**, not an execution surface.

It is appropriate for:

- long docs
- dense textual detail
- content pages
- first-pass inspection of text-heavy regions

It is not the primary source for:

- click targeting
- locator resolution
- form interaction
- exact visible state verification

### 4.4 `L0` must not become synthetic fiction

`L0` can compress. It cannot invent.

The summary must be grounded in observable signals such as:

- `pageRole`
- `primaryRegion`
- top `highValueObjects`
- visible candidate actions
- known family priors

It must not turn into a self-referential text layer that hides regressions in the underlying page understanding.

### 4.5 `L2` must route, not dump

`L2` should not mean:

- "include everything else"
- "append a full dump"
- "repeat the whole page in a different format"

`L2` should mean:

- expose detail refs
- expose expansions
- indicate the preferred next source
- set a clear boundary for deeper reads

---

## 5. Coordination Rules by Layer

### 5.1 `L0` coordination rules

`L0` should:

- primarily use page-level DOM/semantic signals
- optionally acknowledge the existence of API-backed structure
- avoid field-level API detail
- avoid long textual payloads

Good `L0` examples:

- "search view for issues_list; focus on Issues, Labels, Assignee"
- "monitor view for workflow_run_detail; focus on Summary, Jobs, Logs"

Bad `L0` examples:

- replaying a long generated paragraph
- embedding raw API field names
- listing more than a handful of objects

### 5.2 `L1` coordination rules

`L1` should:

- expose top objects and candidate actions
- name likely deepening channels
- tell the caller whether the next useful detail is:
  - DOM JSON
  - DOM Markdown
  - API-backed structure

`L1` is where Tabrix should start making the source tradeoff legible.

Example:

- "Top objects: Issues, Pull requests, Actions. Candidate actions: 5. Preferred detail source: DOM JSON for navigation; API Knowledge available for list schema."

### 5.3 `L2` coordination rules

`L2` should surface detail entrypoints like:

- `dom_json_ref`
- `markdown_ref`
- `artifact_ref`
- `knowledge_ref`
- future `api_call_ref` only once call-side capability actually exists

`L2` should also expose the allowed expansions, for example:

- `interactive_elements`
- `candidate_actions`
- `dom_snapshot`
- future `readable_markdown`
- future `api_shape`

The important rule:

> **`L2` tells the caller how to go deeper without forcing all depth up front.**

---

## 6. Coordination Rules by Task Type

### 6.1 Navigation and interaction tasks

Examples:

- open Issues
- click Actions
- fill a search box

Preferred stack:

1. `L0` for task framing
2. `L1` for top objects / candidate actions
3. DOM semantic JSON for actual execution

Markdown is secondary. API data is supportive, not authoritative.

### 6.2 Text-heavy reading tasks

Examples:

- summarize a long document
- inspect a README-like page
- review a large text body before acting

Preferred stack:

1. `L0` for page framing
2. `L1` for main regions
3. Markdown as the preferred detail source

DOM JSON remains available for action follow-up, but not as the primary reading payload.

### 6.3 Structured list / table / dashboard tasks

Examples:

- inspect issue rows
- understand filter dimensions
- reason about workflow runs
- review a data-heavy SPA list

Preferred stack:

1. `L0` for page/task framing
2. `L1` for top objects and current list affordances
3. API Knowledge or API-backed structure when available
4. DOM JSON to validate visible row actions and user-facing controls

This is the clearest case where DOM and API data must cooperate instead of compete.

### 6.4 Mixed tasks

Examples:

- "find the failed workflow and open its logs"
- "identify the issue row for label X and open it"

Preferred stack:

1. `L0` = task framing
2. `L1` = shortlist main objects and possible routes
3. API structure may help narrow the data set
4. DOM JSON remains the execution truth for the actual click/open step

---

## 7. Current Repo State vs Target State

### 7.1 Landed today

At the time of writing:

- `L0 / L1 / L2` exist in the `read_page` contract and are emitted by the task protocol layer
  (`packages/shared/src/read-page-contract.ts`).
- `read_page` still defaults to DOM/semantic JSON as the practical execution detail source —
  HVOs / candidateActions / `targetRef` remain the click-resolution truth (§4.1).
- `read_page(render='markdown')` is **landed** as a reading surface (V23-03 / B-015):
  `ReadPageRenderMode = 'json' | 'markdown'` in the contract, Markdown projection emitted
  from the same final HVO + interactive lists in
  `app/chrome-extension/entrypoints/background/tools/browser/read-page.ts`. The Markdown
  payload is intentionally ref-free so it cannot be misused as an execution surface (§4.3).
- `L2` source routing is **landed** at the contract surface: `domJsonRef`, `markdownRef`,
  and `knowledgeRef` (placeholder for future API Knowledge structured-data detail) let
  upstream planners pick the right detail source instead of dumping all three
  (`packages/shared/src/read-page-contract.ts` + `read-page-l2-source-routing.test.ts`).
- API Knowledge v1 is landed as capture-only (`knowledge_api_endpoints`), GitHub-first.
- `tabrix_choose_context` v1 is landed and now routes among **at least four** strategies:
  - `experience_reuse`
  - `knowledge_light`
  - `read_page_required` (DOM/JSON fallback)
  - `read_page_markdown` (V23-03; gated on `siteFamily === 'github'` + a hand-curated
    `MARKDOWN_FRIENDLY_PAGE_ROLES` whitelist; falls back to `read_page_required` for
    actuation)

### 7.2 Not landed yet

- `knowledge_call_api` is still deferred.
- `L2` is still an entrypoint skeleton, not a fully family-aware deep reader (the
  `markdownRef` / `domJsonRef` / `knowledgeRef` slots exist, but the chooser-side rules
  that select between them on non-GitHub families are not yet there).
- There is not yet a formal runtime rule engine that says "simple page = 1 layer, medium
  = 2 layers, complex = 3 layers." Today the three-layer dispatch in §11 is a **product
  rule with partial runtime backing** (markdown branch + L2 source routing surface), not a
  fully enforced runtime contract.

### 7.3 Implication

Today, Tabrix has:

- the beginning of the **three-layer protocol**
- the beginning of the **multi-source data model**

What is still missing is the complete runtime coordination logic between them.

---

## 8. Product Direction for v1

The correct v1 product posture is:

> **Three-layer structure should be the stable upper protocol.**
>
> **DOM JSON, Markdown, and API data should be pluggable detail sources selected by task and page type.**

This implies four practical design choices:

1. Do not collapse everything into DOM JSON forever.
2. Do not let API data bypass visible-page execution truth.
3. Do not make Markdown the default for action-heavy pages.
4. Do not require all three sources to be present before the protocol is useful.

The protocol should degrade gracefully:

- Markdown is landed as a **reading** surface (`render='markdown'`); for action-heavy
  pages or non-whitelisted families, `L2` still points to DOM JSON as execution truth
  (`markdownRef` may be `null` while `domJsonRef` is the only populated slot).
- API capture is landed but `knowledge_call_api` is not; on sites without usable
  `knowledge_api_endpoints`, `L2` stays DOM-first and `knowledgeRef` is `null`.
- simple page → `L0/L1` may be sufficient; the chooser is not required to populate all
  three `L2` source slots before the protocol is useful.

---

## 9. Non-Goals

This document does not define:

- a new MCP tool
- a public contract change
- a mandatory three-layer output for every page
- `knowledge_call_api`
- a complete family-aware deep-read system
- a replacement for the existing `read_page` task protocol

It only defines the coordination rule that future work should follow.

---

## 10. Short Operational Rule

When in doubt, Tabrix should follow this order:

1. Use **`L0`** to say what the page is and what the task should focus on.
2. Use **`L1`** to list the top objects/actions and indicate which detail source is most appropriate.
3. Use **`L2`** to expose the next controlled expansion path.
4. Use **DOM JSON** for execution truth.
5. Use **Markdown** for efficient reading.
6. Use **API data** for structured data truth.

Or, in one sentence:

> **Tabrix should understand pages in layers and deepen by source, not dump every source at once.**

---

## 11. Layer Dispatch Rules v1

This section defines the **product rule**, not a mandatory runtime implementation.

The purpose is to answer:

- when `L0` alone is enough
- when `L0 + L1` should be returned as the working set
- when the caller should explicitly deepen into `L2`

### 11.1 One-layer mode: `L0` only

Use one-layer mode when all of the following are true:

- the page is simple and has a single dominant task
- the current user goal is narrow
- there is no immediate need to inspect multiple objects or branches
- deeper detail would mostly repeat what is already obvious

Typical cases:

- simple confirmation pages
- login gates
- single-purpose landing or handoff pages
- obvious "go here next" pages

Operational rule:

- return `L0` as the main working answer
- keep `L1` and `L2` available in contract terms if the runtime already emits them
- the caller should behave as if `L0` is sufficient unless the task broadens

### 11.2 Two-layer mode: `L0 + L1`

Use two-layer mode when:

- the page has several meaningful objects or actions
- the task needs a shortlist before acting
- the user is deciding among a few plausible paths
- the page is interactive but not yet detail-heavy

Typical cases:

- repo home pages
- issue lists
- actions lists
- dashboard pages with a few primary modules

Operational rule:

- `L0` frames the page and the immediate task
- `L1` enumerates top objects, regions, and candidate actions
- do not deepen into `L2` unless:
  - the user asks for more detail
  - the top path is ambiguous
  - execution needs a more precise source choice

### 11.3 Three-layer mode: `L0 + L1 + L2`

Use three-layer mode when any of the following is true:

- the page is structurally complex
- the task mixes reading and interaction
- the page contains high-density text, tables, or nested modules
- the caller must choose among multiple detail sources
- the next step depends on whether DOM, Markdown, or API-backed detail is the better expansion path

Typical cases:

- workflow run detail pages
- data-heavy list/detail SPAs
- complex dashboards
- pages where the user needs "summary first, then overview, then selective drill-down"

Operational rule:

- `L0` tells the caller what this page is and what matters now
- `L1` surfaces the top objects and near-term actions
- `L2` explicitly routes the caller to the right deeper source instead of forcing a dump

### 11.4 User-intent override rules

Layer selection should not be driven only by page complexity. It should also respect user demand.

If the user asks for:

- "先说重点" / "give me the gist" -> prefer one-layer mode
- "先概览一下再决定" -> prefer two-layer mode
- "展开细看" / "drill into details" -> prefer three-layer mode
- "直接帮我点" / immediate execution -> use the smallest layer set that still supports safe action, usually `L0 + L1`

In short:

- page complexity sets the default
- user intent can request shallower or deeper handling

### 11.5 Source preference by layer

The dispatch rule also controls which source should dominate each layer.

#### `L0`

Prefer:

- DOM semantic understanding
- page role
- primary region
- top high-value objects

Avoid:

- raw Markdown payload
- field-heavy API structure

#### `L1`

Prefer:

- top objects and candidate actions from DOM/semantic understanding
- light indication of whether Markdown or API structure is the better next source

Avoid:

- deep dumps
- full list serialization

#### `L2`

Prefer:

- explicit source routing:
  - DOM JSON for execution truth
  - Markdown for reading-heavy detail
  - API data for structured data detail

Avoid:

- returning all three sources in full by default

### 11.6 Current-state interpretation

Because the full runtime rule engine is not landed yet, the practical v1 interpretation is:

- simple page -> act as if `L0` is primary
- medium page -> act as if `L0 + L1` are primary
- complex page -> act as if `L0 + L1 + L2` are primary

This is the product rule future implementations should converge to. Parts of the runtime
have already started landing — notably `read_page(render='markdown')` (V23-03 / B-015) and
the `tabrix_choose_context` Markdown branch — but neither makes the §11 dispatch a
mandatory runtime contract; they just make the `L2`-by-source story executable on the
GitHub-family reading paths.

It is **not** a claim that every current runtime path already enforces this perfectly.
