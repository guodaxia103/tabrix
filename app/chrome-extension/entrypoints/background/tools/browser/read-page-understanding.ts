import type {
  PageFamilyAdapter,
  PageRole,
  PageUnderstandingSummary,
  RegionRule,
} from './read-page-understanding-core';
import {
  buildUnderstandingContext,
  hasAnySignal,
  resolvePrimaryRegion,
} from './read-page-understanding-core';
import { githubPageFamilyAdapter } from './read-page-understanding-github';

export type { PageRole, PageUnderstandingSummary } from './read-page-understanding-core';

const PAGE_FAMILY_ADAPTERS: PageFamilyAdapter[] = [githubPageFamilyAdapter];

const LOGIN_GATE_RULES: RegionRule[] = [
  {
    region: 'login_gate',
    patterns: [/登录/i, /login/i, /signin/i, /手机号/i, /验证码/i, /phone/i, /code/i],
    minMatches: 2,
    priority: 1000,
    confidence: 'high',
  },
];

const FOOTER_SHELL_RULES: RegionRule[] = [
  {
    region: 'footer_shell',
    patterns: [/账号授权协议/i, /用户服务协议/i, /隐私政策/i, /联系我们/i],
    minMatches: 2,
    priority: 1000,
    confidence: 'low',
  },
];

function inferFromPageFamilyAdapters(context: ReturnType<typeof buildUnderstandingContext>) {
  for (const adapter of PAGE_FAMILY_ADAPTERS) {
    const summary = adapter.infer(context);
    if (summary) {
      return summary;
    }
  }

  return null;
}

export function inferPageUnderstanding(
  url: string,
  title: string,
  pageContent: string,
): PageUnderstandingSummary {
  const context = buildUnderstandingContext(url, title, pageContent);
  const adaptedSummary = inferFromPageFamilyAdapters(context);
  if (adaptedSummary) {
    return adaptedSummary;
  }

  const loginSignals = [context.lowerUrl, context.lowerTitle, context.content];
  if (
    hasAnySignal(loginSignals, [/登录/i, /login/i, /signin/i]) &&
    hasAnySignal(loginSignals, [/手机号/i, /验证码/i, /phone/i, /code/i, /抖音/i])
  ) {
    const loginRegion = resolvePrimaryRegion(loginSignals, LOGIN_GATE_RULES, 'login_gate', 'high');
    return {
      pageRole: 'login_required',
      primaryRegion: loginRegion.region,
      primaryRegionConfidence: loginRegion.confidence,
      footerOnly: context.footerOnly,
      anchorTexts: context.anchorTexts,
    };
  }

  if (context.lowerUrl.includes('active_tab=hotspot_topic')) {
    const isTopicTable =
      /话题名称|热度趋势|热度值|视频量|播放量|稿均播放量/.test(context.content) ||
      /发布视频查看/.test(context.content);

    return {
      pageRole: isTopicTable
        ? 'hotspot_topic_list'
        : context.footerOnly
          ? 'outer_shell'
          : 'hotspot_topic_list',
      primaryRegion: isTopicTable
        ? 'topic_table'
        : context.footerOnly
          ? 'footer_shell'
          : 'topic_shell',
      primaryRegionConfidence: isTopicTable ? 'high' : context.footerOnly ? 'low' : 'medium',
      footerOnly: context.footerOnly,
      anchorTexts: context.anchorTexts,
    };
  }

  if (
    context.lowerUrl.includes('active_tab=hotspot_all') ||
    /视频总榜|低粉爆款视频榜|高完播率视频榜|高涨粉率视频榜/.test(context.content)
  ) {
    return {
      pageRole: context.footerOnly ? 'outer_shell' : 'hotspot_rank_list',
      primaryRegion: /视频总榜|低粉爆款视频榜|高完播率视频榜|高涨粉率视频榜/.test(context.content)
        ? 'rank_panels'
        : 'rank_shell',
      primaryRegionConfidence: context.footerOnly
        ? 'low'
        : /视频总榜/.test(context.content)
          ? 'high'
          : 'medium',
      footerOnly: context.footerOnly,
      anchorTexts: context.anchorTexts,
    };
  }

  if (/趋势|关联内容|用户关注/.test(context.content)) {
    return {
      pageRole: 'hotspot_detail',
      primaryRegion: 'detail_evidence',
      primaryRegionConfidence: 'medium',
      footerOnly: context.footerOnly,
      anchorTexts: context.anchorTexts,
    };
  }

  if (context.lowerUrl.includes('/creator') || context.lowerUrl.includes('creator')) {
    if (/账号总览|播放量|互动指数|视频完播率/.test(context.content)) {
      return {
        pageRole: 'creator_overview',
        primaryRegion: 'creator_metrics',
        primaryRegionConfidence: 'medium',
        footerOnly: context.footerOnly,
        anchorTexts: context.anchorTexts,
      };
    }

    return {
      pageRole: 'creator_home',
      primaryRegion: context.footerOnly ? 'footer_shell' : 'creator_shell',
      primaryRegionConfidence: context.footerOnly ? 'low' : 'medium',
      footerOnly: context.footerOnly,
      anchorTexts: context.anchorTexts,
    };
  }

  const footerRegion = resolvePrimaryRegion([context.content], FOOTER_SHELL_RULES, null, null);
  return {
    pageRole: context.footerOnly ? 'outer_shell' : 'unknown',
    primaryRegion: context.footerOnly ? footerRegion.region || 'footer_shell' : null,
    primaryRegionConfidence: context.footerOnly ? footerRegion.confidence || 'low' : null,
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}
