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

  it('keeps workflow_run_detail stable without dualOutcome (T5.4.5 contract)', () => {
    const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
    const rules = compiled.pageRoleRulesBySite.get('github') ?? [];
    const wrd = rules.find((r) => r.pageRole === 'workflow_run_detail');
    expect(wrd).toBeDefined();
    expect(wrd?.dualOutcome).toBeNull();
    expect(wrd?.fallback.primaryRegion).toBe('workflow_run_shell');
  });

  describe('stage 2 object classifiers', () => {
    it('compiles the full GitHub classifier catalog (7 URL + 27 label = 34)', () => {
      const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
      const list = compiled.objectClassifiersBySite.get('github');
      expect(list).toBeDefined();
      const hrefOnly = list?.filter((r) => r.match.hrefPatterns.length > 0) ?? [];
      const labelOnly = list?.filter((r) => r.match.labelPatterns.length > 0) ?? [];
      expect(hrefOnly.length).toBe(7);
      expect(labelOnly.length).toBe(27);
      expect(list?.length).toBe(34);
    });

    it('declares URL rules before label rules so URL-first dispatch is preserved', () => {
      const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
      const list = compiled.objectClassifiersBySite.get('github') ?? [];
      const firstLabelIndex = list.findIndex((r) => r.match.labelPatterns.length > 0);
      const lastHrefIndex = (() => {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i].match.hrefPatterns.length > 0) return i;
        }
        return -1;
      })();
      expect(lastHrefIndex).toBeGreaterThanOrEqual(0);
      expect(firstLabelIndex).toBeGreaterThan(lastHrefIndex);
    });

    it('preserves declaration order inside URL rules (specific before generic /actions)', () => {
      const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
      const list = compiled.objectClassifiersBySite.get('github') ?? [];
      const sources = list
        .filter((r) => r.match.hrefPatterns.length > 0)
        .map((r) => r.match.hrefPatterns[0].source);
      const runsIdx = sources.findIndex((s) => s.includes('/actions/runs/'));
      const actionsIdx = sources.findIndex((s) => /\^\/actions\(\?:/.test(s));
      expect(runsIdx).toBeGreaterThanOrEqual(0);
      expect(actionsIdx).toBeGreaterThanOrEqual(0);
      expect(runsIdx).toBeLessThan(actionsIdx);
    });

    it('applies the i flag to every object classifier pattern', () => {
      const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
      const list = compiled.objectClassifiersBySite.get('github') ?? [];
      for (const rule of list) {
        for (const p of rule.match.hrefPatterns) expect(p.pattern.flags).toContain('i');
        for (const p of rule.match.labelPatterns) expect(p.pattern.flags).toContain('i');
      }
    });

    it('tolerates seeds with no object classifiers (Douyin placeholder)', () => {
      const compiled = compileKnowledgeRegistry([DOUYIN_KNOWLEDGE_SEEDS]);
      expect(compiled.objectClassifiersBySite.size).toBe(0);
    });
  });
});
