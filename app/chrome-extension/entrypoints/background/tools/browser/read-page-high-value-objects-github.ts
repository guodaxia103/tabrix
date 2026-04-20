import type { ReadPageObjectType, ReadPageSourceKind } from '@tabrix/shared';
import type { PageRole } from './read-page-understanding-core';
import type {
  CandidateObject,
  ClassifiedCandidateObject,
  HighValueObjectPriorityRule,
  HighValueObjectSeed,
  ObjectLayerContext,
  ObjectLayerFamilyAdapter,
  PageObjectFamilyAdapter,
  PageObjectPriors,
} from './read-page-high-value-objects-core';

/**
 * T5.4.0 Object Layer — GitHub Family Priors
 *
 * Owns GitHub-specific high-value object priority rules, task seeds, and L0
 * summary prefixes that were previously hard-coded inside
 * `read-page-task-protocol.ts`. Behavior is intentionally identical to the
 * pre-T5.4.0 protocol so the public GitHub baseline does not regress.
 *
 * T5.4.1+ additions: `githubObjectLayerAdapter` implements the four-layer
 * `ObjectLayerFamilyAdapter` contract (seeds via `collectExtraCandidates`,
 * semantic `objectType` via `classify`, family-prior boost via `scorePrior`).
 * Until T5.4.4 wires the four-layer pipeline into
 * `read-page-task-protocol.ts`, this adapter coexists with the legacy
 * `githubHighValueObjectAdapter`.
 */

const GITHUB_PAGE_ROLE_PRIORITY_RULES: Partial<Record<string, HighValueObjectPriorityRule>> = {
  repo_home: {
    primary: [/\bissues\b/i, /\bpull requests?\b/i, /\bactions\b/i],
    secondary: [/\bgo to file\b/i],
    tertiary: [/\bmain branch\b/i],
    deprioritize: [
      /\bwatch\b/i,
      /\bstar(?:red)?\b/i,
      /\bpin this repository\b/i,
      /\bsee your forks\b/i,
      /\badd file\b/i,
      /\bcommits? by\b/i,
      /^commit\b/i,
    ],
    l0Prefix: 'Primary repo entry points are',
  },
  issues_list: {
    primary: [/\bsearch issues\b/i],
    secondary: [/\bfilter by\b/i, /\bfilter\b/i, /\bnew issue\b/i],
    tertiary: [/\bissue\b/i],
    deprioritize: [/^search or jump to/i, /^open copilot/i, /^skip to content$/i],
    l0Prefix: 'Primary issue controls are',
  },
  actions_list: {
    primary: [/\bfilter workflow runs\b/i],
    secondary: [/\brun\s+\d+\b/i, /\bcompleted successfully: run\b/i],
    tertiary: [/\bsummary\b/i, /\bjobs?\b/i],
    deprioritize: [/^search or jump to/i, /^open copilot/i, /^skip to content$/i],
    l0Prefix: 'Primary workflow run entries are',
  },
  workflow_run_detail: {
    primary: [/\bsummary\b/i, /\bshow all jobs\b/i, /\bjobs?\b/i],
    secondary: [/\bartifacts?\b/i, /\blogs?\b/i, /\bannotations?\b/i],
    tertiary: [/\bshow more\b/i],
    deprioritize: [/^\d+[smhd]$/i, /github\.blog/i, /^v?\d+\.\d+\.\d+$/i],
    l0Prefix: 'Primary workflow diagnostics are',
  },
};

const GITHUB_PAGE_ROLE_TASK_SEEDS: Partial<Record<string, HighValueObjectSeed>> = {
  repo_home: {
    labels: ['Issues', 'Pull requests', 'Actions'],
    reason: 'primary repo navigation inferred from page role',
  },
  issues_list: {
    labels: ['Search Issues', 'Filter issues', 'Issue entries'],
    reason: 'primary issue triage objects inferred from page role',
  },
  actions_list: {
    labels: ['Filter workflow runs', 'Workflow run entries', 'Run detail entry'],
    reason: 'primary workflow list objects inferred from page role',
  },
  workflow_run_detail: {
    labels: ['Summary', 'Jobs', 'Artifacts', 'Logs'],
    reason: 'primary workflow diagnostics inferred from page role',
  },
};

