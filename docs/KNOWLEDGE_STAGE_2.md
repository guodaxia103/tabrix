# MKEP Knowledge Registry — Stage 2 Design (HVO Classifier)

Status: Draft (authoring stage). Owner: Tabrix core.
Depends on: [Stage 1 design](./KNOWLEDGE_STAGE_1.md), [MKEP_CURRENT_VS_TARGET.md](./MKEP_CURRENT_VS_TARGET.md) §3.4.

## 1. Motivation

Stage 1 migrated the **Understanding layer** (Site Profile + Page Catalog + Primary Region anchors) for GitHub into data-driven seeds. The **HVO / Object layer** is still pure TypeScript: `read-page-high-value-objects-github.ts` hardcodes ~34 rules across URL-classifier (6 branches, T5.4.5) and label-classifier (27 `GITHUB_CLASSIFICATION` rows).

Hardcoding the GitHub adapter is incompatible with the MKEP vision: every new site (and every new GitHub URL shape, e.g. T5.4.5 had to ship a code change to tag `workflow_run_entry`) requires a TypeScript PR. Stage 2 moves the classifier half of the object layer into `knowledge/seeds/*` so that:

- URL → `objectSubType` (T5.4.5 `classifyByGithubUrl`) becomes a data table.
- Label/regex → `objectType` + `region` (`GITHUB_CLASSIFICATION`) becomes a data table.
- Future sites are onboarded by adding a seed file, not a TS adapter module.

## 2. Scope decision: B (classifier only)

Codex reconnaissance (`.tmp/knowledge-stage-2/outputs/hvo-scope.md`) enumerated three candidate scopes. Stage 2 ships **Scope B**:

| Item                                                                       | In scope | Rationale                                                                                                                           |
| -------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| URL-based classifier (`classifyByGithubUrl`)                               | YES      | T5.4.5's fresh fix; data-table shape is the smallest that fully replaces it.                                                        |
| Label/ARIA classifier (`GITHUB_CLASSIFICATION`)                            | YES      | Lives in the same function (`classify`); splitting them would leave a hybrid adapter and halve the "not hardcoded anymore" message. |
| ARIA-role fallback (`button/textbox/.../link` → `control/nav_entry/entry`) | NO (TS)  | Generic, not GitHub-specific, no value migrating in Stage 2.                                                                        |
| Object priors / seeds (`GITHUB_PAGE_ROLE_TASK_SEEDS`)                      | NO       | Touches `collectExtraCandidates`; pulls in `page_role_seed` origin semantics. Deferred to **Stage 3**.                              |
| Preferred + noise labels (`scorePrior`)                                    | NO       | Deferred to Stage 3 together with priors; breaks `scoring.test.ts` blast radius otherwise.                                          |
| Non-GitHub sites                                                           | NO       | Douyin / others deferred to Stage 3+ once the classifier schema is proven.                                                          |
| Persistence / tenancy                                                      | NO       | Per product decision carried forward from Stage 1: in-extension constant seeds, no SQLite, no owner dimension.                      |

Out-of-scope items stay in `read-page-high-value-objects-github.ts` untouched; Stage 3 will revisit.

## 3. Module layout

Extends Stage 1's `app/chrome-extension/entrypoints/background/knowledge/`:

```
knowledge/
├── feature-flag.ts           (reused, no change)
├── types.ts                  (+ KnowledgeObjectClassifier types)
├── registry/
│   └── knowledge-registry.ts (compile objectClassifiers, index by siteId)
├── seeds/
│   ├── github.ts             (+ objectClassifiers: URL 6 + label 27)
│   └── douyin.ts             (unchanged, empty)
└── lookup/
    ├── resolve-site-profile.ts
    ├── resolve-page-role.ts
    └── resolve-object-classification.ts   (NEW)
```

## 4. Schema additions (`types.ts`)

### 4.1 Authored seed form

