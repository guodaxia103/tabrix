import { describe, expect, it } from 'vitest';
import {
  classifyCandidateObject,
  scoreCandidateObject,
  type CandidateObject,
  type ObjectLayerContext,
  type PageObjectPriors,
  type ScoredCandidateObject,
} from '@/entrypoints/background/tools/browser/read-page-high-value-objects-core';
import { githubObjectLayerAdapter } from '@/entrypoints/background/tools/browser/read-page-high-value-objects-github';

/**
 * T5.4.3 invariants — importance/confidence scoring.
 *
 * Scoring is *not yet wired into the task protocol*; that happens at T5.4.4.
 * These tests exercise `scoreCandidateObject` directly to lock in the SoT
 * contract (importance and confidence both live in [0, 1], noise labels get
 * penalized, seed + region match outrank generic interactives).
 */

const EMPTY_PRIORS: PageObjectPriors = {
  priorityRule: null,
  seed: null,
  l0Prefix: null,
};

function makeContext(overrides: Partial<ObjectLayerContext> = {}): ObjectLayerContext {
  return {
    pageRole: 'repo_home',
    primaryRegion: 'repo_primary_nav',
    taskMode: 'read',
    currentUrl: 'https://github.com/example/project',
    priors: EMPTY_PRIORS,
    ...overrides,
  };
}

function classifyAndScore(
  candidate: CandidateObject,
  context: ObjectLayerContext,
): ScoredCandidateObject {
  const classified = classifyCandidateObject(candidate, context, [githubObjectLayerAdapter]);
  return scoreCandidateObject(classified, context, [githubObjectLayerAdapter]);
}

function seedCandidate(label: string, pageRole: string, index = 0): CandidateObject {
  return {
    id: `hvo_seed_${pageRole}_${index}`,
    label,
    sourceKind: 'dom_semantic',
    origin: 'page_role_seed',
    provenance: { seedPageRole: pageRole, seedIndex: index },
  };
}

function interactiveCandidate(
  label: string,
  options: Partial<CandidateObject> = {},
): CandidateObject {
  return {
    id: `hvo_ref_${label.replace(/\W+/g, '_')}`,
    label,
    ref: `ref_${label.replace(/\W+/g, '_')}`,
    role: 'link',
    sourceKind: 'dom_semantic',
    origin: 'interactive_element',
    ...options,
  };
}

