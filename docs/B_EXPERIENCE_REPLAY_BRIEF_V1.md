# B-EXP-REPLAY · `experience_replay` v1 — owner-lane brief (no implementation)

> **Status (this doc):** **v1 implemented and end-to-end closed in v2.4.0 (V24-01, 2026-04-22; closeout 2026-04-23).** Owner decisions locked 2026-04-23 (now §10) shipped as-locked. The original V24-01 landing deferred replay-args capture to V24-02; the 2026-04-23 closeout instead lifts the captured `inputSummary` directly into the aggregated row for the v1 supported step kinds (`chrome_click_element` / `chrome_fill_or_select`), and tightens the chooser to refuse rows that lack `args`. Subsequent §10 follow-ups (`parent_step_id` cross-link, ranked-candidates fallback ladder, **`templateFields` capture-side write path** so substitution is meaningful — not just verbatim replay) remain v2 scope and are deferred to V24-02 / V24-03. See the §12 reviewer checklist below for the landed deltas.
> **Lane:** Owner-lane (architecture + Policy decision + new public contract).
> **Companion of:** `docs/B_018_CONTEXT_SELECTOR_V1.md` (the read-side selector v1; `experience_replay` is the **write/execute** half of the same Stage 3b loop).
> **Roadmap pointers:** `docs/TASK_ROADMAP.md` §3 Stage 3b (the producer-side write path the read-side `experience_suggest_plan` was deliberately split off from), §9 Stage 3h (the consumer-side that gets a real `'experience_replay'` strategy once this lands).
> **Backlog ID:** `B-EXP-REPLAY-V1`. New entry; appended to `docs/PRODUCT_BACKLOG.md` in the same commit as this brief.

---

## 1. Why this is a brief, not an implementation

The continuous-execution plan for v2.3.0 V23-05 (`tabrix v2.3.0 execution` plan, item `v23_05`) explicitly downgrades `experience_replay` from "implement" to "produce owner-lane brief". Three independent reasons:

1. **Public contract.** A new MCP tool means a new shared schema in `packages/shared/src/tools.ts` and a new entry in `TOOL_NAMES`. `AGENTS.md` §"Fast-lane must not do" item 3 forbids fast-lane from doing this.
2. **New risk tier classification.** `experience_replay` is the first Tabrix tool that **autonomously executes a sequence of historical actions** under a single MCP call. The right tier is not obvious — `experience_suggest_plan` is `P0` (read-only) and `chrome_click_element` is `P2`, but a tool that fires `chrome_click_element` _N_ times under one decision is not naturally either of those. Picking the tier requires a Policy review (`docs/POLICY_PHASE_0.md` §2).
3. **Capability gate decision.** `TABRIX_POLICY_CAPABILITIES` (B-016) currently has exactly one capability (`api_knowledge`). Whether to add a second (`experience_replay`) — and whether the gate is the _primary_ defense or just defense-in-depth on top of `requiresExplicitOptIn` — is a Policy decision, not a mechanical one.

So the deliverable here is an **owner-approved specification**: the owner-lane review has now been completed inside this document, and the remaining job is implementation plus verification.

Decision lock for v1:

1. **Risk tier** = `P1` + `requiresExplicitOptIn: true` + new capability `'experience_replay'`.
2. **`parent_step_id` cross-link** = defer to v2; v1 carries no `memory_steps` migration.
3. **Capability spelling** = `'experience_replay'`.
4. **Substitution whitelist** = `['queryText', 'targetLabel']`.
5. **`templateFields` schema bump** = lands in v1 as an optional per-step field.
6. **P3-specific allowlist question** = not applicable in v1 because replay is not P3.
7. **Real-browser acceptance floor** = the five scenario families in §8.3 are the feature-level minimum; version-level benchmark discipline still follows the repo-wide paired-run rules.

## 2. Hard constraints we hold

These are non-negotiable for v1. Loosening any of them is a v2 conversation.

