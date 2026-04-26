/**
 * `tabrix_choose_context` v1 (B-018) — pure input/output helpers.
 *
 * Mirrors the contract in `docs/B_018_CONTEXT_SELECTOR_V1.md`. Stays
 * deliberately small:
 *
 *  - `parseTabrixChooseContextInput` validates raw MCP args.
 *  - `chooseContextStrategy` is a pure function over already-resolved
 *    facts (`hasExperienceHit`, `hasUsableKnowledge`, `siteFamily`).
 *  - `runTabrixChooseContext` is the IO orchestrator, kept tiny so it
 *    is easy to wire from `native-tool-handlers.ts` without crowding
 *    the dispatcher with chooser logic.
 *
 * Side-effect surface (V23-04 / B-018 v1.5): the only IO this module
 * does is the optional telemetry write-back through
 * `ChooseContextTelemetryRepository`. The chooser still never calls
 * the bridge and never reads `process.env` directly; tests inject the
 * telemetry repo plus every other dependency via `chooseContextStrategy`
 * or the runner's `deps` argument.
 *
 * `runTabrixChooseContextRecordOutcome` is the matching write-back
 * runner used by `tabrix_choose_context_record_outcome`. It validates
 * input, looks up the decision row, appends one outcome row, and
 * returns `unknown_decision` when the id is well-formed but missing.
 */

import { randomUUID } from 'node:crypto';
import {
  EXPERIENCE_HIT_MIN_SUCCESS_RATE,
  EXPERIENCE_LOOKUP_LIMIT,
  KNOWLEDGE_LIGHT_SAMPLE_LIMIT,
  MARKDOWN_FRIENDLY_PAGE_ROLES,
  MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS,
  MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS,
  type ContextStrategyName,
  type ReplayEligibilityBlockReason,
  type TabrixChooseContextArtifact,
  type TabrixChooseContextInput,
  type TabrixChooseContextOutcome,
  type TabrixChooseContextRankedCandidate,
  type TabrixChooseContextRecordOutcomeResult,
  type TabrixChooseContextResult,
  type TabrixContextSiteFamily,
} from '@tabrix/shared';
import { isCapabilityEnabled } from '../policy/capabilities';
import type { CapabilityEnv } from '../policy/capabilities';
import { normalizeIntentSignature } from '../memory/experience/experience-aggregator';
import type { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import type { ExperienceQueryService } from '../memory/experience';
import type { ExperienceActionPathRow } from '../memory/experience/experience-repository';
import type { ChooseContextTelemetryRepository } from '../memory/telemetry/choose-context-telemetry';
import { rankExperienceCandidates } from './choose-context-replay-rules';
import {
  dispatchLayer,
  type LayerDispatchTaskType,
  type LayerDispatchUserIntentHint,
} from './choose-context-layer-dispatch';
import type { PageContextProvider } from './page-context-provider';
import { resolveApiKnowledgeCandidate } from '../api/api-knowledge';
import {
  routeDataSource,
  type DataSourceCostEstimate,
  type DataSourceFallbackPlan,
  type DataSourceKind,
  type DataSourceRiskTier,
} from '../execution/data-source-router';

export interface TabrixChooseContextRouterTelemetry {
  chosenSource?: DataSourceKind;
  dataSource?: DataSourceKind;
  routerConfidence?: number;
  routerRiskTier?: DataSourceRiskTier;
  decisionReason?: string;
  fallbackPlan?: DataSourceFallbackPlan;
  dispatcherInputSource?: string;
  costEstimate?: DataSourceCostEstimate;
}

type TabrixChooseContextResultWithRouter = TabrixChooseContextResult &
  TabrixChooseContextRouterTelemetry;

export class TabrixChooseContextInputError extends Error {
  public readonly code: 'TABRIX_CHOOSE_CONTEXT_BAD_INPUT';
  constructor(message: string) {
    super(message);
    this.code = 'TABRIX_CHOOSE_CONTEXT_BAD_INPUT';
    this.name = 'TabrixChooseContextInputError';
  }
}

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new TabrixChooseContextInputError(`'${key}' must be a string`);
  }
  return value;
}

/**
 * Internal: return the parsed value plus the resolved
 * `intentSignature`. Kept as a private struct because the upstream
 * MCP contract returns the signature in `resolved.*`, not at the top
 * level.
 */
export interface ParsedChooseContextInput {
  input: TabrixChooseContextInput;
  intentSignature: string;
}

/**
 * Validate raw MCP arguments. Mirrors `parseExperienceSuggestPlanInput`
 * so a `(intent, pageRole)` pair lands in the same bucket here as it
 * does for `experience_suggest_plan`. v1 deliberately silently drops:
 *   - unparseable `url` (treated as omitted),
 *   - unrecognised `siteId` (treated as omitted),
 *   - empty-after-trim `pageRole` (treated as omitted).
 *
 * It does NOT silently drop bad `intent`: empty / non-string intent is
 * still a typed input error, because every other behaviour is built on
 * top of the normalized signature.
 */
