import {
  buildPolicyDeniedPayload,
  isToolAllowedByPolicy,
  resolveOptInAllowlist,
} from './phase0-opt-in';
import { P3_EXPLICIT_OPT_IN_TOOLS, TOOL_NAMES } from '@tabrix/shared';

describe('Phase0 Policy — resolveOptInAllowlist', () => {
  it('returns empty set when no env flags are set', () => {
    expect(resolveOptInAllowlist({})).toEqual(new Set());
  });

  it('expands "all" to every P3 opt-in tool', () => {
    const allow = resolveOptInAllowlist({ TABRIX_POLICY_ALLOW_P3: 'all' });
    expect(allow.size).toBe(P3_EXPLICIT_OPT_IN_TOOLS.size);
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      expect(allow.has(name)).toBe(true);
    }
  });

  it('supports comma-separated tool names with whitespace', () => {
    const allow = resolveOptInAllowlist({
      TABRIX_POLICY_ALLOW_P3: ' chrome_javascript , chrome_computer ',
    });
    expect(allow.has('chrome_javascript')).toBe(true);
    expect(allow.has('chrome_computer')).toBe(true);
    expect(allow.has('chrome_upload_file')).toBe(false);
  });

  it('treats ENABLE_MCP_TOOLS entries as implicit opt-in when P3', () => {
    const allow = resolveOptInAllowlist({
      ENABLE_MCP_TOOLS: 'chrome_read_page,chrome_javascript',
    });
    expect(allow.has('chrome_javascript')).toBe(true);
    expect(allow.has('chrome_read_page')).toBe(false);
  });

  it('merges explicit policy allow and implicit whitelist', () => {
    const allow = resolveOptInAllowlist({
      TABRIX_POLICY_ALLOW_P3: 'chrome_computer',
      ENABLE_MCP_TOOLS: 'chrome_javascript',
    });
    expect(allow.has('chrome_computer')).toBe(true);
    expect(allow.has('chrome_javascript')).toBe(true);
  });
});

describe('Phase0 Policy — isToolAllowedByPolicy', () => {
  it('returns true for P0 / P1 / P2 tools regardless of env', () => {
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.READ_PAGE, {})).toBe(true);
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.NAVIGATE, {})).toBe(true);
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.CLICK, {})).toBe(true);
  });

  it('blocks P3 opt-in tools by default', () => {
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.JAVASCRIPT, {})).toBe(false);
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.COMPUTER, {})).toBe(false);
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.FILE_UPLOAD, {})).toBe(false);
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.BOOKMARK_DELETE, {})).toBe(false);
  });

  it('allows P3 opt-in tools when TABRIX_POLICY_ALLOW_P3=all', () => {
    const env = { TABRIX_POLICY_ALLOW_P3: 'all' };
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      expect(isToolAllowedByPolicy(name, env)).toBe(true);
    }
  });

  it('allows only named P3 tools when policy-allow is narrow', () => {
    const env = { TABRIX_POLICY_ALLOW_P3: 'chrome_javascript' };
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.JAVASCRIPT, env)).toBe(true);
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.COMPUTER, env)).toBe(false);
  });

  it('treats ENABLE_MCP_TOOLS listing a P3 tool as opt-in', () => {
    const env = { ENABLE_MCP_TOOLS: 'chrome_read_page,chrome_javascript' };
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.JAVASCRIPT, env)).toBe(true);
    expect(isToolAllowedByPolicy(TOOL_NAMES.BROWSER.COMPUTER, env)).toBe(false);
  });

  it('is policy-agnostic for unknown tool names (fail-open for compatibility)', () => {
    expect(isToolAllowedByPolicy('some_future_unknown_tool', {})).toBe(true);
  });
});

describe('Phase0 Policy — buildPolicyDeniedPayload', () => {
  it('produces a structured P3 denial payload with stable code', () => {
    const payload = buildPolicyDeniedPayload(TOOL_NAMES.BROWSER.JAVASCRIPT);
    expect(payload.code).toBe('TABRIX_POLICY_DENIED_P3');
    expect(payload.riskTier).toBe('P3');
    expect(payload.requiresExplicitOptIn).toBe(true);
    expect(payload.message).toContain('chrome_javascript');
    expect(payload.hint).toContain('TABRIX_POLICY_ALLOW_P3');
    expect(payload.hint).toContain('chrome_javascript');
  });

  it('mentions "all" and the tool name in the hint for actionable recovery', () => {
    const payload = buildPolicyDeniedPayload(TOOL_NAMES.BROWSER.COMPUTER);
    expect(payload.hint).toContain('chrome_computer');
    expect(payload.hint).toContain('all');
  });
});
