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

/** The authored seed set for one site. Loader accepts arrays of these. */
export interface KnowledgeSeeds {
  readonly siteProfiles: readonly KnowledgeSiteProfile[];
  readonly pageRoleRules: readonly KnowledgePageRoleRule[];
  /** Stage 2+. Optional so Stage 1-only seeds (e.g. placeholder) compile. */
  readonly objectClassifiers?: readonly KnowledgeObjectClassifier[];
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

/** The registry view consumed by lookup functions. */
export interface CompiledKnowledgeRegistry {
  readonly siteProfiles: ReadonlyMap<string, CompiledSiteProfile>;
  readonly pageRoleRulesBySite: ReadonlyMap<string, readonly CompiledPageRoleRule[]>;
  readonly objectClassifiersBySite: ReadonlyMap<
    string,
    readonly CompiledKnowledgeObjectClassifier[]
  >;
}
