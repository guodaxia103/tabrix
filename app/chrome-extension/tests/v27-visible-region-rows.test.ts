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

  it('groups GitHub-like repo search results without topic or footer rows', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'search_results',
      url: 'https://github.com/search?q=browser&type=repositories',
      title: 'Repository search results',
      viewport: { width: 1280, height: 720, dpr: 1 },
      pageContent: [
        '- main "Repository search results" [ref=ref_main] (x=640,y=370)',
        '  - search "Search" [ref=ref_search] (x=420,y=32)',
        '    - searchbox "Search or jump to..." [ref=ref_query] (x=410,y=32)',
        '  - generic "Repository result" [ref=ref_repo_1] (x=260,y=160)',
        '    - heading "lightpanda-io/browser" [ref=ref_heading_1] (x=260,y=150)',
        '      - link "lightpanda-io/browser" [ref=ref_repo_1_link] (x=260,y=150) href="/lightpanda-io/browser"',
        '    - generic "A lightweight browser runtime for automation" [ref=ref_desc_1] (x=260,y=188)',
        '    - link "browser" [ref=ref_topic_1] (x=260,y=226) href="/topics/browser"',
        '    - link "5.2k" [ref=ref_star_1] (x=620,y=226) href="/lightpanda-io/browser/stargazers"',
        '    - generic "Updated May 8, 2026" [ref=ref_updated_1] (x=700,y=226)',
        '  - generic "Repository result" [ref=ref_repo_2] (x=260,y=270)',
        '    - heading "vercel-labs/agent-browser" [ref=ref_heading_2] (x=260,y=260)',
        '      - link "vercel-labs/agent-browser" [ref=ref_repo_2_link] (x=260,y=260) href="/vercel-labs/agent-browser"',
        '    - generic "AI browser control toolkit" [ref=ref_desc_2] (x=260,y=298)',
        '    - link "automation" [ref=ref_topic_2] (x=260,y=336) href="/topics/automation"',
        '    - link "1.9k" [ref=ref_star_2] (x=620,y=336) href="/vercel-labs/agent-browser/stargazers"',
        '    - generic "Updated Apr 30, 2026" [ref=ref_updated_2] (x=700,y=336)',
        '  - generic "Repository result" [ref=ref_repo_3] (x=260,y=380)',
        '    - heading "hyperbrowserai/HyperAgent" [ref=ref_heading_3] (x=260,y=370)',
        '      - link "hyperbrowserai/HyperAgent" [ref=ref_repo_3_link] (x=260,y=370) href="/hyperbrowserai/HyperAgent"',
        '    - generic "Agentic web automation examples" [ref=ref_desc_3] (x=260,y=408)',
        '    - link "agent" [ref=ref_topic_3] (x=260,y=446) href="/topics/agent"',
        '    - link "2.1k" [ref=ref_star_3] (x=620,y=446) href="/hyperbrowserai/HyperAgent/stargazers"',
        '    - generic "Updated May 1, 2026" [ref=ref_updated_3] (x=700,y=446)',
        '  - generic "Repository result" [ref=ref_repo_4] (x=260,y=490)',
        '    - heading "ServiceNow/BrowserGym" [ref=ref_heading_4] (x=260,y=480)',
        '      - link "ServiceNow/BrowserGym" [ref=ref_repo_4_link] (x=260,y=480) href="/ServiceNow/BrowserGym"',
        '    - generic "Benchmark environment for web agents" [ref=ref_desc_4] (x=260,y=518)',
        '    - link "benchmark" [ref=ref_topic_4] (x=260,y=556) href="/topics/benchmark"',
        '    - link "3.4k" [ref=ref_star_4] (x=620,y=556) href="/ServiceNow/BrowserGym/stargazers"',
        '    - generic "Updated Mar 27, 2026" [ref=ref_updated_4] (x=700,y=556)',
        '  - generic "Repository result" [ref=ref_repo_5] (x=260,y=600)',
        '    - heading "ntegrals/openbrowser" [ref=ref_heading_5] (x=260,y=590)',
        '      - link "ntegrals/openbrowser" [ref=ref_repo_5_link] (x=260,y=590) href="/ntegrals/openbrowser"',
        '    - generic "Open browser automation primitives" [ref=ref_desc_5] (x=260,y=628)',
        '    - link "browser" [ref=ref_topic_5] (x=260,y=666) href="/topics/browser"',
        '    - link "944" [ref=ref_star_5] (x=620,y=666) href="/ntegrals/openbrowser/stargazers"',
        '    - generic "Updated Feb 12, 2026" [ref=ref_updated_5] (x=700,y=666)',
        '  - footer "Footer" [ref=ref_footer] (x=640,y=920)',
        '    - link "Sponsor" [ref=ref_sponsor] (x=260,y=920) href="/sponsors"',
        '    - link "Privacy" [ref=ref_privacy] (x=340,y=920) href="/privacy"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(5);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'lightpanda-io/browser',
      'vercel-labs/agent-browser',
      'hyperbrowserai/HyperAgent',
      'ServiceNow/BrowserGym',
      'ntegrals/openbrowser',
    ]);
    for (const row of rows.rows) {
      expect(row.targetRef).toMatch(/^ref_repo_\d+_link$/);
      expect(row.metaText).toMatch(/^Updated /);
      expect(row.interactionText).toMatch(/^\d+(?:\.\d+)?k?$/);
      expect(row.visibleTextFields).toEqual(
        expect.arrayContaining([row.title, row.metaText, row.interactionText]),
      );
    }
    expect(rows.rows.flatMap((row) => row.visibleTextFields)).not.toEqual(
      expect.arrayContaining(['browser', 'automation', 'agent', 'benchmark', 'Sponsor', 'Privacy']),
    );
  });

  it('groups sparse GitHub-like repo links with nearby metadata rows', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'viewport',
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      title: 'Repository search results',
      viewport: { width: 1280, height: 720, dpr: 1 },
      pageContent: [
        '- main "Repository search results" [ref=ref_main] (x=640,y=370)',
        '  - generic "Repository result" [ref=ref_repo_1] (x=432,y=153)',
        '    - link "aaif-goose/goose" [ref=ref_repo_1_link] (x=432,y=153) href="/aaif-goose/goose"',
        '  - link "45k" [ref=ref_star_1] (x=524,y=239) href="/aaif-goose/goose/stargazers"',
        '  - generic "May 11, 2026, 2:09 AM UTC" [ref=ref_updated_1] (x=560,y=239)',
        '  - generic "Repository result" [ref=ref_repo_2] (x=427,y=311)',
        '    - link "iOfficeAI/AionUi" [ref=ref_repo_2_link] (x=427,y=311) href="/iOfficeAI/AionUi"',
        '  - link "24.3k" [ref=ref_star_2] (x=561,y=397) href="/iOfficeAI/AionUi/stargazers"',
        '  - generic "May 11, 2026, 2:40 AM UTC" [ref=ref_updated_2] (x=610,y=397)',
        '  - generic "Repository result" [ref=ref_repo_3] (x=482,y=469)',
        '    - link "olimorris/codecompanion.nvim" [ref=ref_repo_3_link] (x=482,y=469) href="/olimorris/codecompanion.nvim"',
        '  - link "6.6k" [ref=ref_star_3] (x=516,y=555) href="/olimorris/codecompanion.nvim/stargazers"',
        '  - generic "May 10, 2026, 10:05 AM UTC" [ref=ref_updated_3] (x=552,y=555)',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(3);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'aaif-goose/goose',
      'iOfficeAI/AionUi',
      'olimorris/codecompanion.nvim',
    ]);
    for (const row of rows.rows) {
      expect(row.targetRef).toMatch(/^ref_repo_\d+_link$/);
      expect(row.metaText).toMatch(/2026/);
      expect(row.interactionText).toMatch(/^\d+(?:\.\d+)?k?$/);
      expect(row.visibleTextFields).toEqual(
        expect.arrayContaining([row.title, row.metaText, row.interactionText]),
      );
    }
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(/UTC/);
  });

  it('does not promote meta-only timestamp fragments as standalone rows', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- generic "Search results" [ref=ref_main] (x=640,y=370)',
        '  - generic "Repository result" [ref=ref_repo] (x=348,y=153)',
        '    - link "example/project" [ref=ref_repo_link] (x=348,y=153) href="/example/project"',
        '    - generic "Example repo summary" [ref=ref_desc] (x=348,y=190)',
        '    - link "120 stars" [ref=ref_stars] (x=420,y=239) href="/example/project/stargazers"',
        '    - generic "Updated" [ref=ref_updated_label] (x=500,y=239)',
        '  - generic "May 11, 2026, 2:09 AM UTC" [ref=ref_updated_time] (x=560,y=239)',
        '  - generic "Repository result" [ref=ref_repo_2] (x=348,y=311)',
        '    - link "example/toolkit" [ref=ref_repo_2_link] (x=348,y=311) href="/example/toolkit"',
        '    - generic "Toolkit summary" [ref=ref_desc_2] (x=348,y=348)',
        '    - link "88 stars" [ref=ref_stars_2] (x=420,y=397) href="/example/toolkit/stargazers"',
        '    - generic "Updated" [ref=ref_updated_label_2] (x=500,y=397)',
        '  - generic "Apr 21, 2026, 12:16 AM UTC" [ref=ref_updated_time_2] (x=560,y=397)',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual(['example/project', 'example/toolkit']);
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(/UTC/);
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

  it('rejects legal and report-only links as non-business rows', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- link "Network rumor exposure desk" [ref=ref_report_1] (x=200,y=620) href="/report/rumors"',
        '- link "Online harmful information report" [ref=ref_report_2] (x=200,y=660) href="/report/harmful"',
        '- link "互联网举报中心" [ref=ref_report_3] (x=200,y=700) href="/report"',
        '- link "网上有害信息举报专区" [ref=ref_report_4] (x=200,y=740) href="/report/harmful-info"',
        '- link "增值电信业务经营许可证" [ref=ref_license] (x=200,y=780) href="/legal/license.pdf"',
        '- generic "公网安备 00000000000000" [ref=ref_police] (x=200,y=820)',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.visibleDomRowsCandidateCount).toBe(0);
    expect(rows.visibleDomRowsSelectedCount).toBe(0);
    expect(rows.visibleRegionRowsRejectedReason).toBe('footer_like_region');
    expect(rows.footerLikeRejectedCount).toBeGreaterThan(0);
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
        '- link "七层工作流方法，你理解了几层？" [ref=ref_48] href="/search_result/1?token=a"',
        '- link "学会这些自动化工具，轻松整理日常任务" [ref=ref_58] href="/search_result/2?token=b"',
        '- link "2026年值得关注的实用工具清单" [ref=ref_68] href="/search_result/3?token=c"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(3);
    expect(rows.visibleDomRowsCandidateCount).toBe(3);
    expect(rows.rows.map((row) => row.targetRef)).toEqual(['ref_48', 'ref_58', 'ref_68']);
    expect(rows.targetRefCoverageRate).toBeGreaterThanOrEqual(0.95);
  });

  it('uses structured interactive links when visible text is nested under link shells', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- generic "Search page" [ref=ref_root] (x=0,y=0)',
        '  - link "" [ref=ref_result_1] (x=300,y=210) href="/search_result/1?token=a"',
        '    - generic "A practical seven-layer AI workflow" [ref=ref_title_1] (x=300,y=248)',
        '  - link "" [ref=ref_profile_1] (x=300,y=260) href="/user/profile/alpha"',
        '    - generic "Image: strip" [ref=ref_image_1] (x=300,y=260)',
        '  - link "" [ref=ref_result_2] (x=700,y=220) href="/search_result/2?token=b"',
        '    - generic "Use AI tools to finish routine office work" [ref=ref_title_2] (x=700,y=258)',
        '  - link "" [ref=ref_result_3] (x=960,y=230) href="/search_result/3?token=c"',
        '    - generic "Build a solo business with AI automation" [ref=ref_title_3] (x=960,y=268)',
      ].join('\n'),
      fallbackInteractiveElements: [
        {
          ref: 'ref_result_1',
          role: 'link',
          name: 'A practical seven-layer AI workflow',
          href: '/search_result/1?token=a',
        },
        {
          ref: 'ref_profile_1',
          role: 'link',
          name: 'Image: strip',
          href: '/user/profile/alpha',
        },
        {
          ref: 'ref_result_2',
          role: 'link',
          name: 'Use AI tools to finish routine office work',
          href: '/search_result/2?token=b',
        },
        {
          ref: 'ref_result_3',
          role: 'link',
          name: 'Build a solo business with AI automation',
          href: '/search_result/3?token=c',
        },
      ],
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.visibleDomRowsCandidateCount).toBe(3);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'A practical seven-layer AI workflow',
      'Use AI tools to finish routine office work',
      'Build a solo business with AI automation',
    ]);
    expect(rows.rows.map((row) => row.targetRef)).toEqual([
      'ref_result_1',
      'ref_result_2',
      'ref_result_3',
    ]);
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(/Image:|profile/i);
  });

  it('rejects fallback interactive creator and footer utility links', () => {
    const rows = extractVisibleRegionRows({
      pageContent: '- generic "Search shell"',
      sourceRegion: 'visible_results',
      fallbackInteractiveElements: [
        { ref: 'ref_upload', role: 'link', name: '发布视频/图文', href: '/creator/upload' },
        {
          ref: 'ref_learning',
          role: 'link',
          name: '创作者学习中心',
          href: '/creator/learning',
        },
        { ref: 'ref_ads', role: 'link', name: '广告投放', href: '/advertising' },
        { ref: 'ref_recovery', role: 'link', name: '账号找回', href: '/account/recovery' },
        { ref: 'ref_contact', role: 'link', name: '联系我们', href: '/contact-us' },
        { ref: 'ref_friend', role: 'link', name: '友情链接', href: '/friend-links' },
        { ref: 'ref_license', role: 'link', name: 'Business license', href: '/legal/license' },
        { ref: 'ref_report', role: 'link', name: 'Report center', href: '/report' },
      ],
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.visibleDomRowsCandidateCount).toBe(0);
    expect(rows.visibleDomRowsSelectedCount).toBe(0);
    expect(rows.visibleRegionRowsRejectedReason).toBe('footer_like_region');
    expect(rows.lowValueRegionRejectedCount).toBeGreaterThan(0);
    expect(rows.footerLikeRejectedCount).toBeGreaterThan(0);
    expect(rows.rejectedRegionReasonDistribution.low_value_region).toBeGreaterThan(0);
    expect(rows.rejectedRegionReasonDistribution.footer_like_region).toBeGreaterThan(0);
  });

  it('keeps fallback business results while rejecting utility links', () => {
    const rows = extractVisibleRegionRows({
      pageContent: '- generic "Sparse search shell"',
      sourceRegion: 'visible_results',
      fallbackInteractiveElements: [
        {
          ref: 'ref_result_1',
          role: 'link',
          name: 'Practical workflow guide for solo teams',
          href: '/items/1',
        },
        { ref: 'ref_upload', role: 'link', name: 'Upload video', href: '/creator/upload' },
        {
          ref: 'ref_result_2',
          role: 'link',
          name: 'Automation checklist for daily operations',
          href: '/items/2',
        },
        { ref: 'ref_ads', role: 'link', name: 'Advertising', href: '/ads' },
        { ref: 'ref_contact', role: 'link', name: 'Contact us', href: '/contact-us' },
        { ref: 'ref_sitemap', role: 'link', name: 'Site map', href: '/site-map' },
      ],
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(2);
    expect(rows.visibleDomRowsCandidateCount).toBe(2);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'Practical workflow guide for solo teams',
      'Automation checklist for daily operations',
    ]);
    expect(rows.rows.map((row) => row.targetRef)).toEqual(['ref_result_1', 'ref_result_2']);
    expect(rows.rows.flatMap((row) => row.visibleTextFields).join(' ')).not.toMatch(
      /Upload|Advertising|Contact us|Site map/i,
    );
    expect(rows.lowValueRegionRejectedCount).toBeGreaterThan(0);
  });

  it('builds fallback rows from long visible text when semantic rows are unavailable', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- navigation "Primary navigation" [ref=ref_nav]',
        '  - link "Home" [ref=ref_home] href="/"',
        '- footer "Footer" [ref=ref_footer]',
        '  - link "Privacy" [ref=ref_privacy] href="/privacy"',
      ].join('\n'),
      sourceRegion: 'visible_results',
      visibleTextContent: [
        'Search',
        'All',
        'Practical automation planning guide for small teams using browser workflows',
        'This walkthrough explains how a team can collect requirements, compare tools, and finish routine web tasks with fewer manual checks.',
        'Workflow Lab',
        '2 hours ago',
        '89 likes',
        'Reliable operations checklist for browser based AI assistants',
        'A compact checklist covering page reading, result selection, logs, and handoff evidence for daily operations.',
        'Ops Review',
        'yesterday',
        '34 comments',
        'Privacy',
        'Terms',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'Practical automation planning guide for small teams using browser workflows',
      'Reliable operations checklist for browser based AI assistants',
    ]);
    expect(rows.rows.every((row) => row.targetRef === null)).toBe(true);
    expect(rows.rows.every((row) => row.sourceRegion === 'visible_text')).toBe(true);
    expect(rows.rows[0].qualityReasons).toContain('visible_text_fallback');
    expect(rows.footerLikeRejectedCount).toBeGreaterThan(0);
    expect(rows.navigationLikeRejectedCount).toBeGreaterThan(0);
  });

  it('rejects footer/legal-only visible text fallback content', () => {
    const rows = extractVisibleRegionRows({
      pageContent: '- generic "Sparse page shell"',
      sourceRegion: 'visible_results',
      visibleTextContent: [
        'Privacy policy',
        'Terms of service',
        'Copyright 2026 Example Platform',
        'Business license information',
        'Internet report center',
        'Online harmful information report',
        'Contact us',
        'Site map',
        'Download app',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.visibleRegionRowsRejectedReason).toBe('footer_like_region');
    expect(rows.footerLikeRejectedCount).toBeGreaterThan(0);
    expect(rows.lowValueRegionRejectedCount).toBeGreaterThan(0);
  });

  it('rejects search-shell-only visible text fallback content', () => {
    const rows = extractVisibleRegionRows({
      pageContent: '- generic "Sparse search shell"',
      sourceRegion: 'visible_results',
      url: 'https://example.test/search?q=browser%20automation',
      title: 'Search results for browser automation',
      visibleTextContent: [
        'Search results for browser automation',
        'browser automation',
        'Search',
        'All',
        'Filters',
        'Sort',
        'Topics',
        'Feedback',
        'How can we improve search results for this query?',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.visibleRegionRowsRejectedReason).toBe('low_value_region');
    expect(rows.lowValueRegionRejectedCount).toBeGreaterThan(0);
    expect(rows.rows).toEqual([]);
  });

  it('rejects search-shell prompt rows while preserving long result titles', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- link "客户端" [ref=ref_client] (x=120,y=80) href="/download/client"',
        '- link "为你找到以下结果，问问AI智能总结内容" [ref=ref_ai_summary] (x=320,y=140) href="/search/summary"',
        '- link "2026 年最好用的十大 AI 工具，免费且强大" [ref=ref_video_1] (x=320,y=260) href="/video/1"',
        '- link "职场人的自动办公 Agent 新版本教程" [ref=ref_video_2] (x=320,y=340) href="/video/2"',
        '- link "AI 人物视频更真实的三大提示词技巧" [ref=ref_video_3] (x=320,y=420) href="/video/3"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual([
      '2026 年最好用的十大 AI 工具，免费且强大',
      '职场人的自动办公 Agent 新版本教程',
      'AI 人物视频更真实的三大提示词技巧',
    ]);
    expect(rows.rows.map((row) => row.title).join(' ')).not.toMatch(
      /客户端|为你找到以下结果|问问AI智能总结内容/,
    );
  });

  it('rejects standalone short topic chips without dropping repo-like labels', () => {
    const rows = extractVisibleRegionRows({
      pageContent: [
        '- link "Automation" [ref=ref_topic_1] (x=260,y=180) href="/topics/automation"',
        '- link "automation" [ref=ref_topic_2] (x=260,y=220)',
        '- link "browser" [ref=ref_topic_3] (x=260,y=260) href="/topics/browser"',
        '- link "browse" [ref=ref_topic_4] (x=260,y=300)',
        '- link "example-org/browser-runtime" [ref=ref_repo_1] (x=320,y=380) href="/example-org/browser-runtime"',
        '- link "example-labs/agent-browser" [ref=ref_repo_2] (x=320,y=460) href="/example-labs/agent-browser"',
        '- link "Practical browser automation guide for teams" [ref=ref_result_3] (x=320,y=540) href="/items/3"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'example-org/browser-runtime',
      'example-labs/agent-browser',
      'Practical browser automation guide for teams',
    ]);
    expect(rows.rows.map((row) => row.title)).not.toEqual(
      expect.arrayContaining(['Automation', 'automation', 'browser', 'browse']),
    );
  });

  it('rejects query-only and search-title shell rows while preserving repo-like result labels', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'search_results',
      url: 'https://example.test/search?q=AI%20browser%20automation&type=repositories',
      title: 'repositories Search Results · AI browser automation',
      pageContent: [
        '- link "AI browser automation" [ref=ref_query] (x=260,y=120) href="/search?q=AI%20browser%20automation"',
        '- link "repositories Search Results · AI browser automation" [ref=ref_title] (x=260,y=160) href="/search?q=AI%20browser%20automation&type=repositories"',
        '- link "Automation" [ref=ref_topic_1] (x=260,y=200) href="/topics/automation"',
        '- link "automation" [ref=ref_topic_2] (x=260,y=240)',
        '- link "browser" [ref=ref_topic_3] (x=260,y=280) href="/topics/browser"',
        '- link "browse" [ref=ref_topic_4] (x=260,y=320)',
        '- link "example-org/browser-runtime" [ref=ref_repo_1] (x=320,y=380) href="/example-org/browser-runtime"',
        '- link "example-labs/agent-browser" [ref=ref_repo_2] (x=320,y=460) href="/example-labs/agent-browser"',
        '- link "Practical browser automation guide for teams" [ref=ref_result_3] (x=320,y=540) href="/items/3"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rows.map((row) => row.title)).toEqual([
      'example-org/browser-runtime',
      'example-labs/agent-browser',
      'Practical browser automation guide for teams',
    ]);
    expect(rows.rows.flatMap((row) => row.visibleTextFields)).not.toEqual(
      expect.arrayContaining([
        'AI browser automation',
        'repositories Search Results · AI browser automation',
        'Automation',
        'automation',
        'browser',
        'browse',
      ]),
    );
    expect(rows.rejectedRegionReasonDistribution.low_value_region).toBeGreaterThanOrEqual(2);
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

  it('does not report ready when read_page only sees footer navigation and search controls', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5306,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search',
      title: 'Search',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- navigation "Primary navigation" [ref=ref_nav] (x=0,y=0)',
        '  - link "Home" [ref=ref_home] (x=20,y=20) href="/"',
        '  - link "Help" [ref=ref_help] (x=90,y=20) href="/help"',
        '- search "Search examples" [ref=ref_search] (x=420,y=42)',
        '  - searchbox "Search examples" [ref=ref_query] (x=420,y=42)',
        '  - button "Search" [ref=ref_search_button] (x=760,y=42)',
        '  - button "All" [ref=ref_all] (x=280,y=110)',
        '  - button "Recent" [ref=ref_recent] (x=380,y=110)',
        '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
        '  - link "Privacy" [ref=ref_privacy] (x=620,y=680) href="/privacy"',
        '  - link "Terms" [ref=ref_terms] (x=720,y=680) href="/terms"',
      ].join('\n'),
      refMap: [
        { ref: 'ref_home', selector: 'a[href="/"]' },
        { ref: 'ref_help', selector: 'a[href="/help"]' },
        { ref: 'ref_search_button', selector: 'button[type="submit"]' },
      ],
      stats: { processed: 11, included: 11, durationMs: 6 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      readinessVerdict: 'blocked',
      readinessReason: 'footer_or_navigation_only',
      rowCount: 0,
      visibleRegionRowsUsed: false,
      visibleRegionRowsRejectedReason: 'footer_like_region',
    });
    expect(payload.footerLikeRejectedCount).toBeGreaterThan(0);
    expect(payload.navigationLikeRejectedCount).toBeGreaterThan(0);
    expect(payload.rejectedRegionReasonDistribution.footer_like_region).toBeGreaterThan(0);
    expect(payload.visibleRegionRows).toMatchObject({
      visibleRegionRowsUsed: false,
      rowCount: 0,
    });
  });

  it('reports business_rows_unavailable when only query and search-title shell rows are visible', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5310,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search?q=AI%20browser%20automation&type=repositories',
      title: 'repositories Search Results · AI browser automation',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Search results" [ref=ref_main] (x=640,y=360)',
        '  - link "AI browser automation" [ref=ref_query] (x=260,y=120) href="/search?q=AI%20browser%20automation"',
        '  - link "repositories Search Results · AI browser automation" [ref=ref_title] (x=260,y=160) href="/search?q=AI%20browser%20automation&type=repositories"',
        '  - link "Automation" [ref=ref_topic_1] (x=260,y=200) href="/topics/automation"',
        '  - link "automation" [ref=ref_topic_2] (x=260,y=240)',
        '  - link "browser" [ref=ref_topic_3] (x=260,y=280) href="/topics/browser"',
        '  - link "browse" [ref=ref_topic_4] (x=260,y=320)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_query', selector: 'a[href*="q=AI%20browser%20automation"]' },
        { ref: 'ref_title', selector: 'a[href*="type=repositories"]' },
        { ref: 'ref_topic_1', selector: 'a[href="/topics/automation"]' },
      ],
      stats: { processed: 7, included: 7, durationMs: 6 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      readinessVerdict: 'blocked',
      readinessReason: 'business_rows_unavailable',
      rowCount: 0,
      visibleRegionRowsUsed: false,
      visibleRegionRowsRejectedReason: 'low_value_region',
    });
    expect(payload.visibleDomRowsCandidateCount).toBe(0);
    expect(payload.visibleRegionRows.rows).toEqual([]);
    expect(payload.lowValueRegionRejectedCount).toBeGreaterThan(0);
    expect(payload.footerLikeRejectedCount).toBe(0);
    expect(payload.navigationLikeRejectedCount).toBe(0);
  });

  it('does not report ready when fallback utility links are the only row-like candidates', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5307,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search',
      title: 'Search',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'ensureInteractiveElementsHelper').mockResolvedValue(undefined);
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: '- generic "Search shell"',
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 6 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: '- generic "Search shell"',
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 6 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [
          { type: 'link', text: '发布视频/图文', selector: 'a.upload', href: '/creator/upload' },
          {
            type: 'link',
            text: '创作者学习中心',
            selector: 'a.learning',
            href: '/creator/learning',
          },
          { type: 'link', text: '广告投放', selector: 'a.ads', href: '/advertising' },
          { type: 'link', text: '账号找回', selector: 'a.recovery', href: '/account/recovery' },
          { type: 'link', text: '联系我们', selector: 'a.contact', href: '/contact-us' },
          { type: 'link', text: '友情链接', selector: 'a.friend', href: '/friend-links' },
          { type: 'link', text: 'Business license', selector: 'a.license', href: '/legal/license' },
          { type: 'link', text: 'Report center', selector: 'a.report', href: '/report' },
        ],
        scrollY: 0,
        pixelsBelow: 300,
      });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      readinessVerdict: 'blocked',
      readinessReason: 'footer_or_navigation_only',
      rowCount: 0,
      visibleRegionRowsUsed: false,
      visibleRegionRowsRejectedReason: 'footer_like_region',
    });
    expect(payload.visibleDomRowsCandidateCount).toBe(0);
    expect(payload.visibleRegionRows.rows).toEqual([]);
    expect(payload.lowValueRegionRejectedCount).toBeGreaterThan(0);
    expect(payload.footerLikeRejectedCount).toBeGreaterThan(0);
    expect(payload.rejectedRegionReasonDistribution.low_value_region).toBeGreaterThan(0);
  });

  it('recovers ready rows from visible text when sparse DOM and interactive fallback are shell-only', async () => {
    const originalScripting = chrome.scripting;
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5311,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search',
      title: 'Search',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'ensureInteractiveElementsHelper').mockResolvedValue(undefined);
    (chrome as any).scripting = {
      executeScript: vi.fn().mockResolvedValue([
        {
          result: [
            'Search',
            'All',
            'Practical automation planning guide for small teams using browser workflows',
            'This walkthrough explains how a team can collect requirements, compare tools, and finish routine web tasks with fewer manual checks.',
            'Workflow Lab',
            '2 hours ago',
            '89 likes',
            'Reliable operations checklist for browser based AI assistants',
            'A compact checklist covering page reading, result selection, logs, and handoff evidence for daily operations.',
            'Ops Review',
            'yesterday',
            '34 comments',
            'Privacy',
            'Terms',
          ].join('\n'),
        },
      ]),
    };
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          '- navigation "Primary navigation" [ref=ref_nav] (x=0,y=0)',
          '  - link "Home" [ref=ref_home] (x=20,y=20) href="/"',
          '- search "Search examples" [ref=ref_search] (x=420,y=42)',
          '  - searchbox "Search examples" [ref=ref_query] (x=420,y=42)',
          '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
          '  - link "Privacy" [ref=ref_privacy] (x=620,y=680) href="/privacy"',
        ].join('\n'),
        refMap: [{ ref: 'ref_home', selector: 'a[href="/"]' }],
        stats: { processed: 6, included: 6, durationMs: 6 },
        viewport: { width: 0, height: 0, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          '- navigation "Primary navigation" [ref=ref_nav] (x=0,y=0)',
          '  - link "Home" [ref=ref_home] (x=20,y=20) href="/"',
          '- search "Search examples" [ref=ref_search] (x=420,y=42)',
          '  - searchbox "Search examples" [ref=ref_query] (x=420,y=42)',
          '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
          '  - link "Privacy" [ref=ref_privacy] (x=620,y=680) href="/privacy"',
        ].join('\n'),
        refMap: [{ ref: 'ref_home', selector: 'a[href="/"]' }],
        stats: { processed: 6, included: 6, durationMs: 6 },
        viewport: { width: 0, height: 0, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [
          { type: 'link', text: 'Home', selector: 'a.home', href: '/' },
          { type: 'button', text: 'Search', selector: 'button.search' },
          { type: 'link', text: 'Privacy', selector: 'a.privacy', href: '/privacy' },
          { type: 'link', text: 'Terms', selector: 'a.terms', href: '/terms' },
        ],
        scrollY: 0,
        pixelsBelow: 0,
      });

    try {
      const result = await readPageTool.execute({ mode: 'compact' });
      const payload = JSON.parse((result.content[0] as { text: string }).text);

      expect(result.isError).toBe(false);
      expect(payload).toMatchObject({
        kind: 'dom_region_rows',
        selectedDataSource: 'dom_region_rows',
        readinessVerdict: 'ready',
        readinessReason: null,
        rowCount: 2,
        visibleRegionRowsUsed: true,
      });
      expect(payload.pageContext).toMatchObject({
        sparse: true,
        fallbackUsed: true,
        fallbackSource: 'get_interactive_elements',
      });
      expect(payload.visibleRegionRows.rows.map((row: { title: string }) => row.title)).toEqual([
        'Practical automation planning guide for small teams using browser workflows',
        'Reliable operations checklist for browser based AI assistants',
      ]);
      expect(payload.highValueObjects.slice(0, 2)).toEqual([
        expect.objectContaining({
          kind: 'visible_region_row',
          label: 'Practical automation planning guide for small teams using browser workflows',
          objectType: 'record',
          region: 'visible_text',
          sourceKind: 'dom_semantic',
        }),
        expect.objectContaining({
          kind: 'visible_region_row',
          label: 'Reliable operations checklist for browser based AI assistants',
          objectType: 'record',
          region: 'visible_text',
          sourceKind: 'dom_semantic',
        }),
      ]);
      for (const object of payload.highValueObjects.slice(0, 2)) {
        expect(object).not.toHaveProperty('ref');
        expect(object).not.toHaveProperty('targetRef');
        expect(object).not.toHaveProperty('actions');
      }
      expect(payload.L0.focusObjectIds.slice(0, 2)).toEqual(
        payload.highValueObjects.slice(0, 2).map((item: { id: string }) => item.id),
      );
      expect(payload.L0.summary).toContain(
        'Practical automation planning guide for small teams using browser workflows, Reliable operations checklist for browser based AI assistants',
      );
      expect(
        payload.visibleRegionRows.rows.every(
          (row: { targetRef: string | null }) => row.targetRef === null,
        ),
      ).toBe(true);
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 5311 },
          args: [12000],
        }),
      );
    } finally {
      (chrome as any).scripting = originalScripting;
    }
  });

  it('keeps business results while excluding legal/report rows from rows and top HVOs', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5308,
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
        '- generic "Search page" [ref=ref_root] (x=0,y=0)',
        '  - search "Search controls" [ref=ref_search] (x=420,y=42)',
        '    - searchbox "Search query" [ref=ref_query] (x=420,y=42)',
        '    - button "Search" [ref=ref_search_button] (x=760,y=42)',
        '  - link "Practical workflow guide for solo teams" [ref=ref_result_1] (x=320,y=260) href="/items/1"',
        '  - link "Automation checklist for daily operations" [ref=ref_result_2] (x=640,y=280) href="/items/2"',
        '  - link "Creator center" [ref=ref_creator] (x=200,y=540) href="/creator-center"',
        '  - link "Account recovery" [ref=ref_recovery] (x=200,y=580) href="/account/recovery"',
        '  - link "Contact us" [ref=ref_contact] (x=200,y=600) href="/contact-us"',
        '  - link "Site map" [ref=ref_sitemap] (x=200,y=610) href="/site-map"',
        '  - link "Download app" [ref=ref_download] (x=200,y=620) href="/download-app"',
        '  - link "Network rumor exposure desk" [ref=ref_report_1] (x=200,y=620) href="/report/rumors"',
        '  - link "网上有害信息举报专区" [ref=ref_report_2] (x=200,y=660) href="/report/harmful-info"',
        '  - link "Business license information" [ref=ref_license] (x=200,y=700) href="/legal/license.pdf"',
      ].join('\n'),
      refMap: [
        { ref: 'ref_result_1', selector: 'a[href="/items/1"]' },
        { ref: 'ref_result_2', selector: 'a[href="/items/2"]' },
        { ref: 'ref_creator', selector: 'a[href="/creator-center"]' },
        { ref: 'ref_recovery', selector: 'a[href="/account/recovery"]' },
        { ref: 'ref_contact', selector: 'a[href="/contact-us"]' },
        { ref: 'ref_sitemap', selector: 'a[href="/site-map"]' },
        { ref: 'ref_download', selector: 'a[href="/download-app"]' },
        { ref: 'ref_report_1', selector: 'a[href="/report/rumors"]' },
        { ref: 'ref_report_2', selector: 'a[href="/report/harmful-info"]' },
        { ref: 'ref_license', selector: 'a[href="/legal/license.pdf"]' },
      ],
      stats: { processed: 14, included: 14, durationMs: 6 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    const rowTitles = payload.visibleRegionRows.rows.map((row: { title: string }) => row.title);
    const hvoLabels = payload.highValueObjects.map((item: { label: string }) => item.label);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      kind: 'dom_region_rows',
      readinessVerdict: 'ready',
      rowCount: 2,
      visibleRegionRowsUsed: true,
    });
    expect(rowTitles).toEqual([
      'Practical workflow guide for solo teams',
      'Automation checklist for daily operations',
    ]);
    expect([...rowTitles, ...hvoLabels].join(' ')).not.toMatch(
      /rumor|harmful|举报|license|Search query|Creator center|Account recovery|Contact us|Site map|Download app/i,
    );
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
