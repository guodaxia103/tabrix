import type { PageRole } from '../../tools/browser/read-page-understanding-core';
import type { CompiledKnowledgeRegistry, CompiledKnowledgeUIMapRule } from '../types';
import { getCompiledKnowledgeRegistry, uiMapRuleKey } from '../registry/knowledge-registry';

/**
 * Read-only UI Map lookup.
 *
 * Turns a `(siteId, pageRole, purpose)` triple into a compiled UI Map
 * rule authored in `seeds/<site>.ts`. Designed as a plain index read —
 * no scoring, no DOM access, no fallback chain. Follow-up PRs wire the
 * returned `locatorHints` into:
 *
 *   - `read_page` HVOs emit `targetRef` referencing this rule's `purpose`,
 *     so the locator hints are the stable handle.
 *   - Experience reads `(pageRole, purpose)` and reorders hints by
 *     historical success rate.
 *
 * The lookup itself does not consume the rules; tests and downstream
 * resolution paths are the callers.
 */

export interface UIMapLookupParams {
  readonly siteId: string;
  readonly pageRole: PageRole;
  readonly purpose: string;
  /** Injected for tests. Falls back to the memoized registry. */
  readonly registry?: CompiledKnowledgeRegistry | null;
}

export interface UIMapPageListingParams {
  readonly siteId: string;
  readonly pageRole: PageRole;
  readonly registry?: CompiledKnowledgeRegistry | null;
}

export interface UIMapSiteListingParams {
  readonly siteId: string;
  readonly registry?: CompiledKnowledgeRegistry | null;
}

/**
 * Resolve the registry argument the same way `resolve-page-role.ts` does:
 * an explicit `null` means "registry compile failed; do not fall back",
 * an `undefined` means "use the memoized default".
 */
function resolveRegistry(
  registry: CompiledKnowledgeRegistry | null | undefined,
): CompiledKnowledgeRegistry | null {
  if (registry === null) return null;
  if (registry === undefined) return getCompiledKnowledgeRegistry();
  return registry;
}

/**
 * Look up a UI map rule by stable `(siteId, pageRole, purpose)` triple.
 * Returns `null` when no authored rule exists — callers treat this as
 * "no registry-provided hint; fall back to legacy locator chain".
 */
export function lookupUIMapRule({
  siteId,
  pageRole,
  purpose,
  registry,
}: UIMapLookupParams): CompiledKnowledgeUIMapRule | null {
  const effective = resolveRegistry(registry);
  if (!effective) return null;
  return effective.uiMapRuleByKey.get(uiMapRuleKey(siteId, pageRole, purpose)) ?? null;
}

/**
 * List every UI map rule authored for `(siteId, pageRole)` in
 * declaration order. Convenience for UI tab / debug views and for
 * upcoming Experience lookups that need to enumerate a page's purposes
 * before querying success rates.
 */
export function listUIMapRulesForPage({
  siteId,
  pageRole,
  registry,
}: UIMapPageListingParams): readonly CompiledKnowledgeUIMapRule[] {
  const effective = resolveRegistry(registry);
  if (!effective) return [];
  const rules = effective.uiMapRulesBySite.get(siteId);
  if (!rules) return [];
  return rules.filter((rule) => rule.pageRole === pageRole);
}

/** Every UI map rule authored for a site, in declaration order. */
export function listUIMapRulesForSite({
  siteId,
  registry,
}: UIMapSiteListingParams): readonly CompiledKnowledgeUIMapRule[] {
  const effective = resolveRegistry(registry);
  if (!effective) return [];
  return effective.uiMapRulesBySite.get(siteId) ?? [];
}
