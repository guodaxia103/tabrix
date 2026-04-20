import { describe, expect, it } from 'vitest';
import { buildUnderstandingContext } from '@/entrypoints/background/tools/browser/read-page-understanding-core';
import { resolveSiteProfile } from '@/entrypoints/background/knowledge/lookup/resolve-site-profile';
import { resolvePageRole } from '@/entrypoints/background/knowledge/lookup/resolve-page-role';

describe('knowledge-lookup resolveSiteProfile', () => {
  it('identifies github.com hosts', () => {
    const siteId = resolveSiteProfile('https://github.com/example/project');
    expect(siteId).toBe('github');
  });

  it('identifies github.com paths regardless of case', () => {
    const siteId = resolveSiteProfile('https://github.com/Example/Project/issues'.toLowerCase());
    expect(siteId).toBe('github');
  });

  it('returns null for sites with no stage 1 seeds', () => {
    expect(resolveSiteProfile('https://www.douyin.com/')).toBeNull();
    expect(resolveSiteProfile('https://example.com/anything')).toBeNull();
  });

  it('returns null for unparseable urls', () => {
    expect(resolveSiteProfile('not-a-url')).toBeNull();
  });
});

describe('knowledge-lookup resolvePageRole', () => {
  function understand(url: string, title: string, content: string) {
    const context = buildUnderstandingContext(url, title, content);
    const siteId = resolveSiteProfile(context.lowerUrl);
    if (!siteId) return null;
    return resolvePageRole({ siteId, context });
  }

  it('classifies repo_home with primary navigation hints', () => {
    const hit = understand(
      'https://github.com/example/project',
      'example/project',
      'Issues Pull requests Actions Go to file Code',
    );
    expect(hit).toMatchObject({
      pageRole: 'repo_home',
      primaryRegion: 'repo_primary_nav',
      primaryRegionConfidence: 'medium',
    });
  });

  it('classifies issues_list with issue filter controls', () => {
    const hit = understand(
      'https://github.com/example/project/issues',
      'Issues · example/project',
      'Search Issues Filter by assignee New issue',
    );
    expect(hit).toMatchObject({
      pageRole: 'issues_list',
      primaryRegion: 'issues_results',
      primaryRegionConfidence: 'high',
    });
  });

  it('classifies actions_list when run controls appear', () => {
    const hit = understand(
      'https://github.com/example/project/actions',
      'Actions · example/project',
      'Filter workflow runs completed successfully: Run 1052 of CI',
    );
    expect(hit).toMatchObject({
      pageRole: 'actions_list',
      primaryRegion: 'workflow_runs_list',
      primaryRegionConfidence: 'high',
    });
  });

  it('promotes workflow_run_detail when summary signals win', () => {
    const hit = understand(
      'https://github.com/example/project/actions/runs/42',
      'Release Tabrix',
      'Summary Show all jobs Jobs Artifacts Logs',
    );
    expect(hit).toMatchObject({
      pageRole: 'workflow_run_detail',
      primaryRegion: 'workflow_run_summary',
      primaryRegionConfidence: 'high',
    });
  });

  it('demotes workflow_run_shell when only shell hints are visible', () => {
    const hit = understand(
      'https://github.com/example/project/actions/runs/42',
      'Release Tabrix',
      'Workflow run Loading Checks',
    );
    expect(hit).toMatchObject({
      pageRole: 'workflow_run_shell',
      primaryRegion: 'workflow_run_shell',
    });
  });

  it('returns null when no page role rule matches', () => {
    const hit = understand(
      'https://github.com/example/project/pulls',
      'Pull requests',
      'Some body',
    );
    expect(hit).toBeNull();
  });
});
