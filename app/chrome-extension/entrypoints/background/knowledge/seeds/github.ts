import type { KnowledgeObjectClassifier, KnowledgeSeeds, KnowledgeUIMapRule } from '../types';

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
 * - `workflow_run_detail` is **stable for any `/actions/runs/<id>` URL**
 *   (T5.4.5 contract, `read-page-understanding-github.ts:132-151`).
 *   URL-derived `pageRole` and content-derived `primaryRegion` are
 *   orthogonal: the role says "what navigation identity is this page",
 *   while the primary region reports whether `workflow_run_summary` has
 *   hydrated or we only see the `workflow_run_shell` skeleton. No
 *   `dualOutcome` is needed — Stage 1 plumbing retains the type only
 *   for future seeds that genuinely promote the role.
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
  objectClassifiers: GITHUB_OBJECT_CLASSIFIERS(),
  uiMapRules: GITHUB_UI_MAP_RULES(),
};

/**
 * Stage 2 GitHub Object classifier seeds — data-ified replacement for
 * the legacy `classifyByGithubUrl` (URL rules) + `GITHUB_CLASSIFICATION`
 * (label rules) tables in `read-page-high-value-objects-github.ts`.
 *
 * Migration mapping:
 *
 * - URL rules 1..6 correspond one-to-one with `classifyByGithubUrl`
 *   branches (lines 224-293 of `read-page-high-value-objects-github.ts`).
 *   **Declaration order is load-bearing**: the more specific
 *   `/actions/runs/<id>` (rule 2) must precede the generic `/actions(?query)`
 *   (rule 4) for URL-first dispatch to remain bit-compatible.
 * - Label rules 7..33 are copied verbatim from `GITHUB_CLASSIFICATION`
 *   (lines 120-160); each has a `pageRole` filter so rules don't leak
 *   across roles. Reason strings fall back to the lookup's default
 *   `github pageRole=<role> matched <regex>` template, which is
 *   bit-compatible with the legacy reason.
 *
 * The ARIA-role fallback (lines 401-425) is deliberately NOT migrated
 * in Stage 2; see `docs/KNOWLEDGE_STAGE_2.md §2`.
 */