1. **Tabrix is the execution layer, not an agent** (`AGENTS.md` §"Removed Surfaces — Must Not Be Reintroduced"). `experience_replay` re-runs a _named existing_ `actionPathId` from `experience_action_paths`. It does **not** plan. It does **not** invent new steps. It does **not** re-rank against a model. It does **not** call back into the upstream LLM mid-replay.
2. **Bounded, deterministic step set.** The replay engine only knows how to replay step kinds whose semantics are already nailed down: today that means `chrome_click_element` and `chrome_fill_or_select`. Any other `toolName` encountered in `step_sequence` aborts the replay with a structured failure (see §6). We do **not** add a "fallback to upstream LLM" branch when an unsupported step is hit.
3. **Fail-closed by default.** If any single step fails (locator stale, verifier red, dialog hit, navigation drift) the replay halts at that step with `status='failed'`. **No autonomous retry, no autonomous re-locator, no autonomous read_page-and-re-plan.** The whole point of replay is "the _plan_ is trusted because it succeeded before"; the moment that trust breaks, control returns to the upstream LLM.
4. **Single, explicit opt-in.** Replay is `requiresExplicitOptIn: true` from day one — in v1 it never appears in `listTools` output unless the operator has turned on the capability gate (`TABRIX_POLICY_CAPABILITIES` includes `experience_replay`, see §4). `TABRIX_POLICY_ALLOW_P3` does not participate because replay is not `P3`.
5. **No new SQLite table.** Replay reads `experience_action_paths` (B-005) read-only and writes its outcome via the **existing** Memory pipeline (a normal `memory_sessions` row, plus a normal `memory_steps` row per replayed step). No bespoke `experience_replays` table.
6. **GitHub-first.** `experience_action_paths` rows are bucketed by `(pageRole, intentSignature)`; `pageRole` is the same one B-013 / B-018 use. v1 only commits to GitHub-derived rows. A row whose `pageRole` is not in the GitHub-known set is a `failed-precondition`, not a "try anyway".
7. **No public contract drift beyond the new tool.** Existing tools' input/output unchanged. The only new shared types are: `TabrixExperienceReplayInput`, `TabrixExperienceReplayResult`, the `experience_replay` capability constant, and the `TOOL_NAMES.EXPERIENCE.REPLAY` entry.

## 3. Public input/output contract (v1 draft — owner reviews before fast-lane codes it)

### 3.1 Input

```ts
interface TabrixExperienceReplayInput {
  /**
   * The action-path the caller wants replayed. Must be an `actionPathId`
   * the caller obtained from `experience_suggest_plan` (B-013) — we
   * deliberately require the ID instead of `(intent, pageRole)` so the
   * call site has *named* the row it is asking us to re-execute. This
   * removes "race against fresher rows" as a v1 problem.
   *
   * MAX_TABRIX_EXPERIENCE_REPLAY_PATH_ID_CHARS (= 256). Strict format
   * `^action_path_[0-9a-f]{64}$` (matches the producer in
   * `experience-aggregator.ts::buildActionPathId`).
   */
  actionPathId: string;

  /**
   * Optional placeholder substitutions. The substitution surface is
   * intentionally narrow in v1: the keys are limited to a hand-curated
   * whitelist (see §5), and the values are typed strings.
   *
   * Why not "any string anywhere": the `step_sequence` JSON of an
   * `experience_action_paths` row may carry user-typed text from a past
   * fill (e.g. an issue title). Letting the *new* caller substitute
   * arbitrary strings into arbitrary historical-step fields is a
   * Confused-Deputy attack vector. v1 only allows substitutions into
   * fields that were explicitly tagged as "templatable" at capture
   * time; everything else is replayed verbatim.
   *
   * Empty / omitted is allowed (replays the recorded values verbatim).
   */
  variableSubstitutions?: Record<TabrixReplayPlaceholder, string>;

  /**
   * Optional tab the replay should run against. When omitted, the
   * native server picks the active tab in the active window (matches
   * the convention of `chrome_click_element`). Mismatched
   * `pageRole` between the chosen tab and `experience_action_paths.page_role`
   * is a `failed-precondition` (see §6) — we do NOT replay against the
   * wrong page.
   */
  targetTabId?: number;

  /**
   * v1 ceiling on the number of steps the replay will execute before
   * giving up. Defensive cap; the realistic per-row step count today is
   * 3-7. MAX_TABRIX_EXPERIENCE_REPLAY_STEP_BUDGET (= 16). A row with
   * more steps than the cap is `failed-precondition`, not "execute the
   * first 16".
   */
  maxSteps?: number;
}

type TabrixReplayPlaceholder =
  // Whitelist of legal substitution keys. v1 is intentionally tiny; v2
  // grows it only after we have telemetry showing real callers blocked
  // on a specific missing key.
  | 'queryText' // primary search/filter text (issue search, file finder)
  | 'targetLabel'; // a label/tag/state selector value
```

