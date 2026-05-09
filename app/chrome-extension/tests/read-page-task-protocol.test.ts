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
      'Actions',
      'Pull requests',
    ]);
    expect(protocol.L0.summary).toContain('focus on Issues, Actions, Pull requests');
    expect(protocol.L0.summary).not.toContain('fix(t4): stabilize workflow run detail baseline');
  });

  it('falls back to generic high-value objects when snapshot has no repo tabs', () => {
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
    // Without platform-specific adapters, high-value objects come from actual page elements,
    // not injected seeds. The Knowledge layer (MKEP) provides platform knowledge.
    expect(protocol.highValueObjects[0]?.label).toBe('Watching a repository');
    expect(protocol.highValueObjects[1]?.label).toBe('Go to file');
    expect(protocol.highValueObjects[2]?.label).toBe('main branch');
  });

  it('filters certificate and compliance links out of high-value objects', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://example.com/search',
        currentTitle: 'Search results',
        pageRole: 'web_page',
        primaryRegion: 'visible_results',
        interactiveElements: [
          {
            ref: 'ref_result_1',
            role: 'link',
            name: 'Practical workflow guide for solo teams',
            href: '/items/1',
          },
          {
            ref: 'ref_certificate',
            role: 'link',
            name: 'Internet drug information service certificate',
            href: '/service/info',
          },
          {
            ref: 'ref_license',
            role: 'link',
            name: '业务经营许可证',
            href: '/public/credential',
          },
          {
            ref: 'ref_icp',
            role: 'link',
            name: 'ICP备案',
            href: '/footer/record',
          },
          {
            ref: 'ref_security',
            role: 'link',
            name: '公网安备',
            href: '/site/security',
          },
          {
            ref: 'ref_result_2',
            role: 'link',
            name: 'Automation checklist for daily operations',
            href: '/items/2',
          },
        ],
      }),
    );

    const labels = protocol.highValueObjects.map((item) => item.label);
    expect(labels).toEqual([
      'Practical workflow guide for solo teams',
      'Automation checklist for daily operations',
    ]);
    expect(labels.join(' ')).not.toMatch(
      /certificate|license|许可证|ICP备|公网安备|compliance|permit/i,
    );
  });

  it('surfaces selected visible text rows as read-only facts before shell controls', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://example.com/search',
        currentTitle: 'Search results',
        pageRole: 'web_page',
        primaryRegion: 'visible_results',
        interactiveElements: [
          { ref: 'ref_home', role: 'link', name: 'Home', href: '/' },
          { ref: 'ref_search', role: 'button', name: 'Search' },
          { ref: 'ref_download', role: 'link', name: 'Download app', href: '/download-app' },
        ],
        candidateActions: [
          {
            id: 'ca_click_ref_home',
            actionType: 'click',
            targetRef: 'ref_home',
            confidence: 0.72,
            matchReason: 'navigation shell candidate',
            locatorChain: [{ type: 'aria', value: 'Home' }],
          },
        ],
        visibleRegionRows: {
          sourceDataSource: 'dom_region_rows',
          rows: [
            {
              rowId: 'visible_text_1',
              title: 'Practical automation planning guide for small teams',
              primaryText: 'Practical automation planning guide for small teams',
              secondaryText: 'Workflow Lab',
              metaText: '2 hours ago',
              interactionText: '89 likes',
              visibleTextFields: ['Practical automation planning guide for small teams'],
              targetRef: null,
              targetRefCoverageRate: 0,
              boundingBox: null,
              regionId: 'visible_text_1',
              sourceRegion: 'visible_text',
              confidence: 0.7,
              qualityReasons: ['visible_text_fallback'],
            },
            {
              rowId: 'visible_text_2',
              title: 'Reliable operations checklist for browser based AI assistants',
              primaryText: 'Reliable operations checklist for browser based AI assistants',
              secondaryText: 'Ops Review',
              metaText: 'yesterday',
              interactionText: '34 comments',
              visibleTextFields: ['Reliable operations checklist for browser based AI assistants'],
              targetRef: null,
              targetRefCoverageRate: 0,
              boundingBox: null,
              regionId: 'visible_text_2',
              sourceRegion: 'visible_text',
              confidence: 0.7,
              qualityReasons: ['visible_text_fallback'],
            },
          ],
          rowCount: 2,
          visibleRegionRowsUsed: true,
          visibleRegionRowsRejectedReason: null,
          sourceRegion: 'visible_text',
          rowExtractionConfidence: 0.7,
          cardExtractorUsed: true,
          cardPatternConfidence: 0.58,
          cardRowsCount: 2,
          rowOrder: 'visual_order',
          targetRefCoverageRate: 0,
          regionQualityScore: 0.43,
          visibleDomRowsCandidateCount: 2,
          visibleDomRowsSelectedCount: 2,
          lowValueRegionRejectedCount: 3,
          footerLikeRejectedCount: 1,
          navigationLikeRejectedCount: 2,
          targetRefCoverageRejectedCount: 0,
          rejectedRegionReasonDistribution: {
            low_value_region: 3,
            footer_like_region: 1,
            navigation_like_region: 2,
            target_ref_coverage_insufficient: 0,
            single_isolated_text: 0,
            empty_shell: 0,
          },
          pageInfo: {
            url: 'https://example.com/search',
            title: 'Search results',
            viewport: { width: 1280, height: 720, dpr: 1 },
            scrollY: 0,
            pixelsAbove: 0,
            pixelsBelow: 0,
            candidateRegionCount: 2,
          },
        },
      }),
    );

    const topObjects = protocol.highValueObjects.slice(0, 2);
    expect(topObjects.map((item) => item.label)).toEqual([
      'Practical automation planning guide for small teams',
      'Reliable operations checklist for browser based AI assistants',
    ]);
    for (const object of topObjects) {
      expect(object).toMatchObject({
        kind: 'visible_region_row',
        objectType: 'record',
        region: 'visible_text',
        sourceKind: 'dom_semantic',
      });
      expect(object.ref).toBeUndefined();
      expect(object.targetRef).toBeUndefined();
      expect(object.actions).toBeUndefined();
      expect(object.reasons).toEqual(
        expect.arrayContaining(['visible_text_fallback', 'read_fact']),
      );
    }
    expect(protocol.L0.focusObjectIds.slice(0, 2)).toEqual(topObjects.map((item) => item.id));
    expect(protocol.L0.summary).toContain(
      'focus on Practical automation planning guide for small teams, Reliable operations checklist for browser based AI assistants',
    );
    expect(protocol.L1.highValueObjectIds.slice(0, 2)).toEqual(topObjects.map((item) => item.id));
    expect(protocol.L1.overview).toContain(
      'Top objects: Practical automation planning guide for small teams, Reliable operations checklist for browser based AI assistants',
    );
    expect(protocol.highValueObjects.map((item) => item.label).join(' ')).not.toMatch(
      /Download app/i,
    );
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

  // ----- B-011: stable targetRef on HVO ----------------------------------
  describe('B-011 stable targetRef integration', () => {
    function buildRepoHomeParams(refSuffix: string) {
      return createBaseParams({
        currentUrl: 'https://github.com/example/project',
        currentTitle: 'example/project',
        pageRole: 'repo_home',
        primaryRegion: 'repo_primary_nav',
        interactiveElements: [
          { ref: `ref_issues_${refSuffix}`, role: 'link', name: 'Issues' },
          { ref: `ref_pulls_${refSuffix}`, role: 'link', name: 'Pull requests' },
          { ref: `ref_actions_${refSuffix}`, role: 'link', name: 'Actions' },
        ],
        candidateActions: [
          {
            id: `ca_click_ref_issues_${refSuffix}`,
            actionType: 'click',
            targetRef: `ref_issues_${refSuffix}`,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Issues' }],
          },
          {
            id: `ca_click_ref_pulls_${refSuffix}`,
            actionType: 'click',
            targetRef: `ref_pulls_${refSuffix}`,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Pull requests' }],
          },
          {
            id: `ca_click_ref_actions_${refSuffix}`,
            actionType: 'click',
            targetRef: `ref_actions_${refSuffix}`,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Actions' }],
          },
        ],
      });
    }

    it('emits a tgt_<10-hex> targetRef on every link-bearing HVO', () => {
      const protocol = buildTaskProtocol(buildRepoHomeParams('a') as any);
      const top = protocol.highValueObjects.slice(0, 3);
      for (const obj of top) {
        expect(obj.targetRef).toMatch(/^tgt_[0-9a-f]{10}$/);
      }
    });

    it('keeps targetRef stable across re-reads when only per-snapshot ref values churn', () => {
      const a = buildTaskProtocol(buildRepoHomeParams('a') as any);
      const b = buildTaskProtocol(buildRepoHomeParams('b') as any);
      const issuesA = a.highValueObjects.find((o) => o.label === 'Issues');
      const issuesB = b.highValueObjects.find((o) => o.label === 'Issues');
      expect(issuesA?.targetRef).toBeTruthy();
      expect(issuesA?.targetRef).toBe(issuesB?.targetRef);
      // Note: the synthesized repo-nav-tab HVO carries no per-snapshot ref
      // (seed-only path), but the targetRef equality above is the contract
      // we rely on for cross-reload upstream reuse, not the underlying ref.
    });

    it('produces distinct targetRefs for distinct logical objects', () => {
      const protocol = buildTaskProtocol(buildRepoHomeParams('a') as any);
      const labels = ['Issues', 'Pull requests', 'Actions'];
      const refs = labels
        .map((l) => protocol.highValueObjects.find((o) => o.label === l)?.targetRef)
        .filter((v): v is string => Boolean(v));
      expect(refs.length).toBe(3);
      expect(new Set(refs).size).toBe(3);
    });
  });
});