```ts
export interface KnowledgeObjectClassifier {
  readonly siteId: string;
  /** If present, rule only considered when ObjectLayerContext.pageRole equals this. */
  readonly pageRole?: PageRole;
  readonly match: {
    readonly hrefPatterns?: readonly KnowledgePatternSource[];
    readonly labelPatterns?: readonly KnowledgePatternSource[];
    readonly ariaRoles?: readonly string[];
  };
  readonly objectType: ReadPageObjectType;
  readonly objectSubType?: string;
  readonly region?: string | null;
  /** Reason string emitted into `classificationReasons`; defaults to a generated one. */
  readonly reason?: string;
}

export interface KnowledgeSeeds {
  readonly siteProfiles: readonly KnowledgeSiteProfile[];
  readonly pageRoleRules: readonly KnowledgePageRoleRule[];
  readonly objectClassifiers?: readonly KnowledgeObjectClassifier[]; // NEW
}
```

### 4.2 Compiled form

```ts
export interface CompiledKnowledgeObjectClassifier {
  readonly siteId: string;
  readonly pageRole: PageRole | null;
  readonly match: {
    readonly hrefPatterns: readonly CompiledKnowledgePattern[];
    readonly labelPatterns: readonly CompiledKnowledgePattern[];
    readonly ariaRoles: readonly string[];
  };
  readonly objectType: ReadPageObjectType;
  readonly objectSubType: string | null;
  readonly region: string | null;
  readonly reason: string | null;
}

export interface CompiledKnowledgeRegistry {
  readonly siteProfiles: ReadonlyMap<string, CompiledSiteProfile>;
  readonly pageRoleRulesBySite: ReadonlyMap<string, readonly CompiledPageRoleRule[]>;
  readonly objectClassifiersBySite: ReadonlyMap< // NEW
    string,
    readonly CompiledKnowledgeObjectClassifier[]
  >;
}
```

**No `priority` field.** Stage 2 keeps Stage 1's "declaration order wins" semantics (URL rules authored first, label rules after). This guarantees the existing T5.4.5 "URL-first beats label" behaviour is preserved by authoring order, not by a numeric field that developers then have to reason about.

## 5. Lookup algorithm (`resolve-object-classification.ts`)

Mirrors the current `classify(candidate, context)` control flow:

```ts
function resolveObjectClassification({
  siteId,
  candidate,
  context,
}): ClassifiedCandidateObject | null {
  const classifiers = registry.objectClassifiersBySite.get(siteId);
  if (!classifiers) return null;

  for (const rule of classifiers) {
    if (rule.pageRole && rule.pageRole !== context.pageRole) continue;

    // Any match path satisfies the rule; the first matching path emits the reason.
    const hrefMatch = matchHref(rule, candidate.href, context.currentUrl);
    if (hrefMatch) return build(candidate, rule, hrefMatch.reason, context, /*hrefMatched*/ true);

    const labelMatch = matchLabel(rule, candidate.label);
    if (labelMatch) return build(candidate, rule, labelMatch.reason, context, false);

    const ariaMatch = matchAria(rule, candidate.role);
    if (ariaMatch) return build(candidate, rule, ariaMatch.reason, context, false);
  }
  return null;
}
```

**Href matching** reuses the existing `resolveGithubRepoContext` + `normalizeHrefToPath` helpers by re-exporting them from `read-page-high-value-objects-github.ts` as pure functions. The seed-side `hrefPatterns` are authored **against the normalized relative path** (`/actions/runs/123`), so seeds are portable across `owner/repo`. The lookup helper passes both the raw `href` and `context.currentUrl` to the normalizer, then regex-tests the result.

**Region override**: when `rule.region` is set, the classified object gets that region. When it's `null`, the legacy fallback to `context.primaryRegion` is preserved (T5.4.5 URL-classifier behaviour for `page_anchor`).

**Seed prior reason**: when `candidate.origin === 'page_role_seed'`, the classifier appends `'page_role_seed prior'` to `classificationReasons`, bit-compatible with the legacy code.

## 6. Consumer refactor (`read-page-high-value-objects-github.ts`)

