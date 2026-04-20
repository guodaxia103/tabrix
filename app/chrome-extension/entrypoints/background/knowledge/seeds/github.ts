import type { KnowledgeSeeds } from '../types';

/**
 * Stage 1 GitHub Knowledge seeds — faithful data-ification of the rules
 * currently encoded in `read-page-understanding-github.ts`.
 *
 * Migration mapping (see `docs/KNOWLEDGE_STAGE_1.md §5`):
 *
 * - `SITE_PROFILE.match.urlPatterns[0]` ← `GITHUB_REPO_URL_PATTERN`
 *   (`read-page-understanding-github.ts:10`)
 * - Page role rules are declared in the same order as
 *   `githubPageFamilyAdapter.infer` executes (lines 132 / 144 / 154 / 164),
 *   so `lookup/resolve-page-role.ts` can short-circuit on first URL match
 *   and reproduce legacy routing exactly.
 * - `primaryRegions` mirror `GITHUB_PRIMARY_REGION_RULES[role]` entries
 *   from the same file (lines 13-104). `minMatches` / `priority` /
 *   `confidence` are preserved verbatim.
 * - `workflow_run_detail` uses `dualOutcome` to express the
 *   "region-promotes-role" branch at `read-page-understanding-github.ts:132-142`.
 *
 * Regex sources are copied as plain strings so the registry loader can
 * compile them with a consistent `'i'` flag; the full `lowerUrl` is used
 * as the match subject (the legacy adapter pre-extracts the path, but
 * `lookup/resolve-page-role.ts` matches the full URL directly — see
 * Stage 1 design doc §4.3).
 */
export const GITHUB_KNOWLEDGE_SEEDS: KnowledgeSeeds = {
  siteProfiles: [
    {
      siteId: 'github',
      match: {
        hosts: ['github.com'],
        urlPatterns: [String.raw`^https://github\.com/[^/]+/[^/]+(?:[/?#]|$)`],
      },
    },
  ],
  pageRoleRules: [
    {
      siteId: 'github',
      pageRole: 'workflow_run_detail',
      match: {
        urlPatterns: [String.raw`^https://github\.com/[^/]+/[^/]+/actions/runs/\d+`],
      },
      primaryRegions: [
        {
          region: 'workflow_run_summary',
          patterns: [
            String.raw`\bsummary\b`,
            String.raw`\bshow all jobs\b`,
            String.raw`\bjobs?\b`,
            String.raw`\bartifacts?\b`,
            String.raw`\bannotations?\b`,
            String.raw`\blogs?\b`,
          ],
          minMatches: 1,
          priority: 1000,
          confidence: 'high',
        },
        {
          region: 'workflow_run_shell',
          patterns: [
            String.raw`\bworkflow run\b`,
            String.raw`\bloading\b`,
            String.raw`\bchecks\b`,
            String.raw`\bqueued\b`,
            String.raw`\bstarted\b`,
          ],
          minMatches: 1,
          priority: 0,
          confidence: 'medium',
        },
      ],
      fallback: {
        primaryRegion: 'workflow_run_shell',
        primaryRegionConfidence: 'medium',
      },
      dualOutcome: {
        primaryRegionToRole: {
          workflow_run_summary: 'workflow_run_detail',
        },
        defaultRole: 'workflow_run_shell',
      },
    },
    {
      siteId: 'github',
      pageRole: 'actions_list',
      match: {
        urlPatterns: [String.raw`^https://github\.com/[^/]+/[^/]+/actions(?:/?$|[?#])`],
      },
      primaryRegions: [
        {
          region: 'workflow_runs_list',
          patterns: [
            String.raw`\bfilter workflow runs\b`,
            String.raw`\brun\s+\d+\b`,
            String.raw`\bcompleted successfully\b`,
            String.raw`\bworkflow run entries\b`,
            String.raw`\brun detail entry\b`,
            String.raw`\bqueued\b`,
            String.raw`\bfailed\b`,
          ],
          minMatches: 1,
          priority: 1000,
          confidence: 'high',
        },
        {
          region: 'actions_shell',
          patterns: [String.raw`\bactions\b`, String.raw`\bworkflows?\b`, String.raw`\bloading\b`],
          minMatches: 1,
          priority: 0,
          confidence: 'medium',
        },
      ],
      fallback: {
        primaryRegion: 'actions_shell',
        primaryRegionConfidence: 'medium',
      },
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      match: {
        urlPatterns: [String.raw`^https://github\.com/[^/]+/[^/]+/issues(?:/?$|[?#])`],
      },
      primaryRegions: [
        {
          region: 'issues_results',
          patterns: [
            String.raw`\bsearch issues\b`,
            String.raw`\bfilter(?: by)?\b`,
            String.raw`\bnew issue\b`,
            String.raw`\bassignee\b`,
            String.raw`\blabels?\b`,
            String.raw`\bmilestone\b`,
            String.raw`\bissue entries\b`,
          ],
          minMatches: 1,
          priority: 1000,
          confidence: 'high',
        },
        {
          region: 'issues_shell',
          patterns: [String.raw`\bissues\b`, String.raw`\bloading\b`, String.raw`\brepository\b`],
          minMatches: 1,
          priority: 0,
          confidence: 'medium',
        },
      ],
      fallback: {
        primaryRegion: 'issues_shell',
        primaryRegionConfidence: 'medium',
      },
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: {
        urlPatterns: [String.raw`^https://github\.com/[^/]+/[^/]+/?(?:[?#]|$)`],
      },
      primaryRegions: [
        {
          region: 'repo_primary_nav',
          patterns: [
            String.raw`\bissues\b`,
            String.raw`\bpull requests?\b`,
            String.raw`\bactions\b`,
            String.raw`\bgo to file\b`,
          ],
          minMatches: 1,
          priority: 1000,
          confidence: 'medium',
        },
        {
          region: 'repo_shell',
          patterns: [
            String.raw`\bcode\b`,
            String.raw`\breadme\b`,
            String.raw`\bcommit\b`,
            String.raw`\bmain branch\b`,
          ],
          minMatches: 1,
          priority: 0,
          confidence: 'low',
        },
      ],
      fallback: {
        primaryRegion: 'repo_shell',
        primaryRegionConfidence: 'low',
      },
    },
  ],
};