### 3.2 Output

```ts
interface TabrixExperienceReplayResult {
  status:
    | 'ok' // every step in the replayed plan succeeded
    | 'partial' // ≥ 1 step succeeded, then a later step failed
    | 'failed' // first step failed (no progress made)
    | 'failed-precondition' // we never started the replay (validation / row-shape problem)
    | 'invalid_input' // input failed the parser; nothing was attempted
    | 'denied'; // Policy gate denied; nothing was attempted

  /**
   * Identifier of the Memory session this replay opened. ALWAYS present
   * for `ok | partial | failed`; absent for the three pre-execution
   * statuses (we did not open a session). Lets the caller correlate
   * with `memory_steps` history afterwards.
   */
  replayId?: string;

  /**
   * Per-step outcome, in execution order. Length ≤ the number of steps
   * actually attempted (which is ≤ `step_sequence.length` of the
   * `experience_action_paths` row). Each entry's `historyRef` matches
   * the existing `memory_steps.history_ref` shape so callers can pull
   * the same step artifacts they would for any direct-tool call.
   */
  evidenceRefs: Array<{
    stepIndex: number; // 0-based index into the recorded plan
    toolName: string; // echoed from the recorded step
    status: 'ok' | 'failed' | 'aborted';
    historyRef: string | null; // pointer into Memory; null only when the step failed before any artifact was captured
    failureCode?: string; // present iff status !== 'ok'; closed enum, see §6
  }>;

  /**
   * Echo of what the replay actually decided to run. Useful for the
   * upstream caller to confirm the row it asked for is the row we
   * loaded (and that no substitution silently widened the input).
   */
  resolved?: {
    actionPathId: string;
    pageRole: string;
    intentSignature: string;
    appliedSubstitutionKeys: TabrixReplayPlaceholder[]; // never echoes the values
  };

  /**
   * Present iff `status === 'invalid_input'` or `status === 'denied'`
   * or `status === 'failed-precondition'`. Closed `code` enum.
   */
  error?: { code: string; message: string };
}
```

### 3.3 Why no `partial-ok-with-resume`

A naive design would let the caller resume a partial replay from the failed step. v1 deliberately does not: resume requires the runtime to _invent_ state that wasn't recorded (because between the original capture and this resume the page may have moved on), and the right answer is "ask the upstream LLM to re-plan from the current `read_page` snapshot". `partial` is therefore a **terminal** state in v1 — the caller takes the `replayId`, asks Memory what got done, and decides for themselves how to proceed.

## 4. Risk tier classification (owner decision locked 2026-04-23)

This section records the v1 decision and the rejected alternatives, so the implementation PR does not reopen the Policy boundary.

### 4.1 Recommendation: `P1` + `requiresExplicitOptIn: true` + new `experience_replay` capability

| Risk dimension                      | Verdict for v1 replay                                        |
| ----------------------------------- | ------------------------------------------------------------ |
| Reads page state                    | yes (per replayed step)                                      |
| Mutates page state                  | yes (clicks / fills are P2 by themselves)                    |
| Mutates server state                | depends on the underlying step targets                       |
| Bounded vs unbounded action surface | bounded (≤ `MAX_STEP_BUDGET` = 16 deterministic steps)       |
| Autonomy of decision                | **none** — strictly replays a row the caller named           |
| Policy escape hatches in v1         | `requiresExplicitOptIn` + capability gate (defense-in-depth) |

Pinning the tier:

- **Why not `P0`:** P0 is "read only, idempotent" (`docs/POLICY_PHASE_0.md` §2). Replay can click "Submit" if a past row clicked "Submit". `P0` is wrong.
- **Why not `P3`:** `P3` is "can execute arbitrary operations or known publish/delete/payment actions". Replay can never be _more dangerous_ than the constituent steps — and the constituent steps that exist today are P2 (`chrome_click_element`, `chrome_fill_or_select`). Treating replay as P3 would also lock it behind `TABRIX_POLICY_ALLOW_P3` without distinguishing it from `chrome_javascript`.
- **Why `P1` with explicit opt-in:** `P1` semantics ("auto-execute + record") match per-step semantics, but the _autonomy of running ≥ 2 P2 steps under one MCP call_ is an additional surface that `P1` does not naturally describe. The right answer is `P1` + the existing `requiresExplicitOptIn: true` gate, **plus** a capability-gate so the operator's "yes I want autonomous replay" decision is a single env-var flip rather than a per-tool allowlist edit. **This is the first time `requiresExplicitOptIn: true` is used on a non-P3 tool — that is intentional, and the schema in `packages/shared/src/tools.ts` already allows it (the field is independent of `riskTier`).**
- **Per-step Policy still applies.** When the replay engine fires `chrome_click_element` for step _i_, that call still goes through the existing P2 dispatch; it is not bypassed because the wrapper is P1. So a Policy upgrade that later hardens P2 (e.g. site-level allowlist) tightens replay automatically.

