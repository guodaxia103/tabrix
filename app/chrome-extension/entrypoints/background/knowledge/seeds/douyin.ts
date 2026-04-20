import type { KnowledgeSeeds } from '../types';

/**
 * Stage 1 placeholder for Douyin seeds.
 *
 * Stage 1 scope explicitly does not migrate Douyin rules — see
 * `docs/KNOWLEDGE_STAGE_1.md §2.2`. The existing TS family adapter
 * `read-page-understanding-douyin.ts` continues to own Douyin page
 * understanding until Stage 2 ships the title/content-driven seed schema.
 *
 * This file exists so Stage 2 can extend `seeds/` without a directory
 * restructure; the empty export also lets the registry loader treat
 * "Douyin exists but has no registry seeds yet" as a first-class state
 * (miss → TS fallback) rather than a bug.
 */
export const DOUYIN_KNOWLEDGE_SEEDS: KnowledgeSeeds = {
  siteProfiles: [],
  pageRoleRules: [],
};
