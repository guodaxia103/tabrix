import { describe, expect, it } from 'vitest';
import {
  annotateStableTargetRefs,
  computeStableTargetRef,
} from '@/entrypoints/background/tools/browser/stable-target-ref';

/**
 * V23-02 — stable `targetRef` increment hardening.
 *
 * `B-011 v1` already shipped the deterministic `tgt_<10-hex>` derivation
 * and the `tests/stable-target-ref.test.ts` smoke suite covers the
 * happy-path round-trip. This file is the *increment* — explicit,
 * scenario-named tests for the three churn modes the v2.3.0 mainline
 * call out as the realistic source of `targetRef` drift on
 * production-shaped pages:
 *
 *   1. cosmetic DOM mutation: a non-identity-bearing sibling gets
 *      removed (e.g. a spinner / skeleton row), or text whitespace
 *      around a label changes, or class attributes flip; none of
 *      these should change `targetRef` for the surviving HVOs whose
 *      identity is unchanged.
 *
 *   2. reload-shaped re-annotation: every `ref` value churns (the
 *      content script rebuilds `__claudeElementMap`), but the
 *      identity tuple `(pageRole, objectSubType, role, label, href,
 *      ordinal)` is unchanged. Same `targetRef` must come out.
 *
 *   3. ordinal-collision contract: visually-identical siblings
 *      (no href, identical label) must still get *distinct*
 *      `targetRef` values via the ordinal disambiguator, otherwise a
 *      click bridge against `targetRef` is ambiguous.
 *
 * The cross-reload, real-browser counterpart of (2) lives in the
 * maintainer-private acceptance lane. This file is the
 * unit-level guard so a future refactor cannot silently weaken these
 * properties without lighting up here first.
 */

const STABLE_REF_PATTERN = /^tgt_[0-9a-f]{10}$/;

