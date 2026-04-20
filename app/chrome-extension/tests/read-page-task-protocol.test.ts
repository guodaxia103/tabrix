import { describe, expect, it } from 'vitest';
import { buildTaskProtocol } from '@/entrypoints/background/tools/browser/read-page-task-protocol';

function createBaseParams(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'compact' as const,
    currentUrl: 'https://example.com',
    currentTitle: 'Example',
    pageType: 'web_page',
    pageRole: 'web_page',
    primaryRegion: null,
    interactiveElements: [] as any[],
    candidateActions: [] as any[],
    artifactRefs: [
      { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/normal' },
      { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/full' },
    ],
    pageContext: {
      filter: 'interactive',
      depth: 3,
      focus: null,
      scheme: 'https',
      viewport: { width: 1280, height: 720, dpr: 1 },
      sparse: false,
      fallbackUsed: false,
      fallbackSource: null,
      refMapCount: 4,
      markedElementsCount: 0,
    },
    contentSummary: {
      charCount: 1000,
      normalizedLength: 900,
      lineCount: 24,
      quality: 'usable',
    },
    ...overrides,
  };
}

describe('read_page task protocol', () => {
  it('keeps workflow_run_shell in monitor mode before detail diagnostics are visible', () => {
    const protocol = buildTaskProtocol({
      mode: 'compact',
      currentUrl: 'https://github.com/example/project/actions/runs/42',
      currentTitle: 'Release Tabrix',
      pageType: 'web_page',
      pageRole: 'workflow_run_shell',
      primaryRegion: 'workflow_run_shell',
      interactiveElements: [
        { ref: 'ref_actions', role: 'link', name: 'Actions' },
        { ref: 'ref_run', role: 'link', name: 'Run 42' },
      ],
      candidateActions: [
        {
          id: 'ca_click_ref_run',
          actionType: 'click',
          targetRef: 'ref_run',
          confidence: 0.72,
          matchReason: 'interactive clickable candidate from structured snapshot',
          locatorChain: [{ type: 'aria', value: 'Run 42' }],
        },
      ],
      artifactRefs: [
        { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/normal' },
        { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/full' },
      ],
      pageContext: {
        filter: 'interactive',
        depth: 3,
        focus: null,
        scheme: 'https',
        viewport: { width: 1280, height: 720, dpr: 1 },
        sparse: false,
        fallbackUsed: false,
        fallbackSource: null,
        refMapCount: 2,
        markedElementsCount: 0,
      },
      contentSummary: {
        charCount: 320,
        normalizedLength: 280,
        lineCount: 8,
        quality: 'usable',
      },
    });

    expect(protocol.taskMode).toBe('monitor');
  });

  it('prioritizes repo navigation over commit headlines on repo_home', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://github.com/example/project',
        currentTitle: 'example/project',
        pageRole: 'repo_home',
        primaryRegion: 'repo_primary_nav',
        interactiveElements: [
          {
            ref: 'ref_commit',
            role: 'link',
            name: 'fix(t4): stabilize workflow run detail baseline for v2.0.9 release',
          },
          { ref: 'ref_issues', role: 'link', name: 'Issues' },
          { ref: 'ref_pulls', role: 'link', name: 'Pull requests' },
          { ref: 'ref_actions', role: 'link', name: 'Actions' },
        ],
        candidateActions: [
          {
            id: 'ca_click_ref_commit',
            actionType: 'click',
            targetRef: 'ref_commit',
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [
              {
                type: 'aria',
                value: 'fix(t4): stabilize workflow run detail baseline for v2.0.9 release',
              },
            ],
          },
          {
            id: 'ca_click_ref_issues',
            actionType: 'click',
            targetRef: 'ref_issues',
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Issues' }],
          },
          {
            id: 'ca_click_ref_actions',
            actionType: 'click',
            targetRef: 'ref_actions',
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Actions' }],
          },
        ],
      }),
    );

    expect(protocol.taskMode).toBe('read');
    expect(protocol.highValueObjects[0]?.label).toBe('Issues');
    expect(protocol.highValueObjects.slice(0, 3).map((item) => item.label)).toEqual([
      'Issues',
      'Pull requests',
      'Actions',
    ]);
    expect(protocol.L0.summary).toContain(
      'Primary repo entry points are Issues, Pull requests, Actions.',
    );
    expect(protocol.L0.summary).not.toContain('fix(t4): stabilize workflow run detail baseline');
  });

  it('injects repo task seeds when compact snapshot misses named repo tabs', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://github.com/example/project',
        currentTitle: 'example/project',
        pageRole: 'repo_home',
        primaryRegion: 'repo_primary_nav',
        interactiveElements: [
          { ref: 'ref_go_to_file', role: 'combobox', name: 'Go to file' },
          { ref: 'ref_watch', role: 'button', name: 'Watching a repository' },
          { ref: 'ref_branch', role: 'button', name: 'main branch' },
        ],
        candidateActions: [
          {
            id: 'ca_fill_ref_go_to_file',
            actionType: 'fill',
            targetRef: 'ref_go_to_file',
            confidence: 0.68,
            matchReason: 'form input candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Go to file' }],
          },
          {
            id: 'ca_click_ref_watch',
            actionType: 'click',
            targetRef: 'ref_watch',
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Watching a repository' }],
          },
        ],
      }),
    );

    expect(protocol.taskMode).toBe('read');
    expect(protocol.highValueObjects.slice(0, 3).map((item) => item.label)).toEqual([
      'Issues',
      'Pull requests',
      'Actions',
    ]);
    expect(protocol.L0.summary).toContain(
      'Primary repo entry points are Issues, Pull requests, Actions.',
    );
    expect(protocol.highValueObjects[3]?.label).toBe('Go to file');
  });

  it.each([
    {
      name: 'maps repo_home to read from role and primary region',
      params: createBaseParams({
        currentUrl: 'https://github.com/example/project',
        currentTitle: 'example/project',
        pageRole: 'repo_home',
        primaryRegion: 'repo_primary_nav',
        interactiveElements: [
          { ref: 'ref_issues', role: 'link', name: 'Issues' },
          { ref: 'ref_pulls', role: 'link', name: 'Pull requests' },
          { ref: 'ref_actions', role: 'link', name: 'Actions' },
        ],
      }),
      expected: 'read',
    },
    {
      name: 'maps issues_list to search from role region and controls',
      params: createBaseParams({
        currentUrl: 'https://github.com/example/project/issues',
        currentTitle: 'Issues',
        pageRole: 'issues_list',
        primaryRegion: 'issues_results',
        interactiveElements: [
          { ref: 'ref_search', role: 'textbox', name: 'Search Issues' },
          { ref: 'ref_filter', role: 'combobox', name: 'Filter issues' },
          { ref: 'ref_entry', role: 'link', name: 'Issue entries' },
        ],
      }),
      expected: 'search',
    },
    {
      name: 'maps actions_list to monitor from workflow controls',
      params: createBaseParams({
        currentUrl: 'https://github.com/example/project/actions',
        currentTitle: 'Actions',
        pageRole: 'actions_list',
        primaryRegion: 'workflow_runs_list',
        interactiveElements: [
          { ref: 'ref_filter', role: 'textbox', name: 'Filter workflow runs' },
          { ref: 'ref_run', role: 'link', name: 'Run detail entry' },
        ],
      }),
      expected: 'monitor',
    },
    {
      name: 'maps workflow_run_detail to monitor from diagnostics region',
      params: createBaseParams({
        currentUrl: 'https://github.com/example/project/actions/runs/42',
        currentTitle: 'Workflow run detail',
        pageRole: 'workflow_run_detail',
        primaryRegion: 'workflow_run_summary',
        interactiveElements: [
          { ref: 'ref_summary', role: 'link', name: 'Summary' },
          { ref: 'ref_jobs', role: 'button', name: 'Jobs' },
          { ref: 'ref_logs', role: 'link', name: 'Logs' },
        ],
      }),
      expected: 'monitor',
    },
    {
      name: 'detects compare from compare-specific title and controls',
      params: createBaseParams({
        currentUrl: 'https://example.com/review/diff',
        currentTitle: 'Compare revisions',
        interactiveElements: [
          { ref: 'ref_compare', role: 'link', name: 'Compare selected versions' },
        ],
      }),
      expected: 'compare',
    },
    {
      name: 'detects extract from export-oriented controls and high-value labels',
      params: createBaseParams({
        currentUrl: 'https://example.com/admin/report',
        currentTitle: 'Monthly report',
        interactiveElements: [
          { ref: 'ref_export', role: 'button', name: 'Export CSV' },
          { ref: 'ref_download', role: 'link', name: 'Download JSON' },
        ],
        candidateActions: [
          {
            id: 'ca_click_ref_export',
            actionType: 'click',
            targetRef: 'ref_export',
            confidence: 0.84,
            matchReason: 'primary export action in results toolbar',
            locatorChain: [{ type: 'aria', value: 'Export CSV' }],
          },
        ],
      }),
      expected: 'extract',
    },
  ])('$name', ({ params, expected }) => {
    const protocol = buildTaskProtocol(params as any);
    expect(protocol.taskMode).toBe(expected);
  });
});
