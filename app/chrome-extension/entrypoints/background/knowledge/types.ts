import type { ReadPageObjectType, ReadPagePrimaryRegionConfidence } from '@tabrix/shared';
import type { PageRole } from '../tools/browser/read-page-understanding-core';

/**
 * Stage 1 Knowledge Registry types.
 *
 * Design rationale: `docs/KNOWLEDGE_STAGE_1.md`.
 *
 * Stage 1 intentionally stays **schema-narrow**: only the shapes needed to
 * move GitHub understanding-layer rules (Site Profile, Page Catalog,
 * Primary Region anchors) from TS expressions into data. HVO classifiers,
 * object priors, UI map, data hints, multi-locale lexicons and tenant
 * scope all stay TS-side until Stage 2+.
 *
 * Per user instruction, there is **no tenancy dimension**: seeds are
 * single-user local data.
 */

/** Raw regex source string as authored in a seed. Compiled at registry load. */
export type KnowledgePatternSource = string;

/** A regex source together with its compiled RegExp. */
export interface CompiledKnowledgePattern {
  readonly source: KnowledgePatternSource;
  readonly pattern: RegExp;
}

/** Site Profile — identifies which site a URL belongs to. */
export interface KnowledgeSiteProfile {
  readonly siteId: string;
  readonly match: {
    readonly hosts?: readonly string[];
    readonly urlPatterns?: readonly KnowledgePatternSource[];
  };
}

/** Primary region rule — mirrors `RegionRule` in `read-page-understanding-core.ts`. */
export interface KnowledgePrimaryRegionRule {
  readonly region: string;
  readonly patterns: readonly KnowledgePatternSource[];
  readonly minMatches?: number;
  readonly priority?: number;
  readonly confidence: ReadPagePrimaryRegionConfidence;
}

/**
 * Dual-outcome override: after primary-region resolution, the resolved
 * `region` value may itself map to a different `pageRole`. Mirrors the
 * current TS branch in `read-page-understanding-github.ts:132-142` where
 * `workflow_run_summary` region promotes the role from `workflow_run_shell`
 * to `workflow_run_detail`.
 */
export interface KnowledgeDualOutcome {
  /** Map from resolved `region` → overriding `pageRole`. */
  readonly primaryRegionToRole: Readonly<Record<string, PageRole>>;
  /** Role to use when no region override fires. Replaces the rule's `pageRole`. */
  readonly defaultRole: PageRole;
}

/** Page Catalog rule — URL / title / content → `pageRole` + primary region. */
export interface KnowledgePageRoleRule {
  readonly siteId: string;
  readonly pageRole: PageRole;
  readonly match: {
    readonly urlPatterns?: readonly KnowledgePatternSource[];
    readonly titlePatterns?: readonly KnowledgePatternSource[];
    readonly contentPatterns?: readonly KnowledgePatternSource[];
  };
  readonly primaryRegions?: readonly KnowledgePrimaryRegionRule[];
  /** Used when all `primaryRegions` miss. */
  readonly fallback?: {
    readonly primaryRegion?: string | null;
    readonly primaryRegionConfidence?: ReadPagePrimaryRegionConfidence;
  };
  readonly dualOutcome?: KnowledgeDualOutcome;
}

/**
 * Stage 2 — authored object classifier rule (HVO layer).
 *
 * Design rationale: `docs/KNOWLEDGE_STAGE_2.md`.
 *
 * Replaces the per-site `classify(candidate, context)` branches in
 * `read-page-high-value-objects-<site>.ts`. A single rule can match on
 * any of `hrefPatterns` (T5.4.5-style URL → `objectSubType` mapping),
 * `labelPatterns` (legacy `GITHUB_CLASSIFICATION` table), or `ariaRoles`.
 * Rules are applied in authoring order — declaration wins, no numeric
 * priority — so URL rules authored before label rules preserve the
 * URL-first dispatch semantics.
 */
