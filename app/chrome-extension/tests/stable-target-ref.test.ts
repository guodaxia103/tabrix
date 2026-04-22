import { describe, expect, it } from 'vitest';
import {
  annotateStableTargetRefs,
  buildHistoryRef,
  buildStableKey,
  computeStableTargetRef,
  cyrb53,
  normalizeHrefBucket,
  normalizeLabel,
} from '@/entrypoints/background/tools/browser/stable-target-ref';

const STABLE_REF_PATTERN = /^tgt_[0-9a-f]{10}$/;

describe('B-011 stable targetRef builder', () => {
  describe('cyrb53', () => {
    it('is deterministic for the same input', () => {
      expect(cyrb53('hello')).toBe(cyrb53('hello'));
    });
    it('differs for different inputs', () => {
      expect(cyrb53('hello')).not.toBe(cyrb53('hellp'));
    });
  });

  describe('normalizeLabel', () => {
    it('lowercases, trims and collapses whitespace', () => {
      expect(normalizeLabel('  Issues   2 ')).toBe('issues 2');
    });
    it('returns empty string for non-strings', () => {
      expect(normalizeLabel(undefined)).toBe('');
      expect(normalizeLabel(null)).toBe('');
      expect(normalizeLabel(42)).toBe('');
    });
    it('caps very long labels', () => {
      const value = 'a'.repeat(200);
      expect(normalizeLabel(value).length).toBe(80);
    });
  });

  describe('normalizeHrefBucket', () => {
    it('strips host, query, fragment and lowercases', () => {
      expect(normalizeHrefBucket('https://github.com/Owner/Repo/issues?q=open#frag')).toBe(
        '/owner/repo/issues',
      );
    });
    it('handles relative paths', () => {
      expect(normalizeHrefBucket('/Owner/Repo/issues?x=1')).toBe('/owner/repo/issues');
    });
    it('returns empty string when input is empty / non-string', () => {
      expect(normalizeHrefBucket('')).toBe('');
      expect(normalizeHrefBucket(undefined as any)).toBe('');
      expect(normalizeHrefBucket(null as any)).toBe('');
    });
  });

  describe('buildStableKey', () => {
    it('produces the same key when only ordinal changes are absent', () => {
      const a = buildStableKey({
        pageRole: 'repo_home',
        objectSubType: 'github.repo_nav_tab',
        role: 'link',
        label: 'Issues',
        href: '/owner/repo/issues',
        ordinal: 0,
      });
      const b = buildStableKey({
        pageRole: 'repo_home',
        objectSubType: 'github.repo_nav_tab',
        role: 'link',
        label: '  Issues  ',
        href: 'https://github.com/owner/repo/issues?q=open',
        ordinal: 0,
      });
      expect(a).toBe(b);
    });
    it('changes when ordinal changes', () => {
      const make = (ordinal: number) =>
        buildStableKey({
          pageRole: 'repo_home',
          objectSubType: '',
          role: 'button',
          label: 'icon',
          href: '',
          ordinal,
        });
      expect(make(0)).not.toBe(make(1));
    });
  });

  describe('computeStableTargetRef', () => {
    it('returns a tgt_<10-hex> string for an identity-bearing input', () => {
      const ref = computeStableTargetRef({
        pageRole: 'repo_home',
        objectSubType: 'github.repo_nav_tab',
        role: 'link',
        label: 'Issues',
        href: '/owner/repo/issues',
        ordinal: 0,
      });
      expect(ref).toMatch(STABLE_REF_PATTERN);
    });
    it('is stable across cosmetic label whitespace and href query/host churn', () => {
      const a = computeStableTargetRef({
        pageRole: 'repo_home',
        objectSubType: 'github.repo_nav_tab',
        role: 'link',
        label: 'Issues',
        href: '/owner/repo/issues',
        ordinal: 0,
      });
      const b = computeStableTargetRef({
        pageRole: 'repo_home',
        objectSubType: 'github.repo_nav_tab',
        role: 'link',
        label: '  Issues  ',
        href: 'https://github.com/owner/repo/issues?q=open#x',
        ordinal: 0,
      });
      expect(a).toBe(b);
    });
    it('is different for genuinely different objects (different label)', () => {
      const a = computeStableTargetRef({
        pageRole: 'repo_home',
        objectSubType: 'github.repo_nav_tab',
        role: 'link',
        label: 'Issues',
        href: '/owner/repo/issues',
        ordinal: 0,
      });
      const b = computeStableTargetRef({
        pageRole: 'repo_home',
        objectSubType: 'github.repo_nav_tab',
        role: 'link',
        label: 'Pull requests',
        href: '/owner/repo/pulls',
        ordinal: 0,
      });
      expect(a).not.toBe(b);
    });
    it('is different for the same identity tuple at different ordinals', () => {
      const a = computeStableTargetRef({
        pageRole: 'repo_home',
        objectSubType: '',
        role: 'button',
        label: 'icon',
        href: '',
        ordinal: 0,
      });
      const b = computeStableTargetRef({
        pageRole: 'repo_home',
        objectSubType: '',
        role: 'button',
        label: 'icon',
        href: '',
        ordinal: 1,
      });
      expect(a).not.toBe(b);
    });
    it('returns null when no identity signal is available', () => {
      expect(
        computeStableTargetRef({
          pageRole: 'unknown',
          objectSubType: '',
          role: '',
          label: '',
          href: '',
          ordinal: 0,
        }),
      ).toBeNull();
    });
  });

  describe('annotateStableTargetRefs', () => {
    const sampleObjects = [
      {
        id: 'hvo_a',
        kind: 'candidate_action',
        label: 'Issues',
        ref: 'ref_001',
        role: 'link',
        objectSubType: 'github.repo_nav_tab',
        href: '/owner/repo/issues',
        reason: 'r',
      },
      {
        id: 'hvo_b',
        kind: 'candidate_action',
        label: 'Pull requests',
        ref: 'ref_002',
        role: 'link',
        objectSubType: 'github.repo_nav_tab',
        href: '/owner/repo/pulls',
        reason: 'r',
      },
      // Two visually-identical icon buttons with no href or label.
      {
        id: 'hvo_c1',
        kind: 'interactive_element',
        label: 'menu',
        ref: 'ref_003',
        role: 'button',
        reason: 'r',
      },
      {
        id: 'hvo_c2',
        kind: 'interactive_element',
        label: 'menu',
        ref: 'ref_004',
        role: 'button',
        reason: 'r',
      },
    ];

    it('assigns a tgt_* targetRef to each identity-bearing HVO', () => {
      const annotated = annotateStableTargetRefs(sampleObjects, 'repo_home');
      for (const obj of annotated) {
        expect(obj.targetRef).toMatch(STABLE_REF_PATTERN);
      }
    });

    it('produces the same targetRef for the same input twice (round-trip stability)', () => {
      const a = annotateStableTargetRefs(sampleObjects, 'repo_home');
      const b = annotateStableTargetRefs(sampleObjects, 'repo_home');
      expect(a.map((o) => o.targetRef)).toEqual(b.map((o) => o.targetRef));
    });

    it('keeps the targetRef stable even when per-snapshot ref values churn', () => {
      const reread = sampleObjects.map((o, i) => ({ ...o, ref: `ref_${1000 + i}` }));
      const a = annotateStableTargetRefs(sampleObjects, 'repo_home');
      const b = annotateStableTargetRefs(reread, 'repo_home');
      expect(a.map((o) => o.targetRef)).toEqual(b.map((o) => o.targetRef));
    });

    it('disambiguates visually-identical siblings via ordinals', () => {
      const annotated = annotateStableTargetRefs(sampleObjects, 'repo_home');
      const c1 = annotated.find((o) => o.id === 'hvo_c1');
      const c2 = annotated.find((o) => o.id === 'hvo_c2');
      expect(c1?.targetRef).toBeTruthy();
      expect(c2?.targetRef).toBeTruthy();
      expect(c1?.targetRef).not.toBe(c2?.targetRef);
    });

    it('drifts when a real identity property truly changes', () => {
      const annotatedBefore = annotateStableTargetRefs(sampleObjects, 'repo_home');
      const renamed = sampleObjects.map((o) =>
        o.id === 'hvo_a' ? { ...o, label: 'Issues (legacy)' } : o,
      );
      const annotatedAfter = annotateStableTargetRefs(renamed, 'repo_home');
      const beforeRef = annotatedBefore.find((o) => o.id === 'hvo_a')?.targetRef;
      const afterRef = annotatedAfter.find((o) => o.id === 'hvo_a')?.targetRef;
      expect(beforeRef).toBeTruthy();
      expect(afterRef).toBeTruthy();
      expect(beforeRef).not.toBe(afterRef);
    });
  });

  describe('buildHistoryRef', () => {
    it('encodes host + role slug + content seed', () => {
      const ref = buildHistoryRef({
        url: 'https://github.com/owner/repo',
        pageRole: 'repo_home',
        contentSeed: 'abc',
      });
      expect(ref).toMatch(/^read:\/\/github\.com\/repo_home\/[0-9a-f]{8}$/);
    });
    it('returns null when url is missing', () => {
      expect(buildHistoryRef({ url: '', pageRole: 'repo_home' })).toBeNull();
      expect(buildHistoryRef({ url: undefined, pageRole: 'repo_home' })).toBeNull();
    });
    it('falls back to slug=unknown when pageRole is missing', () => {
      const ref = buildHistoryRef({ url: 'https://github.com', pageRole: null });
      expect(ref).toMatch(/\/unknown\//);
    });
  });
});
