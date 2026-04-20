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

interface PageUnderstandingContext {
  lowerUrl: string;
  lowerTitle: string;
  content: string;
  anchorTexts: string[];
  footerOnly: boolean;
}

interface RegionRule {
  region: string;
  patterns: RegExp[];
  minMatches?: number;
  priority?: number;
  confidence: ReadPagePrimaryRegionConfidence;
}

interface RegionResolution {
  region: string | null;
  confidence: ReadPagePrimaryRegionConfidence;
  matchedPatterns: number;
}

const GITHUB_REPO_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+(?:[/?#]|$)/i;
const GITHUB_PATH_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+(\/[^?#]*)?/i;

const GITHUB_PRIMARY_REGION_RULES: Record<
  'repo_home' | 'issues_list' | 'actions_list' | 'workflow_run_detail',
  RegionRule[]
> = {
  repo_home: [
    {
      region: 'repo_primary_nav',
      patterns: [/\bissues\b/i, /\bpull requests?\b/i, /\bactions\b/i, /\bgo to file\b/i],
      minMatches: 1,
      priority: 1000,
      confidence: 'medium',
    },
    {
      region: 'repo_shell',
      patterns: [/\bcode\b/i, /\breadme\b/i, /\bcommit\b/i, /\bmain branch\b/i],
      minMatches: 1,
      priority: 0,
      confidence: 'low',
    },
  ],
  issues_list: [
    {
      region: 'issues_results',
      patterns: [
        /\bsearch issues\b/i,
        /\bfilter(?: by)?\b/i,
        /\bnew issue\b/i,
        /\bassignee\b/i,
        /\blabels?\b/i,
        /\bmilestone\b/i,
        /\bissue entries\b/i,
      ],
      minMatches: 1,
      priority: 1000,
      confidence: 'high',
    },
    {
      region: 'issues_shell',
      patterns: [/\bissues\b/i, /\bloading\b/i, /\brepository\b/i],
      minMatches: 1,
      priority: 0,
      confidence: 'medium',
    },
  ],
  actions_list: [
    {
      region: 'workflow_runs_list',
      patterns: [
        /\bfilter workflow runs\b/i,
        /\brun\s+\d+\b/i,
        /\bcompleted successfully\b/i,
        /\bworkflow run entries\b/i,
        /\brun detail entry\b/i,
        /\bqueued\b/i,
        /\bfailed\b/i,
      ],
      minMatches: 1,
      priority: 1000,
      confidence: 'high',
    },
    {
      region: 'actions_shell',
      patterns: [/\bactions\b/i, /\bworkflows?\b/i, /\bloading\b/i],
      minMatches: 1,
      priority: 0,
      confidence: 'medium',
    },
  ],
  workflow_run_detail: [
    {
      region: 'workflow_run_summary',
      patterns: [
        /\bsummary\b/i,
        /\bshow all jobs\b/i,
        /\bjobs?\b/i,
        /\bartifacts?\b/i,
        /\bannotations?\b/i,
        /\blogs?\b/i,
      ],
      minMatches: 1,
      priority: 1000,
      confidence: 'high',
    },
    {
      region: 'workflow_run_shell',
      patterns: [/\bworkflow run\b/i, /\bloading\b/i, /\bchecks\b/i, /\bqueued\b/i, /\bstarted\b/i],
      minMatches: 1,
      priority: 0,
      confidence: 'medium',
    },
  ],
};

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

function collectAnchorTexts(pageContent: string) {
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

function hasAnySignal(sources: string[], patterns: RegExp[]) {
  return patterns.some((pattern) => sources.some((source) => pattern.test(source)));
}

function countMatchedPatterns(sources: string[], patterns: RegExp[]) {
  return patterns.filter((pattern) => sources.some((source) => pattern.test(source))).length;
}

function resolvePrimaryRegion(
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

function buildGithubSummary(
  pageRole: PageRole,
  primaryRegion: string | null,
  primaryRegionConfidence: ReadPagePrimaryRegionConfidence,
  context: PageUnderstandingContext,
): PageUnderstandingSummary {
  return {
    pageRole,
    primaryRegion,
    primaryRegionConfidence,
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function inferGithubPageUnderstanding(
  context: PageUnderstandingContext,
): PageUnderstandingSummary | null {
  if (!GITHUB_REPO_URL_PATTERN.test(context.lowerUrl)) {
    return null;
  }

  const githubPathMatch = context.lowerUrl.match(GITHUB_PATH_PATTERN);
  const githubPath = String(githubPathMatch?.[1] || '');
  const titleAndContent = [context.lowerTitle, context.content];

  if (/^\/actions\/runs\/\d+/i.test(githubPath)) {
    const region = resolvePrimaryRegion(
      titleAndContent,
      GITHUB_PRIMARY_REGION_RULES.workflow_run_detail,
      'workflow_run_shell',
      'medium',
    );
    return region.region === 'workflow_run_summary'
      ? buildGithubSummary('workflow_run_detail', region.region, region.confidence, context)
      : buildGithubSummary('workflow_run_shell', region.region, region.confidence, context);
  }

  if (/^\/actions(?:\/?$|[?#])/i.test(githubPath) || githubPath === '/actions') {
    const region = resolvePrimaryRegion(
      titleAndContent,
      GITHUB_PRIMARY_REGION_RULES.actions_list,
      'actions_shell',
      'medium',
    );
    return buildGithubSummary('actions_list', region.region, region.confidence, context);
  }

  if (/^\/issues(?:\/?$|[?#])/i.test(githubPath) || githubPath === '/issues') {
    const region = resolvePrimaryRegion(
      titleAndContent,
      GITHUB_PRIMARY_REGION_RULES.issues_list,
      'issues_shell',
      'medium',
    );
    return buildGithubSummary('issues_list', region.region, region.confidence, context);
  }

  if (/^$/i.test(githubPath) || githubPath === '/') {
    const region = resolvePrimaryRegion(
      titleAndContent,
      GITHUB_PRIMARY_REGION_RULES.repo_home,
      'repo_shell',
      'low',
    );
    return buildGithubSummary('repo_home', region.region, region.confidence, context);
  }

  return null;
}

export function inferPageUnderstanding(
  url: string,
  title: string,
  pageContent: string,
): PageUnderstandingSummary {
  const lowerUrl = String(url || '').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();
  const content = String(pageContent || '');
  const anchorTexts = collectAnchorTexts(content);
  const footerOnly =
    anchorTexts.length <= 2 &&
    /账号授权协议|用户服务协议|隐私政策|联系我们/.test(content) &&
    !/热度值|播放量|查看|发布视频|话题名称/.test(content);
  const context: PageUnderstandingContext = {
    lowerUrl,
    lowerTitle,
    content,
    anchorTexts,
    footerOnly,
  };

  const githubSummary = inferGithubPageUnderstanding(context);
  if (githubSummary) {
    return githubSummary;
  }

  const loginSignals = [lowerUrl, lowerTitle, content];
  if (
    hasAnySignal(loginSignals, [/登录/i, /login/i, /signin/i]) &&
    hasAnySignal(loginSignals, [/手机号/i, /验证码/i, /phone/i, /code/i, /抖音/i])
  ) {
    const loginRegion = resolvePrimaryRegion(loginSignals, LOGIN_GATE_RULES, 'login_gate', 'high');
    return {
      pageRole: 'login_required',
      primaryRegion: loginRegion.region,
      primaryRegionConfidence: loginRegion.confidence,
      footerOnly,
      anchorTexts,
    };
  }

  if (lowerUrl.includes('active_tab=hotspot_topic')) {
    const isTopicTable =
      /话题名称|热度趋势|热度值|视频量|播放量|稿均播放量/.test(content) ||
      /发布视频查看/.test(content);

    return {
      pageRole: isTopicTable
        ? 'hotspot_topic_list'
        : footerOnly
          ? 'outer_shell'
          : 'hotspot_topic_list',
      primaryRegion: isTopicTable ? 'topic_table' : footerOnly ? 'footer_shell' : 'topic_shell',
      primaryRegionConfidence: isTopicTable ? 'high' : footerOnly ? 'low' : 'medium',
      footerOnly,
      anchorTexts,
    };
  }

  if (
    lowerUrl.includes('active_tab=hotspot_all') ||
    /视频总榜|低粉爆款视频榜|高完播率视频榜|高涨粉率视频榜/.test(content)
  ) {
    return {
      pageRole: footerOnly ? 'outer_shell' : 'hotspot_rank_list',
      primaryRegion: /视频总榜|低粉爆款视频榜|高完播率视频榜|高涨粉率视频榜/.test(content)
        ? 'rank_panels'
        : 'rank_shell',
      primaryRegionConfidence: footerOnly ? 'low' : /视频总榜/.test(content) ? 'high' : 'medium',
      footerOnly,
      anchorTexts,
    };
  }

  if (/趋势|关联内容|用户关注/.test(content)) {
    return {
      pageRole: 'hotspot_detail',
      primaryRegion: 'detail_evidence',
      primaryRegionConfidence: 'medium',
      footerOnly,
      anchorTexts,
    };
  }

  if (lowerUrl.includes('/creator') || lowerUrl.includes('creator')) {
    if (/账号总览|播放量|互动指数|视频完播率/.test(content)) {
      return {
        pageRole: 'creator_overview',
        primaryRegion: 'creator_metrics',
        primaryRegionConfidence: 'medium',
        footerOnly,
        anchorTexts,
      };
    }

    return {
      pageRole: 'creator_home',
      primaryRegion: footerOnly ? 'footer_shell' : 'creator_shell',
      primaryRegionConfidence: footerOnly ? 'low' : 'medium',
      footerOnly,
      anchorTexts,
    };
  }

  const footerRegion = resolvePrimaryRegion([content], FOOTER_SHELL_RULES, null, null);
  return {
    pageRole: footerOnly ? 'outer_shell' : 'unknown',
    primaryRegion: footerOnly ? footerRegion.region || 'footer_shell' : null,
    primaryRegionConfidence: footerOnly ? footerRegion.confidence || 'low' : null,
    footerOnly,
    anchorTexts,
  };
}
