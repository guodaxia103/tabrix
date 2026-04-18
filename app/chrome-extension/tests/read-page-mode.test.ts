import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

function expectCommonSnapshotShape(payload: any, mode: 'compact' | 'normal' | 'full') {
  expect(payload.mode).toBe(mode);
  expect(payload.page).toMatchObject({
    url: expect.any(String),
    title: expect.any(String),
    pageType: expect.any(String),
  });
  expect(payload.summary).toEqual(expect.any(Object));
  expect(Array.isArray(payload.interactiveElements)).toBe(true);
  expect(Array.isArray(payload.candidateActions)).toBe(true);
  expect(Array.isArray(payload.artifactRefs)).toBe(true);
  expect(payload.artifactRefs[0]).toMatchObject({
    kind: 'dom_snapshot',
    ref: expect.any(String),
  });
  expect(payload.pageContext).toMatchObject({
    filter: expect.any(String),
    scheme: expect.any(String),
    viewport: expect.any(Object),
    fallbackUsed: expect.any(Boolean),
    refMapCount: expect.any(Number),
  });
}

describe('read_page mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an error for unsupported mode values', async () => {
    const result = await readPageTool.execute({ mode: 'invalid' as any });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      'mode must be one of compact | normal | full',
    );
  });

  it('defaults mode to compact', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5201,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/checkout',
      title: 'Checkout',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- form "Checkout" [ref=ref_0] (x=640,y=300)\n  - textbox "Email" [ref=ref_1] (x=600,y=260)\n  - textbox "Card number" [ref=ref_2] (x=600,y=300)\n  - button "Submit order" [ref=ref_3] (x=600,y=340)\n  - link "Back to cart" [ref=ref_4] (x=500,y=340)\n- heading "Checkout" [ref=ref_5] (x=320,y=100)\n- generic "Secure payment" [ref=ref_6] (x=320,y=140)\n- generic "Order summary" [ref=ref_7] (x=900,y=220)\n- generic "Terms" [ref=ref_8] (x=300,y=520)\n- generic "Footer" [ref=ref_9] (x=300,y=560)',
      refMap: [
        { ref: 'ref_1', selector: '#email' },
        { ref: 'ref_2', selector: '#card-number' },
        { ref: 'ref_3', selector: 'button[type=submit]' },
      ],
      stats: { processed: 12, included: 8, durationMs: 11 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({});
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.page).toMatchObject({
      url: 'https://example.com/checkout',
      title: 'Checkout',
      pageType: 'web_page',
    });
    expect(payload.summary).toMatchObject({
      quality: 'usable',
    });
    expect(Array.isArray(payload.interactiveElements)).toBe(true);
    expect(Array.isArray(payload.artifactRefs)).toBe(true);
    expect(payload.artifactRefs[0].kind).toBe('dom_snapshot');
    expect(Array.isArray(payload.candidateActions)).toBe(true);
    expect(payload.candidateActions.length).toBeGreaterThan(0);
    expect(payload.candidateActions[0]).toMatchObject({
      id: expect.any(String),
      actionType: expect.any(String),
      targetRef: expect.any(String),
      confidence: expect.any(Number),
      matchReason: expect.any(String),
      locatorChain: expect.any(Array),
    });
    expect(payload.candidateActions[0].locatorChain[0]).toMatchObject({
      type: expect.any(String),
      value: expect.any(String),
    });
    expect(payload.diagnostics).toBeUndefined();
    expect(payload.fullSnapshot).toBeUndefined();
  });

  it('returns normal mode diagnostics block', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5203,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/list',
      title: 'List',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- heading "Inventory" [ref=ref_1] (x=200,y=120)\n- textbox "Search" [ref=ref_2] (x=280,y=180)\n- button "Open item" [ref=ref_3] (x=420,y=180)\n- link "Details" [ref=ref_4] (x=520,y=180)\n- generic "Row Item A" [ref=ref_5] (x=280,y=240)\n- generic "Row Item B" [ref=ref_6] (x=280,y=280)\n- generic "Row Item C" [ref=ref_7] (x=280,y=320)\n- generic "Status Ready" [ref=ref_8] (x=280,y=360)\n- generic "Panel" [ref=ref_9] (x=760,y=220)\n- generic "Footer" [ref=ref_10] (x=760,y=520)',
      refMap: [
        { ref: 'ref_2', selector: 'input[name=search]' },
        { ref: 'ref_3', selector: 'button.open-item' },
        { ref: 'ref_4', selector: 'a.details-link' },
      ],
      stats: { processed: 10, included: 8, durationMs: 8 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'normal' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'normal');
    expect(payload.diagnostics).toBeDefined();
    expect(payload.fullSnapshot).toBeUndefined();
  });

  it('echoes explicit full mode', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5202,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/checkout',
      title: 'Checkout',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- form "Checkout" [ref=ref_0] (x=640,y=300)\n  - textbox "Email" [ref=ref_1] (x=600,y=260)\n  - textbox "Card number" [ref=ref_2] (x=600,y=300)\n  - button "Submit order" [ref=ref_3] (x=600,y=340)\n  - link "Back to cart" [ref=ref_4] (x=500,y=340)\n- heading "Checkout" [ref=ref_5] (x=320,y=100)\n- generic "Secure payment" [ref=ref_6] (x=320,y=140)\n- generic "Order summary" [ref=ref_7] (x=900,y=220)\n- generic "Terms" [ref=ref_8] (x=300,y=520)\n- generic "Footer" [ref=ref_9] (x=300,y=560)',
      refMap: [
        { ref: 'ref_1', selector: '#email' },
        { ref: 'ref_2', selector: '#card-number' },
        { ref: 'ref_3', selector: 'button[type=submit]' },
      ],
      stats: { processed: 12, included: 8, durationMs: 11 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'full' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'full');
    expect(payload.fullSnapshot).toBeDefined();
    expect(payload.fullSnapshot.pageContent).toContain('button "Submit order"');
  });

  it('keeps structured skeleton for unsupported page types', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5208,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'chrome://extensions',
      title: 'Extensions',
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expect(payload.success).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.pageType).toBe('browser_internal_page');
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.candidateActions).toEqual([]);
  });

  it('captures login page candidate actions in compact mode', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5210,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/login',
      title: '抖音登录',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- form "抖音登录" [ref=ref_0] (x=640,y=300)\n  - textbox "手机号" [ref=ref_phone] (x=600,y=260)\n  - textbox "验证码" [ref=ref_code] (x=600,y=300)\n  - button "登录" [ref=ref_login] (x=600,y=340)\n- generic "请输入手机号和验证码登录抖音" [ref=ref_5] (x=580,y=220)\n- generic "用户协议" [ref=ref_6] (x=580,y=380)\n- generic "隐私政策" [ref=ref_7] (x=580,y=410)\n- generic "联系我们" [ref=ref_8] (x=580,y=440)\n- generic "帮助中心" [ref=ref_9] (x=580,y=470)\n- generic "页面底部信息" [ref=ref_10] (x=580,y=520)',
      refMap: [
        { ref: 'ref_phone', selector: 'input[name=phone]' },
        { ref: 'ref_code', selector: 'input[name=captcha]' },
        { ref: 'ref_login', selector: 'button[type=submit]' },
      ],
      stats: { processed: 14, included: 9, durationMs: 9 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.summary.pageRole).toBe('login_required');
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_phone', role: 'textbox' }),
        expect.objectContaining({ ref: 'ref_code', role: 'textbox' }),
        expect.objectContaining({ ref: 'ref_login', role: 'button' }),
      ]),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: 'fill',
          targetRef: 'ref_phone',
        }),
        expect.objectContaining({
          actionType: 'click',
          targetRef: 'ref_login',
          matchReason: expect.stringContaining('primary action'),
        }),
      ]),
    );
  });

  it('keeps compact short and full detailed on complex pages', async () => {
    const mockSend = vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- application "Enterprise console" [ref=ref_root] (x=640,y=100)',
        '  - navigation "Main menu" [ref=ref_nav] (x=140,y=240)',
        '    - link "Dashboard" [ref=ref_dash] (x=120,y=180)',
        '    - link "Settings" [ref=ref_settings] (x=120,y=220)',
        '  - main "Workspace" [ref=ref_main] (x=780,y=320)',
        '    - region "Filters" [ref=ref_filter_region] (x=480,y=190)',
        '      - textbox "Search records" [ref=ref_search] (x=520,y=220)',
        '      - combobox "Status" [ref=ref_status] (x=720,y=220)',
        '      - button "Apply filters" [ref=ref_apply] (x=920,y=220)',
        '    - region "Results table" [ref=ref_table] (x=760,y=360)',
        '      - row "Record A" [ref=ref_row_a] (x=760,y=300)',
        '      - row "Record B" [ref=ref_row_b] (x=760,y=340)',
        '      - row "Record C" [ref=ref_row_c] (x=760,y=380)',
        '    - region "Bulk actions" [ref=ref_bulk] (x=980,y=500)',
        '      - button "Export CSV" [ref=ref_export] (x=980,y=520)',
        '      - button "Archive selected" [ref=ref_archive] (x=1120,y=520)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_search', selector: 'input[name=q]' },
        { ref: 'ref_status', selector: 'select[name=status]' },
        { ref: 'ref_apply', selector: 'button.apply-filters' },
        { ref: 'ref_export', selector: 'button.export-csv' },
        { ref: 'ref_archive', selector: 'button.archive-selected' },
      ],
      stats: { processed: 42, included: 24, durationMs: 15 },
      viewport: { width: 1440, height: 900, dpr: 1 },
    });

    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5211,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/admin/console',
      title: 'Enterprise Console',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);

    const compactResult = await readPageTool.execute({ mode: 'compact' });
    const compactPayload = JSON.parse((compactResult.content[0] as { text: string }).text);
    const fullResult = await readPageTool.execute({ mode: 'full' });
    const fullPayload = JSON.parse((fullResult.content[0] as { text: string }).text);

    expect(compactResult.isError).toBe(false);
    expect(fullResult.isError).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expectCommonSnapshotShape(compactPayload, 'compact');
    expectCommonSnapshotShape(fullPayload, 'full');
    expect(compactPayload.fullSnapshot).toBeUndefined();
    expect(fullPayload.fullSnapshot).toBeDefined();
    expect(fullPayload.fullSnapshot.pageContent).toContain('Results table');
    expect(JSON.stringify(compactPayload).length).toBeLessThan(JSON.stringify(fullPayload).length);
  });

  it('prioritizes named task controls over shell noise in compact mode', async () => {
    const shellLines = Array.from({ length: 26 }, (_, index) => {
      const ref = `ref_shell_${index + 1}`;
      const role = index % 3 === 0 ? 'button' : 'link';
      return `- ${role} "" [ref=${ref}] (x=${120 + index * 12},y=64)`;
    });
    const pageSpecificLines = [
      '- link "Skip to content" [ref=ref_skip] (x=40,y=20)',
      '- button "Search or jump to…" [ref=ref_search] (x=280,y=20)',
      '- button "Open Copilot…" [ref=ref_copilot] (x=420,y=20)',
      '- link "Issues" [ref=ref_issues] (x=180,y=200)',
      '- link "Pull requests" [ref=ref_pulls] (x=280,y=200)',
      '- link "Actions" [ref=ref_actions] (x=400,y=200)',
      '- combobox "Filter workflow runs" [ref=ref_filter] (x=540,y=200)',
      '- link "Run 1052 of CI" [ref=ref_run] (x=760,y=240)',
    ];

    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5212,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/actions',
      title: 'Actions · example/project',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [...shellLines, ...pageSpecificLines].join('\n'),
      refMap: [
        { ref: 'ref_issues', selector: 'a[data-tab-item="issues-tab"]' },
        { ref: 'ref_pulls', selector: 'a[data-tab-item="pull-requests-tab"]' },
        { ref: 'ref_actions', selector: 'a[data-tab-item="actions-tab"]' },
        { ref: 'ref_filter', selector: 'select[aria-label="Filter workflow runs"]' },
        { ref: 'ref_run', selector: 'a[href*="/actions/runs/"]' },
      ],
      stats: { processed: 40, included: 34, durationMs: 17 },
      viewport: { width: 1440, height: 900, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    const orderedRefs = payload.interactiveElements.map((element: { ref: string }) => element.ref);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_issues', name: 'Issues' }),
        expect.objectContaining({ ref: 'ref_pulls', name: 'Pull requests' }),
        expect.objectContaining({ ref: 'ref_actions', name: 'Actions' }),
        expect.objectContaining({ ref: 'ref_filter', name: 'Filter workflow runs' }),
        expect.objectContaining({ ref: 'ref_run', name: 'Run 1052 of CI' }),
      ]),
    );
    expect(orderedRefs.indexOf('ref_filter')).toBeLessThan(orderedRefs.indexOf('ref_skip'));
    expect(orderedRefs.indexOf('ref_actions')).toBeLessThan(orderedRefs.indexOf('ref_skip'));
    expect(orderedRefs.indexOf('ref_run')).toBeLessThan(orderedRefs.indexOf('ref_skip'));
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_actions', actionType: 'click' }),
        expect.objectContaining({ targetRef: 'ref_filter', actionType: 'fill' }),
        expect.objectContaining({ targetRef: 'ref_run', actionType: 'click' }),
      ]),
    );
  });

  it('hydrates nested generic labels onto interactive wrappers in compact mode', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5213,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project',
      title: 'example/project',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- navigation "Repository" [ref=ref_nav] (x=180,y=72)',
        '  - link [ref=ref_issues_link] (x=160,y=76)',
        '    - generic "Issues" [ref=ref_issues_label] (x=148,y=76)',
        '  - link [ref=ref_pulls_link] (x=300,y=76)',
        '    - generic "Pull requests" [ref=ref_pulls_label] (x=292,y=76)',
        '  - link [ref=ref_actions_link] (x=440,y=76)',
        '    - generic "Actions" [ref=ref_actions_label] (x=432,y=76)',
        '  - button [ref=ref_jobs_button] (x=580,y=76)',
        '    - generic "Jobs" [ref=ref_jobs_label] (x=568,y=76)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_issues_link', selector: 'a[href$="/issues"]' },
        { ref: 'ref_pulls_link', selector: 'a[href$="/pulls"]' },
        { ref: 'ref_actions_link', selector: 'a[href$="/actions"]' },
        { ref: 'ref_jobs_button', selector: 'button[data-panel="jobs"]' },
      ],
      stats: { processed: 18, included: 9, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_issues_link', name: 'Issues' }),
        expect.objectContaining({ ref: 'ref_pulls_link', name: 'Pull requests' }),
        expect.objectContaining({ ref: 'ref_actions_link', name: 'Actions' }),
        expect.objectContaining({ ref: 'ref_jobs_button', name: 'Jobs' }),
      ]),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_issues_link', actionType: 'click' }),
        expect.objectContaining({ targetRef: 'ref_actions_link', actionType: 'click' }),
        expect.objectContaining({ targetRef: 'ref_jobs_button', actionType: 'click' }),
      ]),
    );
  });

  it('prefers action-oriented descendant labels over status text for compact workflow buttons', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5214,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/actions/runs/1',
      title: 'Workflow run',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- navigation "Workflow run" [ref=ref_nav] (x=163,y=521)',
        '  - link [ref=ref_actions_link] (x=120,y=190)',
        '    - generic "Actions" [ref=ref_actions_label] (x=132,y=190)',
        '  - link [ref=ref_run_link] (x=160,y=210)',
        '    - generic "Run" [ref=ref_run_label] (x=172,y=210)',
        '  - button [ref=ref_jobs_button] (x=484,y=440)',
        '    - generic "1 job completed" [ref=ref_jobs_status] (x=451,y=432)',
        '    - generic "Show all jobs" [ref=ref_jobs_label] (x=425,y=451)',
        '  - link [ref=ref_summary_link] (x=163,y=230)',
        '    - generic "Summary" [ref=ref_summary_label] (x=175,y=230)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_actions_link', selector: 'a[href$="/actions"]' },
        { ref: 'ref_run_link', selector: 'a[href*="/actions/runs/"]' },
        { ref: 'ref_jobs_button', selector: 'button.show-all-jobs' },
        { ref: 'ref_summary_link', selector: 'a[href$="/actions/runs/1"]' },
      ],
      stats: { processed: 18, included: 10, durationMs: 6 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_jobs_button', name: 'Show all jobs' }),
        expect.objectContaining({ ref: 'ref_summary_link', name: 'Summary' }),
      ]),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_jobs_button', actionType: 'click' }),
      ]),
    );
  });

  it('prioritizes run detail links over workflow catalog links on actions list pages', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5215,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/actions',
      title: 'Workflow runs',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- navigation "Repository" [ref=ref_nav] (x=180,y=72)',
        '  - link [ref=ref_issues] (x=160,y=76)',
        '    - generic "Issues" [ref=ref_issues_label] (x=148,y=76)',
        '  - link [ref=ref_pulls] (x=300,y=76)',
        '    - generic "Pull requests" [ref=ref_pulls_label] (x=292,y=76)',
        '  - link [ref=ref_actions] (x=440,y=76)',
        '    - generic "Actions" [ref=ref_actions_label] (x=432,y=76)',
        '- navigation "Actions Workflows" [ref=ref_workflows] (x=168,y=470)',
        '  - link [ref=ref_close_issues] (x=168,y=323)',
        '    - generic "Close issues" [ref=ref_close_issues_label] (x=168,y=323)',
        '  - link [ref=ref_code_scan] (x=168,y=356)',
        '    - generic "Code Scanning - Action" [ref=ref_code_scan_label] (x=168,y=356)',
        '- search [ref=ref_search] (x=1490,y=132)',
        '  - combobox "Filter workflow runs" [ref=ref_filter] (x=1490,y=132)',
        '- link "completed successfully: Run 1052 of Close issues." [ref=ref_run_detail] (x=688,y=285)',
        '  - generic "Close issues" [ref=ref_run_detail_label] (x=689,y=285)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_issues', selector: 'a[href$="/issues"]' },
        { ref: 'ref_pulls', selector: 'a[href$="/pulls"]' },
        { ref: 'ref_actions', selector: 'a[href$="/actions"]' },
        { ref: 'ref_close_issues', selector: 'a[href$="/actions/workflows/close-issues.yml"]' },
        { ref: 'ref_code_scan', selector: 'a[href$="/actions/workflows/codeql.yml"]' },
        { ref: 'ref_filter', selector: 'input[placeholder="Filter workflow runs"]' },
        { ref: 'ref_run_detail', selector: 'a[href*="/actions/runs/24593977415"]' },
      ],
      stats: { processed: 30, included: 15, durationMs: 9 },
      viewport: { width: 1440, height: 900, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    const orderedRefs = payload.interactiveElements.map((element: { ref: string }) => element.ref);

    expect(result.isError).toBe(false);
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'ref_run_detail',
          name: 'completed successfully: Run 1052 of Close issues.',
        }),
        expect.objectContaining({ ref: 'ref_close_issues', name: 'Close issues' }),
        expect.objectContaining({ ref: 'ref_filter', name: 'Filter workflow runs' }),
      ]),
    );
    expect(orderedRefs.indexOf('ref_run_detail')).toBeLessThan(
      orderedRefs.indexOf('ref_close_issues'),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_run_detail', actionType: 'click' }),
      ]),
    );
  });
});