function GITHUB_OBJECT_CLASSIFIERS(): readonly KnowledgeObjectClassifier[] {
  return [
    // -------- URL rules (T5.4.5 origin) --------
    {
      siteId: 'github',
      match: { hrefPatterns: [String.raw`^#`] },
      objectType: 'entry',
      objectSubType: 'github.page_anchor',
      // region intentionally omitted → falls back to context.primaryRegion.
      // reason intentionally omitted so the lookup's default template
      // `github url-class href=<path> -> page_anchor` fills in the actual
      // anchor text (e.g. `#readme`), matching legacy reason verbatim.
    },
    {
      siteId: 'github',
      match: { hrefPatterns: [String.raw`^/actions/runs/\d+(?:/|\?|#|$)`] },
      objectType: 'record',
      objectSubType: 'github.workflow_run_entry',
      region: 'workflow_runs_list',
      reason: 'github url-class matched /actions/runs/<id> -> workflow_run_entry',
    },
    {
      siteId: 'github',
      match: { hrefPatterns: [String.raw`^/actions/workflows/[^/]+\.ya?ml(?:\?|#|$)`] },
      objectType: 'control',
      objectSubType: 'github.workflow_file_entry',
      region: 'workflow_runs_list',
      reason: 'github url-class matched /actions/workflows/*.yml -> workflow_file_entry',
    },
    {
      siteId: 'github',
      match: { hrefPatterns: [String.raw`^/actions(?:\?|#|$)`] },
      objectType: 'control',
      objectSubType: 'github.workflow_filter_control',
      region: 'workflow_runs_list',
      reason: 'github url-class matched /actions(?query) -> workflow_filter_control',
    },
    {
      siteId: 'github',
      match: { hrefPatterns: [String.raw`^/security/code-scanning(?:/|\?|#|$)`] },
      objectType: 'nav_entry',
      objectSubType: 'github.security_quality_tab',
      region: 'repo_primary_nav',
      reason: 'github url-class matched /security/code-scanning -> security_quality_tab',
    },
    {
      siteId: 'github',
      match: { hrefPatterns: [String.raw`^/security(?:/|\?|#|$)`] },
      objectType: 'nav_entry',
      objectSubType: 'github.security_quality_tab',
      region: 'repo_primary_nav',
      reason: 'github url-class matched /security -> security_quality_tab',
    },
    {
      siteId: 'github',
      match: {
        hrefPatterns: [
          String.raw`^/(issues|pulls|actions|security|insights|wiki|projects|discussions|settings)(?:/|\?|#|$)`,
        ],
      },
      objectType: 'nav_entry',
      objectSubType: 'github.repo_nav_tab',
      region: 'repo_primary_nav',
      reason: 'github url-class matched top-level repo tab -> repo_nav_tab',
    },

    // -------- Label rules for repo_home --------
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^issues?$`] },
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^pull requests?$`] },
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^actions$`] },
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^projects?$`] },
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^wiki$`] },
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^security$`] },
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^insights$`] },
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^go to file$`] },
      objectType: 'entry',
      region: 'repo_primary_nav',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      match: { labelPatterns: [String.raw`^main branch$`] },
      objectType: 'control',
      region: 'repo_primary_nav',
    },

    // -------- Label rules for issues_list --------
    {
      siteId: 'github',
      pageRole: 'issues_list',
      match: { labelPatterns: [String.raw`^search issues$`] },
      objectType: 'control',
      region: 'issues_results',
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      match: { labelPatterns: [String.raw`^filter issues$`] },
      objectType: 'control',
      region: 'issues_results',
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      match: { labelPatterns: [String.raw`^filter\b`] },
      objectType: 'control',
      region: 'issues_results',
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      match: { labelPatterns: [String.raw`^new issue$`] },
      objectType: 'control',
      region: 'issues_results',
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      match: { labelPatterns: [String.raw`^issue entries$`] },
      objectType: 'record',
      region: 'issues_results',
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      match: { labelPatterns: [String.raw`^labels?$`] },
      objectType: 'control',
      region: 'issues_results',
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      match: { labelPatterns: [String.raw`^milestones?$`] },
      objectType: 'control',
      region: 'issues_results',
    },

    // -------- Label rules for actions_list --------
    {
      siteId: 'github',
      pageRole: 'actions_list',
      match: { labelPatterns: [String.raw`^filter workflow runs$`] },
      objectType: 'control',
      region: 'workflow_runs_list',
    },
    {
      siteId: 'github',
      pageRole: 'actions_list',
      match: { labelPatterns: [String.raw`^workflow run entries$`] },
      objectType: 'record',
      region: 'workflow_runs_list',
    },
    {
      siteId: 'github',
      pageRole: 'actions_list',
      match: { labelPatterns: [String.raw`^run detail entry$`] },
      objectType: 'entry',
      region: 'workflow_runs_list',
    },
    {
      siteId: 'github',
      pageRole: 'actions_list',
      match: { labelPatterns: [String.raw`^run\s+\d+\b`] },
      objectType: 'record',
      region: 'workflow_runs_list',
    },
    {
      siteId: 'github',
      pageRole: 'actions_list',
      match: { labelPatterns: [String.raw`^completed successfully:\s*run\b`] },
      objectType: 'record',
      region: 'workflow_runs_list',
    },

    // -------- Label rules for workflow_run_detail --------
    {
      siteId: 'github',
      pageRole: 'workflow_run_detail',
      match: { labelPatterns: [String.raw`^summary$`] },
      objectType: 'status_item',
      region: 'workflow_run_summary',
    },
    {
      siteId: 'github',
      pageRole: 'workflow_run_detail',
      match: { labelPatterns: [String.raw`^jobs?$`] },
      objectType: 'status_item',
      region: 'workflow_run_summary',
    },
    {
      siteId: 'github',
      pageRole: 'workflow_run_detail',
      match: { labelPatterns: [String.raw`^show all jobs$`] },
      objectType: 'status_item',
      region: 'workflow_run_summary',
    },
    {
      siteId: 'github',
      pageRole: 'workflow_run_detail',
      match: { labelPatterns: [String.raw`^artifacts?$`] },
      objectType: 'status_item',
      region: 'workflow_run_summary',
    },
    {
      siteId: 'github',
      pageRole: 'workflow_run_detail',
      match: { labelPatterns: [String.raw`^logs?$`] },
      objectType: 'status_item',
      region: 'workflow_run_summary',
    },
    {
      siteId: 'github',
      pageRole: 'workflow_run_detail',
      match: { labelPatterns: [String.raw`^annotations?$`] },
      objectType: 'status_item',
      region: 'workflow_run_summary',
    },
  ];
}

