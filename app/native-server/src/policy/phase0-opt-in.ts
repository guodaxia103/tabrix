/**
 * Tabrix MKEP Policy — Phase 0 (explicit opt-in gate).
 *
 * Responsibilities:
 *  - Read env-var based opt-in allowlist (TABRIX_POLICY_ALLOW_P3)
 *  - Decide whether a P3 tool call is permitted
 *  - Build the structured TABRIX_POLICY_DENIED_P3 payload used at the MCP boundary
 *
 * Phase 0 is intentionally narrow:
 *  - It only gates tools in P3_EXPLICIT_OPT_IN_TOOLS.
 *  - P0 / P1 / P2 tools are never blocked by this module.
 *  - Site / PageRole / Task-level policy lives in Phase 1.
 *
 * See docs/POLICY_PHASE_0.md for the full design.
 */

import { P3_EXPLICIT_OPT_IN_TOOLS, getToolRiskTier, isExplicitOptInTool } from '@tabrix/shared';

export interface Phase0PolicyEnv {
  /**
   * Comma-separated list of tool names the operator has explicitly opted in to.
   * Special value "all" allows every P3 opt-in tool.
   */
  TABRIX_POLICY_ALLOW_P3?: string;
  /** Standard MCP whitelist. If a P3 tool appears here we treat it as implicit opt-in. */
  ENABLE_MCP_TOOLS?: string;
}

export interface PolicyDeniedPayload {
  code: 'TABRIX_POLICY_DENIED_P3';
  message: string;
  riskTier: 'P3';
  requiresExplicitOptIn: true;
  summary: string;
  hint: string;
  nextAction: string | null;
}

function parseList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/**
 * Returns the set of tool names opted-in via TABRIX_POLICY_ALLOW_P3 and/or ENABLE_MCP_TOOLS.
 * The special token "all" in TABRIX_POLICY_ALLOW_P3 opts in every P3 tool.
 */
export function resolveOptInAllowlist(env: Phase0PolicyEnv): ReadonlySet<string> {
  const policyAllow = parseList(env.TABRIX_POLICY_ALLOW_P3);
  if (policyAllow.has('all')) {
    return new Set(P3_EXPLICIT_OPT_IN_TOOLS);
  }
  const whitelist = parseList(env.ENABLE_MCP_TOOLS);
  const combined = new Set<string>();
  for (const name of policyAllow) combined.add(name);
  for (const name of whitelist) {
    if (P3_EXPLICIT_OPT_IN_TOOLS.has(name)) combined.add(name);
  }
  return combined;
}

/**
 * True when the tool is either NOT a P3 opt-in tool, or the operator has opted in.
 * P0 / P1 / P2 tools always return true (policy-agnostic at Phase 0).
 */
export function isToolAllowedByPolicy(toolName: string, env: Phase0PolicyEnv): boolean {
  if (!isExplicitOptInTool(toolName)) return true;
  const allow = resolveOptInAllowlist(env);
  return allow.has(toolName);
}

/**
 * Build the structured error payload for a P3-denied tool call.
 * Shape mirrors the existing TABRIX_BRIDGE_* / TABRIX_TOOL_CALL_* payloads.
 */
export function buildPolicyDeniedPayload(toolName: string): PolicyDeniedPayload {
  const tier = getToolRiskTier(toolName);
  const tierLabel = tier ?? 'P3';
  return {
    code: 'TABRIX_POLICY_DENIED_P3',
    message: `Tool "${toolName}" is classified as ${tierLabel} (high risk) and blocked by default Tabrix policy.`,
    riskTier: 'P3',
    requiresExplicitOptIn: true,
    summary: '高风险工具已被 Tabrix Policy 默认拦截。',
    hint: `如需放行，请在启动环境中设置 TABRIX_POLICY_ALLOW_P3（例如 TABRIX_POLICY_ALLOW_P3=${toolName} 或 TABRIX_POLICY_ALLOW_P3=all），或通过 ENABLE_MCP_TOOLS 白名单显式列出该工具。`,
    nextAction: null,
  };
}
