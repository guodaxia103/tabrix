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

const GITHUB_REPO_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+(?:[/?#]|$)/i;
const GITHUB_PATH_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+(\/[^?#]*)?/i;

const GITHUB_SIGNALS = {
  repoHome: [/\bissues\b/i, /\bpull requests?\b/i, /\bactions\b/i, /\bgo to file\b/i],
  issuesList: [/\bsearch issues\b/i, /\bfilter\b/i, /\bnew issue\b/i, /\bassignee\b/i],
  actionsList: [/\bfilter workflow runs\b/i, /\brun\s+\d+\b/i, /\bworkflow\b/i],
  workflowRunDetail: [
    /\bsummary\b/i,
    /\bshow all jobs\b/i,
    /\bjobs?\b/i,
    /\bartifacts?\b/i,
    /\bannotations?\b/i,
    /\blogs?\b/i,
  ],
  workflowRunShell: [/\bactions\b/i, /\bworkflow run\b/i, /\brun\s+\d+\b/i, /\bloading\b/i],
};

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
    const hasRunDetailSignals = hasAnySignal(titleAndContent, GITHUB_SIGNALS.workflowRunDetail);
    return hasRunDetailSignals
      ? buildGithubSummary('workflow_run_detail', 'workflow_run_summary', 'high', context)
      : buildGithubSummary('workflow_run_shell', 'workflow_run_shell', 'medium', context);
  }

  if (/^\/actions(?:\/?$|[?#])/i.test(githubPath) || githubPath === '/actions') {
    const hasActionsSignals = hasAnySignal(titleAndContent, GITHUB_SIGNALS.actionsList);
    return buildGithubSummary(
      'actions_list',
      hasActionsSignals ? 'workflow_runs_list' : 'actions_shell',
      hasActionsSignals ? 'high' : 'medium',
      context,
    );
  }

  if (/^\/issues(?:\/?$|[?#])/i.test(githubPath) || githubPath === '/issues') {
    const hasIssueSignals = hasAnySignal(titleAndContent, GITHUB_SIGNALS.issuesList);
    return buildGithubSummary(
      'issues_list',
      hasIssueSignals ? 'issues_results' : 'issues_shell',
      hasIssueSignals ? 'high' : 'medium',
      context,
    );
  }

  if (/^$/i.test(githubPath) || githubPath === '/') {
    const hasRepoSignals = hasAnySignal(titleAndContent, GITHUB_SIGNALS.repoHome);
    return buildGithubSummary(
      'repo_home',
      hasRepoSignals ? 'repo_primary_nav' : 'repo_shell',
      hasRepoSignals ? 'medium' : 'low',
      context,
    );
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
    return {
      pageRole: 'login_required',
      primaryRegion: 'login_gate',
      primaryRegionConfidence: 'high',
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

  return {
    pageRole: footerOnly ? 'outer_shell' : 'unknown',
    primaryRegion: footerOnly ? 'footer_shell' : null,
    primaryRegionConfidence: footerOnly ? 'low' : null,
    footerOnly,
    anchorTexts,
  };
}
