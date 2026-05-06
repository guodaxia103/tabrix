import {
  CAPABILITY_GATED_TOOLS,
  TOOL_NAMES,
  getRequiredCapability,
  getToolRiskTier,
  isCapabilityGatedTool,
  isExplicitOptInTool,
} from '@tabrix/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { isCapabilityEnabled, type CapabilityEnv } from '../policy/capabilities';
import { resolveOptInAllowlist } from '../policy/phase0-opt-in';

/**
 * Tools with elevated risk: arbitrary JS execution, data deletion, file system
 * interaction. When MCP_DISABLE_SENSITIVE_TOOLS=true, these are hidden from
 * the tool list unless explicitly allowed via ENABLE_MCP_TOOLS.
 */
export const SENSITIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.BROWSER.JAVASCRIPT,
  TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
  TOOL_NAMES.BROWSER.FILE_UPLOAD,
]);

function parseToolList(value?: string): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function filterToolsByEnvironment(tools: Tool[]): Tool[] {
  const enabledTools = parseToolList(process.env.ENABLE_MCP_TOOLS);
  const disabledTools = parseToolList(process.env.DISABLE_MCP_TOOLS);

  if (enabledTools.size > 0) {
    return tools.filter((tool) => enabledTools.has(tool.name));
  }

  if (disabledTools.size > 0) {
    return tools.filter((tool) => !disabledTools.has(tool.name));
  }

  if (process.env.MCP_DISABLE_SENSITIVE_TOOLS === 'true') {
    return tools.filter((tool) => !SENSITIVE_TOOL_NAMES.has(tool.name));
  }

  return tools;
}

export function isToolAllowed(toolName: string, tools: Tool[]): boolean {
  return tools.some((tool) => tool.name === toolName);
}

/**
 * Phase 0 Policy view of the tools list. Removes P3 opt-in tools that have not been opted-in
 * and injects the Tabrix-private `riskTier` annotation so clients that choose to render it can.
 *
 * Also injects `requiresExplicitOptIn: true` for tools listed
 * in {@link CAPABILITY_GATED_TOOLS} (e.g. `experience_replay`), even
 * though they are NOT in `P3_EXPLICIT_OPT_IN_TOOLS`. This is the
 * first non-P3 use of that annotation; the actual filtering happens
 * in {@link filterToolsByCapability} below, downstream of this
 * function.
 *
 * Never mutates the input tool objects.
 */
export function filterToolsByPolicy(tools: Tool[]): Tool[] {
  const optInAllow = resolveOptInAllowlist(process.env);
  const result: Tool[] = [];
  for (const tool of tools) {
    if (isExplicitOptInTool(tool.name) && !optInAllow.has(tool.name)) {
      continue;
    }
    const riskTier = getToolRiskTier(tool.name);
    const requiresOptIn = isExplicitOptInTool(tool.name) || isCapabilityGatedTool(tool.name);
    if (!riskTier && !requiresOptIn) {
      result.push(tool);
      continue;
    }
    const annotations = {
      ...(tool.annotations ?? {}),
      ...(riskTier ? { riskTier } : {}),
      ...(requiresOptIn ? { requiresExplicitOptIn: true } : {}),
    } as Tool['annotations'];
    result.push({ ...tool, annotations });
  }
  return result;
}

/**
 * Capability gate. Drops tools listed in
 * {@link CAPABILITY_GATED_TOOLS} when the matching capability is not
 * present in the active capability allowlist (`TABRIX_POLICY_CAPABILITIES`
 * — see {@link isCapabilityEnabled}).
 *
 * This is orthogonal to the P3 opt-in path: a tool can be capability-
 * gated without being P3 (e.g. `experience_replay` is P1 + capability
 * `experience_replay`). The gate runs AFTER `filterToolsByPolicy` so
 * the annotation injection above is always honoured for clients that
 * render the gate explanation.
 *
 * Never mutates the input tool objects.
 */
export function filterToolsByCapability(tools: Tool[], env: CapabilityEnv): Tool[] {
  if (CAPABILITY_GATED_TOOLS.size === 0) return tools;
  return tools.filter((tool) => {
    const cap = getRequiredCapability(tool.name);
    if (!cap) return true;
    return isCapabilityEnabled(cap, env);
  });
}
