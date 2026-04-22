import {
  ALL_TABRIX_CAPABILITIES,
  CAPABILITY_GATED_TOOLS,
  P3_EXPLICIT_OPT_IN_TOOLS,
  TOOL_NAMES,
  TOOL_RISK_TIERS,
  TOOL_SCHEMAS,
  getToolRiskTier,
  isCapabilityGatedTool,
  isExplicitOptInTool,
} from '@tabrix/shared';

describe('TOOL_RISK_TIERS coverage invariants', () => {
  it('every tool in TOOL_SCHEMAS has an entry in TOOL_RISK_TIERS', () => {
    const missing: string[] = [];
    for (const tool of TOOL_SCHEMAS) {
      if (!getToolRiskTier(tool.name)) missing.push(tool.name);
    }
    expect(missing).toEqual([]);
  });

  it('every entry in TOOL_RISK_TIERS matches a known tool name in TOOL_NAMES', () => {
    const allKnownNames = new Set<string>();
    for (const group of Object.values(TOOL_NAMES)) {
      for (const name of Object.values(group)) {
        allKnownNames.add(name);
      }
    }
    const orphaned: string[] = [];
    for (const name of Object.keys(TOOL_RISK_TIERS)) {
      if (!allKnownNames.has(name)) orphaned.push(name);
    }
    expect(orphaned).toEqual([]);
  });

  it('every tool in P3_EXPLICIT_OPT_IN_TOOLS is tagged P3', () => {
    const misclassified: string[] = [];
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      if (TOOL_RISK_TIERS[name] !== 'P3') misclassified.push(name);
    }
    expect(misclassified).toEqual([]);
  });

  it('tool classified P3 and in P3_EXPLICIT_OPT_IN_TOOLS is flagged explicit opt-in', () => {
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      expect(isExplicitOptInTool(name)).toBe(true);
    }
  });

  it('no P0 / P1 / P2 tool is accidentally in the opt-in set', () => {
    const leaks: string[] = [];
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      const tier = TOOL_RISK_TIERS[name];
      if (tier !== 'P3') leaks.push(`${name}=${tier}`);
    }
    expect(leaks).toEqual([]);
  });

  it('known-risky tools are classified P3 (regression guard)', () => {
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.JAVASCRIPT]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.COMPUTER]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.FILE_UPLOAD]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.BOOKMARK_DELETE]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.INJECT_SCRIPT]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.USERSCRIPT]).toBe('P3');
  });

  it('every capability-gated tool maps to a known TabrixCapability', () => {
    const allCaps = new Set<string>(ALL_TABRIX_CAPABILITIES);
    const offenders: string[] = [];
    for (const [toolName, capability] of CAPABILITY_GATED_TOOLS) {
      if (!allCaps.has(capability)) offenders.push(`${toolName}->${capability}`);
    }
    expect(offenders).toEqual([]);
  });

  it('experience_replay is P1 + capability-gated (V24-01 invariant)', () => {
    expect(TOOL_RISK_TIERS[TOOL_NAMES.EXPERIENCE.REPLAY]).toBe('P1');
    expect(isCapabilityGatedTool(TOOL_NAMES.EXPERIENCE.REPLAY)).toBe(true);
    expect(P3_EXPLICIT_OPT_IN_TOOLS).not.toContain(TOOL_NAMES.EXPERIENCE.REPLAY);
  });

  it('known-safe tools are classified P0 (regression guard)', () => {
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.READ_PAGE]).toBe('P0');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.SCREENSHOT]).toBe('P0');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS]).toBe('P0');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.CONSOLE]).toBe('P0');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.HISTORY]).toBe('P0');
  });
});
