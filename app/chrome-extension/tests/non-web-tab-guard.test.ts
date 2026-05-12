import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clickTool, fillTool } from '@/entrypoints/background/tools/browser/interaction';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

describe('non-web tab guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a structured unsupported_page_type response for chrome_read_page on extension tabs', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 3101,
      title: 'Tabrix Connect',
      url: 'chrome-extension://test-extension-id/connect.html',
    });
    const injectSpy = vi
      .spyOn(readPageTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);

    const result = await readPageTool.execute({ tabId: 3101 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.pageType).toBe('extension_page');
    expect(payload.recommendedAction).toBe('switch_to_http_tab');
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('returns a structured unsupported_page_type response for chrome_click_element on extension tabs', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 3102,
      title: 'Tabrix Connect',
      url: 'chrome-extension://test-extension-id/connect.html',
    });
    const injectSpy = vi
      .spyOn(clickTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);

    const result = await clickTool.execute({ tabId: 3102, selector: '#connect' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.action).toBe('click');
    expect(payload.pageType).toBe('extension_page');
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('returns a structured unsupported_page_type response for chrome_fill_or_select on browser-internal tabs', async () => {
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 3103,
      title: 'Extensions',
      url: 'chrome://extensions/',
    });
    const injectSpy = vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);

    const result = await fillTool.execute({ tabId: 3103, selector: '#search', value: 'tabrix' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.action).toBe('fill');
    expect(payload.pageType).toBe('browser_internal_page');
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('returns a structured unsupported_page_type response for chrome_read_page on error tabs', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 3104,
      title: 'This site can’t be reached',
      url: 'chrome-error://chromewebdata/',
    });
    const injectSpy = vi
      .spyOn(readPageTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);

    const result = await readPageTool.execute({ tabId: 3104 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.scheme).toBe('chrome-error');
    expect(payload.pageType).toBe('browser_internal_page');
    expect(payload.recommendedAction).toBe('switch_to_http_tab');
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('returns a structured unsupported_page_type response for chrome_click_element on view-source tabs', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 3105,
      title: 'view-source',
      url: 'view-source:https://example.com/',
    });
    const injectSpy = vi
      .spyOn(clickTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);

    const result = await clickTool.execute({ tabId: 3105, selector: 'body' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.action).toBe('click');
    expect(payload.scheme).toBe('view-source');
    expect(payload.pageType).toBe('unsupported_page');
    expect(injectSpy).not.toHaveBeenCalled();
  });
});
