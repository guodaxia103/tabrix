import { describe, expect, it } from 'vitest';
import {
  compileKnowledgeRegistry,
  uiMapRuleKey,
} from '@/entrypoints/background/knowledge/registry/knowledge-registry';
import {
  listUIMapRulesForPage,
  listUIMapRulesForSite,
  lookupUIMapRule,
} from '@/entrypoints/background/knowledge/lookup/resolve-ui-map';
import type { KnowledgeSeeds, KnowledgeUIMapRule } from '@/entrypoints/background/knowledge/types';
import { GITHUB_KNOWLEDGE_SEEDS } from '@/entrypoints/background/knowledge/seeds/github';
import { DOUYIN_KNOWLEDGE_SEEDS } from '@/entrypoints/background/knowledge/seeds/douyin';

describe('knowledge UI Map — compile (B-010)', () => {
  it('loads the GitHub seed into uiMapRulesBySite + uiMapRuleByKey', () => {
    const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
    const github = compiled.uiMapRulesBySite.get('github');
    expect(github).toBeDefined();
    expect(github?.length).toBe(5);
    expect(compiled.uiMapRuleByKey.size).toBe(5);
    expect(
      compiled.uiMapRuleByKey.has(uiMapRuleKey('github', 'repo_home', 'repo_home.open_issues_tab')),
    ).toBe(true);
  });

  it('preserves declaration order within github', () => {
    const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
    const purposes = compiled.uiMapRulesBySite.get('github')?.map((r) => r.purpose) ?? [];
    expect(purposes).toEqual([
      'repo_home.open_issues_tab',
      'repo_home.open_actions_tab',
      'issues_list.new_issue_cta',
      'issues_list.search_input',
      'actions_list.filter_input',
    ]);
  });

  it('compiles regex hint kinds into RegExp with the i flag, leaves aria_name/css null', () => {
    const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
    const rules = compiled.uiMapRulesBySite.get('github') ?? [];
    let regexCount = 0;
    let nonRegexCount = 0;
    for (const rule of rules) {
      for (const hint of rule.locatorHints) {
        if (hint.kind === 'label_regex' || hint.kind === 'href_regex') {
          expect(hint.pattern).toBeInstanceOf(RegExp);
          expect(hint.pattern?.flags).toContain('i');
          regexCount += 1;
        } else {
          expect(hint.pattern).toBeNull();
          nonRegexCount += 1;
        }
      }
    }
    expect(regexCount).toBeGreaterThan(0);
    expect(nonRegexCount).toBeGreaterThan(0);
  });

  it('normalizes the optional aria role to lowercase', () => {
    const custom: KnowledgeSeeds = {
      siteProfiles: [{ siteId: 'example', match: { hosts: ['example.com'] } }],
      pageRoleRules: [],
      uiMapRules: [
        {
          siteId: 'example',
          pageRole: 'repo_home',
          purpose: 'example.mixed_case_role',
          locatorHints: [{ kind: 'aria_name', value: 'Click me', role: 'Button' }],
        },
      ],
    };
    const compiled = compileKnowledgeRegistry([custom]);
    const rule = compiled.uiMapRuleByKey.get(
      uiMapRuleKey('example', 'repo_home', 'example.mixed_case_role'),
    );
    expect(rule?.locatorHints[0].role).toBe('button');
  });

  it('rejects duplicate (siteId, pageRole, purpose) triples', () => {
    const dupe: KnowledgeUIMapRule = {
      siteId: 'github',
      pageRole: 'repo_home',
      purpose: 'repo_home.open_issues_tab',
      locatorHints: [{ kind: 'aria_name', value: 'Issues' }],
    };
    const extra: KnowledgeSeeds = {
      siteProfiles: [],
      pageRoleRules: [],
      uiMapRules: [dupe],
    };
    expect(() => compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS, extra])).toThrowError(
      /duplicate UI map rule/,
    );
  });

  it('tolerates seeds that do not define uiMapRules (douyin placeholder)', () => {
    const compiled = compileKnowledgeRegistry([DOUYIN_KNOWLEDGE_SEEDS]);
    expect(compiled.uiMapRulesBySite.size).toBe(0);
    expect(compiled.uiMapRuleByKey.size).toBe(0);
  });

  it('fills optional fields with documented defaults', () => {
    const minimal: KnowledgeSeeds = {
      siteProfiles: [{ siteId: 'minimal', match: { hosts: ['minimal.test'] } }],
      pageRoleRules: [],
      uiMapRules: [
        {
          siteId: 'minimal',
          pageRole: 'repo_home',
          purpose: 'minimal.noop',
          locatorHints: [{ kind: 'css', value: 'button.x' }],
        },
      ],
    };
    const compiled = compileKnowledgeRegistry([minimal]);
    const rule = compiled.uiMapRuleByKey.get(uiMapRuleKey('minimal', 'repo_home', 'minimal.noop'));
    expect(rule).toBeDefined();
    expect(rule?.region).toBeNull();
    expect(rule?.actionType).toBeNull();
    expect(rule?.confidence).toBeNull();
    expect(rule?.notes).toBeNull();
    expect(rule?.locatorHints[0].role).toBeNull();
    expect(rule?.locatorHints[0].pattern).toBeNull();
  });
});

