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
 * NO side-effects of any kind: this module never writes to the DB,
 * never calls the bridge, never reads `process.env` directly. Tests
 * inject every dependency via `chooseContextStrategy` or the runner's
 * `deps` argument.
 */

import {
  EXPERIENCE_HIT_MIN_SUCCESS_RATE,
  EXPERIENCE_LOOKUP_LIMIT,
  KNOWLEDGE_LIGHT_SAMPLE_LIMIT,
  MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS,
  MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS,
  type ContextStrategyName,
  type TabrixChooseContextArtifact,
  type TabrixChooseContextInput,
  type TabrixChooseContextResult,
  type TabrixContextSiteFamily,
} from '@tabrix/shared';
import { isCapabilityEnabled } from '../policy/capabilities';
import type { CapabilityEnv } from '../policy/capabilities';
import { normalizeIntentSignature } from '../memory/experience/experience-aggregator';
import type { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import type { ExperienceQueryService } from '../memory/experience';
import type { ExperienceActionPathRow } from '../memory/experience/experience-repository';

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
  };
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
}

/**
 * Pure decision: facts → strategy + artifacts. Branches in the order
 * documented in `B_018_CONTEXT_SELECTOR_V1.md` §5; do NOT re-order
 * without updating the doc + the strategy-set guard test.
 */
export function chooseContextStrategy(facts: ChooseContextFacts): StrategyDecision {
  if (facts.experienceHit) {
    const hit = facts.experienceHit;
    const reasoning =
      `experience hit: actionPath=${hit.actionPathId}, ` +
      `successRate=${hit.successRate.toFixed(2)} ` +
      `(>= ${EXPERIENCE_HIT_MIN_SUCCESS_RATE.toFixed(2)})`;
    return {
      strategy: 'experience_reuse',
      fallbackStrategy: 'read_page_required',
      reasoning,
      artifacts: [
        {
          kind: 'experience',
          ref: hit.actionPathId,
          summary:
            `Experience action path ${hit.actionPathId} ` +
            `(${hit.successCount} ok / ${hit.failureCount} fail)`,
        },
      ],
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
    };
  }

  return {
    strategy: 'read_page_required',
    reasoning: 'no experience match and no usable api_knowledge — fall back to read_page (json)',
    artifacts: [],
  };
}

/**
 * Pick the best surviving plan from a list of `experience_suggest_plan`
 * rows: highest `successRate`, ties broken by `successCount`. Returns
 * `undefined` when every row is below the threshold.
 *
 * Mirrors the ordering `experience_suggest_plan` would have applied
 * server-side; we re-derive the rate here because the row carries raw
 * counts, not the projected DTO.
 */
function pickExperienceHit(rows: ExperienceActionPathRow[]): ChooseContextFacts['experienceHit'] {
  let best: ChooseContextFacts['experienceHit'];
  let bestRate = -1;
  let bestSuccess = -1;
  for (const row of rows) {
    const total = row.successCount + row.failureCount;
    const rate = total > 0 ? row.successCount / total : 0;
    if (rate < EXPERIENCE_HIT_MIN_SUCCESS_RATE) continue;
    if (rate > bestRate || (rate === bestRate && row.successCount > bestSuccess)) {
      best = {
        actionPathId: row.actionPathId,
        successRate: rate,
        successCount: row.successCount,
        failureCount: row.failureCount,
      };
      bestRate = rate;
      bestSuccess = row.successCount;
    }
  }
  return best;
}

export interface RunTabrixChooseContextDeps {
  experience: Pick<ExperienceQueryService, 'suggestActionPaths'> | null;
  knowledgeApi: Pick<KnowledgeApiRepository, 'listBySite' | 'countAll'> | null;
  capabilityEnv: CapabilityEnv;
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

  let experienceHit: ChooseContextFacts['experienceHit'];
  if (deps.experience) {
    // `ExperienceQueryService.suggestActionPaths` accepts the public
    // `ExperienceSuggestPlanInput` shape, which carries both raw
    // `intent` and the normalized `intentSignature`. The repository
    // only consumes the signature; passing both keeps us inside the
    // existing public contract without a private overload.
    const rows = deps.experience.suggestActionPaths({
      intent: input.intent,
      intentSignature,
      pageRole: input.pageRole,
      limit: EXPERIENCE_LOOKUP_LIMIT,
    });
    experienceHit = pickExperienceHit(rows);
  }

  let knowledgeCatalog: ChooseContextFacts['knowledgeCatalog'];
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

  const decision = chooseContextStrategy({
    intentSignature,
    pageRole: input.pageRole,
    siteFamily,
    experienceHit,
    knowledgeCatalog,
  });

  return {
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
  };
}
