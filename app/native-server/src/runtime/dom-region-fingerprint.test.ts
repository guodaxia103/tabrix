/**
 * V27-02 — DOM region fingerprint helper tests.
 *
 * Asserts the helper is:
 *   - deterministic across input order,
 *   - empty-input safe,
 *   - privacy-safe (PII / secrets in producer signal aborts the hash).
 */

import { fingerprintRegions } from './dom-region-fingerprint';

describe('dom-region-fingerprint — fingerprintRegions', () => {
  it('is deterministic regardless of input order', () => {
    const a = fingerprintRegions(
      [
        { region: 'header', signal: 'count=1|hash=abc' },
        { region: 'main_list', signal: 'count=12|firstHash=zzz' },
      ],
      1700_000_000_000,
    );
    const b = fingerprintRegions(
      [
        { region: 'main_list', signal: 'count=12|firstHash=zzz' },
        { region: 'header', signal: 'count=1|hash=abc' },
      ],
      1700_000_000_000,
    );
    expect(a.regionHashes).toEqual(b.regionHashes);
    expect(a.domSnapshotHash).toEqual(b.domSnapshotHash);
    expect(a.observedAtMs).toBe(1700_000_000_000);
  });

  it('handles empty region input deterministically', () => {
    const a = fingerprintRegions([], 100);
    const b = fingerprintRegions([], 100);
    expect(a.regionHashes).toEqual({});
    expect(a.domSnapshotHash).toBe(b.domSnapshotHash);
    // SHA-1 is 40 hex chars.
    expect(a.domSnapshotHash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('changes when a region signal changes', () => {
    const a = fingerprintRegions(
      [
        { region: 'header', signal: 'count=1|hash=abc' },
        { region: 'list', signal: 'count=12|firstHash=zzz' },
      ],
      1,
    );
    const b = fingerprintRegions(
      [
        { region: 'header', signal: 'count=1|hash=abc' },
        { region: 'list', signal: 'count=13|firstHash=zzz' },
      ],
      1,
    );
    expect(a.domSnapshotHash).not.toBe(b.domSnapshotHash);
    expect(a.regionHashes.list).not.toBe(b.regionHashes.list);
    expect(a.regionHashes.header).toBe(b.regionHashes.header);
  });

  it('throws when a producer signal smuggles a value-shaped scalar', () => {
    expect(() => fingerprintRegions([{ region: 'header', signal: 'user@example.com' }], 1)).toThrow(
      /PrivacyGate/,
    );
  });
});
