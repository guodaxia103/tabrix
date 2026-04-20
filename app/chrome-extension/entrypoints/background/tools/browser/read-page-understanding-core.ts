import type { ReadPagePrimaryRegionConfidence } from '@tabrix/shared';

export type PageRole =
  | 'unknown'
  | 'repo_home'
  | 'issues_list'
  | 'actions_list'
  | 'workflow_run_detail'
  | 'workflow_run_shell'
  | 'hotspot_rank_list'
  | 'hotspot_topic_list'
  | 'hotspot_detail'
  | 'creator_home'
  | 'creator_overview'
  | 'login_required'
  | 'outer_shell';

export interface PageUnderstandingSummary {
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: ReadPagePrimaryRegionConfidence;
  footerOnly: boolean;
  anchorTexts: string[];
}

export interface PageUnderstandingContext {
  lowerUrl: string;
  lowerTitle: string;
  content: string;
  anchorTexts: string[];
  footerOnly: boolean;
}

export interface RegionRule {
  region: string;
  patterns: RegExp[];
  minMatches?: number;
  priority?: number;
  confidence: ReadPagePrimaryRegionConfidence;
}

export interface RegionResolution {
  region: string | null;
  confidence: ReadPagePrimaryRegionConfidence;
  matchedPatterns: number;
}

export interface PageFamilyAdapter {
  family: string;
  infer: (context: PageUnderstandingContext) => PageUnderstandingSummary | null;
}

export function collectAnchorTexts(pageContent: string) {
  const anchors = [
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
  ];

  return anchors.filter((anchor) => pageContent.includes(anchor));
}

export function buildUnderstandingContext(
  url: string,
  title: string,
  pageContent: string,
): PageUnderstandingContext {
  const lowerUrl = String(url || '').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();
  const content = String(pageContent || '');
  const anchorTexts = collectAnchorTexts(content);
  const footerOnly =
    anchorTexts.length <= 2 &&
    /账号授权协议|用户服务协议|隐私政策|联系我们/.test(content) &&
    !/热度值|播放量|查看|发布视频|话题名称/.test(content);

  return {
    lowerUrl,
    lowerTitle,
    content,
    anchorTexts,
    footerOnly,
  };
}

export function hasAnySignal(sources: string[], patterns: RegExp[]) {
  return patterns.some((pattern) => sources.some((source) => pattern.test(source)));
}

function countMatchedPatterns(sources: string[], patterns: RegExp[]) {
  return patterns.filter((pattern) => sources.some((source) => pattern.test(source))).length;
}

export function resolvePrimaryRegion(
  sources: string[],
  rules: RegionRule[],
  fallbackRegion: string | null,
  fallbackConfidence: ReadPagePrimaryRegionConfidence,
): RegionResolution {
  let bestMatch: RegionResolution | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const rule of rules) {
    const matchedPatterns = countMatchedPatterns(sources, rule.patterns);
    const minMatches = Math.max(1, Number(rule.minMatches || 1));
    if (matchedPatterns < minMatches) {
      continue;
    }
    const score = matchedPatterns * 100 + Number(rule.priority || 0);

    if (!bestMatch || score > bestScore) {
      bestMatch = {
        region: rule.region,
        confidence: rule.confidence,
        matchedPatterns,
      };
      bestScore = score;
    }
  }

  return (
    bestMatch || {
      region: fallbackRegion,
      confidence: fallbackConfidence,
      matchedPatterns: 0,
    }
  );
}
