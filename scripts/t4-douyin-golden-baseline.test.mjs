import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDyScenarioDefinitions,
  evaluateDyScenario,
  parseCliArgs,
} from './t4-douyin-golden-baseline.mjs';

function buildModeResults(overrides = {}) {
  const compact = {
    mode: 'compact',
    snapshot: {
      mode: 'compact',
      page: { url: 'https://example.com', title: 'Example', pageType: 'web_page' },
      summary: { pageRole: 'unknown', primaryRegion: 'main', quality: 'usable' },
      interactiveElements: [
        { name: '发布视频' },
        { name: '查看' },
        { name: '热度值' },
      ],
      artifactRefs: [],
      candidateActions: [],
    },
    ...overrides.compact,
  };
  const normal = {
    mode: 'normal',
    snapshot: {
      mode: 'normal',
      page: { url: 'https://creator.douyin.com/creator-micro/data/hotspot?active_tab=hotspot_topic', title: 'Example', pageType: 'web_page' },
      summary: { pageRole: 'hotspot_topic_list', primaryRegion: 'topic_table', quality: 'usable' },
      interactiveElements: [{ name: '话题名称' }],
      artifactRefs: [],
      candidateActions: [],
    },
    ...overrides.normal,
  };
  const full = {
    mode: 'full',
    snapshot: {
      mode: 'full',
      page: { url: 'https://creator.douyin.com/creator-micro/data/hotspot?active_tab=hotspot_topic', title: 'Example', pageType: 'web_page' },
      summary: { pageRole: 'hotspot_topic_list', primaryRegion: 'topic_table', quality: 'usable' },
      interactiveElements: [{ name: '热度趋势' }],
      artifactRefs: [],
      candidateActions: [],
      fullSnapshot: {
        pageContent: '话题名称 热度趋势 热度值 视频量 播放量 稿均播放量',
      },
    },
    ...overrides.full,
  };
  return [compact, normal, full];
}

test('parseCliArgs keeps defaults and supports non-strict mode', () => {
  const parsed = parseCliArgs(['--non-strict']);
  assert.equal(parsed.strict, false);
  assert.ok(parsed.hotspotUrl.includes('hotspot'));
  assert.ok(parsed.creatorUrl.includes('creator'));
  assert.ok(Array.isArray(parsed.hotspotUrlCandidates));
  assert.ok(parsed.hotspotUrlCandidates.length >= 1);
});

test('buildDyScenarioDefinitions returns two fixed L4 scenarios', () => {
  const scenarios = buildDyScenarioDefinitions({
    hotspotUrl: 'https://creator.douyin.com/hotspot',
    hotspotUrlCandidates: [
      'https://creator.douyin.com/hotspot',
      'https://creator.douyin.com/hotspot?active_tab=hotspot_all',
    ],
    creatorUrl: 'https://creator.douyin.com/creator',
  });
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[0].scenarioId, 'DY-L4-001');
  assert.ok(Array.isArray(scenarios[0].entryCandidates));
  assert.equal(scenarios[0].entryCandidates.length, 2);
  assert.equal(scenarios[1].scenarioId, 'DY-L4-002');
});

test('evaluateDyScenario passes hotspot scenario with valid labels and read-only tools', () => {
  const result = evaluateDyScenario(
    { scenarioId: 'DY-L4-001' },
    buildModeResults(),
    ['chrome_navigate', 'chrome_read_page'],
  );
  assert.equal(result.passed, true);
  assert.equal(result.loginRequired, false);
  assert.ok(Array.isArray(result.businessSignals.hotspotMetricLabels));
  assert.ok(result.businessSignals.hotspotMetricLabels.length >= 2);
});

test('evaluateDyScenario fails when login is required', () => {
  const modeResults = buildModeResults({
    normal: {
      snapshot: {
        mode: 'normal',
        page: { url: 'https://example.com/login', title: '登录', pageType: 'web_page' },
        summary: { pageRole: 'login_required', primaryRegion: 'login_gate', quality: 'usable' },
        interactiveElements: [{ name: '登录' }],
        artifactRefs: [],
        candidateActions: [],
      },
    },
  });
  const result = evaluateDyScenario(
    { scenarioId: 'DY-L4-001' },
    modeResults,
    ['chrome_navigate', 'chrome_read_page'],
  );
  assert.equal(result.passed, false);
  assert.equal(result.loginRequired, true);
  assert.equal(result.failureCategory, 'account_login_required');
});

test('evaluateDyScenario classifies hotspot permission-denied entry diagnosis', () => {
  const modeResults = buildModeResults({
    normal: {
      snapshot: {
        mode: 'normal',
        page: {
          url: 'https://creator.douyin.com/creator-micro/data/following/following',
          title: '抖音创作者中心',
          pageType: 'web_page',
        },
        summary: { pageRole: 'creator_home', primaryRegion: 'creator_shell', quality: 'usable' },
        interactiveElements: [{ name: '取消关注' }, { name: '取消关注' }, { name: '取消关注' }],
        artifactRefs: [],
        candidateActions: [],
      },
    },
    full: {
      snapshot: {
        mode: 'full',
        page: {
          url: 'https://creator.douyin.com/creator-micro/data/following/following',
          title: '抖音创作者中心',
          pageType: 'web_page',
        },
        summary: { pageRole: 'creator_home', primaryRegion: 'creator_shell', quality: 'usable' },
        interactiveElements: [{ name: '取消关注' }],
        artifactRefs: [],
        candidateActions: [],
        fullSnapshot: {
          pageContent: '取消关注 取消关注 取消关注',
        },
      },
    },
  });
  const result = evaluateDyScenario(
    { scenarioId: 'DY-L4-001' },
    modeResults,
    ['chrome_navigate', 'chrome_read_page'],
    {
      hotspotEntryDiagnosis: {
        category: 'account_no_hotspot_permission',
        selectedEntry: 'https://creator.douyin.com/creator-micro/data/hotspot?active_tab=hotspot_topic',
        attempts: [],
      },
    },
  );
  assert.equal(result.passed, false);
  assert.equal(result.failureCategory, 'account_no_hotspot_permission');
});

test('evaluateDyScenario fails when high-risk actions are used', () => {
  const result = evaluateDyScenario(
    { scenarioId: 'DY-L4-002' },
    buildModeResults({
      normal: {
        snapshot: {
          mode: 'normal',
          page: { url: 'https://creator.douyin.com/creator', title: '创作者中心', pageType: 'web_page' },
          summary: { pageRole: 'creator_overview', primaryRegion: 'creator_metrics', quality: 'usable' },
          interactiveElements: [{ name: '账号总览' }],
          artifactRefs: [],
          candidateActions: [],
        },
      },
      full: {
        snapshot: {
          mode: 'full',
          page: { url: 'https://creator.douyin.com/creator', title: '创作者中心', pageType: 'web_page' },
          summary: { pageRole: 'creator_overview', primaryRegion: 'creator_metrics', quality: 'usable' },
          interactiveElements: [{ name: '播放量' }],
          artifactRefs: [],
          candidateActions: [],
          fullSnapshot: {
            pageContent: '账号总览 播放量 互动指数 视频完播率',
          },
        },
      },
    }),
    ['chrome_navigate', 'chrome_read_page', 'chrome_computer'],
  );
  assert.equal(result.readOnlyBoundaryPassed, false);
  assert.equal(result.passed, false);
  assert.equal(result.failureCategory, 'read_only_boundary_violation');
});
