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
        'Button "Continue"\nTextbox "Search"\nLink "Docs"\nStatus "Ready"\nHint "Use refs first"\nBanner "Safe automation starts with structured reads"\nPanel "Use read_page and interactive refs before screenshots or coordinate fallbacks"\nSection "Confirm the page has settled before using visual fallbacks"\nChecklist "Prefer refs, then screenshots, then higher-risk tools"\nFooter "End of stable content"',
      refMap: ['ref_1', 'ref_2', 'ref_3'],
      stats: { processed: 12, included: 8, durationMs: 11 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({});
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expect(payload.mode).toBe('compact');
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
        'Button "Continue"\nTextbox "Search"\nLink "Docs"\nStatus "Ready"\nHint "Use refs first"\nBanner "Safe automation starts with structured reads"\nPanel "Use read_page and interactive refs before screenshots or coordinate fallbacks"\nSection "Confirm the page has settled before using visual fallbacks"\nChecklist "Prefer refs, then screenshots, then higher-risk tools"\nFooter "End of stable content"',
      refMap: ['ref_1', 'ref_2', 'ref_3'],
      stats: { processed: 12, included: 8, durationMs: 11 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'full' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expect(payload.mode).toBe('full');
  });
});