describe('read_page high-value objects / scoring (T5.4.3)', () => {
  describe('clamping + basic contract', () => {
    it('importance and confidence stay within [0, 1]', () => {
      const context = makeContext();
      const s = classifyAndScore(seedCandidate('Issues', 'repo_home'), context);
      expect(s.importance).toBeGreaterThanOrEqual(0);
      expect(s.importance).toBeLessThanOrEqual(1);
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(s.scoringReasons[0]).toBe('base=0.50');
    });

    it('seed origin drives confidence to 0.85', () => {
      const context = makeContext();
      const s = classifyAndScore(seedCandidate('Issues', 'repo_home'), context);
      expect(s.confidence).toBeCloseTo(0.85, 5);
    });
  });

  describe('primaryRegion / pageRole alignment', () => {
    it('region match boosts importance', () => {
      const context = makeContext({ primaryRegion: 'repo_primary_nav' });
      const withMatch = classifyAndScore(seedCandidate('Issues', 'repo_home'), context);
      const mismatchCtx = makeContext({ primaryRegion: 'workflow_run_summary' });
      const noMatch = classifyAndScore(seedCandidate('Issues', 'repo_home'), mismatchCtx);
      expect(withMatch.importance).toBeGreaterThan(noMatch.importance);
    });

    it('github preferred-label boost makes seeds outrank generic interactives of same type', () => {
      const context = makeContext();
      const seedIssues = classifyAndScore(seedCandidate('Issues', 'repo_home'), context);
      const randomLink = classifyAndScore(interactiveCandidate('Some unrelated nav link'), context);
      expect(seedIssues.importance).toBeGreaterThan(randomLink.importance);
    });
  });

  describe('taskMode alignment', () => {
    it('status_item on workflow_run_detail aligns with monitor mode', () => {
      const context = makeContext({
        pageRole: 'workflow_run_detail',
        primaryRegion: 'workflow_run_summary',
        taskMode: 'monitor',
      });
      const s = classifyAndScore(seedCandidate('Summary', 'workflow_run_detail'), context);
      expect(
        s.scoringReasons.some((reason) => reason.includes('aligns with taskMode=monitor')),
      ).toBe(true);
    });
  });

  describe('noise downranking', () => {
    const context = makeContext();

    it('penalizes commit hash labels', () => {
      const s = classifyAndScore(interactiveCandidate('abc1234def5678', { role: 'link' }), context);
      expect(s.scoringReasons.some((reason) => reason.includes('noise=commit_hash'))).toBe(true);
      expect(s.importance).toBeLessThan(0.4);
    });

    it('penalizes duration labels like 15s / 3m / 2h', () => {
      for (const label of ['15s', '3m', '2h', '1d']) {
        const s = classifyAndScore(interactiveCandidate(label), context);
        expect(s.scoringReasons.some((reason) => reason.includes('noise=duration_timing'))).toBe(
          true,
        );
      }
    });

    it('penalizes commit and commitlint-prefixed labels', () => {
      const a = classifyAndScore(interactiveCandidate('Commit details'), context);
      expect(a.scoringReasons.some((r) => r.includes('noise=commit_prefix'))).toBe(true);
      const b = classifyAndScore(
        interactiveCandidate('fix(read_page): tighten semantic gate'),
        context,
      );
      expect(b.scoringReasons.some((r) => r.includes('noise=commitlint_prefix'))).toBe(true);
    });

    it('github scorePrior penalizes watch/star/pin/search-or-jump/open-copilot/skip-to-content', () => {
      const cases: Array<[string, string]> = [
        ['Watch', 'github_noise=watch_star_pin'],
        ['Star', 'github_noise=watch_star_pin'],
        ['Pin this repository', 'github_noise=watch_star_pin'],
        ['Search or jump to...', 'github_noise=search_or_jump'],
        ['Open Copilot...', 'github_noise=open_copilot'],
        ['Skip to content', 'github_noise=skip_to_content'],
      ];
      for (const [label, reasonFragment] of cases) {
        const s = classifyAndScore(interactiveCandidate(label), context);
        expect(
          s.scoringReasons.some((reason) => reason.includes(reasonFragment)),
          `expected ${label} -> ${reasonFragment}`,
        ).toBe(true);
        expect(s.importance).toBeLessThan(0.4);
      }
    });

    it('very long labels lose importance', () => {
      const longLabel = 'This is an excessively long interactive element label '.repeat(3);
      const s = classifyAndScore(interactiveCandidate(longLabel), context);
      expect(s.scoringReasons.some((r) => r.includes('label_too_long'))).toBe(true);
    });
  });

  describe('ranking comparisons for GitHub baseline', () => {
    function scoreFor(label: string, pageRole: string, primaryRegion: string): number {
      const ctx = makeContext({ pageRole, primaryRegion, taskMode: null });
      return classifyAndScore(seedCandidate(label, pageRole), ctx).importance;
    }

    it('repo_home: Issues > Go to file > Watch', () => {
      const issues = scoreFor('Issues', 'repo_home', 'repo_primary_nav');
      const gotoFile = scoreFor('Go to file', 'repo_home', 'repo_primary_nav');
      const watch = classifyAndScore(
        interactiveCandidate('Watch'),
        makeContext({ pageRole: 'repo_home', primaryRegion: 'repo_primary_nav' }),
      ).importance;
      expect(issues).toBeGreaterThan(gotoFile);
      expect(gotoFile).toBeGreaterThan(watch);
    });

    it('issues_list: Search Issues > generic interactive > Search or jump to', () => {
      const searchIssues = scoreFor('Search Issues', 'issues_list', 'issues_results');
      const generic = classifyAndScore(
        interactiveCandidate('Mark issue as read'),
        makeContext({ pageRole: 'issues_list', primaryRegion: 'issues_results' }),
      ).importance;
      const jump = classifyAndScore(
        interactiveCandidate('Search or jump to...'),
        makeContext({ pageRole: 'issues_list', primaryRegion: 'issues_results' }),
      ).importance;
      expect(searchIssues).toBeGreaterThan(generic);
      expect(generic).toBeGreaterThan(jump);
    });

    it('workflow_run_detail: Summary > Artifacts > version string', () => {
      const summary = scoreFor('Summary', 'workflow_run_detail', 'workflow_run_summary');
      const artifacts = scoreFor('Artifacts', 'workflow_run_detail', 'workflow_run_summary');
      const version = classifyAndScore(
        interactiveCandidate('v2.0.9'),
        makeContext({
          pageRole: 'workflow_run_detail',
          primaryRegion: 'workflow_run_summary',
        }),
      ).importance;
      expect(summary).toBeGreaterThan(artifacts);
      expect(artifacts).toBeGreaterThan(version);
    });
  });
});
