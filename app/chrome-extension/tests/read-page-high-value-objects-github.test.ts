import { describe, expect, it } from 'vitest';
import type { ReadPageCandidateAction, ReadPageInteractiveElement } from '@tabrix/shared';
import {
  classifyCandidateObject,
  collectCandidateObjects,
  type CandidateObject,
  type ObjectLayerContext,
  type ObjectLayerFamilyAdapter,
  type PageObjectPriors,
} from '@/entrypoints/background/tools/browser/read-page-high-value-objects-core';
import { githubObjectLayerAdapter } from '@/entrypoints/background/tools/browser/read-page-high-value-objects-github';

/**
 * T5.4.2 invariants — GitHub family four-layer adapter.
 *
 * These tests exercise candidate collection and classification ONLY. The
 * real scoring layer lands in T5.4.3 and wiring into the task protocol lands
 * in T5.4.4; those behaviours are out of scope here.
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
    taskMode: null,
    currentUrl: 'https://github.com/example/project',
    priors: EMPTY_PRIORS,
    ...overrides,
  };
}

function makeCandidateAction(
  overrides: Partial<ReadPageCandidateAction> = {},
): ReadPageCandidateAction {
  return {
    id: 'ca_1',
    actionType: 'click',
    targetRef: 'ref_1',
    confidence: 0.7,
    matchReason: 'primary nav',
    locatorChain: [],
    ...overrides,
  };
}

function makeInteractive(
  overrides: Partial<ReadPageInteractiveElement> = {},
): ReadPageInteractiveElement {
  return { ref: 'ref_1', role: 'link', name: 'Example', ...overrides };
}

describe('read_page high-value objects / github family (T5.4.2)', () => {
  describe('collectCandidateObjects', () => {
    it('returns only DOM-derived candidates when no adapter is registered', () => {
      const context = makeContext();
      const candidates = collectCandidateObjects(
        context,
        {
          interactiveElements: [makeInteractive({ ref: 'ref_a', role: 'link', name: 'Issues' })],
          candidateActions: [],
        },
        [],
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.origin).toBe('interactive_element');
      expect(candidates.some((c) => c.origin === 'page_role_seed')).toBe(false);
    });

    it('merges candidate actions, interactives and github seeds with dedup', () => {
      const context = makeContext();
      const candidates = collectCandidateObjects(
        context,
        {
          interactiveElements: [
            makeInteractive({ ref: 'ref_issues', role: 'link', name: 'Issues' }),
            makeInteractive({ ref: 'ref_actions', role: 'link', name: 'Actions' }),
            makeInteractive({ ref: 'ref_gotofile', role: 'button', name: 'Go to file' }),
          ],
          candidateActions: [
            makeCandidateAction({
              id: 'ca_go_to_file',
              targetRef: 'ref_gotofile',
              matchReason: 'user wants to open file',
            }),
          ],
        },
        [githubObjectLayerAdapter],
      );

      const origins = candidates.map((c) => c.origin);
      expect(origins).toContain('candidate_action');
      expect(origins).toContain('interactive_element');
      expect(origins).toContain('page_role_seed');

      const refs = candidates.map((c) => c.ref).filter(Boolean);
      const refDupes = new Set(refs).size !== refs.length;
      expect(refDupes).toBe(false);

      const seedCount = candidates.filter((c) => c.origin === 'page_role_seed').length;
      expect(seedCount).toBe(3);

      const gotoFileEntry = candidates.find((c) => c.ref === 'ref_gotofile');
      expect(gotoFileEntry?.origin).toBe('candidate_action');
    });

    it('does not emit seeds for pageRoles the adapter does not own', () => {
      const context = makeContext({ pageRole: 'web_page', primaryRegion: null });
      const candidates = collectCandidateObjects(
        context,
        {
          interactiveElements: [makeInteractive()],
          candidateActions: [],
        },
        [githubObjectLayerAdapter],
      );
      expect(candidates.some((c) => c.origin === 'page_role_seed')).toBe(false);
    });
  });

  describe('classifyCandidateObject (github)', () => {
    function seed(label: string, pageRole: string): CandidateObject {
      return {
        id: `hvo_seed_${pageRole}_x`,
        label,
        sourceKind: 'dom_semantic',
        origin: 'page_role_seed',
      };
    }

    it('maps repo_home primary nav labels to nav_entry', () => {
      const context = makeContext({ pageRole: 'repo_home', primaryRegion: 'repo_primary_nav' });
      for (const label of ['Issues', 'Pull requests', 'Actions']) {
        const result = classifyCandidateObject(seed(label, 'repo_home'), context, [
          githubObjectLayerAdapter,
        ]);
        expect(result.objectType).toBe('nav_entry');
        expect(result.region).toBe('repo_primary_nav');
      }
    });

    it('maps issues_list controls and entries correctly', () => {
      const context = makeContext({ pageRole: 'issues_list', primaryRegion: 'issues_results' });
      const control = classifyCandidateObject(seed('Search Issues', 'issues_list'), context, [
        githubObjectLayerAdapter,
      ]);
      expect(control.objectType).toBe('control');

      const newIssue = classifyCandidateObject(seed('New issue', 'issues_list'), context, [
        githubObjectLayerAdapter,
      ]);
      expect(newIssue.objectType).toBe('control');

      const entries = classifyCandidateObject(seed('Issue entries', 'issues_list'), context, [
        githubObjectLayerAdapter,
      ]);
      expect(entries.objectType).toBe('record');
    });

    it('maps actions_list entries and controls correctly', () => {
      const context = makeContext({
        pageRole: 'actions_list',
        primaryRegion: 'workflow_runs_list',
      });
      const filter = classifyCandidateObject(
        seed('Filter workflow runs', 'actions_list'),
        context,
        [githubObjectLayerAdapter],
      );
      expect(filter.objectType).toBe('control');

      const runEntries = classifyCandidateObject(
        seed('Workflow run entries', 'actions_list'),
        context,
        [githubObjectLayerAdapter],
      );
      expect(runEntries.objectType).toBe('record');

      const runDetail = classifyCandidateObject(seed('Run detail entry', 'actions_list'), context, [
        githubObjectLayerAdapter,
      ]);
      expect(runDetail.objectType).toBe('entry');
    });

    it('maps workflow_run_detail diagnostics labels to status_item', () => {
      const context = makeContext({
        pageRole: 'workflow_run_detail',
        primaryRegion: 'workflow_run_summary',
      });
      for (const label of ['Summary', 'Jobs', 'Artifacts', 'Logs', 'Annotations']) {
        const result = classifyCandidateObject(seed(label, 'workflow_run_detail'), context, [
          githubObjectLayerAdapter,
        ]);
        expect(result.objectType).toBe('status_item');
        expect(result.region).toBe('workflow_run_summary');
      }
    });

    it('falls back to neutral role-based classification for unknown labels on GitHub', () => {
      const context = makeContext({ pageRole: 'repo_home', primaryRegion: 'repo_primary_nav' });
      const control = classifyCandidateObject(
        {
          id: 'hvo_button_x',
          label: 'Some custom button',
          role: 'button',
          sourceKind: 'dom_semantic',
          origin: 'interactive_element',
        },
        context,
        [githubObjectLayerAdapter],
      );
      expect(control.objectType).toBe('control');
    });

    it('classifies non-github roles via neutral fallback only', () => {
      const context = makeContext({ pageRole: 'web_page', primaryRegion: null });
      const result = classifyCandidateObject(
        {
          id: 'hvo_link_x',
          label: 'Somewhere',
          role: 'link',
          sourceKind: 'dom_semantic',
          origin: 'interactive_element',
        },
        context,
        [githubObjectLayerAdapter],
      );
      expect(result.objectType).toBe('entry');
      expect(result.classificationReasons[0]).toContain('neutral');
    });
  });

  describe('adapter boundary', () => {
    it('owns exactly the four GitHub pageRoles currently seeded', () => {
      const ownedRoles: string[] = [];
      for (const role of [
        'repo_home',
        'issues_list',
        'actions_list',
        'workflow_run_detail',
        'workflow_run_shell',
        'login_required',
        'web_page',
      ]) {
        if (githubObjectLayerAdapter.owns(role)) {
          ownedRoles.push(role);
        }
      }
      expect(new Set(ownedRoles)).toEqual(
        new Set(['repo_home', 'issues_list', 'actions_list', 'workflow_run_detail']),
      );
    });

    it('multiple owning adapters are tried in registration order until one returns a classification', () => {
      const tracker: string[] = [];
      const noop: ObjectLayerFamilyAdapter = {
        family: 'test-noop',
        owns: () => true,
        classify: () => {
          tracker.push('noop');
          return null;
        },
      };
      const context = makeContext({ pageRole: 'repo_home', primaryRegion: 'repo_primary_nav' });
      const result = classifyCandidateObject(
        {
          id: 'hvo_seed_repo_home_0',
          label: 'Issues',
          sourceKind: 'dom_semantic',
          origin: 'page_role_seed',
        },
        context,
        [noop, githubObjectLayerAdapter],
      );
      expect(tracker).toEqual(['noop']);
      expect(result.objectType).toBe('nav_entry');
    });
  });
});
