import { TOOL_NAMES } from './names';

/**
 * Tabrix MKEP Policy — risk classification for MCP tools.
 *
 * See docs/POLICY_PHASE_0.md for the rationale and the mapping rules.
 *
 * - P0: read-only observations (page reads, screenshots, listings) — safe to auto-execute.
 * - P1: reversible side-effects (navigate, switch tab, trace recording) — auto-execute + audit.
 * - P2: half-sensitive actions that depend on page context (click, fill, close tab, bookmark add)
 *       — Phase 1 may require site/task-level opt-in; Phase 0 lets them through.
 * - P3: high-risk or arbitrary-execution tools (JS eval, coordinate-level computer control,
 *       script injection, file upload, destructive deletes) — default blocked unless explicitly
 *       opted-in via TABRIX_POLICY_ALLOW_P3 (or listed in ENABLE_MCP_TOOLS).
 */
export type TabrixRiskTier = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Phase 0 Policy-attached tool annotations. Tabrix-private extension; MCP clients that do not
 * understand these fields can safely ignore them.
 */
export interface TabrixToolPolicyAnnotations {
  riskTier: TabrixRiskTier;
  /** When true, the tool is hidden from listTools and denied at callTool unless opted-in. */
  requiresExplicitOptIn?: boolean;
}

/**
 * Canonical risk-tier table for every Tabrix MCP tool.
 *
 * Keep this as the single source of truth. Do NOT duplicate riskTier into individual
 * TOOL_SCHEMAS entries — listTools injects riskTier into annotations at response time.
 *
 * Invariants enforced by `tool-risk-tier-coverage.test.ts`:
 *  - Every name in TOOL_SCHEMAS must have a key here.
 *  - Every name here must correspond to a value in TOOL_NAMES (prevents typos).
 *  - Every name in P3_EXPLICIT_OPT_IN_TOOLS must be tagged P3 here.
 */
