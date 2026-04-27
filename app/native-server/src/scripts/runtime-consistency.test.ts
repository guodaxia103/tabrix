/**
 * V26-FIX-09 — `RuntimeConsistencySnapshot.marker` is the closed-enum
 * alias the v2.6 evidence contract uses (`consistent | stale | unknown`).
 * This test pins the verdict→marker mapping so a future change to the
 * legacy `verdict` enum cannot silently drift the public marker that
 * Gate B / `tabrix status --json` consumers grep for.
 *
 * The snapshot itself touches the filesystem (workspace dist/cli.js,
 * extension build dir, daemon pid file). Those values vary by host so
 * we don't assert on them here — we only assert that whichever verdict
 * the snapshot produces, the `marker` field is its v2.6-vocabulary
 * counterpart.
 */

import { collectRuntimeConsistencySnapshot } from './runtime-consistency';

describe('V26-FIX-09 RuntimeConsistencySnapshot marker', () => {
  it('marker is one of the closed-enum values', async () => {
    const snapshot = await collectRuntimeConsistencySnapshot();
    expect(['consistent', 'stale', 'unknown']).toContain(snapshot.marker);
  });

  it('marker mirrors verdict via the FIX-09 mapping', async () => {
    const snapshot = await collectRuntimeConsistencySnapshot();
    const expected =
      snapshot.verdict === 'consistent'
        ? 'consistent'
        : snapshot.verdict === 'inconsistent'
          ? 'stale'
          : 'unknown';
    expect(snapshot.marker).toBe(expected);
  });
});
