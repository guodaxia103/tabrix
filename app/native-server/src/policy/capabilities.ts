/**
 * Tabrix MKEP Policy — capability gate.
 *
 * Native-side parser / lookup for the `TABRIX_POLICY_CAPABILITIES`
 * env var. Pure functions, no IO. See `packages/shared/src/capabilities.ts`
 * for the canonical capability list and the rationale for keeping this
 * orthogonal to the existing P3 per-tool opt-in.
 */

import { ALL_TABRIX_CAPABILITIES, isTabrixCapability, type TabrixCapability } from '@tabrix/shared';
import { getPersistedPolicyCapabilities } from '../host-config';

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

export type CapabilitySourceKind = 'env' | 'persisted_config' | 'default';

export interface CapabilityResolutionResult {
  env: CapabilityEnv;
  source: CapabilitySourceKind;
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

export function resolveCapabilityEnv(input: {
  env?: CapabilityEnv;
  persistedPolicyCapabilities?: string;
}): CapabilityResolutionResult {
  const envValue = input.env?.TABRIX_POLICY_CAPABILITIES;
  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    return {
      env: { TABRIX_POLICY_CAPABILITIES: envValue },
      source: 'env',
    };
  }
  if (
    typeof input.persistedPolicyCapabilities === 'string' &&
    input.persistedPolicyCapabilities.trim().length > 0
  ) {
    return {
      env: { TABRIX_POLICY_CAPABILITIES: input.persistedPolicyCapabilities },
      source: 'persisted_config',
    };
  }
  return { env: {}, source: 'default' };
}

export function getCurrentCapabilityResolution(): CapabilityResolutionResult {
  return resolveCapabilityEnv({
    env: { TABRIX_POLICY_CAPABILITIES: process.env.TABRIX_POLICY_CAPABILITIES },
    persistedPolicyCapabilities: getPersistedPolicyCapabilities(),
  });
}

export function getCurrentCapabilityEnv(): CapabilityEnv {
  return getCurrentCapabilityResolution().env;
}

export function getCapabilityDiagnostics(): {
  source: CapabilitySourceKind;
  enabled: TabrixCapability[];
  unknown: string[];
} {
  const resolution = getCurrentCapabilityResolution();
  const parsed = parseCapabilityAllowlist(resolution.env);
  return {
    source: resolution.source,
    enabled: Array.from(parsed.enabled).sort(),
    unknown: [...parsed.unknown],
  };
}
