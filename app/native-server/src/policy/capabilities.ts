/**
 * Tabrix MKEP Policy — capability gate (B-016).
 *
 * Native-side parser / lookup for the `TABRIX_POLICY_CAPABILITIES`
 * env var. Pure functions, no IO. See `packages/shared/src/capabilities.ts`
 * for the canonical capability list and the rationale for keeping this
 * orthogonal to the existing P3 per-tool opt-in.
 */

import { ALL_TABRIX_CAPABILITIES, isTabrixCapability, type TabrixCapability } from '@tabrix/shared';

export interface CapabilityEnv {
  /**
   * Comma-separated capability allowlist. Special token `all` enables
   * every capability in `ALL_TABRIX_CAPABILITIES`. Empty / unset means
   * default-deny (no capability is active).
   */
  TABRIX_POLICY_CAPABILITIES?: string;
}

export interface CapabilityParseResult {
  /** Capabilities the operator has explicitly enabled. */
  enabled: ReadonlySet<TabrixCapability>;
  /**
   * Tokens present in the env var that are not recognised by this build.
   * Surfaced so a consumer can warn once at startup rather than silently
   * dropping typos.
   */
  unknown: readonly string[];
}

function tokenize(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Parse `TABRIX_POLICY_CAPABILITIES` into an enabled-set + a list of
 * unknown tokens. Pure. Order-insensitive. `all` is honoured at parse
 * time (so callers do not have to special-case it downstream).
 */
export function parseCapabilityAllowlist(env: CapabilityEnv): CapabilityParseResult {
  const tokens = tokenize(env.TABRIX_POLICY_CAPABILITIES);
  const enabled = new Set<TabrixCapability>();
  const unknown: string[] = [];

  for (const token of tokens) {
    if (token === 'all') {
      for (const cap of ALL_TABRIX_CAPABILITIES) enabled.add(cap);
      continue;
    }
    if (isTabrixCapability(token)) {
      enabled.add(token);
      continue;
    }
    unknown.push(token);
  }

  return { enabled, unknown };
}

/**
 * Convenience: true when the given capability is enabled in `env`.
 * Reads `process.env`-style `TABRIX_POLICY_CAPABILITIES` only — never
 * reads `process.env` directly so callers can inject test envs.
 */
export function isCapabilityEnabled(capability: TabrixCapability, env: CapabilityEnv): boolean {
  return parseCapabilityAllowlist(env).enabled.has(capability);
}
