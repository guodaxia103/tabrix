import type { TabrixCapability } from '../capabilities';
import { TOOL_NAMES } from './names';

/**
 * Tools whose visibility AND dispatch are gated by a Tabrix
 * capability (`TABRIX_POLICY_CAPABILITIES`), independent of the P3
 * opt-in path.
 *
 * The map's value is the {@link import('../capabilities').TabrixCapability}
 * the tool requires. The native-server's `register-tools.ts`:
 *   1. drops the tool from `listTools` when its capability is not enabled, and
 *   2. denies `callTool` with `code: 'capability_off'` when its
 *      capability is not enabled — without opening a Memory session.
 *
 * Why a separate map (rather than reusing `P3_EXPLICIT_OPT_IN_TOOLS`):
 * `experience_replay` is `P1`, not `P3`; folding it into the P3 set
 * would mis-classify it for every Policy reader (`getToolRiskTier`,
 * `buildPolicyDeniedPayload`, etc.). See
 * `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` §4.1 / §4.3 / §10 item 1.
 *
 * Invariant: every key here SHOULD also be tagged
 * `requiresExplicitOptIn: true` in its `TOOL_SCHEMAS` annotations so
 * MCP clients that render annotations see a coherent "opt-in required"
 * marker — but the gating is enforced by this map, not by the
 * annotation. (`isExplicitOptInTool` intentionally does NOT widen.)
 */
export const CAPABILITY_GATED_TOOLS: ReadonlyMap<string, TabrixCapability> = new Map<
  string,
  TabrixCapability
>([
  [TOOL_NAMES.EXPERIENCE.REPLAY, 'experience_replay'],
  // Re-uses the `experience_replay` capability — one capability
  // gates the whole replay/score-step write-back family. Gating both
  // the engine-side write-back (called from `experience_replay`) and
  // any direct upstream call to `experience_score_step` with the same
  // env knob keeps the operator surface uniform.
  [TOOL_NAMES.EXPERIENCE.SCORE_STEP, 'experience_replay'],
]);

/** True when the tool requires a Tabrix capability to be enabled. */
export function isCapabilityGatedTool(toolName: string): boolean {
  return CAPABILITY_GATED_TOOLS.has(toolName);
}

/** Returns the required capability for a capability-gated tool, or undefined. */
export function getRequiredCapability(toolName: string): TabrixCapability | undefined {
  return CAPABILITY_GATED_TOOLS.get(toolName);
}
