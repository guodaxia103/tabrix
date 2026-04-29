import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';
import { extractVisibleRegionRows } from '@/entrypoints/background/tools/browser/visible-region-rows';

describe('V27-P0-REAL-01 visible region rows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts repeated visible cards into DOM region rows', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'main_results',
      pageContent: [
        '- main "Results" [ref=ref_main] (x=620,y=360)',
        '  - article "Result card" [ref=ref_card_1] (x=300,y=240)',
        '    - link "Mountain trip planning" [ref=ref_card_1_link] (x=300,y=210) href="/items/1"',
        '    - generic "Travel Notes" [ref=ref_card_1_author] (x=300,y=248)',
        '    - generic "3 hours ago" [ref=ref_card_1_time] (x=300,y=280)',
        '    - generic "1.2k likes" [ref=ref_card_1_likes] (x=300,y=312)',
        '  - article "Result card" [ref=ref_card_2] (x=700,y=250)',
        '    - link "Family route checklist" [ref=ref_card_2_link] (x=700,y=220) href="/items/2"',
        '    - generic "Route Lab" [ref=ref_card_2_author] (x=700,y=258)',
        '    - generic "yesterday" [ref=ref_card_2_time] (x=700,y=290)',
        '    - generic "42 comments" [ref=ref_card_2_comments] (x=700,y=322)',
      ].join('\n'),
    });

    expect(rows.sourceDataSource).toBe('dom_region_rows');
    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(2);
    expect(rows.cardExtractorUsed).toBe(true);
    expect(rows.cardRowsCount).toBe(2);
    expect(rows.rowOrder).toBe('visual_order');
    expect(rows.targetRefCoverageRate).toBeGreaterThanOrEqual(0.99);
    expect(rows.rows[0]).toMatchObject({
      title: 'Mountain trip planning',
      primaryText: 'Travel Notes',
      metaText: '3 hours ago',
      interactionText: '1.2k likes',
      targetRef: 'ref_card_1_link',
      sourceRegion: 'main_results',
    });
    expect(rows.rows[1].title).toBe('Family route checklist');
  });

  it('does not turn footer, filters, or query chips into rows', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- navigation "Main menu" [ref=ref_nav] (x=100,y=100)',
        '  - link "Home" [ref=ref_home] (x=100,y=120)',
        '- search "Filters" [ref=ref_search] (x=500,y=120)',
        '  - button "Sort" [ref=ref_sort] (x=520,y=120)',
        '  - button "Travel" [ref=ref_chip] (x=620,y=120)',
        '- footer "Footer" [ref=ref_footer] (x=600,y=680)',
        '  - link "Privacy" [ref=ref_privacy] (x=620,y=680)',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.cardExtractorUsed).toBe(false);
    expect(rows.visibleRegionRowsRejectedReason).toBe('dom_region_rows_unavailable');
  });

  it('orders masonry-style cards by visual top-left position', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- main "Results" [ref=ref_main] (x=620,y=360)',
        '  - article "Card C" [ref=ref_card_c] (x=760,y=420)',
        '    - link "Third visual card" [ref=ref_card_c_link] (x=760,y=390) href="/items/c"',
        '    - generic "Source C" [ref=ref_card_c_source] (x=760,y=430)',
        '  - article "Card A" [ref=ref_card_a] (x=300,y=250)',
        '    - link "First visual card" [ref=ref_card_a_link] (x=300,y=220) href="/items/a"',
        '    - generic "Source A" [ref=ref_card_a_source] (x=300,y=260)',
        '  - article "Card B" [ref=ref_card_b] (x=760,y=260)',
        '    - link "Second visual card" [ref=ref_card_b_link] (x=760,y=230) href="/items/b"',
        '    - generic "Source B" [ref=ref_card_b_source] (x=760,y=270)',
      ].join('\n'),
    });

    expect(rows.rows.map((row) => row.title)).toEqual([
      'First visual card',
      'Second visual card',
      'Third visual card',
    ]);
    expect(rows.cardPatternConfidence).toBeGreaterThan(0.7);
  });

  it('attaches visibleRegionRows to chrome_read_page output', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5301,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search',
      title: 'Search results',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Results" [ref=ref_main] (x=620,y=360)',
        '  - article "Result card" [ref=ref_card_1] (x=300,y=240)',
        '    - link "First visible result" [ref=ref_card_1_link] (x=300,y=210) href="/items/1"',
        '    - generic "Source One" [ref=ref_card_1_source] (x=300,y=248)',
        '    - generic "today" [ref=ref_card_1_meta] (x=300,y=280)',
        '    - generic "10 likes" [ref=ref_card_1_likes] (x=300,y=312)',
        '  - article "Result card" [ref=ref_card_2] (x=700,y=250)',
        '    - link "Second visible result" [ref=ref_card_2_link] (x=700,y=220) href="/items/2"',
        '    - generic "Source Two" [ref=ref_card_2_source] (x=700,y=258)',
        '    - generic "yesterday" [ref=ref_card_2_meta] (x=700,y=290)',
        '    - generic "8 likes" [ref=ref_card_2_likes] (x=700,y=322)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_card_1_link', selector: 'a[href="/items/1"]' },
        { ref: 'ref_card_2_link', selector: 'a[href="/items/2"]' },
      ],
      stats: { processed: 10, included: 8, durationMs: 9 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const firstText = result.content.find(
      (item): item is { type: 'text'; text: string } =>
        item.type === 'text' && typeof item.text === 'string',
    );
    expect(firstText).toBeDefined();
    const payload = JSON.parse(firstText!.text);

    expect(result.isError).toBe(false);
    expect(payload.visibleRegionRows).toMatchObject({
      sourceDataSource: 'dom_region_rows',
      visibleRegionRowsUsed: true,
      rowCount: 2,
    });
    expect(payload.visibleRegionRows.rows[0].title).toBe('First visible result');
  });
});