/**
 * Stage 3a GitHub UI Map seed (B-010).
 *
 * Scope — intentionally the smallest demonstrable set:
 *
 *   - `repo_home.open_issues_tab` / `repo_home.open_actions_tab`
 *     — the two hottest navigation jumps off `repo_home`; these are the
 *     purposes the upcoming B-012 action-path aggregator will see first
 *     when Memory is replayed from a fresh repo landing.
 *   - `issues_list.new_issue_cta` / `issues_list.search_input`
 *     — the two controls any meaningful issues-list intent touches (file
 *     a bug, or find an existing one). `search_input` is the only `fill`
 *     action in this seed, exercising that `actionType`.
 *   - `actions_list.filter_input` — the filter box on Actions; B-011 will
 *     need a stable `targetRef` here because the legacy label pattern
 *     `filter workflow runs` is re-rendered across every run update.
 *
 * Everything else (`new pull request`, `fork`, branch picker, etc.) is
 * deferred to a follow-up seed PR. Keep the set small so B-011's
 * `targetRef` work can land against exactly these five purposes.
 *
 * Bit-compat note: the `label_regex` values here intentionally match the
 * `labelPatterns` already in `GITHUB_OBJECT_CLASSIFIERS` above. When
 * B-011 teaches `read_page` HVOs to emit `{ uiMapPurpose }` this equality
 * is what lets a single classifier hit promote directly into a stable
 * `purpose` ref without re-scanning the DOM.
 */
function GITHUB_UI_MAP_RULES(): readonly KnowledgeUIMapRule[] {
  return [
    {
      siteId: 'github',
      pageRole: 'repo_home',
      purpose: 'repo_home.open_issues_tab',
      region: 'repo_primary_nav',
      locatorHints: [
        { kind: 'href_regex', value: String.raw`^/[^/]+/[^/]+/issues(?:/?$|[?#])` },
        { kind: 'aria_name', value: 'Issues', role: 'link' },
        { kind: 'label_regex', value: String.raw`^issues?$`, role: 'link' },
      ],
      actionType: 'navigate',
      confidence: 'high',
      notes:
        'Top repo nav → Issues tab. URL-first hint so a seeded repo page with rendered nav anchors resolves immediately; aria_name / label_regex are DOM fallbacks.',
    },
    {
      siteId: 'github',
      pageRole: 'repo_home',
      purpose: 'repo_home.open_actions_tab',
      region: 'repo_primary_nav',
      locatorHints: [
        { kind: 'href_regex', value: String.raw`^/[^/]+/[^/]+/actions(?:/?$|[?#])` },
        { kind: 'aria_name', value: 'Actions', role: 'link' },
        { kind: 'label_regex', value: String.raw`^actions$`, role: 'link' },
      ],
      actionType: 'navigate',
      confidence: 'high',
      notes: 'Top repo nav → Actions tab.',
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      purpose: 'issues_list.new_issue_cta',
      region: 'issues_results',
      locatorHints: [
        { kind: 'href_regex', value: String.raw`^/[^/]+/[^/]+/issues/new(?:/|\?|#|$)` },
        { kind: 'aria_name', value: 'New issue', role: 'link' },
        { kind: 'label_regex', value: String.raw`^new issue$` },
      ],
      actionType: 'click',
      confidence: 'high',
      notes: 'Primary CTA on issues list. href pattern covers the link-shaped button GitHub ships.',
    },
    {
      siteId: 'github',
      pageRole: 'issues_list',
      purpose: 'issues_list.search_input',
      region: 'issues_results',
      locatorHints: [
        { kind: 'aria_name', value: 'Search issues', role: 'searchbox' },
        { kind: 'aria_name', value: 'Search all issues', role: 'searchbox' },
        { kind: 'label_regex', value: String.raw`^search issues$`, role: 'searchbox' },
      ],
      actionType: 'fill',
      confidence: 'medium',
      notes:
        'Search/filter box. The aria role is stable across GitHub redesigns; label regex is a DOM-side safety net.',
    },
    {
      siteId: 'github',
      pageRole: 'actions_list',
      purpose: 'actions_list.filter_input',
      region: 'workflow_runs_list',
      locatorHints: [
        { kind: 'aria_name', value: 'Filter workflow runs', role: 'searchbox' },
        { kind: 'label_regex', value: String.raw`^filter workflow runs$` },
      ],
      actionType: 'fill',
      confidence: 'medium',
      notes:
        'Filter box on Actions. Critical for B-011 because the label text re-renders on every workflow run update — a stable ref here removes the dominant retry cause for Actions intents.',
    },
  ];
}
