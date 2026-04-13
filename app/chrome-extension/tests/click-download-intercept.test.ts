import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clickTool } from '@/entrypoints/background/tools/browser/interaction';
import { handleDownloadTool } from '@/entrypoints/background/tools/browser/download';

describe('clickTool download interception', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes download links to handleDownloadTool instead of direct click path', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({ id: 1001 });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      interceptedDownload: true,
      downloadUrl: 'https://example.com/files/demo.txt',
      downloadFilename: 'demo.txt',
    });
    vi.spyOn(handleDownloadTool, 'execute').mockResolvedValue({
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            download: { savedPath: 'C:\\Users\\test\\Downloads\\tabrix\\demo.txt' },
          }),
        },
      ],
    } as any);

    const result = await clickTool.execute({
      selector: '#downloadLink',
      tabId: 1001,
    });

    expect(result.isError).toBe(false);
    const text = (result.content[0] as { text: string }).text;
    const payload = JSON.parse(text);
    expect(payload.clickMethod).toBe('intercepted-download');
    expect(payload.downloadUrl).toBe('https://example.com/files/demo.txt');
    expect(payload.download.savedPath).toContain('tabrix');
    expect(handleDownloadTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/files/demo.txt',
        filename: 'demo.txt',
        saveAs: false,
      }),
    );
  });
});