export const TOOL_RISK_TIERS: Readonly<Record<string, TabrixRiskTier>> = Object.freeze({
  // ---- P0: read-only observations ----
  [TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS]: 'P0',
  [TOOL_NAMES.BROWSER.SCREENSHOT]: 'P0',
  [TOOL_NAMES.BROWSER.WEB_FETCHER]: 'P0',
  [TOOL_NAMES.BROWSER.REQUEST_ELEMENT_SELECTION]: 'P0',
  [TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS]: 'P0',
  [TOOL_NAMES.BROWSER.NETWORK_CAPTURE]: 'P0',
  [TOOL_NAMES.BROWSER.HISTORY]: 'P0',
  [TOOL_NAMES.BROWSER.BOOKMARK_SEARCH]: 'P0',
  [TOOL_NAMES.BROWSER.CONSOLE]: 'P0',
  [TOOL_NAMES.BROWSER.READ_PAGE]: 'P0',
  [TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD]: 'P0',
  [TOOL_NAMES.BROWSER.PERFORMANCE_ANALYZE_INSIGHT]: 'P0',

  // ---- P1: reversible side-effects ----
  [TOOL_NAMES.BROWSER.NAVIGATE]: 'P1',
  [TOOL_NAMES.BROWSER.SWITCH_TAB]: 'P1',
  [TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE]: 'P1',
  [TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE]: 'P1',
  [TOOL_NAMES.BROWSER.GIF_RECORDER]: 'P1',
  // Legacy/internal names kept for completeness — safe defaults even though not in TOOL_SCHEMAS.
  [TOOL_NAMES.BROWSER.NETWORK_CAPTURE_START]: 'P1',
  [TOOL_NAMES.BROWSER.NETWORK_CAPTURE_STOP]: 'P1',
  [TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_START]: 'P1',
  [TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_STOP]: 'P1',

  // ---- P2: half-sensitive action tools ----
  [TOOL_NAMES.BROWSER.CLOSE_TABS]: 'P2',
  [TOOL_NAMES.BROWSER.CLICK]: 'P2',
  [TOOL_NAMES.BROWSER.FILL]: 'P2',
  [TOOL_NAMES.BROWSER.KEYBOARD]: 'P2',
  [TOOL_NAMES.BROWSER.HANDLE_DIALOG]: 'P2',
  [TOOL_NAMES.BROWSER.BOOKMARK_ADD]: 'P2',
  [TOOL_NAMES.BROWSER.NETWORK_REQUEST]: 'P2',

  // ---- P3: high-risk / arbitrary-execution — default blocked ----
  [TOOL_NAMES.BROWSER.JAVASCRIPT]: 'P3',
  [TOOL_NAMES.BROWSER.COMPUTER]: 'P3',
  [TOOL_NAMES.BROWSER.FILE_UPLOAD]: 'P3',
  [TOOL_NAMES.BROWSER.BOOKMARK_DELETE]: 'P3',
  // Currently commented-out in TOOL_SCHEMAS but reserved (prevent accidental downgrade on re-enable).
  [TOOL_NAMES.BROWSER.INJECT_SCRIPT]: 'P3',
  [TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT]: 'P3',
  [TOOL_NAMES.BROWSER.USERSCRIPT]: 'P3',

  // Record-replay tools inherit the highest tier of their recorded steps at runtime
  // (Phase 1). For Phase 0 we conservatively tag them P2 so they are not blocked by default.
  [TOOL_NAMES.RECORD_REPLAY.FLOW_RUN]: 'P2',
  [TOOL_NAMES.RECORD_REPLAY.LIST_PUBLISHED]: 'P0',

  // ---- MKEP Experience layer (read-only SELECT against native SQLite) ----
  [TOOL_NAMES.EXPERIENCE.SUGGEST_PLAN]: 'P0',
  // V24-01 write/execute path. P1 (per-step P2 actions are still gated
  // by their own dispatch); first non-P3 use of `requiresExplicitOptIn`,
  // additionally guarded by the `experience_replay` capability gate
  // (CAPABILITY_GATED_TOOLS below) so listing + dispatch require an
  // explicit operator opt-in independent of `TABRIX_POLICY_ALLOW_P3`.
  [TOOL_NAMES.EXPERIENCE.REPLAY]: 'P1',
  // V24-02 write-back tool. P1 because it persists outcome facts
  // (counter delta + audit warning row) that influence subsequent
  // chooser ranking; capability-gated via the same
  // `experience_replay` gate so the score-step channel is governed
  // by exactly the capability that controls the replay it serves.
  [TOOL_NAMES.EXPERIENCE.SCORE_STEP]: 'P1',

  // ---- MKEP Context selector (read-only SELECT against native SQLite) ----
  [TOOL_NAMES.CONTEXT.CHOOSE]: 'P0',
  // V23-04 / B-018 v1.5: pure-INSERT outcome write-back. P0 because
  // it appends one telemetry row keyed by `decisionId`, never replays,
  // and is gated by the same Memory persistence check the chooser uses.
  [TOOL_NAMES.CONTEXT.RECORD_OUTCOME]: 'P0',
});

/**
 * Tools classified P3 AND requiring an explicit opt-in. See docs/POLICY_PHASE_0.md §3.
 *
 * NOTE: Includes a few names that are currently commented-out in TOOL_SCHEMAS
 * (chrome_inject_script / chrome_send_command_to_inject_script / chrome_userscript).
 * Keeping them in the set prevents accidental exposure if/when they are uncommented.
 */
export const P3_EXPLICIT_OPT_IN_TOOLS: ReadonlySet<string> = new Set([
  TOOL_NAMES.BROWSER.JAVASCRIPT,
  TOOL_NAMES.BROWSER.COMPUTER,
  TOOL_NAMES.BROWSER.FILE_UPLOAD,
  TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
  TOOL_NAMES.BROWSER.INJECT_SCRIPT,
  TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT,
  TOOL_NAMES.BROWSER.USERSCRIPT,
]);

/** Returns the Tabrix risk tier for a tool name, or undefined when unknown. */
export function getToolRiskTier(toolName: string): TabrixRiskTier | undefined {
  return TOOL_RISK_TIERS[toolName];
}

/** True when the tool is P3 and requires explicit opt-in to be visible/callable. */
export function isExplicitOptInTool(toolName: string): boolean {
  return P3_EXPLICIT_OPT_IN_TOOLS.has(toolName);
}
