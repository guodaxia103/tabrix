import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStableTargetRefRegistryForTests,
  getStableTargetRefRegistrySnapshot,
  lookupStableTargetRef,
  recordStableTargetRefSnapshot,
  clearStableTargetRefTab,
} from '@/entrypoints/background/tools/browser/stable-target-ref-registry';

describe('B-011 stable-targetRef registry', () => {
  beforeEach(() => {
    __resetStableTargetRefRegistryForTests();
  });

  it('records and looks up entries by tab', () => {
    recordStableTargetRefSnapshot(7, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' },
      { targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' },
    ]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_a');
    expect(lookupStableTargetRef(7, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('keeps tabs isolated', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(8, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_other' }]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_a');
    expect(lookupStableTargetRef(8, 'tgt_aaaaaaaaaa')).toBe('ref_other');
  });

  it('replaces the snapshot for a tab on each record call', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' }]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(7, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('drops the tab when given an empty list', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(7, []);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(getStableTargetRefRegistrySnapshot().tabIds).not.toContain(7);
  });

  it('clearTab removes only the requested tab', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(8, [{ targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' }]);
    clearStableTargetRefTab(7);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(8, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('returns undefined for unknown tabs / refs / invalid args', () => {
    expect(lookupStableTargetRef(7, 'tgt_nope')).toBeUndefined();
    expect(lookupStableTargetRef(undefined as any, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(NaN, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(7, '')).toBeUndefined();
  });

  it('first write wins when multiple entries share the same targetRef', () => {
    recordStableTargetRefSnapshot(7, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_first' },
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_second' },
    ]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_first');
  });

  it('snapshot reports tab counts deterministically', () => {
    recordStableTargetRefSnapshot(8, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' },
      { targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' },
    ]);
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_cccccccccc', ref: 'ref_c' }]);
    const snap = getStableTargetRefRegistrySnapshot();
    expect(snap.tabIds).toEqual([7, 8]);
    expect(snap.entryCounts[7]).toBe(1);
    expect(snap.entryCounts[8]).toBe(2);
  });
});
