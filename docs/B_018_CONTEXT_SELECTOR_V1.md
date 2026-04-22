# B-018 · `tabrix_choose_context` — v1 minimal slice

> **Status (this doc):** v1 boundaries + minimum runnable contract. Owns the implementation that lands together with this file. **Not** the full Stage 3h. The full Stage 3h vision lives in [`TASK_ROADMAP.md` §9](./TASK_ROADMAP.md#9-stage-3h--context-strategy-selector); everything not listed below is intentionally deferred.
> **Scope tier:** Internal (per `PRODUCT_SURFACE_MATRIX.md` invariants — new tool ships Internal-by-default, not Beta).

---

## 1. Why a v1 slice now

Stage 3h is the largest single `省 token` lever in the planning roadmap, but the full lever depends on `B-011`, `B-013`, `B-015`, `B-017` all being **Beta**. As of 2026-04-22:

- `B-013 / experience_suggest_plan` — **landed** (read-side query against `experience_action_paths`).
- `B-017 / API Knowledge capture v1` — **landed** (capture-only, GitHub-first, capability-gated; no `knowledge_call_api`).
- `B-011 / stable targetRef` — **pool**.
- `B-015 / read_page(render='markdown')` — **pool**.

So the full Stage 3h DoD ("≥ 70% top-10 GitHub intents pick `api_only`/`experience_replay`") is not reachable yet — it would require a working call-side. A **v1 slice that admits this honestly and routes among the _currently usable_ assets** still produces real signal:

- It standardises how the upstream LLM asks "what context should I pull?" — a name, not a workflow guess.
- It refuses to invent an `api_only` strategy when no call layer exists. The mistake the planner-side wants to make today is "the network capture knows the issues endpoint, just call it" — and that's exactly what is **not** wired. Tabrix v1 says so explicitly.
- It tells us empirically which intents land in `experience_reuse` vs `knowledge_light` vs `read_page_required`. That is the data we need before deciding when to invest in `B-015` markdown vs `knowledge_call_api`.

## 2. Hard constraints we hold

These are fixed for v1. Anything wanting to relax them is v2.

1. **Tabrix is the execution layer, not an agent.** `tabrix_choose_context` returns a _strategy + reusable artifact references_. It does **not** plan steps, schedule them, or run them.
2. **Deterministic, rule-based only.** No model call. No multi-round planner. No scoring system beyond a single explicit threshold (defined in §6). Adding a second weight would already be Stage 3h-style.
3. **GitHub-first.** Same as B-017. Non-GitHub URLs fall through to `read_page_required`. Adding a second site family is v2 and requires a new capture seed first.
4. **Read-only against existing native state.** No new SQLite tables, no new write paths, no Sidepanel UI, no DOM access. Reuses `ExperienceQueryService.suggestActionPaths` (B-013) and `KnowledgeApiRepository.listBySite` (B-017) verbatim.
5. **Honest about absent capabilities.** When API Knowledge has rows but `knowledge_call_api` does not exist, the result is `knowledge_light` — never `api_only`. When `experience_replay` is not exposed, no strategy implies replay.
6. **No public schema drift beyond the new tool.** Existing tools' input/output unchanged. Only new shared types: the input/output DTOs of this tool and one new tool name.

## 3. Public input/output contract (v1)

### 3.1 Input

```ts
interface TabrixChooseContextInput {
  /**
   * Free-text intent from the upstream caller. Same shape and bucket key
   * as `experience_suggest_plan.intent` so a hit there is also a hit
   * here. Trimmed; non-empty after trim. Truncated to
   * MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS (= 1024).
   */
  intent: string;

  /**
   * Optional URL of the page the planner is reasoning about.
   * Used only to derive `siteFamily`. Unparseable string is **not**
   * an error in v1 — we just drop the URL and behave as if it were
   * omitted. (Reasoning: agents construct URLs from templates and we
   * do not want a templating bug to break context selection.)
   */
  url?: string;

  /**
   * Optional `pageRole` filter, mirroring the B-013 contract. When
   * provided we forward it to `experience_suggest_plan` to scope the
   * Experience lookup. ≤ 128 chars.
   */
  pageRole?: string;

  /**
   * Optional explicit site-family override. Currently only `'github'`
   * is recognised; other values are ignored (the tool falls back to
   * URL-derived family or `undefined`). v2 will widen this.
   */
  siteId?: 'github';
}
```

### 3.2 Output

```ts
interface TabrixChooseContextResult {
  status: 'ok' | 'invalid_input';

  /**
   * The strategy the caller should pursue first. v1 strategy set is
   * exactly three (see §5). When `status === 'invalid_input'`, this
   * is omitted along with everything else except `error`.
   */
  strategy?: ContextStrategyName;

  /**
   * Optional concrete next-step the caller should fall back to if
   * `strategy` cannot be acted on. Always one of the v1 strategy
   * names; in practice this is always `'read_page_required'` when
   * `strategy !== 'read_page_required'`, and omitted otherwise.
   */
  fallbackStrategy?: ContextStrategyName;

  /**
   * Short, human-readable rationale. Stable enough to grep in logs
   * (e.g. `"experience hit: ap-..., successRate=0.83"`). Not a UI
   * string — Sidepanel polish is v2.
   */
  reasoning?: string;

  /**
   * Reusable references the caller can pull. Always a list (possibly
   * empty). Each entry points to data already owned by the native
   * server — the planner does not have to re-discover it.
   */
  artifacts?: TabrixChooseContextArtifact[];

  /**
   * Echo of what the tool actually resolved from input. Useful for
   * debugging and for the upstream agent to confirm bucket alignment.
   */
  resolved?: {
    intentSignature: string;
    pageRole?: string;
    siteFamily?: 'github';
  };

  /**
   * Present only when `status === 'invalid_input'`.
   */
  error?: { code: string; message: string };
}

type ContextStrategyName =
  | 'experience_reuse' // B-013 plan available with successRate ≥ 0.5
  | 'knowledge_light' // API Knowledge has rows for siteFamily, but call-side absent
  | 'read_page_required'; // unconditional fallback: read_page(render='json')

interface TabrixChooseContextArtifact {
  kind: 'experience' | 'knowledge_api' | 'read_page';
  /** Stable opaque ID owned by the producing layer. */
  ref: string;
  /** Compact human-readable label, ≤ 200 chars. */
  summary: string;
}
```

### 3.3 Why no `tokenEstimate` in v1

The Stage 3h sketch reserves a `tokenEstimate` field. We deliberately drop it for v1: we have no calibration data tying a strategy name to actual MCP-side input tokens, and an _invented_ number is worse than `undefined` because the upstream planner will trust it. We add it back when the run-history table can answer "median input tokens for the last 50 calls that picked this strategy."

## 4. Capabilities consulted

| Capability                                    | Source                                                | Used for                                                      | Required for v1?   |
| --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------ |
| `experience_suggest_plan` (B-013)             | `ExperienceQueryService.suggestActionPaths`           | "Has any prior plan succeeded for this `(intent, pageRole)`?" | yes                |
| API Knowledge v1 (B-017)                      | `KnowledgeApiRepository.listBySite('api.github.com')` | "Do we have ANY captured endpoint for this site?"             | yes                |
| Capability gate (B-016)                       | `isCapabilityEnabled('api_knowledge', env)`           | API Knowledge table is meaningful only when gate is on        | yes                |
| `chrome_read_page(render='json')`             | extension-side, already exposed                       | The named v1 fallback                                         | yes                |
| `chrome_read_page(render='markdown')` (B-015) | not landed                                            | —                                                             | **deferred to v2** |
| `knowledge_call_api`                          | not landed                                            | —                                                             | **deferred to v2** |
| `experience_replay`                           | not landed                                            | —                                                             | **deferred to v2** |
| Stable `targetRef` (B-011)                    | not landed                                            | —                                                             | **deferred to v2** |

If a future capability lands, we add a new strategy name **before** we change any existing one.

## 5. Strategy set (exactly three)

1. **`experience_reuse`** — chosen when at least one `experience_suggest_plan` plan exists for `(intentSignature, pageRole?)` with `successRate ≥ 0.5`. Artifact lists the top action-path id(s) so the upstream caller can invoke the steps in `plan.steps[]` directly. `fallbackStrategy = 'read_page_required'`.

2. **`knowledge_light`** — chosen when `experience_reuse` did not fire AND `siteFamily === 'github'` AND the `api_knowledge` capability is enabled AND `KnowledgeApiRepository` has ≥ 1 captured endpoint on `api.github.com`. Artifact summarises the captured catalog (count + a few representative `endpointSignature`s) so the planner can use the catalog as **shape** evidence (e.g. "issues list lives at `GET /repos/:owner/:repo/issues`") without believing it can execute that call from inside Tabrix today. `fallbackStrategy = 'read_page_required'`.

3. **`read_page_required`** — unconditional fallback. Always a valid answer. Means "the caller should issue `chrome_read_page` (default JSON mode) on the current tab to get the snapshot." No artifacts (the snapshot doesn't exist yet — the caller produces it).

The decision tree is intentionally short:

```
parseInput()
  → if invalid: return { status: 'invalid_input', error }

→ Experience hit (with threshold)?  → 'experience_reuse'
→ Else: GitHub family + capability on + ≥1 endpoint? → 'knowledge_light'
→ Else: 'read_page_required'
```

## 6. Concrete numeric / string knobs

These are the **only** tunable values v1 introduces. They live as `const` in the shared package so the test suite and the runtime read the same number.

| Knob                                        | Value           | Notes                                                                                                       |
| ------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS`    | `1024`          | Same as B-013.                                                                                              |
| `MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS` | `128`           | Same as B-013.                                                                                              |
| `EXPERIENCE_HIT_MIN_SUCCESS_RATE`           | `0.5`           | Strictly greater-or-equal. Single threshold; do NOT add a per-bucket weight in v1.                          |
| `EXPERIENCE_LOOKUP_LIMIT`                   | `3`             | Number of plans we ask `experience_suggest_plan` for. We pick the best survivor; the rest become artifacts. |
| `KNOWLEDGE_LIGHT_SAMPLE_LIMIT`              | `5`             | Max endpoint signatures echoed in the `knowledge_light` artifact summary.                                   |
| Recognised site families                    | `'github'` only | Anything else → `siteFamily = undefined`.                                                                   |

A second knob (e.g. minimum sample count for the experience plan) is exactly the kind of complexity v1 forbids. We will only add a second knob when the run-history shows the single threshold is producing wrong picks.

## 7. Non-goals (v2 candidates, not v1)

- Cross-site selectors (Douyin, Bilibili, generic SPA). v1 returns `read_page_required` on non-GitHub URLs.
- Token cost estimate per strategy. Requires calibration data we don't have.
- A `read_page_markdown` strategy. Requires B-015 to land.
- An `experience_replay` strategy. Requires the write-side to ship and pass Policy review (Stage 3b non-`B-013` work).
- An `api_only` strategy. Requires `knowledge_call_api`, which is explicitly not v1 of B-017.
- Automatic re-ranking from outcomes. The Stage 3h vision says "next call re-ranks by success rate" — that is an outcome producer, not a context selector. v1 reuses B-013's existing success-rate column read-only; it does NOT mutate it.
- Sidepanel UI for the strategy result.

## 8. Success criteria for v1

The bar is deliberately low — we are validating a _contract_, not the strategic DoD of Stage 3h.

1. **Type contract is honoured by `tabrix_choose_context`.** Unit tests assert each strategy's output shape and the invalid-input shape against the DTO defined in `packages/shared/src/choose-context.ts`.
2. **No invented capability is named.** A unit test enumerates the strategy set and fails on any new name not listed in §5. (Prevents "we added `api_only` later, forgot it lies".)
3. **Three rule branches are exercised by tests:**
   - experience hit (one with `successRate ≥ 0.5`, one below threshold to confirm rejection).
   - knowledge_light: capability on + non-empty repo for `api.github.com`, no experience.
   - read_page_required: experience empty AND (capability off OR repo empty OR non-GitHub URL OR no URL at all).
4. **Capability gate is respected.** With `TABRIX_POLICY_CAPABILITIES` not including `api_knowledge`, even a populated `KnowledgeApiRepository` MUST yield `read_page_required` (not `knowledge_light`).
5. **No write-path side-effect.** A test calls the handler with a stub `ExperienceQueryService.suggestActionPaths` that throws if called more than once and confirms idempotent reads.
6. **Public risk tier present.** `TOOL_RISK_TIERS[TOOL_NAMES.CONTEXT.CHOOSE]` is set to `P0` (read-only, no IO).
7. **Repo-wide gates pass:** `pnpm --filter @tabrix/tabrix test` green, `pnpm -r typecheck` green, `pnpm run docs:check` green.

## 9. What changes outside this file (v1)

- `packages/shared/src/choose-context.ts` — new file. DTOs + `MAX_*` / `EXPERIENCE_HIT_MIN_SUCCESS_RATE` constants. Re-exported from `packages/shared/src/index.ts`.
- `packages/shared/src/tools.ts` — `TOOL_NAMES.CONTEXT.CHOOSE`, schema entry, `TOOL_RISK_TIERS` entry. Existing tools untouched.
- `app/native-server/src/mcp/choose-context.ts` — pure parser + chooser (no IO).
- `app/native-server/src/mcp/native-tool-handlers.ts` — registers the new handler. Adds `knowledgeApi` to the deps shape and an optional `capabilityEnv` field (defaults to `process.env`-derived).
- `app/native-server/src/mcp/choose-context.test.ts` — unit tests for the parser + chooser branches.
- `app/native-server/src/mcp/native-tool-handlers.test.ts` — wiring tests for the new handler (`knowledge_light` gating, `experience_reuse` projection, fallback shape).
- `docs/PRODUCT_BACKLOG.md`, `docs/TASK_ROADMAP.md`, `docs/TASK_ROADMAP_zh.md` — note that B-018 v1 minimal slice landed; full Stage 3h DoD still open.

No other files change.

## 10. Reviewer checklist

- [ ] Strategy names are exactly the three in §5 — no `api_only`, no `experience_replay`, no `read_page_markdown`.
- [ ] No new SQLite table, no `INSERT`/`UPDATE` anywhere in the new code paths.
- [ ] Every read goes through the existing repository methods (`suggestActionPaths`, `listBySite`) — no ad-hoc SQL.
- [ ] Capability gate is consulted for `knowledge_light`. Disabling the gate with rows present → `read_page_required`.
- [ ] Threshold value lives in the shared package, not as a magic number in the handler.
- [ ] Risk tier is `P0` and the new tool name is included in the existing tier-coverage assertion.
