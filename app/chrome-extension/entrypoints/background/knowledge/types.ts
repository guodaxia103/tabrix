import type { ReadPagePrimaryRegionConfidence } from '@tabrix/shared';
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

/** The authored seed set for one site. Loader accepts arrays of these. */
export interface KnowledgeSeeds {
  readonly siteProfiles: readonly KnowledgeSiteProfile[];
  readonly pageRoleRules: readonly KnowledgePageRoleRule[];
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

/** The registry view consumed by lookup functions. */
export interface CompiledKnowledgeRegistry {
  readonly siteProfiles: ReadonlyMap<string, CompiledSiteProfile>;
  readonly pageRoleRulesBySite: ReadonlyMap<string, readonly CompiledPageRoleRule[]>;
}
