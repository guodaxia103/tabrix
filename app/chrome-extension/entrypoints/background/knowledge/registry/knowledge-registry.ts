import type {
  CompiledKnowledgeObjectClassifier,
  CompiledKnowledgePattern,
  CompiledKnowledgeRegistry,
  CompiledKnowledgeUIMapLocatorHint,
  CompiledKnowledgeUIMapRule,
  CompiledPageRoleRule,
  CompiledPrimaryRegionRule,
  CompiledSiteProfile,
  KnowledgeObjectClassifier,
  KnowledgePageRoleRule,
  KnowledgePatternSource,
  KnowledgePrimaryRegionRule,
  KnowledgeSeeds,
  KnowledgeSiteProfile,
  KnowledgeUIMapLocatorHint,
  KnowledgeUIMapRule,
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

/**
 * Canonical seed load order. GitHub first, then Douyin placeholder.
 * Stage 2 adds `objectClassifiers` to each seed; the registry loader
 * compiles them into the new `objectClassifiersBySite` index.
 */
const SEED_SETS: readonly KnowledgeSeeds[] = [GITHUB_KNOWLEDGE_SEEDS, DOUYIN_KNOWLEDGE_SEEDS];

let cachedRegistry: CompiledKnowledgeRegistry | null = null;

export function getCompiledKnowledgeRegistry(): CompiledKnowledgeRegistry | null {
  if (cachedRegistry) {
    return cachedRegistry;
  }
  try {
    cachedRegistry = compileKnowledgeRegistry(SEED_SETS);
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
  const objectClassifiersBySite = new Map<string, CompiledKnowledgeObjectClassifier[]>();
  const uiMapRulesBySite = new Map<string, CompiledKnowledgeUIMapRule[]>();
  const uiMapRuleByKey = new Map<string, CompiledKnowledgeUIMapRule>();

  for (const seeds of seedSets) {
    for (const profile of seeds.siteProfiles) {
      if (siteProfiles.has(profile.siteId)) {
        throw new Error(`[tabrix/knowledge] duplicate siteId in seeds: ${profile.siteId}`);
      }
      siteProfiles.set(profile.siteId, compileSiteProfile(profile));
    }
    for (const rule of seeds.pageRoleRules) {
      const list = pageRoleRulesBySite.get(rule.siteId) ?? [];
      list.push(compilePageRoleRule(rule));
      pageRoleRulesBySite.set(rule.siteId, list);
    }
    for (const classifier of seeds.objectClassifiers ?? []) {
      const list = objectClassifiersBySite.get(classifier.siteId) ?? [];
      list.push(compileObjectClassifier(classifier));
      objectClassifiersBySite.set(classifier.siteId, list);
    }
    for (const rule of seeds.uiMapRules ?? []) {
      const compiled = compileUIMapRule(rule);
      const key = uiMapRuleKey(compiled.siteId, compiled.pageRole, compiled.purpose);
      if (uiMapRuleByKey.has(key)) {
        throw new Error(
          `[tabrix/knowledge] duplicate UI map rule: siteId=${compiled.siteId} ` +
            `pageRole=${compiled.pageRole} purpose=${compiled.purpose}`,
        );
      }
      uiMapRuleByKey.set(key, compiled);
      const list = uiMapRulesBySite.get(compiled.siteId) ?? [];
      list.push(compiled);
      uiMapRulesBySite.set(compiled.siteId, list);
    }
  }

  return {
    siteProfiles,
    pageRoleRulesBySite,
    objectClassifiersBySite,
    uiMapRulesBySite,
    uiMapRuleByKey,
  };
}

/**
 * Stable key builder for UI map lookups. Exposed so the lookup module
 * can reuse exactly the same normalization (`siteId::pageRole::purpose`)
 * the loader used to build the index.
 */
export function uiMapRuleKey(siteId: string, pageRole: string, purpose: string): string {
  return `${siteId}::${pageRole}::${purpose}`;
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

function compileObjectClassifier(
  rule: KnowledgeObjectClassifier,
): CompiledKnowledgeObjectClassifier {
  return {
    siteId: rule.siteId,
    pageRole: rule.pageRole ?? null,
    match: {
      hrefPatterns: compilePatternList(rule.match.hrefPatterns ?? [], 'i'),
      labelPatterns: compilePatternList(rule.match.labelPatterns ?? [], 'i'),
      ariaRoles: (rule.match.ariaRoles ?? []).map((role) => role.toLowerCase()),
    },
    objectType: rule.objectType,
    objectSubType: rule.objectSubType ?? null,
    region: rule.region ?? null,
    reason: rule.reason ?? null,
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

function compileUIMapRule(rule: KnowledgeUIMapRule): CompiledKnowledgeUIMapRule {
  return {
    siteId: rule.siteId,
    pageRole: rule.pageRole,
    purpose: rule.purpose,
    region: rule.region ?? null,
    locatorHints: rule.locatorHints.map(compileUIMapLocatorHint),
    actionType: rule.actionType ?? null,
    confidence: rule.confidence ?? null,
    notes: rule.notes ?? null,
  };
}

function compileUIMapLocatorHint(
  hint: KnowledgeUIMapLocatorHint,
): CompiledKnowledgeUIMapLocatorHint {
  const pattern =
    hint.kind === 'label_regex' || hint.kind === 'href_regex' ? new RegExp(hint.value, 'i') : null;
  return {
    kind: hint.kind,
    value: hint.value,
    pattern,
    role: hint.role ? hint.role.toLowerCase() : null,
  };
}
