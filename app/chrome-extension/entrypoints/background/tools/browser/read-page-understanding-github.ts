import type {
  PageFamilyAdapter,
  PageRole,
  PageUnderstandingContext,
  PageUnderstandingSummary,
  RegionRule,
} from './read-page-understanding-core';
import { resolvePrimaryRegion } from './read-page-understanding-core';

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

function buildGithubSummary(
  pageRole: PageRole,
  primaryRegion: string | null,
  context: PageUnderstandingContext,
  primaryRegionConfidence: PageUnderstandingSummary['primaryRegionConfidence'],
): PageUnderstandingSummary {
  return {
    pageRole,
    primaryRegion,
    primaryRegionConfidence,
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

export const githubPageFamilyAdapter: PageFamilyAdapter = {
  family: 'github',
  infer(context: PageUnderstandingContext): PageUnderstandingSummary | null {
    if (!GITHUB_REPO_URL_PATTERN.test(context.lowerUrl)) {
      return null;
    }

    const githubPathMatch = context.lowerUrl.match(GITHUB_PATH_PATTERN);
    const githubPath = String(githubPathMatch?.[1] || '');
    const titleAndContent = [context.lowerTitle, context.content];

    if (/^\/actions\/runs\/\d+/i.test(githubPath)) {
      // T5.4.5 fix: URL-derived `pageRole` and content-derived `primaryRegion`
      // are ORTHOGONAL. A page is always `workflow_run_detail` when the URL
      // points at `/actions/runs/<id>` — regardless of whether the content
      // has finished loading. `primaryRegion` independently reports whether
      // we see the fully-loaded `workflow_run_summary` body or only the
      // still-loading `workflow_run_shell` skeleton.
      //
      // Previously we mapped shell-content → pageRole=workflow_run_shell,
      // which confused downstream consumers (tests + LLM agents) that
      // expect `pageRole` to be a stable navigation identity, not a
      // content-readiness flag. See Group F T5-F-GH-WORKFLOW-RUN-ROLE.
      const region = resolvePrimaryRegion(
        titleAndContent,
        GITHUB_PRIMARY_REGION_RULES.workflow_run_detail,
        'workflow_run_shell',
        'medium',
      );
      return buildGithubSummary('workflow_run_detail', region.region, context, region.confidence);
    }

    if (/^\/actions(?:\/?$|[?#])/i.test(githubPath) || githubPath === '/actions') {
      const region = resolvePrimaryRegion(
        titleAndContent,
        GITHUB_PRIMARY_REGION_RULES.actions_list,
        'actions_shell',
        'medium',
      );
      return buildGithubSummary('actions_list', region.region, context, region.confidence);
    }

    if (/^\/issues(?:\/?$|[?#])/i.test(githubPath) || githubPath === '/issues') {
      const region = resolvePrimaryRegion(
        titleAndContent,
        GITHUB_PRIMARY_REGION_RULES.issues_list,
        'issues_shell',
        'medium',
      );
      return buildGithubSummary('issues_list', region.region, context, region.confidence);
    }

    if (/^$/i.test(githubPath) || githubPath === '/') {
      const region = resolvePrimaryRegion(
        titleAndContent,
        GITHUB_PRIMARY_REGION_RULES.repo_home,
        'repo_shell',
        'low',
      );
      return buildGithubSummary('repo_home', region.region, context, region.confidence);
    }

    return null;
  },
};
