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

  it('does not promote one isolated text node as DOM region rows', () => {
    const rows = extractVisibleRegionRows({
      pageContent: '- generic "Simple text content for a minimal page." [ref=ref_text] (x=24,y=24)',
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.visibleRegionRowsRejectedReason).toBe('single_isolated_text');
    expect(rows.rejectedRegionReasonDistribution.single_isolated_text).toBeGreaterThan(0);
  });

  it('does not promote one standalone link as DOM region rows', () => {
    const rows = extractVisibleRegionRows({
      pageContent: '- link "Only visible result" [ref=ref_only] (x=300,y=210) href="/items/only"',
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.visibleRegionRowsRejectedReason).toBe('single_isolated_text');
  });

  it('promotes multiple standalone result links as DOM region rows', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- link "First independent result" [ref=ref_first] (x=300,y=210) href="/items/first"',
        '- link "Image: strip" [ref=ref_image] (x=300,y=260) href="/user/profile/alpha"',
        '- link "Second independent result" [ref=ref_second] (x=700,y=220) href="/items/second"',
        '- link "Legal notice" [ref=ref_legal] (x=80,y=820) href="/legal/license.pdf"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'First independent result',
      'Second independent result',
    ]);
    expect(rows.targetRefCoverageRate).toBeGreaterThanOrEqual(0.95);
  });

  it('promotes localized standalone business links as DOM region rows', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- link "AI的七层关系，你搞懂了几层？" [ref=ref_48] href="/search_result/1?token=a"',
        '- link "学会这些AI工具，轻松替你上班" [ref=ref_58] href="/search_result/2?token=b"',
        '- link "2026年最值得关注的AI应用清单来啦！" [ref=ref_68] href="/search_result/3?token=c"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(3);
    expect(rows.visibleDomRowsCandidateCount).toBe(3);
    expect(rows.rows.map((row) => row.targetRef)).toEqual(['ref_48', 'ref_58', 'ref_68']);
    expect(rows.targetRefCoverageRate).toBeGreaterThanOrEqual(0.95);
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

  it('promotes standalone result links but rejects legal, profile, and image links', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- main "Search results" [ref=ref_main] (x=620,y=360)',
        '  - link "Image: cover" [ref=ref_img_1] (x=280,y=220) href="/media/cover.png"',
        '  - link "Creator profile avatar" [ref=ref_profile_1] (x=280,y=420) href="/user/profile/alpha"',
        '  - link "Neutral result guide for planning work" [ref=ref_result_1] (x=300,y=360) href="/search_result/note-1"',
        '  - link "Neutral result checklist with useful tools" [ref=ref_result_2] (x=700,y=360) href="/search_result/note-2"',
        '  - link "Example site network trading service license" [ref=ref_legal] (x=84,y=826) href="/legal/license.pdf"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'Neutral result guide for planning work',
      'Neutral result checklist with useful tools',
    ]);
    expect(rows.regionQualityScore).toBeGreaterThanOrEqual(0.7);
    expect(rows.targetRefCoverageRate).toBeGreaterThanOrEqual(0.95);
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(/Image:|profile|license/i);
  });

  it('does not let a broad generic container hide standalone result links', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- generic "Search page" [ref=ref_root] (x=0,y=0)',
        '  - textbox "Search" [ref=ref_search] (x=420,y=42)',
        '  - button "Creator center" [ref=ref_creator] (x=1180,y=38)',
        '  - button "Business" [ref=ref_business] (x=1300,y=38)',
        '  - button "All" [ref=ref_all] (x=280,y=110)',
        '  - button "Nearby" [ref=ref_nearby] (x=380,y=110)',
        '  - link "Vehicle automation checklist for holiday travel" [ref=ref_result_1] (x=320,y=260) href="/search_result/note-1"',
        '  - link "Reverse route planning from a nearby city" [ref=ref_result_2] (x=640,y=280) href="/search_result/note-2"',
        '  - link "Image: cover" [ref=ref_img] (x=300,y=220) href="/media/cover.png"',
        '  - link "Creator profile avatar" [ref=ref_profile] (x=610,y=420) href="/user/profile/alpha"',
        '  - link "Service license" [ref=ref_license] (x=84,y=826) href="/legal/license.pdf"',
        '  - generic "ICP license footer" [ref=ref_footer] (x=84,y=850)',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'Vehicle automation checklist for holiday travel',
      'Reverse route planning from a nearby city',
    ]);
    expect(rows.visibleDomRowsCandidateCount).toBe(2);
    expect(rows.targetRefCoverageRate).toBeGreaterThanOrEqual(0.95);
    expect(rows.regionQualityScore).toBeGreaterThanOrEqual(0.7);
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(
      /Creator|Business|Image:|profile|license|ICP/i,
    );
  });

  it('promotes visible standalone result links on mixed search pages without site-specific rules', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- generic "Search page" [ref=ref_root] (x=0,y=0)',
        '  - textbox "Search examples" [ref=ref_search] (x=420,y=42)',
        '  - button "Creator center" [ref=ref_creator] (x=1180,y=38)',
        '  - button "Business cooperation" [ref=ref_business] (x=1300,y=38)',
        '  - link "Image: small logo" [ref=ref_logo] (x=48,y=38) href="/explore"',
        '  - link "Network trading service notice" [ref=ref_notice] (x=84,y=826) href="//cdn.example.test/legal/service.pdf"',
        '  - link "A practical seven-layer AI workflow" [ref=ref_result_1] (x=320,y=260) href="/search_result/note-1?token=abc"',
        '  - link "Image: result cover" [ref=ref_cover_1] (x=300,y=220) href="/user/profile/alpha"',
        '  - link "Use AI tools to finish routine office work" [ref=ref_result_2] (x=640,y=280) href="/search_result/note-2?token=def"',
        '  - link "Image: result author" [ref=ref_avatar_2] (x=610,y=420) href="/user/profile/beta"',
        '  - link "Build a solo business with AI automation" [ref=ref_result_3] (x=960,y=300) href="/search_result/note-3?token=ghi"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'A practical seven-layer AI workflow',
      'Use AI tools to finish routine office work',
      'Build a solo business with AI automation',
    ]);
    expect(rows.visibleDomRowsCandidateCount).toBe(3);
    expect(rows.visibleDomRowsSelectedCount).toBe(3);
    expect(rows.regionQualityScore).toBeGreaterThanOrEqual(0.7);
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(
      /Image:|Creator center|Business cooperation|service notice|profile/i,
    );
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
    expect(payload).toMatchObject({
      kind: 'dom_region_rows',
      selectedDataSource: 'dom_region_rows',
      rowCount: 2,
      visibleRegionRowsUsed: true,
      targetRefCoverageRate: expect.any(Number),
      regionQualityScore: expect.any(Number),
      visibleDomRowsCandidateCount: 2,
      visibleDomRowsSelectedCount: 2,
    });
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

  it('builds DOM region rows from interactive fallback when the accessibility tree is sparse', async () => {
    const originalScripting = chrome.scripting;
    const originalTabsSendMessage = chrome.tabs.sendMessage;
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5302,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search',
      title: 'Search results',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.tabs as any).sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('interactive helper missing'));
    (chrome as any).scripting = {
      executeScript: vi.fn().mockResolvedValue(undefined),
    };
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: '- generic "Search results"',
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: '- generic "Search results"',
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [
          {
            type: 'link',
            text: 'First visible result',
            selector: 'section:nth-of-type(1) a.result-title',
            href: '/items/1',
            coordinates: { x: 300, y: 210 },
          },
          {
            type: 'link',
            text: 'Second visible result',
            selector: 'section:nth-of-type(2) a.result-title',
            href: '/items/2',
            coordinates: { x: 700, y: 220 },
          },
        ],
        scrollY: 0,
        pixelsBelow: 900,
      });

    try {
      const result = await readPageTool.execute({ mode: 'compact' });
      const firstText = result.content.find(
        (item): item is { type: 'text'; text: string } =>
          item.type === 'text' && typeof item.text === 'string',
      );
      expect(firstText).toBeDefined();
      const payload = JSON.parse(firstText!.text);

      expect(result.isError).toBe(false);
      expect(payload).toMatchObject({
        kind: 'dom_region_rows',
        selectedDataSource: 'dom_region_rows',
        rowCount: 2,
        visibleRegionRowsUsed: true,
        targetRefCoverageRate: expect.any(Number),
        regionQualityScore: expect.any(Number),
        visibleDomRowsCandidateCount: 2,
        visibleDomRowsSelectedCount: 2,
      });
      expect(payload.pageContext).toMatchObject({
        sparse: true,
        fallbackUsed: true,
        fallbackSource: 'get_interactive_elements',
        refMapCount: 2,
      });
      expect(payload.visibleRegionRows).toMatchObject({
        sourceDataSource: 'dom_region_rows',
        visibleRegionRowsUsed: true,
        rowCount: 2,
        targetRefCoverageRate: expect.any(Number),
      });
      expect(payload.visibleRegionRows.rows[0]).toMatchObject({
        targetRef: 'ref_fallback_1',
        title: 'First visible result',
        qualityReasons: expect.arrayContaining(['target_ref_available']),
      });
      expect(payload.fullSnapshot).toBeUndefined();
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(5302, {
        action: 'chrome_get_interactive_elements_ping',
      });
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 5302 },
        files: ['inject-scripts/interactive-elements-helper.js'],
        world: 'ISOLATED',
      });
    } finally {
      (chrome.tabs as any).sendMessage = originalTabsSendMessage;
      (chrome as any).scripting = originalScripting;
    }
  });

  it('does not classify a page as login_required when fallback DOM rows are usable', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5303,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search',
      title: 'Sign in - Search',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'ensureInteractiveElementsHelper').mockResolvedValue(undefined);
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: '手机号 验证码 登录',
        refMap: [],
        stats: { processed: 3, included: 3, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: '手机号 验证码 登录',
        refMap: [],
        stats: { processed: 3, included: 3, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [
          {
            type: 'button',
            text: '登录',
            selector: 'button.login',
            coordinates: { x: 980, y: 48 },
          },
          {
            type: 'button',
            text: '手机号',
            selector: 'button.phone-login',
            coordinates: { x: 1010, y: 88 },
          },
          {
            type: 'link',
            text: 'Neutral product guide for AI workflows',
            selector: 'section:nth-of-type(1) a.result-title',
            href: '/items/1',
            coordinates: { x: 300, y: 210 },
          },
          {
            type: 'link',
            text: 'Practical tool checklist for small teams',
            selector: 'section:nth-of-type(2) a.result-title',
            href: '/items/2',
            coordinates: { x: 700, y: 220 },
          },
        ],
        scrollY: 0,
        pixelsBelow: 900,
      });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.summary).toMatchObject({
      pageRole: 'unknown',
      primaryRegion: 'visible_results',
    });
    expect(payload.visibleRegionRows).toMatchObject({
      sourceRegion: 'visible_results',
      visibleRegionRowsUsed: true,
      rowCount: 2,
    });
    expect(
      payload.visibleRegionRows.rows.map((row: { sourceRegion: string }) => row.sourceRegion),
    ).toEqual(['visible_results', 'visible_results']);
  });

  it('emits explicit DOM JSON and readiness evidence for sparse text pages without rows', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5304,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/simple-text',
      title: 'Simple Text Page',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'ensureInteractiveElementsHelper').mockResolvedValue(undefined);
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          '- heading "Information Page"',
          '- paragraph "This is a simple information page with some text content but no structured data cards or API endpoints."',
        ].join('\n'),
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          '- heading "Information Page"',
          '- paragraph "This is a simple information page with some text content but no structured data cards or API endpoints."',
        ].join('\n'),
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [],
      });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      kind: 'dom_json',
      selectedDataSource: 'dom_json',
      readinessVerdict: 'ready',
      rowCount: 0,
      visibleRegionRowsUsed: false,
    });
    expect(payload.summary.quality).toBe('sparse');
  });

  it('emits empty readiness evidence for empty pages without rows', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5305,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/empty',
      title: 'Empty',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'ensureInteractiveElementsHelper').mockResolvedValue(undefined);
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: '',
        refMap: [],
        stats: { processed: 0, included: 0, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: '',
        refMap: [],
        stats: { processed: 0, included: 0, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [],
      });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      kind: 'dom_json',
      selectedDataSource: 'dom_json',
      readinessVerdict: 'empty',
      rowCount: 0,
      visibleRegionRowsUsed: false,
    });
    expect(payload.summary.quality).toBe('sparse');
  });
});
