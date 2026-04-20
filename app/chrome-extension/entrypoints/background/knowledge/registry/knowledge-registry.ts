import type {
  CompiledKnowledgePattern,
  CompiledKnowledgeRegistry,
  CompiledPageRoleRule,
  CompiledPrimaryRegionRule,
  CompiledSiteProfile,
  KnowledgePageRoleRule,
  KnowledgePatternSource,
  KnowledgePrimaryRegionRule,
  KnowledgeSeeds,
  KnowledgeSiteProfile,
} from '../types';
import { GITHUB_KNOWLEDGE_SEEDS } from '../seeds/github';
import { DOUYIN_KNOWLEDGE_SEEDS } from '../seeds/douyin';

/**
 * Loads Stage 1 Knowledge seeds, compiles regex sources once, and indexes
 * the result by `siteId`. The compiled output is consumed by the
 * `lookup/*` functions; no other code path should reach into
 * `seeds/*` directly.
 *
 * Compile errors — a seed with an unparseable regex — fail loudly in tests
 * (see `knowledge-registry.test.ts`) but degrade to `null` at runtime so
 * an authoring bug does not crash `read_page`. The lookup wrapper is
 * expected to treat `null` as "fall back to legacy".
 */

const STAGE_1_SEED_SETS: readonly KnowledgeSeeds[] = [
  GITHUB_KNOWLEDGE_SEEDS,
  DOUYIN_KNOWLEDGE_SEEDS,
];

let cachedRegistry: CompiledKnowledgeRegistry | null = null;

export function getCompiledKnowledgeRegistry(): CompiledKnowledgeRegistry | null {
  if (cachedRegistry) {
    return cachedRegistry;
  }
  try {
    cachedRegistry = compileKnowledgeRegistry(STAGE_1_SEED_SETS);
    return cachedRegistry;
  } catch (error) {
    console.warn('[tabrix/knowledge] registry compile failed', error);
    return null;
  }
}

/** Exposed primarily for tests — allows feeding custom seed sets. */
export function compileKnowledgeRegistry(
  seedSets: readonly KnowledgeSeeds[],
): CompiledKnowledgeRegistry {
  const siteProfiles = new Map<string, CompiledSiteProfile>();
  const pageRoleRulesBySite = new Map<string, CompiledPageRoleRule[]>();

  for (const seeds of seedSets) {
    for (const profile of seeds.siteProfiles) {
      if (siteProfiles.has(profile.siteId)) {
        throw new Error(`[tabrix/knowledge] duplicate siteId in Stage 1 seeds: ${profile.siteId}`);
      }
      siteProfiles.set(profile.siteId, compileSiteProfile(profile));
    }
    for (const rule of seeds.pageRoleRules) {
      const list = pageRoleRulesBySite.get(rule.siteId) ?? [];
      list.push(compilePageRoleRule(rule));
      pageRoleRulesBySite.set(rule.siteId, list);
    }
  }

  return {
    siteProfiles,
    pageRoleRulesBySite,
  };
}

/** Testing hook — clears the memoised compile so tests can swap seed sets. */
export function __resetCompiledKnowledgeRegistryForTest(): void {
  cachedRegistry = null;
}

function compileSiteProfile(profile: KnowledgeSiteProfile): CompiledSiteProfile {
  return {
    siteId: profile.siteId,
    match: {
      hosts: [...(profile.match.hosts ?? [])],
      urlPatterns: compilePatternList(profile.match.urlPatterns ?? [], 'i'),
    },
  };
}

function compilePageRoleRule(rule: KnowledgePageRoleRule): CompiledPageRoleRule {
  return {
    siteId: rule.siteId,
    pageRole: rule.pageRole,
    match: {
      urlPatterns: compilePatternList(rule.match.urlPatterns ?? [], 'i'),
      titlePatterns: compilePatternList(rule.match.titlePatterns ?? [], 'i'),
      contentPatterns: compilePatternList(rule.match.contentPatterns ?? [], 'i'),
    },
    primaryRegions: (rule.primaryRegions ?? []).map(compilePrimaryRegionRule),
    fallback: {
      primaryRegion: rule.fallback?.primaryRegion ?? null,
      primaryRegionConfidence: rule.fallback?.primaryRegionConfidence ?? null,
    },
    dualOutcome: rule.dualOutcome ?? null,
  };
}

function compilePrimaryRegionRule(rule: KnowledgePrimaryRegionRule): CompiledPrimaryRegionRule {
  return {
    region: rule.region,
    patterns: compilePatternList(rule.patterns, 'i'),
    minMatches: Math.max(1, Number(rule.minMatches ?? 1)),
    priority: Number(rule.priority ?? 0),
    confidence: rule.confidence,
  };
}

function compilePatternList(
  sources: readonly KnowledgePatternSource[],
  flags: string,
): CompiledKnowledgePattern[] {
  return sources.map((source) => ({
    source,
    pattern: new RegExp(source, flags),
  }));
}