### 4.2 Alternatives considered and rejected for v1

- **Alternative A — `P3` + opt-in.** Strictly safer, but folds replay into the same allowlist as `chrome_javascript` / `chrome_inject_script`. Operators who deliberately turned off P3 (the recommended default for shared environments) would also lose replay.
- **Alternative B — `P2` + opt-in.** Matches the per-step tier. Loses the "autonomy is itself a surface" signal; from a Policy-audit standpoint, a P2 wrapper around P2 steps reads as no new risk, which is misleading.
- **Alternative C — Stay P1, drop the capability gate, keep only `requiresExplicitOptIn`.** Lighter, but conflates "this tool exists" with "autonomous replay is on" — once a maintainer opts in for one tool, they have implicitly opted in for the whole feature.

The recommendation (P1 + `requiresExplicitOptIn` + new capability) is the strictest of the three that still distinguishes replay from `chrome_javascript`. **v1 locks this recommendation.**

### 4.3 Capability gate addition

Adds **one** new entry to `TabrixCapability` in `packages/shared/src/capabilities.ts`:

```ts
export type TabrixCapability = 'api_knowledge' | 'experience_replay';
```

Operator opts in via `TABRIX_POLICY_CAPABILITIES=experience_replay` (or `=all`). Default-deny.
In v1 this capability gate is the operational opt-in boundary. `TABRIX_POLICY_ALLOW_P3` remains unchanged and does not participate because replay is not classified `P3`.

## 5. Variable substitution boundary

The hardest correctness question after Policy. The brief commits to the strictest viable rule:

- A step's `step_sequence[i]` JSON gains an **optional** `templateFields: TabrixReplayPlaceholder[]` field at _capture time_ (B-012 aggregator change — small, documented in §9). Without this field, a step is **non-templatable**: replay uses the captured value verbatim.
- At replay time, the engine walks the recorded `step_sequence`. For each step:
  1. If `templateFields` is empty / absent → use captured args verbatim.
  2. Else for each `key ∈ templateFields`: if the input `variableSubstitutions[key]` is set, substitute the _single_ corresponding parameter value. A missing substitution for a declared template field is a `failed-precondition` (we never silently fall through to the captured-from-past-user value).
- Substituted values pass through the **same** input validators the underlying tool already runs (e.g. `chrome_fill_or_select` length cap). A substitution that fails validation aborts replay with `failure_code='substitution_invalid'`.
- The engine **never** templates fields not on the whitelist. There is no "advanced mode". v2 may extend the whitelist; v1 is `queryText` + `targetLabel` (covers GitHub issue-search and label-pick, the two patterns we actually see in `experience_action_paths` today).
- The `resolved.appliedSubstitutionKeys` echo in the result lists the keys we used, but **never** echoes the user-supplied values (they may be private data the upstream caller is parameterising the replay with).

## 6. Failure semantics (closed enum)

Every failure surface is enumerated. Adding a new code is a v2 conversation.