export const githubHighValueObjectAdapter: PageObjectFamilyAdapter = {
  family: 'github',
  resolve(pageRole: PageRole): PageObjectPriors | null {
    const roleKey = String(pageRole || '');
    const rule = GITHUB_PAGE_ROLE_PRIORITY_RULES[roleKey];
    const seed = GITHUB_PAGE_ROLE_TASK_SEEDS[roleKey];
    if (!rule && !seed) {
      return null;
    }
    return {
      priorityRule: rule ?? null,
      seed: seed ?? null,
      l0Prefix: rule?.l0Prefix ?? null,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* T5.4.2+ four-layer object adapter                                           */
/* -------------------------------------------------------------------------- */

interface GithubClassificationRule {
  match: RegExp;
  objectType: ReadPageObjectType;
  region: string | null;
}

/**
 * Per-pageRole label → objectType/region mapping. Source of truth:
 * Feishu `Tabrix T5.4 高价值对象提取 正式产品级规格 v2026.04.20.1`, sections
 * "首批产品范围" and "首批对象类型".
 */
const GITHUB_CLASSIFICATION: Partial<Record<string, GithubClassificationRule[]>> = {
  repo_home: [
    { match: /^issues?$/i, objectType: 'nav_entry', region: 'repo_primary_nav' },
    { match: /^pull requests?$/i, objectType: 'nav_entry', region: 'repo_primary_nav' },
    { match: /^actions$/i, objectType: 'nav_entry', region: 'repo_primary_nav' },
    { match: /^projects?$/i, objectType: 'nav_entry', region: 'repo_primary_nav' },
    { match: /^wiki$/i, objectType: 'nav_entry', region: 'repo_primary_nav' },
    { match: /^security$/i, objectType: 'nav_entry', region: 'repo_primary_nav' },
    { match: /^insights$/i, objectType: 'nav_entry', region: 'repo_primary_nav' },
    { match: /^go to file$/i, objectType: 'entry', region: 'repo_primary_nav' },
    { match: /^main branch$/i, objectType: 'control', region: 'repo_primary_nav' },
  ],
  issues_list: [
    { match: /^search issues$/i, objectType: 'control', region: 'issues_results' },
    { match: /^filter issues$/i, objectType: 'control', region: 'issues_results' },
    { match: /^filter\b/i, objectType: 'control', region: 'issues_results' },
    { match: /^new issue$/i, objectType: 'control', region: 'issues_results' },
    { match: /^issue entries$/i, objectType: 'record', region: 'issues_results' },
    { match: /^labels?$/i, objectType: 'control', region: 'issues_results' },
    { match: /^milestones?$/i, objectType: 'control', region: 'issues_results' },
  ],
  actions_list: [
    { match: /^filter workflow runs$/i, objectType: 'control', region: 'workflow_runs_list' },
    { match: /^workflow run entries$/i, objectType: 'record', region: 'workflow_runs_list' },
    { match: /^run detail entry$/i, objectType: 'entry', region: 'workflow_runs_list' },
    { match: /^run\s+\d+\b/i, objectType: 'record', region: 'workflow_runs_list' },
    {
      match: /^completed successfully:\s*run\b/i,
      objectType: 'record',
      region: 'workflow_runs_list',
    },
  ],
  workflow_run_detail: [
    { match: /^summary$/i, objectType: 'status_item', region: 'workflow_run_summary' },
    { match: /^jobs?$/i, objectType: 'status_item', region: 'workflow_run_summary' },
    { match: /^show all jobs$/i, objectType: 'status_item', region: 'workflow_run_summary' },
    { match: /^artifacts?$/i, objectType: 'status_item', region: 'workflow_run_summary' },
    { match: /^logs?$/i, objectType: 'status_item', region: 'workflow_run_summary' },
    { match: /^annotations?$/i, objectType: 'status_item', region: 'workflow_run_summary' },
  ],
};

const GITHUB_OWNED_ROLES = new Set(Object.keys(GITHUB_PAGE_ROLE_TASK_SEEDS));

export const githubObjectLayerAdapter: ObjectLayerFamilyAdapter = {
  family: 'github',
  owns(pageRole: PageRole): boolean {
    return GITHUB_OWNED_ROLES.has(String(pageRole || ''));
  },
  collectExtraCandidates(context: ObjectLayerContext): CandidateObject[] {
    const roleKey = String(context.pageRole || '');
    const seed = GITHUB_PAGE_ROLE_TASK_SEEDS[roleKey];
    if (!seed) return [];
    const sourceKind: ReadPageSourceKind = 'dom_semantic';
    return seed.labels.map((label, index) => ({
      id: `hvo_seed_${roleKey}_${index}`,
      label,
      sourceKind,
      origin: 'page_role_seed',
      provenance: { seedPageRole: roleKey, seedIndex: index },
      matchReason: seed.reason,
    }));
  },
  classify(
    candidate: CandidateObject,
    context: ObjectLayerContext,
  ): ClassifiedCandidateObject | null {
    const roleKey = String(context.pageRole || '');
    const rules = GITHUB_CLASSIFICATION[roleKey];
    if (rules) {
      for (const rule of rules) {
        if (rule.match.test(candidate.label)) {
          const reasons = [`github pageRole=${roleKey} matched ${rule.match.source}`];
          if (candidate.origin === 'page_role_seed') {
            reasons.push('page_role_seed prior');
          }
          return {
            ...candidate,
            objectType: rule.objectType,
            region: rule.region,
            classificationReasons: reasons,
          };
        }
      }
    }

    const ariaRole = (candidate.role || '').toLowerCase();
    const fallbackRegion = context.primaryRegion;
    if (['button', 'textbox', 'searchbox', 'combobox', 'switch', 'checkbox'].includes(ariaRole)) {
      return {
        ...candidate,
        objectType: 'control',
        region: fallbackRegion,
        classificationReasons: [`github fallback role=${ariaRole} -> control`],
      };
    }
    if (ariaRole === 'tab' || ariaRole === 'menuitem') {
      return {
        ...candidate,
        objectType: 'nav_entry',
        region: fallbackRegion,
        classificationReasons: [`github fallback role=${ariaRole} -> nav_entry`],
      };
    }
    if (ariaRole === 'link') {
      return {
        ...candidate,
        objectType: 'entry',
        region: fallbackRegion,
        classificationReasons: [`github fallback role=link -> entry`],
      };
    }

    return null;
  },
};
