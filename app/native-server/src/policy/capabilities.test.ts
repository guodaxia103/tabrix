import { isCapabilityEnabled, parseCapabilityAllowlist, type CapabilityEnv } from './capabilities';

describe('B-016 capability gate parser', () => {
  describe('parseCapabilityAllowlist', () => {
    it('returns empty set when env is unset (default-deny)', () => {
      const result = parseCapabilityAllowlist({});
      expect(Array.from(result.enabled)).toEqual([]);
      expect(result.unknown).toEqual([]);
    });

    it('returns empty set when env is empty string or only whitespace/commas', () => {
      const cases: CapabilityEnv[] = [
        { TABRIX_POLICY_CAPABILITIES: '' },
        { TABRIX_POLICY_CAPABILITIES: '   ' },
        { TABRIX_POLICY_CAPABILITIES: ',,, ,,' },
      ];
      for (const env of cases) {
        const result = parseCapabilityAllowlist(env);
        expect(Array.from(result.enabled)).toEqual([]);
        expect(result.unknown).toEqual([]);
      }
    });

    it('enables a single recognised capability', () => {
      const result = parseCapabilityAllowlist({ TABRIX_POLICY_CAPABILITIES: 'api_knowledge' });
      expect(Array.from(result.enabled)).toEqual(['api_knowledge']);
      expect(result.unknown).toEqual([]);
    });

    it('trims whitespace around tokens', () => {
      const result = parseCapabilityAllowlist({
        TABRIX_POLICY_CAPABILITIES: '  api_knowledge  ',
      });
      expect(Array.from(result.enabled)).toEqual(['api_knowledge']);
      expect(result.unknown).toEqual([]);
    });

    it('handles comma-separated lists with mixed valid + unknown tokens', () => {
      const result = parseCapabilityAllowlist({
        TABRIX_POLICY_CAPABILITIES: 'api_knowledge, vision , unknown_cap',
      });
      expect(Array.from(result.enabled)).toEqual(['api_knowledge']);
      // `vision` and `unknown_cap` are not in ALL_TABRIX_CAPABILITIES (v1).
      expect(result.unknown).toEqual(['vision', 'unknown_cap']);
    });

    it('special token "all" enables every recognised capability', () => {
      const result = parseCapabilityAllowlist({ TABRIX_POLICY_CAPABILITIES: 'all' });
      // v1 has exactly one capability; assertion is intentionally
      // explicit so adding new capabilities forces an update here.
      expect(Array.from(result.enabled).sort()).toEqual(['api_knowledge']);
      expect(result.unknown).toEqual([]);
    });

    it('"all" combined with a typo still emits unknown for the typo', () => {
      const result = parseCapabilityAllowlist({
        TABRIX_POLICY_CAPABILITIES: 'all, api_knowlege', // intentional typo
      });
      expect(Array.from(result.enabled)).toEqual(['api_knowledge']);
      expect(result.unknown).toEqual(['api_knowlege']);
    });

    it('is idempotent for repeated tokens', () => {
      const result = parseCapabilityAllowlist({
        TABRIX_POLICY_CAPABILITIES: 'api_knowledge,api_knowledge,api_knowledge',
      });
      expect(Array.from(result.enabled)).toEqual(['api_knowledge']);
      expect(result.unknown).toEqual([]);
    });
  });

  describe('isCapabilityEnabled', () => {
    it('returns false when env is unset', () => {
      expect(isCapabilityEnabled('api_knowledge', {})).toBe(false);
    });

    it('returns true when capability is explicitly listed', () => {
      expect(
        isCapabilityEnabled('api_knowledge', { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' }),
      ).toBe(true);
    });

    it('returns true under "all"', () => {
      expect(isCapabilityEnabled('api_knowledge', { TABRIX_POLICY_CAPABILITIES: 'all' })).toBe(
        true,
      );
    });

    it('returns false when only unknown tokens are listed', () => {
      expect(
        isCapabilityEnabled('api_knowledge', { TABRIX_POLICY_CAPABILITIES: 'vision,download' }),
      ).toBe(false);
    });
  });
});