| `failure_code`             | Meaning                                                                                    | When it appears                        |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| `unknown_action_path`      | `actionPathId` does not exist in `experience_action_paths`.                                | result.error (failed-precondition)     |
| `step_budget_exceeded`     | Recorded plan has more steps than `maxSteps` (or default 16).                              | result.error (failed-precondition)     |
| `unsupported_step_kind`    | A step's `toolName` is not in the v1 supported set (`click`, `fill`).                      | result.error (failed-precondition)     |
| `page_role_mismatch`       | Tab's current pageRole ≠ `experience_action_paths.page_role`.                              | result.error (failed-precondition)     |
| `non_github_pageRole`      | `pageRole` is not in the GitHub-known set.                                                 | result.error (failed-precondition)     |
| `template_field_missing`   | A declared template field has no `variableSubstitutions` entry.                            | result.error (failed-precondition)     |
| `substitution_invalid`     | Substituted value failed the underlying tool's input validator.                            | per-step `evidenceRefs[i].failureCode` |
| `step_target_not_found`    | The locator from the recorded historyRef no longer resolves.                               | per-step `evidenceRefs[i].failureCode` |
| `step_verifier_red`        | The underlying tool ran but its post-action verifier reported failure (Click Contract V2). | per-step `evidenceRefs[i].failureCode` |
| `step_dialog_intercepted`  | A native dialog appeared mid-step (we abort; no auto-accept).                              | per-step `evidenceRefs[i].failureCode` |
| `step_navigation_drift`    | A navigation happened during the step that the recorded plan did not anticipate.           | per-step `evidenceRefs[i].failureCode` |
| `replay_aborted_by_caller` | Future-proofing for a v2 `cancel` channel; v1 never emits this but the code is reserved.   | reserved                               |
| `policy_denied`            | Policy gate denied at MCP-dispatch time (existing P3-style payload reused).                | result.error (denied)                  |
| `capability_off`           | `experience_replay` capability is not in `TABRIX_POLICY_CAPABILITIES`.                     | result.error (denied)                  |

Behaviour rules:

- **The first per-step `failureCode` is terminal.** No retries, no in-place re-locator. The result `status` flips to `failed` (if step 0 failed) or `partial` (if step ≥ 1 failed).
- **No silent fallback to JS injection.** Even though `chrome_javascript` exists, replay never escalates to it. (This is enforced by the "supported step kinds" allowlist plus a runtime guard test.)
- **No silent fallback to CDP / debugger lane.** `interaction.ts` already guarantees Tabrix-owned-lane integrity (V23-01); replay rides that guarantee — it does not bypass it.

## 7. Memory evidence write-back schema

Replay is a Memory consumer + producer like any other MCP tool. We do **not** invent a new table.

- A single replay opens **one** `memory_sessions` row with `taskIntent = "experience_replay:" + actionPathId`. The opening write is bookkept by the existing `SessionManager`; we add no new method.
- Each attempted step writes **one** `memory_steps` row, in the existing shape, with:
  - `tool_name` = the underlying tool name (`chrome_click_element`, etc.) — **not** `'experience_replay'`. We want post-hoc analysis to count "clicks issued under replay" the same way it counts "clicks issued under direct LLM control".
  - `parent_step_id` is **deferred to v2**. v1 keeps the existing `memory_steps` shape and does not carry a guarded `ALTER TABLE ... ADD COLUMN` migration just for replay cross-linking.
  - `history_ref` is taken from the underlying tool's natural history ref so existing post-processors still work.
- After replay finishes (any terminal status), the existing `ExperienceAggregator` will pick the session up on its next pass and project the success/failure counters back into `experience_action_paths` _for the same `actionPathId`_ — i.e. successful replays compound the row's `success_count`, failed replays compound `failure_count`. This makes `experience_replay` a **first-class contributor to the same statistics that `experience_suggest_plan` reads**, closing the producer/consumer loop without a bespoke schema.
- Aggregator change (small): `experience-aggregator.ts::EXPERIENCE_AGGREGATION_EXCLUDED_TOOLS` already excludes `experience_suggest_plan`. We must **also** exclude the synthesised parent `experience_replay` step from aggregation as a top-level row, but **not** exclude its child steps (those are real clicks / fills and should aggregate as if the upstream LLM had issued them).

## 8. Test matrix

Three layers of tests, mirroring how B-013 / B-018 were verified.

### 8.1 Unit (no IO)

Native-server `app/native-server/src/mcp/experience-replay.test.ts`:

