import { describe, expect, it } from 'vitest';
import type {
  CandidateObject,
  ObjectLayerContext,
  PageObjectPriors,
} from '@/entrypoints/background/tools/browser/read-page-high-value-objects-core';
import { resolveObjectClassification } from '@/entrypoints/background/knowledge/lookup/resolve-object-classification';

/**
 * Stage 2 — unit tests for the Knowledge Registry object classifier
 * lookup. These tests exercise `resolveObjectClassification` directly
 * (without going through `githubObjectLayerAdapter`) so failures pinpoint
 * the registry code, not the consumer integration.
 *
 * Parity with the legacy TS classifier is exercised separately in
 * `read-page-high-value-objects-github.parity.test.ts`.
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

describe('resolveObjectClassification / URL rules (T5.4.5 parity)', () => {
  it('classifies `/actions/runs/<id>` href as workflow_run_entry', () => {
    const ctx = makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    });
    const candidate = makeCandidate({
      label: 'Fix bug',
      href: 'https://github.com/example/project/actions/runs/123456',
      role: 'link',
    });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result).not.toBeNull();
    expect(result?.objectType).toBe('record');
    expect(result?.objectSubType).toBe('github.workflow_run_entry');
    expect(result?.region).toBe('workflow_runs_list');
    expect(result?.classificationReasons[0]).toContain('workflow_run_entry');
  });

  it('classifies `/actions/workflows/*.yml` as workflow_file_entry', () => {
    const ctx = makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    });
    const candidate = makeCandidate({
      label: 'ci.yml',
      href: '/example/project/actions/workflows/ci.yml',
      role: 'link',
    });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectSubType).toBe('github.workflow_file_entry');
    expect(result?.objectType).toBe('control');
  });

  it('classifies bare `/actions` as workflow_filter_control (NOT workflow_run_entry)', () => {
    const ctx = makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    });
    const candidate = makeCandidate({
      label: 'All workflows',
      href: '/example/project/actions',
      role: 'link',
    });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectSubType).toBe('github.workflow_filter_control');
  });

  it('classifies `/security/code-scanning` as security_quality_tab', () => {
    const ctx = makeContext({
      pageRole: 'repo_home',
      primaryRegion: 'repo_primary_nav',
    });
    const candidate = makeCandidate({
      label: 'Code scanning',
      href: '/example/project/security/code-scanning',
      role: 'link',
    });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectSubType).toBe('github.security_quality_tab');
    expect(result?.objectType).toBe('nav_entry');
  });

  it('classifies generic `/security` as security_quality_tab', () => {
    const ctx = makeContext();
    const candidate = makeCandidate({
      label: 'Security',
      href: '/example/project/security',
      role: 'link',
    });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectSubType).toBe('github.security_quality_tab');
  });

  it('classifies a top-level repo tab href as repo_nav_tab', () => {
    const ctx = makeContext();
    const candidate = makeCandidate({
      label: 'Pull requests',
      href: '/example/project/pulls',
      role: 'link',
    });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectSubType).toBe('github.repo_nav_tab');
  });

  it('classifies href `#readme` as page_anchor with region falling back to context.primaryRegion', () => {
    const ctx = makeContext({ primaryRegion: 'repo_primary_nav' });
    const candidate = makeCandidate({ label: 'README', href: '#readme', role: 'link' });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectSubType).toBe('github.page_anchor');
    expect(result?.objectType).toBe('entry');
    expect(result?.region).toBe('repo_primary_nav');
  });

  it('returns null for a cross-repo href that does not match any rule', () => {
    const ctx = makeContext({ currentUrl: 'https://github.com/example/project' });
    const candidate = makeCandidate({
      label: 'Other repo',
      href: 'https://github.com/other/repo/blob/main/README.md',
      role: 'link',
    });
    expect(resolveObjectClassification({ siteId: 'github', candidate, context: ctx })).toBeNull();
  });
});

describe('resolveObjectClassification / label rules', () => {
  it('matches `search issues` in issues_list', () => {
    const ctx = makeContext({
      pageRole: 'issues_list',
      primaryRegion: 'issues_results',
      currentUrl: 'https://github.com/example/project/issues',
    });
    const candidate = makeCandidate({ label: 'Search Issues', role: 'searchbox' });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectType).toBe('control');
    expect(result?.region).toBe('issues_results');
    expect(result?.classificationReasons[0]).toContain('pageRole=issues_list');
  });

  it('matches `filter workflow runs` in actions_list', () => {
    const ctx = makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    });
    const candidate = makeCandidate({ label: 'Filter workflow runs', role: 'combobox' });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectType).toBe('control');
    expect(result?.region).toBe('workflow_runs_list');
  });

  it('matches `logs` in workflow_run_detail', () => {
    const ctx = makeContext({
      pageRole: 'workflow_run_detail',
      primaryRegion: 'workflow_run_summary',
      currentUrl: 'https://github.com/example/project/actions/runs/1',
    });
    const candidate = makeCandidate({ label: 'Logs', role: 'button' });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectType).toBe('status_item');
    expect(result?.region).toBe('workflow_run_summary');
  });

  it('matches `Issues` label in repo_home', () => {
    const ctx = makeContext({
      pageRole: 'repo_home',
      primaryRegion: 'repo_primary_nav',
    });
    const candidate = makeCandidate({ label: 'Issues', role: 'link' });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.objectType).toBe('nav_entry');
    expect(result?.region).toBe('repo_primary_nav');
  });
});

describe('resolveObjectClassification / pageRole scoping', () => {
  it('does not apply a repo_home label rule when pageRole is issues_list', () => {
    const ctx = makeContext({
      pageRole: 'issues_list',
      primaryRegion: 'issues_results',
      currentUrl: 'https://github.com/example/project/issues',
    });
    const candidate = makeCandidate({ label: 'Go to file', role: 'link' });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result).toBeNull();
  });
});

describe('resolveObjectClassification / origin prior', () => {
  it('appends "page_role_seed prior" when candidate.origin === "page_role_seed"', () => {
    const ctx = makeContext({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      currentUrl: 'https://github.com/example/project/actions',
    });
    const candidate = makeCandidate({
      label: 'Filter workflow runs',
      origin: 'page_role_seed',
      role: 'combobox',
    });
    const result = resolveObjectClassification({ siteId: 'github', candidate, context: ctx });
    expect(result?.classificationReasons).toContain('page_role_seed prior');
  });
});

describe('resolveObjectClassification / site scope', () => {
  it('returns null for an unknown siteId', () => {
    const ctx = makeContext();
    const candidate = makeCandidate({ label: 'Issues', role: 'link' });
    const result = resolveObjectClassification({ siteId: 'douyin', candidate, context: ctx });
    expect(result).toBeNull();
  });
});
