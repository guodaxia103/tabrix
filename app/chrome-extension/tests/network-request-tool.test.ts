import { beforeEach, describe, expect, it, vi } from 'vitest';
import { networkRequestTool } from '@/entrypoints/background/tools/browser/network-request';

describe('networkRequestTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (!chrome.scripting) {
      (chrome as any).scripting = {
        executeScript: vi.fn().mockResolvedValue([]),
      };
    } else {
      chrome.scripting.executeScript = vi.fn().mockResolvedValue([] as any) as any;
    }
    vi.mocked(chrome.tabs.get).mockResolvedValue(null as any);
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 101,
        windowId: 1,
        active: true,
        url: 'http://127.0.0.1:62100/',
      } as chrome.tabs.Tab,
    ]);
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ status: 'pong' } as any) as any;
  });

  it('returns a clear error for browser-internal tabs instead of attempting injection', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 202,
        windowId: 1,
        active: true,
        url: 'chrome://extensions/',
      } as chrome.tabs.Tab,
    ]);

    const executeScriptSpy = vi.mocked(chrome.scripting.executeScript).mockResolvedValue([] as any);

    const result = await networkRequestTool.execute({
      url: 'http://127.0.0.1:62100/json',
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      'Cannot run chrome_network_request on browser-internal pages',
    );
    expect(executeScriptSpy).not.toHaveBeenCalled();
  });
});