export interface KnowledgeObjectClassifier {
  readonly siteId: string;
  /** If present, rule only considered when `ObjectLayerContext.pageRole` equals this. */
  readonly pageRole?: PageRole;
  readonly match: {
    /**
     * Each pattern is matched against the normalized href path
     * (e.g. `/actions/runs/123`, `#readme`). Cross-repo hosts on
     * github.com are normalized relative to the repo in `currentUrl`.
     */
    readonly hrefPatterns?: readonly KnowledgePatternSource[];
    readonly labelPatterns?: readonly KnowledgePatternSource[];
    readonly ariaRoles?: readonly string[];
  };
  readonly objectType: ReadPageObjectType;
  readonly objectSubType?: string;
  /** `null` (or omitted) keeps the legacy "fallback to primaryRegion" behaviour. */
  readonly region?: string | null;
  /** Optional reason string; the lookup generates a default when omitted. */
  readonly reason?: string;
}

/**
 * Stage 3a — authored UI Map rule (Locator Hints layer).
 *
 * Design rationale: `docs/MKEP_STAGE_3_PLUS_ROADMAP.md §4.1`, target schema in
 * `docs/MKEP_CURRENT_VS_TARGET.md §3.4`.
 *
 * A UI Map rule says: on `(siteId, pageRole)`, the element with semantic
 * `purpose` (e.g. `repo_home.open_issues_tab`, `issues_list.new_issue_cta`)
 * can be located via one of the `locatorHints`. Hint order is declaration
 * order, not score order — the runtime locator chain in
 * `candidate-action.ts` still decides which kind wins when both fire
 * (`ref > css > selector`-first today).
 *
 * B-010 intentionally stops at **schema + seed + read-only lookup**. It
 * does not:
 *   - emit `targetRef` into `read_page` HVOs (that is B-011);
 *   - rewrite `candidate-action.ts:48-94` to consult these hints (that is
 *     also B-011, dependent on `stable targetRef`);
 *   - feed the Experience Stage 3b aggregator (B-012 / B-013).
 *
 * The hint kinds mirror `docs/MKEP_CURRENT_VS_TARGET.md:234-239`:
 *   - `aria_name` — exact accessible-name match (optionally scoped by
 *     ARIA `role`);
 *   - `label_regex` — regex against the element's visible/accessible
 *     label (optionally scoped by ARIA `role`);
 *   - `href_regex` — regex against the element's normalized `href` (for
 *     anchors and link-like controls);
 *   - `css` — verbatim CSS selector, last-resort.
 */
export type KnowledgeUIMapLocatorHintKind = 'aria_name' | 'label_regex' | 'href_regex' | 'css';

export interface KnowledgeUIMapLocatorHint {
  readonly kind: KnowledgeUIMapLocatorHintKind;
  /**
   * For `aria_name` and `css`: the exact string.
   * For `label_regex` and `href_regex`: the regex *source* (compiled at
   * registry load with the `'i'` flag, matching the other patterns).
   */
  readonly value: string;
  /** Optional ARIA role filter. Only meaningful for `aria_name` and `label_regex`. */
  readonly role?: string;
}

export type KnowledgeUIMapActionType = 'click' | 'fill' | 'navigate';
export type KnowledgeUIMapConfidence = 'high' | 'medium' | 'low';

export interface KnowledgeUIMapRule {
  readonly siteId: string;
  readonly pageRole: PageRole;
  /**
   * Stable semantic key. Convention: `<pageRole>.<element_purpose>`, all
   * lowercase snake_case (e.g. `repo_home.open_issues_tab`). Paired with
   * `siteId + pageRole` it must be unique — see `KNOWLEDGE_STAGE_2.md`
   * §"purpose naming" for the rule, and the registry loader enforces
   * uniqueness at compile time.
   */
  readonly purpose: string;
  /** Optional region gate. `null` means "any region under this pageRole". */
  readonly region?: string | null;
  /** Ordered list — earlier hints are preferred when they fire. */
  readonly locatorHints: readonly KnowledgeUIMapLocatorHint[];
  readonly actionType?: KnowledgeUIMapActionType;
  readonly confidence?: KnowledgeUIMapConfidence;
  /** Free-text authoring note; not consumed at runtime. */
  readonly notes?: string;
}

