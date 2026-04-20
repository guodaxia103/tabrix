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
import {
  isKnowledgeRegistryEnabled,
  isKnowledgeRegistryDiffMode,
  KNOWLEDGE_REGISTRY_MODE,
} from '../../knowledge/feature-flag';
import { resolveObjectClassification } from '../../knowledge/lookup/resolve-object-classification';

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

/* -------------------------------------------------------------------------- */
/* T5.4.5 URL-based sub-type classifier                                        */
/*                                                                             */
/* Problem solved: on GitHub's `/actions` page the visible labels and ARIA    */
/* roles for a workflow FILE link (`.github/workflows/foo.yml`), a workflow  */
/* RUN link (`/actions/runs/<id>`), and the "All workflows" filter button    */
/* are nearly identical (all `<a>` with generic text). Real LLMs and our      */
/* test pickers consistently click the wrong one. The fix: expose the         */
/* underlying `href` on HVO + tag the target with a namespaced                */
/* `objectSubType` derived from URL shape so downstream can match precisely.  */
/* -------------------------------------------------------------------------- */

const GITHUB_REPO_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\/|\?|#|$)/i;

interface GithubRepoContext {
  owner: string;
  repo: string;
}

function resolveGithubRepoContext(currentUrl: string): GithubRepoContext | null {
  const match = GITHUB_REPO_URL_RE.exec(String(currentUrl || '').trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function normalizeHrefToPath(href: string, repoCtx: GithubRepoContext | null): string | null {
  const trimmed = String(href || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
      if (repoCtx) {
        const expectedPrefix = `/${repoCtx.owner}/${repoCtx.repo}`;
        if (!url.pathname.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
          return `${url.pathname}${url.search}${url.hash}`;
        }
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }
  return null;
}

interface GithubUrlClassification {
  objectSubType: string;
  objectType: ReadPageObjectType;
  region: string | null;
  reason: string;
}

function classifyByGithubUrl(href: string, currentUrl: string): GithubUrlClassification | null {
  const repoCtx = resolveGithubRepoContext(currentUrl);
  const path = normalizeHrefToPath(href, repoCtx);
  if (!path) return null;

  if (path.startsWith('#')) {
    return {
      objectSubType: 'github.page_anchor',
      objectType: 'entry',
      region: null,
      reason: `github url-class href=${path} -> page_anchor`,
    };
  }

  const ownerRepoPrefix = repoCtx ? `/${repoCtx.owner}/${repoCtx.repo}` : '';
  const relPath =
    ownerRepoPrefix && path.toLowerCase().startsWith(ownerRepoPrefix.toLowerCase())
      ? path.slice(ownerRepoPrefix.length)
      : path;

  if (/^\/actions\/runs\/\d+(?:\/|\?|#|$)/i.test(relPath)) {
    return {
      objectSubType: 'github.workflow_run_entry',
      objectType: 'record',
      region: 'workflow_runs_list',
      reason: `github url-class matched /actions/runs/<id> -> workflow_run_entry`,
    };
  }

  if (/^\/actions\/workflows\/[^/]+\.ya?ml(?:\?|#|$)/i.test(relPath)) {
    return {
      objectSubType: 'github.workflow_file_entry',
      objectType: 'control',
      region: 'workflow_runs_list',
      reason: `github url-class matched /actions/workflows/*.yml -> workflow_file_entry`,
    };
  }

  if (/^\/actions(?:\?|#|$)/i.test(relPath)) {
    return {
      objectSubType: 'github.workflow_filter_control',
      objectType: 'control',
      region: 'workflow_runs_list',
      reason: `github url-class matched /actions(?query) -> workflow_filter_control`,
    };
  }

  if (/^\/security\/code-scanning(?:\/|\?|#|$)/i.test(relPath)) {
    return {
      objectSubType: 'github.security_quality_tab',
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
      reason: `github url-class matched /security/code-scanning -> security_quality_tab`,
    };
  }
  if (/^\/security(?:\/|\?|#|$)/i.test(relPath)) {
    return {
      objectSubType: 'github.security_quality_tab',
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
      reason: `github url-class matched /security -> security_quality_tab`,
    };
  }

  if (
    /^\/(issues|pulls|actions|security|insights|wiki|projects|discussions|settings)(?:\/|\?|#|$)/i.test(
      relPath,
    )
  ) {
    return {
      objectSubType: 'github.repo_nav_tab',
      objectType: 'nav_entry',
      region: 'repo_primary_nav',
      reason: `github url-class matched top-level repo tab -> repo_nav_tab`,
    };
  }

  return null;
}

/**
 * GitHub-specific noise patterns per SoT section "明确的低价值对象降权规则".
 * These are shell / site-chrome wording that would otherwise rank high simply
 * because they are everywhere on GitHub. They stay in the GitHub adapter
 * (not core) because they are GitHub vocabulary.
 */
const GITHUB_NOISE_PATTERNS: Array<{ pattern: RegExp; delta: number; label: string }> = [
  { pattern: /^(watch|star(?:red)?|pin this repository)\b/i, delta: -0.4, label: 'watch_star_pin' },
  { pattern: /^search or jump to/i, delta: -0.5, label: 'search_or_jump' },
  { pattern: /^open copilot/i, delta: -0.5, label: 'open_copilot' },
  { pattern: /^skip to content$/i, delta: -0.5, label: 'skip_to_content' },
  { pattern: /github\.blog/i, delta: -0.25, label: 'footer_blog' },
  {
    pattern: /^(terms|privacy|security|status|docs|api|training|pricing|about)$/i,
    delta: -0.3,
    label: 'footer_links',
  },
  { pattern: /^v?\d+\.\d+\.\d+$/i, delta: -0.25, label: 'version_string' },
];

/**
 * Preferred primary labels per GitHub pageRole. When the candidate label
 * matches one of these in order, it gets a positional importance boost
 * (first match: +0.20, second: +0.16, third: +0.12, ...). This is what
 * makes seed labels outrank generic interactives of the same objectType.
 */
const GITHUB_PREFERRED_LABELS: Partial<Record<string, RegExp[]>> = {
  repo_home: [/^issues$/i, /^pull requests?$/i, /^actions$/i, /^go to file$/i],
  issues_list: [/^search issues$/i, /^filter issues$/i, /^issue entries$/i, /^new issue$/i],
  actions_list: [/^filter workflow runs$/i, /^workflow run entries$/i, /^run detail entry$/i],
  workflow_run_detail: [/^summary$/i, /^jobs?$/i, /^artifacts?$/i, /^logs?$/i],
};

function formatGithubDelta(delta: number): string {
  return delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
}

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
    // Stage 2 — Knowledge Registry is the primary classifier for
    // URL + label rules. Legacy ARIA fallback always stays TS-side.
    //
    // Shape mirrors `inferPageUnderstanding` (`read-page-understanding.ts`):
    // registry-first, legacy-fallback, and a `diff` dev-mode that emits
    // `console.warn` when the two paths diverge while still returning the
    // legacy result so production behaviour is never gated on registry.
    if (!isKnowledgeRegistryEnabled(KNOWLEDGE_REGISTRY_MODE)) {
      return legacyGithubClassify(candidate, context);
    }
    if (isKnowledgeRegistryDiffMode(KNOWLEDGE_REGISTRY_MODE)) {
      const viaRegistry = resolveObjectClassification({
        siteId: 'github',
        candidate,
        context,
      });
      const viaLegacy = legacyGithubClassify(candidate, context);
      if (!classifiedObjectsEqual(viaRegistry, viaLegacy)) {
        console.warn('[tabrix/knowledge] hvo classifier diff', {
          label: candidate.label,
          href: candidate.href,
          pageRole: context.pageRole,
          viaRegistry,
          viaLegacy,
        });
      }
      return viaLegacy;
    }
    const viaRegistry = resolveObjectClassification({
      siteId: 'github',
      candidate,
      context,
    });
    if (viaRegistry) return viaRegistry;
    return legacyGithubClassify(candidate, context);
  },
  scorePrior(
    classified: ClassifiedCandidateObject,
    context: ObjectLayerContext,
  ): { delta: number; reasons: string[] } {
    const reasons: string[] = [];
    let delta = 0;

    for (const noise of GITHUB_NOISE_PATTERNS) {
      if (noise.pattern.test(classified.label)) {
        delta += noise.delta;
        reasons.push(`${formatGithubDelta(noise.delta)} github_noise=${noise.label}`);
      }
    }

    const roleKey = String(context.pageRole || '');
    const preferred = GITHUB_PREFERRED_LABELS[roleKey];
    if (preferred) {
      for (let i = 0; i < preferred.length; i += 1) {
        if (preferred[i].test(classified.label)) {
          const boost = Math.max(0, Number((0.1 - i * 0.02).toFixed(2)));
          if (boost > 0) {
            delta += boost;
            reasons.push(`${formatGithubDelta(boost)} github_preferred[index=${i}]`);
          }
          break;
        }
      }
    }

    return { delta, reasons };
  },
};

/* -------------------------------------------------------------------------- */
/* Legacy classifier body, kept for:                                          */
/*   - `KNOWLEDGE_REGISTRY_MODE='off'` rollback path                           */
/*   - ARIA-role fallback that Stage 2 deliberately did not migrate           */
/*   - `diff` mode golden reference                                           */
/* Behaviour is bit-identical to the pre-Stage-2 `classify` body.             */
/* -------------------------------------------------------------------------- */

function legacyGithubClassify(
  candidate: CandidateObject,
  context: ObjectLayerContext,
): ClassifiedCandidateObject | null {
  const roleKey = String(context.pageRole || '');

  const hrefForClass = candidate.href ? String(candidate.href).trim() : '';
  if (hrefForClass) {
    const urlClass = classifyByGithubUrl(hrefForClass, context.currentUrl);
    if (urlClass) {
      const reasons = [urlClass.reason];
      if (candidate.origin === 'page_role_seed') {
        reasons.push('page_role_seed prior');
      }
      return {
        ...candidate,
        objectType: urlClass.objectType,
        objectSubType: urlClass.objectSubType,
        region: urlClass.region ?? context.primaryRegion,
        classificationReasons: reasons,
      };
    }
  }

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
}

function classifiedObjectsEqual(
  a: ClassifiedCandidateObject | null,
  b: ClassifiedCandidateObject | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.objectType !== b.objectType) return false;
  if ((a.objectSubType ?? null) !== (b.objectSubType ?? null)) return false;
  if ((a.region ?? null) !== (b.region ?? null)) return false;
  const ra = a.classificationReasons;
  const rb = b.classificationReasons;
  if (ra.length !== rb.length) return false;
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] !== rb[i]) return false;
  }
  return true;
}

/** Testing hook — expose the legacy classifier for parity tests. */
export function __githubLegacyClassifyForTest(
  candidate: CandidateObject,
  context: ObjectLayerContext,
): ClassifiedCandidateObject | null {
  return legacyGithubClassify(candidate, context);
}