export function parseTabrixChooseContextInput(rawArgs: unknown): ParsedChooseContextInput {
  if (rawArgs === null || rawArgs === undefined) {
    throw new TabrixChooseContextInputError('missing arguments object');
  }
  if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new TabrixChooseContextInputError('arguments must be an object');
  }
  const args = rawArgs as Record<string, unknown>;

  const rawIntent = readString(args, 'intent');
  if (rawIntent === undefined) {
    throw new TabrixChooseContextInputError("'intent' is required");
  }
  const trimmedIntent = rawIntent.trim();
  if (trimmedIntent.length === 0) {
    throw new TabrixChooseContextInputError("'intent' must be a non-empty string");
  }
  const cappedIntent = trimmedIntent.slice(0, MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS);
  const intentSignature = normalizeIntentSignature(cappedIntent);
  if (intentSignature.length === 0) {
    throw new TabrixChooseContextInputError("'intent' normalized to an empty signature");
  }

  let url: string | undefined;
  const rawUrl = readString(args, 'url');
  if (rawUrl !== undefined) {
    const trimmedUrl = rawUrl.trim();
    if (trimmedUrl.length > 0) {
      url = trimmedUrl;
    }
  }

  let pageRole: string | undefined;
  const rawPageRole = readString(args, 'pageRole');
  if (rawPageRole !== undefined) {
    const trimmedRole = rawPageRole.trim();
    if (trimmedRole.length > MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS) {
      throw new TabrixChooseContextInputError(
        `'pageRole' exceeds ${MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS} chars`,
      );
    }
    if (trimmedRole.length > 0) {
      pageRole = trimmedRole;
    }
  }

  let siteId: TabrixContextSiteFamily | undefined;
  const rawSiteId = readString(args, 'siteId');
  if (rawSiteId !== undefined) {
    const trimmedSite = rawSiteId.trim().toLowerCase();
    if (trimmedSite === 'github') {
      siteId = 'github';
    }
    // Any other token is ignored on purpose (see doc §3.1).
  }

  return {
    input: {
      intent: cappedIntent,
      url,
      pageRole,
      siteId,
    },
    intentSignature,
  };
}

/**
 * Derive a `siteFamily` from an explicit `siteId` (highest precedence)
 * or, failing that, from the URL host. Returns `undefined` for any
 * unrecognised host so the chooser can fall through to
 * `read_page_required`.
 *
 * v1 GitHub-first rules:
 *   - exact host `github.com` → `'github'`
 *   - any subdomain ending in `.github.com` (`api`, `gist`, `raw`,
 *     etc.) → `'github'`
 *   - everything else → `undefined`
 */
