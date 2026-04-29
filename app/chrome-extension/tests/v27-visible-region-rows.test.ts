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
      url: 'https://example.test/search',
      title: 'Search results',
      viewport: { width: 1280, height: 720, dpr: 1 },
      scrollY: 240,
      pixelsBelow: 960,
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
    expect(rows.regionQualityScore).toBeGreaterThanOrEqual(0.7);
    expect(rows.visibleDomRowsCandidateCount).toBe(2);
    expect(rows.visibleDomRowsSelectedCount).toBe(2);
    expect(rows.pageInfo).toMatchObject({
      url: 'https://example.test/search',
      title: 'Search results',
      viewport: { width: 1280, height: 720, dpr: 1 },
      scrollY: 240,
      pixelsAbove: 240,
      pixelsBelow: 960,
      candidateRegionCount: 2,
    });
    expect(rows.rows[0]).toMatchObject({
      rowId: expect.stringContaining('ref_card_1'),
      title: 'Mountain trip planning',
      primaryText: 'Travel Notes',
      summary: expect.stringContaining('Travel Notes'),
      metaText: '3 hours ago',
      interactionText: '1.2k likes',
      visibleTextFields: expect.arrayContaining(['Mountain trip planning', 'Travel Notes']),
      targetRef: 'ref_card_1_link',
      targetRefCoverageRate: 0.99,
      boundingBox: { x: 300, y: 210, width: 0, height: 102 },
      regionId: 'ref_card_1',
      sourceRegion: 'main_results',
      qualityReasons: expect.arrayContaining(['target_ref_available', 'visible_bounding_box']),
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
    expect(rows.visibleRegionRowsRejectedReason).toBe('footer_like_region');
    expect(rows.lowValueRegionRejectedCount).toBeGreaterThan(0);
    expect(rows.footerLikeRejectedCount).toBeGreaterThan(0);
    expect(rows.navigationLikeRejectedCount).toBeGreaterThan(0);
    expect(rows.rejectedRegionReasonDistribution.footer_like_region).toBeGreaterThan(0);
  });

  it('rejects navigation and sidebar-only regions with closed evidence', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- navigation "Primary navigation" [ref=ref_nav] (x=0,y=0)',
        '  - link "Home" [ref=ref_home] (x=20,y=20) href="/"',
        '  - link "Account settings" [ref=ref_settings] (x=20,y=60) href="/settings"',
        '- generic "Sidebar menu" [ref=ref_side] (x=0,y=120)',
        '  - link "Help center" [ref=ref_help] (x=20,y=160) href="/help"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.navigationLikeRejectedCount).toBeGreaterThan(0);
    expect(rows.rejectedRegionReasonDistribution.navigation_like_region).toBeGreaterThan(0);
  });

  it('rejects visible cards when targetRef coverage is insufficient', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- main "Results" (x=600,y=360)',
        '  - article "Result card" (x=300,y=240)',
        '    - link "Visible but unaddressable result" (x=300,y=210) href="/items/1"',
        '    - generic "Source One" (x=300,y=248)',
        '  - article "Result card" (x=700,y=250)',
        '    - link "Second unaddressable result" (x=700,y=220) href="/items/2"',
        '    - generic "Source Two" (x=700,y=258)',
      ].join('\n'),
    });

    expect(rows.visibleDomRowsCandidateCount).toBe(2);
    expect(rows.visibleDomRowsSelectedCount).toBe(0);
    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.visibleRegionRowsRejectedReason).toBe('target_ref_coverage_insufficient');
    expect(rows.targetRefCoverageRejectedCount).toBe(2);
  });

  it('filters shell/legal/date/image-only fragments instead of returning them as result rows', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- generic "Search page" [ref=ref_root] (x=0,y=0)',
        '  - generic "业务合作" [ref=ref_business] (x=2100,y=50)',
        '  - generic "示例站点_营业执照" [ref=ref_license] (x=200,y=800)',
        '    - generic "示例站点_公网安备" [ref=ref_police] (x=220,y=820)',
        '    - generic "示例站点_网络文化经营许可" [ref=ref_culture] (x=240,y=840)',
        '  - article "Result card" [ref=ref_card_1] (x=300,y=240)',
        '    - image "Image: cover.jpeg" [ref=ref_img_1] (x=300,y=210)',
        '    - link "五一周边游盘点 | 江浙沪20个旅游好去处！" [ref=ref_card_1_link] (x=300,y=360) href="/items/1"',
        '    - generic "2026年4月27日 GMT+8 20:33" [ref=ref_card_1_time] (x=300,y=390)',
        '    - generic "926" [ref=ref_card_1_likes] (x=300,y=420)',
        '  - article "Result card" [ref=ref_card_2] (x=700,y=240)',
        '    - image "Image: second.jpeg" [ref=ref_img_2] (x=700,y=210)',
        '    - link "五一逃离江浙沪！5个冷门宝地1-3h直达" [ref=ref_card_2_link] (x=700,y=360) href="/items/2"',
        '    - generic "01:50" [ref=ref_card_2_time] (x=700,y=390)',
        '    - generic "560" [ref=ref_card_2_likes] (x=700,y=420)',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual([
      '五一周边游盘点 | 江浙沪20个旅游好去处！',
      '五一逃离江浙沪！5个冷门宝地1-3h直达',
    ]);
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(
      /Image:|业务合作|营业执照|公网安备|2026年4月27日|01:50/,
    );
    expect(JSON.stringify(rows)).not.toContain('<article');
  });

  it('does not treat a broad page shell container as a single result row', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- generic "Page" [ref=ref_root] (x=0,y=0)',
        '  - link "Skip to content" [ref=ref_skip] (x=10,y=10) href="#content"',
        '  - navigation "Main menu" [ref=ref_nav] (x=20,y=20)',
        '    - link "Home" [ref=ref_home] (x=30,y=30) href="/"',
        '    - link "Explore" [ref=ref_explore] (x=80,y=30) href="/explore"',
        '  - generic "沪ICP备123456号" [ref=ref_icp] (x=20,y=680)',
        '  - generic "创作中心" [ref=ref_creator] (x=120,y=680)',
        '  - generic "放映厅" [ref=ref_screen] (x=220,y=680)',
        '  - article "Result card" [ref=ref_card_1] (x=300,y=240)',
        '    - link "Real visible travel note" [ref=ref_card_1_link] (x=300,y=210) href="/items/1"',
        '    - generic "Travel Author" [ref=ref_card_1_author] (x=300,y=248)',
        '    - generic "88 likes" [ref=ref_card_1_likes] (x=300,y=312)',
        '  - article "Result card" [ref=ref_card_2] (x=700,y=250)',
        '    - link "Second real note" [ref=ref_card_2_link] (x=700,y=220) href="/items/2"',
        '    - generic "Route Author" [ref=ref_card_2_author] (x=700,y=258)',
        '    - generic "42 likes" [ref=ref_card_2_likes] (x=700,y=322)',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'Real visible travel note',
      'Second real note',
    ]);
    expect(rows.rows.map((row) => row.title)).not.toContain('Skip to content');
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(/ICP备|创作中心|放映厅/);
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
      regionQualityScore: expect.any(Number),
      pageInfo: {
        url: 'https://example.test/search',
        title: 'Search results',
        viewport: { width: 1280, height: 720, dpr: 1 },
        scrollY: null,
        pixelsAbove: null,
        pixelsBelow: null,
        visibleRegionCount: expect.any(Number),
        candidateRegionCount: 2,
      },
    });
    expect(payload.visibleRegionRows.rows[0]).toMatchObject({
      rowId: expect.any(String),
      targetRef: 'ref_card_1_link',
      visibleTextFields: expect.arrayContaining(['First visible result']),
      boundingBox: expect.any(Object),
      qualityReasons: expect.arrayContaining(['target_ref_available']),
    });
    expect(payload.visibleRegionRows.rows[0].title).toBe('First visible result');
    expect(JSON.stringify(payload.visibleRegionRows)).not.toContain('<html');
  });
});
