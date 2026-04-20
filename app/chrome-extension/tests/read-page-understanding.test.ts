import { describe, expect, it } from 'vitest';
import { buildUnderstandingContext } from '@/entrypoints/background/tools/browser/read-page-understanding-core';
import { githubPageFamilyAdapter } from '@/entrypoints/background/tools/browser/read-page-understanding-github';
import { inferPageUnderstanding } from '@/entrypoints/background/tools/browser/read-page-understanding';

describe('read_page understanding', () => {
  it('routes github pages through the github family adapter', () => {
    const summary = githubPageFamilyAdapter.infer(
      buildUnderstandingContext(
        'https://github.com/example/project/issues',
        'Issues · example/project',
        'Search Issues Filter by assignee New issue',
      ),
    );

    expect(summary).toMatchObject({
      pageRole: 'issues_list',
      primaryRegion: 'issues_results',
      primaryRegionConfidence: 'high',
    });
  });

  it('returns null from github family adapter for non-github pages', () => {
    const summary = githubPageFamilyAdapter.infer(
      buildUnderstandingContext('https://example.com/signin', '登录', '手机号 验证码 登录'),
    );

    expect(summary).toBeNull();
  });

  it('detects repo_home from repo url and primary navigation signals', () => {
    const summary = inferPageUnderstanding(
      'https://github.com/example/project',
      'example/project',
      'Issues Pull requests Actions Go to file Code',
    );

    expect(summary.pageRole).toBe('repo_home');
    expect(summary.primaryRegion).toBe('repo_primary_nav');
    expect(summary.primaryRegionConfidence).toBe('medium');
  });

  it('prefers repo_primary_nav over repo_shell when task navigation and shell hints both exist', () => {
    const summary = inferPageUnderstanding(
      'https://github.com/example/project',
      'example/project',
      'Go to file Code README Latest commit main branch',
    );

    expect(summary.pageRole).toBe('repo_home');
    expect(summary.primaryRegion).toBe('repo_primary_nav');
    expect(summary.primaryRegionConfidence).toBe('medium');
  });

  it('keeps repo_home pageRole but falls back to repo_shell when only shell signals are visible', () => {
    const summary = inferPageUnderstanding(
      'https://github.com/example/project',
      'example/project',
      'Code README Latest commit main branch',
    );

    expect(summary.pageRole).toBe('repo_home');
    expect(summary.primaryRegion).toBe('repo_shell');
    expect(summary.primaryRegionConfidence).toBe('low');
  });

  it('detects issues_list from url and issue controls', () => {
    const summary = inferPageUnderstanding(
      'https://github.com/example/project/issues',
      'Issues · example/project',
      'Search Issues Filter by assignee New issue',
    );

    expect(summary.pageRole).toBe('issues_list');
    expect(summary.primaryRegion).toBe('issues_results');
    expect(summary.primaryRegionConfidence).toBe('high');
  });

  it('detects actions_list from workflow list controls', () => {
    const summary = inferPageUnderstanding(
      'https://github.com/example/project/actions',
      'Actions · example/project',
      'Filter workflow runs completed successfully: Run 1052 of CI',
    );

    expect(summary.pageRole).toBe('actions_list');
    expect(summary.primaryRegion).toBe('workflow_runs_list');
    expect(summary.primaryRegionConfidence).toBe('high');
  });

  it('detects workflow_run_detail only when workflow diagnostics are visible', () => {
    const summary = inferPageUnderstanding(
      'https://github.com/example/project/actions/runs/42',
      'Release Tabrix',
      'Summary Show all jobs Jobs Artifacts Logs',
    );

    expect(summary.pageRole).toBe('workflow_run_detail');
    expect(summary.primaryRegion).toBe('workflow_run_summary');
    expect(summary.primaryRegionConfidence).toBe('high');
  });

  it('prefers workflow_run_summary over workflow_run_shell when both shell and diagnostics hints exist', () => {
    const summary = inferPageUnderstanding(
      'https://github.com/example/project/actions/runs/42',
      'Release Tabrix',
      'Actions Run 42 Loading Summary Show all jobs Jobs Artifacts Logs',
    );

    expect(summary.pageRole).toBe('workflow_run_detail');
    expect(summary.primaryRegion).toBe('workflow_run_summary');
    expect(summary.primaryRegionConfidence).toBe('high');
  });

  it('keeps pageRole=workflow_run_detail even when only the shell has hydrated, but reports primaryRegion=workflow_run_shell', () => {
    // T5.4.5 contract: pageRole is URL-derived (stable navigation identity);
    // primaryRegion is content-derived (hydration progress). A freshly clicked
    // /actions/runs/<id> URL must NOT regress pageRole to workflow_run_shell
    // just because the detail body has not rendered yet — that broke
    // downstream consumers that treat pageRole as the page's identity.
    const summary = inferPageUnderstanding(
      'https://github.com/example/project/actions/runs/42',
      'Release Tabrix',
      'Actions Run 42 Loading',
    );

    expect(summary.pageRole).toBe('workflow_run_detail');
    expect(summary.primaryRegion).toBe('workflow_run_shell');
    expect(summary.primaryRegionConfidence).toBe('medium');
  });

  it('detects login_required from title and visible login controls', () => {
    const summary = inferPageUnderstanding(
      'https://example.com/signin',
      'Sign in',
      '手机号 验证码 登录',
    );

    expect(summary.pageRole).toBe('login_required');
    expect(summary.primaryRegion).toBe('login_gate');
    expect(summary.primaryRegionConfidence).toBe('high');
  });

  it('falls back to outer_shell for footer-only content', () => {
    const summary = inferPageUnderstanding(
      'https://example.com',
      'Example',
      '用户服务协议 隐私政策 联系我们',
    );

    expect(summary.pageRole).toBe('outer_shell');
    expect(summary.primaryRegion).toBe('footer_shell');
    expect(summary.primaryRegionConfidence).toBe('low');
    expect(summary.footerOnly).toBe(true);
  });
});
