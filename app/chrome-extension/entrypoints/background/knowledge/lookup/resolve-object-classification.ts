import type {
  ClassifiedCandidateObject,
  CandidateObject,
  ObjectLayerContext,
} from '../../tools/browser/read-page-high-value-objects-core';
import type {
  CompiledKnowledgeObjectClassifier,
  CompiledKnowledgePattern,
  CompiledKnowledgeRegistry,
} from '../types';
import { getCompiledKnowledgeRegistry } from '../registry/knowledge-registry';

/**
 * Stage 2 — Knowledge-Registry-backed object classifier.
 *
 * Design rationale: `docs/KNOWLEDGE_STAGE_2.md`.
 *
 * Returns a `ClassifiedCandidateObject` when any compiled classifier
 * rule for `siteId` matches; returns `null` otherwise so the consumer
 * can fall back to the legacy TS classifier (ARIA fallback, etc.).
 *
 * Match algorithm (mirrors `githubObjectLayerAdapter.classify`
 * lines 355-429, pre-Stage-2 behaviour):
 * 1. Iterate classifiers in declaration order (URL rules first,
 *    label rules second — see `seeds/github.ts`).
 * 2. Skip rules whose `pageRole` filter doesn't match
 *    `context.pageRole`.
 * 3. Try `hrefPatterns` against the normalized href path
 *    (re-implements `classifyByGithubUrl`'s
 *    `resolveGithubRepoContext` + `normalizeHrefToPath` locally).
 * 4. Try `labelPatterns` against `candidate.label`.
 * 5. Try `ariaRoles` against `candidate.role` (lowercased).
 * 6. First path that matches produces the classification.
 *
 * Stage 2 only ships GitHub rules, so the href normalizer here is
 * GitHub-specific (owner/repo relative path extraction). Stage 3
 * will generalize this by introducing a per-site href normalizer
 * when Douyin / other sites come online.
 */

export interface ObjectClassificationLookupInput {
  readonly siteId: string;
  readonly candidate: CandidateObject;
  readonly context: ObjectLayerContext;
}

export function resolveObjectClassification(
  input: ObjectClassificationLookupInput,
  registry: CompiledKnowledgeRegistry | null = getCompiledKnowledgeRegistry(),
): ClassifiedCandidateObject | null {
  if (!registry) return null;
  const rules = registry.objectClassifiersBySite.get(input.siteId);
  if (!rules || rules.length === 0) return null;

  const { candidate, context } = input;
  const roleKey = String(context.pageRole || '');

  for (const rule of rules) {
    if (rule.pageRole && rule.pageRole !== roleKey) continue;

    const hrefOutcome = tryHrefMatch(rule, candidate, context);
    if (hrefOutcome) {
      return buildClassified(candidate, rule, hrefOutcome.reason, context, /*hrefMatched*/ true);
    }

    const labelOutcome = tryLabelMatch(rule, candidate.label);
    if (labelOutcome) {
      return buildClassified(candidate, rule, labelOutcome.reason, context, false);
    }

    const ariaOutcome = tryAriaMatch(rule, candidate.role);
    if (ariaOutcome) {
      return buildClassified(candidate, rule, ariaOutcome.reason, context, false);
    }
  }
  return null;
}

interface MatchOutcome {
  readonly reason: string;
}

function tryHrefMatch(
  rule: CompiledKnowledgeObjectClassifier,
  candidate: CandidateObject,
  context: ObjectLayerContext,
): MatchOutcome | null {
  if (rule.match.hrefPatterns.length === 0) return null;
  const hrefRaw = candidate.href ? String(candidate.href).trim() : '';
  if (!hrefRaw) return null;
  const path = normalizeHrefToPath(hrefRaw, context.currentUrl, rule.siteId);
  if (path === null) return null;

  for (const compiled of rule.match.hrefPatterns) {
    if (compiled.pattern.test(path)) {
      const reason =
        rule.reason ?? defaultHrefReason(rule.siteId, path, rule.objectSubType, compiled);
      return { reason };
    }
  }
  return null;
}

function tryLabelMatch(
  rule: CompiledKnowledgeObjectClassifier,
  label: string,
): MatchOutcome | null {
  if (rule.match.labelPatterns.length === 0) return null;
  for (const compiled of rule.match.labelPatterns) {
    if (compiled.pattern.test(label)) {
      const reason =
        rule.reason ?? `${rule.siteId} pageRole=${rule.pageRole ?? '*'} matched ${compiled.source}`;
      return { reason };
    }
  }
  return null;
}

function tryAriaMatch(
  rule: CompiledKnowledgeObjectClassifier,
  role: string | undefined,
): MatchOutcome | null {
  if (rule.match.ariaRoles.length === 0) return null;
  const ariaRole = (role || '').toLowerCase();
  if (!ariaRole) return null;
  if (!rule.match.ariaRoles.includes(ariaRole)) return null;
  const reason = rule.reason ?? `${rule.siteId} aria role=${ariaRole} -> ${rule.objectType}`;
  return { reason };
}

function buildClassified(
  candidate: CandidateObject,
  rule: CompiledKnowledgeObjectClassifier,
  reason: string,
  context: ObjectLayerContext,
  _hrefMatched: boolean,
): ClassifiedCandidateObject {
  const reasons: string[] = [reason];
  if (candidate.origin === 'page_role_seed') {
    reasons.push('page_role_seed prior');
  }
  const region = rule.region ?? context.primaryRegion;
  const out: ClassifiedCandidateObject = {
    ...candidate,
    objectType: rule.objectType,
    region,
    classificationReasons: reasons,
  };
  if (rule.objectSubType) {
    out.objectSubType = rule.objectSubType;
  }
  return out;
}

function defaultHrefReason(
  siteId: string,
  path: string,
  subType: string | null,
  _compiled: CompiledKnowledgePattern,
): string {
  const subtypeTag = subType ? ` -> ${subType.replace(/^.*?\./, '')}` : '';
  return `${siteId} url-class href=${path}${subtypeTag}`;
}

/* -------------------------------------------------------------------------- */
/* GitHub href normalization (Stage 3 will generalize per-site)               */
/* -------------------------------------------------------------------------- */

const GITHUB_REPO_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\/|\?|#|$)/i;

function normalizeHrefToPath(href: string, currentUrl: string, siteId: string): string | null {
  if (siteId !== 'github') return null;
  const repoCtx = resolveGithubRepoContext(currentUrl);
  const trimmed = String(href || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return trimmed;
  if (trimmed.startsWith('/')) return stripRepoPrefix(trimmed, repoCtx);
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
      const raw = `${url.pathname}${url.search}${url.hash}`;
      return stripRepoPrefix(raw, repoCtx);
    } catch {
      return null;
    }
  }
  return null;
}

interface GithubRepoContext {
  readonly owner: string;
  readonly repo: string;
}

function resolveGithubRepoContext(currentUrl: string): GithubRepoContext | null {
  const match = GITHUB_REPO_URL_RE.exec(String(currentUrl || '').trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function stripRepoPrefix(path: string, repoCtx: GithubRepoContext | null): string {
  if (!repoCtx) return path;
  const expectedPrefix = `/${repoCtx.owner}/${repoCtx.repo}`;
  if (path.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
    return path.slice(expectedPrefix.length);
  }
  return path;
}