describe('knowledge UI Map — lookup (B-010)', () => {
  const registry = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);

  it('lookupUIMapRule returns the authored GitHub rule for the stable triple', () => {
    const rule = lookupUIMapRule({
      siteId: 'github',
      pageRole: 'issues_list',
      purpose: 'issues_list.new_issue_cta',
      registry,
    });
    expect(rule).not.toBeNull();
    expect(rule?.actionType).toBe('click');
    expect(rule?.region).toBe('issues_results');
    expect(rule?.locatorHints[0].kind).toBe('href_regex');
  });

  it('returns null for an unknown (siteId, pageRole, purpose) triple', () => {
    expect(
      lookupUIMapRule({
        siteId: 'github',
        pageRole: 'repo_home',
        purpose: 'repo_home.does_not_exist',
        registry,
      }),
    ).toBeNull();
    expect(
      lookupUIMapRule({
        siteId: 'unknown',
        pageRole: 'repo_home',
        purpose: 'repo_home.open_issues_tab',
        registry,
      }),
    ).toBeNull();
  });

  it('listUIMapRulesForPage returns every rule on the page in declaration order', () => {
    const rules = listUIMapRulesForPage({
      siteId: 'github',
      pageRole: 'issues_list',
      registry,
    });
    expect(rules.map((r) => r.purpose)).toEqual([
      'issues_list.new_issue_cta',
      'issues_list.search_input',
    ]);
  });

  it('listUIMapRulesForPage returns [] for a page with no authored rules', () => {
    const rules = listUIMapRulesForPage({
      siteId: 'github',
      pageRole: 'workflow_run_detail',
      registry,
    });
    expect(rules).toEqual([]);
  });

  it('listUIMapRulesForSite returns all 5 GitHub rules', () => {
    const rules = listUIMapRulesForSite({ siteId: 'github', registry });
    expect(rules.length).toBe(5);
    expect(rules[0].siteId).toBe('github');
  });

  it('returns null / [] when the registry is explicitly null (failed-compile path)', () => {
    expect(
      lookupUIMapRule({
        siteId: 'github',
        pageRole: 'repo_home',
        purpose: 'repo_home.open_issues_tab',
        registry: null,
      }),
    ).toBeNull();
    expect(
      listUIMapRulesForPage({ siteId: 'github', pageRole: 'repo_home', registry: null }),
    ).toEqual([]);
    expect(listUIMapRulesForSite({ siteId: 'github', registry: null })).toEqual([]);
  });
});

describe('knowledge UI Map — no regression on Stage 1/2 (B-010)', () => {
  it('existing siteProfiles + pageRoleRules + objectClassifiers counts are unchanged', () => {
    const compiled = compileKnowledgeRegistry([GITHUB_KNOWLEDGE_SEEDS]);
    expect(compiled.siteProfiles.size).toBe(1);
    expect(compiled.pageRoleRulesBySite.get('github')?.length).toBe(4);
    expect(compiled.objectClassifiersBySite.get('github')?.length).toBe(34);
  });

  it('Douyin placeholder still compiles to an empty registry on every axis', () => {
    const compiled = compileKnowledgeRegistry([DOUYIN_KNOWLEDGE_SEEDS]);
    expect(compiled.siteProfiles.size).toBe(0);
    expect(compiled.pageRoleRulesBySite.size).toBe(0);
    expect(compiled.objectClassifiersBySite.size).toBe(0);
    expect(compiled.uiMapRulesBySite.size).toBe(0);
  });
});
