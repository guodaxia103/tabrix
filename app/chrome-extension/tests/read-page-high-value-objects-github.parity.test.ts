import { describe, expect, it } from 'vitest';
import type {
  CandidateObject,
  ClassifiedCandidateObject,
  ObjectLayerContext,
  PageObjectPriors,
} from '@/entrypoints/background/tools/browser/read-page-high-value-objects-core';
import {
  githubObjectLayerAdapter,
  __githubLegacyClassifyForTest,
} from '@/entrypoints/background/tools/browser/read-page-high-value-objects-github';

/**
 * Stage 2 parity suite — asserts the Knowledge Registry path
 * (`githubObjectLayerAdapter.classify`, registry-first when
 * `KNOWLEDGE_REGISTRY_MODE='on'`) produces the same classification as
 * the legacy TS classifier body for GitHub fixtures.
 *
 * If any assertion fails, either:
 *   - the Stage 2 seeds drifted from the hardcoded rules, or
 *   - the lookup algorithm differs from `legacyGithubClassify`.
 *
 * Production ships with `KNOWLEDGE_REGISTRY_MODE='on'`. This test is the
 * safety net for that default.
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

function makeCandidate(overrides: Partial<CandidateObject> = {}): CandidateObject {
  return {
    id: 'c_1',
    label: 'Label',
    sourceKind: 'dom_semantic',
    origin: 'interactive_element',
    ...overrides,
  };
}

interface ParityFixture {
  readonly name: string;
  readonly context: ObjectLayerContext;
  readonly candidate: CandidateObject;
}

const PARITY_FIXTURES: readonly ParityFixture[] = [
  // URL rules (T5.4.5 origin)
  {
    name: 'url: /actions/runs/<id> -> workflow_run_entry',
    context: makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    }),
    candidate: makeCandidate({
      label: 'Fix bug',
      href: 'https://github.com/example/project/actions/runs/123',
      role: 'link',
    }),
  },
  {
    name: 'url: /actions/workflows/*.yml -> workflow_file_entry',
    context: makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    }),
    candidate: makeCandidate({
      label: 'ci.yml',
      href: '/example/project/actions/workflows/ci.yml',
      role: 'link',
    }),
  },
  {
    name: 'url: /actions(?query) -> workflow_filter_control',
    context: makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    }),
    candidate: makeCandidate({
      label: 'All workflows',
      href: '/example/project/actions',
      role: 'link',
    }),
  },
  {
    name: 'url: /security/code-scanning -> security_quality_tab',
    context: makeContext(),
    candidate: makeCandidate({
      label: 'Code scanning',
      href: '/example/project/security/code-scanning',
      role: 'link',
    }),
  },
  {
    name: 'url: /security -> security_quality_tab',
    context: makeContext(),
    candidate: makeCandidate({
      label: 'Security',
      href: '/example/project/security',
      role: 'link',
    }),
  },
  {
    name: 'url: top-level repo tab -> repo_nav_tab',
    context: makeContext(),
    candidate: makeCandidate({
      label: 'Pull requests',
      href: '/example/project/pulls',
      role: 'link',
    }),
  },
  {
    name: 'url: hash href -> page_anchor',
    context: makeContext(),
    candidate: makeCandidate({ label: 'Readme', href: '#readme', role: 'link' }),
  },

  // Label rules per pageRole
  {
    name: 'label: repo_home / Issues',
    context: makeContext({ pageRole: 'repo_home', primaryRegion: 'repo_primary_nav' }),
    candidate: makeCandidate({ label: 'Issues', role: 'link' }),
  },
  {
    name: 'label: issues_list / Search Issues',
    context: makeContext({
      pageRole: 'issues_list',
      primaryRegion: 'issues_results',
      currentUrl: 'https://github.com/example/project/issues',
    }),
    candidate: makeCandidate({ label: 'Search Issues', role: 'searchbox' }),
  },
  {
    name: 'label: actions_list / Filter workflow runs',
    context: makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    }),
    candidate: makeCandidate({ label: 'Filter workflow runs', role: 'combobox' }),
  },
  {
    name: 'label: workflow_run_detail / Logs',
    context: makeContext({
      pageRole: 'workflow_run_detail',
      primaryRegion: 'workflow_run_summary',
      currentUrl: 'https://github.com/example/project/actions/runs/1',
    }),
    candidate: makeCandidate({ label: 'Logs', role: 'button' }),
  },

  // ARIA fallback (NOT migrated in Stage 2; should still reach legacy via fallback)
  {
    name: 'aria fallback: link without href -> entry',
    context: makeContext(),
    candidate: makeCandidate({ label: 'Avatar', role: 'link' }),
  },
  {
    name: 'aria fallback: button -> control',
    context: makeContext({
      pageRole: 'workflow_run_detail',
      primaryRegion: 'workflow_run_summary',
    }),
    candidate: makeCandidate({ label: 'Unknown', role: 'button' }),
  },

  // Negatives — neither URL nor label nor aria fallback fires
  {
    name: 'negative: unknown role + unknown label -> null',
    context: makeContext({ pageRole: 'actions_list', primaryRegion: 'workflow_runs_list' }),
    candidate: makeCandidate({ label: 'Nobody Cares', role: 'heading' }),
  },
  {
    name: 'negative: cross-repo href + unknown role -> null',
    context: makeContext({ currentUrl: 'https://github.com/example/project' }),
    candidate: makeCandidate({
      label: 'Somewhere',
      href: 'https://github.com/other/repo/tree/main',
      role: 'heading',
    }),
  },
];

function normalize(result: ClassifiedCandidateObject | null): unknown {
  if (!result) return null;
  return {
    objectType: result.objectType,
    objectSubType: result.objectSubType ?? null,
    region: result.region ?? null,
    classificationReasons: result.classificationReasons,
  };
}

describe('github object classifier — parity (registry-first vs legacy)', () => {
  for (const fixture of PARITY_FIXTURES) {
    it(fixture.name, () => {
      const viaAdapter = githubObjectLayerAdapter.classify!(fixture.candidate, fixture.context);
      const viaLegacy = __githubLegacyClassifyForTest(fixture.candidate, fixture.context);
      expect(normalize(viaAdapter)).toEqual(normalize(viaLegacy));
    });
  }
});