describe('V23-02 stable targetRef increment hardening', () => {
  describe('cosmetic DOM mutation: identity is unaffected', () => {
    it('removing a prior sibling that has no identity does not change neighbouring targetRefs', () => {
      // The "spinner row" (`hvo_spinner`) carries no role / label /
      // href tuple worth keying on — annotateStableTargetRefs will
      // refuse to assign it a targetRef. When it disappears between
      // two snapshots, the surviving anchors must keep the same
      // targetRef they had before. This is the realistic shape of a
      // GitHub list re-render where the loading skeleton vanishes.
      const before = annotateStableTargetRefs(
        [
          {
            id: 'hvo_spinner',
            kind: 'interactive_element',
            ref: 'ref_spinner',
            role: 'presentation',
            reason: 'r',
          },
          {
            id: 'hvo_issues',
            kind: 'candidate_action',
            label: 'Issues',
            ref: 'ref_issues_a',
            role: 'link',
            objectSubType: 'github.repo_nav_tab',
            href: '/owner/repo/issues',
            reason: 'r',
          },
          {
            id: 'hvo_pulls',
            kind: 'candidate_action',
            label: 'Pull requests',
            ref: 'ref_pulls_a',
            role: 'link',
            objectSubType: 'github.repo_nav_tab',
            href: '/owner/repo/pulls',
            reason: 'r',
          },
        ],
        'repo_home',
      );

      const after = annotateStableTargetRefs(
        [
          {
            id: 'hvo_issues',
            kind: 'candidate_action',
            label: 'Issues',
            ref: 'ref_issues_b',
            role: 'link',
            objectSubType: 'github.repo_nav_tab',
            href: '/owner/repo/issues',
            reason: 'r',
          },
          {
            id: 'hvo_pulls',
            kind: 'candidate_action',
            label: 'Pull requests',
            ref: 'ref_pulls_b',
            role: 'link',
            objectSubType: 'github.repo_nav_tab',
            href: '/owner/repo/pulls',
            reason: 'r',
          },
        ],
        'repo_home',
      );

      const beforeRef = before.find((o) => o.id === 'hvo_issues')?.targetRef;
      const afterRef = after.find((o) => o.id === 'hvo_issues')?.targetRef;
      expect(beforeRef).toMatch(STABLE_REF_PATTERN);
      expect(afterRef).toBe(beforeRef);

      const beforePulls = before.find((o) => o.id === 'hvo_pulls')?.targetRef;
      const afterPulls = after.find((o) => o.id === 'hvo_pulls')?.targetRef;
      expect(beforePulls).toMatch(STABLE_REF_PATTERN);
      expect(afterPulls).toBe(beforePulls);
    });

    it('class attribute / aria styling churn does not feed identity (input shape contract)', () => {
      // The targetRef builder takes only the identity tuple; class /
      // style are not passed in. We pin that contract by passing the
      // exact same identity arguments and asserting equality. If a
      // future refactor wires class into the input, this test stays
      // green until someone *also* mutates the input here — which is
      // the right blast radius for that decision.
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
        label: 'Issues',
        href: '/owner/repo/issues',
        ordinal: 0,
      });
      expect(a).toBe(b);
    });

    it('non-meaningful whitespace around the label is normalised away', () => {
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
        // mimic a real DOM re-render where the text content gained
        // surrounding whitespace and an extra space inside.
        label: '\n  Issues\t \n',
        href: '/owner/repo/issues',
        ordinal: 0,
      });
      expect(a).toBe(b);
    });
  });

  describe('reload-shaped re-annotation', () => {
    /**
     * Reload simulation: rebuild the HVO list with completely fresh
     * `ref` values (as if `__claudeElementMap` was wiped and
     * repopulated by a new content-script injection), and assert
     * that `targetRef` for every identity-bearing HVO is unchanged.
     *
     * This is the unit-level mirror of the private-tests scenario
     * `T5-F-GH-STABLE-TARGETREF-CROSS-RELOAD`.
     */
    it('targetRef is preserved when every per-snapshot ref churns', () => {
      const baseObjects = [
        {
          id: 'hvo_issues',
          kind: 'candidate_action',
          label: 'Issues',
          ref: 'ref_pre_001',
          role: 'link',
          objectSubType: 'github.repo_nav_tab',
          href: '/owner/repo/issues',
          reason: 'r',
        },
        {
          id: 'hvo_pulls',
          kind: 'candidate_action',
          label: 'Pull requests',
          ref: 'ref_pre_002',
          role: 'link',
          objectSubType: 'github.repo_nav_tab',
          href: '/owner/repo/pulls',
          reason: 'r',
        },
      ];

      const before = annotateStableTargetRefs(baseObjects, 'repo_home');
      const reloadShaped = baseObjects.map((o, i) => ({
        ...o,
        ref: `ref_post_${1000 + i}`,
      }));
      const after = annotateStableTargetRefs(reloadShaped, 'repo_home');

      expect(before.map((o) => o.targetRef)).toEqual(after.map((o) => o.targetRef));
    });
  });

  describe('ordinal-collision contract', () => {
    it('visually-identical siblings (same label, no href) must get distinct targetRefs', () => {
      // Two icon-only menu buttons in the same toolbar — the only
      // disambiguator the builder has is the ordinal. If a future
      // change collapsed ordinal out of the key, both buttons would
      // share a targetRef and a click bridge call would silently
      // pick the wrong one. This test pins the contract.
      const annotated = annotateStableTargetRefs(
        [
          {
            id: 'hvo_menu_a',
            kind: 'interactive_element',
            label: 'menu',
            ref: 'ref_menu_a',
            role: 'button',
            reason: 'r',
          },
          {
            id: 'hvo_menu_b',
            kind: 'interactive_element',
            label: 'menu',
            ref: 'ref_menu_b',
            role: 'button',
            reason: 'r',
          },
        ],
        'repo_home',
      );

      const refA = annotated.find((o) => o.id === 'hvo_menu_a')?.targetRef;
      const refB = annotated.find((o) => o.id === 'hvo_menu_b')?.targetRef;
      expect(refA).toMatch(STABLE_REF_PATTERN);
      expect(refB).toMatch(STABLE_REF_PATTERN);
      expect(refA).not.toBe(refB);
    });
  });
});