/** The authored seed set for one site. Loader accepts arrays of these. */
export interface KnowledgeSeeds {
  readonly siteProfiles: readonly KnowledgeSiteProfile[];
  readonly pageRoleRules: readonly KnowledgePageRoleRule[];
  /** Stage 2+. Optional so Stage 1-only seeds (e.g. placeholder) compile. */
  readonly objectClassifiers?: readonly KnowledgeObjectClassifier[];
  /** Stage 3a+. Optional so earlier-stage seeds keep compiling. */
  readonly uiMapRules?: readonly KnowledgeUIMapRule[];
}

/** Compiled forms used at lookup time. Patterns are compiled once. */
export interface CompiledSiteProfile {
  readonly siteId: string;
  readonly match: {
    readonly hosts: readonly string[];
    readonly urlPatterns: readonly CompiledKnowledgePattern[];
  };
}

export interface CompiledPrimaryRegionRule {
  readonly region: string;
  readonly patterns: readonly CompiledKnowledgePattern[];
  readonly minMatches: number;
  readonly priority: number;
  readonly confidence: ReadPagePrimaryRegionConfidence;
}

export interface CompiledPageRoleRule {
  readonly siteId: string;
  readonly pageRole: PageRole;
  readonly match: {
    readonly urlPatterns: readonly CompiledKnowledgePattern[];
    readonly titlePatterns: readonly CompiledKnowledgePattern[];
    readonly contentPatterns: readonly CompiledKnowledgePattern[];
  };
  readonly primaryRegions: readonly CompiledPrimaryRegionRule[];
  readonly fallback: {
    readonly primaryRegion: string | null;
    readonly primaryRegionConfidence: ReadPagePrimaryRegionConfidence;
  };
  readonly dualOutcome: KnowledgeDualOutcome | null;
}

/** Stage 2 compiled object classifier rule. */
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

/**
 * Stage 3a compiled UI map hint. Regex hint kinds carry their compiled
 * pattern on `pattern`; `aria_name` / `css` leave it as `null`.
 */
export interface CompiledKnowledgeUIMapLocatorHint {
  readonly kind: KnowledgeUIMapLocatorHintKind;
  readonly value: string;
  readonly pattern: RegExp | null;
  readonly role: string | null;
}

/** Stage 3a compiled UI map rule. */
export interface CompiledKnowledgeUIMapRule {
  readonly siteId: string;
  readonly pageRole: PageRole;
  readonly purpose: string;
  readonly region: string | null;
  readonly locatorHints: readonly CompiledKnowledgeUIMapLocatorHint[];
  readonly actionType: KnowledgeUIMapActionType | null;
  readonly confidence: KnowledgeUIMapConfidence | null;
  readonly notes: string | null;
}

/** The registry view consumed by lookup functions. */
export interface CompiledKnowledgeRegistry {
  readonly siteProfiles: ReadonlyMap<string, CompiledSiteProfile>;
  readonly pageRoleRulesBySite: ReadonlyMap<string, readonly CompiledPageRoleRule[]>;
  readonly objectClassifiersBySite: ReadonlyMap<
    string,
    readonly CompiledKnowledgeObjectClassifier[]
  >;
  /** Declaration-ordered list of UI map rules per `siteId`. */
  readonly uiMapRulesBySite: ReadonlyMap<string, readonly CompiledKnowledgeUIMapRule[]>;
  /**
   * Fast-path triple index keyed by `${siteId}::${pageRole}::${purpose}`.
   * `compileKnowledgeRegistry` throws on duplicate keys.
   */
  readonly uiMapRuleByKey: ReadonlyMap<string, CompiledKnowledgeUIMapRule>;
}
