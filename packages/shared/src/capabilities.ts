/**
 * Tabrix MKEP Policy — capability opt-in (B-016).
 *
 * Capabilities are *feature-domain* opt-ins, orthogonal to the existing
 * P3 per-tool opt-in (`TABRIX_POLICY_ALLOW_P3`). Where the per-tool gate
 * answers "may this MCP tool be invoked at all", a capability gate
 * answers "may this *feature* (which may span multiple tools and
 * background subsystems) be active in this process".
 *
 * Why a separate dimension:
 *  - Some features (like API Knowledge capture) are passive side-effects
 *    of *existing*, already-allowed P0/P1 tools (e.g. `chrome_network_capture`).
 *    Re-using P3 opt-in would force operators to either expose every
 *    intermediate tool or build a parallel allowlist; neither matches
 *    the actual risk surface, which is "may we passively retain shape
 *    metadata of a user's network traffic, even after redaction".
 *
 * Scope of v1 (intentionally minimal):
 *  - `api_knowledge` (B-016/B-017): unblocks GitHub-first API Knowledge
 *    capture v1.
 *  - `experience_replay` (V24-01): unblocks the autonomous replay of a
 *    named historical `experience_action_paths` row. This is the FIRST
 *    use of a capability gate as the operational opt-in for a non-P3
 *    tool — see `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` §4.1 / §10.
 *
 *  Additional capability names from the original design
 *  (`vision | elevated_js | download | devtools | testing | cross_origin_nav`)
 *  are deferred until a real consumer exists — adding them now would
 *  just be future-proofing without exercise.
 *
 * Env contract:
 *  - `TABRIX_POLICY_CAPABILITIES`: comma-separated list of capability
 *    tokens. The special token `all` enables every known capability.
 *    Empty / unset = nothing enabled (default-deny).
 *  - Unknown tokens are ignored at the parsing layer and reported via
 *    `parseCapabilityAllowlist().unknown` so consumers can warn once at
 *    startup without making a typo a hard failure.
 */

export type TabrixCapability = 'api_knowledge' | 'experience_replay';

/**
 * Canonical set of every capability the codebase recognises today.
 * Kept tiny on purpose — see file header.
 */
export const ALL_TABRIX_CAPABILITIES: ReadonlySet<TabrixCapability> = new Set<TabrixCapability>([
  'api_knowledge',
  'experience_replay',
]);

const CAPABILITY_VALUES = ALL_TABRIX_CAPABILITIES as ReadonlySet<string>;

/** True when the input string is a recognised `TabrixCapability`. */
export function isTabrixCapability(value: string): value is TabrixCapability {
  return CAPABILITY_VALUES.has(value);
}
