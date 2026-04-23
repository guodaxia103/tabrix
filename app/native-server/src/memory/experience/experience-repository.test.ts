/**
 * Unit tests for V24-01 additions to {@link ExperienceRepository}.
 *
 * Scope of THIS file: `findActionPathById` only. The rest of the
 * repository is exercised through `experience-aggregator.test.ts` and
 * `experience-suggest.test.ts`.
 *
 * SoT: `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` §7 + plan commit 2.
 */

import { openMemoryDb } from '../db/client';
import { ExperienceRepository } from './experience-repository';

interface RepoFixture {
  repo: ExperienceRepository;
  close: () => void;
}

function fresh(): RepoFixture {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  return { repo: new ExperienceRepository(db), close: () => db.close() };
}

const VALID_ID_A = 'action_path_' + 'a'.repeat(64);
const VALID_ID_B = 'action_path_' + 'b'.repeat(64);

function seedRow(repo: ExperienceRepository, id: string, lastUsedAt = '2026-04-22T00:00:00.000Z') {
  repo.upsertActionPath({
    actionPathId: id,
    pageRole: 'issues_list',
    intentSignature: 'open issues',
    stepSequence: [
      { toolName: 'chrome_click_element', status: 'ok', historyRef: 'h_step_1' },
      { toolName: 'chrome_fill_or_select', status: 'ok', historyRef: 'h_step_2' },
    ],
    successDelta: 3,
    failureDelta: 1,
    lastUsedAt,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: lastUsedAt,
  });
}

describe('ExperienceRepository#findActionPathById (V24-01)', () => {
  it('returns the row matching an existing actionPathId', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A);
      const row = fx.repo.findActionPathById(VALID_ID_A);
      expect(row).toBeDefined();
      expect(row?.actionPathId).toBe(VALID_ID_A);
      expect(row?.pageRole).toBe('issues_list');
      expect(row?.intentSignature).toBe('open issues');
      expect(row?.successCount).toBe(3);
      expect(row?.failureCount).toBe(1);
      expect(row?.stepSequence).toHaveLength(2);
      expect(row?.stepSequence[0]).toEqual({
        toolName: 'chrome_click_element',
        status: 'ok',
        historyRef: 'h_step_1',
      });
      expect(row?.lastUsedAt).toBe('2026-04-22T00:00:00.000Z');
    } finally {
      fx.close();
    }
  });

  it('returns undefined for a non-existent actionPathId (stale-id safe)', () => {
    const fx = fresh();
    try {
      // Empty DB.
      expect(fx.repo.findActionPathById(VALID_ID_A)).toBeUndefined();

      // Populated DB but mismatched id.
      seedRow(fx.repo, VALID_ID_A);
      expect(fx.repo.findActionPathById(VALID_ID_B)).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it('does not match by partial / prefix string (point-lookup, not LIKE)', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A);
      // Prefix should not match.
      expect(fx.repo.findActionPathById('action_path_')).toBeUndefined();
      // Truncated id should not match.
      expect(fx.repo.findActionPathById(VALID_ID_A.slice(0, -1))).toBeUndefined();
      // SQL-injection-ish placeholder; must not return anything.
      expect(fx.repo.findActionPathById("' OR 1=1 --")).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it('reflects compounded counters after a subsequent upsert (used by replay-session aggregator)', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A);
      // Simulate an aggregator pass projecting a successful replay
      // back to the original row (brief §7).
      fx.repo.upsertActionPath({
        actionPathId: VALID_ID_A,
        pageRole: 'issues_list',
        intentSignature: 'open issues',
        stepSequence: [
          { toolName: 'chrome_click_element', status: 'ok', historyRef: 'h_step_1' },
          { toolName: 'chrome_fill_or_select', status: 'ok', historyRef: 'h_step_2' },
        ],
        successDelta: 1,
        failureDelta: 0,
        lastUsedAt: '2026-04-23T00:00:00.000Z',
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      });
      const row = fx.repo.findActionPathById(VALID_ID_A);
      expect(row?.successCount).toBe(4);
      expect(row?.failureCount).toBe(1);
      expect(row?.lastUsedAt).toBe('2026-04-23T00:00:00.000Z');
    } finally {
      fx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// V24-02 — write-back surface
// ---------------------------------------------------------------------------

describe('ExperienceRepository#recordReplayStepOutcome (V24-02)', () => {
  it('applies +1 success delta and writes last_replay_at on a success-like outcome', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A, '2026-04-22T00:00:00.000Z');
      const result = fx.repo.recordReplayStepOutcome({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
        nowIso: '2026-04-23T01:02:03.000Z',
      });
      expect(result.status).toBe('ok');
      expect(result.successDelta).toBe(1);
      expect(result.failureDelta).toBe(0);
      expect(result.lastReplayStatus).toBe('ok');
      const row = fx.repo.findActionPathById(VALID_ID_A);
      expect(row?.successCount).toBe(4); // 3 + 1
      expect(row?.failureCount).toBe(1);
      expect(row?.lastReplayAt).toBe('2026-04-23T01:02:03.000Z');
      expect(row?.lastReplayOutcome).toBe('state_toggled');
      expect(row?.lastReplayStatus).toBe('ok');
      // Updated `last_used_at` because the new replay is more recent.
      expect(row?.lastUsedAt).toBe('2026-04-23T01:02:03.000Z');
      expect(row?.updatedAt).toBe('2026-04-23T01:02:03.000Z');
    } finally {
      fx.close();
    }
  });

  it('applies +1 failure delta on a non-success outcome', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A, '2026-04-22T00:00:00.000Z');
      const result = fx.repo.recordReplayStepOutcome({
        actionPathId: VALID_ID_A,
        stepIndex: 1,
        observedOutcome: 'no_observed_change',
        nowIso: '2026-04-23T01:02:03.000Z',
      });
      expect(result.status).toBe('ok');
      expect(result.successDelta).toBe(0);
      expect(result.failureDelta).toBe(1);
      expect(result.lastReplayStatus).toBe('failed');
      const row = fx.repo.findActionPathById(VALID_ID_A);
      expect(row?.successCount).toBe(3);
      expect(row?.failureCount).toBe(2);
      expect(row?.lastReplayOutcome).toBe('no_observed_change');
      expect(row?.lastReplayStatus).toBe('failed');
    } finally {
      fx.close();
    }
  });

  it('returns no_match without touching counters when the row is missing', () => {
    const fx = fresh();
    try {
      const result = fx.repo.recordReplayStepOutcome({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
        nowIso: '2026-04-23T00:00:00.000Z',
      });
      expect(result.status).toBe('no_match');
      expect(result.successDelta).toBe(0);
      expect(result.failureDelta).toBe(0);
      expect(fx.repo.findActionPathById(VALID_ID_A)).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it('does not regress lastUsedAt when an older replay timestamp is supplied', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A, '2026-04-22T00:00:00.000Z');
      fx.repo.recordReplayStepOutcome({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
        // Older than the seed row's last_used_at.
        nowIso: '2026-04-21T00:00:00.000Z',
      });
      const row = fx.repo.findActionPathById(VALID_ID_A);
      // last_used_at must NOT regress (chooser-side ranking depends
      // on the freshness ordering staying monotonic).
      expect(row?.lastUsedAt).toBe('2026-04-22T00:00:00.000Z');
      // last_replay_at always reflects the most recent attempt though.
      expect(row?.lastReplayAt).toBe('2026-04-21T00:00:00.000Z');
    } finally {
      fx.close();
    }
  });
});

