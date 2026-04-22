/**
 * Tabrix MKEP Stage 3h — `tabrix_choose_context` v1 minimal slice (B-018).
 *
 * SoT for the public input/output contract is
 * [`docs/B_018_CONTEXT_SELECTOR_V1.md`](../../../docs/B_018_CONTEXT_SELECTOR_V1.md).
 *
 * v1 is intentionally tiny:
 *  - 3 strategies (no `api_only`, no `experience_replay`, no `read_page_markdown`).
 *  - No `tokenEstimate` (we have no calibration data; an invented number
 *    would mislead upstream planners).
 *  - GitHub-first; non-GitHub URLs fall through to `read_page_required`.
 *
 * This module is types + constants only — pure data, no IO. The runtime
 * lives in the native-server (`mcp/choose-context.ts`).
 */

/** Maximum length of the `intent` argument before truncation. Same as B-013. */
export const MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS = 1024;

/** Maximum length of the optional `pageRole` filter. Same as B-013. */
export const MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS = 128;

/**
 * Single threshold v1 uses to decide an Experience hit is good enough.
 * Strict `>=`. Plans below this rate are treated as "no match" so the
 * caller does not get a low-quality replay candidate dressed up as
 * `experience_reuse`.
 *
 * Kept conservative on purpose: a second knob (e.g. minimum sample
 * count) is exactly what v1 forbids — adding one is a v2 design call,
 * informed by run-history data.
 */
export const EXPERIENCE_HIT_MIN_SUCCESS_RATE = 0.5;

/**
 * Number of plans we ask `experience_suggest_plan` for. The best
 * surviving plan drives the strategy; the rest become artifacts.
 */
export const EXPERIENCE_LOOKUP_LIMIT = 3;

/**
 * Maximum number of endpoint signatures echoed in the `knowledge_light`
 * artifact summary. Keeps payload bounded even when a site has many
 * captured endpoints.
 */
export const KNOWLEDGE_LIGHT_SAMPLE_LIMIT = 5;

/**
 * Site families recognised by v1. Anything else resolves to
 * `siteFamily: undefined` and falls through to `read_page_required`.
 */
export type TabrixContextSiteFamily = 'github';

/**
 * Closed v1 strategy set. Adding a new value here is itself a v2 design
 * decision — never silently widen this in a feature branch.
 */
export type ContextStrategyName = 'experience_reuse' | 'knowledge_light' | 'read_page_required';

/**
 * Validated public input. Built from raw MCP args by
 * `parseTabrixChooseContextInput` in the native-server.
 */
export interface TabrixChooseContextInput {
  /** Free-text intent. Non-empty after trim. Truncated before normalization. */
  intent: string;
  /** Optional page URL. Unparseable values are silently ignored (see doc §3.1). */
  url?: string;
  /** Optional `pageRole` filter, mirroring the B-013 contract. */
  pageRole?: string;
  /**
   * Optional explicit site-family override. v1 only honours `'github'`;
   * any other value is dropped on the floor and the URL-derived family
   * (if any) is used instead.
   */
  siteId?: TabrixContextSiteFamily;
}

/**
 * One reusable artifact reference returned alongside the chosen
 * strategy. `ref` is opaque to the caller — it is owned by whichever
 * native subsystem produced it (Experience action-path id; site name
 * for the Knowledge catalog; etc.).
 */
export interface TabrixChooseContextArtifact {
  kind: 'experience' | 'knowledge_api' | 'read_page';
  ref: string;
  /** Compact human-readable label, ≤ 200 chars. Not a UI string. */
  summary: string;
}

/**
 * Echo of what the tool resolved from input — useful for debugging
 * bucket alignment with `experience_suggest_plan`.
 */
export interface TabrixChooseContextResolved {
  intentSignature: string;
  pageRole?: string;
  siteFamily?: TabrixContextSiteFamily;
}

export interface TabrixChooseContextErrorBody {
  code: string;
  message: string;
}

/**
 * Public response. `status: 'invalid_input'` carries only `error`
 * (everything else is omitted) so the caller can branch on the
 * discriminator without writing optional-chains for every field.
 */
export interface TabrixChooseContextResult {
  status: 'ok' | 'invalid_input';
  strategy?: ContextStrategyName;
  /**
   * Concrete next-step the caller should fall back to if `strategy`
   * cannot be acted on. In v1 this is always `'read_page_required'`
   * when `strategy` is something else, and omitted when `strategy`
   * already is `'read_page_required'`.
   */
  fallbackStrategy?: ContextStrategyName;
  /** Short rationale, stable enough to grep in logs. */
  reasoning?: string;
  /** Always a list when `status === 'ok'`; possibly empty. */
  artifacts?: TabrixChooseContextArtifact[];
  resolved?: TabrixChooseContextResolved;
  error?: TabrixChooseContextErrorBody;
}
