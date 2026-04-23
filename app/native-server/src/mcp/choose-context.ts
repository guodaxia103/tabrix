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
  TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES,
  TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS,
  type ContextStrategyName,
  type TabrixChooseContextArtifact,
  type TabrixChooseContextInput,
  type TabrixChooseContextOutcome,
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
import { extractPortableReplayArgs } from './experience-replay-args';

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
     * v1 keeps the branch narrow on purpose: ranked-candidates and
     * fallback ladders are V24-03's job, not this PR's.
     */
    replayEligible?: boolean;
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
    // V24-01: route the hit to `experience_replay` only when the
    // capability + step-kind allowlist + GitHub pageRole gates all
    // pass. The fallback chain is `experience_reuse → read_page_required`
    // (NOT directly to `read_page_required`); replay's failure mode is
    // a per-step abort, after which the reusing branch can still try
    // the recorded plan as plain advice instead of dispatched steps.
    if (hit.replayEligible) {
      const reasoning =
        `experience replay: actionPath=${hit.actionPathId}, ` +
        `successRate=${hit.successRate.toFixed(2)} ` +
        `(>= ${EXPERIENCE_HIT_MIN_SUCCESS_RATE.toFixed(2)}); ` +
        `experience_replay capability enabled; all step kinds + pageRole supported in v1`;
      return {
        strategy: 'experience_replay',
        fallbackStrategy: 'experience_reuse',
        reasoning,
        artifacts: [
          {
            kind: 'experience',
            ref: hit.actionPathId,
            summary:
              `Experience action path ${hit.actionPathId} ` +
              `(${hit.successCount} ok / ${hit.failureCount} fail) — replay-eligible`,
          },
        ],
      };
    }

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
function pickExperienceHit(
  rows: ExperienceActionPathRow[],
  options: { replayCapabilityEnabled: boolean },
): ChooseContextFacts['experienceHit'] {
  let best: ChooseContextFacts['experienceHit'];
  let bestRow: ExperienceActionPathRow | undefined;
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
      bestRow = row;
      bestRate = rate;
      bestSuccess = row.successCount;
    }
  }

  if (best && bestRow) {
    best.replayEligible = isReplayEligible(bestRow, options.replayCapabilityEnabled);
  }
  return best;
}

/**
 * V24-01 / Brief §8.1 strategy guard. The chooser may only route a
 * row to `experience_replay` when:
 *   1. the operator has opted into the `experience_replay` capability,
 *   2. the row's `pageRole` is in the v1 GitHub-only allowlist,
 *   3. every step's `toolName` is in the v1 supported step-kind set, AND
 *   4. every step's persisted `args` are PORTABLE across sessions
 *      under the per-tool allowlist in
 *      `experience-replay-args.ts::extractPortableReplayArgs`.
 *
 * Why "portable", not just "non-empty": an earlier closeout of this
 * function only checked that `step.args` existed and had >= 1 key.
 * Codex's follow-up review pointed out that an aggregator written
 * before the portability work could happily persist
 * `{ tabId: 7, ref: 'ref_xyz' }` (well-formed JSON, non-empty) and
 * the chooser would route it to `experience_replay`; the engine
 * would then either click the wrong element in the operator's tab
 * or hit a dead per-snapshot ref. The portability check is the
 * actual safety property - "non-empty" was a proxy for it.
 *
 * Any failure (capability off, wrong pageRole, unsupported step
 * kind, OR `extractPortableReplayArgs(...)` returns `undefined` for
 * any step) keeps the row on the existing `experience_reuse` branch:
 * the recorded plan still advises the upstream LLM, just without
 * Tabrix-side dispatch.
 */
function isReplayEligible(row: ExperienceActionPathRow, capabilityEnabled: boolean): boolean {
  if (!capabilityEnabled) return false;
  if (!TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES.has(row.pageRole)) return false;
  if (row.stepSequence.length === 0) return false;
  for (const step of row.stepSequence) {
    if (!TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS.has(step.toolName)) return false;
    // Defense in depth: even if the aggregator persisted args, those
    // args MUST satisfy the same portability rules the aggregator
    // applies on write. A `ref_*` targetRef that somehow slipped past
    // (manual SQL, older code path, future regression) gets caught
    // here and routed to `experience_reuse`.
    if (!extractPortableReplayArgs(step.toolName, step.args)) return false;
  }
  return true;
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
    experienceHit = pickExperienceHit(rows, {
      replayCapabilityEnabled: isCapabilityEnabled('experience_replay', deps.capabilityEnv),
    });
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

  // V23-04 / B-018 v1.5 — telemetry write-back. We attempt to record
  // the decision ONLY when telemetry is wired and we have a usable
  // result to record. Failures here MUST NOT poison the chooser
  // result: a SQLite write that throws (disk full, locked DB, …)
  // becomes a missing `decisionId` field, not a tool error. The
  // caller treats "no decisionId" the same as "telemetry off".
  let decisionId: string | undefined;
  if (deps.telemetry) {
    const newId = deps.newDecisionId ?? randomUUID;
    const now = deps.now ?? (() => new Date().toISOString());
    const candidateId = newId();
    try {
      deps.telemetry.recordDecision({
        decisionId: candidateId,
        intentSignature,
        pageRole: input.pageRole ?? null,
        siteFamily: siteFamily ?? null,
        strategy: decision.strategy,
        fallbackStrategy: decision.fallbackStrategy ?? null,
        createdAt: now(),
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
    decisionId,
  };
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
