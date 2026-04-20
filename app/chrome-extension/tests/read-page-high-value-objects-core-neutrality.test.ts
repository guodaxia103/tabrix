import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyPriorityRuleMatch,
  resolvePageObjectPriors,
  type PageObjectFamilyAdapter,
} from '@/entrypoints/background/tools/browser/read-page-high-value-objects-core';

/**
 * T5.4.0 Object-Layer Core Neutrality Invariants
 *
 * These tests enforce that `read-page-high-value-objects-core.ts` stays
 * family-agnostic. Any GitHub-specific vocabulary, Douyin-specific vocabulary,
 * or page-role literal re-introduced into core MUST fail these checks. Family
 * priors belong exclusively in sibling `read-page-high-value-objects-<family>`
 * modules behind the `PageObjectFamilyAdapter` contract.
 */
describe('read_page high-value object core neutrality', () => {
  const coreFilePath = resolve(
    __dirname,
    '..',
    'entrypoints',
    'background',
    'tools',
    'browser',
    'read-page-high-value-objects-core.ts',
  );
  const coreFileSource = readFileSync(coreFilePath, 'utf8');

  it('core source contains no GitHub-specific page-role literals', () => {
    const forbiddenRoles = [
      "'repo_home'",
      "'issues_list'",
      "'actions_list'",
      "'workflow_run_detail'",
    ];
    for (const forbidden of forbiddenRoles) {
      expect(coreFileSource).not.toContain(forbidden);
    }
  });

  it('core source contains no GitHub-specific priors vocabulary', () => {
    const forbiddenPhrases = [
      'pull requests',
      'workflow run',
      'Primary repo entry points',
      'Primary issue controls',
      'Primary workflow run entries',
      'Primary workflow diagnostics',
      'Search Issues',
      'Filter issues',
      'Filter workflow runs',
    ];
    for (const forbidden of forbiddenPhrases) {
      expect(coreFileSource).not.toContain(forbidden);
    }
  });

  it('core source contains no site-specific Douyin vocabulary', () => {
    const forbiddenDouyinStrings = ['视频总榜', '话题榜', '热度趋势', '热度值', '播放量', '抖音'];
    for (const forbidden of forbiddenDouyinStrings) {
      expect(coreFileSource).not.toContain(forbidden);
    }
  });

  it('resolvePageObjectPriors returns empty priors when no adapters apply', () => {
    const priors = resolvePageObjectPriors([], 'unknown-role');
    expect(priors.priorityRule).toBeNull();
    expect(priors.seed).toBeNull();
    expect(priors.l0Prefix).toBeNull();
  });

  it('resolvePageObjectPriors returns empty priors when every adapter returns null', () => {
    const adapters: PageObjectFamilyAdapter[] = [
      { family: 'a', resolve: () => null },
      { family: 'b', resolve: () => null },
    ];
    const priors = resolvePageObjectPriors(adapters, 'repo_home');
    expect(priors.priorityRule).toBeNull();
    expect(priors.seed).toBeNull();
    expect(priors.l0Prefix).toBeNull();
  });

  it('resolvePageObjectPriors picks the first adapter that returns non-null priors', () => {
    const adapters: PageObjectFamilyAdapter[] = [
      { family: 'a', resolve: () => null },
      {
        family: 'b',
        resolve: () => ({
          priorityRule: { primary: [/\bhit\b/i] },
          seed: { labels: ['Label'], reason: 'r' },
          l0Prefix: 'pref',
        }),
      },
      {
        family: 'c',
        resolve: () => ({
          priorityRule: { primary: [/\bother\b/i] },
          seed: null,
          l0Prefix: 'other',
        }),
      },
    ];
    const priors = resolvePageObjectPriors(adapters, 'anything');
    expect(priors.l0Prefix).toBe('pref');
    expect(priors.seed?.labels).toEqual(['Label']);
    expect(priors.priorityRule?.primary[0].test('hit')).toBe(true);
  });

  it('applyPriorityRuleMatch returns 0 for null rule', () => {
    expect(applyPriorityRuleMatch(null, 'anything')).toBe(0);
  });

  it('applyPriorityRuleMatch scores primary matches higher than tertiary matches', () => {
    const rule = {
      primary: [/\bprimary\b/i],
      tertiary: [/\btertiary\b/i],
    };
    const primaryScore = applyPriorityRuleMatch(rule, 'some primary label');
    const tertiaryScore = applyPriorityRuleMatch(rule, 'some tertiary label');
    expect(primaryScore).toBeGreaterThan(tertiaryScore);
    expect(primaryScore).toBeGreaterThan(0);
    expect(tertiaryScore).toBeGreaterThan(0);
  });

  it('applyPriorityRuleMatch penalizes deprioritize matches', () => {
    const rule = {
      primary: [/\bx\b/i],
      deprioritize: [/\bbad\b/i],
    };
    expect(applyPriorityRuleMatch(rule, 'something bad')).toBeLessThan(0);
  });

  it('applyPriorityRuleMatch applies later-index penalties for secondary patterns', () => {
    const rule = {
      primary: [/\ba\b/i],
      secondary: [/\bfirst\b/i, /\bsecond\b/i],
    };
    const firstScore = applyPriorityRuleMatch(rule, 'the first');
    const secondScore = applyPriorityRuleMatch(rule, 'the second');
    expect(firstScore).toBeGreaterThan(secondScore);
  });
});
