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
});
