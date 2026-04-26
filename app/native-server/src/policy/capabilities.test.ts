import {
  getCurrentCapabilityEnv,
  isCapabilityEnabled,
  parseCapabilityAllowlist,
  resolveCapabilityEnv,
  type CapabilityEnv,
} from './capabilities';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __hostConfigInternals } from '../host-config';

const ORIGINAL_ENV = process.env.TABRIX_POLICY_CAPABILITIES;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.TABRIX_POLICY_CAPABILITIES;
  else process.env.TABRIX_POLICY_CAPABILITIES = ORIGINAL_ENV;
  __hostConfigInternals.setConfigFileForTesting(null);
});

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
      // V24-01 added `experience_replay`; assertion stays intentionally
      // explicit so adding new capabilities forces an update here.
      expect(Array.from(result.enabled).sort()).toEqual(['api_knowledge', 'experience_replay']);
      expect(result.unknown).toEqual([]);
    });

    it('"all" combined with a typo still emits unknown for the typo', () => {
      const result = parseCapabilityAllowlist({
        TABRIX_POLICY_CAPABILITIES: 'all, api_knowlege', // intentional typo
      });
      expect(Array.from(result.enabled).sort()).toEqual(['api_knowledge', 'experience_replay']);
      expect(result.unknown).toEqual(['api_knowlege']);
    });

    it('enables `experience_replay` (V24-01) on its own without affecting `api_knowledge`', () => {
      const result = parseCapabilityAllowlist({
        TABRIX_POLICY_CAPABILITIES: 'experience_replay',
      });
      expect(Array.from(result.enabled)).toEqual(['experience_replay']);
      expect(result.unknown).toEqual([]);
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

    it('treats `experience_replay` independently from `api_knowledge`', () => {
      // Single-capability opt-in must not leak across.
      expect(
        isCapabilityEnabled('experience_replay', {
          TABRIX_POLICY_CAPABILITIES: 'api_knowledge',
        }),
      ).toBe(false);
      expect(
        isCapabilityEnabled('api_knowledge', {
          TABRIX_POLICY_CAPABILITIES: 'experience_replay',
        }),
      ).toBe(false);
    });
  });

  describe('resolveCapabilityEnv', () => {
    it('keeps default closed when neither env nor persisted config is set', () => {
      expect(resolveCapabilityEnv({})).toEqual({
        env: {},
        source: 'default',
      });
    });

    it('uses persisted config for Chrome-launched native host when shell env is absent', () => {
      expect(
        resolveCapabilityEnv({
          env: {},
          persistedPolicyCapabilities: 'api_knowledge',
        }),
      ).toEqual({
        env: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' },
        source: 'persisted_config',
      });
    });

    it('gives explicit env priority over persisted config', () => {
      expect(
        resolveCapabilityEnv({
          env: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
          persistedPolicyCapabilities: 'api_knowledge',
        }),
      ).toEqual({
        env: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
        source: 'env',
      });
    });

    it('getCurrentCapabilityEnv reads persisted config when Chrome-launched host has no shell env', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-capabilities-'));
      try {
        __hostConfigInternals.setConfigFileForTesting(path.join(dir, 'config.json'));
        fs.writeFileSync(
          path.join(dir, 'config.json'),
          JSON.stringify({ policyCapabilities: 'api_knowledge' }),
          'utf8',
        );
        delete process.env.TABRIX_POLICY_CAPABILITIES;

        expect(getCurrentCapabilityEnv()).toEqual({
          TABRIX_POLICY_CAPABILITIES: 'api_knowledge',
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