export function resolveSiteFamily(
  input: TabrixChooseContextInput,
): TabrixContextSiteFamily | undefined {
  if (input.siteId === 'github') return 'github';
  if (!input.url) return undefined;
  let host: string;
  try {
    host = new URL(input.url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  return undefined;
}

/**
 * Pure facts the chooser routes over. Keeps `chooseContextStrategy`
 * trivially testable without standing up an `ExperienceQueryService`
 * or a SQLite handle.
 */
export interface ChooseContextFacts {
  intentSignature: string;
  pageRole?: string;
  siteFamily?: TabrixContextSiteFamily;
  /**
   * Best surviving Experience plan (i.e. one whose computed
   * `successRate >= EXPERIENCE_HIT_MIN_SUCCESS_RATE`). `undefined` when
   * either no plan was returned or all returned plans were below the
   * threshold.
   */
  experienceHit?: {
    actionPathId: string;
    successRate: number;
    successCount: number;
    failureCount: number;
    /**
     * V24-01 / B-EXP-REPLAY-V1: when true the chooser routes the
     * experience hit through the new `experience_replay` strategy
     * instead of `experience_reuse`. Eligibility is the AND of:
     *   - the `experience_replay` capability is enabled,
     *   - the row's `pageRole` is in
     *     `TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES`,
     *   - every step's `toolName` is in
     *     `TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS`,
     *   - the row's `successRate >= EXPERIENCE_HIT_MIN_SUCCESS_RATE`
     *     (already true if `experienceHit` exists).
     * V24-03 widens the AND set with the stricter
     * `EXPERIENCE_REPLAY_MIN_SUCCESS_RATE` /
     * `EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT` thresholds; the legacy
     * `experience_reuse` gate (`EXPERIENCE_HIT_MIN_SUCCESS_RATE`) is
     * unchanged.
     */
    replayEligible?: boolean;
  };
  /**
   * V24-03 — ranked replay candidates surfaced as a single
   * `experience_ranked` artifact. Populated whenever the chooser
   * has Experience rows in scope (regardless of which strategy it
   * ultimately picks); empty when no rows came back. The ordering
   * is the deterministic ranking from `rankExperienceCandidates`.
   */
  rankedReplayCandidates?: TabrixChooseContextRankedCandidate[];
  /**
   * V24-03 — first reason the top-1 ranked candidate was refused
   * routing to `experience_replay`. `'none'` when the chooser
   * actually picked `experience_replay`; absent when the chooser
   * never had a candidate to consider.
   */
  rankedTopBlockedBy?: ReplayEligibilityBlockReason;
  /**
   * Knowledge catalog summary, populated only when the capability gate
   * is on AND there is at least one captured endpoint for the resolved
   * site family. Empty / missing array means "do not pick
   * `knowledge_light`".
   */
  knowledgeCatalog?: {
    site: string;
    totalEndpoints: number;
    sampleSignatures: string[];
  };
}

interface StrategyDecision {
  strategy: ContextStrategyName;
  fallbackStrategy?: ContextStrategyName;
  reasoning: string;
  artifacts: TabrixChooseContextArtifact[];
  /** V24-03 — first eligibility blocker for the top-1 candidate (if any). */
  replayEligibleBlockedBy?: ReplayEligibilityBlockReason;
  /** V24-03 — chooser-side fallback depth (`0` when a candidate surfaced; `'cold'` otherwise). */
  replayFallbackDepth: 0 | 'cold';
  /** V24-03 — number of candidates in the ranked artifact. */
  rankedCandidateCount: number;
}

/**
 * Pure decision: facts → strategy + artifacts. Branches in the order
 * documented in `B_018_CONTEXT_SELECTOR_V1.md` §5; do NOT re-order
 * without updating the doc + the strategy-set guard test.
 */
export function chooseContextStrategy(facts: ChooseContextFacts): StrategyDecision {
  // V24-03: when the chooser has ranked replay candidates available we
  // ALWAYS surface them as a single `experience_ranked` artifact, even
  // on the `experience_reuse` downgrade branch. This keeps post-mortem
  // analysis grouped by `rankedCandidateCount` regardless of which
  // strategy we pick. `rankedCandidateCount === 0` when no candidates
  // surfaced (no Experience rows OR the legacy `experienceHit` path
  // was taken with no ranking input).
  const rankedCandidates = facts.rankedReplayCandidates ?? [];
  const rankedCandidateCount = rankedCandidates.length;
  const replayFallbackDepth: 0 | 'cold' = rankedCandidateCount > 0 ? 0 : 'cold';

  if (facts.experienceHit) {
    const hit = facts.experienceHit;
    // V24-01: route the hit to `experience_replay` only when the
    // capability + step-kind allowlist + GitHub pageRole gates all
    // pass. The fallback chain is `experience_reuse → read_page_required`
    // (NOT directly to `read_page_required`); replay's failure mode is
    // a per-step abort, after which the reusing branch can still try
    // the recorded plan as plain advice instead of dispatched steps.
    if (hit.replayEligible) {
      const top = rankedCandidates[0];
      const topScoreLabel = top !== undefined ? ` topScore=${top.score.toFixed(3)}` : '';
      const reasoning =
        `experience replay: actionPath=${hit.actionPathId}, ` +
        `successRate=${hit.successRate.toFixed(2)} ` +
        `(>= ${EXPERIENCE_HIT_MIN_SUCCESS_RATE.toFixed(2)});` +
        `${topScoreLabel} ranked=${rankedCandidateCount}; ` +
        `experience_replay capability enabled; all step kinds + pageRole supported in v1`;
      return {
        strategy: 'experience_replay',
        fallbackStrategy: 'experience_reuse',
        reasoning,
        artifacts:
          rankedCandidateCount > 0
            ? [
                {
                  kind: 'experience_ranked',
                  ref: hit.actionPathId,
                  summary:
                    `Experience action path ${hit.actionPathId} ` +
                    `(${hit.successCount} ok / ${hit.failureCount} fail) — replay-eligible; ` +
                    `${rankedCandidateCount} ranked candidate(s)`,
                  ranked: rankedCandidates,
                },
              ]
            : [
                {
                  kind: 'experience',
                  ref: hit.actionPathId,
                  summary:
                    `Experience action path ${hit.actionPathId} ` +
                    `(${hit.successCount} ok / ${hit.failureCount} fail) — replay-eligible`,
                },
              ],
        replayEligibleBlockedBy: 'none',
        replayFallbackDepth,
        rankedCandidateCount,
      };
    }

    const reasoning =
      `experience hit: actionPath=${hit.actionPathId}, ` +
      `successRate=${hit.successRate.toFixed(2)} ` +
      `(>= ${EXPERIENCE_HIT_MIN_SUCCESS_RATE.toFixed(2)})` +
      (rankedCandidateCount > 0
        ? `; ranked=${rankedCandidateCount} (top blocked by ${facts.rankedTopBlockedBy ?? 'unknown'})`
        : '');
    return {
      strategy: 'experience_reuse',
      fallbackStrategy: 'read_page_required',
      reasoning,
      artifacts:
        rankedCandidateCount > 0
          ? [
              {
                kind: 'experience_ranked',
                ref: hit.actionPathId,
                summary:
                  `Experience action path ${hit.actionPathId} ` +
                  `(${hit.successCount} ok / ${hit.failureCount} fail); ` +
                  `${rankedCandidateCount} ranked candidate(s)`,
                ranked: rankedCandidates,
              },
            ]
          : [
              {
                kind: 'experience',
                ref: hit.actionPathId,
                summary:
                  `Experience action path ${hit.actionPathId} ` +
                  `(${hit.successCount} ok / ${hit.failureCount} fail)`,
              },
            ],
      replayEligibleBlockedBy: facts.rankedTopBlockedBy,
      replayFallbackDepth,
      rankedCandidateCount,
    };
  }

  if (facts.knowledgeCatalog && facts.knowledgeCatalog.totalEndpoints > 0) {
    const cat = facts.knowledgeCatalog;
    const sample = cat.sampleSignatures.slice(0, KNOWLEDGE_LIGHT_SAMPLE_LIMIT);
    const summary =
      `Captured ${cat.totalEndpoints} endpoint(s) on ${cat.site}; ` +
      `sample: ${sample.join(' | ')}`;
    return {
      strategy: 'knowledge_light',
      fallbackStrategy: 'read_page_required',
      reasoning:
        `no experience match; api_knowledge gate on; ` +
        `${cat.totalEndpoints} captured endpoint(s) on ${cat.site}. ` +
        `Tabrix v1 does NOT call site APIs — use the catalog as shape evidence only.`,
      artifacts: [
        {
          kind: 'knowledge_api',
          ref: cat.site,
          summary,
        },
      ],
      replayFallbackDepth,
      rankedCandidateCount,
    };
  }

  // V23-04 / B-018 v1.5: text-heavy GitHub reading branch.
  //
  // When (a) no experience hit, (b) no usable api_knowledge match,
  // (c) the resolved siteFamily is `'github'`, and (d) the pageRole
  // is on the hand-curated `MARKDOWN_FRIENDLY_PAGE_ROLES` whitelist,
  // we route to `read_page_markdown` (B-015 / V23-03). This is a
  // *reading* surface — the JSON HVOs / candidateActions /
  // `targetRef` stay the execution truth. The chooser only signals
  // that the markdown projection is the cheaper way to read this
  // page; the caller is still expected to fall back to
  // `read_page_required` if it has to act on the result.
  //
  // We deliberately gate on `siteFamily === 'github'` rather than on
  // pageRole alone because the whitelist tokens
  // (`issue_detail`, `pull_request_detail`, `wiki`, …) are GitHub-specific
  // labels emitted by `read-page-understanding-github.ts`. Routing
  // markdown for a non-GitHub site that happens to share a pageRole
  // string would mis-route a page whose understanding layer has not
  // been audited yet.
  if (
    facts.siteFamily === 'github' &&
    facts.pageRole &&
    MARKDOWN_FRIENDLY_PAGE_ROLES.includes(facts.pageRole)
  ) {
    return {
      strategy: 'read_page_markdown',
      fallbackStrategy: 'read_page_required',
      reasoning:
        `no experience match and no usable api_knowledge; ` +
        `pageRole='${facts.pageRole}' is on the markdown-friendly GitHub whitelist — ` +
        `prefer read_page(render='markdown') as a reading surface, fall back to read_page (json) for execution.`,
      artifacts: [
        {
          kind: 'read_page',
          ref: `markdown:${facts.pageRole}`,
          summary: `Use chrome_read_page(render='markdown') for this ${facts.pageRole} page.`,
        },
      ],
      replayFallbackDepth,
      rankedCandidateCount,
    };
  }

  return {
    strategy: 'read_page_required',
    reasoning: 'no experience match and no usable api_knowledge — fall back to read_page (json)',
    artifacts: [],
    replayFallbackDepth,
    rankedCandidateCount,
  };
}

// ---------------------------------------------------------------------------
// V25-02 — pure intent classifier for layer dispatch
// ---------------------------------------------------------------------------

/**
 * V25-02: bucket the free-text `intent` into the closed
 * {@link LayerDispatchUserIntentHint} enum. Pure function — uses
 * regex/keyword scans only, no Memory / Knowledge / network. Order
 * mirrors the V25-02 Strategy Table priority-2 row block; a hit on a
 * higher-priority bucket short-circuits.
 *
 * `'unknown'` means the dispatcher should fall through to task type /
 * page complexity. We never invent a bucket from the intent string.
 */
export function classifyIntentForLayerDispatch(intent: string): LayerDispatchUserIntentHint {
  if (typeof intent !== 'string' || intent.trim().length === 0) return 'unknown';
  const normalized = intent.toLowerCase();
  // priority 2.1 — summary / overview / gist / "what is this page"
  if (
    /(总结|重点|摘要|概要|简述)/.test(intent) ||
    /\b(overview|gist|summary|summari[sz]e|what\s+is\s+this\s+page|main\s+entry\s+points?)\b/.test(
      normalized,
    )
  ) {
    return 'summary';
  }
  // priority 2.4 — details / logs / tables / compare / debug / row-level inspection
  if (
    /(展开细看|详细|详情|展开|细节|对比|对照|调试)/.test(intent) ||
    /\b(detail|details|drill\s*into|expand|logs?|tables?|evidence|compare|diff|debug|row[- ]level|inspect)\b/.test(
      normalized,
    )
  ) {
    return 'details';
  }
  // priority 2.3 — fill / search / submit / replay / form-like
  if (
    /(填写|提交|搜索|查询|表单|回放|重放|重播)/.test(intent) ||
    /\b(fill|search|submit|replay|form|input)\b/.test(normalized)
  ) {
    return 'form_or_submit';
  }
  // priority 2.2 — open / click / select a specific entry
  if (
    /(打开|点击|进入|选择|去到|跳转)/.test(intent) ||
    /\b(open|click|select|find|go\s+to|navigate)\b/.test(normalized)
  ) {
    return 'open_or_select';
  }
  return 'unknown';
}

/**
 * V25-02: derive task-type bucket from the user intent classification.
 * Exposed as a separate helper so unit tests can pin the matrix
 * without re-running the classifier. Pure function.
 */
export function deriveTaskTypeForLayerDispatch(
  hint: LayerDispatchUserIntentHint,
): LayerDispatchTaskType {
  switch (hint) {
    case 'summary':
      return 'reading_only';
    case 'details':
      return 'reading_only';
    case 'open_or_select':
      return 'action';
    case 'form_or_submit':
      return 'action';
    case 'unknown':
    default:
      return 'unknown';
  }
}

/**
 * V24-03: pick the legacy `experienceHit` shape from the top-1 ranked
 * candidate, applying the legacy `EXPERIENCE_HIT_MIN_SUCCESS_RATE`
 * gate so the existing `experience_reuse` branch keeps its v1.5
 * threshold behaviour. Replay eligibility is the strict V24-03 AND
 * (the row's eligibility result is already in `topReplayEligible`).
 *
 * Returns `undefined` when no row is above the legacy threshold; the
 * chooser then falls through to `knowledge_light` / markdown / read.
 */
function projectExperienceHit(
  topRow: ExperienceActionPathRow | undefined,
  topReplayEligible: boolean,
): ChooseContextFacts['experienceHit'] {
  if (!topRow) return undefined;
  const total = topRow.successCount + topRow.failureCount;
  const rate = total > 0 ? topRow.successCount / total : 0;
  if (rate < EXPERIENCE_HIT_MIN_SUCCESS_RATE) return undefined;
  return {
    actionPathId: topRow.actionPathId,
    successRate: rate,
    successCount: topRow.successCount,
    failureCount: topRow.failureCount,
    replayEligible: topReplayEligible,
  };
}

export interface RunTabrixChooseContextDeps {
  experience: Pick<ExperienceQueryService, 'suggestActionPaths'> | null;
  knowledgeApi: Pick<KnowledgeApiRepository, 'listBySite' | 'countAll'> | null;
  capabilityEnv: CapabilityEnv;
  /**
   * V23-04 / B-018 v1.5 — telemetry write-back. `null` means
   * "telemetry disabled" (persistence off, or the wiring opted out
   * for a particular caller). The chooser still returns a usable
   * result; it just omits `decisionId` so the caller knows there is
   * no row to point `tabrix_choose_context_record_outcome` at.
   */
  telemetry?: ChooseContextTelemetryRepository | null;
  /**
   * V26-04 (B-027) — honest dispatcher inputs. When provided, the
   * chooser asks the provider for `{candidateActionsCount, hvoCount,
   * fullReadByteLength, pageRole}` instead of feeding the dispatcher
   * literal zeros. When `undefined` or `null`, behaviour is
   * bit-identical to v2.5: zeros in, `dispatcher_input_source` and
   * `fallback_cause_v26` left `null` in telemetry. This is the
   * fail-soft adoption path the V4.1 plan §11 requires.
   */
  pageContext?: PageContextProvider | null;
  /**
   * Test seam for deterministic ids / clocks. Defaults to
   * `randomUUID` and `() => new Date().toISOString()`.
   */
  newDecisionId?: () => string;
  now?: () => string;
}

/**
 * IO orchestrator: validates the args, fetches the two facts (best
 * Experience plan + knowledge catalog snapshot), and routes through
 * the pure chooser. Always returns a `TabrixChooseContextResult` — the
 * caller wraps it into the MCP `CallToolResult` envelope.
 *
 * Capability handling: when `api_knowledge` is NOT enabled we never
 * read the knowledge repository at all, so an operator who has not
 * opted in pays no cost AND cannot accidentally surface
 * `knowledge_light` even if rows exist from a prior run.
 */
export function runTabrixChooseContext(
  rawArgs: unknown,
  deps: RunTabrixChooseContextDeps,
): TabrixChooseContextResult {
  let parsed: ParsedChooseContextInput;
  try {
    parsed = parseTabrixChooseContextInput(rawArgs);
  } catch (error) {
    if (error instanceof TabrixChooseContextInputError) {
      return {
        status: 'invalid_input',
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }

  const { input, intentSignature } = parsed;
  const siteFamily = resolveSiteFamily(input);

  // V24-03: chooser-side ranking. We always do the single
  // `experience.suggestActionPaths` read (the Memory-not-read invariant
  // applies to per-step Memory tables, NOT to this aggregator-only
  // query). The ranked list, eligibility blocker and top-1 row all
  // come from the pure ranking module so tests can pin the matrix
  // without standing up the full IO orchestrator.
  const nowIso = (deps.now ?? (() => new Date().toISOString()))();
  let experienceHit: ChooseContextFacts['experienceHit'];
  let rankedReplayCandidates: TabrixChooseContextRankedCandidate[] | undefined;
  let rankedTopBlockedBy: ReplayEligibilityBlockReason | undefined;
  if (deps.experience) {
    const rows = deps.experience.suggestActionPaths({
      intent: input.intent,
      intentSignature,
      pageRole: input.pageRole,
      limit: EXPERIENCE_LOOKUP_LIMIT,
    });
    const ranking = rankExperienceCandidates({
      rows,
      capabilityEnabled: isCapabilityEnabled('experience_replay', deps.capabilityEnv),
      nowIso,
      pageRole: input.pageRole,
    });
    if (ranking.ranked.length > 0) {
      rankedReplayCandidates = ranking.ranked;
      rankedTopBlockedBy = ranking.topBlockedBy;
    }
    experienceHit = projectExperienceHit(ranking.topRow, ranking.topReplayEligible);
  }

  let knowledgeCatalog: ChooseContextFacts['knowledgeCatalog'];
  const apiCandidate = isCapabilityEnabled('api_knowledge', deps.capabilityEnv)
    ? resolveApiKnowledgeCandidate({
        intent: input.intent,
        url: input.url,
        pageRole: input.pageRole,
      })
    : null;
  // Only consult Knowledge when (a) no experience hit, (b) a recognised
  // site family is in scope, (c) the api_knowledge capability is on,
  // and (d) the repo handle exists. Each of these gates is a real
  // failure mode of the v1 surface, not a paranoia check.
  if (!experienceHit && siteFamily === 'github' && deps.knowledgeApi) {
    if (isCapabilityEnabled('api_knowledge', deps.capabilityEnv)) {
      // v1 site-family → site mapping is exact: the only GitHub host
      // we capture under B-017 is `api.github.com`. Widening this
      // requires touching the capture seed in lockstep — see
      // `app/native-server/src/memory/knowledge/api-knowledge-capture.ts`.
      const site = 'api.github.com';
      const rows = deps.knowledgeApi.listBySite(site, KNOWLEDGE_LIGHT_SAMPLE_LIMIT);
      if (rows.length > 0) {
        // We intentionally use the row count of `listBySite` (capped
        // by `KNOWLEDGE_LIGHT_SAMPLE_LIMIT`) as `totalEndpoints` for
        // v1. A precise total would require either a dedicated SELECT
        // COUNT or another method on the repo; the cap-bounded number
        // is good enough to prove the catalog is non-empty without
        // adding a new repository surface.
        knowledgeCatalog = {
          site,
          totalEndpoints: rows.length,
          sampleSignatures: rows.map((r) => r.endpointSignature),
        };
      }
    }
  }
  if (!experienceHit && !knowledgeCatalog && apiCandidate) {
    knowledgeCatalog = {
      site: apiCandidate.endpointFamily,
      totalEndpoints: 1,
      sampleSignatures: [apiCandidate.endpointFamily],
    };
  }

  const decision = chooseContextStrategy({
    intentSignature,
    pageRole: input.pageRole,
    siteFamily,
    experienceHit,
    knowledgeCatalog,
    rankedReplayCandidates,
    rankedTopBlockedBy,
  });

  // V25-02: layer dispatcher — runs once per chooser decision after
  // the strategy is picked. The dispatcher is pure (no IO) so this
  // adds zero hot-path Memory traffic. We feed it the same facts the
  // strategy used so rule alignment is auditable from telemetry.
  //
  // V26-04 (B-027): honest dispatcher inputs. When the caller wired
  // a `PageContextProvider`, the dispatcher receives real
  // candidateActions / HVO counts + fullReadByteLength drawn from the
  // most recent matching `memory_page_snapshots` row instead of
  // hard-coded zeros. The provider call itself is read-only and
  // never throws (it returns a `fallback_zero` shape on any error)
  // so the chooser hot-path stays safe. When the provider is absent
  // (test stubs / persistence off / pre-V26-04 callers) we keep the
  // historical zero-input behaviour bit-for-bit and leave
  // `dispatcherInputSource` / `fallbackCauseV26` `null` in telemetry.
  const intentHint = classifyIntentForLayerDispatch(input.intent);
  const dispatcherInputs = deps.pageContext
    ? deps.pageContext.getContext({
        url: input.url ?? null,
        pageRole: input.pageRole ?? null,
      })
    : null;
  const layerDispatch = dispatchLayer({
    pageRole: input.pageRole ?? null,
    userIntent: intentHint,
    taskType: deriveTaskTypeForLayerDispatch(intentHint),
    candidateActionsCount: dispatcherInputs?.candidateActionsCount ?? 0,
    hvoCount: dispatcherInputs?.hvoCount ?? 0,
    knowledgeAvailable: !!knowledgeCatalog && knowledgeCatalog.totalEndpoints > 0,
    searchListIntent: !!apiCandidate,
    experienceReplayAvailable: decision.strategy === 'experience_replay',
    safetyRequiresFullLayers: false,
    fullReadByteLength: dispatcherInputs?.fullReadByteLength ?? 0,
  });
  const tokensSavedEstimate = Math.max(
    0,
    layerDispatch.fullReadTokenEstimate - layerDispatch.tokenEstimate,
  );
  const routerDecision = routeDataSource({
    strategy: decision.strategy,
    sourceRoute: layerDispatch.sourceRoute,
    chosenLayer: layerDispatch.chosenLayer,
    layerDispatchReason: layerDispatch.reason,
    tokenEstimateChosen: layerDispatch.tokenEstimate,
    tokenEstimateFullRead: layerDispatch.fullReadTokenEstimate,
    tokensSavedEstimate,
    apiCandidateAvailable: !!apiCandidate,
    dispatcherInputSource: dispatcherInputs?.source ?? null,
  });
  const knowledgeEndpointFamily =
    siteFamily === 'github' && knowledgeCatalog ? 'github.api.github.com' : null;

  // V23-04 / B-018 v1.5 — telemetry write-back. We attempt to record
  // the decision ONLY when telemetry is wired and we have a usable
  // result to record. Failures here MUST NOT poison the chooser
  // result: a SQLite write that throws (disk full, locked DB, …)
  // becomes a missing `decisionId` field, not a tool error. The
  // caller treats "no decisionId" the same as "telemetry off".
  //
  // V24-03 closeout: the new ranked / blocker / fallback-depth fields
  // are intentionally NOT persisted to `tabrix_choose_context_decisions`
  // in v2.4. The v2.3 telemetry table schema stays frozen so the
  // existing release gate cannot regress; long-term ranked-depth
  // statistics are deferred to v2.5 (see plan §2.3 telemetry note).
  let decisionId: string | undefined;
  if (deps.telemetry) {
    const newId = deps.newDecisionId ?? randomUUID;
    const candidateId = newId();
    try {
      deps.telemetry.recordDecision({
        decisionId: candidateId,
        intentSignature,
        pageRole: input.pageRole ?? null,
        siteFamily: siteFamily ?? null,
        strategy: decision.strategy,
        fallbackStrategy: decision.fallbackStrategy ?? null,
        createdAt: nowIso,
        // V25-02 layer-dispatch telemetry
        chosenLayer: layerDispatch.chosenLayer,
        layerDispatchReason: layerDispatch.reason,
        sourceRoute: layerDispatch.sourceRoute,
        fallbackCause: layerDispatch.fallbackCause ?? null,
        tokenEstimateChosen: layerDispatch.tokenEstimate,
        tokenEstimateFullRead: layerDispatch.fullReadTokenEstimate,
        tokensSavedEstimate,
        knowledgeEndpointFamily,
        // V25-02 (M2 binding) — V24-03 ranked-replay audit fields
        rankedCandidateCount: decision.rankedCandidateCount ?? null,
        replayEligibleBlockedBy: decision.replayEligibleBlockedBy ?? null,
        replayFallbackDepth: decision.replayFallbackDepth ?? null,
        // V26-04 (B-027): honest dispatcher input source. `null` when
        // no `pageContext` provider was wired (preserves the v25
        // null-everywhere telemetry shape for legacy callers and
        // tests). Otherwise records the closed-enum source the
        // provider returned plus its `fallbackCause` only on the
        // `fallback_zero` branch.
        dispatcherInputSource: dispatcherInputs?.source ?? null,
        fallbackCauseV26:
          dispatcherInputs && dispatcherInputs.source === 'fallback_zero'
            ? (dispatcherInputs.fallbackCause ?? null)
            : null,
      });
      decisionId = candidateId;
    } catch (error) {
      // Same swallow-and-warn pattern as other Memory writes
      // (`PageSnapshotService` etc.). The chooser surface is
      // user-facing; telemetry breakage must not break the user-facing
      // call.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[tabrix/choose-context] telemetry recordDecision failed: ${message}`);
    }
  }

  const result: TabrixChooseContextResultWithRouter = {
    status: 'ok',
    strategy: decision.strategy,
    fallbackStrategy: decision.fallbackStrategy,
    reasoning: decision.reasoning,
    artifacts: decision.artifacts,
    resolved: {
      intentSignature,
      pageRole: input.pageRole,
      siteFamily,
    },
    decisionId,
    rankedCandidateCount: decision.rankedCandidateCount,
    replayEligibleBlockedBy: decision.replayEligibleBlockedBy,
    replayFallbackDepth: decision.replayFallbackDepth,
    // V25-02 layer-dispatch fields. Always present; safe defaults so
    // callers built before V25-02 still type-check.
    chosenLayer: layerDispatch.chosenLayer,
    layerDispatchReason: layerDispatch.reason,
    sourceRoute: layerDispatch.sourceRoute,
    fallbackCause: layerDispatch.fallbackCause ?? undefined,
    tokenEstimateChosen: layerDispatch.tokenEstimate,
    tokenEstimateFullRead: layerDispatch.fullReadTokenEstimate,
    tokensSavedEstimate,
    readPageAvoided: layerDispatch.sourceRoute === 'experience_replay_skip_read',
    chosenSource: routerDecision.chosenSource,
    dataSource: routerDecision.dataSource,
    routerConfidence: routerDecision.confidence,
    routerRiskTier: routerDecision.riskTier,
    decisionReason: routerDecision.decisionReason,
    fallbackPlan: routerDecision.fallbackPlan,
    dispatcherInputSource: routerDecision.dispatcherInputSource,
    costEstimate: routerDecision.costEstimate,
  };
  return result;
}

// ---------------------------------------------------------------------------
// V23-04 / B-018 v1.5 — `tabrix_choose_context_record_outcome`
// ---------------------------------------------------------------------------

const OUTCOME_VALUES: readonly TabrixChooseContextOutcome[] = [
  'reuse',
  'fallback',
  'completed',
  'retried',
];

const MAX_DECISION_ID_CHARS = 128;

function isOutcome(value: unknown): value is TabrixChooseContextOutcome {
  return typeof value === 'string' && (OUTCOME_VALUES as readonly string[]).includes(value);
}

interface ParsedRecordOutcomeInput {
  decisionId: string;
  outcome: TabrixChooseContextOutcome;
}

/**
 * Validate raw MCP arguments for `tabrix_choose_context_record_outcome`.
 * Mirrors the strictness of `parseTabrixChooseContextInput`:
 *   - missing / non-string `decisionId` → invalid_input
 *   - empty / over-cap `decisionId` → invalid_input
 *   - missing / out-of-set `outcome` → invalid_input
 * The schema in `tools.ts` already enforces most of this client-side,
 * but the runner duplicates the checks because the MCP host is
 * untrusted.
 */
function parseRecordOutcomeInput(rawArgs: unknown): ParsedRecordOutcomeInput {
  if (rawArgs === null || rawArgs === undefined) {
    throw new TabrixChooseContextInputError('missing arguments object');
  }
  if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new TabrixChooseContextInputError('arguments must be an object');
  }
  const args = rawArgs as Record<string, unknown>;

  const rawDecisionId = readString(args, 'decisionId');
  if (rawDecisionId === undefined) {
    throw new TabrixChooseContextInputError("'decisionId' is required");
  }
  const decisionId = rawDecisionId.trim();
  if (decisionId.length === 0) {
    throw new TabrixChooseContextInputError("'decisionId' must be a non-empty string");
  }
  if (decisionId.length > MAX_DECISION_ID_CHARS) {
    throw new TabrixChooseContextInputError(`'decisionId' exceeds ${MAX_DECISION_ID_CHARS} chars`);
  }

  const rawOutcome = args.outcome;
  if (!isOutcome(rawOutcome)) {
    throw new TabrixChooseContextInputError(
      "'outcome' must be one of: reuse | fallback | completed | retried",
    );
  }

  return { decisionId, outcome: rawOutcome };
}

export interface RunTabrixChooseContextRecordOutcomeDeps {
  telemetry: ChooseContextTelemetryRepository | null;
  now?: () => string;
}

/**
 * Outcome write-back orchestrator. Always returns a structured
 * `TabrixChooseContextRecordOutcomeResult`:
 *   - `'invalid_input'` for malformed args (input type or value)
 *   - `'unknown_decision'` for valid args whose decisionId we don't
 *     have a row for (telemetry off / decision pruned / id typo)
 *   - `'ok'` after a successful append
 *
 * The handler in `native-tool-handlers.ts` maps `'invalid_input'`
 * to `isError: true` so the MCP host can surface it; `'unknown_decision'`
 * is NOT an error — it is a legitimate "telemetry lost" status the
 * caller can branch on.
 */
export function runTabrixChooseContextRecordOutcome(
  rawArgs: unknown,
  deps: RunTabrixChooseContextRecordOutcomeDeps,
): TabrixChooseContextRecordOutcomeResult {
  let parsed: ParsedRecordOutcomeInput;
  try {
    parsed = parseRecordOutcomeInput(rawArgs);
  } catch (error) {
    if (error instanceof TabrixChooseContextInputError) {
      return {
        status: 'invalid_input',
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }

  if (!deps.telemetry) {
    // Telemetry off: every previously-issued decisionId is by
    // definition unknown because we never persisted it. We treat this
    // as `unknown_decision` (not invalid_input) so the caller branches
    // the same way as "decision id we forgot about".
    return {
      status: 'unknown_decision',
      decisionId: parsed.decisionId,
      outcome: parsed.outcome,
    };
  }

  const now = deps.now ?? (() => new Date().toISOString());
  let result;
  try {
    result = deps.telemetry.recordOutcome({
      decisionId: parsed.decisionId,
      outcome: parsed.outcome,
      recordedAt: now(),
    });
  } catch (error) {
    // Same swallow-and-warn discipline as the chooser: telemetry
    // breakage MUST NOT escalate to a tool error. We surface
    // `unknown_decision` so the caller does not retry forever and the
    // failure is visible in the warning log.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[tabrix/choose-context] telemetry recordOutcome failed: ${message}`);
    return {
      status: 'unknown_decision',
      decisionId: parsed.decisionId,
      outcome: parsed.outcome,
    };
  }

  if (result.status === 'unknown_decision') {
    return {
      status: 'unknown_decision',
      decisionId: parsed.decisionId,
      outcome: parsed.outcome,
    };
  }

  return {
    status: 'ok',
    decisionId: parsed.decisionId,
    outcome: parsed.outcome,
  };
}