```ts
classify(candidate, context): ClassifiedCandidateObject | null {
  if (isKnowledgeRegistryEnabled(KNOWLEDGE_REGISTRY_MODE)) {
    if (isKnowledgeRegistryDiffMode(KNOWLEDGE_REGISTRY_MODE)) {
      const viaRegistry = resolveObjectClassification({ siteId: 'github', candidate, context });
      const viaLegacy = legacyGithubClassify(candidate, context);
      if (!classifiedObjectsEqual(viaRegistry, viaLegacy)) {
        console.warn('[tabrix/knowledge] hvo classifier diff', { candidate, viaRegistry, viaLegacy });
      }
      return viaLegacy;
    }
    const viaRegistry = resolveObjectClassification({ siteId: 'github', candidate, context });
    if (viaRegistry) return viaRegistry;
  }
  return legacyGithubClassify(candidate, context);
}
```

`legacyGithubClassify` is the original `classify` function body extracted into a private helper so diff-mode has something to compare against. Nothing outside this file sees it.

`scorePrior`, `owns`, and `collectExtraCandidates` are **not touched** in Stage 2. They continue to read `GITHUB_PAGE_ROLE_TASK_SEEDS`, `GITHUB_NOISE_PATTERNS`, `GITHUB_PREFERRED_LABELS` as before.

## 7. Seeds migration (`seeds/github.ts`)

### 7.1 URL classifier rows (6)

| #   | hrefPatterns                                                                               | objectSubType        | objectType | region                            | pageRole filter               | source                        |
| --- | ------------------------------------------------------------------------------------------ | -------------------- | ---------- | --------------------------------- | ----------------------------- | ----------------------------- | -------------------- | --------- | --------- |
| 1   | `^#`                                                                                       | `github.page_anchor` | `entry`    | `null`                            | any                           | `classifyByGithubUrl:224-230` |
| 2   | `^/actions/runs/\d+(?:/                                                                    | \?                   | #          | $)`                               | `github.workflow_run_entry`   | `record`                      | `workflow_runs_list` | any       | `239-245` |
| 3   | `^/actions/workflows/[^/]+\.ya?ml(?:\?                                                     | #                    | $)`        | `github.workflow_file_entry`      | `control`                     | `workflow_runs_list`          | any                  | `248-255` |
| 4   | `^/actions(?:\?                                                                            | #                    | $)`        | `github.workflow_filter_control`  | `control`                     | `workflow_runs_list`          | any                  | `257-263` |
| 5   | `^/security(?:/                                                                            | \?                   | #          | $)`(and`/security/code-scanning`) | `github.security_quality_tab` | `nav_entry`                   | `repo_primary_nav`   | any       | `266-281` |
| 6   | `^/(issues\|pulls\|actions\|security\|insights\|wiki\|projects\|discussions\|settings)(?:/ | \?                   | #          | $)`                               | `github.repo_nav_tab`         | `nav_entry`                   | `repo_primary_nav`   | any       | `283-294` |

URL rules are **authored first** and use **href-only** matching. Declaration order matters: rule 2 (`/actions/runs/<id>`) must precede rule 4 (`/actions?`) to avoid the more generic rule eating the specific one.

### 7.2 Label classifier rows (27)

Row-for-row copy of `GITHUB_CLASSIFICATION` (lines 120-160): 9 rows for `repo_home`, 7 for `issues_list`, 5 for `actions_list`, 6 for `workflow_run_detail`. Each row gets `pageRole` filled in, `labelPatterns: [<regex source>]`, `objectType`, `region`. No `hrefPatterns`, no `ariaRoles`.

### 7.3 ARIA fallback rows (not migrated)

The `button/textbox/searchbox/combobox/switch/checkbox → control`, `tab/menuitem → nav_entry`, `link → entry` fallback (lines 401-425) stays in `legacyGithubClassify`. Out of Stage 2 scope per §2.

## 8. Feature flag

Reuses Stage 1's `KNOWLEDGE_REGISTRY_MODE`. A single flag drives both the understanding-layer and HVO-layer consumers:

