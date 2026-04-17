import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigateTool, switchTabTool } from '@/entrypoints/background/tools/browser/common';
import { webFetcherTool } from '@/entrypoints/background/tools/browser/web-fetcher';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

describe('browser settle guidance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (!chrome.tabs.reload) {
      (chrome.tabs as any).reload = vi.fn().mockResolvedValue(undefined);
    } else {
      (chrome.tabs.reload as any) = vi.fn().mockResolvedValue(undefined);
    }
    if (!chrome.windows) {
      (chrome as any).windows = {
        update: vi.fn().mockResolvedValue({ id: 1, focused: true }),
        getAll: vi.fn().mockResolvedValue([]),
        getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
        get: vi.fn().mockResolvedValue({ id: 1 }),
      };
    } else if (!chrome.windows.update) {
      (chrome.windows as any).update = vi.fn().mockResolvedValue({ id: 1, focused: true });
    } else {
      (chrome.windows.update as any) = vi.fn().mockResolvedValue({ id: 1, focused: true });
    }
    vi.mocked(chrome.tabs.query).mockResolvedValue([]);
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 10,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'http://127.0.0.1:62100/',
      title: 'Smoke',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.create).mockResolvedValue({
      id: 20,
      windowId: 1,
      active: true,
      status: 'loading',
      url: 'http://127.0.0.1:62100/page2',
      title: 'Loading',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.update).mockResolvedValue({
      id: 10,
      windowId: 1,
      active: true,
      status: 'loading',
      url: 'http://127.0.0.1:62100/page2',
      title: 'Loading',
    } as chrome.tabs.Tab);
  });

  it('returns settle metadata after navigating a newly created tab', async () => {
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'http://127.0.0.1:62100/page2',
        title: 'Page 2',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 240,
      readyState: 'complete',
    });

    const result = await navigateTool.execute({
      url: 'http://127.0.0.1:62100/page2',
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      requestedUrl: 'http://127.0.0.1:62100/page2',
      finalUrl: 'http://127.0.0.1:62100/page2',
      settled: true,
      settleReason: 'complete',
      waitedMs: 240,
      readyState: 'complete',
    });
  });

  it('returns activation and settle metadata after switching to an incomplete tab', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 30,
      windowId: 2,
      active: false,
      status: 'loading',
      url: 'http://127.0.0.1:62100/page3',
      title: 'Page 3',
    } as chrome.tabs.Tab);
    vi.spyOn(switchTabTool as any, 'waitForTabActivated').mockResolvedValue({
      tab: {
        id: 30,
        windowId: 2,
        active: true,
        status: 'loading',
        url: 'http://127.0.0.1:62100/page3',
        title: 'Page 3',
      },
      activated: true,
      timedOut: false,
      waitedMs: 120,
      windowFocused: true,
    });
    vi.spyOn(switchTabTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 30,
        windowId: 2,
        active: true,
        status: 'complete',
        url: 'http://127.0.0.1:62100/page3',
        title: 'Page 3',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 380,
      readyState: 'complete',
    });

    const result = await switchTabTool.execute({ tabId: 30 });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      activated: true,
      activationTimedOut: false,
      activationWaitedMs: 120,
      settled: true,
      settleReason: 'complete',
      settleWaitedMs: 380,
      readyState: 'complete',
    });
  });

  it('waits for a new tab to settle before extracting visible text', async () => {
    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'http://127.0.0.1:62100/page2',
        title: 'Settled Page',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent:
        'Line one describes the feature in detail.\nLine two explains the safe path for browser automation.\nLine three confirms the page is stable and ready for structured extraction.\nLine four adds enough visible text to move this sample beyond sparse mode.',
      metadata: { lang: 'en' },
    });

    const result = await webFetcherTool.execute({
      url: 'http://127.0.0.1:62100/page2',
    });

    expect((webFetcherTool as any).waitForTabSettled).toHaveBeenCalledWith(20);
    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      url: 'http://127.0.0.1:62100/page2',
      title: 'Settled Page',
    });
    expect(payload.textSummary).toMatchObject({
      quality: 'usable',
      sparse: false,
    });
  });

  it('returns compact structured snapshot from read_page', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 41,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'http://127.0.0.1:62100/',
      title: 'Smoke',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        'Button "Continue"\nTextbox "Search"\nLink "Docs"\nStatus "Ready"\nHint "Use refs first"\nBanner "Safe automation starts with structured reads"\nPanel "Use read_page and interactive refs before screenshots or coordinate fallbacks"\nSection "Confirm the page has settled before using visual fallbacks"\nChecklist "Prefer refs, then screenshots, then higher-risk tools"\nFooter "End of stable content"',
      refMap: ['ref_1', 'ref_2', 'ref_3'],
      stats: {
        processed: 20,
        included: 6,
        durationMs: 12,
      },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ filter: 'interactive', depth: 3 });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.mode).toBe('compact');
    expect(payload.summary).toMatchObject({
      quality: 'usable',
    });
    expect(payload.page).toMatchObject({
      pageType: 'web_page',
    });
    expect(Array.isArray(payload.interactiveElements)).toBe(true);
    expect(Array.isArray(payload.candidateActions)).toBe(true);
    expect(Array.isArray(payload.artifactRefs)).toBe(true);
  });

  it('classifies hotspot topic list pages in read_page metadata', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 42,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://creator.douyin.com/creator-micro/data/hotspot?active_tab=hotspot_topic',
      title: '热点话题榜',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '话题名称\n热度趋势\n热度值\n视频量\n播放量\n稿均播放量\n发布视频\n查看\n示例话题 A\n示例话题 B',
      refMap: ['ref_10', 'ref_11', 'ref_12'],
      stats: {
        processed: 18,
        included: 8,
        durationMs: 14,
      },
      viewport: { width: 1440, height: 900, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'normal' });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.page).toMatchObject({
      pageType: 'web_page',
    });
    expect(payload.pageContext).toMatchObject({
      scheme: 'https',
    });
    expect(payload.summary).toMatchObject({
      pageRole: 'hotspot_topic_list',
      primaryRegion: 'topic_table',
      primaryRegionConfidence: 'high',
      footerOnly: false,
    });
    expect(payload.summary.anchorTexts).toEqual(
      expect.arrayContaining(['话题名称', '热度趋势', '热度值', '视频量', '播放量', '稿均播放量']),
    );
  });
});
