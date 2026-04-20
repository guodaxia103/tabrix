import { describe, expect, it } from 'vitest';
import {
  compileKnowledgeRegistry,
  getCompiledKnowledgeRegistry,
  __resetCompiledKnowledgeRegistryForTest,
} from '@/entrypoints/background/knowledge/registry/knowledge-registry';
import type { KnowledgeSeeds } from '@/entrypoints/background/knowledge/types';
import { GITHUB_KNOWLEDGE_SEEDS } from '@/entrypoints/background/knowledge/seeds/github';
import { DOUYIN_KNOWLEDGE_SEEDS } from '@/entrypoints/background/knowledge/seeds/douyin';

describe('knowledge-registry compile', () => {
  it('loads the stage 1 seed sets without throwing', () => {
    __resetCompiledKnowledgeRegistryForTest();
    const registry = getCompiledKnowledgeRegistry();
    expect(registry).not.toBeNull();
    expect(registry?.siteProfiles.has('github')).toBe(true);
  });

  it('exposes GitHub page role rules in declaration order', () => {
    const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
    const rules = compiled.pageRoleRulesBySite.get('github');
    expect(rules).toBeDefined();
    const names = (rules ?? []).map((r) => r.pageRole);
    expect(names).toEqual(['workflow_run_detail', 'actions_list', 'issues_list', 'repo_home']);
  });

  it('compiles every GitHub pattern to a valid RegExp with the i flag', () => {
    const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
    const profile = compiled.siteProfiles.get('github');
    expect(profile).toBeDefined();
    for (const p of profile?.match.urlPatterns ?? []) {
      expect(p.pattern.flags).toContain('i');
    }
    for (const rule of compiled.pageRoleRulesBySite.get('github') ?? []) {
      for (const p of rule.match.urlPatterns) expect(p.pattern.flags).toContain('i');
      for (const region of rule.primaryRegions) {
        for (const pat of region.patterns) expect(pat.pattern.flags).toContain('i');
      }
    }
  });

  it('tolerates sites whose seed set is intentionally empty', () => {
    const compiled = compileKnowledgeRegistry([DOUYIN_KNOWLEDGE_SEEDS]);
    expect(compiled.siteProfiles.size).toBe(0);
    expect(compiled.pageRoleRulesBySite.size).toBe(0);
  });

  it('rejects duplicate siteId across seed sets', () => {
    const duplicate: KnowledgeSeeds = {
      siteProfiles: [{ siteId: 'github', match: { hosts: ['github.io'] } }],
      pageRoleRules: [],
    };
    expect(() => compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS, duplicate])).toThrowError(
      /duplicate siteId/,
    );
  });

  it('carries dualOutcome through to the compiled workflow_run_detail rule', () => {
    const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
    const rules = compiled.pageRoleRulesBySite.get('github') ?? [];
    const wrd = rules.find((r) => r.pageRole === 'workflow_run_detail');
    expect(wrd?.dualOutcome).toMatchObject({
      defaultRole: 'workflow_run_shell',
      primaryRegionToRole: { workflow_run_summary: 'workflow_run_detail' },
    });
  });
});