- Input parser: missing `actionPathId`; malformed `actionPathId`; `actionPathId` over the char cap; `maxSteps` ≤ 0; `maxSteps` over the cap; whitelisted-only `variableSubstitutions` keys; non-whitelisted key rejected.
- Failure-precondition projection: row-not-found; step-budget-exceeded; unsupported-step-kind; non-GitHub `pageRole`; missing template field.
- Strategy guard: a unit test enumerates the supported step kinds (`chrome_click_element`, `chrome_fill_or_select`) and fails the build on an unannounced addition (mirrors B-018's strategy-set guard test).
- Result-shape guard: every `failure_code` value listed in §6 appears in at least one test that asserts the structured payload shape.
- Telemetry parity: replay outcome is appended to `experience_action_paths` via the **existing** aggregator path — assert the row is _not_ double-counted when replay finishes (i.e. the aggregator does not re-project both the parent `experience_replay` step and the child clicks as separate `(pageRole, intent)` buckets).

### 8.2 Integration (DOM-free, with stub bridge)

`app/native-server/src/mcp/native-tool-handlers.test.ts` (existing file):

- `experience_replay` is **not** registered as a native handler — it is a bridged tool (it must call `chrome_click_element` etc. through the existing dispatch). Test the wiring: stub bridge dispatches each child step in order; replay returns `ok` + `evidenceRefs` of length N.
- Policy denial path: with `TABRIX_POLICY_CAPABILITIES` empty → `denied` + `code='capability_off'`, no Memory session opened.
- Metadata path: with capability on, `experience_replay` is visible as a `P1` tool that still advertises `requiresExplicitOptIn: true`; the implementation must not silently drop the explicit-opt-in marker just because replay is not `P3`.
- Per-step failure: stub bridge fails step 1 → result `status='partial'`, exactly one `evidenceRefs` entry with `status='failed'`, replay session marked terminal.
- No autonomous retry: assert that the failed step is not retried by the engine (count of bridge invocations matches the test's expectation exactly).
- Lane integrity: assert the replay engine never emits a CDP-lane / debugger-lane request — reuses the V23-01 lane-integrity guard if available.

### 8.3 Real-browser acceptance (sibling repo `tabrix-private-tests`)

New scenario family `t5-G-experience-replay`:

- `T5-G-GH-REPLAY-ISSUE-FILTER-HAPPY-PATH` — record once via direct LLM control, replay via `experience_replay`, assert filtered list matches.
- `T5-G-GH-REPLAY-AFTER-RELOAD` — record, reload, replay; assert replay still resolves the same `targetRef` (closes the cross-loop with V23-02 / B-011).
- `T5-G-GH-REPLAY-FAIL-CLOSED-ON-DOM-DRIFT` — record, mutate the DOM in a way that invalidates step 2, replay; assert `status='partial'`, no autonomous retry, no autonomous re-plan.
- `T5-G-GH-REPLAY-DENIED-WITHOUT-CAPABILITY` — start native-server with capability gate off, attempt replay, assert `status='denied'` + payload.
- `T5-G-GH-REPLAY-SUBSTITUTION-WHITELIST` — record an issue-search step with `templateFields=['queryText']`, replay with a fresh `queryText`; assert correct fill + correct `appliedSubstitutionKeys` echo.

These are private-repo scenarios because they exercise real-browser acceptance with a real GitHub session, and `AGENTS.md` rule 17 keeps that out of the public tree.

### 8.4 Repo-wide gates

Before implementation lands: `pnpm -r typecheck`, `pnpm --filter @tabrix/native-server test`, `pnpm --filter @tabrix/extension test`, `pnpm run docs:check`, `pnpm run release:check`.

## 9. What changes outside this file when v1 ships (for the future implementation PR — _not_ this one)

This is a forward declaration so the maintainer can scope the eventual fast-lane brief.

- `packages/shared/src/tools.ts` — adds `TOOL_NAMES.EXPERIENCE.REPLAY = 'experience_replay'`, adds the input schema entry, registers `TOOL_RISK_TIERS[TOOL_NAMES.EXPERIENCE.REPLAY] = 'P1'`, sets `requiresExplicitOptIn: true` on the schema entry.
- `packages/shared/src/capabilities.ts` — adds `'experience_replay'` to `TabrixCapability` and `ALL_TABRIX_CAPABILITIES`.
- `packages/shared/src/experience-replay.ts` — **new file**, all DTOs from §3 plus the `MAX_*` constants.
- `app/native-server/src/mcp/experience-replay.ts` — **new file**, the parser + dispatcher + per-step engine.
- `app/native-server/src/mcp/native-tool-handlers.ts` — registers `experience_replay` (note: this is a bridged tool, not a pure-native one — see §8.2).
- `app/native-server/src/memory/experience/experience-aggregator.ts` — extend `EXPERIENCE_AGGREGATION_EXCLUDED_TOOLS` to also exclude `experience_replay` parent rows; child rows pass through normally.
- `app/native-server/src/memory/experience/experience-repository.ts` — no replay-specific schema change required in v1.
- `app/native-server/src/memory/db/schema.ts` — no replay-specific schema change required in v1.
- `packages/shared/src/choose-context.ts` — extend `ContextStrategyName` with `'experience_replay'`. (B-018 v1.5 already lists this as a v2 candidate; this is its enabler.)
- `app/native-server/src/mcp/choose-context.ts` — add a strategy branch that picks `experience_replay` when an experience hit _and_ the capability is enabled _and_ the row's step kinds are all replay-supported. Otherwise stay on `experience_reuse`.
- `app/chrome-extension/entrypoints/background/tools/browser/click-verifier.ts` and `interaction.ts` — **no change required**. Replay ride the existing per-step verifier; the V23-01 lane-integrity guard already covers it.
- `docs/PRODUCT_BACKLOG.md` — promote `B-EXP-REPLAY-V1` from "brief landed, awaiting Policy review" to "v1 implemented" and link the implementation PR.
- `docs/TASK_ROADMAP.md` + `docs/TASK_ROADMAP_zh.md` — flip §3 Stage 3b "write-side MCP tools next" line to "write-side `experience_replay` v1 landed".
- `docs/POLICY_PHASE_0.md` — add a paragraph documenting the first non-P3 use of `requiresExplicitOptIn`.

No other files change.

## 10. Owner decisions locked (2026-04-23)

These are the decisions that were previously open and are now fixed for v1:

1. **Risk tier.** Lock §4.1's recommendation: `P1` + `requiresExplicitOptIn: true` + new capability `'experience_replay'`.
2. **Cross-link parent step.** Defer `parent_step_id` to v2. The v1 implementation carries no replay-specific `memory_steps` migration.
3. **Capability name spelling.** Lock `'experience_replay'` to match the tool name and B-016's feature-level capability naming precedent.
4. **Substitution whitelist scope.** Lock `['queryText', 'targetLabel']` as the v1 minimal set.
5. **`step_sequence` schema bump.** Land the optional `templateFields` array in v1 so replay can parameterise the two approved placeholder types; replay is not verbatim-only in v1.
6. **P3 allowlist question.** Closed as not applicable in v1 because replay is not `P3`.
7. **Acceptance scenario count.** Keep the five real-browser scenarios in §8.3 as the feature-level minimum for v1. Repo-wide version comparison and benchmark gates remain governed by the separate release/benchmark rules.

## 11. Alignment with `AGENTS.md` §"Tiered Execution Model"

This brief is now the artifact §"Hand-off protocol" calls for: the owner-lane answers are already recorded in §10, so the _next_ step is a fast-lane brief that points at this file, lists the files fast-lane may touch (the §9 set), the files fast-lane must not touch (anything outside §9), the acceptance criteria (§8 + §10), and the verification commands (§8.4). At that point fast-lane can run.

Specifically, fast-lane is permitted to do under that brief:

- Add a new `TOOL_NAMES` entry — as locked in §10 item 1.
- Add a new risk tier mapping — as locked in §10 item 1.
- Add `requiresExplicitOptIn: true` on a non-P3 tool — as locked in §10 item 1.
- Add a new capability constant — as locked in §10 item 3.

If a fast-lane session proposes to change any of the decisions already locked in §10, it stops and returns control to owner-lane instead of silently mutating the brief.

## 12. Reviewer checklist (implementation PR must satisfy)

- [ ] §3 input/output DTO names match the locked `P1` tier; no accidental `P3` semantics leaked into the surface.
- [ ] §4.3 capability name matches the §10 decision; `ALL_TABRIX_CAPABILITIES` will hold exactly two entries after implementation.
- [ ] §5 substitution whitelist matches the §10 decision; no key was added that the owner did not approve.
- [ ] §6 failure-code enum is closed; the implementation PR's parser has a "default → unknown_failure_code" guard test.
- [ ] §7 Memory write path produces exactly one `memory_sessions` row + N `memory_steps` rows; no bespoke `experience_replays` table.
- [ ] §8 test matrix is honoured: unit + integration + private-repo acceptance, not "unit only".
- [ ] No fast-lane forbidden item from `AGENTS.md` was touched outside the §9 list.
