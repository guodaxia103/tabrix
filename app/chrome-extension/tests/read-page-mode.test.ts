import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

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
    expect(payload.mode).toBe('compact');
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
    expect(payload.mode).toBe('normal');
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
    expect(payload.mode).toBe('full');
    expect(payload.fullSnapshot).toBeDefined();
    expect(payload.fullSnapshot.pageContent).toContain('button "Submit order"');
  });
});
