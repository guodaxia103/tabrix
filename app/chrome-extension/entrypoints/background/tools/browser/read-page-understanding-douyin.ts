import type {
  PageFamilyAdapter,
  PageUnderstandingContext,
  PageUnderstandingSummary,
  UnderstandingContextOptions,
} from './read-page-understanding-core';
import { buildUnderstandingContext } from './read-page-understanding-core';

const DOUYIN_HOST_PATTERN = /(^|\.)douyin\.com$/i;

export const DOUYIN_ANCHORS: readonly string[] = Object.freeze([
  '视频总榜',
  '话题榜',
  '话题总榜',
  '热度飙升的话题榜',
  '话题名称',
  '热度趋势',
  '热度值',
  '视频量',
  '播放量',
  '稿均播放量',
  '查看',
  '发布视频',
  '趋势',
  '关联内容',
  '用户关注',
  '评论',
  '账号总览',
  '近30天未发布新作品',
  '手机号',
  '验证码',
]);

const DOUYIN_RICH_CONTENT_PATTERN = /热度值|播放量|查看|发布视频|话题名称/;
const DOUYIN_LEGAL_FOOTER_PATTERN = /账号授权协议|用户服务协议|隐私政策|联系我们/;
const DOUYIN_RANK_PANEL_PATTERN = /视频总榜|低粉爆款视频榜|高完播率视频榜|高涨粉率视频榜/;
const DOUYIN_TOPIC_TABLE_PATTERN = /话题名称|热度趋势|热度值|视频量|播放量|稿均播放量/;
const DOUYIN_TOPIC_TABLE_SECONDARY_PATTERN = /发布视频查看/;
const DOUYIN_CREATOR_METRICS_PATTERN = /账号总览|播放量|互动指数|视频完播率/;
const DOUYIN_HOTSPOT_DETAIL_PATTERN = /趋势|关联内容|用户关注/;

const DOUYIN_CONTEXT_OPTIONS: UnderstandingContextOptions = {
  anchors: DOUYIN_ANCHORS,
  footerDetector: (content: string, anchorTexts: string[]): boolean => {
    return (
      anchorTexts.length <= 2 &&
      DOUYIN_LEGAL_FOOTER_PATTERN.test(content) &&
      !DOUYIN_RICH_CONTENT_PATTERN.test(content)
    );
  },
};

function buildDouyinContext(url: string, title: string, content: string): PageUnderstandingContext {
  return buildUnderstandingContext(url, title, content, DOUYIN_CONTEXT_OPTIONS);
}

function hostFromUrl(lowerUrl: string): string | null {
  const match = lowerUrl.match(/^https?:\/\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function isDouyinUrl(lowerUrl: string): boolean {
  const host = hostFromUrl(lowerUrl);
  if (!host) {
    return false;
  }
  return DOUYIN_HOST_PATTERN.test(host);
}

function inferHotspotTopic(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  if (!context.lowerUrl.includes('active_tab=hotspot_topic')) {
    return null;
  }
  const isTopicTable =
    DOUYIN_TOPIC_TABLE_PATTERN.test(context.content) ||
    DOUYIN_TOPIC_TABLE_SECONDARY_PATTERN.test(context.content);

  if (isTopicTable) {
    return {
      pageRole: 'hotspot_topic_list',
      primaryRegion: 'topic_table',
      primaryRegionConfidence: 'high',
      footerOnly: context.footerOnly,
      anchorTexts: context.anchorTexts,
    };
  }

  if (context.footerOnly) {
    return {
      pageRole: 'outer_shell',
      primaryRegion: 'footer_shell',
      primaryRegionConfidence: 'low',
      footerOnly: context.footerOnly,
      anchorTexts: context.anchorTexts,
    };
  }

  return {
    pageRole: 'hotspot_topic_list',
    primaryRegion: 'topic_shell',
    primaryRegionConfidence: 'medium',
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function inferHotspotRank(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  const urlMatches = context.lowerUrl.includes('active_tab=hotspot_all');
  const contentMatches = DOUYIN_RANK_PANEL_PATTERN.test(context.content);
  if (!urlMatches && !contentMatches) {
    return null;
  }

  if (context.footerOnly) {
    return {
      pageRole: 'outer_shell',
      primaryRegion: 'footer_shell',
      primaryRegionConfidence: 'low',
      footerOnly: context.footerOnly,
      anchorTexts: context.anchorTexts,
    };
  }

  return {
    pageRole: 'hotspot_rank_list',
    primaryRegion: contentMatches ? 'rank_panels' : 'rank_shell',
    primaryRegionConfidence: /视频总榜/.test(context.content) ? 'high' : 'medium',
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function inferHotspotDetail(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  if (!DOUYIN_HOTSPOT_DETAIL_PATTERN.test(context.content)) {
    return null;
  }
  return {
    pageRole: 'hotspot_detail',
    primaryRegion: 'detail_evidence',
    primaryRegionConfidence: 'medium',
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function inferCreatorPage(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  if (!context.lowerUrl.includes('/creator') && !context.lowerUrl.includes('creator')) {
    return null;
  }

  if (DOUYIN_CREATOR_METRICS_PATTERN.test(context.content)) {
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

export const douyinPageFamilyAdapter: PageFamilyAdapter = {
  family: 'douyin',
  infer(neutralContext: PageUnderstandingContext): PageUnderstandingSummary | null {
    if (!isDouyinUrl(neutralContext.lowerUrl)) {
      return null;
    }

    const context = buildDouyinContext(
      neutralContext.lowerUrl,
      neutralContext.lowerTitle,
      neutralContext.content,
    );

    return (
      inferHotspotTopic(context) ||
      inferHotspotRank(context) ||
      inferCreatorPage(context) ||
      inferHotspotDetail(context)
    );
  },
};