- `off`: both layers run legacy.
- `on`: both layers try registry first, fall back on miss. Production default.
- `diff`: both layers dry-run registry and emit `console.warn` on divergence; return legacy result.

No separate `KNOWLEDGE_HVO_MODE`. If future staged rollouts demand independence the split can be introduced in Stage 3 without breaking this contract — consumers already pass the mode into local helpers.

## 9. Testing strategy

### 9.1 Registry unit tests (`knowledge-registry.test.ts` extension)

- Adds a sub-suite "compiles object classifiers" asserting:
  - GitHub seeds produce exactly 6 URL rules + 27 label rules (33 total).
  - Pattern sources are preserved verbatim.
  - Declaration order is preserved: rules 1..6 URL rules come before rule 7 (first label rule).
  - Empty `objectClassifiers` is accepted (Douyin path).

### 9.2 Lookup unit tests (`knowledge-lookup.test.ts` extension)

New sub-suite "resolveObjectClassification":

- URL rules: for each of the 6 rules, one positive case (matching href + current URL) and one negative case (wrong URL shape) — 12 assertions.
- Label rules: representative rules per pageRole (issues `search issues`, actions `filter workflow runs`, workflow `logs`, repo_home `issues`) — 8 assertions.
- pageRole scoping: a `repo_home`-scoped label rule must not fire for `issues_list` even if label matches — 2 assertions.
- `page_role_seed` origin: asserts classificationReasons includes `'page_role_seed prior'` — 1 assertion.
- Unknown site: returns `null` — 1 assertion.

### 9.3 HVO parity suite (`read-page-high-value-objects-github.parity.test.ts`) — NEW

Double-runs the production `githubObjectLayerAdapter.classify` (registry-first) against an in-memory legacy-only adapter for the same fixture set. Asserts deep-equality of:

- `objectType`
- `objectSubType` (optional field)
- `region`
- `classificationReasons` (array, order-sensitive)

Fixture coverage:

- 6 URL-classifier fixtures (one per URL rule, each inside a `/actions` page or `/security` page where applicable).
- 4 label-classifier fixtures (one per pageRole).
- 2 ARIA-fallback fixtures (to prove the legacy fallback is still reachable through the adapter).
- 2 negative fixtures (unknown role, unknown label) returning `null`.

Total 14 fixtures, matches Stage 1's parity fixture granularity.

### 9.4 Existing tests

Must stay green **without modification**:

- `read-page-high-value-objects-github.test.ts` (current 60+ tests).
- `read-page-high-value-objects-scoring.test.ts` (Scope B does not touch scoring).
- `read-page-task-protocol.test.ts` (downstream consumer, behaviour-preserving refactor).

If any of these need changes, the migration has diverged from legacy and the seeds are wrong.

## 10. Rollback plan

`KNOWLEDGE_REGISTRY_MODE = 'off'` immediately reverts to the legacy classifier. Since Scope B keeps `legacyGithubClassify` as the full original function body, there is zero behavioural difference in the `off` path.

If a mid-stage bug forces a revert: flip the constant, ship, then keep the Stage 2 seeds / lookup / tests. No data migration.

## 11. Non-goals restatement

The following are explicitly NOT addressed by Stage 2 and remain hardcoded TS:

1. Object priors / `page_role_seed` collection (`collectExtraCandidates`).
2. Preferred / noise labels used by `scorePrior`.
3. Douyin object classifier.
4. UI Map, Data Hints (MKEP further-out layers).
5. SQLite-backed Knowledge / cross-device sync.
6. Tenancy dimension.

Stage 3 proposal (not part of this PR): collapse priors + preferred + noise into a `KnowledgeObjectPriors` schema, migrate Douyin seeds (after Stage 3 HVO shape is proven on GitHub), and retire `GITHUB_PAGE_ROLE_TASK_SEEDS` / `GITHUB_PAGE_ROLE_PRIORITY_RULES` / `GITHUB_NOISE_PATTERNS` / `GITHUB_PREFERRED_LABELS` from `read-page-high-value-objects-github.ts`.
