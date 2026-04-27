/**
 * V27-02 — DOM region fingerprint helper (pure).
 *
 * Goals:
 * - Deterministic: same input produces same hash regardless of the
 *   producer's Object key insertion order.
 * - Privacy-safe: every input is the producer's pre-summarised
 *   "signal" string; the helper never sees raw HTML, raw innerText,
 *   or raw URLs. The fingerprint module performs ONE final sanity
 *   check (V27-00 PrivacyGate `assertNoSensitive`) so a producer bug
 *   that leaks a value-shaped scalar still aborts before persistence.
 * - Cheap: SHA-1 via Node's `crypto` is fine here — fingerprints
 *   travel inside the same process and the input bag is bounded.
 *
 * Out of scope:
 * - Real DOM access. The helper consumes producer-side region
 *   summaries; the producer (extension `observers/dom-fact.ts`,
 *   landed alongside V27-04 readiness profiler) is the only side
 *   that touches the DOM, and even there only via existing
 *   stable-target-ref-registry / read-page paths.
 */

import { createHash } from 'node:crypto';
import type { DomRegionFingerprint } from '@tabrix/shared';
import { assertNoSensitive } from './privacy-gate';

/** Region summary input. Each entry is a brand-neutral key + a
 *  pre-summarised string of "signals" the region wants to fingerprint
 *  (e.g. `'count=12|firstHash=abc'`). */
export interface RegionSummaryInput {
  region: string;
  signal: string;
}

/**
 * Hash the supplied region summaries into a `DomRegionFingerprint`.
 *
 * - `regions` is sorted by `region` (stable order) before hashing so
 *   a producer that emits keys in different orders still gets the
 *   same fingerprint.
 * - Empty input returns a fingerprint with empty `regionHashes` and
 *   the deterministic hash of an empty string.
 * - Throws `Error` (privacy) if the producer accidentally embedded a
 *   value-shaped scalar (email / phone / long opaque token) in any
 *   `signal`. The throw is loud on purpose: a leak is a contract bug
 *   the V27-00 PrivacyGate must surface, not silently redact.
 */
export function fingerprintRegions(
  regions: ReadonlyArray<RegionSummaryInput>,
  observedAtMs: number,
): DomRegionFingerprint {
  // Defence in depth: assert no leak in the producer-supplied signals
  // before we hash them into a stable id that downstream consumers
  // rely on.
  assertNoSensitive({ regions });

  const sorted = [...regions].sort((a, b) => a.region.localeCompare(b.region));
  const regionHashes: Record<string, string> = {};
  for (const { region, signal } of sorted) {
    regionHashes[region] = sha1(`${region}|${signal}`);
  }
  const composite = sorted.map(({ region }) => `${region}=${regionHashes[region]}`).join('\n');
  return {
    regionHashes,
    domSnapshotHash: sha1(composite),
    observedAtMs,
  };
}

function sha1(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex');
}
