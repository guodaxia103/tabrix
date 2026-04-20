import type { PageRole } from './read-page-understanding-core';
import type {
  HighValueObjectPriorityRule,
  HighValueObjectSeed,
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