describe('ExperienceRepository#updateCompositeScoreForActionPath (V24-02)', () => {
  it('updates composite_score_decayed and updated_at', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A);
      fx.repo.updateCompositeScoreForActionPath({
        actionPathId: VALID_ID_A,
        compositeScoreDecayed: 0.42,
        nowIso: '2026-04-23T05:00:00.000Z',
      });
      const row = fx.repo.findActionPathById(VALID_ID_A);
      expect(row?.compositeScoreDecayed).toBeCloseTo(0.42, 5);
      expect(row?.updatedAt).toBe('2026-04-23T05:00:00.000Z');
    } finally {
      fx.close();
    }
  });

  it('is a no-op when the row does not exist', () => {
    const fx = fresh();
    try {
      // Should not throw.
      fx.repo.updateCompositeScoreForActionPath({
        actionPathId: VALID_ID_A,
        compositeScoreDecayed: 0.42,
        nowIso: '2026-04-23T05:00:00.000Z',
      });
      expect(fx.repo.findActionPathById(VALID_ID_A)).toBeUndefined();
    } finally {
      fx.close();
    }
  });
});

describe('ExperienceRepository#recordWritebackWarning + listRecentWritebackWarnings (V24-02)', () => {
  it('persists and reads back the structured warning row', () => {
    const fx = fresh();
    try {
      fx.repo.recordWritebackWarning({
        warningId: 'warn_score_step_test',
        source: 'experience_score_step',
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        sessionId: null,
        replayId: null,
        observedOutcome: 'no_observed_change',
        errorCode: 'score_step_write_failed',
        errorMessage: 'SQLITE_BUSY',
        payloadBlob: '{}',
        createdAt: '2026-04-23T00:00:00.000Z',
      });
      const rows = fx.repo.listRecentWritebackWarnings(10);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        warningId: 'warn_score_step_test',
        source: 'experience_score_step',
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'no_observed_change',
        errorCode: 'score_step_write_failed',
        errorMessage: 'SQLITE_BUSY',
      });
    } finally {
      fx.close();
    }
  });

  it('returns the most recent warnings first', () => {
    const fx = fresh();
    try {
      fx.repo.recordWritebackWarning({
        warningId: 'warn_a',
        source: 'experience_score_step',
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        sessionId: null,
        replayId: null,
        observedOutcome: null,
        errorCode: 'x',
        errorMessage: 'a',
        payloadBlob: null,
        createdAt: '2026-04-22T00:00:00.000Z',
      });
      fx.repo.recordWritebackWarning({
        warningId: 'warn_b',
        source: 'session_composite_score',
        actionPathId: VALID_ID_A,
        stepIndex: null,
        sessionId: 'sess_1',
        replayId: null,
        observedOutcome: null,
        errorCode: 'y',
        errorMessage: 'b',
        payloadBlob: null,
        createdAt: '2026-04-23T00:00:00.000Z',
      });
      const rows = fx.repo.listRecentWritebackWarnings(10);
      expect(rows.map((r) => r.warningId)).toEqual(['warn_b', 'warn_a']);
    } finally {
      fx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Migration idempotence — opening the same DB twice must not error out
// ---------------------------------------------------------------------------

describe('ExperienceRepository — V24-02 migration idempotence', () => {
  it('is safe to re-open the same DB twice (additive ALTER TABLE only)', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    // First open already created the V24-02 columns; second open
    // must not throw despite the columns already existing.
    expect(() => {
      const repo = new ExperienceRepository(db);
      // Smoke-check the new columns are queryable.
      expect(repo.listRecentWritebackWarnings(1)).toEqual([]);
    }).not.toThrow();
    db.close();
  });
});
