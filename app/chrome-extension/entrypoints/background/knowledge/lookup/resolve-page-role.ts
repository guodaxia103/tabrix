import type { ReadPagePrimaryRegionConfidence } from '@tabrix/shared';
import type {
  PageRole,
  PageUnderstandingContext,
  PageUnderstandingSummary,
  RegionResolution,
  RegionRule,
} from '../../tools/browser/read-page-understanding-core';
import { resolvePrimaryRegion } from '../../tools/browser/read-page-understanding-core';
import type {
  CompiledKnowledgePattern,
  CompiledKnowledgeRegistry,
  CompiledPageRoleRule,
} from '../types';
import { getCompiledKnowledgeRegistry } from '../registry/knowledge-registry';

/**
 * Given a site identity plus the understanding context, run the Stage 1
 * Page Catalog rules for that site and return a `PageUnderstandingSummary`
 * equivalent to what the legacy TS family adapter would have produced.
 *
 * Match algorithm (see `docs/KNOWLEDGE_STAGE_1.md §4.3`):
 *
 * 1. Scan `pageRoleRulesBySite.get(siteId)` in declaration order.
 * 2. First rule whose URL / title / content patterns all have matches
 *    (where present) wins. URL patterns match against `context.lowerUrl`;
 *    title patterns against `context.lowerTitle`; content patterns against
 *    `context.content`.
 * 3. With the winning rule, compute the primary region via the existing
 *    `resolvePrimaryRegion` helper — Stage 1 explicitly reuses the legacy
 *    scoring so behaviour is bit-exact.
 * 4. If the winning rule carries `dualOutcome`, the resolved region may
 *    override the nominal `pageRole`.
 *
 * Returns `null` when no rule matches. Callers treat `null` as "fall back
 * to the TS family adapters".
 */
export interface PageRoleLookupInput {
  readonly siteId: string;
  readonly context: PageUnderstandingContext;
}

export function resolvePageRole(
  input: PageRoleLookupInput,
  registry: CompiledKnowledgeRegistry | null = getCompiledKnowledgeRegistry(),
): PageUnderstandingSummary | null {
  if (!registry) {
    return null;
  }
  const rules = registry.pageRoleRulesBySite.get(input.siteId);
  if (!rules || rules.length === 0) {
    return null;
  }
  for (const rule of rules) {
    if (matchesRule(rule, input.context)) {
      return buildSummary(rule, input.context);
    }
  }
  return null;
}

function matchesRule(rule: CompiledPageRoleRule, ctx: PageUnderstandingContext): boolean {
  const { urlPatterns, titlePatterns, contentPatterns } = rule.match;
  if (urlPatterns.length > 0 && !someMatches(urlPatterns, ctx.lowerUrl)) {
    return false;
  }
  if (titlePatterns.length > 0 && !someMatches(titlePatterns, ctx.lowerTitle)) {
    return false;
  }
  if (contentPatterns.length > 0 && !someMatches(contentPatterns, ctx.content)) {
    return false;
  }
  return true;
}

function someMatches(patterns: readonly CompiledKnowledgePattern[], source: string): boolean {
  for (const compiled of patterns) {
    if (compiled.pattern.test(source)) {
      return true;
    }
  }
  return false;
}

function buildSummary(
  rule: CompiledPageRoleRule,
  ctx: PageUnderstandingContext,
): PageUnderstandingSummary {
  const regionRules: RegionRule[] = rule.primaryRegions.map((compiled) => ({
    region: compiled.region,
    patterns: compiled.patterns.map((p) => p.pattern),
    minMatches: compiled.minMatches,
    priority: compiled.priority,
    confidence: compiled.confidence,
  }));

  const regionResolution: RegionResolution = resolvePrimaryRegion(
    [ctx.lowerTitle, ctx.content],
    regionRules,
    rule.fallback.primaryRegion,
    rule.fallback.primaryRegionConfidence,
  );

  const pageRole = applyDualOutcome(rule, regionResolution.region);
  const confidence: ReadPagePrimaryRegionConfidence = regionResolution.confidence;

  return {
    pageRole,
    primaryRegion: regionResolution.region,
    primaryRegionConfidence: confidence,
    footerOnly: ctx.footerOnly,
    anchorTexts: ctx.anchorTexts,
  };
}

function applyDualOutcome(rule: CompiledPageRoleRule, resolvedRegion: string | null): PageRole {
  if (!rule.dualOutcome) {
    return rule.pageRole;
  }
  if (resolvedRegion && resolvedRegion in rule.dualOutcome.primaryRegionToRole) {
    return rule.dualOutcome.primaryRegionToRole[resolvedRegion];
  }
  return rule.dualOutcome.defaultRole;
}
